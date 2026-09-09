<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { usePaymentsStore } from '@/stores/payments'
import { useDealProfit } from '@/composables/useDealProfit'
import DealHistoryTab from '@/components/deals/DealHistoryTab.vue'
import DealDocsTab from '@/components/deals/DealDocsTab.vue'
import DealParticipantsTab from '@/components/deals/DealParticipantsTab.vue'
import DealInvestorsTab from '@/components/deals/DealInvestorsTab.vue'
import { formatCurrency, formatCurrencyShort, formatDate, formatDateShort, formatMonths, formatPercent, formatPhone, pluralizeRu, timeAgo, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { DEAL_STATUS_CONFIG, PAYMENT_STATUS_CONFIG } from '@/constants/statuses'
import { userName, clientProfileName, type Deal, type ClientProfile } from '@/types'
import { dealGuarantors } from '@/utils/dealGuarantors'
import { useAuthStore } from '@/stores/auth'
import ClientLink from '@/components/ClientLink.vue'
import DealDiscountDialog from '@/components/DealDiscountDialog.vue'
import DateField from '@/components/DateField.vue'
import { useRecentDeals } from '@/composables/useRecentDeals'
import { useRoute, useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useSubscription } from '@/composables/useSubscription'
import { useSections } from '@/composables/useSections'
import { api } from '@/api/client'
import { offMonthKind, dueYearMonth, monthPrepositional } from '@/utils/paymentAttribution'
import MarkPaidDialog from '@/components/MarkPaidDialog.vue'
import QuickPayDialog from '@/components/QuickPayDialog.vue'
import ReschedulePaymentDialog from '@/components/ReschedulePaymentDialog.vue'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler)

const route = useRoute()
const router = useRouter()

// Reactive mobile flag — used to (a) swap the schedule table for a card
// list on phones, (b) make dialogs fullscreen.
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
function updateMobile() { isMobile.value = window.innerWidth < 768 }
onMounted(() => window.addEventListener('resize', updateMobile))
onUnmounted(() => window.removeEventListener('resize', updateMobile))

const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()

const authStore = useAuthStore()
const sections = useSections()
const { canAccess: canAccessFeature } = useSubscription()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const dealId = computed(() => route.params.id as string)

const pageLoading = ref(true)
// Тарифная блокировка: сделка недоступна на текущем тарифе (прямой заход по ссылке).
const lockedError = ref(false)
function goToSubscription() { router.push('/settings?tab=subscription') }

const cashboxesStore = useCashBoxesStore()

// Record this visit in the partner's MRU list so the quick-access
// sidebar's "Недавние" tab is fresh next time they open it. Cheap —
// just appends to a localStorage-backed ref.
const recentDeals = useRecentDeals(authStore.user?.id ?? null)

/** Раздел «Платежи» закрыт этому сотруднику — блок графика не показываем. */
const paymentsHidden = ref(false)

onMounted(async () => {
  try {
    await Promise.all([
      dealsStore.fetchDeal(dealId.value),
      // График платежей — отдельный раздел со своим правом. Сотруднику, у
      // которого он закрыт, показываем сделку без графика, а не ошибку:
      // ограничение доступа не должно выглядеть как поломка.
      paymentsStore.fetchPaymentsForDeal(dealId.value).catch((e: any) => {
        if (e?.code === 'PERMISSION_DENIED') {
          paymentsHidden.value = true
          return
        }
        throw e
      }),
      cashboxesStore.items.length === 0 ? cashboxesStore.fetchAll() : Promise.resolve(),
    ])
    if (dealId.value) recentDeals.recordVisit(dealId.value)
  } catch (e: any) {
    if (e?.code === 'DEAL_LOCKED') {
      lockedError.value = true
    } else {
      toast.error(e.message || 'Ошибка загрузки сделки')
    }
  } finally {
    pageLoading.value = false
  }
})

const deal = computed(() => dealsStore.getDeal(dealId.value))
// Тарифная блокировка сделки: страница закрыта, если сделка помечена locked
// (флаг из списка, лежит в кэше) ИЛИ прямой заход вернул 403 DEAL_LOCKED.
// Единый гейт на самой странице — покрывает ВСЕ точки входа (платежи, поиск,
// клиенты, дашборд, прямой URL), а не только клик из списка сделок.
const isLocked = computed(() => lockedError.value || !!deal.value?.locked)

// Resolve the cashbox the deal belongs to — used by the hero badge and
// the move-cashbox dialog. Falls back to null if the cashbox is archived
// or the deal pre-dates the cashboxes feature (cashBoxId nullable).
const dealCashBox = computed(() => {
  const id = deal.value?.cashBoxId
  if (!id) return null
  return cashboxesStore.items.find((b) => b.id === id) ?? null
})

// Move-cashbox dialog state
const showMoveCashbox = ref(false)
const moveTargetCashBoxId = ref<string | null>(null)
const movingCashbox = ref(false)

const moveTargets = computed(() =>
  cashboxesStore.items.filter((b) => b.id !== deal.value?.cashBoxId && !b.archivedAt),
)

function openMoveCashbox() {
  if (moveTargets.value.length === 0) {
    toast.error('Нет других касс — создайте ещё одну на странице «Кассы»')
    return
  }
  moveTargetCashBoxId.value = moveTargets.value[0]?.id ?? null
  showMoveCashbox.value = true
}

async function handleMoveCashbox() {
  if (!deal.value || !moveTargetCashBoxId.value) return
  movingCashbox.value = true
  try {
    await cashboxesStore.moveDeal(deal.value.id, moveTargetCashBoxId.value)
    toast.success('Сделка перенесена в другую кассу')
    showMoveCashbox.value = false
    await dealsStore.fetchDeal(deal.value.id)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось перенести')
  } finally {
    movingCashbox.value = false
  }
}
const payments = computed(() => paymentsStore.getPaymentsForDeal(dealId.value))


/**
 * Платёжная дисциплина клиента — с сервера, по всем его сделкам у этого
 * партнёра. Раньше бралась из списка клиентов, собранного в браузере: работала
 * только если другая страница успела загрузить весь портфель, и всегда
 * показывала 100% из-за ошибки в том расчёте.
 */

// Delete deal
const deleting = ref(false)
const isDeleted = computed(() => !!deal.value?.deletedAt)

function confirmDeleteDeal() {
  if (!confirm('Переместить сделку в корзину? Её можно будет восстановить в течение 30 дней.')) return
  deleteDeal()
}

async function deleteDeal() {
  deleting.value = true
  try {
    await api.delete(`/deals/${dealId.value}`)
    toast.success('Сделка перемещена в корзину')
    router.push('/deals')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить сделку')
  } finally {
    deleting.value = false
  }
}

/**
 * Прибыль по сделке и доли со-инвесторов — в отдельном модуле.
 *
 * Это самая запутанная математика страницы, и она нужна сразу двум вкладкам
 * («Обзор» и «Со-инвесторы»), поэтому живёт отдельно и переносилась дословно.
 */
const profit = useDealProfit(deal, payments, dealId)
const {
  dealCoInvestors,
  dealPartnerParticipates,
  dealPartnerCapital,
  loadCoInvestors,
  paidTotal,
  totalPaid,
  dealProfitBreakdown,
  ciDealShare,
  ciModeLabel,
  ciFormula,
  costFeeInvestorAmount,
} = profit

// ── Staff assignee ──
interface StaffOption { id: string; firstName: string; lastName: string; isActive: boolean }
const allStaff = ref<StaffOption[]>([])
const assignLoading = ref(false)
const showAssigneeMenu = ref(false)

async function loadStaff() {
  // Only the owner can assign — staff don't need this fetch.
  if (!authStore.isOwner) return
  try {
    const list = await api.get<StaffOption[]>('/auth/investor/staff')
    allStaff.value = list.filter((s) => s.isActive)
  } catch { /* ignore */ }
}

async function setAssignee(staffId: string | null) {
  if (!deal.value) return
  assignLoading.value = true
  try {
    await api.patch(`/deals/${deal.value.id}/assignee`, { staffId })
    // Refresh deal so the badge / dealsStore picks up the new assignee.
    await dealsStore.fetchDeal(deal.value.id).catch(() => {})
    showAssigneeMenu.value = false
    toast.success(staffId ? 'Сотрудник назначен' : 'Назначение снято')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось назначить')
  } finally {
    assignLoading.value = false
  }
}

const assignedStaffName = computed(() => {
  const s = (deal.value as any)?.assignedStaff
  return s ? `${s.lastName ?? ''} ${s.firstName ?? ''}`.trim() || '—' : null
})

// Остаток долга поставщику по этой сделке (0, если погашен/оплачен при покупке).
const supplierDebtRemaining = computed(() => {
  const d = deal.value?.supplierDebt
  if (!d || d.status !== 'OPEN') return 0
  return Math.max(0, d.amount - d.paidAmount)
})



// Load co-investors on mount. Свой шаблон договора больше не грузится здесь —
// он нужен только вкладке «Документы» и подтягивается при её открытии.
onMounted(() => {
  if (sections.visible('coInvestors')) loadCoInvestors()
  if (sections.visible('staff')) loadStaff()
})

async function restoreDeal() {
  deleting.value = true
  try {
    await dealsStore.restoreDeal(dealId.value)
    await dealsStore.fetchDeal(dealId.value)
    toast.success('Сделка восстановлена')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось восстановить сделку')
  } finally {
    deleting.value = false
  }
}

async function permanentDeleteDeal() {
  if (!confirm('Удалить сделку навсегда? Это действие необратимо.')) return
  deleting.value = true
  try {
    await dealsStore.permanentDelete(dealId.value)
    toast.success('Сделка удалена навсегда')
    router.push('/deals')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить сделку')
  } finally {
    deleting.value = false
  }
}

const progress = computed(() =>
  deal.value && deal.value.numberOfPayments > 0
    ? (deal.value.paidPayments / deal.value.numberOfPayments) * 100 : 0
)

// Current monthly payment — amount the client owes for the next due payment.
// Uses the actually-scheduled amount (may differ from the original plan if
// the partner paid early with a custom sum and the backend redistributed).
// Falls back to PENDING/OVERDUE → just the first non-paid by number.
const currentMonthlyPayment = computed(() => {
  const next = payments.value.find(p => p.status === 'OVERDUE')
    ?? payments.value.find(p => p.status === 'PENDING')
  return next?.amount ?? 0
})

// Term label — picks the right Russian plural form for the deal's
// interval. MONTHLY → месяцев, WEEKLY → недель, BIWEEKLY → 2-недельных
// периодов; falls back to нейтральное «платежей».
const termLabel = computed(() => {
  const n = deal.value?.numberOfPayments ?? 0
  const interval = deal.value?.paymentInterval || 'MONTHLY'
  if (interval === 'WEEKLY') return pluralizeRu(n, 'неделя', 'недели', 'недель')
  if (interval === 'BIWEEKLY') return `× 2 ${pluralizeRu(n, 'неделя', 'недели', 'недель')}`
  if (interval === 'MONTHLY') return pluralizeRu(n, 'месяц', 'месяца', 'месяцев')
  return pluralizeRu(n, 'платёж', 'платежа', 'платежей')
})

// Overdue summary — count + total amount. Shown only when > 0.
const overdueStats = computed(() => {
  const overdue = payments.value.filter(p => p.status === 'OVERDUE')
  return {
    count: overdue.length,
    total: overdue.reduce((s, p) => s + p.amount, 0),
  }
})

/**
 * «Деньги по сделке» — один набор данных на два вида: список и карточки.
 *
 * Показатели описаны здесь, а не в шаблоне: иначе при переключении вида
 * пришлось бы держать две копии одних и тех же строк и следить, чтобы они
 * не разъезжались. Группы — смысловые: цена, условия, ход оплаты.
 */
type MoneyTone = 'plain' | 'good' | 'info' | 'key' | 'alert'
interface MoneyRow {
  id: string
  icon: string
  tone: MoneyTone
  title: string
  sub: string
  value: string
  /** Числа, ради которых сюда заходят, и просрочка — выделены. */
  accent?: 'key' | 'alert'
}

const moneyGroups = computed<MoneyRow[][]>(() => {
  const d = deal.value
  if (!d) return []

  const price: MoneyRow[] = []
  if (d.wholesalePrice && d.wholesalePrice > 0) {
    price.push({
      id: 'wholesale', icon: 'mdi-lock-outline', tone: 'plain',
      title: 'Оптовая цена', sub: 'видна только вам',
      value: formatCurrency(d.wholesalePrice),
    })
  }
  price.push(
    {
      id: 'purchase', icon: 'mdi-tag-outline', tone: 'plain',
      title: 'Цена закупа', sub: 'сколько стоил товар вам',
      value: formatCurrency(d.purchasePrice),
    },
    {
      id: 'markup', icon: 'mdi-trending-up', tone: 'good',
      title: 'Размер наценки', sub: `${formatPercent(d.markupPercent)} к закупке`,
      value: formatCurrency(d.markup),
    },
    {
      id: 'total', icon: 'mdi-file-document-outline', tone: 'key',
      title: 'Цена продажи', sub: 'сумма договора целиком',
      value: formatCurrency(d.totalPrice), accent: 'key',
    },
  )

  const terms: MoneyRow[] = [
    {
      id: 'down', icon: 'mdi-cash-fast', tone: 'plain',
      title: 'Первый взнос', sub: 'внесён при оформлении',
      value: d.downPayment ? formatCurrency(d.downPayment) : 'без первого взноса',
    },
  ]
  if (currentMonthlyPayment.value > 0) {
    terms.push({
      id: 'monthly', icon: 'mdi-calendar-month-outline', tone: 'info',
      title: 'Размер платежа в месяц', sub: 'по текущему графику',
      value: formatCurrency(currentMonthlyPayment.value),
    })
  }
  terms.push({
    id: 'term', icon: 'mdi-timer-sand', tone: 'plain',
    title: 'Срок', sub: 'платежей по договору',
    value: `${d.numberOfPayments} ${termLabel.value}`,
  })

  const progress: MoneyRow[] = [
    {
      id: 'paid', icon: 'mdi-check-circle-outline', tone: 'good',
      title: 'Оплачено', sub: 'со взносом и всеми платежами',
      value: formatCurrency(totalPaid.value),
    },
    {
      id: 'remaining', icon: 'mdi-wallet-outline', tone: 'key',
      title: 'Осталось оплатить', sub: 'до закрытия договора',
      value: formatCurrency(d.remainingAmount), accent: 'key',
    },
  ]
  if (overdueStats.value.count > 0) {
    progress.push({
      id: 'overdue', icon: 'mdi-alert-circle-outline', tone: 'alert',
      title: 'Просрочено',
      sub: `${overdueStats.value.count} ${pluralizeRu(overdueStats.value.count, 'платёж', 'платежа', 'платежей')} мимо срока`,
      value: formatCurrency(overdueStats.value.total), accent: 'alert',
    })
  }

  return [price, terms, progress]
})

