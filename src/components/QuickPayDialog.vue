<script setup lang="ts">
/**
 * Быстрая оплата из строки списка сделок.
 *
 * Единственное окно приёма оплаты. Платёж выбирать не надо: клиент гасит
 * договор, а строку система берёт сама — самую раннюю открытую, сначала
 * недоплаты. Весь график виден сразу и меняется на глазах по мере ввода суммы.
 * Здесь же досрочное погашение: партнёр вводит сумму меньше остатка и решает,
 * перенести недостачу в график или простить её.
 *
 * Все денежные расчёты — из общего слоя `utils/paymentMath`: окно обязано
 * показывать ровно то, что сделает сервер.
 */
import { computed, ref, watch } from 'vue'
import { usePaymentsStore } from '@/stores/payments'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useSections } from '@/composables/useSections'
import { useSendPdfWhatsApp } from '@/composables/useSendPdfWhatsApp'
import DateField from '@/components/DateField.vue'
import PaymentSourcePicker from '@/components/PaymentSourcePicker.vue'
import PaymentSchedulePreview from '@/components/PaymentSchedulePreview.vue'
import { formatCurrency, formatDate, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { generateReceipt } from '@/utils/receiptPdf'
import { receiptAsPaid } from '@/utils/receiptAsPaid'
import { useReceiptTemplate } from '@/composables/useReceiptTemplate'
import { api } from '@/api/client'
import { type RedistributeMode } from '@/utils/redistribute'
import { dueYearMonth, monthAccusative } from '@/utils/paymentAttribution'
import * as money from '@/utils/paymentMath'
import { useOperationDate } from '@/composables/useOperationDate'
import type { Deal, Payment, User } from '@/types'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** Платёж из строки списка — уже выбран, искать не нужно. */
    payment: Payment | null
    deal: Deal | null
    fullscreen?: boolean
  }>(),
  { fullscreen: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'paid', dealId: string): void
}>()

const paymentsStore = usePaymentsStore()
const authStore = useAuthStore()
const receiptTemplate = useReceiptTemplate()

/**
 * Печать квитанции по бланку партнёра.
 *
 * Обёртка, потому что бланк приходит с сервера: в разметке нельзя ждать
 * загрузку, а печатать стандартный вид, когда партнёр настроил свой, — значит
 * показывать клиенту не то.
 */
async function printReceipt() {
  if (!props.deal || !target.value) return
  const r = receiptData(target.value)
  generateReceipt(r.deal, r.payment, authStore.user || {}, {
    template: await receiptTemplate.getTemplate(),
  })
}

/**
 * Квитанция — о том, что ввели в окне, а не о плановой строке графика:
 * сумма и дата из формы, остаток — тот же, что окно показывает партнёру
 * (с учётом прощения при досрочном закрытии), график — загруженный окном.
 */
function receiptData(payment: Payment) {
  return receiptAsPaid(props.deal!, payment, {
    amount: enteredAmount.value,
    paidAt: paidAt.value,
    remainingAfter: hasAmount.value ? remainingAfter.value : null,
    payments: schedule.value,
    // Какие ещё строки закроет эта оплата: при прощении — все остальные
    // открытые, иначе — те, что гасит переплата (как в превью графика).
    closedIds: !hasAmount.value
      ? null
      : forgivingValid.value
        ? openSchedule.value.filter((p) => p.id !== payment.id).map((p) => p.id)
        : preview.value.closedIds,
  })
}
const toast = useToast()
const sections = useSections()
// Границы даты оплаты: сотрудник не может увести платёж в закрытый месяц.
const opDate = useOperationDate()
const { sendPdf, sending: sendingWhatsApp } = useSendPdfWhatsApp()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/**
 * Отмеченные строки графика — за что вносят деньги.
 *
 * Клиент гасит договор, а не конкретный месяц: партнёр отмечает галочками,
 * сколько месяцев закрывает эта оплата, и сумма считается сама.
 */
const selectedIds = ref<string[]>([])

/**
 * Оплачиваемая строка — первая из отмеченных по порядку графика. Именно на
 * неё ляжет оплата, а переплата закроет следующие отмеченные.
 */
const target = computed(() => {
  const open = pickSchedule.value.filter((p) => selectedIds.value.includes(p.id))
  return open[0] ?? props.payment
})

/**
 * График сделки. В списке его нет — грузим сам.
 *
 * Пустой массив считаем «не загружен»: расчёты по нему выходят дикие, окно
 * предлагало бы дописать платёж почти на весь остаток договора.
 */
const schedule = computed<Payment[]>(() =>
  props.payment ? paymentsStore.getPaymentsForDeal(props.payment.dealId) : [],
)
/**
 * Учитывать ли недоплаты прошлых месяцев.
 *
 * По умолчанию да: старый долг закрывают первым. Но клиент может принести
 * деньги именно за следующий месяц — тогда недоплаты убираются из очереди и
 * остаются висеть, а оплата идёт с ближайшего планового платежа.
 */
const includeDebts = ref(true)

/** Открытые строки графика по порядку — из них и выбирают. */
const openSchedule = computed<Payment[]>(() =>
  schedule.value
    .filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE')
    .slice()
    .sort((a, b) => {
      const byDate = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      if (byDate !== 0) return byDate
      // При равном сроке недоплата идёт первой: она за уже прошедший месяц.
      const byDebt = Number(!!b.shortfallOfPaymentId) - Number(!!a.shortfallOfPaymentId)
      return byDebt !== 0 ? byDebt : a.number - b.number
    }),
)

/**
 * Есть ли впереди обычные платежи графика. Если остались только недоплаты,
 * пропускать их некуда: очередь без них была бы пустой.
 */
const hasPlannedOpen = computed(() => openSchedule.value.some((p) => !p.shortfallOfPaymentId))

/** Очередь оплаты: строки, между которыми выбирает партнёр. */
const pickSchedule = computed(() =>
  includeDebts.value || !hasPlannedOpen.value
    ? openSchedule.value
    : openSchedule.value.filter((p) => !p.shortfallOfPaymentId),
)

/** Открытые недоплаты — их сумма показывается в переключателе. */
const debtRows = computed(() => openSchedule.value.filter((p) => p.shortfallOfPaymentId))
const debtRowsSum = computed(() => debtRows.value.reduce((s, p) => s + Math.round(p.amount), 0))

const scheduleLoading = ref(false)
/**
 * Свёрнут ли график. По умолчанию да: в большинстве случаев человек просто
 * отмечает оплату, а раскрытый график занимал почти всё окно и прятал кнопку
 * подтверждения за прокруткой.
 */
const scheduleOpen = ref(false)

/**
 * Вкладка окна: оплата или документы.
 *
 * Квитанция со скриншотом нужны не каждый раз, а места занимали столько же,
 * сколько сама оплата, — из-за них кнопка подтверждения уходила за прокрутку.
 */
const payTab = ref<'pay' | 'docs' | 'note'>('pay')

// ── Состояние формы ─────────────────────────────────────────────────────────
type PayMode = 'MONTH' | 'EARLY'
const payMode = ref<PayMode>('MONTH')
const enteredAmount = ref<number | null>(null)
const paidAt = ref('')
const shortfallAction = ref<'REDISTRIBUTE' | 'FORGIVE'>('REDISTRIBUTE')
/**
 * Недоплата остаётся долгом за этот же месяц: не раскладывается по графику и
 * не прощается. В должники клиент попадает по порогам раздела «Должники».
 */
const leaveDebt = ref(false)
/** Когда клиент обещал доплатить. Необязательно — мог и не назвать. */
const debtPromisedDate = ref('')
const debtNote = ref('')
// «Закрыть ближайшие» по умолчанию: так деньги гасят месяцы подряд, а не
// размазываются по всему графику — этого партнёр и ждёт от досрочной оплаты.
const redistributeMode = ref<RedistributeMode>('NEXT')
const manualSchedule = ref<Record<string, number>>({})
const createTailPayment = ref(false)
/**
 * Комментарий к платежу. Уходит вместе с отметкой оплаты: отдельного запроса
 * не нужно, платёж всё равно сохраняется этим же действием. Потом его можно
 * поправить в карточке платежа.
 */
const payNote = ref('')
const submitting = ref(false)
const proofFile = ref<File | null>(null)
/** Куда легли деньги. Пусто — сервис подставит счёт сам. */
const accountId = ref<string | null>(null)
/** Смешанная оплата: часть наличными, часть переводом. */
const allocations = ref<Array<{ accountId: string; amount: number }> | null>(null)
const proofPreview = ref('')
const proofInputRef = ref<HTMLInputElement | null>(null)

