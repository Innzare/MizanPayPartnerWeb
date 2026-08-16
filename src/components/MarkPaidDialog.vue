<script setup lang="ts">
/**
 * Отметка платежа оплаченным — единая модалка для всех разделов.
 *
 * Логика перенесена со страницы сделки БЕЗ изменений: сумма, фактическая дата
 * оплаты, перерасчёт оставшихся платежей с живым превью, хвостовой платёж,
 * предупреждение о досрочном закрытии, квитанция и скриншот-подтверждение.
 * Раньше на странице платежей стояла своя урезанная модалка, и одна и та же
 * операция работала по-разному в зависимости от того, откуда её открыли.
 *
 * Компоненту нужен ВЕСЬ график сделки: без него не посчитать ни остаток, ни
 * перерасчёт. Если график не передан, компонент грузит его сам — на странице
 * платежей его в памяти нет.
 */
import { computed, ref, watch } from 'vue'
import { usePaymentsStore } from '@/stores/payments'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useSections } from '@/composables/useSections'
import { useSendPdfWhatsApp } from '@/composables/useSendPdfWhatsApp'
import { formatCurrency, formatDate, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { generateReceipt } from '@/utils/receiptPdf'
import { api } from '@/api/client'
import { redistribute, validateManual, type RedistributeMode } from '@/utils/redistribute'
import { dueYearMonth, monthPrepositional, monthAccusative } from '@/utils/paymentAttribution'
import type { Deal, Payment, User } from '@/types'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** Платёж, который отмечаем. */
    payment: Payment | null
    /** Сделка платежа — нужна для остатка, интервала и квитанции. */
    deal: Deal | null
    /** График сделки. Не передан — компонент возьмёт его из стора и догрузит. */
    schedule?: Payment[]
    fullscreen?: boolean
  }>(),
  { schedule: undefined, fullscreen: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** Платёж отмечен. Страница сама решает, что обновить. */
  (e: 'paid', dealId: string): void
}>()

const paymentsStore = usePaymentsStore()
const authStore = useAuthStore()
const toast = useToast()
const sections = useSections()
const { sendPdf, sending: sendingWhatsApp } = useSendPdfWhatsApp()

/** Телефон клиента сделки: профиль → пользователь → внешний клиент. */
function clientPhoneOnDeal(): string | null {
  const d = props.deal
  if (!d) return null
  return (d.clientProfile as any)?.phone || d.client?.phone || d.externalClientPhone || null
}

/** Спрашивает подтверждение перед отправкой в WhatsApp. */
async function confirmSend(label: string): Promise<boolean> {
  const phone = clientPhoneOnDeal()
  if (!phone) {
    toast.error('У клиента нет телефона — нельзя отправить в WhatsApp')
    return false
  }
  return confirm(`Отправить «${label}» клиенту в WhatsApp на ${phone}?`)
}

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** График: переданный или из стора (страница платежей полный набор не грузит). */
const schedule = computed<Payment[]>(() => {
  if (props.schedule) return props.schedule
  return props.payment ? paymentsStore.getPaymentsForDeal(props.payment.dealId) : []
})
const scheduleLoading = ref(false)

const target = computed(() => props.payment)

const markPaidProofFile = ref<File | null>(null)
const markPaidProofPreview = ref('')
const markPaidUploading = ref(false)
const proofInputRef = ref<HTMLInputElement | null>(null)

const markPaidAmount = ref<number | null>(null)
/** Фактическая дата оплаты. По умолчанию — сегодня. */
const markPaidPaidAt = ref('')