/** Карточки удобны для беглого взгляда, список — когда читают подряд. */
const moneyView = ref<'list' | 'cards'>(
  (localStorage.getItem('dealMoneyView') as 'list' | 'cards' | null) ?? 'list',
)
watch(moneyView, v => localStorage.setItem('dealMoneyView', v))

/**
 * Разделы страницы сделки.
 *
 * Вкладка живёт в адресе (?tab=payments): ссылку можно отправить коллеге, а
 * обновление страницы не выкидывает обратно в «Обзор». Просрочка и действия
 * по сделке остаются в шапке — прятать их за вкладку нельзя.
 */
type DealTab =
  | 'overview'
  | 'payments'
  | 'participants'
  | 'investors'
  | 'docs'
  | 'history'

function normalizeTab(v: unknown): DealTab {
  if (v === 'payments' || v === 'participants' || v === 'docs' || v === 'history') return v
  if (v === 'investors' && sections.visible('coInvestors')) return 'investors'
  return 'overview'
}
const tab = ref<DealTab>(normalizeTab(route.query.tab))

watch(tab, (t) => {
  const q = t === 'overview' ? undefined : t
  if (route.query.tab !== q) router.replace({ query: { ...route.query, tab: q } })
})


const visibleTabs = computed(() => {
  const guarantorCount = deal.value ? dealGuarantors(deal.value).length : 0
  const all: Array<{ key: DealTab; title: string; icon: string; count?: number | string; warn?: boolean; show: boolean }> = [
    { key: 'overview', title: 'Обзор', icon: 'mdi-view-dashboard-outline', show: true },
    {
      key: 'payments',
      title: 'График платежей',
      icon: 'mdi-calendar-check-outline',
      count: payments.value.length || undefined,
      // Точка-предупреждение: просрочку человек должен заметить, не открывая вкладку.
      warn: overdueStats.value.count > 0,
      show: true,
    },
    {
      key: 'participants',
      title: 'Клиент и поручители',
      icon: 'mdi-account-multiple-outline',
      count: 1 + guarantorCount,
      show: true,
    },
    {
      key: 'investors',
      title: 'Инвесторы',
      icon: 'mdi-account-cash-outline',
      count: dealCoInvestors.value.length || undefined,
      show: !!deal.value && !deal.value.deletedAt && sections.visible('coInvestors'),
    },
    {
      key: 'docs',
      title: 'Документы',
      icon: 'mdi-file-document-outline',
      count: deal.value?.contractPhotos?.length || undefined,
      show: true,
    },
    { key: 'history', title: 'История', icon: 'mdi-history', show: true },
  ]
  return all.filter((t) => t.show)
})
// Ссылка могла вести на вкладку, которой у этой сделки нет: например
// «Со-инвесторы» у сделки в корзине. Тогда возвращаемся в «Обзор», а не
// показываем пустое место без выбранной вкладки.
watch(
  () => visibleTabs.value.map((t) => t.key).join(','),
  () => {
    if (!visibleTabs.value.some((t) => t.key === tab.value)) tab.value = 'overview'
  },
)

// Days a payment was late by. Positive integer; 0 if on time.
//   • OVERDUE → today − dueDate (still waiting for client)
//   • PAID with paidAt > dueDate → paidAt − dueDate (paid late after all)
//   • everything else (PENDING, CLOSED_EARLY, PAID on time) → 0
function daysOverdue(p: { dueDate: string; status: string; paidAt?: string | null }): number {
  const due = new Date(p.dueDate)
  due.setHours(0, 0, 0, 0)
  let reference: Date | null = null
  if (p.status === 'OVERDUE') {
    reference = new Date()
    reference.setHours(0, 0, 0, 0)
  } else if (p.status === 'PAID' && p.paidAt) {
    reference = new Date(p.paidAt)
    reference.setHours(0, 0, 0, 0)
  }
  if (!reference) return 0
  const diff = Math.floor((reference.getTime() - due.getTime()) / 86400000)
  return Math.max(diff, 0)
}

function pluralDays(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'день'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дня'
  return 'дней'
}


// Payment timeline chart
const paymentChartData = computed(() => {
  if (!payments.value.length) return { labels: [], datasets: [] }

  return {
    labels: payments.value.map(p => formatDateShort(p.dueDate)),
    datasets: [{
      label: 'Остаток',
      data: payments.value.map(p => p.remainingAfter),
      borderColor: '#047857',
      backgroundColor: 'rgba(4, 120, 87, 0.06)',
      borderWidth: 2.5,
      pointBackgroundColor: payments.value.map(p =>
        p.status === 'PAID' ? '#047857'
        : p.status === 'CLOSED_EARLY' ? '#6366f1'
        : p.status === 'OVERDUE' ? '#ef4444'
        : '#f59e0b'
      ),
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 7,
      fill: true,
      tension: 0.3,
    }]
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `Остаток: ${(ctx.parsed.y ?? 0).toLocaleString('ru-RU')} ₽`
      }
    }
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    y: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: {
        font: { size: 11 },
        callback: (v: any) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v),
      },
    }
  }
}

// Next payment
const nextPayment = computed(() =>
  payments.value.find(p => p.status === 'PENDING' || p.status === 'OVERDUE')
)

// Перенос даты — общий компонент ReschedulePaymentDialog: дату, причину и
// отправку он держит сам, странице остаётся выбор платежа.
const rescheduleDialog = ref(false)
const rescheduleTarget = ref<typeof payments.value[0] | null>(null)

function openReschedule(p: typeof payments.value[0]) {
  rescheduleTarget.value = p
  rescheduleDialog.value = true
}

function onRescheduled() {
  rescheduleTarget.value = null
}

// Undo a previous reschedule: restores the original dueDate stored in
// `rescheduledFrom`. Confirms first because the action is irreversible
// (we don't keep a full history of reschedules — just the immediate prior).
const undoingReschedule = ref<string | null>(null)
async function confirmUndoReschedule(p: typeof payments.value[0]) {
  if (!p.rescheduledFrom) return
  const originalDate = formatDate(p.rescheduledFrom)
  if (!confirm(`Вернуть исходную дату ${originalDate}?`)) return
  undoingReschedule.value = p.id
  try {
    await paymentsStore.undoReschedulePayment(p.id, p.dealId)
    toast.success('Дата платежа восстановлена')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при возврате даты')
  } finally {
    undoingReschedule.value = null
  }
}

// Add tail payment dialog. Partner uses this when the original schedule
// has run out but the client still owes — chronic underpayment, side fee,
// installment extension, etc.
const addPaymentDialog = ref(false)
const addPaymentAmount = ref<number | null>(null)
const addPaymentDueDate = ref('')
const addPaymentNote = ref('')
const addPaymentSubmitting = ref(false)

// How much debt the current schedule doesn't yet cover. Compares the
// SUM of all payment amounts (PAID + PENDING + OVERDUE — including
// CLOSED_EARLY which is amount 0) against the deal balance. Different
// from deal.remainingAmount: the latter is "how much the client still
// owes us in real money", which counts existing PENDING rows as still
// outstanding. We need "is there a hole in the schedule".
// How many rows the partner appended beyond the original plan. We can't
// flag individual rows reliably (a delete + later add reuses different
// numbers), so we surface this as an aggregate count next to the
// schedule header instead.
const extraPaymentsCount = computed(() => {
  if (!deal.value) return 0
  return Math.max(0, payments.value.length - (deal.value.numberOfPayments ?? 0))
})

const uncoveredByPlan = computed(() => {
  if (!deal.value) return 0
  const balance = (deal.value.totalPrice ?? 0) - (deal.value.downPayment ?? 0)
  const sumExisting = payments.value.reduce((s, p) => s + (p.amount ?? 0), 0)
  return Math.max(0, balance - sumExisting)
})
const canAddPayment = computed(() => {
  if (!deal.value) return false
  if (deal.value.deletedAt) return false
  if (deal.value.status === 'CANCELLED') return false
  return uncoveredByPlan.value > 0
})
const addPaymentDisabledReason = computed(() => {
  if (!deal.value) return ''
  if (deal.value.deletedAt) return 'Сделка находится в корзине'
  if (deal.value.status === 'CANCELLED') return 'Сделка отменена'
  if (uncoveredByPlan.value <= 0) {
    return 'Существующие платежи в графике уже покрывают всю сумму сделки — добавление лишних создаст фантомный долг.'
  }
  return ''
})