const todayYmd = computed(() => money.toDateInput(new Date()))

/** «2 платежа», «5 платежей» — сводка в шапке читается как фраза. */
function pluralPayments(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'платёж'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'платежа'
  return 'платежей'
}

function shortDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

// Сброс при каждом открытии — иначе в окно протекают сумма и режим от
// предыдущей сделки. Ровно эти грабли уже ловили на общей модалке.
watch(
  () => [props.modelValue, props.payment?.id],
  async ([isOpen]) => {
    if (!isOpen || !props.payment) return
    payMode.value = 'MONTH'
    includeDebts.value = true
    selectedIds.value = [props.payment.id]
    enteredAmount.value = Math.round(props.payment.amount)
    paidAt.value = todayYmd.value
    shortfallAction.value = 'REDISTRIBUTE'
    redistributeMode.value = 'NEXT'
    manualSchedule.value = {}
    createTailPayment.value = false
    payNote.value = ''
    leaveDebt.value = false
    debtPromisedDate.value = ''
    debtNote.value = ''
    proofFile.value = null
    accountId.value = null
    allocations.value = null
    proofPreview.value = ''
    // Каждое открытие окна начинается с чистого листа: свёрнутый график и
    // вкладка оплаты.
    scheduleOpen.value = false
    payTab.value = 'pay'

    // График перечитываем всегда, даже если он есть в памяти: по нему
    // подставляется сумма досрочного погашения, и устаревший остаток отправил
    // бы на сервер не то, что видел партнёр.
    scheduleLoading.value = !schedule.value.length
    try {
      await paymentsStore.fetchPaymentsForDeal(props.payment.dealId)
    } catch { /* окно работает и без графика, только без превью */ }
    finally { scheduleLoading.value = false }
  },
  { immediate: true },
)

// ── Расчёты (все — из общего слоя) ──────────────────────────────────────────
const openRows = computed(() => money.openRows(schedule.value, target.value?.id))

/** Остаток за вычетом уже прощённого — сумма для режима «Досрочно». */
const forgiveState = computed(() =>
  money.forgiveInfo(props.deal, schedule.value, target.value, enteredAmount.value),
)

/**
 * Остаток к распределению по обычным строкам графика (то же, что считает
 * сервер): долги-недоплаты держат свою сумму и в раскладку не входят.
 */
const outstanding = computed(() => {
  if (!props.deal || !target.value) return 0
  // Остаток по договору после этой оплаты.
  const left = money.outstandingAfter(props.deal, schedule.value, target.value.id, enteredAmount.value ?? 0)
  // Из него держат свою сумму только те недоплаты, что остаются висеть:
  // закрытые этой оплатой больше ничего не занимают.
  return Math.max(left - debtCover.value.notCovered, 0)
})

/** Сколько ждали по этой строке или по остатку — зависит от режима. */
const expected = computed(() =>
  payMode.value === 'EARLY' ? forgiveState.value.outstandingNet : Math.round(target.value?.amount ?? 0),
)

/**
 * Сумма введена. Пустое поле и ноль — не «оплата на ноль рублей», а ещё не
 * заполненная форма: считать по ней график нельзя, иначе выходило, что
 * остаток по договору закрыт и все платежи закроются.
 */
const hasAmount = computed(() => Math.round(enteredAmount.value ?? 0) > 0)

const shortfall = computed(() => Math.max(expected.value - Math.round(enteredAmount.value ?? 0), 0))
const overpay = computed(() => Math.max(Math.round(enteredAmount.value ?? 0) - expected.value, 0))

/**
 * Досрочное погашение показываем, когда остаток по договору больше текущей
 * строки: либо впереди есть платежи, либо график кончился, а долг остался
 * (хронический недоплатёжщик — там прощение хвоста тоже работает).
 */
const canPayEarly = computed(
  () => forgiveState.value.outstandingNet > Math.round(target.value?.amount ?? 0),
)

const forgiving = computed(
  () => payMode.value === 'EARLY' && shortfallAction.value === 'FORGIVE' && shortfall.value > 0,
)

/** Прощать остаток разрешено не всем — это списание заработка. */
const canForgive = computed(() => authStore.can('payments.forgive'))

/**
 * Можно ли оставить недоплату долгом: только за месяц — при досрочном
 * погашении клиент гасит весь договор, долга «за месяц» там не бывает.
 */
const canLeaveDebt = computed(
  () => payMode.value === 'MONTH' && shortfall.value > 0 && Math.round(enteredAmount.value ?? 0) > 0,
)

/** Долг выбран и применим при текущей сумме. */
const debtChosen = computed(() => leaveDebt.value && canLeaveDebt.value)

/** Открытые недоплаты прошлых месяцев — их может закрыть переплата. */
const openDebts = computed(() => money.openDebtRows(schedule.value, target.value?.id))

/**
 * Что произойдёт с недоплатами — считаем тем же правилом, что и сервер:
 * сначала закрываются отмеченные галочками, затем остальные, если остатка по
 * договору на них уже не хватает (так гасятся долги при досрочном погашении).
 */
const debtCover = computed(() => {
  const debts = openDebts.value.filter((d) => d.id !== target.value?.id)
  if (!hasAmount.value || !debts.length || !props.deal || !target.value) {
    return { closedIds: [] as string[], reduced: [] as Array<{ id: string; amount: number }>, notCovered: 0 }
  }
  return money.debtsAfterPayment({
    debts,
    picked: debts.filter((d) => selectedIds.value.includes(d.id)).map((d) => d.id),
    overpay: overpay.value,
    left: money.outstandingAfter(props.deal, schedule.value, target.value.id, enteredAmount.value ?? 0),
  })
})

/** Перерасчёт применяется, когда сумма ≠ плановой и есть что распределять. */
const applyRedistribute = computed(() => {
  if (forgiving.value || debtChosen.value || !hasAmount.value) return false
  const entered = enteredAmount.value
  const t = target.value
  if (!entered || !t) return false
  return openRows.value.length > 0 && Math.round(entered) !== Math.round(t.amount)
})

const preview = computed(() => {
  if (!hasAmount.value) return { rows: [], closedIds: [], error: '' }
  const base = money.redistPreview(
    openRows.value,
    outstanding.value,
    redistributeMode.value,
    manualSchedule.value,
  )
  // Недоплаты в раскладку не входят, поэтому их судьбу добавляем к превью
  // отдельно: закрытые помечаются «закроется», частично покрытые меняют сумму.
  const cover = debtCover.value
  if (!cover.closedIds.length && !cover.reduced.length) return base
  return {
    ...base,
    rows: [...base.rows, ...cover.reduced],
    closedIds: [...base.closedIds, ...cover.closedIds],
  }
})

const earlyClose = computed(() =>
  money.earlyCloseInfo(props.deal, schedule.value, target.value, enteredAmount.value),
)

const offMonth = computed(() => money.offMonthInfo(target.value, paidAt.value))

/**
 * Это последняя открытая строка, а денег до остатка не хватает: графику
 * попросту некуда разложить недостачу. Предлагаем дописать платёж — иначе
 * долг повиснет, а сделка не закроется.
 */
const tail = computed(() =>
  money.tailPaymentInfo(props.deal, schedule.value, target.value, enteredAmount.value),
)

/** Остаток по договору после этой операции — итог, который партнёр и ищет. */
const remainingAfter = computed(() =>
  forgivingValid.value
    ? 0
    : Math.max(forgiveState.value.outstandingNet - Math.round(enteredAmount.value ?? 0), 0),
)

/**
 * Сводка по договору для шапки: сколько уже внесено и сколько осталось.
 *
 * Номер конкретного платежа партнёру ничего не решает — он и так виден в
 * графике. Важнее, на каком месте сделка целиком.
 */
const dealSummary = computed(() => {
  const rows = schedule.value
  const settled = rows.filter((p) => p.status === 'PAID' || p.status === 'CLOSED_EARLY')
  const open = rows.filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE')
  return {
    // Строки-остатки — не отдельные платежи графика, иначе выходило бы
    // «оплачено 7 из 6».
    paidCount: settled.filter((p) => !p.shortfallOfPaymentId).length,
    paidSum: settled.reduce((sum, p) => sum + Math.round(p.amount), 0),
    total: props.deal?.numberOfPayments ?? rows.filter((p) => !p.shortfallOfPaymentId).length,
    leftCount: open.filter((p) => !p.shortfallOfPaymentId).length,
    leftSum: open.reduce((sum, p) => sum + Math.round(p.amount), 0),
    debtCount: open.filter((p) => p.shortfallOfPaymentId).length,
    debtSum: open.filter((p) => p.shortfallOfPaymentId).reduce((sum, p) => sum + Math.round(p.amount), 0),
  }
})

