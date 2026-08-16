<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { formatCurrency, formatCurrencyShort, formatPercent, formatDate } from '@/utils/formatters'
import { useRouter } from 'vue-router'
import { userName, clientProfileName } from '@/types'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useIsMobile } from '@/composables/useIsMobile'
import { useSubscription } from '@/composables/useSubscription'
import { useCapital } from '@/composables/useCapital'
import MetricDetailDialog from '@/components/MetricDetailDialog.vue'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'
import { useAnalyticsSummary, useAnalyticsMonthly, fetchDealsBreakdown, fetchMonthDeals } from '@/composables/useAnalyticsOverview'
import type { MonthDealRow, MonthDealsResponse } from '@/types/analytics'
import type { CapitalSummary } from '@/types'
import { Bar, Line, Doughnut } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Tooltip, Legend, Filler
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler)

const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const router = useRouter()
const { isMobile } = useIsMobile()
const authStore = useAuthStore()
const { canAccess: canAccessFeature } = useSubscription()
const hasCharts = computed(() => canAccessFeature('analyticsCharts'))

// ── Вкладки «Обзор | Отчёты» ────────────────────────────────────────────
// «Отчёты» — отдельное право (раздел показывает капитал, прибыль и доли
// инвесторов) и тариф Бизнес+. Компонент грузим лениво: он ходит за своими
// данными на сервер и не нужен, пока вкладку не открыли.
const ReportsTab = defineAsyncComponent(() => import('@/components/reports/ReportsTab.vue'))
const activeTab = ref<'overview' | 'reports'>('overview')
// Кнопка выгрузки стоит в строке вкладок, а логика — внутри вкладки «Отчёты».
// Дотягиваемся до неё через ref: дублировать сбор PDF здесь было бы хуже.
const reportsTabRef = ref<any>(null)
const canSeeReports = computed(
  () => authStore.can('analytics.reports') && canAccessFeature('reports'),
)

const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()
const { capital: globalCapital, isCapitalSet: isGlobalCapitalSet, fetchCapital } = useCapital()

const pageLoading = ref(true)
const cashboxesStore = useCashBoxesStore()

// ── Cashbox scope ──────────────────────────────────────────────────
// null = aggregate over all cashboxes (uses /finance/capital + all deals)
// string = a specific cashbox (uses /cashboxes/:id/capital + scoped deals)
const selectedCashBoxId = ref<string | null>(null)
const scopedCapital = ref<CapitalSummary | null>(null)

// Accrued co-investor profit share per paid payment (paymentId → amount).
// Same partner-net logic as cashboxes / deal page (from PROFIT_ACCRUED journal).
// Only PAID payments have a share — pending/overdue keep gross projection.
// Доля со-инвесторов, начисленная с первоначальных взносов { dealId → Σ }.
// У взносов нет строки графика, поэтому в карте по платежам их нет.

async function fetchScopedCapital() {
  if (!selectedCashBoxId.value) {
    scopedCapital.value = null
    return
  }
  try {
    scopedCapital.value = await api.get<CapitalSummary>(`/cashboxes/${selectedCashBoxId.value}/capital`)
  } catch {
    scopedCapital.value = null
  }
}

watch(selectedCashBoxId, () => {
  fetchScopedCapital()
  // Счётчики статусов раньше фильтровались на клиенте и реагировали на выбор
  // кассы сами. Теперь их считает сервер — без перезапроса диаграмма «Статус
  // сделок» и её легенда продолжали показывать цифры по всем кассам.
  dealsStore.fetchDealCounts({ cashBoxId: selectedCashBoxId.value })
})

const capital = computed(() => selectedCashBoxId.value ? scopedCapital.value : globalCapital.value)
const isCapitalSet = computed(() =>
  capital.value?.initialCapital !== null && capital.value?.initialCapital !== undefined,
)

const capitalUtilization = computed(() => {
  if (!capital.value || capital.value.totalCapital <= 0) return 0
  return Math.min(Math.round((capital.value.deployed / capital.value.totalCapital) * 100), 100)
})

const selectedCashBox = computed(() =>
  selectedCashBoxId.value ? cashboxesStore.items.find((b) => b.id === selectedCashBoxId.value) ?? null : null
)

onMounted(async () => {
  try {
    // Портфель сделок и все платежи здесь больше не грузятся: помесячные
    // разрезы и итоги считает сервер (те же формулы, что в «Отчётах»).
    await Promise.all([
      fetchCapital(),
      cashboxesStore.fetchAll(),
      dealsStore.fetchDealCounts({ cashBoxId: selectedCashBoxId.value }),
    ])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки данных')
  } finally {
    pageLoading.value = false
  }
})

// ── Helpers ──

// Extract year and month from ISO date string without timezone conversion
function parseDateStr(dateStr: string): { year: number; month: number } {
  const year = parseInt(dateStr.slice(0, 4))
  const month = parseInt(dateStr.slice(5, 7)) - 1 // 0-based
  return { year, month }
}

function getMonthKey(date: Date) {
  return date.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
}

function getMonthKeyFromStr(dateStr: string): string {
  const { year, month } = parseDateStr(dateStr)
  return getMonthKey(new Date(year, month, 1))
}

function getLast6Months() {
  const months: Record<string, number> = {}
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months[getMonthKey(d)] = 0
  }
  return months
}

function getNext6Months() {
  const months: Record<string, number> = {}
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months[getMonthKey(d)] = 0
  }
  return months
}

// ── KPI ──

const overdueAmount = computed(() => summary.value?.payments.overdueSum ?? 0)

// Total earned profit (from paid payments)
// Итоги за всё время считает сервер — теми же формулами, что «Отчёты».
const { summary } = useAnalyticsSummary(() => selectedCashBoxId.value)

const earnedProfit = computed(() => summary.value?.deals.grossEarned ?? 0)

/** Средний ожидаемый платёж — сумма ожидаемого, делённая на число строк. */
const avgPendingPayment = computed(() => {
  const p = summary.value?.payments
  return p && p.pendingCount > 0 ? Math.round(p.pendingSum / p.pendingCount) : 0
})

// Expected profit (from pending + overdue payments — not yet received)
const expectedProfit = computed(() => summary.value?.deals.grossLeft ?? 0)

// ── Profit detail dialog ──

const profitDetailDialog = ref(false)
const profitDetailMonth = ref<string | null>(null) // null = all time / all year
const profitDetailMode = ref<'earned' | 'expected' | 'all'>('earned')
const profitDetailYear = ref<number | null>(null) // null = default 6 months
// Фильтр таблицы сделок: все / оплаченные / неоплаченные
const dealFilter = ref<'all' | 'paid' | 'pending'>('all')

interface DealProfit {
  dealId: string
  productName: string
  clientName: string
  markupPercent: number
  totalReceived: number
  paidReceived: number
  pendingReceived: number
  profitEarned: number
  paidProfit: number
  coInvestorProfit: number
  partnerProfit: number
  pendingProfit: number
  projectedCoInvestorProfit: number
  projectedPartnerProfit: number
  paymentsCount: number
  paidCount: number
  pendingCount: number
  earlyOffMonth: number
  lateOffMonth: number
  status: string
}

const profitMonthOptions = computed(() => {
  let months: string[]
  if (profitDetailYear.value) {
    months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(profitDetailYear.value!, i, 1)
      return getMonthKey(d)
    })
  } else {
    months = Object.keys(profitDetailMode.value === 'expected' ? getNext6Months() : getLast6Months())
  }
  const allLabel = profitDetailYear.value ? `Весь ${profitDetailYear.value}` : 'За всё время'
  return [{ key: null as string | null, label: allLabel }, ...months.map(m => ({ key: m, label: m }))]
})

/**
 * Разбор дохода по сделкам за выбранный период — считает сервер.
 *
 * Раньше страница перебирала все платежи партнёра в памяти и группировала их
 * по сделкам; у крупного это сотни тысяч строк. Правила прежние: факт
 * относится к периоду по дате оплаты, прогноз — по плановому сроку.
 */
const monthDealsRows = ref<MonthDealRow[]>([])
const monthDealsTotals = ref<MonthDealsResponse['totals'] | null>(null)
const monthDealsTruncated = ref(false)
const monthDealsLoading = ref(false)
let monthDealsReq = 0

async function loadMonthDeals() {
  const req = ++monthDealsReq
  monthDealsLoading.value = true
  try {
    // Месяц в состоянии хранится подписью вида «июл 26» — переводим в
    // 'YYYY-MM', который понимает сервер.
    const monthKey = profitDetailMonth.value
      ? monthKeyToYm(profitDetailMonth.value, profitDetailYear.value)
      : null
    const res = await fetchMonthDeals({
      month: monthKey,
      year: monthKey ? null : profitDetailYear.value,
      cashBoxId: selectedCashBoxId.value,
    })
    if (req !== monthDealsReq) return
    monthDealsRows.value = res.items
    monthDealsTotals.value = res.totals
    monthDealsTruncated.value = res.truncated
  } catch (e: any) {
    if (req !== monthDealsReq) return
    console.error('Failed to load month deals:', e)
  } finally {
    if (req === monthDealsReq) monthDealsLoading.value = false
  }
}

/** Подпись месяца («июл 26») → 'YYYY-MM'. */
function monthKeyToYm(label: string, year: number | null): string | null {
  const idx = MONTH_SHORT.findIndex((m) => label.toLowerCase().startsWith(m.toLowerCase()))
  if (idx < 0) return null
  const y = year ?? (() => {
    // Год ищем в любом месте подписи, а не только в конце: русская локаль
    // выдаёт «янв. 27 г.» — с якорем на конец строки год не находился, и
    // подставлялся текущий, из-за чего «янв 27» открывал январь 2026.
    const yy = label.match(/\b(\d{2})\b(?!\s*\d)/)
    return yy ? 2000 + parseInt(yy[1]!, 10) : new Date().getFullYear()
  })()
  return `${y}-${String(idx + 1).padStart(2, '0')}`
}

/** Строки таблицы диалога в прежней форме — шаблон не меняем. */
const profitByDeal = computed((): DealProfit[] =>
  monthDealsRows.value.map((r) => ({
    dealId: r.dealId,
    productName: r.productName,
    clientName: r.clientName,
    markupPercent: r.markupPercent,
    totalReceived: r.paidReceived + r.pendingReceived,
    paidReceived: r.paidReceived,
    pendingReceived: r.pendingReceived,
    profitEarned: r.paidGross,
    paidProfit: r.paidGross,
    coInvestorProfit: r.ciPaid,
    partnerProfit: r.paidGross - r.ciPaid,
    pendingProfit: r.pendingGross,
    projectedCoInvestorProfit: r.ciPending,
    projectedPartnerProfit: r.pendingGross - r.ciPending,
    paymentsCount: r.paidCount + r.pendingCount,
    paidCount: r.paidCount,
    pendingCount: r.pendingCount,
    // Бейджи «оплачен не в свой месяц» считаются по платежам — в разрезе по
    // сделкам их нет, а на строке таблицы они и не показывались.
    earlyOffMonth: 0,
    lateOffMonth: 0,
    status: r.status,
  })),
)