function openAddPayment() {
  // Default sum = the uncovered piece of the balance (balance minus the
  // total of every existing payment, paid or not). NOT remainingAmount —
  // that would double-count PENDING rows that already cover part of the
  // deal. Date = +1 interval from the latest payment's dueDate.
  addPaymentAmount.value = uncoveredByPlan.value > 0
    ? Math.round(uncoveredByPlan.value)
    : null
  const latest = [...payments.value].sort(
    (a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime(),
  )[0]
  const anchor = latest ? new Date(latest.dueDate) : new Date()
  const interval = deal.value?.paymentInterval || 'MONTHLY'
  if (interval === 'WEEKLY') anchor.setDate(anchor.getDate() + 7)
  else if (interval === 'BIWEEKLY') anchor.setDate(anchor.getDate() + 14)
  else anchor.setMonth(anchor.getMonth() + 1)
  addPaymentDueDate.value = toDateInput(anchor)
  addPaymentNote.value = ''
  addPaymentDialog.value = true
}

async function confirmAddPayment() {
  if (!deal.value || !addPaymentAmount.value || addPaymentAmount.value <= 0 || !addPaymentDueDate.value) return
  addPaymentSubmitting.value = true
  try {
    await paymentsStore.addPayment(deal.value.id, {
      amount: addPaymentAmount.value,
      // Stamp midday on the chosen calendar day so timezone shifts can't
      // push the stored date to the day before/after.
      dueDate: new Date(`${addPaymentDueDate.value}T12:00:00`).toISOString(),
      note: addPaymentNote.value.trim() || undefined,
    })
    // Re-fetch the deal so paidPayments / remainingAmount / status flip
    // (the deal may have been re-opened from COMPLETED back to ACTIVE).
    await dealsStore.fetchDeal(deal.value.id)
    toast.success('Платёж добавлен')
    addPaymentDialog.value = false
  } catch (e: any) {
    toast.error(e.message || 'Не удалось добавить платёж')
  } finally {
    addPaymentSubmitting.value = false
  }
}

/**
 * Оплата ближайшего платежа — то же окно, что и по кнопке «Оплатить» в списке
 * сделок: платёж уже выбран, весь график виден сразу, там же досрочное
 * погашение с прощением остатка.
 */
const quickPayDialog = ref(false)
const quickPayTarget = ref<typeof payments.value[0] | null>(null)

function openQuickPay() {
  if (!nextPayment.value) return
  quickPayTarget.value = nextPayment.value
  quickPayDialog.value = true
}

async function onQuickPayDone(id: string) {
  await Promise.all([
    dealsStore.fetchDeal(id).catch(() => {}),
    paymentsStore.fetchPaymentsForDeal(id).catch(() => {}),
  ])
}

// Отметка оплаты — общий компонент MarkPaidDialog (та же модалка, что на
// страницах платежей и в превью сделки). Здесь остаётся только выбор платежа и
// проверка «оплата не по порядку»: она про график сделки, а не про саму отметку.
const markPaidDialog = ref(false)
const markPaidTarget = ref<typeof payments.value[0] | null>(null)

// Proof screenshot enlarge
const proofEnlargeDialog = ref(false)
const proofEnlargeUrl = ref('')

// `<input type="date">` wants YYYY-MM-DD in the browser's local TZ — Date
// values from the API are ISO with time, so we need a thin convertor.
function toDateInput(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const outOfOrderDialog = ref(false)
const outOfOrderPending = ref<typeof payments.value[0] | null>(null)

const earlierUnpaid = computed(() => {
  const target = outOfOrderPending.value
  if (!target) return []
  return payments.value
    .filter(p => p.number < target.number && (p.status === 'PENDING' || p.status === 'OVERDUE'))
    .sort((a, b) => a.number - b.number)
})

function openMarkPaid(p: typeof payments.value[0]) {
  const earlier = payments.value.filter(
    x => x.number < p.number && (x.status === 'PENDING' || x.status === 'OVERDUE'),
  )
  if (earlier.length > 0) {
    outOfOrderPending.value = p
    outOfOrderDialog.value = true
    return
  }
  openMarkPaidImmediate(p)
}

function openMarkPaidImmediate(p: typeof payments.value[0]) {
  // Сумму, дату, режим перерасчёта и скриншот компонент сбрасывает сам при
  // каждом открытии — странице достаточно передать платёж.
  markPaidTarget.value = p
  markPaidDialog.value = true
}

// ── «Оплачен не в свой месяц»: доход учтён по факту оплаты ───────────────────
function paymentOffMonth(p: { status: string; paidAt?: string | null; dueDate: string }): 'early' | 'late' | null {
  return offMonthKind(p)
}
function paymentOffMonthLabel(p: { paidAt?: string | null; dueDate: string }): string {
  if (!p.paidAt) return ''
  const paid = new Date(p.paidAt)
  const due = dueYearMonth(p.dueDate)
  if (!due) return ''
  const paidStr = monthPrepositional(paid.getFullYear(), paid.getMonth(), due.year)
  const dueStr = monthPrepositional(due.year, due.month, paid.getFullYear())
  return `Оплачен в ${paidStr}, а плановый срок — в ${dueStr}. Доход учтён в месяце фактической оплаты.`
}

function dismissOutOfOrder() {
  outOfOrderDialog.value = false
  outOfOrderPending.value = null
}

function markEarlierFirst() {
  const first = earlierUnpaid.value[0]
  outOfOrderDialog.value = false
  outOfOrderPending.value = null
  if (first) openMarkPaidImmediate(first)
}

function markOutOfOrderAnyway() {
  const target = outOfOrderPending.value
  outOfOrderDialog.value = false
  outOfOrderPending.value = null
  if (target) openMarkPaidImmediate(target)
}

const unpaidLoading = ref<string | null>(null)

async function confirmUnmarkPaid(p: typeof payments.value[0]) {
  unpaidLoading.value = p.id
  try {
    await paymentsStore.unmarkPaid(p.id, p.dealId)
    // Refresh THIS deal so paidPayments/remainingAmount/status update on the
    // page without a hard reload. Single-deal fetch is much cheaper than
    // fetchDeals() (which loads the partner's entire portfolio).
    await dealsStore.fetchDeal(p.dealId)
    toast.success('Оплата отменена')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при отмене оплаты')
  } finally {
    unpaidLoading.value = null
  }
}

// Delete an unpaid payment row. Backend rejects PAID — partner must
// unmarkPaid first. We confirm even for unpaid since the row may have
// real history (e.g. rescheduled note, manual amount adjustment).
const removingPayment = ref<string | null>(null)
// Only "extra" rows (added on top of the original installment plan) can
// be deleted. Sister guard on the backend; UI just hides the button on
// the rows that aren't deletable so the partner doesn't get a 400.
const canDeleteAnyPayment = computed(() => {
  if (!deal.value) return false
  if (deal.value.deletedAt) return false
  if (deal.value.status === 'CANCELLED') return false
  return payments.value.length > (deal.value.numberOfPayments ?? 0)
})

async function confirmRemovePayment(p: typeof payments.value[0]) {
  if (!confirm(`Удалить платёж #${p.number} на ${formatCurrency(p.amount)}?`)) return
  removingPayment.value = p.id
  try {
    await paymentsStore.removePayment(p.id, p.dealId)
    await dealsStore.fetchDeal(p.dealId)
    toast.success('Платёж удалён')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить платёж')
  } finally {
    removingPayment.value = null
  }
}

// Banner shown under the schedule when the schedule itself doesn't add
// up to the deal balance — i.e. there's a hole even before considering
// what's PAID. Covers two cases:
//   1) All rows are off (PAID/CLOSED_EARLY) but partner underpaid →
//      no tail row was created.
//   2) Partner removed a row and the leftover wasn't covered elsewhere.
// In both cases we offer "add a tail payment" or "forgive and close".
const showLeftoverBanner = computed(() => {
  if (!deal.value) return false
  if (deal.value.deletedAt) return false
  if (deal.value.status !== 'ACTIVE' && deal.value.status !== 'DISPUTED') return false
  return uncoveredByPlan.value > 0
})

function openProofEnlarge(url: string) {
  proofEnlargeUrl.value = url
  proofEnlargeDialog.value = true
}

/**
 * Платёж отмечен в общей модалке. Сам график стор уже перечитал; здесь
 * освежаем сделку — оплачено/остаток/статус могли измениться (например,
 * переплата закрыла её досрочно).
 */
async function onMarkPaidDone(dealId: string) {
  markPaidTarget.value = null
  await dealsStore.fetchDeal(dealId)
}

// API reminder via WhatsApp
// Status progression for investor — only ACTIVE deals can transition
const STATUS_ACTIONS: Record<string, { nextStatus: Deal['status']; label: string; icon: string; color: string }> = {
  ACTIVE: { nextStatus: 'COMPLETED', label: 'Завершить сделку', icon: 'mdi-check-decagram', color: '#047857' },
}

const statusAction = computed(() => deal.value ? STATUS_ACTIONS[deal.value.status] : null)
const statusDialog = ref(false)
const statusUpdating = ref(false)
// ── Пометка по договору ──
const commentEditing = ref(false)
const commentDraft = ref('')
const commentSaving = ref(false)

function startEditComment() {
  commentDraft.value = deal.value?.comment ?? ''
  commentEditing.value = true
}

async function saveComment() {
  if (!deal.value) return
  commentSaving.value = true
  try {
    await api.patch(`/deals/${deal.value.id}`, { comment: commentDraft.value })
    await dealsStore.fetchDeal(dealId.value)
    commentEditing.value = false
    toast.success(commentDraft.value.trim() ? 'Комментарий сохранён' : 'Комментарий удалён')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось сохранить комментарий')
  } finally {
    commentSaving.value = false
  }
}

// ── Скидка на остаток договора ──
// Не путать с прощением при досрочном закрытии: здесь договор продолжает
// действовать, клиент просто должен меньше.
const discountDialog = ref(false)
/** Право то же, что и на прощение: это списание заработка партнёра. */
const canDiscount = computed(() => authStore.can('payments.forgive'))

/** После скидки перечитываем и сделку, и график: изменились обе стороны. */
async function onDiscountApplied() {
  await Promise.all([
    dealsStore.fetchDeal(dealId.value),
    paymentsStore.fetchPaymentsForDeal(dealId.value),
  ])
}

const closeMode = ref<'paid_early' | 'forgive' | 'force'>('paid_early')

const unpaidCount = computed(() =>
  payments.value.filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE').length,
)
const hasUnpaidPayments = computed(() => unpaidCount.value > 0 || (deal.value?.remainingAmount ?? 0) > 0)


function openStatusDialog(preselect?: 'paid_early' | 'forgive' | 'force') {
  closeMode.value = preselect ?? 'paid_early'
  statusDialog.value = true
}

async function confirmStatusChange() {
  if (!deal.value || !statusAction.value) return
  statusUpdating.value = true
  try {
    // Pass closeMode only when closing with unpaid remainder
    const mode = hasUnpaidPayments.value ? closeMode.value : undefined
    await dealsStore.updateDealStatus(deal.value.id, statusAction.value.nextStatus, mode)
    toast.success('Сделка завершена')
    statusDialog.value = false
    // Refresh payments to reflect new statuses
    await dealsStore.fetchDeal(deal.value.id).catch(() => {})
  } catch (e: any) {
    toast.error(e.message || 'Ошибка обновления статуса')
  } finally {
    statusUpdating.value = false
  }
}


</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Back button -->
    <button class="back-btn" @click="router.back()">
      <v-icon icon="mdi-arrow-left" size="18" />
      Назад
    </button>

    <!-- Page loader -->
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 300px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <!-- Тарифная блокировка сделки -->
    <div v-else-if="isLocked" class="deal-locked-screen">
      <div class="deal-locked-icon"><v-icon icon="mdi-lock-outline" size="34" /></div>
      <div class="deal-locked-title">Сделка недоступна на вашем тарифе</div>
      <div class="deal-locked-sub">
        На бесплатном тарифе доступны только последние 3 сделки. Обновите тариф, чтобы открывать и редактировать все свои сделки.
      </div>
      <div class="deal-locked-actions">
        <button class="dl-btn dl-btn--ghost" @click="router.push('/deals')">К списку сделок</button>
        <button class="dl-btn dl-btn--primary" @click="goToSubscription">Повысить тариф</button>
      </div>
    </div>

    <div v-else-if="deal">
      <!-- Deleted notice strip -->
      <div v-if="isDeleted" class="deleted-strip mb-4">
        <div class="deleted-strip-icon">
          <v-icon icon="mdi-delete-clock-outline" size="18" />
        </div>
        <div class="deleted-strip-text">
          <span class="deleted-strip-title">Эта сделка в корзине</span>
          <span class="deleted-strip-sub">Удалена {{ deal?.deletedAt ? timeAgo(deal.deletedAt) : '' }} · будет удалена навсегда через 30 дней</span>
        </div>
        <button
          class="deleted-strip-btn"
          :disabled="deleting"
          @click="restoreDeal"
        >
          <v-icon icon="mdi-restore" size="16" />
          Восстановить
        </button>
      </div>

      <!-- Hero -->
      <div class="detail-hero mb-6">
        <div class="detail-hero-actions">
          <button
            v-if="dealCashBox"
            class="detail-hero-cashbox"
            :style="{ '--cb-color': dealCashBox.color }"
            :title="`В кассе «${dealCashBox.name}». Нажмите чтобы перенести`"
            @click="openMoveCashbox"
          >
            <v-icon :icon="dealCashBox.icon" size="14" :style="{ color: dealCashBox.color }" />
            <span>{{ dealCashBox.name }}</span>
            <v-icon icon="mdi-swap-horizontal" size="14" />
          </button>
          <button
            class="detail-hero-edit"
            title="Редактировать сделку"
            @click="$router.push(`/create-deal?edit=${dealId}`)"
          >
            <v-icon icon="mdi-pencil-outline" size="16" />
            <span>Редактировать</span>
          </button>
        </div>
        <div class="detail-hero-photo" :class="{ 'detail-hero-photo--empty': !deal.productPhotos?.length }">
          <img v-if="deal.productPhotos?.length" :src="deal.productPhotos[0]" alt="" />
          <div v-else class="detail-hero-photo-placeholder">
            <v-icon icon="mdi-image-off-outline" size="40" />
            <span>Фото не добавлено</span>
          </div>
        </div>
        <div class="detail-hero-content">
          <div
            class="detail-hero-status"
            :style="{ color: DEAL_STATUS_CONFIG[deal.status]?.color }"
          >
            <span class="detail-hero-status-dot" :style="{ background: DEAL_STATUS_CONFIG[deal.status]?.color }" />
            {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
          </div>
          <h1 class="detail-hero-title">{{ deal.productName }}</h1>
          <div class="detail-hero-num">Договор №{{ deal.dealNumber }}</div>
          <div class="detail-hero-meta">
            <v-icon icon="mdi-account" size="16" />
            <ClientLink
              :profile-id="deal.clientProfileId"
              :name="deal.client ? userName(deal.client) : deal.clientProfile ? clientProfileName(deal.clientProfile) : deal.externalClientName || '—'"
            />
            <span class="mx-2">·</span>
            Создано {{ formatDate(deal.createdAt) }}
            <span class="mx-2">·</span>
            <v-icon icon="mdi-calendar-outline" size="14" />
            Заключена {{ formatDate(deal.dealDate) }}
            <template v-if="deal.firstPaymentDate">
              <span class="mx-2">·</span>
              <v-icon icon="mdi-calendar-start" size="14" />
              Первый платёж {{ formatDate(deal.firstPaymentDate) }}
            </template>
          </div>
        </div>
      </div>

      <!-- Шапка: главные цифры договора, прогресс и действия. Раньше это были
           две карточки подряд — «следующий шаг» с одной кнопкой и отдельный
           прогресс; вместе они занимали пол-экрана и повторяли друг друга. -->
      <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
        <div class="d-flex justify-space-between align-center ga-4 flex-wrap">
          <div>
            <div class="section-title">Прогресс по договору</div>
            <div class="section-subtitle">
              {{ deal.paidPayments }} из {{ deal.numberOfPayments }}
              {{ pluralizeRu(deal.numberOfPayments, 'платежа', 'платежей', 'платежей') }} внесено
            </div>
          </div>

          <div class="status-action-buttons">
            <!-- Отметить оплату — самое частое действие по сделке -->
            <button
              v-if="nextPayment && !paymentsHidden"
              class="status-action-btn status-action-btn--ghost"
              @click="openQuickPay()"
            >
              <v-icon icon="mdi-cash-check" size="16" />
              Отметить оплату
            </button>
            <button
              v-if="canDiscount && deal.status === 'ACTIVE'"
              class="status-action-btn status-action-btn--ghost"
              @click="discountDialog = true"
            >
              <v-icon icon="mdi-sale-outline" size="16" />
              Дать скидку
            </button>
            <button
              v-if="statusAction"
              class="status-action-btn"
              :style="{ background: statusAction.color }"
              @click="openStatusDialog()"
            >
              {{ statusAction.label }}
              <v-icon icon="mdi-arrow-right" size="16" />
            </button>
          </div>
        </div>

        <v-progress-linear :model-value="progress" color="primary" rounded height="10" class="mt-5" />

        <!-- Две короткие подписи по краям полосы: слева сколько внесли, справа
             сколько ещё ждать. Подробности — в блоке «Деньги по сделке». -->
        <div class="pg-ends">
          <span class="pg-end">Оплачено {{ formatCurrency(totalPaid) }}</span>
          <span class="pg-end">Осталось {{ formatCurrency(deal.remainingAmount) }}</span>
        </div>
      </v-card>

      <!-- Разделы сделки. Шапка со статусом, просрочкой и действиями
           остаётся выше вкладок: прятать просрочку нельзя. -->
      <div class="page-tabs deal-tabs">
        <button v-for="t in visibleTabs" :key="t.key" class="page-tab"
                :class="{ 'page-tab--active': tab === t.key }" @click="tab = t.key">
          <v-icon :icon="t.icon" size="16" />
          {{ t.title }}
          <span v-if="t.count" class="page-tab-count">{{ t.count }}</span>
          <span v-if="t.warn" class="page-tab-dot" />
        </button>
      </div>

      <!-- Обзор -->
      <v-row v-if="tab === 'overview'">
        <v-col cols="12" lg="8">
          <!-- Деньги по сделке.
               У каждой строки название и пояснение под ним: пояснение не
               повторяет заголовок, а отвечает на вопрос «откуда это число».
               Высота строк одинаковая, поэтому пояснение есть у всех.
               Зелёным — два числа, ради которых сюда заходят. -->
          <v-card rounded="lg" elevation="0" border class="pa-0 mb-6 dm-card">
            <div class="dm-head">
              <span class="dm-head-title">Деньги по сделке</span>
              <!-- Вид запоминается: одни читают показатели подряд списком,
                   другим нужен беглый взгляд по карточкам. -->
              <div class="dm-switch">
                <button
                  class="dm-switch-btn"
                  :class="{ 'dm-switch-btn--on': moneyView === 'list' }"
                  title="Списком"
                  @click="moneyView = 'list'"
                >
                  <v-icon icon="mdi-format-list-bulleted" size="17" />
                </button>
                <button
                  class="dm-switch-btn"
                  :class="{ 'dm-switch-btn--on': moneyView === 'cards' }"
                  title="Карточками"
                  @click="moneyView = 'cards'"
                >
                  <v-icon icon="mdi-view-grid-outline" size="17" />
                </button>
              </div>
            </div>

            <template v-if="moneyView === 'list'">
              <div v-for="(group, gi) in moneyGroups" :key="gi" class="dm-group">
                <div
                  v-for="row in group"
                  :key="row.id"
                  class="dm-row"
                  :class="{
                    'dm-row--key': row.accent === 'key',
                    'dm-row--alert': row.accent === 'alert',
                  }"
                >
                  <span class="dm-ico" :class="`dm-ico--${row.tone}`">
                    <v-icon :icon="row.icon" size="16" />
                  </span>
                  <span class="dm-key">
                    <span class="dm-key-title">{{ row.title }}</span>
                    <span class="dm-key-sub">{{ row.sub }}</span>
                  </span>
                  <span class="dm-val" :class="{ 'dm-val--key': row.accent === 'key' }">
                    {{ row.value }}
                  </span>
                </div>
              </div>
            </template>

            <!-- Карточки: те же показатели, но сеткой — значение крупно сверху,
                 пояснение под ним. Группы здесь не нужны: сетка и так режет
                 список на ряды. -->
            <div v-else class="dm-cards">
              <div
                v-for="row in moneyGroups.flat()"
                :key="row.id"
                class="dm-cell"
                :class="{
                  'dm-cell--key': row.accent === 'key',
                  'dm-cell--alert': row.accent === 'alert',
                }"
              >
                <span class="dm-ico" :class="`dm-ico--${row.tone}`">
                  <v-icon :icon="row.icon" size="16" />
                </span>
                <span class="dm-cell-text">
                  <span class="dm-cell-title">{{ row.title }}</span>
                  <span class="dm-cell-sub">{{ row.sub }}</span>
                </span>
                <span class="dm-cell-val" :class="{ 'dm-cell-val--key': row.accent === 'key' }">
                  {{ row.value }}
                </span>
              </div>
            </div>
          </v-card>
          <!-- Из чего складывается прибыль — сразу под «Деньгами по сделке»:
               это продолжение того же разговора, отдельная вкладка ради одной
               карточки только уводила от него. Показываем, когда есть что
               делить: оптовая цена или инвесторы. -->
          <v-card
            v-if="dealProfitBreakdown && (dealProfitBreakdown.useWholesale || dealCoInvestors.length > 0)"
            rounded="lg"
            elevation="0"
            border
            class="pa-6 mb-6 profit-card"
          >
            <div class="pf-head">
              <div class="pf-head-title">Прибыль по сделке</div>
              <div class="pf-head-sub">С учётом инвесторов и оптовой цены</div>
            </div>

            <!-- Что заработала сделка целиком -->
            <div class="pf-section">
              <div class="pf-section-label">Заработано сделкой</div>

              <div v-if="dealProfitBreakdown.useWholesale" class="pf-row">
                <div class="pf-row-name">
                  Розничная маржа
                  <span class="pf-row-formula">
                    {{ formatCurrency(deal.purchasePrice) }} − {{ formatCurrency(deal.wholesalePrice || 0) }}
                  </span>
                </div>
                <div class="pf-row-value">{{ formatCurrency(dealProfitBreakdown.retailMargin) }}</div>
              </div>

              <div class="pf-row">
                <div class="pf-row-name">
                  Наценка рассрочки
                  <span class="pf-row-formula">
                    {{ formatCurrency(deal.totalPrice) }} − {{ formatCurrency(deal.purchasePrice) }}
                  </span>
                </div>
                <div class="pf-row-value">{{ formatCurrency(dealProfitBreakdown.installmentMargin) }}</div>
              </div>

              <div v-if="dealProfitBreakdown.useWholesale" class="pf-hint">
                <v-icon
                  :icon="dealProfitBreakdown.isFullMargin ? 'mdi-account-group' : 'mdi-account'"
                  size="15"
                />
                <span v-if="dealProfitBreakdown.isFullMargin">
                  Инвесторы получают долю со всей прибыли, включая розничную маржу
                </span>
                <span v-else>
                  Розничная маржа целиком ваша. С инвесторами делится только наценка рассрочки
                </span>
              </div>
            </div>

            <!-- Доли инвесторов — отдельным блоком: это вычет из заработанного,
                 и по строкам должно быть сразу видно, кому и сколько уходит. -->
            <div v-if="dealCoInvestors.length" class="pf-section pf-section--investors">
              <div class="pf-section-label">
                Доли инвесторов
                <span class="pf-section-total">
                  −{{ formatCurrency(dealProfitBreakdown.ciAmount) }}
                </span>
              </div>

              <div v-for="ci in dealCoInvestors" :key="ci.id" class="pf-row">
                <div class="pf-row-name">
                  {{ ci.name }}
                  <span class="pf-row-formula">
                    {{ ciModeLabel(ci) }}<template v-if="ciFormula(ci)"> · {{ ciFormula(ci) }}</template>
                  </span>
                </div>
                <div class="pf-row-value pf-row-value--minus">−{{ formatCurrency(ciDealShare(ci)) }}</div>
              </div>

              <!-- При комиссионной схеме инвестор забирает ещё и свою закупку -->
              <div
                v-for="ci in dealCoInvestors.filter((c) => c.costFeeMode || c.costFeeRatePct != null)"
                :key="'payout-' + ci.id"
                class="pf-hint"
              >
                <v-icon icon="mdi-cash-refund" size="15" />
                <span>
                  {{ ci.name }} на руки: возврат закупки {{ formatCurrencyShort(deal.purchasePrice) }}
                  + прибыль {{ formatCurrencyShort(ciDealShare(ci)) }}
                  = {{ formatCurrency(deal.purchasePrice + ciDealShare(ci)) }}
                </span>
              </div>
            </div>

            <!-- Итог -->
            <div class="pf-total">
              <div class="pf-total-main">
                <div class="pf-total-label">Ваша прибыль по сделке</div>
                <div class="pf-total-value">{{ formatCurrency(dealProfitBreakdown.totalPartner) }}</div>
                <div v-if="dealProfitBreakdown.hasCiShare" class="pf-total-formula">
                  {{ formatCurrency(dealProfitBreakdown.splitBase + dealProfitBreakdown.partnerRetailDirect) }}
                  заработано − {{ formatCurrency(dealProfitBreakdown.ciAmount) }} инвесторам
                </div>
              </div>

              <div class="pf-total-got">
                <div class="pf-total-label">Уже получено</div>
                <div class="pf-total-got-value">
                  {{ formatCurrency(dealProfitBreakdown.realizedPartner) }}
                </div>
                <div class="pf-total-formula">
                  {{ dealProfitBreakdown.progressPercent }}% от прибыли по сделке
                </div>
              </div>
            </div>

            <div class="pf-bar">
              <div class="pf-bar-fill" :style="{ width: dealProfitBreakdown.progressPercent + '%' }" />
            </div>
          </v-card>


          <!-- Раздел платежей закрыт этому сотруднику: говорим об этом прямо,
               а не оставляем пустое место, будто данных нет. -->
          <v-card v-if="paymentsHidden" rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="text-body-2 text-medium-emphasis">
              График платежей скрыт: у вас нет доступа к разделу «Платежи»
            </div>
          </v-card>

        </v-col>
        <v-col cols="12" lg="4">
          <!-- Assigned staff (partner-only) -->
          <v-card v-if="authStore.isOwner && sections.visible('staff')" rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="d-flex align-center justify-space-between flex-wrap ga-3">
              <div class="d-flex align-center ga-3" style="min-width: 0;">
                <div class="ci-header-icon" style="background: rgba(99, 102, 241, 0.10); color: #6366f1;">
                  <v-icon icon="mdi-account-tie-outline" size="20" />
                </div>
                <div style="min-width: 0;">
                  <div class="ci-header-title">Ответственный сотрудник</div>
                  <div class="ci-header-sub">
                    <template v-if="assignedStaffName">{{ assignedStaffName }}</template>
                    <template v-else>Не назначен</template>
                  </div>
                </div>
              </div>
              <v-menu v-model="showAssigneeMenu" :close-on-content-click="true" location="bottom end">
                <template #activator="{ props: menuProps }">
                  <button
                    v-bind="menuProps"
                    class="ci-add-btn"
                    :disabled="assignLoading || allStaff.length === 0"
                  >
                    <v-icon :icon="(deal as any)?.assignedStaffId ? 'mdi-pencil-outline' : 'mdi-plus'" size="16" />
                    {{ (deal as any)?.assignedStaffId ? 'Изменить' : 'Назначить' }}
                  </button>
                </template>
                <v-card min-width="260" rounded="lg" elevation="4" class="ci-menu">
                  <div class="ci-menu-header">
                    <v-icon icon="mdi-account-tie-outline" size="14" />
                    Кто отвечает за сделку?
                  </div>
                  <div class="ci-menu-list">
                    <button
                      class="ci-menu-item"
                      :class="{ 'ci-menu-item--active': !(deal as any)?.assignedStaffId }"
                      @click="setAssignee(null)"
                    >
                      <v-icon icon="mdi-account-off-outline" size="16" />
                      <span>Без ответственного</span>
                    </button>
                    <div class="ci-menu-divider" />
                    <button
                      v-for="s in allStaff"
                      :key="s.id"
                      class="ci-menu-item"
                      :class="{ 'ci-menu-item--active': (deal as any)?.assignedStaffId === s.id }"
                      @click="setAssignee(s.id)"
                    >
                      <v-icon icon="mdi-account-circle-outline" size="16" />
                      <span>{{ s.lastName }} {{ s.firstName }}</span>
                    </button>
                    <div v-if="!allStaff.length" class="ci-menu-empty">
                      Нет активных сотрудников
                    </div>
                  </div>
                </v-card>
              </v-menu>
            </div>
          </v-card>

          <!-- Supplier (Партнёры, partner-only) -->
          <v-card v-if="authStore.isOwner && deal.supplier" rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="d-flex align-center justify-space-between flex-wrap ga-3">
              <div class="d-flex align-center ga-3" style="min-width: 0;">
                <div class="ci-header-icon" style="background: rgba(4, 120, 87, 0.10); color: #047857;">
                  <v-icon icon="mdi-handshake-outline" size="20" />
                </div>
                <div style="min-width: 0;">
                  <div class="ci-header-title">Партнёр-поставщик</div>
                  <div class="ci-header-sub">
                    {{ deal.supplier.name }}<template v-if="deal.supplier.city"> · {{ deal.supplier.city }}</template>
                  </div>
                </div>
              </div>
              <div class="d-flex align-center ga-2">
                <span
                  v-if="supplierDebtRemaining > 0"
                  class="sup-debt-badge sup-debt-badge--open"
                >
                  <v-icon icon="mdi-cash-minus" size="14" /> Долг {{ formatCurrency(supplierDebtRemaining) }}
                </span>
                <span
                  v-else-if="deal.supplierDebt && deal.supplierDebt.status === 'SETTLED'"
                  class="sup-debt-badge sup-debt-badge--paid"
                >
                  <v-icon icon="mdi-check-circle-outline" size="14" /> Долг погашен
                </span>
                <span v-else class="sup-debt-badge sup-debt-badge--paid">
                  <v-icon icon="mdi-check-circle-outline" size="14" /> Оплачен при покупке
                </span>
                <router-link :to="`/suppliers/${deal.supplier.id}`" class="ci-add-btn" style="text-decoration: none;">
                  <v-icon icon="mdi-arrow-right" size="16" /> Открыть
                </router-link>
              </div>
            </div>
          </v-card>

          <!-- Пометка по договору: «не звонить этому», «родственник Асвада».
               Одно свободное поле — заполняется, когда есть что запомнить. -->
          <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="d-flex align-center justify-space-between mb-3">
              <div class="section-title mb-0">Комментарий</div>
              <button v-if="!commentEditing && !deal.deletedAt" class="ci-add-btn" @click="startEditComment">
                <v-icon :icon="deal.comment ? 'mdi-pencil' : 'mdi-plus'" size="14" />
                {{ deal.comment ? 'Изменить' : 'Добавить' }}
              </button>
            </div>

            <template v-if="commentEditing">
              <textarea
                v-model="commentDraft"
                class="deal-comment-input"
                rows="3"
                placeholder="Например: родственник Асвада, не звонить после 20:00"
              />
              <div class="d-flex ga-2 mt-2">
                <button class="btn-secondary flex-grow-1" @click="commentEditing = false">Отмена</button>
                <button class="btn-primary flex-grow-1" :disabled="commentSaving" @click="saveComment">
                  <v-progress-circular v-if="commentSaving" indeterminate size="16" width="2" />
                  <span v-else>Сохранить</span>
                </button>
              </div>
            </template>
            <div v-else-if="deal.comment" class="deal-comment-text">{{ deal.comment }}</div>
            <div v-else class="deal-comment-empty">Пометок нет</div>
          </v-card>

          <!-- Deal info card -->
          <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
            <div class="section-title mb-4">Условия сделки</div>

            <div class="deal-detail-list">
              <div class="deal-detail-row">
                <span class="deal-detail-label">Первоначальный взнос</span>
                <span v-if="deal.downPayment" class="deal-detail-val" style="color: #047857; font-weight: 700;">{{ formatCurrency(deal.downPayment) }}</span>
                <span v-else class="deal-detail-val" style="opacity: 0.4;">Без взноса</span>
              </div>
              <div class="deal-detail-row">
                <span class="deal-detail-label">Интервал</span>
                <span class="deal-detail-val">{{ deal.paymentInterval === 'MONTHLY' ? 'Ежемесячно' : deal.paymentInterval === 'BIWEEKLY' ? 'Раз в 2 недели' : 'Еженедельно' }}</span>
              </div>
              <div class="deal-detail-row">
                <span class="deal-detail-label">Тип платежей</span>
                <span class="deal-detail-val">{{ deal.paymentType === 'EQUAL' ? 'Равные' : deal.paymentType === 'DECREASING' ? 'Убывающие' : 'Произвольные' }}</span>
              </div>
              <div class="deal-detail-row">
                <span class="deal-detail-label">Первый платёж</span>
                <!-- У импортированных сделок дата не заполнена: строку не
                     прячем, чтобы было видно, что поле есть, но пустое. -->
                <span class="deal-detail-val">{{ deal.firstPaymentDate ? formatDate(deal.firstPaymentDate) : 'не указан' }}</span>
              </div>
              <div v-if="deal.completedAt" class="deal-detail-row">
                <span class="deal-detail-label">Завершена</span>
                <span class="deal-detail-val">{{ formatDate(deal.completedAt) }}</span>
              </div>
              <div class="deal-detail-row">
                <span class="deal-detail-label">Последнее обновление</span>
                <span class="deal-detail-val">{{ timeAgo(deal.updatedAt) }}</span>
              </div>
            </div>
          </v-card>

        </v-col>
      </v-row>

      <!-- График платежей -->
      <div v-else-if="tab === 'payments'">
        <!-- Раздел закрыт этому сотруднику: объясняем прямо здесь, иначе
             вкладка выглядела бы просто пустой. -->
        <v-card v-if="paymentsHidden" rounded="lg" elevation="0" border class="pa-5 mb-6">
          <div class="text-body-2 text-medium-emphasis">
            График платежей скрыт: у вас нет доступа к разделу «Платежи»
          </div>
        </v-card>
        <!-- Payment schedule -->
        <v-card v-if="payments.length" rounded="lg" elevation="0" border class="mb-6">
          <div class="pa-5 pb-0 d-flex align-start justify-space-between ga-3 flex-wrap">
            <div>
              <div class="section-title">График платежей</div>
              <div class="section-subtitle mb-4">Полный список по сделке</div>
            </div>
            <div v-if="deal && !deal.deletedAt && deal.status !== 'CANCELLED'" class="d-flex align-center ga-2">
              <button
                class="add-payment-btn"
                :disabled="!canAddPayment"
                :title="canAddPayment ? 'Добавить дополнительный платёж' : ''"
                @click="canAddPayment && openAddPayment()"
              >
                <v-icon icon="mdi-plus" size="16" />
                Добавить платёж
              </button>
              <!-- Hover hint that explains the disabled state. Shown
                   only when the button is actually disabled so the
                   partner doesn't see a useless «?» otherwise. -->
              <v-tooltip v-if="!canAddPayment" location="bottom" max-width="280">
                <template #activator="{ props: tprops }">
                  <v-icon
                    v-bind="tprops"
                    icon="mdi-information-outline"
                    size="18"
                    class="add-payment-info"
                  />
                </template>
                <span>{{ addPaymentDisabledReason }}</span>
              </v-tooltip>
            </div>
          </div>

          <v-table density="default" class="schedule-table schedule-table--desktop">
            <thead>
              <tr>
                <th>#</th>
                <th>Дата</th>
                <th class="text-end">Сумма</th>
                <th class="text-end">Остаток после</th>
                <th>Оплачено</th>
                <th>Статус</th>
                <th class="text-center">Действия</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in payments"
                :key="p.id"
                :class="{ 'row-paid': p.status === 'PAID', 'row-overdue': p.status === 'OVERDUE' }"
              >
                <td class="font-weight-medium">{{ p.number }}</td>
                <td>
                  {{ formatDate(p.dueDate) }}
                  <div v-if="p.rescheduledFrom" class="rescheduled-hint">
                    <v-icon icon="mdi-calendar-arrow-right" size="12" />
                    было {{ formatDate(p.rescheduledFrom) }}
                  </div>
                  <!-- Days-late chip — surfaced for any payment that's
                       late, regardless of whether it's still OVERDUE or
                       already PAID after the due date. Lets the partner
                       see the delay history at a glance. -->
                  <div v-if="daysOverdue(p) > 0" class="overdue-chip">
                    <v-icon icon="mdi-clock-alert-outline" size="11" />
                    {{ p.status === 'PAID' ? 'оплачен с задержкой' : 'просрочен' }}
                    на {{ daysOverdue(p) }} {{ pluralDays(daysOverdue(p)) }}
                  </div>
                </td>
                <td class="text-end font-weight-bold text-no-wrap">
                  {{ formatCurrency(p.amount) }}
                  <!-- План vs факт: показываем плановую сумму, если она была
                       зафиксирована при оплате и отличается от фактической. -->
                  <div
                    v-if="p.scheduledAmount != null && Math.round(p.scheduledAmount) !== Math.round(p.amount)"
                    class="plan-vs-fact"
                    :style="{ color: p.amount > p.scheduledAmount ? '#10b981' : '#f59e0b' }"
                  >
                    план: {{ formatCurrency(p.scheduledAmount) }}
                  </div>
                </td>
                <td class="text-end text-medium-emphasis text-no-wrap">{{ formatCurrency(p.remainingAfter) }}</td>
                <td class="text-medium-emphasis">
                  <div>{{ p.paidAt ? formatDate(p.paidAt) : '—' }}</div>
                  <!-- Оплачен не в свой месяц → доход учтён по факту оплаты. -->
                  <div
                    v-if="paymentOffMonth(p)"
                    class="offmonth-chip"
                    :class="paymentOffMonth(p) === 'early' ? 'offmonth-chip--early' : 'offmonth-chip--late'"
                    :title="paymentOffMonthLabel(p)"
                  >
                    <v-icon :icon="paymentOffMonth(p) === 'early' ? 'mdi-calendar-arrow-left' : 'mdi-calendar-arrow-right'" size="11" />
                    {{ paymentOffMonth(p) === 'early' ? 'учтён по факту (досрочно)' : 'учтён по факту (позже срока)' }}
                  </div>
                  <div v-if="p.proofScreenshot" class="mt-1">
                    <img
                      :src="p.proofScreenshot"
                      class="proof-thumbnail"
                      title="Скриншот оплаты"
                      @click="openProofEnlarge(p.proofScreenshot!)"
                    />
                  </div>
                </td>
                <td>
                  <div
                    class="pay-status"
                    :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])"
                  >
                    {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                  </div>
                </td>
                <td class="text-center">
                  <div v-if="p.status === 'PENDING' || p.status === 'OVERDUE'" class="d-flex align-center justify-center ga-1">
                    <button class="action-btn action-btn--success" title="Отметить оплаченным" @click="openMarkPaid(p)">
                      <v-icon icon="mdi-check" size="16" />
                    </button>
                    <button class="action-btn action-btn--warning" title="Перенести дату" @click="openReschedule(p)">
                      <v-icon icon="mdi-calendar-clock" size="16" />
                    </button>
                    <button
                      v-if="p.rescheduledFrom"
                      class="action-btn action-btn--ghost"
                      :title="`Вернуть исходную дату (${formatDate(p.rescheduledFrom)})`"
                      :disabled="undoingReschedule === p.id"
                      @click="confirmUndoReschedule(p)"
                    >
                      <v-progress-circular v-if="undoingReschedule === p.id" indeterminate size="12" width="2" />
                      <v-icon v-else icon="mdi-calendar-refresh" size="16" />
                    </button>
                    <button
                      v-if="canDeleteAnyPayment"
                      class="action-btn action-btn--danger"
                      title="Удалить платёж"
                      :disabled="removingPayment === p.id"
                      @click="confirmRemovePayment(p)"
                    >
                      <v-progress-circular v-if="removingPayment === p.id" indeterminate size="12" width="2" />
                      <v-icon v-else icon="mdi-trash-can-outline" size="16" />
                    </button>
                  </div>
                  <div v-else-if="p.status === 'PAID'" class="d-flex align-center justify-center">
                    <button
                      class="action-btn action-btn--danger"
                      title="Отменить оплату"
                      :disabled="unpaidLoading === p.id"
                      @click="confirmUnmarkPaid(p)"
                    >
                      <v-progress-circular v-if="unpaidLoading === p.id" indeterminate size="12" width="2" />
                      <v-icon v-else icon="mdi-undo" size="16" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </v-table>

          <!-- Mobile card list — same content rearranged for narrow screens. -->
          <div class="schedule-cards">
            <div
              v-for="p in payments"
              :key="p.id"
              class="sched-card"
              :class="{
                'sched-card--paid': p.status === 'PAID',
                'sched-card--overdue': p.status === 'OVERDUE',
                'sched-card--closed': p.status === 'CLOSED_EARLY',
              }"
            >
              <div class="sched-card-head">
                <div class="sched-card-num">#{{ p.number }}</div>
                <div class="pay-status" :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])">
                  {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                </div>
              </div>

              <div class="sched-card-date">
                <div class="sched-card-date-value">{{ formatDate(p.dueDate) }}</div>
                <div v-if="p.rescheduledFrom" class="rescheduled-hint">
                  <v-icon icon="mdi-calendar-arrow-right" size="12" />
                  было {{ formatDate(p.rescheduledFrom) }}
                </div>
                <div v-if="daysOverdue(p) > 0" class="overdue-chip">
                  <v-icon icon="mdi-clock-alert-outline" size="11" />
                  {{ p.status === 'PAID' ? 'оплачен с задержкой' : 'просрочен' }}
                  на {{ daysOverdue(p) }} {{ pluralDays(daysOverdue(p)) }}
                </div>
              </div>

              <div class="sched-card-amounts">
                <div class="sched-card-amount">
                  <div class="sched-card-amount-label">Сумма</div>
                  <div class="sched-card-amount-value">{{ formatCurrency(p.amount) }}</div>
                  <div
                    v-if="p.scheduledAmount != null && Math.round(p.scheduledAmount) !== Math.round(p.amount)"
                    class="plan-vs-fact"
                    :style="{ color: p.amount > p.scheduledAmount ? '#10b981' : '#f59e0b' }"
                  >
                    план: {{ formatCurrency(p.scheduledAmount) }}
                  </div>
                </div>
                <div class="sched-card-amount">
                  <div class="sched-card-amount-label">Остаток после</div>
                  <div class="sched-card-amount-value sched-card-amount-value--muted">
                    {{ formatCurrency(p.remainingAfter) }}
                  </div>
                </div>
              </div>

              <div v-if="p.paidAt || p.proofScreenshot" class="sched-card-paid">
                <div v-if="p.paidAt" class="sched-card-paid-date">
                  <v-icon icon="mdi-check-circle-outline" size="14" />
                  Оплачено {{ formatDate(p.paidAt) }}
                </div>
                <div
                  v-if="paymentOffMonth(p)"
                  class="offmonth-chip"
                  :class="paymentOffMonth(p) === 'early' ? 'offmonth-chip--early' : 'offmonth-chip--late'"
                  :title="paymentOffMonthLabel(p)"
                >
                  <v-icon :icon="paymentOffMonth(p) === 'early' ? 'mdi-calendar-arrow-left' : 'mdi-calendar-arrow-right'" size="11" />
                  {{ paymentOffMonth(p) === 'early' ? 'доход учтён по факту (досрочно)' : 'доход учтён по факту (позже срока)' }}
                </div>
                <img
                  v-if="p.proofScreenshot"
                  :src="p.proofScreenshot"
                  class="proof-thumbnail sched-card-proof"
                  title="Скриншот оплаты"
                  @click="openProofEnlarge(p.proofScreenshot!)"
                />
              </div>

              <div v-if="p.status === 'PENDING' || p.status === 'OVERDUE'" class="sched-card-actions">
                <button class="action-btn action-btn--success" @click="openMarkPaid(p)">
                  <v-icon icon="mdi-check" size="16" />
                  Оплачено
                </button>
                <button class="action-btn action-btn--warning" @click="openReschedule(p)">
                  <v-icon icon="mdi-calendar-clock" size="16" />
                  Перенести
                </button>
                <button
                  v-if="p.rescheduledFrom"
                  class="action-btn action-btn--ghost"
                  :disabled="undoingReschedule === p.id"
                  @click="confirmUndoReschedule(p)"
                >
                  <v-progress-circular v-if="undoingReschedule === p.id" indeterminate size="12" width="2" />
                  <v-icon v-else icon="mdi-calendar-refresh" size="16" />
                  Вернуть
                </button>
                <button
                  v-if="canDeleteAnyPayment"
                  class="action-btn action-btn--danger"
                  :disabled="removingPayment === p.id"
                  @click="confirmRemovePayment(p)"
                >
                  <v-progress-circular v-if="removingPayment === p.id" indeterminate size="12" width="2" />
                  <v-icon v-else icon="mdi-trash-can-outline" size="16" />
                  Удалить
                </button>
              </div>
              <div v-else-if="p.status === 'PAID'" class="sched-card-actions">
                <button
                  class="action-btn action-btn--danger"
                  :disabled="unpaidLoading === p.id"
                  @click="confirmUnmarkPaid(p)"
                >
                  <v-progress-circular v-if="unpaidLoading === p.id" indeterminate size="12" width="2" />
                  <v-icon v-else icon="mdi-undo" size="16" />
                  Отменить оплату
                </button>
              </div>
            </div>
          </div>

          <!-- Outstanding-balance banner. Surfaces when the schedule has
               been fully marked off but the deal still has a remaining
               amount — common with clients who chronically underpay.
               Gives the partner the two reasonable next moves. -->
          <!-- Schedule-was-extended notice. Surfaces the fact that
               the partner added rows on top of the original plan.
               Aggregate by design: deletes + re-adds reuse number
               slots so we can't safely tag individual rows. -->
          <div v-if="extraPaymentsCount > 0 && deal" class="extras-banner pa-5">
            <div class="extras-banner-icon">
              <v-icon icon="mdi-playlist-plus" size="22" color="#0ea5e9" />
            </div>
            <div class="extras-banner-content">
              <div class="extras-banner-title">
                График расширен на {{ extraPaymentsCount }}
                {{ pluralizeRu(extraPaymentsCount, 'платёж', 'платежа', 'платежей') }}
              </div>
              <div class="extras-banner-text">
                Изначально сделка была заключена на
                <strong>{{ deal.numberOfPayments }}</strong>
                {{ pluralizeRu(deal.numberOfPayments, 'платёж', 'платежа', 'платежей') }},
                сейчас в графике
                <strong>{{ payments.length }}</strong>
                {{ pluralizeRu(payments.length, 'строка', 'строки', 'строк') }}.
                {{ extraPaymentsCount }}
                {{ pluralizeRu(extraPaymentsCount, 'платёж', 'платежа', 'платежей') }}
                добавлен{{ extraPaymentsCount === 1 ? '' : 'о' }} вручную поверх исходного плана.
              </div>
            </div>
          </div>

          <div v-if="showLeftoverBanner && deal" class="leftover-banner pa-5">
            <div class="leftover-banner-icon">
              <v-icon icon="mdi-alert-circle-outline" size="22" color="#f59e0b" />
            </div>
            <div class="leftover-banner-content">
              <div class="leftover-banner-title">Не вся сумма оплачена</div>
              <div class="leftover-banner-text">
                В графике не хватает строк на
                <strong>{{ formatCurrency(uncoveredByPlan) }}</strong>
                — все существующие платежи в сумме меньше стоимости сделки.
              </div>
              <div class="leftover-banner-actions">
                <button class="leftover-btn leftover-btn--primary" @click="openAddPayment">
                  <v-icon icon="mdi-plus" size="16" />
                  Добавить платёж
                </button>
                <button class="leftover-btn leftover-btn--ghost" @click="openStatusDialog('forgive')">
                  <v-icon icon="mdi-handshake-outline" size="16" />
                  Закрыть с прощением долга
                </button>
              </div>
            </div>
          </div>
        </v-card>
      </div>

      <!-- Участники -->
      <div v-else-if="tab === 'participants'">
        <!-- Участники: клиент и поручители -->
        <DealParticipantsTab :deal="deal" :payments="payments" />
      </div>

      <!-- Со-инвесторы -->
      <div v-else-if="tab === 'investors'">
        <!-- Инвесторы кассы: доли по этой сделке -->
        <DealInvestorsTab :deal="deal" :profit="profit" />
      </div>

      <!-- Документы -->
      <div v-else-if="tab === 'docs'">
        <!-- Документы: PDF и фото договора -->
        <DealDocsTab :deal="deal" :payments="payments" />
      </div>

      <!-- История -->
      <div v-else>
        <!-- История: настоящий журнал с сервера, а не три события,
             собранные в браузере -->
        <DealHistoryTab :deal-id="dealId" />
      </div>

      <!-- Deleted banner -->
      <div v-if="isDeleted" class="trash-banner">
        <div class="trash-banner-stripe" />
        <div class="trash-banner-content">
          <div class="trash-banner-icon">
            <v-icon icon="mdi-delete-clock-outline" size="22" />
          </div>
          <div class="trash-banner-text">
            <div class="trash-banner-title">Сделка в корзине</div>
            <div class="trash-banner-desc">
              Удалена {{ deal?.deletedAt ? timeAgo(deal.deletedAt) : '' }}
              <span class="trash-banner-dot">·</span>
              автоматически исчезнет через 30 дней
            </div>
          </div>
          <div class="trash-banner-actions">
            <button
              class="trash-btn trash-btn--restore"
              :disabled="deleting"
              @click="restoreDeal"
            >
              <v-progress-circular v-if="deleting" indeterminate size="14" width="2" color="white" />
              <v-icon v-else icon="mdi-restore" size="16" />
              <span>Восстановить</span>
            </button>
            <button
              class="trash-btn trash-btn--delete"
              :disabled="deleting"
              @click="permanentDeleteDeal"
            >
              <v-icon icon="mdi-delete-forever-outline" size="16" />
              <span>Удалить навсегда</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Delete deal -->
      <div v-else class="delete-deal-bar" :class="{ 'delete-deal-bar--hover': !deleting }">
        <div class="d-flex align-center ga-3">
          <div class="delete-deal-icon">
            <v-icon icon="mdi-delete-outline" size="18" />
          </div>
          <div>
            <div class="delete-deal-title">Удалить сделку</div>
            <div class="delete-deal-desc">Сделка будет перемещена в корзину</div>
          </div>
        </div>
        <button
          class="delete-deal-btn"
          :class="{ 'delete-deal-btn--loading': deleting }"
          :disabled="deleting"
          @click="confirmDeleteDeal"
        >
          <v-progress-circular v-if="deleting" indeterminate size="16" width="2" color="white" />
          <v-icon v-else icon="mdi-delete-outline" size="16" />
          <span>{{ deleting ? 'Удаление...' : 'В корзину' }}</span>
        </button>
      </div>

      <!-- Reschedule dialog -->
      <!-- Перенос даты — общий компонент: тот же диалог, что на странице
           платежей и в превью сделки. -->
      <ReschedulePaymentDialog
        v-model="rescheduleDialog"
        :payment="rescheduleTarget"
        :fullscreen="isMobile"
        @rescheduled="onRescheduled"
      />

      <!-- Status change dialog -->
      <v-dialog v-model="statusDialog" max-width="520" :fullscreen="isMobile">
        <v-card rounded="lg" class="pa-6">
          <div v-if="statusAction" class="d-flex align-start ga-4 mb-4">
            <div class="status-dialog-icon" :style="{ background: statusAction.color + '18' }">
              <v-icon :icon="statusAction.icon" size="24" :color="statusAction.color" />
            </div>
            <div class="flex-grow-1">
              <h3 class="text-h6 font-weight-bold mb-1">{{ statusAction.label }}</h3>
              <p v-if="!hasUnpaidPayments" class="text-body-2 text-medium-emphasis ma-0">
                Все платежи оплачены — сделка будет зафиксирована как завершённая.
              </p>
              <p v-else class="text-body-2 text-medium-emphasis ma-0">
                <strong>Остаток: {{ formatCurrency(deal?.remainingAmount || 0) }}</strong>
                · {{ unpaidCount }} {{ pluralizeRu(unpaidCount, 'неоплаченный платёж', 'неоплаченных платежа', 'неоплаченных платежей') }}.
                Выберите как поступить с ними:
              </p>
            </div>
          </div>

          <!-- Close mode options — only when there's unpaid -->
          <div v-if="hasUnpaidPayments" class="close-modes mb-5">
            <label class="close-mode-card" :class="{ active: closeMode === 'paid_early' }">
              <input v-model="closeMode" type="radio" value="paid_early" />
              <div class="close-mode-content">
                <div class="d-flex align-center ga-2">
                  <v-icon icon="mdi-check-circle-outline" size="18" color="success" />
                  <span class="close-mode-title">Клиент полностью рассчитался</span>
                </div>
                <div class="close-mode-desc">
                  Долг покрыт ранее (например, переплатой). Платежи получат статус «Закрыт заранее».
                </div>
              </div>
            </label>

            <label class="close-mode-card" :class="{ active: closeMode === 'forgive' }">
              <input v-model="closeMode" type="radio" value="forgive" />
              <div class="close-mode-content">
                <div class="d-flex align-center ga-2">
                  <v-icon icon="mdi-hand-heart-outline" size="18" color="info" />
                  <span class="close-mode-title">Списать долг</span>
                </div>
                <div class="close-mode-desc">
                  Прощаете остаток. Платежи закрываются с пометкой «Долг прощён».
                </div>
              </div>
            </label>

            <label class="close-mode-card" :class="{ active: closeMode === 'force' }">
              <input v-model="closeMode" type="radio" value="force" />
              <div class="close-mode-content">
                <div class="d-flex align-center ga-2">
                  <v-icon icon="mdi-alert-circle-outline" size="18" color="error" />
                  <span class="close-mode-title">Закрыть с долгом</span>
                </div>
                <div class="close-mode-desc">
                  Сделка закрывается, неоплаченные платежи остаются как просрочка. Учитывается в аналитике как убыток.
                </div>
              </div>
            </label>
          </div>

          <div class="d-flex ga-3">
            <button class="btn-secondary flex-grow-1" @click="statusDialog = false">Отмена</button>
            <button
              class="btn-primary flex-grow-1"
              :style="statusAction ? { background: statusAction.color } : {}"
              :disabled="statusUpdating"
              @click="confirmStatusChange"
            >
              <v-progress-circular v-if="statusUpdating" indeterminate size="16" width="2" color="white" class="mr-2" />
              Завершить сделку
            </button>
          </div>
        </v-card>
      </v-dialog>

      <!-- Отметка оплаты — общий компонент: та же модалка, что на странице
           платежей и в превью сделки (сумма, фактическая дата, перерасчёт
           графика, хвостовой платёж, квитанция, скриншот). График у страницы
           уже загружен — передаём его, чтобы компонент не запрашивал повторно. -->
      <!-- То же окно оплаты, что в списке сделок -->
      <QuickPayDialog
        v-model="quickPayDialog"
        :payment="quickPayTarget"
        :deal="deal ?? null"
        :fullscreen="isMobile"
        @paid="onQuickPayDone"
      />

      <MarkPaidDialog
        v-model="markPaidDialog"
        :payment="markPaidTarget"
        :deal="deal"
        :schedule="payments"
        :fullscreen="isMobile"
        @paid="onMarkPaidDone"
      />

      <!-- Скидка на остаток договора: долг уменьшается, договор действует. -->
      <DealDiscountDialog
        v-model="discountDialog"
        :deal="deal"
        :schedule="payments"
        :fullscreen="isMobile"
        @applied="onDiscountApplied"
      />

      <!-- Add tail payment dialog. Triggered by «Добавить платёж» next to
           the schedule. Defaults to outstanding balance + next interval
           after the latest payment's dueDate. -->
      <v-dialog v-model="addPaymentDialog" max-width="440" :fullscreen="isMobile">
        <v-card rounded="lg" class="pa-6">
          <div class="d-flex align-center ga-2 mb-1">
            <v-icon icon="mdi-cash-plus" color="primary" size="22" />
            <div class="text-h6 font-weight-bold">Добавить платёж</div>
          </div>
          <div class="text-body-2 text-medium-emphasis mb-4">
            Дополнительная строка в график — например, если у клиента остался долг после окончания плана.
          </div>

          <div class="mb-4">
            <label class="field-label">Сумма платежа</label>
            <div class="input-with-suffix">
              <input
                :value="addPaymentAmount || ''"
                v-maska="CURRENCY_MASK"
                @maska="(e: any) => addPaymentAmount = parseMasked(e)"
                type="text"
                inputmode="numeric"
                class="field-input"
              />
              <span class="input-suffix">₽</span>
            </div>
          </div>

          <div class="mb-4">
            <label class="field-label">Дата платежа</label>
            <DateField v-model="addPaymentDueDate" plain />
          </div>

          <div class="mb-5">
            <label class="field-label">Комментарий (необязательно)</label>
            <input
              v-model="addPaymentNote"
              type="text"
              maxlength="200"
              placeholder="Например: остаток после недоплат"
              class="field-input"
            />
          </div>

          <div class="d-flex ga-3">
            <button class="btn-secondary flex-grow-1" @click="addPaymentDialog = false">Отмена</button>
            <button
              class="btn-primary flex-grow-1"
              :disabled="addPaymentSubmitting || !addPaymentAmount || !addPaymentDueDate"
              @click="confirmAddPayment"
            >
              <v-progress-circular v-if="addPaymentSubmitting" indeterminate size="16" width="2" color="white" class="mr-1" />
              <v-icon v-else icon="mdi-plus" size="16" />
              Добавить
            </button>
          </div>
        </v-card>
      </v-dialog>

      <!-- Out-of-order warning dialog -->
      <v-dialog v-model="outOfOrderDialog" max-width="440" :fullscreen="isMobile">
        <v-card rounded="lg" class="pa-6">
          <button class="dialog-close-sm" @click="dismissOutOfOrder">
            <v-icon icon="mdi-close" size="18" />
          </button>
          <div class="d-flex align-center ga-2 mb-2">
            <v-icon icon="mdi-alert-circle-outline" color="warning" size="22" />
            <div class="text-h6 font-weight-bold">Платежи не по порядку</div>
          </div>
          <div class="text-body-2 text-medium-emphasis mb-4">
            Раньше этого платежа есть неоплаченные. Чтобы остаток и график считались корректно, рекомендуется отмечать платежи по порядку.
          </div>
          <div class="ooo-list mb-4">
            <div v-for="p in earlierUnpaid" :key="p.id" class="ooo-row">
              <span class="ooo-num">№{{ p.number }}</span>
              <span class="ooo-date">{{ formatDate(p.dueDate) }}</span>
              <span class="ooo-amount">{{ formatCurrency(p.amount) }}</span>
            </div>
          </div>
          <div class="d-flex flex-column ga-2">
            <button class="btn-primary" @click="markEarlierFirst">
              Сначала отметить №{{ earlierUnpaid[0]?.number }}
            </button>
            <button class="btn-secondary" @click="markOutOfOrderAnyway">
              Всё равно отметить этот
            </button>
          </div>
        </v-card>
      </v-dialog>

      <!-- Proof enlarge dialog -->
      <v-dialog v-model="proofEnlargeDialog" max-width="600">
        <v-card rounded="lg" class="pa-2">
          <button class="dialog-close-sm" style="position: absolute; top: 8px; right: 8px; z-index: 1;" @click="proofEnlargeDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
          <img :src="proofEnlargeUrl" style="width: 100%; border-radius: 12px; display: block;" />
        </v-card>
      </v-dialog>
    </div>

    <!-- Not found -->
    <div v-else class="text-center pa-12">
      <v-icon icon="mdi-alert-circle-outline" size="56" color="grey-lighten-1" class="mb-3" />
      <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Сделка не найдена</p>
      <v-btn variant="tonal" color="primary" class="mt-4" @click="router.push('/deals')">
        Вернуться к портфелю
      </v-btn>
    </div>

    <!-- Move cashbox dialog -->
    <v-dialog v-model="showMoveCashbox" max-width="480" persistent :fullscreen="isMobile">
      <v-card rounded="lg" class="move-cb-card">
        <div class="move-cb-header">
          <v-icon icon="mdi-briefcase-arrow-right-outline" color="primary" size="22" />
          <div>
            <div class="move-cb-title">Перенести в другую кассу</div>
            <div class="move-cb-sub">
              Сейчас в «{{ dealCashBox?.name || '—' }}». Вся история операций тоже переедет.
            </div>
          </div>
        </div>
        <div class="move-cb-body">
          <v-select
            v-model="moveTargetCashBoxId"
            :items="moveTargets"
            item-title="name"
            item-value="id"
            label="Касса-получатель"
            variant="outlined"
            density="compact"
            hide-details
          />
          <div class="move-cb-warn">
            <v-icon icon="mdi-information-outline" size="16" color="#f59e0b" />
            <span>Баланс обеих касс пересчитается автоматически.</span>
          </div>
        </div>
        <div class="move-cb-footer">
          <v-btn variant="text" :disabled="movingCashbox" @click="showMoveCashbox = false">Отмена</v-btn>
          <v-btn color="primary" :loading="movingCashbox" @click="handleMoveCashbox">Перенести</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Подписи по краям полосы прогресса: процент без сумм мало что говорит,
   но разворачивать здесь целую сводку незачем — она в «Деньгах по сделке». */
.pg-ends {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}
.pg-end {
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-variant-numeric: tabular-nums;
}

/* Номер договора — отдельной строкой под названием товара: раньше он стоял
   перед названием и первым бросался в глаза, хотя ищут сделку по товару. */
.detail-hero-num {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.65);
  margin-top: 2px;
}