// ── Шапка ───────────────────────────────────────────────────────────────────
const headerMonth = computed(() => {
  const t = target.value
  if (!t) return ''
  const due = dueYearMonth(t.dueDate)
  if (!due) return ''
  // Винительный падеж: подпись идёт после «за» — «платёж за май», не «за мае».
  return monthAccusative(due.year, due.month, new Date().getFullYear())
})
const overdueDays = computed(() => {
  const t = target.value
  if (!t || t.status !== 'OVERDUE') return 0
  const diff = Date.now() - new Date(t.dueDate).getTime()
  return Math.max(Math.floor(diff / 86_400_000), 0)
})

// Подсказка зависит от знака разницы: «гасит ближайшие месяцы» и «добавится к
// ближайшему платежу» — одно и то же правило, но партнёр читает их по-разному.
const REDIST_MODES: {
  key: RedistributeMode
  label: string
  hintOver: string
  hintUnder: string
}[] = [
  {
    key: 'NEXT',
    label: 'Закрыть ближайшие',
    hintOver: 'Деньги гасят ближайшие месяцы подряд. Что не покрыто — остаётся как было',
    hintUnder: 'Недостающее добавится к ближайшему платежу, остальные не изменятся',
  },
  {
    key: 'EQUAL',
    label: 'Равномерно',
    hintOver: 'Остаток делится поровну между всеми оставшимися платежами',
    hintUnder: 'Остаток делится поровну между всеми оставшимися платежами',
  },
  {
    key: 'LAST',
    label: 'В последний',
    hintOver: 'Переплата уменьшает последний платёж графика',
    hintUnder: 'Недостающее добавится к последнему платежу графика',
  },
  {
    key: 'MANUAL',
    label: 'Вручную',
    hintOver: 'Задайте суммы сами — их сумма должна равняться остатку',
    hintUnder: 'Задайте суммы сами — их сумма должна равняться остатку',
  },
]

const modeHint = computed(() => {
  const m = REDIST_MODES.find((x) => x.key === redistributeMode.value)
  if (!m) return ''
  return overpay.value > 0 ? m.hintOver : m.hintUnder
})

/** Σ ручного ввода — контроль «сходится / не сходится». */
const manualSum = computed(() =>
  openRows.value.reduce((sum, r) => sum + Math.round(manualSchedule.value[r.id] ?? 0), 0),
)

/**
 * «Оставить как долг» стоит в одном ряду с вариантами раскладки: выбор один.
 * Когда раскладывать некуда (последняя строка графика), кнопка работает как
 * переключатель — иначе её было бы не снять.
 */
function pickDebt() {
  const hasModes = openRows.value.length > 0 && outstanding.value > 0
  leaveDebt.value = hasModes ? true : !leaveDebt.value
  if (leaveDebt.value) createTailPayment.value = false
}

function pickTail() {
  leaveDebt.value = false
  createTailPayment.value = !createTailPayment.value
}

function pickMode(m: RedistributeMode) {
  leaveDebt.value = false
  redistributeMode.value = m
  // В «Вручную» заполняем поля равномерным вариантом — понятная точка отсчёта.
  if (m === 'MANUAL') manualSchedule.value = money.equalSplitMap(openRows.value, outstanding.value)
}

/**
 * Отмечать можно только по порядку: следующий месяц открывается, когда
 * отмечен предыдущий. Пропустить месяц в середине нельзя — деньги всё равно
 * гасят график подряд, и «дырка» в выборе означала бы не то, что произойдёт.
 *
 * Снять можно только последнюю отмеченную строку — тем же правилом.
 */
const pickableIds = computed(() => {
  const rows = pickSchedule.value
  const chosen = selectedIds.value
  const ids: string[] = []
  const firstFree = rows.find((p) => !chosen.includes(p.id))
  if (firstFree) ids.push(firstFree.id)
  const lastChosen = [...rows].reverse().find((p) => chosen.includes(p.id))
  if (lastChosen) ids.push(lastChosen.id)
  return ids
})

/** Сумма отмеченных строк — она же сумма к оплате. */
function selectedSum(ids: string[]): number {
  return pickSchedule.value
    .filter((p) => ids.includes(p.id))
    .reduce((acc, p) => acc + Math.round(p.amount), 0)
}

/** Правка суммы из-за выбора не должна тут же переписать сам выбор. */
let syncingFromRows = false

function toggleRow(id: string) {
  if (!pickableIds.value.includes(id)) return
  const rows = pickSchedule.value
  const at = rows.findIndex((p) => p.id === id)
  if (at < 0) return

  // Отметили — берём всё до этой строки включительно; сняли — отрезаем её и
  // всё после: выбор всегда остаётся непрерывным.
  const next = selectedIds.value.includes(id)
    ? rows.slice(0, at).map((p) => p.id)
    : rows.slice(0, at + 1).map((p) => p.id)
  selectedIds.value = next

  syncingFromRows = true
  enteredAmount.value = selectedSum(next) || null
}

/** Отмечена ли хоть одна недоплата, кроме самой оплачиваемой строки. */
const coversDebts = computed(() =>
  pickSchedule.value.some(
    (p) => p.shortfallOfPaymentId && p.id !== target.value?.id && selectedIds.value.includes(p.id),
  ),
)

/**
 * Сумму правят руками — подстраиваем галочки: отмечаем столько месяцев
 * подряд, сколько эта сумма закрывает. Меньше первого платежа — не отмечено
 * ничего: это недоплата, и закрывать ею нечего.
 */
watch(enteredAmount, (value) => {
  if (syncingFromRows) {
    syncingFromRows = false
    return
  }
  if (payMode.value !== 'MONTH') return
  const entered = Math.round(value ?? 0)
  const ids: string[] = []
  let sum = 0
  for (const row of pickSchedule.value) {
    sum += Math.round(row.amount)
    if (sum > entered) break
    ids.push(row.id)
  }
  selectedIds.value = ids
})

// Переключили учёт недоплат — очередь стала другой, начинаем выбор с её
// первой строки: старый выбор мог ссылаться на строки, которых в очереди нет.
watch(includeDebts, () => {
  const first = pickSchedule.value[0]
  selectedIds.value = first ? [first.id] : []
  syncingFromRows = true
  enteredAmount.value = first ? Math.round(first.amount) : null
})

/** Переключение режима подставляет ожидаемую сумму — иначе поле врёт. */
function setPayMode(m: PayMode) {
  if (m === payMode.value) return
  payMode.value = m
  shortfallAction.value = 'REDISTRIBUTE'
  leaveDebt.value = false
  redistributeMode.value = 'NEXT'
  manualSchedule.value = {}
  enteredAmount.value =
    m === 'EARLY' ? forgiveState.value.outstandingNet : Math.round(target.value?.amount ?? 0)
}

// ── Скриншот и квитанция ────────────────────────────────────────────────────
function onProofSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (proofPreview.value) URL.revokeObjectURL(proofPreview.value)
  proofFile.value = file
  proofPreview.value = URL.createObjectURL(file)
  input.value = ''
}
function removeProof() {
  if (proofPreview.value) URL.revokeObjectURL(proofPreview.value)
  proofFile.value = null
  proofPreview.value = ''
}

function clientPhoneOnDeal(): string | null {
  const d = props.deal
  if (!d) return null
  return (d.clientProfile as any)?.phone || d.client?.phone || d.externalClientPhone || null
}

async function sendReceiptWhatsApp(payment: Payment) {
  if (!props.deal) return
  const phone = clientPhoneOnDeal()
  if (!phone) {
    toast.error('У клиента нет телефона — нельзя отправить в WhatsApp')
    return
  }
  if (!confirm(`Отправить «Квитанция #${payment.number}» клиенту в WhatsApp на ${phone}?`)) return
  const investor = (authStore.user || {}) as Partial<User>
  const r = receiptData(payment)
  const blob = (await generateReceipt(r.deal, r.payment, investor, { returnBlob: true, template: await receiptTemplate.getTemplate() })) as Blob
  await sendPdf({
    blob,
    fileName: `Квитанция-${props.deal.dealNumber || props.deal.id.slice(0, 6)}-${payment.number}.pdf`,
    dealId: props.deal.id,
    caption: `Квитанция о получении платежа #${payment.number} по сделке «${props.deal.productName}».`,
  })
}