// Перезапрашиваем при смене периода, режима и кассы — но только когда диалог
// открыт: закрытый не должен дёргать сервер.
watch(
  () => [profitDetailDialog.value, profitDetailMonth.value, profitDetailYear.value, selectedCashBoxId.value],
  () => { if (profitDetailDialog.value) loadMonthDeals() },
)

const dealFilterCounts = computed(() => ({
  all: profitByDeal.value.filter(d => d.paymentsCount > 0).length,
  paid: profitByDeal.value.filter(d => d.paidCount > 0).length,
  pending: profitByDeal.value.filter(d => d.pendingCount > 0).length,
}))

// Строки таблицы с учётом фильтра. Считаем «целиковый платёж за месяц» и вашу
// чистую прибыль под выбранную категорию.
const displayDeals = computed(() => {
  const f = dealFilter.value
  return profitByDeal.value
    .map(d => {
      const amount = f === 'paid' ? d.paidReceived : f === 'pending' ? d.pendingReceived : d.totalReceived
      const net = f === 'paid'
        ? d.partnerProfit
        : f === 'pending'
          ? d.projectedPartnerProfit
          : d.partnerProfit + d.projectedPartnerProfit
      const coInv = f === 'paid'
        ? d.coInvestorProfit
        : f === 'pending'
          ? d.projectedCoInvestorProfit
          : d.coInvestorProfit + d.projectedCoInvestorProfit
      // Вся наценка с этих платежей — до вычета доли со-инвесторов.
      const gross = f === 'paid'
        ? d.paidProfit
        : f === 'pending'
          ? d.pendingProfit
          : d.paidProfit + d.pendingProfit
      const count = f === 'paid' ? d.paidCount : f === 'pending' ? d.pendingCount : d.paymentsCount
      const hasPaid = f !== 'pending' && d.paidCount > 0
      const hasPending = f !== 'paid' && d.pendingCount > 0
      // Какая доля платежа — прибыль (остальное возвращает вложения в товар).
      const profitShare = amount > 0 ? Math.max(0, gross) / amount : 0
      return { ...d, amount, net, coInv, gross, count, hasPaid, hasPending, profitShare }
    })
    .filter(d => d.amount > 0)
    .sort((a, b) => b.net - a.net)
})

/**
 * Суммы шапки модалки берём из серверных итогов: они посчитаны по ВСЕЙ
 * выборке, тогда как строк приезжает не больше пятисот. Складывать показанные
 * строки было бы занижением у партнёра с большим портфелем. Если итогов нет
 * (старый ответ) — падаем на подсчёт по строкам, как раньше.
 */
const profitDetailReceived = computed(() => {
  const t = monthDealsTotals.value
  if (t) return t.paidReceived + t.pendingReceived
  return profitByDeal.value.reduce((s, d) => s + d.totalReceived, 0)
})

// Денежные (полные суммы): план месяца = пришло + осталось. totalReceived уже
// суммирует и оплаченные, и неоплаченные платежи выборки — это и есть план.
const profitDetailPlanned = computed(() => profitDetailReceived.value)
const profitDetailPaid = computed(() =>
  monthDealsTotals.value?.paidReceived
    ?? profitByDeal.value.reduce((s, d) => s + d.paidReceived, 0)
)
const profitDetailPending = computed(() =>
  monthDealsTotals.value?.pendingReceived
    ?? profitByDeal.value.reduce((s, d) => s + d.pendingReceived, 0)
)

const profitDetailPartner = computed(() =>
  profitByDeal.value.reduce((s, d) => s + d.partnerProfit, 0)
)

const profitDetailProjectedPartner = computed(() =>
  profitByDeal.value.reduce((s, d) => s + d.projectedPartnerProfit, 0)
)

// Разбор прибыли для подсказок-формул: вся наценка и доля со-инвесторов
// отдельно по оплаченным (факт) и неоплаченным (прогноз) платежам.
const profitDetailGrossPaid = computed(() =>
  monthDealsTotals.value?.paidGross
    ?? profitByDeal.value.reduce((s, d) => s + d.paidProfit, 0)
)
const profitDetailCoInvPaid = computed(() =>
  monthDealsTotals.value?.ciPaid
    ?? profitByDeal.value.reduce((s, d) => s + d.coInvestorProfit, 0)
)
const profitDetailGrossPending = computed(() =>
  monthDealsTotals.value?.pendingGross
    ?? profitByDeal.value.reduce((s, d) => s + d.pendingProfit, 0)
)
const profitDetailCoInvPending = computed(() =>
  profitByDeal.value.reduce((s, d) => s + d.projectedCoInvestorProfit, 0)
)

// Доля со-инвесторов со ВСЕХ платежей периода (оплаченные + прогноз по неоплаченным)
// и весь доход (наценка) со всех платежей — для доли в процентах.
// ПРОГНОЗНАЯ часть (projectedCoInvestorProfit) считается только по показанным
// сделкам: коэффициент доли сервер отдаёт вместе со строкой. Когда выборка
// усечена, об этом сообщает подпись под списком.
const profitDetailCoInvestorAll = computed(() =>
  profitByDeal.value.reduce((s, d) => s + d.coInvestorProfit + d.projectedCoInvestorProfit, 0)
)
const profitDetailProfitAll = computed(() =>
  profitByDeal.value.reduce((s, d) => s + d.paidProfit + d.pendingProfit, 0)
)

function openProfitDetail(monthKey?: string, mode: 'earned' | 'expected' | 'all' = 'earned', year?: number) {
  profitDetailMonth.value = monthKey || null
  profitDetailMode.value = mode
  profitDetailYear.value = year || null
  // Стартовый фильтр таблицы под контекст: «Заработано» → оплаченные,
  // «Прогноз» → неоплаченные, клик по месяцу → все.
  dealFilter.value = mode === 'earned' ? 'paid' : mode === 'expected' ? 'pending' : 'all'
  profitDetailDialog.value = true
}

// ── Year calendar ──

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

const calYear = ref(new Date().getFullYear())

function prevYear() { calYear.value-- }
function nextYear() { calYear.value++ }

interface MonthData {
  month: number
  label: string
  earned: number
  coInvestorEarned: number
  partnerEarned: number
  expected: number
  received: number
  pendingAmount: number   // полная сумма НЕоплаченных платежей месяца (осталось получить)
  planned: number         // весь план месяца = received + pendingAmount
  payments: number
  earlyOffMonth: number
  lateOffMonth: number
  isCurrent: boolean
  isPast: boolean
}

/**
 * Помесячный разрез за выбранный год — считает сервер. Раньше страница
 * перебирала все платежи партнёра в памяти; у крупного это сотни тысяч строк.
 * Правила те же: факт учитывается по дате оплаты, прогноз — по плановому сроку.
 */
const { rows: yearRows } = useAnalyticsMonthly(
  () => ({ from: `${calYear.value}-01-01`, to: `${calYear.value}-12-31` }),
  () => selectedCashBoxId.value,
)

const yearMonths = computed((): MonthData[] => {
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  return Array.from({ length: 12 }, (_, i) => {
    const isPast = calYear.value < currentYear || (calYear.value === currentYear && i <= currentMonth)
    const isCurrent = calYear.value === currentYear && i === currentMonth
    const key = `${calYear.value}-${String(i + 1).padStart(2, '0')}`
    const r = yearRows.value.find((x) => x.month === key)

    const earned = r?.grossEarned ?? 0
    const coInvestorEarned = r?.ciEarned ?? 0
    const received = r?.received ?? 0
    const pendingAmount = r?.pendingAmount ?? 0

    return {
      month: i,
      label: MONTH_SHORT[i],
      earned,
      coInvestorEarned,
      partnerEarned: earned - coInvestorEarned,
      expected: r?.expectedGross ?? 0,
      received,
      pendingAmount,
      planned: received + pendingAmount,
      payments: (r?.paidCount ?? 0) + (r?.pendingCount ?? 0),
      earlyOffMonth: r?.earlyOffMonth ?? 0,
      lateOffMonth: r?.lateOffMonth ?? 0,
      isCurrent,
      isPast,
    }
  })
})

const yearTotal = computed(() => {
  return yearMonths.value.reduce((s, m) => ({
    earned: s.earned + m.earned,
    coInvestorEarned: s.coInvestorEarned + m.coInvestorEarned,
    partnerEarned: s.partnerEarned + m.partnerEarned,
    expected: s.expected + m.expected,
    received: s.received + m.received,
    pendingAmount: s.pendingAmount + m.pendingAmount,
    planned: s.planned + m.planned,
  }), { earned: 0, coInvestorEarned: 0, partnerEarned: 0, expected: 0, received: 0, pendingAmount: 0, planned: 0 })
})

function openMonthDetail(m: MonthData) {
  const d = new Date(calYear.value, m.month, 1)
  const key = getMonthKey(d)
  openProfitDetail(key, 'all', calYear.value)
}

// ── Данные графиков ──
// Одно окно на все четыре графика: пять месяцев назад и пять вперёд. Раньше
// каждый график перебирал все платежи партнёра в памяти.

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const { rows: chartRows } = useAnalyticsMonthly(
  () => {
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const to = new Date(now.getFullYear(), now.getMonth() + 6, 0)
    return { from: `${ymKey(from)}-01`, to: `${ymKey(to)}-${String(to.getDate()).padStart(2, '0')}` }
  },
  () => selectedCashBoxId.value,
)

/** Значения по окну месяцев: подписи как раньше, суммы — из серверных строк. */
function seriesFor(
  direction: 'past' | 'future',
  pick: (r: { received: number; grossEarned: number; pendingAmount: number; expectedGross: number }) => number,
) {
  const now = new Date()
  const labels: string[] = []
  const data: number[] = []
  for (let i = 0; i < 6; i++) {
    const d = direction === 'past'
      ? new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      : new Date(now.getFullYear(), now.getMonth() + i, 1)
    labels.push(getMonthKey(d))
    const r = chartRows.value.find((x) => x.month === ymKey(d))
    data.push(Math.round(pick(r ?? { received: 0, grossEarned: 0, pendingAmount: 0, expectedGross: 0 })))
  }
  return { labels, data }
}

// ── CHART 1: Revenue by month (last 6) ──