// `<input type="date">` ждёт YYYY-MM-DD в местном поясе, а из API приходит ISO
// со временем — отсюда тонкий конвертер.
function toDateInput(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
function formatShortDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
const todayDateInput = computed(() => toDateInput(new Date()))

// Сброс состояния при каждом открытии — иначе в модалку протекали бы суммы и
// режим от предыдущего платежа.
watch(
  () => [props.modelValue, props.payment?.id],
  async ([isOpen]) => {
    if (!isOpen || !props.payment) return
    markPaidAmount.value = Math.round(props.payment.amount)
    markPaidProofFile.value = null
    markPaidProofPreview.value = ''
    markPaidPaidAt.value = todayDateInput.value
    createTailPayment.value = false
    redistributeMode.value = 'EQUAL'
    manualSchedule.value = {}

    // График нужен для расчётов: если его нет — грузим.
    if (!props.schedule && !schedule.value.length) {
      scheduleLoading.value = true
      try {
        await paymentsStore.fetchPaymentsForDeal(props.payment.dealId)
      } catch { /* показываем модалку и без превью перерасчёта */ }
      finally { scheduleLoading.value = false }
    }
  },
  { immediate: true },
)

/**
 * Оплата этой суммой закроет сделку досрочно — партнёр должен увидеть это ДО
 * подтверждения, а не после.
 */
const earlyCloseInfo = computed(() => {
  const t = target.value
  const enteredAmount = markPaidAmount.value
  if (!t || !props.deal || !enteredAmount || enteredAmount <= 0) {
    return { willClose: false, count: 0, excess: 0 }
  }
  const balance = props.deal.totalPrice - (props.deal.downPayment || 0)
  const sumAlreadyPaid = schedule.value
    .filter((p) => p.id !== t.id && (p.status === 'PAID' || p.status === 'CLOSED_EARLY'))
    .reduce((s, p) => s + p.amount, 0)
  const otherUnpaid = schedule.value.filter(
    (p) => p.id !== t.id && (p.status === 'PENDING' || p.status === 'OVERDUE'),
  )
  const totalAfter = sumAlreadyPaid + enteredAmount
  return {
    willClose: totalAfter >= balance && otherUnpaid.length > 0,
    count: otherUnpaid.length,
    excess: Math.max(totalAfter - balance, 0),
  }
})

/**
 * Недоплата по ПОСЛЕДНЕЙ открытой строке: график кончается раньше долга.
 * Предлагаем дописать платёж на остаток, чтобы не лезть в «Добавить платёж».
 */
const tailPaymentInfo = computed(() => {
  const t = target.value
  const enteredAmount = markPaidAmount.value
  if (!t || !props.deal || !enteredAmount || enteredAmount <= 0) {
    return { applicable: false, deficit: 0, suggestedDate: '' }
  }
  const otherUnpaid = schedule.value.filter(
    (p) => p.id !== t.id && (p.status === 'PENDING' || p.status === 'OVERDUE'),
  )
  if (otherUnpaid.length > 0) return { applicable: false, deficit: 0, suggestedDate: '' }

  const balance = props.deal.totalPrice - (props.deal.downPayment || 0)
  const sumAlreadyPaid = schedule.value
    .filter((p) => p.id !== t.id && (p.status === 'PAID' || p.status === 'CLOSED_EARLY'))
    .reduce((s, p) => s + p.amount, 0)
  const deficit = Math.round(balance - sumAlreadyPaid - enteredAmount)
  if (deficit <= 0) return { applicable: false, deficit: 0, suggestedDate: '' }

  const anchor = new Date(t.dueDate)
  const interval = props.deal.paymentInterval || 'MONTHLY'
  if (interval === 'WEEKLY') anchor.setDate(anchor.getDate() + 7)
  else if (interval === 'BIWEEKLY') anchor.setDate(anchor.getDate() + 14)
  else anchor.setMonth(anchor.getMonth() + 1)
  return { applicable: true, deficit, suggestedDate: toDateInput(anchor) }
})
const createTailPayment = ref(false)

// ── Перерасчёт графика: режим + живое превью (зеркало redistribute.util) ────
const REDIST_MODES: { key: RedistributeMode; label: string; hint: string }[] = [
  { key: 'EQUAL', label: 'Равномерно', hint: 'Остаток делится поровну между оставшимися платежами' },
  { key: 'NEXT', label: 'В ближайший', hint: 'Вся разница ложится на ближайший платёж (переплата гасит его каскадом)' },
  { key: 'LAST', label: 'В последний', hint: 'Разница уходит в последний платёж' },
  { key: 'MANUAL', label: 'Вручную', hint: 'Задайте суммы сами — их сумма должна равняться остатку' },
]
const redistributeMode = ref<RedistributeMode>('EQUAL')
const manualSchedule = ref<Record<string, number>>({})

/** Открытые строки кроме целевой, по возрастанию — участники распределения. */
const redistOpenRows = computed(() => {
  const t = target.value
  if (!t) return []
  return schedule.value
    .filter((p) => p.id !== t.id && (p.status === 'PENDING' || p.status === 'OVERDUE'))
    .sort((a, b) => a.number - b.number)
    .map((p) => ({ id: p.id, number: p.number, amount: Math.round(p.amount) }))
})

/** Остаток по договору после оплаты введённой суммы (== computeOutstanding на сервере). */
const redistTarget = computed(() => {
  const t = target.value
  const entered = markPaidAmount.value
  if (!t || !props.deal || !entered) return 0
  const balance = props.deal.totalPrice - (props.deal.downPayment || 0)
  const sumAlreadyPaid = schedule.value
    .filter((p) => p.id !== t.id && (p.status === 'PAID' || p.status === 'CLOSED_EARLY'))
    .reduce((s, p) => s + p.amount, 0)
  return Math.max(Math.round(balance - sumAlreadyPaid - Math.round(entered)), 0)
})

/** Блок перерасчёта — когда есть что распределять и сумма ≠ плановой. */
const showRedistribute = computed(() => {
  const t = target.value
  const entered = markPaidAmount.value
  if (!t || !entered) return false
  return redistOpenRows.value.length > 0 && Math.round(entered) !== Math.round(t.amount)
})

const redistPreview = computed<{ rows: Array<{ id: string; amount: number }>; closedIds: string[]; error: string }>(() => {
  const rows = redistOpenRows.value
  if (!rows.length) return { rows: [], closedIds: [], error: '' }
  const mode = redistributeMode.value
  try {
    if (mode === 'MANUAL') {
      const manual = rows.map((r) => ({ paymentId: r.id, amount: Math.round(manualSchedule.value[r.id] ?? 0) }))
      const v = validateManual(rows, redistTarget.value, manual)
      if (!v.ok) return { rows: [], closedIds: [], error: v.reason }
      const res = redistribute({ rows, target: redistTarget.value, mode, manual })
      return { rows: res.rows, closedIds: res.closedIds, error: '' }
    }
    const res = redistribute({ rows, target: redistTarget.value, mode })
    return { rows: res.rows, closedIds: res.closedIds, error: '' }
  } catch (e: any) {
    return { rows: [], closedIds: [], error: e?.message || 'Ошибка расчёта' }
  }
})

function previewAmount(id: string): number | null {
  const r = redistPreview.value.rows.find((x) => x.id === id)
  return r ? r.amount : null
}
function isPreviewClosed(id: string): boolean {
  return redistPreview.value.closedIds.includes(id)
}

/** Σ ручного ввода — контроль «сходится/не сходится». */
const manualSum = computed(() =>
  redistOpenRows.value.reduce((s, r) => s + Math.round(manualSchedule.value[r.id] ?? 0), 0),
)

// При входе в «Вручную» заполняем поля из равномерного превью — понятная точка отсчёта.
watch(redistributeMode, (m) => {
  if (m === 'MANUAL') {
    try {
      const eq = redistribute({ rows: redistOpenRows.value, target: redistTarget.value, mode: 'EQUAL' })
      const map: Record<string, number> = {}
      for (const r of eq.rows) map[r.id] = r.amount
      manualSchedule.value = map
    } catch {
      manualSchedule.value = {}
    }
  }
})

/** Выбранная дата оплаты в другом месяце, чем срок → доход учтётся по факту. */
const markPaidOffMonth = computed(() => {
  const t = target.value
  if (!t || !markPaidPaidAt.value) return null
  const due = dueYearMonth(t.dueDate)
  if (!due) return null
  const [y, m] = markPaidPaidAt.value.split('-').map(Number)
  if (!y || !m) return null
  const paidY = y
  const paidM = m - 1
  if (paidY === due.year && paidM === due.month) return null
  return {
    kind: paidY * 12 + paidM < due.year * 12 + due.month ? 'early' : 'late',
    // paidLabel идёт после «за» — винительный, dueLabel после «в» — предложный.
    paidLabel: monthAccusative(paidY, paidM, due.year),
    dueLabel: monthPrepositional(due.year, due.month, paidY),
  }
})

function onProofFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (markPaidProofPreview.value) URL.revokeObjectURL(markPaidProofPreview.value)
  markPaidProofFile.value = file
  markPaidProofPreview.value = URL.createObjectURL(file)
  input.value = ''
}