// ── Подтверждение ───────────────────────────────────────────────────────────
/** Прощение упирается в железное правило: простить можно только заработок. */
const forgiveBlocked = computed(() => forgiving.value && forgiveState.value.exceedsIncome)

/**
 * Прощение, которое действительно произойдёт. Пока сумма упирается в потолок,
 * подтвердить нельзя — и график с итогом не должны показывать закрытый долг:
 * партнёр решил бы, что всё в порядке.
 */
const forgivingValid = computed(() => forgiving.value && !forgiveState.value.exceedsIncome)

/**
 * Недостаче негде осесть: открытых строк графика не осталось, а остаток по
 * договору больше нуля — и партнёр не выбрал ни «Дописать платёж», ни
 * «Оставить как долг», ни прощение. Без этой проверки подтверждение проходило,
 * а разница просто исчезала: строки на неё не появлялось нигде.
 *
 * Считаем по `tail.applicable`, а не по самому факту недоплаты: когда
 * недостающее покрывают открытые долги-недоплаты, деньги никуда не деваются и
 * мешать оплате незачем.
 */
const shortfallUnhandled = computed(
  () =>
    hasAmount.value &&
    tail.value.applicable &&
    !createTailPayment.value &&
    !debtChosen.value &&
    !forgivingValid.value,
)

const confirmDisabled = computed(
  () =>
    submitting.value ||
    !enteredAmount.value ||
    enteredAmount.value <= 0 ||
    forgiveBlocked.value ||
    shortfallUnhandled.value ||
    (applyRedistribute.value && redistributeMode.value === 'MANUAL' && !!preview.value.error),
)