.profit-got { text-align: right; }
.profit-got-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.profit-got-value {
  font-size: 18px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* ── Деньги по сделке ───────────────────────────────────────────────────
   Название крупное и жирное, под ним пояснение «откуда это число» — оно
   дополняет заголовок, а не повторяет его. Высота строк одинаковая, поэтому
   пояснение есть у каждой. Зелёным выделены два числа, ради которых сюда
   заходят: сумма договора и остаток к получению. */
.dm-card {
  overflow: hidden;
}
.dm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
}
.dm-head-title {
  font-size: 16px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.dm-switch {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.dm-switch-btn {
  width: 30px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.45);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.dm-switch-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.dm-switch-btn--on {
  background: rgb(var(--v-theme-surface));
  color: #047857;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

/* Карточный вид: те же показатели, значение крупно, пояснение снизу.
   Две в ряд, значение справа — взгляд идёт по правому краю и сравнивает
   суммы между собой, как в списке. На телефоне колонка одна. */
.dm-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 4px 20px 20px;
}
@media (max-width: 560px) {
  .dm-cards { grid-template-columns: minmax(0, 1fr); }
}
.dm-cell {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 12px;
}
.dm-cell-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.dm-cell-title {
  font-size: 14.5px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.88);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-cell-val {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: right;
}
.dm-cell-val--key {
  font-size: 20px;
  font-weight: 800;
}
.dm-cell-sub {
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-cell--key {
  background: rgba(4, 120, 87, 0.05);
  border-color: rgba(4, 120, 87, 0.2);
}
.dm-cell--key .dm-cell-title,
.dm-cell-val--key {
  color: #047857;
}
.dm-cell--alert {
  background: rgba(239, 68, 68, 0.05);
  border-color: rgba(239, 68, 68, 0.2);
}
.dm-cell--alert .dm-cell-title,
.dm-cell--alert .dm-cell-val {
  color: #dc2626;
}
.dm-cell--alert .dm-cell-sub {
  color: rgba(220, 38, 38, 0.7);
}
.dm-group {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.dm-row {
  display: flex;
  align-items: center;
  gap: 14px;
  /* Одна высота у всех строк: с пояснением или без. */
  height: 64px;
  padding: 0 20px;
}
.dm-row + .dm-row {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.04);
}
.dm-ico {
  width: 34px;
  height: 34px;
  min-width: 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dm-ico--plain {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.dm-ico--good {
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
}
.dm-ico--info {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}
.dm-ico--key {
  background: rgba(4, 120, 87, 0.12);
  color: #047857;
}
.dm-ico--alert {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}
.dm-key {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dm-key-title {
  font-size: 15px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.88);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-key-sub {
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-val {
  font-size: 18px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
/* Сумма договора и остаток — основным цветом сервиса. */
.dm-row--key {
  background: rgba(4, 120, 87, 0.04);
}
.dm-row--key .dm-key-title {
  color: #047857;
}
.dm-val--key {
  font-size: 20px;
  font-weight: 800;
  color: #047857;
}
.dm-row--alert {
  background: rgba(239, 68, 68, 0.05);
}
.dm-row--alert .dm-key-title,
.dm-row--alert .dm-val {
  color: #dc2626;
}
.dm-row--alert .dm-key-sub {
  color: rgba(220, 38, 38, 0.7);
}

/* Кнопки действий в шапке: оплата рядом с завершением сделки. */
.status-action-buttons {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
/* Специфичность повышена намеренно: базовое правило .status-action-btn идёт
   ниже по файлу и иначе перекрывает цвет — кнопка становится белой на белом. */
.status-action-btn.status-action-btn--ghost {
  background: transparent;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.status-action-btn.status-action-btn--ghost:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
  color: rgb(var(--v-theme-primary));
  opacity: 1;
}

/* Полоса разделов сделки: общий стиль вкладок проекта + отступ снизу. */
.deal-tabs {
  margin-bottom: 20px;
}

.deal-comment-input {
  width: 100%; padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none; resize: vertical;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-family: inherit;
}
.deal-comment-input:focus { border-color: #047857; }
.deal-comment-text {
  font-size: 14px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: pre-wrap;
}
.deal-comment-empty {
  font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Экран тарифной блокировки сделки */
.deal-locked-screen {
  max-width: 460px; margin: 40px auto; text-align: center;
  padding: 32px 24px; border-radius: 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.deal-locked-icon {
  width: 72px; height: 72px; border-radius: 18px; margin: 0 auto 16px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(245, 158, 11, 0.14); color: #b45309;
}
.deal-locked-title { font-size: 19px; font-weight: 800; color: rgba(var(--v-theme-on-surface), 0.9); }
.deal-locked-sub {
  font-size: 13.5px; line-height: 1.5; margin-top: 8px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.deal-locked-actions { display: flex; gap: 10px; margin-top: 22px; }
.dl-btn {
  flex: 1; padding: 11px 16px; border-radius: 11px;
  font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.dl-btn--ghost {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.dl-btn--ghost:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.dl-btn--primary { background: rgb(var(--v-theme-primary)); color: #fff; }
.dl-btn--primary:hover { opacity: 0.9; }


/* Hero */
.detail-hero {
  position: relative; border-radius: 16px; overflow: hidden;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  /* На зелёной подложке ссылка-имя должна быть белой, иначе сливается. */
  --client-link-color: #fff;
  --client-link-underline: rgba(255, 255, 255, 0.6);
  display: flex; align-items: stretch;
  min-height: 180px;
  padding: 28px 32px;
  gap: 24px;
}
.detail-hero-content {
  flex: 1; min-width: 0; z-index: 2; color: #fff;
  display: flex; flex-direction: column; justify-content: flex-start;
}
.detail-hero-status {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  font-size: 12px; font-weight: 600;
  padding: 5px 12px; border-radius: 999px;
  background: #fff; margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.detail-hero-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.3);
}
.detail-hero-title {
  font-size: 28px; font-weight: 700; line-height: 1.2; margin-bottom: 8px;
  word-break: break-word;
  display: inline-flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
}
.detail-hero-num {
  font-size: 18px;
  font-weight: 700;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.detail-hero-meta {
  font-size: 14px; opacity: 0.85;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  margin-top: auto;
}
.detail-hero-actions {
  position: absolute; top: 16px; right: 16px; z-index: 3;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  justify-content: flex-end;
}
.detail-hero-edit {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.15s ease;
}
.detail-hero-edit:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}
.detail-hero-edit:active {
  transform: translateY(0);
}
.detail-hero-cashbox {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.25);
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.15s ease;
}
.detail-hero-cashbox:hover {
  background: rgba(255, 255, 255, 0.28);
  border-color: rgba(255, 255, 255, 0.4);
  transform: translateY(-1px);
}

/* Move-cashbox dialog */
.move-cb-card { background: rgb(var(--v-theme-surface)); }
.move-cb-header {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.move-cb-title {
  font-size: 15px; font-weight: 700;
  color: rgb(var(--v-theme-on-surface));
}
.move-cb-sub {
  font-size: 12px; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.move-cb-body {
  padding: 20px; display: flex; flex-direction: column; gap: 14px;
}
.move-cb-warn {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(245, 158, 11, 0.1);
  color: #92400e; font-size: 12px;
}
.v-theme--dark .move-cb-warn { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
.move-cb-footer {
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.detail-hero-photo {
  flex-shrink: 0;
  width: 180px; height: 140px;
  border-radius: 12px; overflow: hidden;
  align-self: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.detail-hero-photo img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.detail-hero-photo--empty {
  display: flex; align-items: center; justify-content: center;
}
.detail-hero-photo-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  color: rgba(255, 255, 255, 0.55); font-size: 11px; text-align: center;
  padding: 0 12px;
}
@media (max-width: 599px) {
  .detail-hero {
    flex-direction: column; padding: 20px;
  }
  .detail-hero-photo {
    width: 100%; height: 160px;
  }
  .detail-hero-title { font-size: 22px; }
  .detail-hero-content {
    margin-top: 16px;
  }
}

/* Finance grid */
.finance-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 768px) { .finance-grid { grid-template-columns: repeat(2, 1fr); } }

.finance-card {
  padding: 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.finance-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 4px;
}
.finance-value {
  font-size: 17px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.finance-value--lg { font-size: 20px; }
.finance-card--wholesale {
  background: rgba(99, 102, 241, 0.04);
  border-color: rgba(99, 102, 241, 0.18);
}
.finance-card--overdue {
  background: rgba(239, 68, 68, 0.04);
  border-color: rgba(239, 68, 68, 0.20);
}
.finance-sub {
  font-size: 11px;
  margin-top: 4px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Profit breakdown card */
/* ── Прибыль по сделке ──────────────────────────────────────────────────
   Карточка стоит в «Обзоре» под «Деньгами по сделке» — то есть среди обычных
   белых карточек, поэтому и сама белая: зелёная подложка тут спорила бы с
   соседями и тянула внимание на себя. Читается сверху вниз: что заработала
   сделка → сколько уходит инвесторам → сколько остаётся вам. */
.profit-card {
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.87);
}
.pf-head-title {
  font-size: 17px;
  font-weight: 700;
}
.pf-head-sub {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.pf-section {
  margin-top: 20px;
}
/* Доли инвесторов — визуально отдельный блок: это вычет, а не продолжение
   списка заработанного. */
.pf-section--investors {
  background: rgba(var(--v-theme-on-surface), 0.035);
  border-radius: 12px;
  padding: 14px 16px 6px;
  margin-top: 18px;
}
.pf-section-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.42);
  margin-bottom: 8px;
}
.pf-section-total {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
  color: #b45309;
  white-space: nowrap;
}
.pf-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
}
.pf-row + .pf-row {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.pf-row-name {
  font-size: 14.5px;
  font-weight: 600;
  min-width: 0;
}
.pf-row-formula {
  display: block;
  font-size: 12px;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.pf-row-value {
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
/* Вычет — тем же янтарным, что «уходит инвесторам»: цвет здесь означает
   «эти деньги не ваши», а не «плохо». */
.pf-row-value--minus {
  color: #b45309;
}
.pf-hint {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: 12.5px;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.5);
  padding: 8px 0 2px;
}
/* Итог — две главные цифры блока, поэтому крупные и на отдельной полосе. */
.pf-total {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.pf-total-got {
  text-align: right;
}
.pf-total-label {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.pf-total-value {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: #047857;
}
.pf-total-got-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}
.pf-total-formula {
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 3px;
}
.pf-bar {
  height: 8px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden;
  margin-top: 14px;
}
.pf-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #10b981, #047857);
  border-radius: 4px;
  transition: width 0.3s;
}

.profit-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.profit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}
.profit-label {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.profit-formula {
  display: block;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-family: ui-monospace, monospace;
  margin-top: 2px;
}
.profit-amount {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-variant-numeric: tabular-nums;
}
.profit-row--negative .profit-amount {
  color: #b45309;
}
.profit-row--total {
  margin-top: 6px;
  padding: 10px 12px;
  background: rgba(22, 163, 74, 0.08);
  border-radius: 8px;
}
.profit-row--total .profit-label {
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.profit-amount--total {
  font-size: 18px;
  font-weight: 800;
  color: #16a34a;
}
.profit-mode-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(99, 102, 241, 0.06);
  border-radius: 8px;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.65);
  line-height: 1.4;
}
.profit-realized {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
}
.profit-realized-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.65);
  margin-bottom: 6px;
}
.profit-realized-row strong {
  font-size: 14px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-variant-numeric: tabular-nums;
}
.profit-realized-bar {
  height: 6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 3px;
  overflow: hidden;
}
.profit-realized-fill {
  height: 100%;
  background: linear-gradient(90deg, #16a34a, #22c55e);
  border-radius: 3px;
  transition: width 0.3s ease-out;
}
.profit-realized-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 4px;
  text-align: right;
}

/* Section titles */
.section-title {
  font-size: 16px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.section-subtitle {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.progress-percent {
  font-size: 24px; font-weight: 700; color: rgb(var(--v-theme-primary));
}

/* Schedule table */
.schedule-table :deep(td) { font-size: 14px; }
.schedule-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}
.row-paid { opacity: 0.55; }
.row-overdue { background: rgba(239, 68, 68, 0.04); }
.pay-status {
  display: inline-block; font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px; white-space: nowrap;
}

/* Client card */

/* Deal details list */
.deal-detail-list {
  display: flex; flex-direction: column; gap: 10px;
}
.deal-detail-row {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.deal-detail-row:last-child { border-bottom: none; padding-bottom: 0; }
.deal-detail-label {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.deal-detail-val {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Timeline */

/* Action buttons */
.action-btn {
  width: 30px; height: 30px; border-radius: 8px; border: none;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.action-btn--success {
  background: rgba(4, 120, 87, 0.08); color: #047857;
}
.action-btn--success:hover {
  background: rgba(4, 120, 87, 0.18);
}
.action-btn--warning {
  background: rgba(245, 158, 11, 0.08); color: #f59e0b;
}
.action-btn--warning:hover {
  background: rgba(245, 158, 11, 0.18);
}
.action-btn--ghost {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.action-btn--ghost:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.action-btn--ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.action-btn--wa {
  background: rgba(37, 211, 102, 0.08); color: #25D366;
}
.action-btn--wa:hover {
  background: rgba(37, 211, 102, 0.18);
}
.action-btn--danger {
  background: rgba(239, 68, 68, 0.08); color: #ef4444;
}
.action-btn--danger:hover {
  background: rgba(239, 68, 68, 0.18);
}

/* "Schedule was extended" info banner under the schedule */
.extras-banner {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  border-top: 1px solid rgba(14, 165, 233, 0.18);
  background: rgba(14, 165, 233, 0.04);
}
.extras-banner-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(14, 165, 233, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.extras-banner-content { flex: 1; min-width: 0; }
.extras-banner-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.92);
  margin-bottom: 4px;
}
.extras-banner-text {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  line-height: 1.45;
}
.extras-banner-text strong {
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-weight: 700;
}

/* "Outstanding balance, no rows left" banner under the schedule */
.leftover-banner {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  border-top: 1px solid rgba(245, 158, 11, 0.18);
  background: rgba(245, 158, 11, 0.04);
}
.leftover-banner-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.leftover-banner-content { flex: 1; min-width: 0; }
.leftover-banner-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.92);
  margin-bottom: 4px;
}
.leftover-banner-text {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  line-height: 1.45;
  margin-bottom: 12px;
}
.leftover-banner-text strong {
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-weight: 700;
}
.leftover-banner-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.leftover-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s;
}
.leftover-btn--primary {
  border: none;
  background: #047857;
  color: white;
}
.leftover-btn--primary:hover { background: #036249; }
.leftover-btn--ghost {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.18);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.leftover-btn--ghost:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.3);
  color: rgba(var(--v-theme-on-surface), 0.95);
}

/* «Добавить платёж» button in the schedule header */
.add-payment-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid rgba(4, 120, 87, 0.25);
  background: rgba(4, 120, 87, 0.06);
  color: #047857;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s;
}
.add-payment-btn:hover {
  background: rgba(4, 120, 87, 0.12);
  border-color: rgba(4, 120, 87, 0.4);
}
.add-payment-btn:disabled {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.35);
  cursor: not-allowed;
}
.add-payment-btn:disabled:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: rgba(var(--v-theme-on-surface), 0.1);
}
.add-payment-info {
  color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: help;
}
.add-payment-info:hover { color: rgba(var(--v-theme-on-surface), 0.7); }

/* Reminder buttons */
/* Deal reminder settings */
.deal-day-chip.active { background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); }


/* Rescheduled hint */
.rescheduled-hint {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: #f59e0b; margin-top: 2px;
  text-decoration: line-through;
  text-decoration-color: rgba(245, 158, 11, 0.4);
}

/* Overdue chip in payments table — explicit "просрочен на N дней" hint */
.overdue-chip {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 11px; font-weight: 700;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
  border-radius: 5px;
  white-space: nowrap;
}

/* Reschedule dialog */
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

/* Contract download */

/* Delete deal */
.delete-deal-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  margin-top: 24px;
  border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgba(var(--v-theme-on-surface), 0.02);
  transition: all 0.2s;
}

.delete-deal-bar--hover:hover {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.02);
}

.delete-deal-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.delete-deal-bar--hover:hover .delete-deal-icon {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

.delete-deal-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  transition: color 0.2s;
}

.delete-deal-bar--hover:hover .delete-deal-title {
  color: #ef4444;
}

.delete-deal-desc {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.3);
}

.delete-deal-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  border: none;
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.delete-deal-btn:hover {
  background: #ef4444;
  color: #fff;
}

.delete-deal-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.delete-deal-btn--loading {
  background: #ef4444;
  color: #fff;
}

.dark .delete-deal-bar {
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-color: rgb(var(--v-theme-border));
}

/* ── Deleted strip ── */
.deleted-strip {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.14);
}

.deleted-strip-icon {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
}

.deleted-strip-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.deleted-strip-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.deleted-strip-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.deleted-strip-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-surface), 1);
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.deleted-strip-btn:hover:not(:disabled) {
  border-color: rgba(4, 120, 87, 0.4);
  color: #047857;
  background: rgba(4, 120, 87, 0.04);
}

.deleted-strip-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dark .deleted-strip {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
}

.dark .deleted-strip-btn {
  background: rgb(var(--v-theme-surface));
  border-color: rgb(var(--v-theme-border));
}

@media (max-width: 600px) {
  .deleted-strip-sub { display: none; }
}

/* ── Trash banner ── */
.trash-banner {
  position: relative;
  margin-top: 24px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.06) 0%, rgba(245, 158, 11, 0.02) 100%);
  border: 1px solid rgba(245, 158, 11, 0.18);
  overflow: hidden;
}

.trash-banner-stripe {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, #f59e0b 0%, #d97706 100%);
}

.trash-banner-content {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 22px 18px 26px;
}

.trash-banner-icon {
  width: 44px;
  height: 44px;
  min-width: 44px;
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
  display: flex;
  align-items: center;
  justify-content: center;
}

.trash-banner-text {
  flex: 1;
  min-width: 0;
}

.trash-banner-title {
  font-size: 15px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.92);
  letter-spacing: -0.01em;
}

.trash-banner-desc {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}

.trash-banner-dot {
  opacity: 0.4;
  margin: 0 4px;
}

.trash-banner-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.trash-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
}

.trash-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.trash-btn--restore {
  background: #047857;
  color: #fff;
  box-shadow: 0 1px 2px rgba(4, 120, 87, 0.15), 0 4px 12px rgba(4, 120, 87, 0.18);
}

.trash-btn--restore:hover:not(:disabled) {
  background: #065f46;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(4, 120, 87, 0.2), 0 8px 20px rgba(4, 120, 87, 0.25);
}

.trash-btn--delete {
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.trash-btn--delete:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

.dark .trash-banner {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.03) 100%);
  border-color: rgba(245, 158, 11, 0.25);
}

@media (max-width: 600px) {
  .trash-banner-content {
    flex-wrap: wrap;
  }
  .trash-banner-actions {
    width: 100%;
    justify-content: flex-end;
  }
}

/* Contract photos */

/* Status action banner */
.status-action-banner {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-radius: 12px;
  border: 1px solid; gap: 16px;
  background: rgba(var(--v-theme-surface), 1);
}
.status-action-info {
  display: flex; align-items: center; gap: 12px;
}
.status-action-title {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.status-action-label {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.status-action-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 20px; border-radius: 10px; border: none;
  color: #fff; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.status-action-btn:hover { opacity: 0.9; }

/* Status dialog */
.status-dialog-icon {
  width: 48px; height: 48px; min-width: 48px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
}

/* Close mode picker */
.close-modes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.close-mode-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgba(var(--v-theme-on-surface), 0.02);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.close-mode-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
}
.close-mode-card.active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.05);
}
.close-mode-card input[type="radio"] {
  margin-top: 4px;
  accent-color: rgb(var(--v-theme-primary));
  cursor: pointer;
}
.close-mode-content {
  flex: 1;
  min-width: 0;
}
.close-mode-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.close-mode-desc {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 4px;
  line-height: 1.45;
}

@media (max-width: 600px) {
  .status-action-banner { flex-direction: column; align-items: stretch; }
  .status-action-btn { justify-content: center; }
}

/* Dark mode */
.dark .status-action-banner {
  background: rgb(var(--v-theme-surface));
}
.dark .finance-card {
  background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border));
}
.dark .dialog-finance-item { background: rgba(255, 255, 255, 0.04); }