function removeProofFile() {
  if (markPaidProofPreview.value) URL.revokeObjectURL(markPaidProofPreview.value)
  markPaidProofFile.value = null
  markPaidProofPreview.value = ''
}

async function sendReceiptWhatsApp(payment: Payment) {
  if (!props.deal) return
  if (!(await confirmSend(`Квитанция #${payment.number}`))) return
  const investor = (authStore.user || {}) as Partial<User>
  const blob = (await generateReceipt(props.deal, payment, investor, { returnBlob: true })) as Blob
  await sendPdf({
    blob,
    fileName: `Квитанция-${props.deal.dealNumber || props.deal.id.slice(0, 6)}-${payment.number}.pdf`,
    dealId: props.deal.id,
    caption: `Квитанция о получении платежа #${payment.number} по сделке «${props.deal.productName}».`,
  })
}

async function confirmMarkPaid() {
  const t = target.value
  if (!t) return
  markPaidUploading.value = true
  try {
    let proofScreenshot: string | undefined
    if (markPaidProofFile.value) {
      proofScreenshot = await api.upload(markPaidProofFile.value, `proofs/${t.dealId}`)
    }
    const paidAmount =
      markPaidAmount.value && markPaidAmount.value !== t.amount ? markPaidAmount.value : undefined
    // Намерение по хвостовому платежу фиксируем ДО markAsPaid: после отметки
    // график меняется, и вычисляемое значение устаревает.
    const tail = createTailPayment.value ? { ...tailPaymentInfo.value } : null
    const dealId = t.dealId
    // Режим перерасчёта шлём только если он реально применяется (сумма ≠
    // плановой и есть что распределять). «Вручную» — полным списком сумм.
    const applyRedist = showRedistribute.value && redistOpenRows.value.length > 0
    const redistributeMode_ = applyRedist ? redistributeMode.value : undefined
    const remainingSchedule =
      applyRedist && redistributeMode.value === 'MANUAL'
        ? redistOpenRows.value.map((r) => ({ paymentId: r.id, amount: Math.round(manualSchedule.value[r.id] ?? 0) }))
        : undefined

    await paymentsStore.markAsPaid(t.id, dealId, {
      amount: paidAmount,
      proofScreenshot,
      // Полдень выбранной даты: сдвиг часового пояса не должен перенести
      // сохранённую отметку на соседний день.
      paidAt: markPaidPaidAt.value
        ? new Date(`${markPaidPaidAt.value}T12:00:00`).toISOString()
        : undefined,
      redistributeMode: redistributeMode_,
      remainingSchedule,
    })

    if (tail && tail.applicable && tail.deficit > 0) {
      // Дописываем строку на остаток. Сбой здесь не отменяет уже сделанную
      // отметку, поэтому показываем отдельным сообщением.
      try {
        await paymentsStore.addPayment(dealId, {
          amount: tail.deficit,
          dueDate: new Date(`${tail.suggestedDate}T12:00:00`).toISOString(),
          note: 'Остаток после недоплат',
        })
      } catch (e: any) {
        toast.error(e.message || 'Платёж отмечен, но не удалось добавить остаток')
      }
    }

    toast.success('Платёж отмечен как оплаченный')
    open.value = false
    emit('paid', dealId)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при отметке оплаты')
  } finally {
    markPaidUploading.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="480" :fullscreen="fullscreen">
    <v-card rounded="lg" class="pa-6">
      <button class="dialog-close-sm" @click="open = false">
        <v-icon icon="mdi-close" size="18" />
      </button>

      <div class="text-h6 font-weight-bold mb-1">Отметить оплату</div>
      <div class="text-caption text-medium-emphasis mb-5">Подтвердите получение платежа</div>

      <div v-if="target" class="reschedule-info mb-5">
        <div class="d-flex justify-space-between mb-1">
          <span class="text-caption text-medium-emphasis">Платёж #{{ target.number }}</span>
          <span class="font-weight-bold">{{ formatCurrency(target.amount) }}</span>
        </div>
        <div class="d-flex justify-space-between">
          <span class="text-caption text-medium-emphasis">Дата</span>
          <span>{{ formatDate(target.dueDate) }}</span>
        </div>
      </div>

      <!-- Amount -->
      <div class="mb-5">
        <label class="field-label">Фактическая сумма оплаты</label>
        <div class="input-with-suffix">
          <input
            :value="markPaidAmount || ''"
            v-maska="CURRENCY_MASK"
            type="text"
            inputmode="numeric"
            class="field-input"
            @maska="(e: any) => markPaidAmount = parseMasked(e)"
          />
          <span class="input-suffix">₽</span>
        </div>
        <div
          v-if="target && markPaidAmount && markPaidAmount !== target.amount"
          class="text-caption mt-1"
          :style="{ color: markPaidAmount > target.amount ? '#10b981' : '#f59e0b' }"
        >
          {{ markPaidAmount > target.amount
            ? `Переплата ${formatCurrency(markPaidAmount - target.amount)} — оставшиеся платежи будут пересчитаны`
            : `Недоплата ${formatCurrency(target.amount - markPaidAmount)}` }}
        </div>
      </div>

      <!-- Перерасчёт графика: партнёр выбирает КАК распределить остаток по
           оставшимся платежам, с живым превью. -->
      <div v-if="showRedistribute" class="redist-block mb-5">
        <div class="redist-head">
          <v-icon icon="mdi-tune-variant" size="16" />
          <span>Перерасчёт оставшихся платежей</span>
        </div>

        <div class="redist-modes">
          <button
            v-for="m in REDIST_MODES"
            :key="m.key"
            type="button"
            class="redist-mode"
            :class="{ 'redist-mode--active': redistributeMode === m.key }"
            @click="redistributeMode = m.key"
          >{{ m.label }}</button>
        </div>
        <div class="redist-hint">{{ REDIST_MODES.find(m => m.key === redistributeMode)?.hint }}</div>

        <div v-if="redistributeMode === 'MANUAL' && redistPreview.error" class="redist-error">
          {{ redistPreview.error }}
        </div>

        <div class="redist-list">
          <div v-for="row in redistOpenRows" :key="row.id" class="redist-row">
            <div class="redist-row-no">№{{ row.number }}</div>

            <template v-if="redistributeMode === 'MANUAL'">
              <div class="redist-row-old">{{ formatCurrency(row.amount) }}</div>
              <v-icon icon="mdi-arrow-right" size="13" class="redist-arrow" />
              <div class="redist-manual-input">
                <input
                  :value="manualSchedule[row.id] ?? 0"
                  type="text"
                  inputmode="numeric"
                  class="redist-input"
                  @input="(e: any) => manualSchedule[row.id] = Math.max(0, Math.round(Number(String(e.target.value).replace(/\D/g, '')) || 0))"
                />
                <span class="redist-input-suffix">₽</span>
              </div>
            </template>

            <template v-else>
              <div class="redist-row-old">{{ formatCurrency(row.amount) }}</div>
              <v-icon icon="mdi-arrow-right" size="13" class="redist-arrow" />
              <div class="redist-row-new" :class="{ 'redist-row-new--closed': isPreviewClosed(row.id) }">
                <template v-if="isPreviewClosed(row.id)">закрыт</template>
                <template v-else>{{ formatCurrency(previewAmount(row.id) ?? 0) }}</template>
              </div>
            </template>
          </div>
        </div>

        <div class="redist-total" :class="{ 'redist-total--bad': redistributeMode === 'MANUAL' && manualSum !== redistTarget }">
          <span>{{ redistributeMode === 'MANUAL' ? 'Распределено' : 'Остаток по договору' }}</span>
          <span>
            {{ formatCurrency(redistributeMode === 'MANUAL' ? manualSum : redistTarget) }}
            <template v-if="redistributeMode === 'MANUAL' && manualSum !== redistTarget">
              / {{ formatCurrency(redistTarget) }}
            </template>
          </span>
        </div>
      </div>

      <!-- Фактическая дата оплаты -->
      <div class="mb-5">
        <label class="field-label">Фактическая дата оплаты</label>
        <input v-model="markPaidPaidAt" type="date" class="field-input" />

        <div v-if="target" class="paidat-presets mt-2">
          <button
            type="button"
            class="paidat-preset"
            :class="{ 'paidat-preset--active': markPaidPaidAt === toDateInput(target.dueDate) }"
            @click="markPaidPaidAt = toDateInput(target.dueDate)"
          >
            <v-icon icon="mdi-calendar-check" size="14" />
            В срок ({{ formatShortDate(target.dueDate) }})
          </button>
          <button
            type="button"
            class="paidat-preset"
            :class="{ 'paidat-preset--active': markPaidPaidAt === todayDateInput }"
            @click="markPaidPaidAt = todayDateInput"
          >
            <v-icon icon="mdi-calendar-today" size="14" />
            Сегодня
          </button>
        </div>

        <div
          v-if="target && markPaidPaidAt && new Date(markPaidPaidAt) > new Date(target.dueDate)"
          class="text-caption mt-1"
          style="color: #f59e0b;"
        >
          Оплата с задержкой — повлияет на рейтинг клиента
        </div>

        <div v-if="markPaidOffMonth" class="offmonth-hint mt-2">
          <v-icon icon="mdi-information-outline" size="15" />
          <span>
            Доход по этому платежу будет учтён в аналитике за <strong>{{ markPaidOffMonth.paidLabel }}</strong> —
            в месяце фактической оплаты (плановый срок — в {{ markPaidOffMonth.dueLabel }}).
          </span>
        </div>
      </div>

      <!-- Хвостовой платёж: это последняя открытая строка, а введённой суммы
           не хватает до остатка. -->
      <div v-if="tailPaymentInfo.applicable" class="tail-banner mb-5">
        <label class="tail-banner-row">
          <input v-model="createTailPayment" type="checkbox" class="tail-banner-cb" />
          <div class="tail-banner-text">
            <div class="tail-banner-title">
              Создать дополнительный платёж на {{ formatCurrency(tailPaymentInfo.deficit) }}
            </div>
            <div class="tail-banner-sub">
              Дата: {{ formatShortDate(tailPaymentInfo.suggestedDate) }} · по тому же интервалу
            </div>
          </div>
        </label>
      </div>

      <!-- Досрочное закрытие -->
      <div v-if="earlyCloseInfo.willClose" class="early-close-banner mb-5">
        <v-icon icon="mdi-flag-checkered" color="#0ea5e9" size="20" class="mt-1 flex-shrink-0" />
        <div>
          <div class="early-close-banner-title">Сделка будет закрыта досрочно</div>
          <div class="early-close-banner-text">
            Эта оплата покрывает остаток. Оставшиеся
            {{ earlyCloseInfo.count }}
            {{ earlyCloseInfo.count === 1 ? 'платёж' : earlyCloseInfo.count >= 2 && earlyCloseInfo.count <= 4 ? 'платежа' : 'платежей' }}
            <template v-if="earlyCloseInfo.excess > 0">
              будут закрыты досрочно. Переплата {{ formatCurrency(earlyCloseInfo.excess) }}.
            </template>
            <template v-else>
              будут закрыты досрочно.
            </template>
          </div>
        </div>
      </div>

      <!-- Квитанция -->
      <div class="mb-5">
        <div class="receipt-row">
          <button
            class="receipt-btn"
            @click="target && deal && generateReceipt(deal, target, authStore.user || {})"
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
      <div class="mb-5">
        <label class="field-label">Скриншот оплаты (необязательно)</label>
        <div v-if="markPaidProofPreview" class="proof-preview-wrap">
          <img :src="markPaidProofPreview" class="proof-preview-img" />
          <button class="proof-preview-remove" @click="removeProofFile">
            <v-icon icon="mdi-close" size="14" />
          </button>
        </div>
        <button v-else class="proof-upload-btn" @click="proofInputRef?.click()">
          <v-icon icon="mdi-camera-plus-outline" size="20" />
          <span>Прикрепить скриншот</span>
        </button>
        <input
          ref="proofInputRef"
          type="file"
          accept="image/*"
          style="display: none;"
          @change="onProofFileSelected"
        />
      </div>

      <div class="d-flex ga-3">
        <button class="btn-secondary flex-grow-1" @click="open = false">Отмена</button>
        <button
          class="btn-primary flex-grow-1"
          :disabled="markPaidUploading || (showRedistribute && redistributeMode === 'MANUAL' && !!redistPreview.error)"
          @click="confirmMarkPaid"
        >
          <v-progress-circular v-if="markPaidUploading" indeterminate size="18" width="2" />
          <span v-else>Подтвердить оплату</span>
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>
<style scoped>
/* Стили перенесены со страницы сделки без изменений: модалка должна выглядеть
   одинаково, откуда бы её ни открыли. */
.tail-banner {
  border: 1px solid rgba(4, 120, 87, 0.25);
  background: rgba(4, 120, 87, 0.05);
  border-radius: 10px;
  padding: 10px 12px;
}
.tail-banner-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
.tail-banner-cb {
  margin-top: 3px;
  width: 16px;
  height: 16px;
  accent-color: #047857;
  cursor: pointer;
  flex-shrink: 0;
}
.tail-banner-text { flex: 1; min-width: 0; }
.tail-banner-title {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.tail-banner-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 1px;
}
.paidat-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.paidat-preset {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  transition: all 0.12s;
}
.paidat-preset:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.22);
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.paidat-preset--active {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.3);
  color: #047857;
}
.dialog-close-sm {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.dialog-close-sm:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
}
.reschedule-info {
  padding: 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
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
.field-input:focus {
  border-color: #047857;
}
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
.dark .field-input {
  background: #252538;
  border-color: #2e2e42;
  color: #e4e4e7;
}
.dark .field-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .reschedule-info {
  background: #1e1e2e;
  border-color: #2e2e42;
}
.receipt-row { display: flex; align-items: stretch; gap: 6px; }
.receipt-row .receipt-btn { flex: 1; }
.receipt-wa-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 48px; flex-shrink: 0;
  padding: 0 10px; border-radius: 12px;
  border: 1px solid rgba(37, 211, 102, 0.20);
  background: rgba(37, 211, 102, 0.06);
  color: #25d366;
  cursor: pointer; transition: all 0.15s;
}
.receipt-wa-btn:hover:not(:disabled) {
  background: rgba(37, 211, 102, 0.12);
  border-color: rgba(37, 211, 102, 0.35);
}
.receipt-wa-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.receipt-btn {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 12px 16px; border-radius: 12px;
  border: 1px solid rgba(4, 120, 87, 0.15);
  background: rgba(4, 120, 87, 0.04);
  cursor: pointer; transition: all 0.15s; text-align: left;
  color: #047857;
}
.receipt-btn:hover {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.25);
}
.receipt-btn-text { flex: 1; display: flex; flex-direction: column; }
.receipt-btn-title { font-size: 13px; font-weight: 600; }
.receipt-btn-sub { font-size: 11px; color: rgba(4, 120, 87, 0.6); }
.receipt-btn-arrow { color: rgba(4, 120, 87, 0.4); }
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
.proof-preview-wrap {
  position: relative; display: inline-block;
}
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
.proof-preview-remove:hover {
  background: rgba(239, 68, 68, 0.9);
}
.early-close-banner {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(14, 165, 233, 0.08);
  border: 1px solid rgba(14, 165, 233, 0.25);
  border-radius: 10px;
}
.early-close-banner-title {
  font-weight: 600;
  font-size: 13px;
  color: #0ea5e9;
  margin-bottom: 2px;
}
.early-close-banner-text {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.75);
  line-height: 1.4;
}
.redist-block {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  padding: 14px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.redist-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 10px;
}
.redist-modes {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;
}
.redist-mode {
  padding: 8px 10px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 12.5px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.65);
  cursor: pointer; transition: all 0.12s;
}
.redist-mode:hover { border-color: rgba(var(--v-theme-on-surface), 0.24); }
.redist-mode--active {
  border-color: #047857; color: #047857; font-weight: 600;
  background: rgba(4, 120, 87, 0.07);
}
.redist-hint {
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5);
  margin: 8px 2px 4px; line-height: 1.4;
}
.redist-error {
  font-size: 12px; color: #ef4444; font-weight: 500;
  margin: 6px 2px 2px; line-height: 1.4;
}
.redist-list {
  margin-top: 10px; display: flex; flex-direction: column; gap: 2px;
  max-height: 220px; overflow-y: auto;
}
.redist-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 2px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.redist-row:last-child { border-bottom: none; }
.redist-row-no {
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  min-width: 30px;
}
.redist-row-old {
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.45);
  text-decoration: line-through; flex: 1; text-align: right;
}
.redist-arrow { color: rgba(var(--v-theme-on-surface), 0.3); }
.redist-row-new {
  font-size: 13px; font-weight: 600; color: #047857;
  flex: 1; text-align: right;
}
.redist-row-new--closed {
  color: #94a3b8; font-weight: 500; font-style: italic;
}
.redist-manual-input {
  flex: 1; display: flex; align-items: center; justify-content: flex-end;
  gap: 3px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 7px; padding: 4px 8px;
  background: rgb(var(--v-theme-surface));
}
.redist-input {
  width: 100%; border: none; outline: none; background: transparent;
  font-size: 13px; font-weight: 600; text-align: right;
  color: rgb(var(--v-theme-on-surface));
}
.redist-input-suffix { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.redist-total {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.redist-total--bad { color: #ef4444; }
.offmonth-hint {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 12px; line-height: 1.4;
  color: #2563eb; background: rgba(37, 99, 235, 0.07);
  border-radius: 8px; padding: 8px 10px;
}
.offmonth-hint .v-icon { margin-top: 1px; flex-shrink: 0; }
</style>