async function confirm_() {
  const t = target.value
  if (!t) return
  submitting.value = true
  try {
    // Дата сильно в прошлом — переспрашиваем: доход и касса за тот период
    // изменятся задним числом.
    const ask = opDate.confirmMessage(paidAt.value)
    if (ask && !confirm(ask)) return

    let proofScreenshot: string | undefined
    if (proofFile.value) proofScreenshot = await api.upload(proofFile.value, `proofs/${t.dealId}`)

    const dealId = t.dealId
    const payload = money.buildMarkPaidPayload({
      target: t,
      entered: enteredAmount.value,
      paidAtYmd: paidAt.value,
      proofScreenshot,
      note: payNote.value,
      mode: redistributeMode.value,
      manualMap: manualSchedule.value,
      rows: openRows.value,
      applyRedistribute: applyRedistribute.value,
      payMode: payMode.value,
      // Прощение отправляем только когда оно реально применяется: на сервере
      // FORGIVE допустим лишь в досрочном режиме и при недоплате. С долгом
      // так же — только за месяц и при недоплате.
      shortfallAction: forgiving.value ? 'FORGIVE' : debtChosen.value ? 'DEBT' : 'REDISTRIBUTE',
      shortfallPromisedDate: debtPromisedDate.value || undefined,
      shortfallNote: debtNote.value,
      // Отмеченные недоплаты гасятся деньгами этой оплаты; если ни одной не
      // отмечено — переплата уходит вперёд по графику.
      coverDebts: coversDebts.value || debtCover.value.closedIds.length > 0,
    })
    // Счёт добавляем поверх расчёта: он не влияет на суммы, только на то,
    // где деньги окажутся.
    if (accountId.value) payload.accountId = accountId.value
    // Доли уходят только когда сошлись с суммой — иначе сервер откажет, и
    // правильно сделает: деньги не должны появляться из ниоткуда.
    if (allocations.value?.length) payload.allocations = allocations.value
    const paidAmount = payload.amount

    // Намерение фиксируем ДО отметки: после неё график меняется и расчёт
    // хвоста устаревает.
    const tailToAdd =
      createTailPayment.value && tail.value.applicable && !debtChosen.value ? { ...tail.value } : null

    await paymentsStore.markAsPaid(t.id, dealId, payload)

    if (tailToAdd && tailToAdd.deficit > 0) {
      // Сбой здесь не отменяет уже сделанную отметку — сообщаем отдельно.
      try {
        await paymentsStore.addPayment(dealId, {
          amount: tailToAdd.deficit,
          dueDate: new Date(`${tailToAdd.suggestedDate}T12:00:00`).toISOString(),
          note: 'Остаток после недоплат',
        })
      } catch (e: any) {
        toast.error(e.message || 'Платёж отмечен, но не удалось добавить остаток')
      }
    }

    // Ошибиться строкой легко, особенно когда отмечаешь платежи подряд. Даём
    // несколько секунд на отмену прямо в уведомлении. При дописанной строке
    // кнопку не показываем: снятие отметки её не удалит, откат вышел бы неполным.
    if (authStore.can('payments.unmarkPaid') && !tailToAdd) {
      const paidId = t.id
      const debtSuffix = debtChosen.value ? `, долг ${formatCurrency(shortfall.value)}` : ''
      toast.showWithAction(`Платёж на ${formatCurrency(paidAmount ?? t.amount)} отмечен${debtSuffix}`, {
        label: 'Отменить',
        handler: async () => {
          try {
            await paymentsStore.unmarkPaid(paidId, dealId)
            toast.success('Отметка снята')
            emit('paid', dealId)
          } catch (e: any) {
            toast.error(e?.message || 'Не удалось снять отметку')
          }
        },
      })
    } else {
      toast.success('Платёж отмечен как оплаченный')
    }
    open.value = false
    emit('paid', dealId)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при отметке оплаты')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- На телефоне окно раскрывается на весь экран: ограничение ширины там
       обрезало бы содержимое. -->
  <v-dialog
    v-model="open"
    :max-width="fullscreen ? undefined : 680"
    :fullscreen="fullscreen"
    scrollable
  >
    <v-card :rounded="fullscreen ? 0 : 'lg'" class="qp-card" :class="{ 'qp-card--full': fullscreen }">
      <button class="dialog-close-sm" @click="open = false">
        <v-icon icon="mdi-close" size="18" />
      </button>

      <!-- Шапка: что именно оплачивается, без поиска по графику -->
      <div v-if="target" class="qp-head">
        <div class="qp-title">
          Приём оплаты
          <span v-if="overdueDays" class="qp-overdue">просрочка {{ overdueDays }} дн.</span>
        </div>
        <div class="qp-sub">
          <span class="qp-sub-item">
            Оплачено <strong>{{ dealSummary.paidCount }} из {{ dealSummary.total }}</strong>
            — {{ formatCurrency(dealSummary.paidSum) }}
          </span>
          <!-- Строки-остатки не считаются платежами графика, поэтому при
               «осталось 0» их сумму нельзя подписывать счётчиком платежей:
               выходило «Осталось 0 платежей — 600 ₽». -->
          <span class="qp-sub-item">
            <template v-if="dealSummary.leftCount">
              Осталось
              <strong>
                {{ dealSummary.leftCount }}
                {{ pluralPayments(dealSummary.leftCount) }}
              </strong>
              — {{ formatCurrency(dealSummary.leftSum) }}
            </template>
            <template v-else-if="dealSummary.debtSum > 0">
              График закрыт,
              <template v-if="dealSummary.debtCount > 1">
                остались <strong>{{ dealSummary.debtCount }} недоплаты</strong>
              </template>
              <template v-else>осталась <strong>недоплата</strong></template>
              — {{ formatCurrency(dealSummary.debtSum) }}
            </template>
            <template v-else>Осталось <strong>0 платежей</strong></template>
          </span>
          <span v-if="dealSummary.debtSum > 0 && dealSummary.leftCount" class="qp-sub-debt">
            в том числе недоплаты {{ formatCurrency(dealSummary.debtSum) }}
          </span>
        </div>
      </div>

      <div class="qp-tabs">
        <button
          type="button"
          class="qp-tab"
          :class="{ 'qp-tab--active': payTab === 'pay' }"
          @click="payTab = 'pay'"
        >
          Оплата
        </button>
        <button
          type="button"
          class="qp-tab"
          :class="{ 'qp-tab--active': payTab === 'docs' }"
          @click="payTab = 'docs'"
        >
          Документы
          <span v-if="proofPreview" class="qp-tab-dot" />
        </button>
        <!-- Комментарий к платежу: о чём договорились, чем платили, кто принёс.
             Сохраняется вместе с оплатой. -->
        <button
          type="button"
          class="qp-tab"
          :class="{ 'qp-tab--active': payTab === 'note' }"
          @click="payTab = 'note'"
        >
          Комментарий
          <span v-if="payNote.trim()" class="qp-tab-dot" />
        </button>
      </div>

      <div class="qp-body">
        <!-- Окно разбито на три смысловых шага: сколько платят → когда и куда
             легли деньги → документы. Раньше всё шло сплошным списком полей,
             и глазу не за что было зацепиться. -->
        <div v-show="payTab === 'pay'" class="qp-sect">
          <div class="qp-sect-label">Сколько платят</div>

        <!-- Сумма и режим — в одной строке: выбор «за месяц / досрочно» это по
             сути быстрая подстановка суммы, и отдельный ряд кнопок сверху
             занимал место, ничего не добавляя. -->
        <div class="mb-4">
          <div class="qp-amount-row">
            <div class="input-with-suffix qp-amount-input" :class="{ 'qp-amount-input--empty': !hasAmount }">
              <input
                :value="enteredAmount || ''"
                v-maska="CURRENCY_MASK"
                type="text"
                inputmode="numeric"
                class="field-input"
                @maska="(e: any) => enteredAmount = parseMasked(e)"
              />
              <span class="input-suffix">₽</span>
            </div>
            <div v-if="canPayEarly" class="qp-modes">
              <button
                type="button"
                class="qp-mode"
                :class="{ 'qp-mode--active': payMode === 'MONTH' }"
                :title="`За месяц — ${formatCurrency(target?.amount ?? 0)}`"
                @click="setPayMode('MONTH')"
              >
                За месяц
              </button>
              <button
                type="button"
                class="qp-mode"
                :class="{ 'qp-mode--active': payMode === 'EARLY' }"
                :title="`Досрочно — ${formatCurrency(forgiveState.outstandingNet)}`"
                @click="setPayMode('EARLY')"
              >
                Досрочно
              </button>
            </div>
          </div>
          <div v-if="!hasAmount" class="qp-delta qp-delta--empty">
            Введите сумму оплаты
          </div>
          <div v-else-if="shortfall > 0" class="qp-delta qp-delta--under">
            Меньше {{ payMode === 'EARLY' ? 'остатка' : 'плановой' }} на {{ formatCurrency(shortfall) }}
          </div>
          <div v-else-if="overpay > 0 && hasAmount" class="qp-delta qp-delta--over">
            <!-- В досрочном режиме сумма уже покрывает весь договор: писать
                 «уйдёт в счёт следующих платежей» нельзя — следующих нет. -->
            <template v-if="payMode === 'EARLY'">
              Больше остатка по договору на {{ formatCurrency(overpay) }} — договор закроется,
              лишнее платить не нужно
            </template>
            <!-- Денег хватает на весь остаток договора: «пойдёт в счёт
                 следующих платежей» тут врёт — следующих не останется. -->
            <template v-else-if="earlyClose.willClose">
              Сделка будет закрыта досрочно<template v-if="earlyClose.excess">
                — переплата {{ formatCurrency(earlyClose.excess) }}</template>
            </template>
            <template v-else-if="openRows.length">
              Больше на {{ formatCurrency(overpay) }} — пойдёт в счёт следующих платежей
            </template>
            <template v-else>
              Больше остатка на {{ formatCurrency(overpay) }} — это последний платёж по договору
            </template>
          </div>
        </div>

        <!-- Недостача при досрочном погашении: перенести в график или простить -->
        <div v-if="shortfall > 0 && payMode === 'EARLY'" class="qp-short mb-4">
          <template v-if="canForgive">
            <div class="qp-short-head">Недостающие {{ formatCurrency(shortfall) }}</div>
            <div class="qp-short-opts">
              <button
                type="button"
                class="qp-short-opt"
                :class="{ 'qp-short-opt--active': shortfallAction === 'REDISTRIBUTE' }"
                @click="shortfallAction = 'REDISTRIBUTE'"
              >
                Оставить в графике
              </button>
              <button
                type="button"
                class="qp-short-opt"
                :class="{ 'qp-short-opt--active': shortfallAction === 'FORGIVE' }"
                @click="shortfallAction = 'FORGIVE'"
              >
                Простить
              </button>
            </div>
          </template>
          <div v-else class="qp-short-head">
            Недостающие {{ formatCurrency(shortfall) }} останутся в графике
          </div>
        </div>

        <!-- Как пересчитать график. Показываем всегда, когда пересчёт реально
             произойдёт: партнёр должен решать сам, а не получать равномерное
             размазывание по умолчанию. -->
        <!-- Когда денег хватает на весь остаток, выбирать нечего: график
             закроется целиком при любом варианте. -->
        <!-- Недоплату можно и не раскладывать: «Оставить как долг» — рядом с
             вариантами раскладки, выбор один на всё. -->
        <!-- `tail.applicable` держит блок и в досрочном режиме: там долгом
             оставить нельзя, и без «Дописать платёж» выбора не осталось бы
             вовсе, а подтверждение заблокировано. -->
        <div
          v-if="(applyRedistribute && outstanding > 0) || canLeaveDebt || tail.applicable"
          class="qp-short mb-4"
        >
          <div class="qp-short-head">
            {{
              overpay > 0
                ? 'Как зачесть внесённые деньги'
                : `Что сделать с недостающими ${formatCurrency(shortfall)}`
            }}
          </div>
          <div class="qp-short-opts">
            <template v-if="openRows.length && outstanding > 0">
              <button
                v-for="m in REDIST_MODES"
                :key="m.key"
                type="button"
                class="qp-short-opt"
                :class="{ 'qp-short-opt--active': !debtChosen && redistributeMode === m.key }"
                @click="pickMode(m.key)"
              >{{ m.label }}</button>
            </template>
            <!-- Последняя строка графика: разложить некуда — дописать платёж
                 или оставить долгом. -->
            <button
              v-else-if="tail.applicable"
              type="button"
              class="qp-short-opt"
              :class="{ 'qp-short-opt--active': !debtChosen && createTailPayment }"
              @click="pickTail"
            >Дописать платёж</button>
            <button
              v-if="canLeaveDebt"
              type="button"
              class="qp-short-opt qp-short-opt--debt"
              :class="{ 'qp-short-opt--active': debtChosen }"
              @click="pickDebt"
            >Оставить как долг</button>
          </div>

          <!-- Долг: график не меняется, долг виден по этому платежу -->
          <template v-if="debtChosen">
            <div class="qp-mode-hint">
              {{ formatCurrency(shortfall) }} останутся долгом за этот месяц — он виден в графике,
              остальные платежи не изменятся. В «Должники» клиент попадёт по порогам раздела,
              а если это последний платёж — при любой сумме.
            </div>
            <div class="qp-debt-fields">
              <div class="qp-debt-field">
                <label class="field-label">
                  Обещал доплатить <span class="qp-sect-note">необязательно</span>
                </label>
                <DateField v-model="debtPromisedDate" :min="todayYmd" plain />
                <div v-if="!debtPromisedDate" class="qp-debt-nodate">
                  Без даты — «обещал оплатить, дата пока не указана»
                </div>
              </div>
              <div class="qp-debt-field">
                <label class="field-label">
                  Комментарий <span class="qp-sect-note">необязательно</span>
                </label>
                <textarea
                  v-model="debtNote"
                  class="field-input qp-debt-note"
                  rows="2"
                  maxlength="2000"
                  placeholder="Например: доплатит после зарплаты"
                />
              </div>
            </div>
          </template>

          <div v-else-if="openRows.length && outstanding > 0" class="qp-mode-hint">{{ modeHint }}</div>
          <div v-else-if="tail.applicable" class="qp-mode-hint">
            <template v-if="createTailPayment">
              Появится платёж на {{ formatCurrency(tail.deficit) }} с датой {{ shortDate(tail.suggestedDate) }}.
            </template>
            <template v-else>
              Это последняя строка графика: разложить недостачу некуда. Выберите «Дописать
              платёж» или «Оставить как долг» — иначе {{ formatCurrency(tail.deficit) }}
              повиснут без платежа.
            </template>
          </div>

          <!-- Ручные суммы: тот же порядок работы, что в основном окне оплаты -->
          <template v-if="!debtChosen && openRows.length && outstanding > 0 && redistributeMode === 'MANUAL'">
            <div v-if="preview.error" class="qp-manual-error">{{ preview.error }}</div>
            <div class="qp-manual-list">
              <div v-for="row in openRows" :key="row.id" class="qp-manual-row">
                <span class="qp-manual-no">№{{ row.number }}</span>
                <span class="qp-manual-old">{{ formatCurrency(row.amount) }}</span>
                <v-icon icon="mdi-arrow-right" size="13" class="qp-manual-arrow" />
                <div class="qp-manual-input">
                  <input
                    :value="manualSchedule[row.id] ?? 0"
                    type="text"
                    inputmode="numeric"
                    class="qp-manual-field"
                    @input="(e: any) => manualSchedule[row.id] = Math.max(0, Math.round(Number(String(e.target.value).replace(/\D/g, '')) || 0))"
                  />
                  <span class="qp-manual-suffix">₽</span>
                </div>
              </div>
            </div>
            <div class="qp-manual-total" :class="{ 'qp-manual-total--bad': manualSum !== outstanding }">
              <span>Распределено</span>
              <span>{{ formatCurrency(manualSum) }} / {{ formatCurrency(outstanding) }}</span>
            </div>
          </template>
        </div>

        <!-- Прощение: сколько и чем это оплачивается -->
        <div v-if="forgiving" class="qp-forgive mb-4">
          <v-icon icon="mdi-hand-heart-outline" size="18" class="flex-shrink-0 mt-1" />
          <div>
            <div class="qp-forgive-title">Будет прощено {{ formatCurrency(forgiveState.forgiven) }}</div>
            <div v-if="forgiveState.exceedsIncome" class="qp-forgive-bad">
              Это больше заработка по сделке ({{ formatCurrency(forgiveState.maxForgivable) }}).
              Прощается только заработок — закупку клиент возвращает полностью.
              Минимальная сумма к оплате — {{ formatCurrency(forgiveState.minAllowedAmount) }}.
            </div>
            <div v-else class="qp-forgive-text">
              Доход по сделке уменьшится на эту сумму, сделка будет завершена.
              Инвесторам начисляется доля от фактически поступивших денег —
              прощение уменьшит и ваш доход, и их начисления.
            </div>
          </div>
        </div>

        <!-- Недоплаты прошлых месяцев: закрывать их сейчас или оставить.
             Когда впереди нет обычных платежей, выбирать не из чего — платить
             всё равно нечего, кроме недоплат, и переключатель только сбивал:
             снятый, он обнулял сумму, ничего при этом не исключая. -->
        <label
          v-if="debtRows.length && hasPlannedOpen && payMode === 'MONTH' && !forgiving"
          class="qp-cover mb-4"
        >
          <input v-model="includeDebts" type="checkbox" class="qp-cover-cb" />
          <span>
            <strong>Учитывать недоплаты — {{ formatCurrency(debtRowsSum) }}</strong>
            <span class="qp-cover-hint">
              <template v-if="includeDebts">
                Старый долг закрывается первым: недоплаты стоят в начале очереди.
              </template>
              <template v-else>
                Недоплаты останутся висеть, оплата идёт с ближайшего планового платежа.
              </template>
            </span>
          </span>
        </label>

        <!-- Живой график: видно, каким станет расписание.
             По умолчанию свёрнут — в большинстве случаев человек просто
             отмечает оплату, а раскрытый график занимал почти всё окно. -->
        <div v-if="scheduleLoading" class="qp-loading mb-4">
          <v-progress-circular indeterminate size="20" width="2" />
          <span>Загружаем график…</span>
        </div>
        <div v-else-if="target && schedule.length" class="qp-schedule mb-4">
          <!-- Раскрытие графика раньше подписывалось бледной строчкой и не
               читалось как кнопка. Теперь это явное действие с фоном. -->
          <button class="qp-schedule-toggle" @click="scheduleOpen = !scheduleOpen">
            <v-icon icon="mdi-calendar-check-outline" size="17" />
            <span class="qp-schedule-title">График платежей</span>
            <span class="qp-schedule-action">
              {{ scheduleOpen ? 'Скрыть график' : 'Открыть график' }}
              <v-icon :icon="scheduleOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
            </span>
          </button>
          <PaymentSchedulePreview
            v-if="scheduleOpen"
            class="mt-3"
            :schedule="schedule"
            :target-id="target.id"
            :entered="enteredAmount"
            :preview="preview"
            :forgive="forgivingValid"
            :redistributing="applyRedistribute"
            :debt="debtChosen ? shortfall : 0"
            :selected="selectedIds"
            :pickable="pickableIds"
            :queue="pickSchedule.map((p) => p.id)"
            :selectable="payMode === 'MONTH' && !forgiving"
            @toggle="toggleRow"
          />
          <!-- Итог живёт в подвале этого же блока и виден всегда — и когда
               график свёрнут, и когда раскрыт: это ответ на главный вопрос
               окна, ради него график и открывают. -->
          <div class="qp-after">
            <span>После оплаты останется</span>
            <strong>{{ formatCurrency(remainingAfter) }}</strong>
          </div>
        </div>

        <!-- Дописать платёж на остаток: график кончился раньше долга. Когда
             недоплату можно оставить долгом, этот выбор — кнопкой в блоке
             выше, рядом с «Оставить как долг». -->
        <div v-if="tail.applicable && !canLeaveDebt" class="qp-tail mb-4">
          <label class="qp-tail-row">
            <input v-model="createTailPayment" type="checkbox" class="qp-tail-cb" />
            <span>
              <strong>Создать платёж на {{ formatCurrency(tail.deficit) }}</strong>
              — это последняя строка графика, остаток без неё повиснет.
              Дата: {{ shortDate(tail.suggestedDate) }}.
            </span>
          </label>
        </div>

        <div v-if="earlyClose.willClose && !forgivingValid" class="qp-close-note mb-4">
          <v-icon icon="mdi-flag-checkered" size="16" />
          <span>
            Сделка будет закрыта досрочно: оставшиеся {{ earlyClose.count }} закроются.
            <template v-if="earlyClose.excess > 0">Переплата {{ formatCurrency(earlyClose.excess) }}.</template>
          </span>
        </div>

        </div>

        <div v-show="payTab === 'pay'" class="qp-sect qp-sect--last">
          <div class="qp-sect-label">Когда и куда</div>

        <!-- Куда легли деньги и когда их получили — два отдельных вопроса,
             поэтому каждый в своей рамке: подряд идущие поля читались как
             один сплошной блок, и было неясно, что к чему относится. -->
        <!-- Рамка на самом компоненте, а не обёрткой: у партнёра без счетов он
             не рендерится вовсе, и пустая рамка висела бы просто так. -->
        <PaymentSourcePicker
          v-model="accountId"
          v-model:allocations="allocations"
          :total="enteredAmount ?? target?.amount ?? 0"
          :cash-box-id="target?.deal?.cashBoxId ?? null"
          class="qp-field mb-3"
        />

        <!-- Дата оплаты -->
        <div class="qp-field">
          <label class="field-label">Когда получили деньги</label>
          <!-- Деньги нельзя получить завтра: будущая дата увела бы операцию в
               журнале выше сегодняшних. -->
          <!-- Недоступные дни в календаре просто неактивны: партнёр не
               выбирает дату, чтобы получить отказ. -->
          <DateField v-model="paidAt" :min="opDate.minDate.value" :max="todayYmd" plain />

          <div v-if="target" class="qp-date-presets mt-2">
            <!-- «В срок» прячем при досрочном приёме: плановая дата ещё не
                 наступила, оплатить тем числом невозможно. -->
            <button
              v-if="money.toDateInput(target.dueDate) <= todayYmd && (!opDate.minDate.value || money.toDateInput(target.dueDate) >= opDate.minDate.value)"
              type="button"
              class="qp-date-preset"
              :class="{ 'qp-date-preset--active': paidAt === money.toDateInput(target.dueDate) }"
              @click="paidAt = money.toDateInput(target.dueDate)"
            >
              <v-icon icon="mdi-calendar-check" size="13" />
              В срок ({{ shortDate(target.dueDate) }})
            </button>
            <button
              type="button"
              class="qp-date-preset"
              :class="{ 'qp-date-preset--active': paidAt === todayYmd }"
              @click="paidAt = todayYmd"
            >
              <v-icon icon="mdi-calendar-today" size="13" />
              Сегодня
            </button>
          </div>

          <div
            v-if="target && paidAt && new Date(paidAt) > new Date(target.dueDate)"
            class="qp-late mt-1"
          >
            Оплата с задержкой — повлияет на рейтинг клиента
          </div>

          <div v-if="offMonth" class="qp-offmonth mt-2">
            <v-icon icon="mdi-information-outline" size="15" />
            <span>
              Доход учтётся в аналитике за <strong>{{ offMonth.paidLabel }}</strong> —
              в месяце фактической оплаты (плановый срок — в {{ offMonth.dueLabel }}).
            </span>
          </div>
        </div>

        </div>

        <!-- Документы держим смонтированными: скриншот, выбранный до перехода
             на оплату, не должен теряться при переключении вкладок. -->
        <div v-show="payTab === 'note'" class="qp-sect qp-sect--last">
          <div class="qp-sect-label">
            Комментарий к платежу <span class="qp-sect-note">необязательно</span>
          </div>
          <textarea
            v-model="payNote"
            class="field-input qp-note-input"
            rows="4"
            maxlength="2000"
            placeholder="Например: принёс наличными в офис, остаток обещал в пятницу"
          />
          <div class="qp-note-hint">
            Виден только вам и вашим сотрудникам. Потом его можно поправить в карточке платежа.
          </div>
        </div>

        <div v-show="payTab === 'docs'" class="qp-sect qp-sect--last">
          <div class="qp-sect-label">Квитанция и скриншот <span class="qp-sect-note">необязательно</span></div>

        <!-- Квитанция — то же оформление, что в основном окне отметки оплаты:
             два окна оплаты должны выглядеть одинаково. -->
        <div class="mb-4">
          <div class="receipt-row">
            <button
              class="receipt-btn"
              :disabled="!target || !deal"
              @click="target && deal && printReceipt()"
            >
              <v-icon icon="mdi-file-document-outline" size="18" />
              <div class="receipt-btn-text">
                <span class="receipt-btn-title">Квитанция об оплате</span>
                <span class="receipt-btn-sub">Скачать PDF</span>
              </div>
              <v-icon icon="mdi-download" size="16" class="receipt-btn-arrow" />
            </button>
            <button
              v-if="sections.visible('whatsapp')"
              class="receipt-wa-btn"
              :disabled="sendingWhatsApp || !target"
              title="Отправить квитанцию клиенту в WhatsApp"
              @click="target && sendReceiptWhatsApp(target)"
            >
              <v-icon icon="mdi-whatsapp" size="18" />
            </button>
          </div>
        </div>

        <!-- Скриншот оплаты -->
        <div class="mb-2">
          <label class="field-label">Скриншот оплаты</label>
          <div v-if="proofPreview" class="proof-preview-wrap">
            <img :src="proofPreview" class="proof-preview-img" />
            <button class="proof-preview-remove" @click="removeProof">
              <v-icon icon="mdi-close" size="14" />
            </button>
          </div>
          <button v-else class="proof-upload-btn" @click="proofInputRef?.click()">
            <v-icon icon="mdi-camera-plus-outline" size="20" />
            <span>Прикрепить скриншот</span>
          </button>
          <input ref="proofInputRef" type="file" accept="image/*" style="display: none;" @change="onProofSelected" />
        </div>
        </div>
      </div>

      <!-- Причина блокировки — у самой кнопки: блок выбора легко уходит за
           прокрутку, и «Подтвердить» выглядел бы просто сломанным. -->
      <div v-if="shortfallUnhandled" class="qp-block-note">
        Выберите, что делать с {{ formatCurrency(tail.deficit) }}: «Дописать платёж»
        или «Оставить как долг»
      </div>
      <div class="qp-actions">
        <button class="btn-secondary flex-grow-1" @click="open = false">Отмена</button>
        <button class="btn-primary flex-grow-1" :disabled="confirmDisabled" @click="confirm_">
          <v-progress-circular v-if="submitting" indeterminate size="18" width="2" />
          <span v-else>{{
            forgiving ? 'Принять и простить остаток' : debtChosen ? 'Принять, остаток — в долг' : 'Подтвердить оплату'
          }}</span>
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Почему кнопка подтверждения заблокирована — читается у самой кнопки. */
.qp-block-note {
  margin: 0 24px 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(217, 119, 6, 0.1);
  color: #b45309;
  font-size: 12px;
  line-height: 1.45;
}

/* Две вкладки вместо одного длинного списка: документы нужны не каждый раз,
   а занимали столько же места, сколько сама оплата. */
.qp-tabs {
  display: flex;
  gap: 4px;
  padding: 0 24px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.qp-tab {
  position: relative;
  padding: 11px 4px;
  margin-right: 18px;
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  cursor: pointer;
  transition: color 0.15s;
}
.qp-tab:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.qp-tab--active {
  color: #047857;
  box-shadow: inset 0 -2px 0 #047857;
}
/* Точка у вкладки: скриншот прикреплён, но вкладка закрыта. */
.qp-tab-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #047857;
  margin-left: 6px;
  vertical-align: middle;
}

/* Каждый вопрос секции — в своей рамке: «куда легли деньги» и «когда получили»
   стояли подряд и читались как один сплошной блок полей. */
.qp-field {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.015);
  padding: 12px 14px;
}

/* Три смысловых шага вместо сплошного списка полей: сколько → когда и куда →
   документы. Секции разделены линией, у каждой своя подпись. */
.qp-sect {
  padding: 16px 24px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.qp-sect--last {
  border-bottom: none;
}
.qp-sect-label {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 10px;
}
.qp-sect-note {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.32);
  margin-left: 5px;
}

/* Сумма и режим одной строкой: кнопки лишь подставляют сумму в поле, отдельный
   ряд сверху занимал место, ничего не добавляя. */
.qp-amount-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.qp-amount-input {
  flex: 1;
  min-width: 0;
}
/* Пустое поле подсвечиваем: без суммы подтвердить оплату всё равно нельзя. */
.qp-amount-input--empty .field-input { border-color: rgba(220, 38, 38, 0.5); }
.qp-modes {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.qp-mode {
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.qp-mode:hover {
  border-color: rgba(4, 120, 87, 0.3);
  color: #047857;
}
.qp-mode--active {
  border-color: #047857;
  background: rgba(4, 120, 87, 0.08);
  color: #047857;
}

/* Сворачиваемый график: раскрытым он занимает почти всё окно, поэтому по
   умолчанию свёрнут — и тем заметнее должен быть способ его раскрыть. */
.qp-schedule {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
  padding: 10px 12px;
  transition: border-color 0.15s, background 0.15s;
}
.qp-schedule:hover { border-color: rgba(4, 120, 87, 0.35); }
.qp-schedule-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  padding: 2px 0;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.qp-schedule-title {
  font-size: 13px;
  font-weight: 600;
}
/* Явное действие вместо бледной подписи: раньше «посмотреть, каким станет»
   читалось как пояснение, и график никто не раскрывал. */
.qp-schedule-action {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(4, 120, 87, 0.09);
  color: #047857;
  font-size: 12.5px; font-weight: 600;
  white-space: nowrap;
  transition: background 0.15s;
}
.qp-schedule-toggle:hover .qp-schedule-action { background: rgba(4, 120, 87, 0.18); }

/* Квитанция и скриншот — правила из основного окна отметки оплаты: два окна
   оплаты должны выглядеть одинаково. Там они в scoped-стилях, поэтому
   продублированы дословно. */
.receipt-row { display: flex; gap: 8px; }
.receipt-btn {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 12px 16px; border-radius: 12px;
  border: 1px solid rgba(4, 120, 87, 0.15);
  background: rgba(4, 120, 87, 0.04);
  cursor: pointer; transition: all 0.15s; text-align: left;
  color: #047857;
}
.receipt-btn:hover:not(:disabled) {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.25);
}
.receipt-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.receipt-btn-text { flex: 1; display: flex; flex-direction: column; }
.receipt-btn-title { font-size: 13px; font-weight: 600; }
.receipt-btn-sub { font-size: 11px; color: rgba(4, 120, 87, 0.6); }
.receipt-btn-arrow { color: rgba(4, 120, 87, 0.4); }
.receipt-wa-btn {
  width: 48px; border-radius: 12px;
  border: 1px solid rgba(37, 211, 102, 0.25);
  background: rgba(37, 211, 102, 0.06);
  color: #25d366;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.receipt-wa-btn:hover:not(:disabled) {
  background: rgba(37, 211, 102, 0.12);
  border-color: rgba(37, 211, 102, 0.35);
}
.receipt-wa-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.proof-upload-btn {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 14px; border-radius: 10px;
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  justify-content: center;
}
.proof-upload-btn:hover {
  border-color: rgba(4, 120, 87, 0.3);
  color: #047857;
  background: rgba(4, 120, 87, 0.04);
}
.proof-preview-wrap { position: relative; display: inline-block; }
.proof-preview-img {
  max-width: 100%; max-height: 160px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  display: block;
}
.proof-preview-remove {
  position: absolute; top: 6px; right: 6px;
  width: 24px; height: 24px; border-radius: 6px; border: none;
  background: rgba(0, 0, 0, 0.6); color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.proof-preview-remove:hover { background: rgba(239, 68, 68, 0.9); }

/* Поля, кнопки и крестик — те же, что в основном окне отметки оплаты. Там они
   лежат в scoped-стилях компонента, поэтому сюда не попадают: два окна оплаты
   должны выглядеть одинаково, и правила продублированы дословно. */
/* Крестик лежит поверх зелёной шапки — светлый, иначе тонет в фоне. */
.dialog-close-sm {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
  z-index: 1;
}
.dialog-close-sm:hover { background: rgba(255, 255, 255, 0.28); }
.field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.field-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none; resize: vertical;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: border-color 0.15s;
}
.field-input:focus { border-color: #047857; }
.input-with-suffix { position: relative; }
.input-with-suffix .field-input { padding-right: 36px; }
.input-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}
.btn-primary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #065f46; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

.qp-card { display: flex; flex-direction: column; max-height: 88vh; width: 100%; min-width: 0; }
.qp-card--full { max-height: 100%; height: 100%; }
/* Шапка на фирменном зелёном: раньше окно было сплошной белой простынёй, и
   заголовок со сводкой сливались с формой под ними. Градиент — по диагонали,
   от основного зелёного к тёмному, чтобы белый текст читался на всей ширине. */
.qp-head {
  /* Справа место под крестик — иначе длинный заголовок уезжает под него. */
  padding: 20px 56px 16px 24px;
  background: linear-gradient(135deg, #047857 0%, #065f46 58%, #064e3b 100%);
  color: #fff;
}
.qp-title {
  font-size: 17px; font-weight: 700;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  color: #fff;
}
/* Просрочка обязана остаться тревожной и на зелёном — сохраняем красный,
   но плотный: полупрозрачный на тёмном фоне выцветал. */
.qp-overdue {
  font-size: 11.5px; font-weight: 600;
  color: #fff; background: rgba(239, 68, 68, 0.9);
  padding: 2px 8px; border-radius: 6px;
}
.qp-sub {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px 14px;
  font-size: 13px; color: rgba(255, 255, 255, 0.72); margin-top: 5px;
}
.qp-sub strong { color: #fff; font-weight: 600; }
.qp-sub-debt {
  font-size: 12px; font-weight: 600; color: #fde68a;
  background: rgba(255, 255, 255, 0.14);
  padding: 2px 8px; border-radius: 6px;
}
/* Подвал блока графика: подпись слева, сумма справа, отделены чертой — это
   итоговая строка, а не ещё один пункт списка. */
.qp-after {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.qp-after strong {
  font-size: 16px; font-weight: 700;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}
/* Отступ живёт в секциях, а не в теле окна: иначе разделители не доходят до
   краёв и выглядят обрубленными. */
.qp-body { padding: 0 0 4px; overflow-y: auto; overflow-x: hidden; flex: 1; min-width: 0; }
.qp-actions {
  display: flex; gap: 12px;
  padding: 14px 24px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

/* Комментарий к платежу: поле во всю ширину секции, тянется по вертикали. */
.qp-note-input {
  width: 100%;
  resize: vertical;
  font-family: inherit;
  line-height: 1.45;
}
.qp-note-hint {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.qp-delta { font-size: 12px; margin-top: 5px; }
.qp-delta--under { color: #d97706; }
.qp-delta--empty { color: #dc2626; }
.qp-delta--over { color: #10b981; }

.qp-short {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px; padding: 10px 12px;
}
.qp-short-head {
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 8px;
}
.qp-short-opts { display: flex; gap: 6px; flex-wrap: wrap; }
.qp-short-opt {
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  font-size: 12.5px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.12s;
}
.qp-short-opt--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

/* Долг — янтарный, как недоплата и просрочка: это не раскладка графика, а
   деньги, которые клиент остался должен. */
.qp-short-opt--debt.qp-short-opt--active {
  border-color: #d97706;
  background: rgba(217, 119, 6, 0.08);
  color: #b45309;
}

.qp-mode-hint {
  font-size: 11.5px; margin-top: 7px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.qp-cover {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(217, 119, 6, 0.28);
  background: rgba(217, 119, 6, 0.05);
  font-size: 13px; line-height: 1.45; cursor: pointer;
}
.qp-cover-cb { margin-top: 2px; accent-color: #b45309; width: 16px; height: 16px; flex-shrink: 0; }
.qp-cover-hint {
  display: block; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.qp-debt-fields {
  display: flex; flex-direction: column; gap: 10px;
  margin-top: 10px;
}
.qp-debt-nodate {
  font-size: 11.5px; margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.qp-debt-note {
  resize: vertical;
  min-height: 56px;
  font-family: inherit;
}
.qp-manual-error {
  font-size: 11.5px; color: #dc2626; margin-top: 8px;
}
.qp-manual-list { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.qp-manual-row {
  display: grid;
  grid-template-columns: auto 1fr auto minmax(0, 110px);
  align-items: center; gap: 8px;
  font-size: 12.5px;
}
.qp-manual-no { color: rgba(var(--v-theme-on-surface), 0.45); }
.qp-manual-old {
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-decoration: line-through; white-space: nowrap;
}
.qp-manual-arrow { color: rgba(var(--v-theme-on-surface), 0.3); }
.qp-manual-input { position: relative; }
.qp-manual-field {
  width: 100%; padding: 5px 24px 5px 8px; border-radius: 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  font-size: 12.5px; outline: none; text-align: right;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.qp-manual-field:focus { border-color: #047857; }
.qp-manual-suffix {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}
.qp-manual-total {
  display: flex; justify-content: space-between;
  margin-top: 8px; padding-top: 8px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.qp-manual-total--bad { color: #dc2626; }

.qp-forgive {
  display: flex; gap: 10px;
  border: 1px solid rgba(4, 120, 87, 0.25);
  background: rgba(4, 120, 87, 0.05);
  border-radius: 10px; padding: 10px 12px;
  color: #047857;
}
.qp-forgive-title { font-size: 13px; font-weight: 700; }
.qp-forgive-text {
  font-size: 12px; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.qp-forgive-bad { font-size: 12px; margin-top: 2px; color: #dc2626; font-weight: 500; }

.qp-loading {
  display: flex; align-items: center; gap: 10px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55);
  padding: 14px 0;
}
.qp-close-note {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 12.5px; color: #0369a1;
  background: rgba(14, 165, 233, 0.07);
  border-radius: 10px; padding: 9px 12px;
}
.qp-offmonth {
  display: flex; align-items: flex-start; gap: 7px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6);
}

.qp-tail {
  border: 1px solid rgba(4, 120, 87, 0.25);
  background: rgba(4, 120, 87, 0.05);
  border-radius: 10px; padding: 10px 12px;
}
.qp-tail-row {
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 12.5px; cursor: pointer; user-select: none;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.qp-tail-cb {
  margin-top: 2px; width: 16px; height: 16px;
  accent-color: #047857; cursor: pointer; flex-shrink: 0;
}
.qp-date-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.qp-date-preset {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.12s;
}
.qp-date-preset:hover { border-color: rgba(var(--v-theme-primary), 0.4); }
.qp-date-preset--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.qp-late { font-size: 12px; color: #d97706; }

.qp-extras { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.qp-extra-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  font-size: 12.5px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.12s;
}
.qp-extra-btn:hover:not(:disabled) { border-color: rgba(var(--v-theme-primary), 0.4); color: rgb(var(--v-theme-primary)); }
.qp-extra-btn:disabled { opacity: 0.5; cursor: default; }
.qp-proof { position: relative; }
.qp-proof-img { height: 34px; border-radius: 6px; display: block; }
.qp-proof-remove {
  position: absolute; top: -6px; right: -6px;
  width: 18px; height: 18px; border-radius: 50%;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
</style>
