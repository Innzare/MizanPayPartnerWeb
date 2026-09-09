<script setup lang="ts">
/**
 * Быстрая оплата из строки списка сделок.
 *
 * Отличие от `MarkPaidDialog`: платёж выбирать не надо — он уже известен из
 * строки, — а весь график виден сразу и меняется на глазах по мере ввода суммы.
 * Здесь же досрочное погашение: партнёр вводит сумму меньше остатка и решает,
 * перенести недостачу в график или простить её.
 *
 * Все денежные расчёты — из общего слоя `utils/paymentMath`, того же, на
 * котором работает `MarkPaidDialog`. Два окна не могут посчитать по-разному:
 * расходиться может только оформление, что и требовалось.
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
  generateReceipt(props.deal, target.value, authStore.user || {}, {
    template: await receiptTemplate.getTemplate(),
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

const target = computed(() => props.payment)

/**
 * График сделки. В списке его нет — грузим сам.
 *
 * Пустой массив считаем «не загружен»: расчёты по нему выходят дикие, окно
 * предлагало бы дописать платёж почти на весь остаток договора.
 */
const schedule = computed<Payment[]>(() =>
  props.payment ? paymentsStore.getPaymentsForDeal(props.payment.dealId) : [],
)
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
const payTab = ref<'pay' | 'docs'>('pay')

// ── Состояние формы ─────────────────────────────────────────────────────────
type PayMode = 'MONTH' | 'EARLY'
const payMode = ref<PayMode>('MONTH')
const enteredAmount = ref<number | null>(null)
const paidAt = ref('')
const shortfallAction = ref<'REDISTRIBUTE' | 'FORGIVE'>('REDISTRIBUTE')
// «Закрыть ближайшие» по умолчанию: так деньги гасят месяцы подряд, а не
// размазываются по всему графику — этого партнёр и ждёт от досрочной оплаты.
const redistributeMode = ref<RedistributeMode>('NEXT')
const manualSchedule = ref<Record<string, number>>({})
const createTailPayment = ref(false)
const submitting = ref(false)
const proofFile = ref<File | null>(null)
/** Куда легли деньги. Пусто — сервис подставит счёт сам. */
const accountId = ref<string | null>(null)
/** Смешанная оплата: часть наличными, часть переводом. */
const allocations = ref<Array<{ accountId: string; amount: number }> | null>(null)
const proofPreview = ref('')
const proofInputRef = ref<HTMLInputElement | null>(null)

const todayYmd = computed(() => money.toDateInput(new Date()))

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
    enteredAmount.value = Math.round(props.payment.amount)
    paidAt.value = todayYmd.value
    shortfallAction.value = 'REDISTRIBUTE'
    redistributeMode.value = 'NEXT'
    manualSchedule.value = {}
    createTailPayment.value = false
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

/** Остаток к распределению по графику (то же, что считает сервер). */
const outstanding = computed(() =>
  props.deal && target.value
    ? money.outstandingAfter(props.deal, schedule.value, target.value.id, enteredAmount.value ?? 0)
    : 0,
)

/** Сколько ждали по этой строке или по остатку — зависит от режима. */
const expected = computed(() =>
  payMode.value === 'EARLY' ? forgiveState.value.outstandingNet : Math.round(target.value?.amount ?? 0),
)

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

/** Перерасчёт применяется, когда сумма ≠ плановой и есть что распределять. */
const applyRedistribute = computed(() => {
  if (forgiving.value) return false
  const entered = enteredAmount.value
  const t = target.value
  if (!entered || !t) return false
  return openRows.value.length > 0 && Math.round(entered) !== Math.round(t.amount)
})

const preview = computed(() =>
  money.redistPreview(
    openRows.value,
    outstanding.value,
    redistributeMode.value,
    manualSchedule.value,
  ),
)

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

function pickMode(m: RedistributeMode) {
  redistributeMode.value = m
  // В «Вручную» заполняем поля равномерным вариантом — понятная точка отсчёта.
  if (m === 'MANUAL') manualSchedule.value = money.equalSplitMap(openRows.value, outstanding.value)
}