const revenueChartData = computed(() => {
  const { labels, data } = seriesFor('past', (r) => r.received)
  return {
    labels,
    datasets: [{
      label: 'Поступления',
      data,
      backgroundColor: 'rgba(4, 120, 87, 0.15)',
      borderColor: '#047857',
      borderWidth: 2,
      borderRadius: 6,
      hoverBackgroundColor: 'rgba(4, 120, 87, 0.3)',
    }]
  }
})

// ── CHART 2: Profit by month (last 6) — the KEY new chart ──

const profitChartData = computed(() => {
  const { labels, data } = seriesFor('past', (r) => r.grossEarned)
  return {
    labels,
    datasets: [{
      label: 'Доход',
      data,
      backgroundColor: 'rgba(16, 185, 129, 0.2)',
      borderColor: '#10b981',
      borderWidth: 2,
      borderRadius: 6,
      hoverBackgroundColor: 'rgba(16, 185, 129, 0.35)',
    }]
  }
})

// ── CHART 3: Forecast (next 6) ──

const forecastChartData = computed(() => {
  const { labels, data } = seriesFor('future', (r) => r.pendingAmount)
  return {
    labels,
    datasets: [{
      label: 'Ожидаемые платежи',
      data,
      borderColor: '#047857',
      backgroundColor: 'rgba(4, 120, 87, 0.06)',
      borderWidth: 2.5,
      pointBackgroundColor: '#047857',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      fill: true,
      tension: 0.4,
    }]
  }
})

// ── CHART 4: Profit forecast (next 6) ──

const profitForecastData = computed(() => {
  const { labels, data } = seriesFor('future', (r) => r.expectedGross)
  return {
    labels,
    datasets: [{
      label: 'Ожидаемый доход',
      data,
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.06)',
      borderWidth: 2.5,
      pointBackgroundColor: '#10b981',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      fill: true,
      tension: 0.4,
    }]
  }
})

// ── CHART 5: Status distribution (doughnut) ──

const statusDistribution = computed(() => {
  const by = dealsStore.counts?.byStatus ?? {}
  const active = by.ACTIVE ?? 0
  const completed = by.COMPLETED ?? 0
  const disputed = by.DISPUTED ?? 0
  const cancelled = by.CANCELLED ?? 0
  return {
    labels: ['Активные', 'Завершённые', 'Спорные', 'Отменённые'],
    datasets: [{
      data: [active, completed, disputed, cancelled],
      backgroundColor: ['#047857', '#3b82f6', '#f59e0b', '#ef4444'],
      borderWidth: 0,
      hoverOffset: 4,
    }]
  }
})

// ── Chart options ──

const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1a1a2e',
      titleColor: '#fff',
      bodyColor: '#fff',
      padding: 12,
      cornerRadius: 8,
      callbacks: {
        label: (ctx: any) => formatCurrency(ctx.raw)
      }
    }
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: '#9ca3af', font: { size: 12 } },
      border: { display: false },
    },
    y: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: {
        color: '#9ca3af',
        font: { size: 12 },
        callback: (v: any) => formatCurrencyShort(v),
      },
      border: { display: false },
    }
  }
}

const profitBarOptions = {
  ...barOptions,
  onClick: (_event: any, elements: any[]) => {
    if (elements.length > 0) {
      const idx = elements[0].index
      const labels = Object.keys(getLast6Months())
      if (labels[idx]) openProfitDetail(labels[idx])
    }
  },
}

const lineOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y ?? 0)}`
      }
    }
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 11 } },
    },
    y: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: {
        font: { size: 11 },
        callback: (v: any) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v),
      },
    }
  }
}

const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '70%',
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1a1a2e',
      titleColor: '#fff',
      bodyColor: '#fff',
      padding: 10,
      cornerRadius: 8,
    },
  },
}

// ── Metric breakdown dialog ──

// ── Общая модалка расшифровки показателя ──
const metricOpen = ref(false)
const metricTitle = ref('')
const metricHint = ref('')
const metricColor = ref('#10b981')
const metricTotal = ref(0)
const metricItems = ref<any[]>([])
const breakdownIcon = ref('')

/** Заголовок, пояснение и цвет расшифровки — по показателю. */
const BREAKDOWN_META: Record<string, { title: string; hint: string; color: string }> = {
  invested: { title: 'Инвестировано в товар', hint: 'Сколько денег потрачено на закупку товара по всем сделкам.', color: '#3b82f6' },
  revenue: { title: 'Общий оборот', hint: 'Сколько всего должны заплатить клиенты — закупка вместе с наценкой.', color: '#0ea5e9' },
  profit: { title: 'Наценка по сделкам', hint: 'Наценка по каждой сделке: цена продажи минус закупка.', color: '#059669' },
  remaining: { title: 'Ожидается к получению', hint: 'Сколько клиенты ещё должны заплатить по активным сделкам.', color: '#f59e0b' },
  received: { title: 'Получено', hint: 'Деньги, которые клиенты уже отдали: взносы и оплаченные платежи.', color: '#10b981' },
  monthly: { title: 'Ежемесячные поступления', hint: 'Сколько приходит по активным сделкам за месяц по графику.', color: '#8b5cf6' },
  overdue: { title: 'Просрочено', hint: 'Платежи, срок которых уже прошёл, а деньги не поступили.', color: '#ef4444' },
}

const BREAKDOWN_PAGE = 100
const metricLoading = ref(false)
const metricMetric = ref<string>('invested')
/** Всего сделок за показателем — в списке может быть лишь часть. */
const metricCount = ref(0)

const bdMoney = (n: number) => formatCurrency(Math.round(n || 0))

/** Строка списка из серверной сделки. */
function breakdownRow(metric: string, d: any) {
  const base = { id: d.id, title: d.productName || 'Сделка', subtitle: d.clientName || '—' }
  switch (metric) {
    case 'invested':
      return { ...base, value: d.cost, parts: [
        { label: 'продано за', value: bdMoney(d.totalPrice) },
        { label: 'наценка', value: bdMoney(d.margin) },
        { label: 'вернулось', value: bdMoney(d.received) },
      ] }
    case 'revenue':
      return { ...base, value: d.totalPrice, parts: [
        { label: 'закупка', value: bdMoney(d.cost) },
        { label: 'наценка', value: bdMoney(d.margin) },
      ] }
    case 'profit':
      return { ...base, value: d.margin, parts: [
        { label: 'закупка', value: bdMoney(d.cost) },
        { label: 'цена продажи', value: bdMoney(d.totalPrice) },
      ] }
    case 'remaining':
      return { ...base, value: d.remaining, parts: [
        { label: 'всего по сделке', value: bdMoney(d.totalPrice) },
        { label: 'уже получено', value: bdMoney(d.received) },
      ] }
    case 'received':
      return { ...base, value: d.received, parts: [
        { label: 'всего по сделке', value: bdMoney(d.totalPrice) },
        { label: 'осталось', value: bdMoney(d.remaining) },
        { label: 'взнос', value: bdMoney(d.downPayment) },
      ] }
    case 'monthly': {
      const perMonth = d.numberOfPayments > 0
        ? Math.round(Math.max(0, d.totalPrice - d.downPayment) / d.numberOfPayments)
        : 0
      const share = d.totalPrice > 0 ? Math.min(d.margin / d.totalPrice, 1) : 0
      return { ...base, value: perMonth, parts: [
        { label: 'из них доход', value: bdMoney(perMonth * share) },
        { label: 'платежей', value: String(d.numberOfPayments) },
      ] }
    }
    case 'overdue':
      return { ...base, value: d.overdueAmount, parts: [
        { label: 'просрочено дней', value: String(d.maxOverdueDays) },
        { label: 'остаток долга', value: bdMoney(d.remaining) },
      ] }
    default:
      return { ...base, value: 0, parts: [] }
  }
}

/**
 * Расшифровка показателя. Сделки грузятся с сервера порциями и с учётом
 * выбранной кассы — раньше страница перебирала весь портфель в памяти.
 */
async function openBreakdown(metric: string) {
  const meta = BREAKDOWN_META[metric]
  if (!meta) return
  metricMetric.value = metric
  metricTitle.value = meta.title
  metricHint.value = meta.hint
  metricColor.value = meta.color
  metricItems.value = []
  metricTotal.value = 0
  metricCount.value = 0
  metricOpen.value = true
  metricLoading.value = true
  try {
    const res = await fetchDealsBreakdown(metric as any, {
      cashBoxId: selectedCashBoxId.value,
      limit: BREAKDOWN_PAGE,
    })
    metricItems.value = res.items.map((d) => breakdownRow(metric, d))
    metricCount.value = res.count
    // Итог считает сервер по ВСЕЙ выборке — в списке может быть лишь часть.
    metricTotal.value = res.total
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить расшифровку')
  } finally {
    metricLoading.value = false
  }
}

/** Догрузить следующую порцию сделок. */
async function loadMoreBreakdown() {
  if (metricLoading.value) return
  metricLoading.value = true
  try {
    const res = await fetchDealsBreakdown(metricMetric.value as any, {
      cashBoxId: selectedCashBoxId.value,
      limit: BREAKDOWN_PAGE,
      offset: metricItems.value.length,
    })
    metricItems.value = [
      ...metricItems.value,
      ...res.items.map((d) => breakdownRow(metricMetric.value, d)),
    ]
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить ещё')
  } finally {
    metricLoading.value = false
  }
}

const metricHasMore = computed(() => metricItems.value.length < metricCount.value)

</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
      <!-- Вкладки раздела. «Отчёты» видны только с правом и тарифом. -->
      <div v-if="canSeeReports" class="an-tabs-row">
        <div class="an-tabs">
          <button
            class="an-tab"
            :class="{ 'an-tab--active': activeTab === 'overview' }"
            type="button"
            @click="activeTab = 'overview'"
          >
            <v-icon icon="mdi-view-dashboard-outline" size="16" />
            Обзор
          </button>
          <button
            class="an-tab"
            :class="{ 'an-tab--active': activeTab === 'reports' }"
            type="button"
            @click="activeTab = 'reports'"
          >
            <v-icon icon="mdi-file-chart-outline" size="16" />
            Отчёты
          </button>
        </div>

        <div
          v-if="activeTab === 'reports' && reportsTabRef?.canExport && reportsTabRef?.ready"
          class="an-export-group"
        >
          <button
            class="an-tab-export an-tab-export--excel"
            type="button"
            :disabled="reportsTabRef?.exporting"
            @click="reportsTabRef.exportExcel()"
          >
            <v-icon icon="mdi-microsoft-excel" size="16" />
            Excel
          </button>
          <button
            class="an-tab-export"
            type="button"
            :disabled="reportsTabRef?.exporting"
            @click="reportsTabRef.exportPdf()"
          >
            <v-icon icon="mdi-file-pdf-box" size="16" />
            Открыть PDF
          </button>
        </div>
      </div>

      <!-- Cashbox scope chips. Tap a chip to filter all numbers/charts on
           this page by that cashbox. "Все кассы" returns to the aggregated
           view. -->
      <div v-if="cashboxesStore.items.length > 0" class="cb-scope mb-4">
        <div class="cb-scope-label">Смотреть:</div>
        <div class="cb-scope-chips">
          <button
            class="cb-scope-chip"
            :class="{ 'cb-scope-chip--active': selectedCashBoxId === null }"
            type="button"
            @click="selectedCashBoxId = null"
          >
            <v-icon icon="mdi-view-grid-outline" size="14" />
            Все кассы
          </button>
          <button
            v-for="b in cashboxesStore.items"
            :key="b.id"
            class="cb-scope-chip"
            :class="{ 'cb-scope-chip--active': selectedCashBoxId === b.id }"
            :style="selectedCashBoxId === b.id ? {
              '--cb-color': b.color,
              borderColor: b.color,
              color: b.color,
              background: b.color + '14',
            } : { '--cb-color': b.color }"
            type="button"
            @click="selectedCashBoxId = b.id"
          >
            <v-icon :icon="b.icon" size="14" :style="{ color: b.color }" />
            {{ b.name }}
          </button>
          <button
            v-if="selectedCashBox"
            class="cb-scope-open"
            type="button"
            @click="router.push(`/cashboxes/${selectedCashBox.id}`)"
            :title="`Открыть кассу «${selectedCashBox.name}»`"
          >
            <v-icon icon="mdi-arrow-top-right" size="14" />
            Открыть кассу
          </button>
        </div>
      </div>

      <!-- Вкладка «Отчёты»: свои данные с сервера, ленивый компонент. -->
      <ReportsTab
        v-if="canSeeReports && activeTab === 'reports'"
        ref="reportsTabRef"
        :cash-box-id="selectedCashBoxId"
        :is-dark="isDark"
      />

      <template v-if="activeTab === 'overview'">
      <div class="an-sections-wrap" :class="{ 'an-sections-wrap--reorder': !hasCharts }">

      <!-- Charts: BUSINESS+ only (blurred for lower plans) -->
      <div class="an-charts-section" :class="{ 'an-charts-section--locked': !hasCharts }">
      <div v-if="!hasCharts" class="an-charts-overlay" @click="router.push({ path: '/settings', query: { tab: 'subscription' } })">
        <div class="an-charts-overlay-content">
          <div class="an-charts-overlay-icon">
            <v-icon icon="mdi-crown" size="28" />
          </div>
          <div class="an-charts-overlay-title">Графики и детальная аналитика</div>
          <div class="an-charts-overlay-text">
            Графики доходов, прогнозы, годовой обзор и диаграммы распределения — доступны с плана Бизнес
          </div>
          <div class="an-charts-overlay-features">
            <div class="an-charts-overlay-feat">
              <v-icon icon="mdi-chart-bar" size="16" />
              <span>Графики доходов</span>
            </div>
            <div class="an-charts-overlay-feat">
              <v-icon icon="mdi-calendar-text" size="16" />
              <span>Годовой обзор</span>
            </div>
            <div class="an-charts-overlay-feat">
              <v-icon icon="mdi-chart-line" size="16" />
              <span>Прогнозы</span>
            </div>
            <div class="an-charts-overlay-feat">
              <v-icon icon="mdi-chart-donut" size="16" />
              <span>Диаграммы</span>
            </div>
          </div>
          <button class="an-charts-overlay-btn">
            Перейти на план Бизнес
            <v-icon icon="mdi-arrow-right" size="16" />
          </button>
        </div>
      </div>
      <!-- Formula explainer -->
      <div class="an-formula mb-5">
        <div class="an-formula-icon">
          <v-icon icon="mdi-calculator-variant-outline" size="20" color="primary" />
        </div>
        <div class="an-formula-body">
          <div class="an-formula-title">Как рассчитывается доход</div>
          <div class="an-formula-text">
            Из каждого платежа выделяется доля наценки: <code>платёж × наценка ÷ (100 + наценка)</code>.
            Например, при наценке 20% из платежа 12 000 ₽ ваш доход — <strong>2 000 ₽</strong>, а 10 000 ₽ — возврат вложений.
            <br>
            Доход учитывается в месяце <strong>фактической оплаты</strong> платежа: если клиент заплатил заранее или с задержкой, сумма попадает в тот месяц, когда деньги реально пришли.
          </div>
        </div>
      </div>

      <!-- Year Overview -->
      <v-card rounded="lg" elevation="0" border class="mb-6 overflow-hidden">
        <!-- Header -->
        <div class="yc-header">
          <div class="yc-header-left">
            <div class="d-flex align-center ga-2 mb-1">
              <v-icon icon="mdi-calendar-text" size="20" style="opacity: 0.7;" />
              <span class="yc-header-label">Годовой обзор</span>
            </div>
            <div class="yc-header-year">
              <button class="yc-arrow" @click="prevYear">
                <v-icon icon="mdi-chevron-left" size="20" />
              </button>
              <span>{{ calYear }}</span>
              <button class="yc-arrow" @click="nextYear">
                <v-icon icon="mdi-chevron-right" size="20" />
              </button>
            </div>
          </div>

          <div class="yc-header-stats">
            <div class="yc-stat">
              <ExactValue class="yc-stat-value" style="color: #34d399;" :value="Math.max(0, yearTotal.partnerEarned)">{{ formatCurrencyShort(Math.max(0, yearTotal.partnerEarned)) }}</ExactValue>
              <div class="yc-stat-label">Мой чистый доход</div>
              <div v-if="yearTotal.coInvestorEarned > 0" class="yc-stat-sub">
                весь доход <ExactValue :value="yearTotal.earned" :hint="false">{{ formatCurrencyShort(yearTotal.earned) }}</ExactValue> · со-инвесторам <ExactValue :value="yearTotal.coInvestorEarned" :hint="false">{{ formatCurrencyShort(yearTotal.coInvestorEarned) }}</ExactValue>
              </div>
            </div>
            <div class="yc-stat-divider" />
            <div class="yc-stat">
              <ExactValue class="yc-stat-value" :value="yearTotal.planned">{{ formatCurrencyShort(yearTotal.planned) }}</ExactValue>
              <div class="yc-stat-label">Ожидается за год</div>
            </div>
            <div class="yc-stat-divider" />
            <div class="yc-stat">
              <ExactValue class="yc-stat-value" style="color: #10b981;" :value="yearTotal.received">{{ formatCurrencyShort(yearTotal.received) }}</ExactValue>
              <div class="yc-stat-label">Пришло</div>
            </div>
            <div class="yc-stat-divider" />
            <div class="yc-stat">
              <ExactValue class="yc-stat-value" style="color: #3b82f6;" :value="yearTotal.pendingAmount">{{ formatCurrencyShort(yearTotal.pendingAmount) }}</ExactValue>
              <div class="yc-stat-label">Осталось</div>
            </div>
          </div>
        </div>

        <!-- Column captions (desktop) -->
        <div class="yc-caption">
          <span class="yc-cap-month">Месяц</span>
          <span class="yc-cap-bar">Сбор за месяц</span>
          <span class="yc-cap-num">Ожидается за месяц</span>
          <span class="yc-cap-num">Пришло</span>
          <span class="yc-cap-num">Осталось</span>
          <span class="yc-cap-num">Мой чистый доход</span>
          <span class="yc-cap-chev" />
        </div>

        <!-- Month list — one row per month -->
        <div class="yc-list">
          <div
            v-for="m in yearMonths"
            :key="m.month"
            class="yc-row"
            :class="{
              'yc-row--current': m.isCurrent,
              'yc-row--empty': m.planned === 0,
            }"
            @click="openMonthDetail(m)"
          >
            <!-- Month name -->
            <div class="yc-row-month">
              <span class="yc-row-mname" :class="{ 'yc-row-mname--current': m.isCurrent }">{{ MONTH_NAMES[m.month] }}</span>
              <span v-if="m.isCurrent" class="yc-month-now">сейчас</span>
              <span v-if="m.payments > 0" class="yc-row-pays">{{ m.payments }}&nbsp;{{ m.payments === 1 ? 'платёж' : (m.payments < 5 ? 'платежа' : 'платежей') }}</span>
            </div>

            <!-- Bar + secondary info: доля собранного из плана месяца -->
            <div class="yc-row-mid">
              <div class="yc-bar-track">
                <div
                  v-if="m.received > 0"
                  class="yc-bar yc-bar--earned"
                  :style="{ width: (m.received / m.planned * 100) + '%' }"
                />
                <div
                  v-if="m.pendingAmount > 0"
                  class="yc-bar yc-bar--pending"
                  :style="{ width: (m.pendingAmount / m.planned * 100) + '%' }"
                />
              </div>
              <div v-if="m.coInvestorEarned > 0 || m.earlyOffMonth > 0 || m.lateOffMonth > 0" class="yc-row-chips">
                <span v-if="m.coInvestorEarned > 0" class="yc-chip">
                  весь доход <ExactValue :value="m.earned" :hint="false">{{ formatCurrencyShort(m.earned) }}</ExactValue> · со-инвесторам <ExactValue :value="m.coInvestorEarned" :hint="false">{{ formatCurrencyShort(m.coInvestorEarned) }}</ExactValue>
                </span>
                <span
                  v-if="m.earlyOffMonth > 0"
                  class="yc-chip yc-chip--off"
                  title="Эти платежи оплачены раньше срока — доход учтён в месяце фактической оплаты"
                >
                  <v-icon icon="mdi-calendar-arrow-left" size="10" />
                  {{ m.earlyOffMonth }} досрочно
                </span>
                <span
                  v-if="m.lateOffMonth > 0"
                  class="yc-chip yc-chip--off-late"
                  title="Эти платежи оплачены позже срока — доход учтён в месяце фактической оплаты"
                >
                  <v-icon icon="mdi-calendar-arrow-right" size="10" />
                  {{ m.lateOffMonth }} с опозданием
                </span>
              </div>

              <!-- Компактная строка сумм — только на телефоне -->
              <div v-if="m.planned > 0" class="yc-row-mmoney">
                <span><b>{{ formatCurrencyShort(m.planned) }}</b> ожидается</span>
                <span class="yc-mm--green"><b>{{ formatCurrencyShort(m.received) }}</b> пришло</span>
                <span v-if="m.pendingAmount > 0" class="yc-mm--pending"><b>{{ formatCurrencyShort(m.pendingAmount) }}</b> осталось</span>
                <span v-if="m.partnerEarned > 0" class="yc-mm--net"><b>+{{ formatCurrencyShort(Math.max(0, m.partnerEarned)) }}</b> чисто</span>
              </div>
            </div>

            <!-- Numbers: план месяца / пришло / осталось / чистый доход -->
            <div class="yc-row-num">
              <ExactValue v-if="m.planned > 0" class="yc-num-val" :value="m.planned">{{ formatCurrencyShort(m.planned) }}</ExactValue>
              <span v-else class="yc-num-empty">—</span>
            </div>
            <div class="yc-row-num">
              <ExactValue v-if="m.received > 0" class="yc-num-val yc-num-val--earned" :value="m.received">{{ formatCurrencyShort(m.received) }}</ExactValue>
              <span v-else class="yc-num-empty">—</span>
            </div>
            <div class="yc-row-num">
              <ExactValue v-if="m.pendingAmount > 0" class="yc-num-val yc-num-val--pending" :value="m.pendingAmount">{{ formatCurrencyShort(m.pendingAmount) }}</ExactValue>
              <span v-else class="yc-num-empty">—</span>
            </div>
            <div class="yc-row-num">
              <ExactValue v-if="m.partnerEarned !== 0" class="yc-num-val yc-num-val--net" :value="Math.max(0, m.partnerEarned)">+{{ formatCurrencyShort(Math.max(0, m.partnerEarned)) }}</ExactValue>
              <span v-else class="yc-num-empty">—</span>
            </div>

            <v-icon icon="mdi-chevron-right" size="18" class="yc-row-chev" />
          </div>
        </div>

        <!-- Legend -->
        <div class="yc-footer">
          <div class="yc-legend">
            <span class="yc-legend-dot" style="background: #10b981;" />
            <span>Пришло (уже собрано)</span>
          </div>
          <div class="yc-legend">
            <span class="yc-legend-dot" style="background: #3b82f6;" />
            <span>Осталось (по неоплаченным)</span>
          </div>
          <div class="yc-legend-hint">
            <v-icon icon="mdi-gesture-tap" size="14" />
            Наведите на сумму — покажем точное значение · нажмите на месяц для детализации
          </div>
        </div>
      </v-card>

      <!-- Profit Charts — side by side -->
      <div class="an-section-title">Доход</div>
      <v-row class="mb-6">
        <v-col cols="12" lg="6">
          <v-card rounded="lg" elevation="0" border class="pa-5 h-100">
            <div class="d-flex align-center justify-space-between mb-1">
              <div>
                <div class="chart-title">Заработано</div>
                <div class="chart-subtitle">Доход за последние 6 месяцев</div>
              </div>
              <div class="d-flex align-center ga-3">
                <div class="chart-total" style="color: #10b981;">
                  {{ formatCurrency(earnedProfit) }}
                </div>
                <button class="an-detail-btn" @click="openProfitDetail()">
                  Подробнее
                  <v-icon icon="mdi-arrow-right" size="14" />
                </button>
              </div>
            </div>
            <div class="an-hint mb-3">
              <v-icon icon="mdi-information-outline" size="14" />
              Чистая прибыль с оплаченных платежей. Нажмите на столбец для детализации по сделкам.
            </div>
            <div style="height: 260px;">
              <Bar :data="profitChartData" :options="profitBarOptions" />
            </div>
            <div class="an-month-links">
              <button
                v-for="month in Object.keys(getLast6Months())"
                :key="month"
                class="an-month-link"
                @click="openProfitDetail(month)"
              >
                {{ month }}
              </button>
            </div>
          </v-card>
        </v-col>

        <v-col cols="12" lg="6">
          <v-card rounded="lg" elevation="0" border class="pa-5 h-100">
            <div class="d-flex align-center justify-space-between mb-1">
              <div>
                <div class="chart-title">Прогноз дохода</div>
                <div class="chart-subtitle">Ожидаемый доход на 6 месяцев</div>
              </div>
              <div class="d-flex align-center ga-3">
                <div class="chart-total" style="color: #10b981;">
                  {{ formatCurrency(expectedProfit) }}
                </div>
                <button class="an-detail-btn" @click="openProfitDetail(undefined, 'expected')">
                  Подробнее
                  <v-icon icon="mdi-arrow-right" size="14" />
                </button>
              </div>
            </div>
            <div class="an-hint mb-3">
              <v-icon icon="mdi-information-outline" size="14" />
              Сколько вы заработаете с ещё неоплаченных платежей по графикам сделок.
            </div>
            <div style="height: 260px;">
              <Line :data="profitForecastData" :options="lineOptions" />
            </div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Revenue Charts -->
      <div class="an-section-title">Поступления</div>
      <v-row class="mb-2">
        <v-col cols="12" lg="6">
          <v-card rounded="lg" elevation="0" border class="pa-5 h-100">
            <div class="d-flex align-center justify-space-between mb-4">
              <div>
                <div class="chart-title">Поступления</div>
                <div class="chart-subtitle">За последние 6 месяцев</div>
              </div>
              <div class="chart-total">
                {{ formatCurrency(summary?.payments.paidSum ?? 0) }}
              </div>
            </div>
            <div class="an-hint mb-3">
              <v-icon icon="mdi-information-outline" size="14" />
              Все полученные платежи от клиентов — включая возврат себестоимости и вашу наценку.
            </div>
            <div style="height: 240px;">
              <Bar :data="revenueChartData" :options="barOptions" />
            </div>
          </v-card>
        </v-col>

        <v-col cols="12" lg="6">
          <v-card rounded="lg" elevation="0" border class="pa-5 h-100">
            <div class="d-flex align-center justify-space-between mb-2">
              <div>
                <div class="chart-title">Прогноз поступлений</div>
                <div class="chart-subtitle">На 6 месяцев вперёд</div>
              </div>
            </div>
            <div class="an-hint mb-3">
              <v-icon icon="mdi-information-outline" size="14" />
              Сколько денег вы получите от клиентов в ближайшие месяцы по графикам платежей. Включает и возврат вложений и доход.
            </div>

            <div class="forecast-summary mb-4">
              <div class="forecast-summary-item">
                <div class="forecast-summary-label">Всего ожидается</div>
                <div class="forecast-summary-value" style="color: #047857;">
                  {{ formatCurrency(summary?.payments.pendingSum ?? 0) }}
                </div>
              </div>
              <div class="forecast-summary-item">
                <div class="forecast-summary-label">Платежей</div>
                <div class="forecast-summary-value" style="color: #f59e0b;">
                  {{ summary?.payments.pendingCount ?? 0 }}
                </div>
              </div>
              <div class="forecast-summary-item">
                <div class="forecast-summary-label">Средний платёж</div>
                <div class="forecast-summary-value" style="color: #8b5cf6;">
                  {{ formatCurrency(avgPendingPayment) }}
                </div>
              </div>
            </div>

            <div style="height: 200px;">
              <Line :data="forecastChartData" :options="lineOptions" />
            </div>
          </v-card>
        </v-col>
      </v-row>

      </div>

      <!-- Portfolio overview — available for PRO+ -->
      <div class="an-portfolio-section">
      <div class="an-section-title">Обзор портфеля</div>
      <v-row class="mb-2">
        <v-col cols="12" lg="4">
          <v-card rounded="lg" elevation="0" border class="pa-5 h-100">
            <div class="chart-title mb-1">Статус сделок</div>
            <div class="chart-subtitle mb-4">Распределение по статусам</div>
            <div class="d-flex align-center" style="gap: 24px;">
              <div style="width: 140px; height: 140px; flex-shrink: 0;">
                <Doughnut :data="statusDistribution" :options="doughnutOptions" />
              </div>
              <div class="status-legend">
                <div class="status-legend-item">
                  <div class="status-dot" style="background: #047857;" />
                  <span>Активные</span>
                  <span class="status-legend-count">{{ dealsStore.counts?.byStatus?.ACTIVE ?? 0 }}</span>
                </div>
                <div class="status-legend-item">
                  <div class="status-dot" style="background: #3b82f6;" />
                  <span>Завершённые</span>
                  <span class="status-legend-count">{{ dealsStore.counts?.byStatus?.COMPLETED ?? 0 }}</span>
                </div>
                <div class="status-legend-item">
                  <div class="status-dot" style="background: #f59e0b;" />
                  <span>Спорные</span>
                  <span class="status-legend-count">{{ dealsStore.counts?.byStatus?.DISPUTED ?? 0 }}</span>
                </div>
                <div class="status-legend-item">
                  <div class="status-dot" style="background: #ef4444;" />
                  <span>Отменённые</span>
                  <span class="status-legend-count">{{ dealsStore.counts?.byStatus?.CANCELLED ?? 0 }}</span>
                </div>
              </div>
            </div>
          </v-card>
        </v-col>

        <v-col cols="12" lg="8">
          <v-card rounded="lg" elevation="0" border class="pa-5 h-100">
            <div class="chart-title mb-1">Сводка по платежам</div>
            <div class="chart-subtitle mb-4">Текущее состояние</div>
            <div class="payment-summary-grid">
              <div class="payment-summary-card">
                <div class="payment-summary-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
                  <v-icon icon="mdi-check-circle" size="22" />
                </div>
                <div class="payment-summary-value">{{ summary?.payments.paidCount ?? 0 }}</div>
                <div class="payment-summary-label">Оплаченных</div>
                <div class="payment-summary-amount" style="color: #047857;">{{ formatCurrencyShort(summary?.payments.paidSum ?? 0) }}</div>
              </div>
              <div class="payment-summary-card">
                <div class="payment-summary-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
                  <v-icon icon="mdi-clock-outline" size="22" />
                </div>
                <div class="payment-summary-value">{{ summary?.payments.pendingCount ?? 0 }}</div>
                <div class="payment-summary-label">Ожидаемых</div>
                <div class="payment-summary-amount" style="color: #3b82f6;">{{ formatCurrencyShort(summary?.payments.pendingSum ?? 0) }}</div>
              </div>
              <div class="payment-summary-card">
                <div class="payment-summary-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
                  <v-icon icon="mdi-alert-circle" size="22" />
                </div>
                <div class="payment-summary-value">{{ summary?.payments.overdueCount ?? 0 }}</div>
                <div class="payment-summary-label">Просроченных</div>
                <div class="payment-summary-amount" style="color: #ef4444;">{{ formatCurrencyShort(overdueAmount) }}</div>
              </div>
            </div>
          </v-card>
        </v-col>
      </v-row>
      </div>
      </div>
      </template>
    </template>

    <!-- Profit Detail Dialog -->
    <v-dialog v-model="profitDetailDialog" max-width="900" scrollable :fullscreen="isMobile">
      <v-card rounded="lg" class="pd-dialog">
        <!-- Header -->
        <div class="pd-head">
          <div class="pd-head-left">
            <div class="pd-head-icon">
              <v-icon :icon="profitDetailMode === 'expected' ? 'mdi-chart-line' : 'mdi-cash-multiple'" size="22" />
            </div>
            <div>
              <div class="pd-head-title">{{ profitDetailMode === 'expected' ? 'Прогноз дохода' : 'Доход по сделкам' }}</div>
              <div class="pd-head-sub">{{ profitDetailMode === 'expected' ? 'Сколько ещё заработаете, когда платежи оплатят' : 'Из чего сложился доход за период — по каждой сделке' }}</div>
            </div>
          </div>
          <button class="dialog-close-sm" @click="profitDetailDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pd-body">
          <!-- Period selector -->
          <div class="pd-period-row mb-4">
            <button
              v-for="opt in profitMonthOptions"
              :key="opt.key ?? 'all'"
              class="pd-period-btn"
              :class="{ 'pd-period-btn--active': profitDetailMonth === opt.key }"
              @click="profitDetailMonth = opt.key"
            >
              {{ opt.label }}
            </button>
          </div>

          <!-- Summary cards -->
          <div class="pd-stats mb-4">
            <div v-if="profitDetailMode === 'all'" class="pd-stat">
              <div class="pd-stat-label">Ожидается за месяц</div>
              <div class="pd-stat-value">{{ formatCurrency(profitDetailPlanned) }}</div>
              <div class="pd-stat-hint">
                весь план: пришло + осталось ·
                {{ monthDealsTotals?.dealsCount ?? profitByDeal.length }}
                {{ (monthDealsTotals?.dealsCount ?? profitByDeal.length) === 1 ? 'сделка' : (monthDealsTotals?.dealsCount ?? profitByDeal.length) < 5 ? 'сделки' : 'сделок' }}
                <template v-if="monthDealsTruncated"> · показаны крупнейшие {{ profitByDeal.length }}</template>
              </div>
            </div>
            <div v-if="profitDetailPaid > 0" class="pd-stat">
              <div class="pd-stat-label">Пришло</div>
              <div class="pd-stat-value" style="color: #10b981;">{{ formatCurrency(profitDetailPaid) }}</div>
              <div class="pd-stat-profit">
                из них ваша прибыль +{{ formatCurrency(Math.max(0, profitDetailPartner)) }}
                <ProfitFormula
                  :amount="profitDetailPaid"
                  :gross="profitDetailGrossPaid"
                  :co-investor="profitDetailCoInvPaid"
                  :net="profitDetailPartner"
                />
              </div>
            </div>
            <div v-if="profitDetailPending > 0" class="pd-stat">
              <div class="pd-stat-label">Осталось</div>
              <div class="pd-stat-value" style="color: #3b82f6;">{{ formatCurrency(profitDetailPending) }}</div>
              <div class="pd-stat-profit pd-stat-profit--proj">
                ваша прибыль ~{{ formatCurrency(Math.max(0, profitDetailProjectedPartner)) }} после оплаты
                <ProfitFormula
                  :amount="profitDetailPending"
                  :gross="profitDetailGrossPending"
                  :co-investor="profitDetailCoInvPending"
                  :net="profitDetailProjectedPartner"
                  projected
                />
              </div>
            </div>
            <div v-if="profitDetailCoInvestorAll > 0" class="pd-stat">
              <div class="pd-stat-label">Со-инвесторам</div>
              <div class="pd-stat-value" style="color: #8b5cf6;">{{ formatCurrency(profitDetailCoInvestorAll) }}</div>
              <div class="pd-stat-hint">доля со-инвесторов со всех платежей<template v-if="profitDetailProfitAll > 0"> · ≈ {{ Math.round(profitDetailCoInvestorAll / profitDetailProfitAll * 100) }}% дохода</template></div>
            </div>
          </div>

          <!-- Filter tabs -->
          <div v-if="profitByDeal.length" class="pd-filter">
            <button class="pd-filter-btn" :class="{ 'pd-filter-btn--active': dealFilter === 'all' }" @click="dealFilter = 'all'">
              Все <span class="pd-filter-count">{{ dealFilterCounts.all }}</span>
            </button>
            <button class="pd-filter-btn" :class="{ 'pd-filter-btn--active': dealFilter === 'paid' }" @click="dealFilter = 'paid'">
              Оплаченные <span class="pd-filter-count">{{ dealFilterCounts.paid }}</span>
            </button>
            <button class="pd-filter-btn" :class="{ 'pd-filter-btn--active': dealFilter === 'pending' }" @click="dealFilter = 'pending'">
              Неоплаченные <span class="pd-filter-count">{{ dealFilterCounts.pending }}</span>
            </button>
          </div>

          <!-- Deal table -->
          <div v-if="displayDeals.length" class="pdt">
            <!-- Header -->
            <div class="pdt-head">
              <span class="pdt-h-deal">Сделка</span>
              <span class="pdt-h-num" title="Полная сумма платежей по этой сделке за месяц — которые были оплачены или должны быть по плану">Платёж за месяц</span>
              <span class="pdt-h-num" title="Ваш чистый заработок с этих платежей — доля наценки за вычетом доли со-инвесторов">Ваша прибыль</span>
              <span class="pdt-h-chev" />
            </div>

            <!-- Rows -->
            <div
              v-for="d in displayDeals"
              :key="d.dealId"
              class="pdt-row"
              @click="profitDetailDialog = false; router.push(`/deals/${d.dealId}`)"
            >
              <!-- Сделка -->
              <div class="pdt-deal">
                <div class="pdt-deal-name">{{ d.productName }}</div>
                <div class="pdt-deal-meta">{{ d.clientName }}</div>
                <div v-if="d.earlyOffMonth > 0 || d.lateOffMonth > 0" class="pdt-badges">
                  <span
                    v-if="d.earlyOffMonth > 0"
                    class="pdt-badge pdt-badge--early"
                    title="Эти платежи оплачены раньше срока — доход учтён в этом месяце по факту оплаты"
                  >
                    <v-icon icon="mdi-calendar-arrow-left" size="11" />
                    {{ d.earlyOffMonth }} досрочно
                  </span>
                  <span
                    v-if="d.lateOffMonth > 0"
                    class="pdt-badge pdt-badge--late"
                    title="Эти платежи оплачены позже срока — доход учтён в этом месяце по факту оплаты"
                  >
                    <v-icon icon="mdi-calendar-arrow-right" size="11" />
                    {{ d.lateOffMonth }} с опозданием
                  </span>
                </div>
              </div>

              <!-- Платёж за месяц -->
              <div class="pdt-num">
                <span class="pdt-num-label">Платёж за месяц</span>
                <div class="pdt-num-val" :class="d.hasPaid ? 'pdt-num-val--in' : 'pdt-num-val--left'">{{ formatCurrency(d.amount) }}</div>
                <div class="pdt-num-sub">
                  {{ d.count }} {{ d.count === 1 ? 'платёж' : (d.count < 5 ? 'платежа' : 'платежей') }}<template v-if="!d.hasPaid"> · не оплачен{{ d.count === 1 ? '' : 'ы' }}</template>
                </div>
              </div>

              <!-- Ваша прибыль -->
              <div class="pdt-num">
                <span class="pdt-num-label">Ваша прибыль</span>
                <div class="pdt-num-val" :class="d.hasPaid ? 'pdt-num-val--profit' : 'pdt-num-val--proj'">
                  {{ d.hasPaid ? '+' : '~' }}{{ formatCurrency(Math.max(0, d.net)) }}
                  <ProfitFormula
                    :amount="d.amount"
                    :gross="d.gross"
                    :co-investor="d.coInv"
                    :net="d.net"
                    :share="d.profitShare"
                    :projected="!d.hasPaid"
                  />
                </div>
                <div class="pdt-num-sub" title="Какая доля каждого платежа — прибыль. Остальное — возврат вложенных денег за товар">прибыль {{ Math.round(d.profitShare * 100) }}% от платежа</div>
                <div v-if="d.coInv > 0" class="pdt-num-sub">со-инвесторам {{ formatCurrency(d.coInv) }}</div>
                <div v-if="d.hasPaid && d.hasPending" class="pdt-num-sub pdt-num-sub--proj">часть — прогноз по неоплаченным</div>
                <div v-else-if="!d.hasPaid" class="pdt-num-sub pdt-num-sub--proj">будет после оплаты</div>
              </div>

              <v-icon icon="mdi-chevron-right" size="16" class="pdt-chev" />
            </div>
          </div>

          <div v-else class="text-center pa-8 text-medium-emphasis text-body-2">
            {{ dealFilter === 'paid' ? 'Нет оплаченных платежей за период' : dealFilter === 'pending' ? 'Нет неоплаченных платежей за период' : 'Нет платежей за выбранный период' }}
          </div>
        </div>
      </v-card>
    </v-dialog>

    <!-- Расшифровка показателя сводки — общий компонент с отчётами -->
    <MetricDetailDialog
      v-model="metricOpen"
      :title="metricTitle"
      :hint="metricHint"
      :total="metricTotal"
      :color="metricColor"
      :items="metricItems"
      :loading="metricLoading"
      :count="metricCount"
      :has-more="metricHasMore"
      @load-more="loadMoreBreakdown"
    />


  </div>
</template>

<style scoped>
.h-100 { height: 100%; }

/* Sections wrapper for reordering */
.an-sections-wrap {
  display: flex;
  flex-direction: column;
}
.an-sections-wrap--reorder .an-portfolio-section {
  order: -1;
}
.an-sections-wrap--reorder .an-charts-section {
  order: 1;
}

/* Charts section lock */
.an-charts-section {
  position: relative;
}
.an-charts-section--locked {
  pointer-events: none;
  user-select: none;
}
.an-charts-section--locked > *:not(.an-charts-overlay) {
  filter: blur(5px);
  opacity: 0.7;
}
.an-charts-overlay {
  position: absolute; inset: 0; z-index: 2;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 60px;
  pointer-events: auto; cursor: pointer;
  border-radius: 16px;
}
.an-charts-overlay-content {
  text-align: center; padding: 32px 36px;
  background: #fff;
  border-radius: 20px;
  border: 1px solid rgba(232, 185, 49, 0.3);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.1);
  max-width: 420px;
}
.an-charts-overlay-icon {
  width: 56px; height: 56px; border-radius: 14px; margin: 0 auto 14px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(232, 185, 49, 0.1);
  color: #e8b931;
}
.an-charts-overlay-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 6px;
}
.an-charts-overlay-text {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  line-height: 1.5; margin-bottom: 16px;
}
.an-charts-overlay-features {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  margin-bottom: 20px; text-align: left;
}
.an-charts-overlay-feat {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.an-charts-overlay-feat .v-icon { color: #047857; }
.an-charts-overlay-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 12px 24px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.an-charts-overlay-btn:hover { background: #065f46; }

.dark .an-charts-overlay {
  background: rgba(26, 26, 46, 0.3);
}
.dark .an-charts-overlay-content {
  background: #1e1e2e;
  border-color: rgba(232, 185, 49, 0.25);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}
.dark .an-charts-overlay-icon {
  background: rgba(232, 185, 49, 0.12);
}
.dark .an-charts-overlay-feat {
  background: rgba(255, 255, 255, 0.04);
}

/* Section titles */
.an-section-title {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.35);
  margin-bottom: 12px;
  padding-left: 2px;
}

/* KPI Row */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.kpi-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}

.kpi-icon-wrap {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kpi-info { min-width: 0; }

.kpi-value {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.kpi-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
}

/* Chart cards */
.chart-title {
  font-size: 16px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.chart-subtitle {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.chart-total {
  font-size: 20px;
  font-weight: 700;
  color: #047857;
}

/* Forecast summary */
.forecast-summary {
  display: flex;
  gap: 24px;
}

.forecast-summary-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.forecast-summary-value {
  font-size: 15px;
  font-weight: 700;
}

/* Status legend */
.status-legend {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.status-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-legend-count {
  margin-left: auto;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Payment summary */
.payment-summary-grid {
  display: flex;
  gap: 16px;
}

.payment-summary-card {
  flex: 1;
  text-align: center;
  padding: 16px 12px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

.payment-summary-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 10px;
}

.payment-summary-value {
  font-size: 24px;
  font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.85);
  line-height: 1;
}

.payment-summary-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 4px;
}

.payment-summary-amount {
  font-size: 14px;
  font-weight: 700;
  margin-top: 4px;
}

/* ── Year calendar ── */
.yc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 28px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  flex-wrap: wrap;
  gap: 16px;
}
.yc-header-left { display: flex; flex-direction: column; }
.yc-header-label {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.yc-header-year {
  display: flex; align-items: center; gap: 8px;
  font-size: 28px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.85);
  letter-spacing: -0.02em;
}
.yc-arrow {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
}
.yc-arrow:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.yc-header-stats {
  display: flex; align-items: center; gap: 20px;
}
.yc-stat { text-align: center; }
.yc-stat-value {
  font-size: 20px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
  line-height: 1.2;
}
.yc-stat-label {
  font-size: 11px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 2px;
}
.yc-stat-sub {
  font-size: 10px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.35);
  margin-top: 3px;
}
.yc-stat-divider {
  width: 1px; height: 28px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

/* Column captions — shared grid template with rows */
.yc-caption,
.yc-row {
  display: grid;
  grid-template-columns: 130px minmax(90px, 1fr) 116px 104px 104px 128px 22px;
  align-items: center;
  gap: 14px;
}
.yc-caption {
  padding: 12px 26px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.yc-caption span {
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.4);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.yc-cap-num { text-align: right; }

/* Month list — flat rows with clear dividers */
.yc-list { padding: 4px 0 0; }
.yc-row {
  padding: 15px 26px;
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
}
/* Отчётливый разделитель между месяцами */
.yc-row + .yc-row::after {
  content: '';
  position: absolute;
  top: 0; left: 26px; right: 26px;
  height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.1);
}
.yc-row:hover { background: rgba(var(--v-theme-on-surface), 0.035); }
/* при ховере скрываем разделитель у соседей — строка «выделяется» целиком */
.yc-row:hover::after,
.yc-row:hover + .yc-row::after { background: transparent; }
.yc-row--current { background: rgba(16, 185, 129, 0.05); }
.yc-row--current:hover { background: rgba(16, 185, 129, 0.08); }
/* тонкий цветной маркер слева только у текущего месяца */
.yc-row--current::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: #10b981;
}
.yc-row--empty .yc-row-mname { color: rgba(var(--v-theme-on-surface), 0.4); }

/* Month cell */
.yc-row-month {
  display: flex; align-items: center; flex-wrap: wrap;
  gap: 4px 8px;
}
.yc-row-mname {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.yc-row-mname--current { color: #047857; }
.yc-month-now {
  font-size: 10px; font-weight: 700;
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
  padding: 1px 6px; border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.yc-row-pays {
  font-size: 11px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  flex-basis: 100%;
}

/* Mid: bar + chips */
.yc-row-mid { min-width: 0; }
.yc-bar-track {
  height: 8px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  display: flex;
  overflow: hidden;
  gap: 1px;
}
.yc-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s cubic-bezier(0.23, 1, 0.32, 1);
  min-width: 0;
  flex-shrink: 0;
}
.yc-bar--earned { background: #10b981; }
.yc-bar--expected { background: #3b82f6; }
.yc-bar--pending { background: #3b82f6; }
.yc-row-chips {
  display: flex; flex-wrap: wrap; gap: 4px 6px;
  margin-top: 7px;
}
.yc-chip {
  font-size: 11px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgba(var(--v-theme-on-surface), 0.05);
  padding: 2px 8px; border-radius: 6px;
  white-space: nowrap;
}
.yc-chip--off {
  display: inline-flex; align-items: center; gap: 3px;
  color: #10b981; background: rgba(16, 185, 129, 0.1);
}
.yc-chip--off-late {
  display: inline-flex; align-items: center; gap: 3px;
  color: #f59e0b; background: rgba(245, 158, 11, 0.1);
}

/* Numeric columns */
.yc-row-num { text-align: right; }
.yc-num-val {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.yc-num-val--earned { color: #10b981; }
.yc-num-val--expected { color: #3b82f6; }
.yc-num-val--pending { color: #3b82f6; }
.yc-num-val--net { color: #059669; font-weight: 800; }
.yc-num-empty {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.2);
}
.yc-row-chev {
  color: rgba(var(--v-theme-on-surface), 0.2);
  justify-self: end;
}

/* Компактная строка сумм для телефона (на десктопе скрыта) */
.yc-row-mmoney { display: none; }
.yc-row-mmoney span {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.yc-row-mmoney b {
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.yc-mm--green b { color: #10b981; }
.yc-mm--pending b { color: #3b82f6; }
.yc-mm--net b { color: #059669; }

/* Footer / legend */
.yc-footer {
  display: flex; align-items: center; gap: 16px;
  padding: 12px 28px 16px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.yc-legend {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.yc-legend-dot {
  width: 8px; height: 8px; border-radius: 50%;
}
.yc-legend-hint {
  margin-left: auto;
  display: flex; align-items: center; gap: 4px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.35);
}

/* ── Вкладки раздела «Обзор | Отчёты» ── */
/* Строка без собственного фона: слева «пилюля» вкладок, справа — отдельная
   кнопка выгрузки. Общий фон визуально склеивал бы их в один элемент. */
.an-tabs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 18px;
}
.an-tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.an-tab-export {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px;
  border: 1px solid rgba(220, 38, 38, 0.3);
  border-radius: 10px;
  background: transparent;
  color: #dc2626;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.an-tab-export:hover:not(:disabled) { background: rgba(220, 38, 38, 0.07); }
.an-tab-export:disabled { opacity: 0.5; cursor: default; }
.an-export-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.an-tab-export--excel {
  border-color: rgba(16, 124, 65, 0.3);
  color: #107c41;
}
.an-tab-export--excel:hover:not(:disabled) { background: rgba(16, 124, 65, 0.07); }
.an-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 18px;
  border: none; border-radius: 9px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.an-tab:hover { color: rgba(var(--v-theme-on-surface), 0.8); }
.an-tab--active {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* ── Formula explainer ── */
.an-formula {
  display: flex;
  gap: 16px;
  padding: 18px 22px;
  border-radius: 12px;
  background: rgba(4, 120, 87, 0.04);
  border: 1px solid rgba(4, 120, 87, 0.12);
}
.an-formula-icon {
  width: 40px; height: 40px; min-width: 40px;
  border-radius: 10px;
  background: rgba(4, 120, 87, 0.08);
  display: flex; align-items: center; justify-content: center;
}
.an-formula-body { flex: 1; }
.an-formula-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
  margin-bottom: 4px;
}
.an-formula-text {
  font-size: 13px; line-height: 1.6;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.an-formula-text code {
  font-size: 12px; font-weight: 600;
  padding: 2px 7px; border-radius: 4px;
  background: rgba(4, 120, 87, 0.08);
  color: #047857;
}

/* ── Chart hint ── */
.an-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 12px;
  line-height: 1.55;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.an-hint .v-icon {
  color: rgba(var(--v-theme-on-surface), 0.3);
  flex-shrink: 0;
  margin-top: 1px;
}

/* ── Detail button ── */
.an-detail-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: rgba(16, 185, 129, 0.08);
  color: #10b981;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.an-detail-btn:hover {
  background: rgba(16, 185, 129, 0.16);
}

/* ── Month quick links under chart ── */
.an-month-links {
  display: flex;
  gap: 6px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.an-month-link {
  flex: 1;
  padding: 6px 4px;
  border-radius: 6px;
  border: none;
  background: rgba(var(--v-theme-on-surface), 0.03);
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  transition: all 0.15s;
}
.an-month-link:hover {
  background: rgba(16, 185, 129, 0.08);
  color: #10b981;
}

/* ── Dialog close ── */
.dialog-close-sm {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: background 0.15s;
}
.dialog-close-sm:hover {
  background: rgba(var(--v-theme-on-surface), 0.12);
}

/* ── Profit Detail Dialog ── */
.pd-period-row {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.pd-period-btn {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.pd-period-btn:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
}
.pd-period-btn--active {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.3);
  color: #10b981;
}

/* ─── Profit detail dialog — header / body / stat cards ─── */
.pd-dialog { display: flex; flex-direction: column; }
.pd-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  flex-shrink: 0;
}
.pd-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.pd-head-icon {
  width: 44px; height: 44px; min-width: 44px;
  border-radius: 12px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  display: flex; align-items: center; justify-content: center;
}
.pd-head-title {
  font-size: 18px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.9);
  letter-spacing: -0.01em;
}
.pd-head-sub {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.pd-body { padding: 20px 24px 24px; overflow-y: auto; }

.pd-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.pd-stat {
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.pd-stat-label {
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.pd-stat-value {
  font-size: 20px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.88);
  letter-spacing: -0.01em;
  margin-top: 4px;
}
.pd-stat-hint {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 4px;
  line-height: 1.35;
}
/* Подстрока «ваша прибыль» внутри карточек Пришло/Осталось */
.pd-stat-profit {
  display: inline-block;
  margin-top: 7px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  font-size: 11px; font-weight: 700;
  line-height: 1.3;
}
.pd-stat-profit--proj {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.pd-summary {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.pd-summary-item {
  flex: 1;
  text-align: center;
}
.pd-summary-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 4px;
}
.pd-summary-value {
  font-size: 18px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.pd-summary-divider {
  width: 1px;
  height: 32px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  margin: 0 8px;
}
.pd-summary--sub {
  padding: 12px 20px;
}
.pd-summary--sub .pd-summary-value {
  font-size: 15px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* ─── Filter tabs ─── */
.pd-filter {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.pd-filter-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px;
  border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.pd-filter-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.2); }
.pd-filter-btn--active {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.3);
  color: #10b981;
}
.pd-filter-count {
  font-size: 11px; font-weight: 700;
  padding: 1px 7px; border-radius: 20px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.pd-filter-btn--active .pd-filter-count {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

/* ─── Deal table inside profit dialog (без обёртки/границы) ─── */
.pdt-head,
.pdt-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px 168px 20px;
  gap: 14px;
  align-items: start;
}
.pdt-head {
  padding: 0 12px 10px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.pdt-head span {
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.pdt-h-num { text-align: right; cursor: help; }

.pdt-row {
  padding: 14px 12px;
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 8px;
}
.pdt-row + .pdt-row { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06); }
.pdt-row:hover { background: rgba(var(--v-theme-on-surface), 0.03); }

/* Deal cell */
.pdt-deal { min-width: 0; }
.pdt-deal-name {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.88);
  line-height: 1.3;
}
.pdt-deal-meta {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.pdt-badges {
  display: flex; flex-wrap: wrap; gap: 4px 6px;
  margin-top: 6px;
}
.pdt-badge {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 600;
  padding: 1px 7px; border-radius: 6px;
  white-space: nowrap;
}
.pdt-badge--early { color: #10b981; background: rgba(16, 185, 129, 0.1); }
.pdt-badge--late { color: #f59e0b; background: rgba(245, 158, 11, 0.1); }

/* Numeric cells */
.pdt-num { text-align: right; min-width: 0; }
.pdt-num-label {
  display: none; /* виден только на телефоне */
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.pdt-num-val {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
}
.pdt-num-val--in { color: #10b981; }
.pdt-num-val--left { color: #3b82f6; }
.pdt-num-val--profit { color: #059669; font-weight: 800; }
.pdt-num-val--proj { color: #3b82f6; }
.pdt-num-sub {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 2px;
  line-height: 1.3;
}
.pdt-num-sub--proj { color: rgba(59, 130, 246, 0.75); }
.pdt-num-dash {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.2);
}
.pdt-chev {
  color: rgba(var(--v-theme-on-surface), 0.2);
  align-self: center;
  justify-self: end;
}

/* Breakdown dialog */
/* ─── Breakdown Dialog ─── */
.bd-dialog { overflow: hidden; }
.bd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 24px 16px;
}
.bd-header-left { display: flex; align-items: center; gap: 12px; }
.bd-header-icon {
  width: 42px; height: 42px; min-width: 42px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
}
.bd-header-title { font-size: 17px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.bd-header-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4); margin-top: 1px; }
.bd-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.4);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.12s;
}
.bd-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.bd-total-hero {
  display: flex; align-items: baseline; gap: 12px;
  padding: 16px 24px; margin: 0 16px; border-radius: 12px;
}
.bd-total-value { font-size: 26px; font-weight: 800; }
.bd-total-label { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.4); }
.bd-list { padding: 8px 12px 12px; }
.bd-list--scroll { max-height: 400px; overflow-y: auto; }
.bd-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 32px; color: rgba(var(--v-theme-on-surface), 0.3); font-size: 13px;
}
.bd-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px; border-radius: 12px;
  text-decoration: none; color: inherit; transition: background 0.12s;
}
.bd-row:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.bd-avatar {
  width: 38px; height: 38px; min-width: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; color: #fff;
}
.bd-info { flex: 1; min-width: 0; }
.bd-product {
  font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bd-extra { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4); margin-top: 2px; }
.bd-progress { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.bd-progress-bar {
  flex: 1; height: 4px; border-radius: 2px;
  background: rgba(var(--v-theme-on-surface), 0.06); overflow: hidden;
}
.bd-progress-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
.bd-progress-text { font-size: 10px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.35); }
.bd-right { text-align: right; flex-shrink: 0; }
.bd-value { font-size: 14px; font-weight: 700; }
.bd-share { font-size: 10px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.3); margin-top: 1px; }

/* Cashbox scope chips */
.cb-scope {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.cb-scope-label {
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  text-transform: uppercase; letter-spacing: 0.4px;
  flex-shrink: 0;
}
.cb-scope-chips {
  display: flex; gap: 6px; flex-wrap: wrap; flex: 1;
}
.cb-scope-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px; padding: 0 12px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border: 1px solid transparent;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.cb-scope-chip:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  border-color: var(--cb-color, rgba(var(--v-theme-on-surface), 0.15));
  color: var(--cb-color, inherit);
}
.cb-scope-chip--active {
  background: rgb(var(--v-theme-primary));
  color: #fff;
  border-color: rgb(var(--v-theme-primary));
}
.cb-scope-chip--active:hover {
  background: rgb(var(--v-theme-primary));
  color: #fff;
}
.cb-scope-open {
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px; padding: 0 12px; border-radius: 8px;
  background: transparent;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.18);
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
  margin-left: auto;
}
.cb-scope-open:hover {
  border-color: #047857;
  color: #047857;
}

/* ── Mobile ── */
@media (max-width: 768px) {
  .cb-scope {
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px;
  }
  .cb-scope-open {
    margin-left: auto;
    order: 1;
  }
  .cb-scope-chips {
    order: 99;
    flex-basis: 100%;
    overflow-x: auto;
    flex-wrap: nowrap;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .cb-scope-chips::-webkit-scrollbar { display: none; }
  .cb-scope-chip { flex-shrink: 0; }

  .kpi-row {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .kpi-card {
    padding: 12px;
    gap: 10px;
  }
  .kpi-icon-wrap {
    width: 36px; height: 36px; min-width: 36px;
    border-radius: 9px;
  }
  .kpi-value { font-size: 15px; }
  .kpi-label { font-size: 11px; white-space: normal; }

  .chart-title { font-size: 15px; }
  .chart-subtitle { font-size: 12px; }
  .chart-total { font-size: 17px; }

  .payment-summary-grid {
    flex-wrap: wrap;
    gap: 10px;
  }
  .payment-summary-card {
    flex: 1 1 calc(50% - 5px);
    padding: 12px 8px;
    min-width: 0;
  }
  .payment-summary-icon { width: 36px; height: 36px; margin-bottom: 6px; }
  .payment-summary-value { font-size: 18px; }
  .payment-summary-label { font-size: 11px; }
  .payment-summary-amount { font-size: 12px; }

  .forecast-summary {
    flex-wrap: wrap;
    gap: 12px;
  }

  .yc-header {
    padding: 16px 14px 14px;
    gap: 12px;
  }
  .yc-header-year { font-size: 22px; }
  .yc-header-stats { gap: 12px; }
  .yc-stat-value { font-size: 15px; }
  .yc-stat-label { font-size: 10px; }
  .yc-stat-divider { height: 22px; }

  /* Каптион прячем; на телефоне — месяц сверху, бар + подписанные суммы ниже */
  .yc-caption { display: none; }
  .yc-list { padding: 2px 0 0; }
  .yc-row {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 14px 16px;
  }
  .yc-row + .yc-row::after { left: 16px; right: 16px; }
  .yc-row-num, .yc-row-chev { display: none; } /* колонки-числа заменяет компактная строка */
  .yc-row-mid { grid-column: 1; }
  .yc-row-mmoney {
    display: flex; flex-wrap: wrap;
    column-gap: 14px; row-gap: 4px;
    margin-top: 9px;
  }

  .yc-footer {
    padding: 10px 14px 14px;
    flex-wrap: wrap;
    gap: 10px;
  }
  .yc-legend-hint { display: none; }

  .an-formula {
    padding: 14px;
    gap: 12px;
  }
  .an-formula-icon { width: 36px; height: 36px; min-width: 36px; }
  .an-formula-title { font-size: 13px; }
  .an-formula-text { font-size: 12px; line-height: 1.5; }

  .an-section-title {
    font-size: 12px;
    margin-bottom: 10px;
  }

  .bd-dialog {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-radius: 0;
  }
  .bd-header { flex-shrink: 0; }
  .bd-total-hero {
    padding: 14px 16px;
    margin: 0 12px;
    flex-wrap: wrap;
    gap: 6px;
    flex-shrink: 0;
  }
  .bd-total-value { font-size: 22px; }
  .bd-list { padding: 8px; }
  .bd-list--scroll {
    max-height: none;
    flex: 1 1 auto;
    min-height: 0;
  }
  .bd-row { padding: 10px 8px; gap: 10px; }
  .bd-avatar { width: 34px; height: 34px; min-width: 34px; }

  .pd-summary { flex-wrap: wrap; gap: 12px; }
  .pd-period-row { gap: 4px; }
  .pd-period-btn { padding: 6px 10px; font-size: 12px; }

  /* Модалка дохода — во весь экран, шапка/тело/скролл */
  .pd-dialog { height: 100%; border-radius: 0; }
  .pd-head { padding: 14px 16px; }
  .pd-head-icon { width: 38px; height: 38px; min-width: 38px; }
  .pd-head-title { font-size: 16px; }
  .pd-head-sub { font-size: 12px; }
  .pd-body { padding: 16px; flex: 1 1 auto; min-height: 0; }
  .pd-stats { grid-template-columns: repeat(2, 1fr); }
  .pd-stat-value { font-size: 18px; }

  /* Таблица сделок → карточки: шапку прячем, суммы с подписями в ряд */
  .pdt-head { display: none; }
  .pdt-row {
    display: flex; flex-wrap: wrap;
    gap: 10px 16px;
    padding: 14px;
  }
  .pdt-deal { flex: 1 1 100%; }
  .pdt-num {
    flex: 1 1 auto;
    text-align: left;
    min-width: 84px;
  }
  .pdt-num-label { display: block; margin-bottom: 2px; }
  .pdt-chev { display: none; }

  .an-charts-overlay-content { padding: 24px 18px; }
  .an-charts-overlay-features { grid-template-columns: 1fr; }
  .an-charts-overlay-title { font-size: 16px; }
  .an-charts-overlay-text { font-size: 12px; }
}

@media (max-width: 480px) {
  .kpi-row { grid-template-columns: 1fr; }
  .payment-summary-card { flex: 1 1 100%; }
}

</style>