/* Proof screenshot */
.proof-thumbnail {
  width: 36px; height: 36px; border-radius: 6px;
  object-fit: cover; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  transition: all 0.15s;
}
.proof-thumbnail:hover {
  border-color: rgba(4, 120, 87, 0.3);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
/* PDF documents card */

/* Row wrapper that pairs the download button with a small WhatsApp action */

.dark .pdf-docs-header { border-color: rgba(255,255,255,0.06); }
.dark .pdf-doc-item { border-color: rgba(255,255,255,0.04); }
.dark .pdf-doc-row { border-color: rgba(255,255,255,0.04); }
.dark .pdf-wa-btn { border-color: rgba(255,255,255,0.06); }
.dark .pdf-doc-item:hover { background: rgba(255,255,255,0.02); }

@media (max-width: 960px) {
  .detail-hero-title { font-size: 22px; }
  .detail-hero-photo { width: 140px; height: 110px; }
}

/* Profile card (client & guarantor) */

/* ─── Co-Investors Section ─── */

.ci-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.ci-header-icon {
  width: 40px; height: 40px; min-width: 40px; border-radius: 10px;
  background: rgba(245, 158, 11, 0.1); color: #f59e0b;
  display: flex; align-items: center; justify-content: center;
}
.ci-header-title {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.ci-header-sub {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 1px;
}

.ci-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 14px; border-radius: 8px; border: none;
  background: rgba(245, 158, 11, 0.1); color: #f59e0b;
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.ci-add-btn:hover { background: rgba(245, 158, 11, 0.18); }
.ci-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.sup-debt-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 700; white-space: nowrap;
}
.sup-debt-badge--open { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
.sup-debt-badge--paid { background: rgba(4, 120, 87, 0.12); color: #047857; }

/* Menu dropdown */
.ci-menu { overflow: hidden; }
.ci-menu-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.ci-menu-list { padding: 6px; }
.ci-menu-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 12px; border-radius: 10px; border: none;
  background: transparent; cursor: pointer; transition: all 0.12s;
  text-align: left;
}
.ci-menu-item:hover { background: rgba(245, 158, 11, 0.06); }
.ci-menu-item--active {
  background: rgba(99, 102, 241, 0.08);
  color: #6366f1; font-weight: 600;
}
.ci-menu-divider {
  height: 1px; background: rgba(var(--v-theme-on-surface), 0.06);
  margin: 4px 6px;
}
.ci-menu-empty {
  padding: 16px 12px; text-align: center;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.ci-menu-item:hover .ci-menu-item-action { color: #f59e0b; }

/* Avatar */

/* Cards */


/* Empty state */

/* Dark overrides */
.dark .ci-header { border-color: rgba(255,255,255,0.06); }
.dark .ci-card { border-color: rgba(255,255,255,0.05); }
.dark .ci-card:hover { background: rgba(255,255,255,0.02); }
.dark .ci-menu-header { border-color: rgba(255,255,255,0.06); }
.dark .ci-card-remove { background: rgba(239, 68, 68, 0.1); }


/* Guarantor list items */

/* Guarantor picker */

/* Create client button */
.dark .create-client-btn {
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-color: rgba(var(--v-theme-on-surface), 0.1);
}

.ooo-list {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 10px;
  overflow: hidden;
  max-height: 180px;
  overflow-y: auto;
}
.ooo-row {
  display: grid;
  grid-template-columns: 60px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  font-size: 13px;
}
.ooo-row + .ooo-row {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.ooo-num { font-weight: 600; }
.ooo-date { color: rgba(var(--v-theme-on-surface), 0.6); }
.ooo-amount { font-weight: 600; }

.plan-vs-fact {
  font-size: 11px; font-weight: 500;
  margin-top: 2px; line-height: 1.2;
}

/* «Оплачен не в свой месяц» — приглушённый чип, доход учтён по факту оплаты. */
.offmonth-chip {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10.5px; font-weight: 600;
  margin-top: 3px; padding: 1px 6px; border-radius: 6px;
  line-height: 1.3;
}
.offmonth-chip--early { color: #059669; background: rgba(16, 185, 129, 0.1); }
.offmonth-chip--late { color: #d97706; background: rgba(245, 158, 11, 0.1); }

/* ───── Mobile: schedule cards вместо широкой таблицы ───── */
.schedule-cards {
  display: none;
  padding: 12px 14px 14px;
}

@media (max-width: 767px) {
  .schedule-table--desktop { display: none !important; }
  .schedule-cards { display: flex; flex-direction: column; gap: 10px; }

  /* Финансовая сетка на мобиле — 2 колонки уже есть (768px),
     но карточки сами по себе крупные. Чуть компактнее. */
  .finance-card { padding: 12px; }

  /* Hero — фото поменьше на мобиле, чтобы не съедало пол-экрана. */
  .detail-hero-photo {
    height: 140px !important;
  }
}

.sched-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}
.sched-card--overdue {
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.02);
}
.sched-card--paid {
  background: rgba(16, 185, 129, 0.03);
}
.sched-card--closed {
  opacity: 0.6;
}
.sched-card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.sched-card-num {
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.sched-card-date-value {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.92);
}
.sched-card-amounts {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  padding: 10px 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-radius: 10px;
}
.sched-card-amount-label {
  font-size: 11px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-bottom: 2px;
}
.sched-card-amount-value {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.sched-card-amount-value--muted {
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.sched-card-paid {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.sched-card-paid-date {
  display: inline-flex; align-items: center; gap: 4px;
}
.sched-card-paid-date .v-icon { color: #10b981; }
.sched-card-proof {
  width: 40px; height: 40px;
}
.sched-card-actions {
  display: flex; gap: 6px; flex-wrap: wrap;
  margin-top: 4px;
}
.sched-card-actions .action-btn {
  flex: 1 1 auto;
  width: auto;
  height: 38px;
  padding: 0 12px;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}
</style>