/** Переключение режима подставляет ожидаемую сумму — иначе поле врёт. */
function setPayMode(m: PayMode) {
  if (m === payMode.value) return
  payMode.value = m
  shortfallAction.value = 'REDISTRIBUTE'
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
  const blob = (await generateReceipt(props.deal, payment, investor, { returnBlob: true, template: await receiptTemplate.getTemplate() })) as Blob
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

const confirmDisabled = computed(
  () =>
    submitting.value ||
    !enteredAmount.value ||
    enteredAmount.value <= 0 ||
    forgiveBlocked.value ||
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
      mode: redistributeMode.value,
      manualMap: manualSchedule.value,
      rows: openRows.value,
      applyRedistribute: applyRedistribute.value,
      payMode: payMode.value,
      // Прощение отправляем только когда оно реально применяется: на сервере
      // FORGIVE допустим лишь в досрочном режиме и при недоплате.
      shortfallAction: forgiving.value ? 'FORGIVE' : 'REDISTRIBUTE',
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
    const tailToAdd = createTailPayment.value && tail.value.applicable ? { ...tail.value } : null

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
      toast.showWithAction(`Платёж на ${formatCurrency(paidAmount ?? t.amount)} отмечен`, {
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
    :max-width="fullscreen ? undefined : 520"
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
          Платёж {{ headerMonth ? `за ${headerMonth}` : '' }}
          <span v-if="overdueDays" class="qp-overdue">просрочен на {{ overdueDays }} дн.</span>
        </div>
        <div class="qp-sub">
          {{ target.number }}-й из {{ deal?.numberOfPayments ?? '?' }} · до {{ formatDate(target.dueDate) }}
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
            <div class="input-with-suffix qp-amount-input">
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
          <div v-if="shortfall > 0" class="qp-delta qp-delta--under">
            Меньше {{ payMode === 'EARLY' ? 'остатка' : 'плановой' }} на {{ formatCurrency(shortfall) }}
          </div>
          <div v-else-if="overpay > 0" class="qp-delta qp-delta--over">
            <!-- В досрочном режиме сумма уже покрывает весь договор: писать
                 «уйдёт в счёт следующих платежей» нельзя — следующих нет. -->
            <template v-if="payMode === 'EARLY'">
              Больше остатка по договору на {{ formatCurrency(overpay) }} — договор закроется,
              лишнее платить не нужно
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
        <div v-if="applyRedistribute && outstanding > 0" class="qp-short mb-4">
          <div class="qp-short-head">
            {{ overpay > 0 ? 'Как зачесть внесённые деньги' : 'Как разложить разницу по графику' }}
          </div>
          <div class="qp-short-opts">
            <button
              v-for="m in REDIST_MODES"
              :key="m.key"
              type="button"
              class="qp-short-opt"
              :class="{ 'qp-short-opt--active': redistributeMode === m.key }"
              @click="pickMode(m.key)"
            >{{ m.label }}</button>
          </div>
          <div class="qp-mode-hint">{{ modeHint }}</div>

          <!-- Ручные суммы: тот же порядок работы, что в основном окне оплаты -->
          <template v-if="redistributeMode === 'MANUAL'">
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

        <!-- Живой график: видно, каким станет расписание.
             По умолчанию свёрнут — в большинстве случаев человек просто
             отмечает оплату, а раскрытый график занимал почти всё окно. -->
        <div v-if="scheduleLoading" class="qp-loading mb-4">
          <v-progress-circular indeterminate size="20" width="2" />
          <span>Загружаем график…</span>
        </div>
        <div v-else-if="target && schedule.length" class="qp-schedule mb-4">
          <button class="qp-schedule-toggle" @click="scheduleOpen = !scheduleOpen">
            <v-icon icon="mdi-calendar-check-outline" size="17" />
            <span class="qp-schedule-title">График платежей</span>
            <span class="qp-schedule-hint">
              {{ scheduleOpen ? 'скрыть' : 'посмотреть, каким станет' }}
            </span>
            <v-icon :icon="scheduleOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="18" />
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
          />
        </div>

        <!-- Дописать платёж на остаток: график кончился раньше долга -->
        <div v-if="tail.applicable" class="qp-tail mb-4">
          <label class="qp-tail-row">
            <input v-model="createTailPayment" type="checkbox" class="qp-tail-cb" />
            <span>
              <strong>Создать платёж на {{ formatCurrency(tail.deficit) }}</strong>
              — это последняя строка графика, остаток без неё повиснет.
              Дата: {{ shortDate(tail.suggestedDate) }}.
            </span>
          </label>
        </div>

        <!-- Итог по договору -->
        <div class="qp-total mb-4">
          <span>Остаток по договору после оплаты</span>
          <strong>{{ formatCurrency(remainingAfter) }}</strong>
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

      <div class="qp-actions">
        <button class="btn-secondary flex-grow-1" @click="open = false">Отмена</button>
        <button class="btn-primary flex-grow-1" :disabled="confirmDisabled" @click="confirm_">
          <v-progress-circular v-if="submitting" indeterminate size="18" width="2" />
          <span v-else>{{ forgiving ? 'Принять и простить остаток' : 'Подтвердить оплату' }}</span>
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
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

/* Сворачиваемый график: раскрытым он занимал почти всё окно. */
.qp-schedule {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  padding: 10px 12px;
}
.qp-schedule-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  padding: 2px 0;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.qp-schedule-title {
  font-size: 13px;
  font-weight: 600;
}
.qp-schedule-hint {
  flex: 1;
  text-align: right;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

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
.dialog-close-sm {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
  z-index: 1;
}
.dialog-close-sm:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
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
.qp-head {
  /* Справа место под крестик — иначе длинный заголовок уезжает под него. */
  padding: 20px 56px 14px 24px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.qp-title {
  font-size: 17px; font-weight: 700;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.qp-overdue {
  font-size: 11.5px; font-weight: 600;
  color: #dc2626; background: rgba(220, 38, 38, 0.1);
  padding: 2px 8px; border-radius: 6px;
}
.qp-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 2px; }
/* Отступ живёт в секциях, а не в теле окна: иначе разделители не доходят до
   краёв и выглядят обрубленными. */
.qp-body { padding: 0 0 4px; overflow-y: auto; overflow-x: hidden; flex: 1; min-width: 0; }
.qp-actions {
  display: flex; gap: 12px;
  padding: 14px 24px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.qp-delta { font-size: 12px; margin-top: 5px; }
.qp-delta--under { color: #d97706; }
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

.qp-mode-hint {
  font-size: 11.5px; margin-top: 7px;
  color: rgba(var(--v-theme-on-surface), 0.5);
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
.qp-total {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65);
  padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.qp-total strong { font-size: 15px; color: rgba(var(--v-theme-on-surface), 0.9); }
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
