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
import { useAnalyticsSummary, useAnalyticsMonthly, useAnalyticsMonthlySales, useAnalyticsTimeliness, fetchDealsBreakdown, fetchMonthDeals, fetchTimelinessDetails } from '@/composables/useAnalyticsOverview'
import { pluralDays } from '@/utils/paymentAttribution'
import ServerPager from '@/components/ServerPager.vue'
import { PER_PAGE_OPTIONS, usePageSize } from '@/composables/useListPrefs'
import type {
  MonthPaymentRow,
  MonthDealsResponse,
  TimelinessBucket,
  TimelinessBucketKey,
  TimelinessDetailRow,
  TimelinessSide,
} from '@/types/analytics'
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
const { summary, loading: summaryLoading } = useAnalyticsSummary(() => selectedCashBoxId.value)

const earnedProfit = computed(() => summary.value?.deals.grossEarned ?? 0)

// ── Своевременность: просрочка и оплаты заранее ──────────────────────────
// Срез «на сейчас», без периода: вопрос не «сколько было», а «как обстоят дела».
const { timeliness } = useAnalyticsTimeliness(() => selectedCashBoxId.value)

/** Подписи корзин возраста — одни на обе стороны, шкалы сравнимы. */
const TIMELINESS_LABELS: Record<TimelinessBucketKey, string> = {
  d1_7: '1–7 дней',
  d8_30: '8–30 дней',
  d31_60: '31–60 дней',
  d61_90: '61–90 дней',
  d91_180: '91–180 дней',
  d180p: '180+ дней',
}

/** Пока данные не пришли, карточки показывают нули, а не пустоту. */
const EMPTY_TIMELINESS_SIDE: TimelinessSide = {
  count: 0, amount: 0, deals: 0, clients: 0, avgDays: 0, maxDays: 0,
  buckets: (Object.keys(TIMELINESS_LABELS) as TimelinessBucketKey[]).map((key) => ({
    key, count: 0, amount: 0, deals: 0, clients: 0,
  })),
}

const timelinessSides = computed(() => [
  {
    key: 'overdue',
    title: 'Просрочено',
    subtitle: 'Платежи, срок которых уже прошёл',
    countLabel: 'Просрочек',
    ageTitle: 'Возраст просрочки',
    emptyText: 'Просроченных платежей нет',
    color: '#ef4444',
    data: timeliness.value?.overdue ?? EMPTY_TIMELINESS_SIDE,
  },
  {
    key: 'early',
    title: 'Оплачено заранее',
    subtitle: 'Платежи, внесённые раньше своего срока',
    countLabel: 'Оплат',
    ageTitle: 'Насколько раньше срока',
    emptyText: 'Оплат раньше срока пока нет',
    color: '#047857',
    data: timeliness.value?.early ?? EMPTY_TIMELINESS_SIDE,
  },
])

/**
 * Доля от вложенного в дело — вторая координата для просрочки и досрочных.
 *
 * База — totalCapital: собственный капитал партнёра плюс капитал
 * со-инвесторов, ровно тот же показатель, что «Общий капитал» на странице
 * кассы. Сумма просрочки в рублях сама по себе ни о чём не говорит: 500 тыс.
 * — это половина дела у одного партнёра и пара процентов у другого. Процент
 * отвечает на вопрос «какая часть вложенных денег зависла».
 *
 * При выбранной кассе база — капитал этой кассы: иначе доля считалась бы от
 * всего дела, а суммы — только по одной кассе.
 *
 * Капитал берём из уже загруженного ответа: у того, кому финансы закрыты
 * правами или тарифом, запрос молча отваливается, база остаётся нулевой и
 * процент просто не показывается.
 */
const investedBase = computed(() => Math.max(0, capital.value?.totalCapital ?? 0))

/** «12,4%», «45%» или «<0,1%». null — базы нет или считать нечего. */
function pctOfInvested(amount: number): string | null {
  if (investedBase.value <= 0 || amount <= 0) return null
  const pct = (amount / investedBase.value) * 100
  if (pct < 0.1) return '<0,1%'
  // Двузначные проценты в десятых не нуждаются — только шумят.
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1).replace('.', ',')}%`
}

/** Пояснение к проценту — одно на все места, где он показан. */
const investedHint = computed(() => {
  const where = selectedCashBox.value ? `в кассу «${selectedCashBox.value.name}»` : 'в дело'
  return `Какую часть вложенных ${where} денег составляет эта сумма. `
    + `Вложено — собственный капитал плюс капитал со-инвесторов: `
    + `${formatCurrency(investedBase.value)}. Считаем: сумма ÷ вложено × 100.`
})

/** Склонение при числе: plural(5, ['платёж', 'платежа', 'платежей']). */
function plural(n: number, forms: [string, string, string]): string {
  if (n % 10 === 1 && n % 100 !== 11) return forms[0]
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return forms[1]
  return forms[2]
}

/**
 * Ширина полосы — доля от самой крупной корзины этой же стороны.
 *
 * У непустой корзины полоса видна всегда: бывают платежи на нулевую сумму, и
 * без нижнего порога «2 платежа» выглядели бы как пустой возраст.
 */
function barWidth(b: TimelinessBucket, buckets: TimelinessBucket[]): string {
  if (!b.count) return '0%'
  const max = Math.max(1, ...buckets.map((x) => x.amount))
  return `${Math.max(2, Math.round((b.amount / max) * 100))}%`
}

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
const monthDealsRows = ref<MonthPaymentRow[]>([])
const monthDealsTotals = ref<MonthDealsResponse['totals'] | null>(null)
const monthDealsLoading = ref(false)
let monthDealsReq = 0

// Постраничный вывод: за месяц у крупного партнёра бывает больше тысячи
// сделок, и «показаны крупнейшие 500» просто прятало остальные.
const monthDealsPage = ref(1)
const monthDealsPerPage = usePageSize('analytics.monthDeals.perPage', 25)
/** Всего строк в текущем фильтре — по нему считается пагинация. */
const monthDealsCount = ref(0)
/** Счётчики вкладок с сервера: по всей выборке, а не по странице. */
const monthDealsFilterCounts = ref({ all: 0, paid: 0, pending: 0 })

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
      filter: dealFilter.value,
      limit: monthDealsPerPage.value,
      offset: (monthDealsPage.value - 1) * monthDealsPerPage.value,
    })
    if (req !== monthDealsReq) return
    monthDealsRows.value = res.items
    monthDealsTotals.value = res.totals
    monthDealsCount.value = res.count
    monthDealsFilterCounts.value = res.filterCounts
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

/**
 * Строки таблицы — платежи, как их прислал сервер.
 *
 * Ни фильтра, ни сортировки, ни агрегации здесь нет: и отбор, и порядок делает
 * база, иначе страница перетасовывала бы присланные 25 строк, а счётчик над
 * списком считал бы по-своему.
 */
const displayPayments = computed(() => monthDealsRows.value)

// Смена периода, фильтра или кассы возвращает на первую страницу: на третьей
// странице прошлого месяца в новом может не быть ни строки.
watch(
  () => [
    profitDetailDialog.value,
    profitDetailMonth.value,
    profitDetailYear.value,
    selectedCashBoxId.value,
    dealFilter.value,
  ],
  () => { monthDealsPage.value = 1 },
)

// Перезапрашиваем при смене периода, фильтра, кассы и страницы — но только
// когда диалог открыт: закрытый не должен дёргать сервер. Оба наблюдателя
// срабатывают в одном проходе, поэтому запрос уходит один, а не два.
watch(
  () => [
    profitDetailDialog.value,
    profitDetailMonth.value,
    profitDetailYear.value,
    selectedCashBoxId.value,
    dealFilter.value,
    monthDealsPage.value,
    monthDealsPerPage.value,
  ],
  () => { if (profitDetailDialog.value) loadMonthDeals() },
)

// Счётчики вкладок считает сервер по всей выборке: на странице из 25 строк
// собственный подсчёт показывал бы «25» во всех трёх вкладках.
const dealFilterCounts = computed(() => ({
  all: monthDealsFilterCounts.value.all,
  paid: monthDealsFilterCounts.value.paid,
  pending: monthDealsFilterCounts.value.pending,
}))

/** Какая доля платежа — прибыль. Остальное возвращает вложения в товар. */
function profitShareOf(p: { amount: number; gross: number }): number {
  return p.amount > 0 ? Math.max(0, p.gross) / p.amount : 0
}

/**
 * Сколько строк-заглушек рисовать, пока считается новый период.
 *
 * Помним длину прошлого списка: при смене месяца окно тогда не меняет высоту —
 * заглушки занимают ровно столько места, сколько только что занимала таблица.
 * Границы нужны, чтобы окно не схлопывалось на одной сделке и не растягивалось
 * на пятистах.
 */
const monthDealsSkeletonRows = ref(5)
watch(displayPayments, (rows) => {
  if (rows.length) monthDealsSkeletonRows.value = Math.min(6, Math.max(3, rows.length))
})

/**
 * Суммы шапки модалки берём из серверных итогов: они посчитаны по ВСЕЙ
 * выборке, тогда как строк приезжает не больше пятисот. Складывать показанные
 * строки было бы занижением у партнёра с большим портфелем. Если итогов нет
 * (старый ответ) — падаем на подсчёт по строкам, как раньше.
 */
// Разбор прибыли для подсказок-формул: вся наценка и доля со-инвесторов
// отдельно по оплаченным (факт) и неоплаченным (прогноз) платежам.
const profitDetailGrossPaid = computed(() => monthDealsTotals.value?.paidGross ?? 0)
const profitDetailCoInvPaid = computed(() => monthDealsTotals.value?.ciPaid ?? 0)
const profitDetailGrossPending = computed(() => monthDealsTotals.value?.pendingGross ?? 0)
const profitDetailCoInvPending = computed(() => monthDealsTotals.value?.ciPending ?? 0)

const profitDetailPaid = computed(() => monthDealsTotals.value?.paidReceived ?? 0)
const profitDetailPending = computed(() => monthDealsTotals.value?.pendingReceived ?? 0)
const profitDetailReceived = computed(() => profitDetailPaid.value + profitDetailPending.value)
// План месяца = пришло + осталось.
const profitDetailPlanned = computed(() => profitDetailReceived.value)

const profitDetailPartner = computed(
  () => profitDetailGrossPaid.value - profitDetailCoInvPaid.value,
)
const profitDetailProjectedPartner = computed(
  () => profitDetailGrossPending.value - profitDetailCoInvPending.value,
)

// Доля со-инвесторов со ВСЕХ платежей периода (оплаченные + прогноз по
// неоплаченным) и весь доход со всех платежей — для доли в процентах.
const profitDetailCoInvestorAll = computed(
  () => profitDetailCoInvPaid.value + profitDetailCoInvPending.value,
)
const profitDetailProfitAll = computed(
  () => profitDetailGrossPaid.value + profitDetailGrossPending.value,
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
const { rows: yearRows, loading: yearLoading } = useAnalyticsMonthly(
  () => ({ from: `${calYear.value}-01-01`, to: `${calYear.value}-12-31` }),
  () => selectedCashBoxId.value,
)

/**
 * Идёт пересчёт обзора.
 *
 * Смена кассы меняет все цифры сразу: пока новые считаются, старые остаются на
 * экране, и понять, обновилось уже или нет, невозможно — особенно если суммы
 * похожи. Заглушка снимает этот вопрос.
 */
const overviewBusy = computed(() => summaryLoading.value || yearLoading.value)

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

// ── Два взгляда на год: «Поступления» и «Продажи» ──
/**
 * «Поступления» — деньги по дате оплаты: сколько пришло, сколько ждём.
 * «Продажи» — договоры по дате сделки: сколько работы взяли и на какие суммы.
 *
 * Разные вопросы — «как собираем» и «растём ли мы» — и отвечать на них одной
 * таблицей нельзя: платежи по договору идут месяцами после продажи, и сильный
 * месяц продаж в поступлениях размазан на полгода вперёд.
 */
type YearView = 'inflow' | 'sales'
const YEAR_VIEW_KEY = 'analytics.yearView'
function readYearView(): YearView {
  try {
    return localStorage.getItem(YEAR_VIEW_KEY) === 'sales' ? 'sales' : 'inflow'
  } catch {
    return 'inflow'
  }
}
const yearView = ref<YearView>(readYearView())
watch(yearView, (v) => {
  try { localStorage.setItem(YEAR_VIEW_KEY, v) } catch { /* выбор не критичен */ }
})

const { rows: salesRows, loading: salesLoading } = useAnalyticsMonthlySales(
  () => ({ from: `${calYear.value}-01-01`, to: `${calYear.value}-12-31` }),
  () => selectedCashBoxId.value,
  () => yearView.value === 'sales',
)

/** Закупка и наценка — только тем, кому положено их видеть. */
const canSeeCost = computed(() => authStore.can('deals.cost'))

interface SalesMonth {
  month: number
  dealsCount: number
  clientsCount: number
  totalPrice: number
  downPayment: number
  financed: number
  purchasePrice: number
  markup: number
  /** Средний договор — сумма ÷ число сделок. */
  avgDeal: number
  /** Наценка к закупке, % — средняя по месяцу, взвешенная по суммам. */
  markupPct: number
  isCurrent: boolean
}

const salesMonths = computed((): SalesMonth[] => {
  const now = new Date()
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${calYear.value}-${String(i + 1).padStart(2, '0')}`
    const r = salesRows.value.find((x) => x.month === key)
    const deals = r?.dealsCount ?? 0
    const purchase = r?.purchasePrice ?? 0
    const markup = r?.markup ?? 0
    return {
      month: i,
      dealsCount: deals,
      clientsCount: r?.clientsCount ?? 0,
      totalPrice: r?.totalPrice ?? 0,
      downPayment: r?.downPayment ?? 0,
      financed: r?.financed ?? 0,
      purchasePrice: purchase,
      markup,
      avgDeal: deals > 0 ? Math.round((r?.totalPrice ?? 0) / deals) : 0,
      markupPct: purchase > 0 ? (markup / purchase) * 100 : 0,
      isCurrent: calYear.value === now.getFullYear() && i === now.getMonth(),
    }
  })
})

const salesTotal = computed(() => {
  const t = salesMonths.value.reduce(
    (s, m) => ({
      dealsCount: s.dealsCount + m.dealsCount,
      totalPrice: s.totalPrice + m.totalPrice,
      financed: s.financed + m.financed,
      purchasePrice: s.purchasePrice + m.purchasePrice,
      markup: s.markup + m.markup,
    }),
    { dealsCount: 0, totalPrice: 0, financed: 0, purchasePrice: 0, markup: 0 },
  )
  return { ...t, markupPct: t.purchasePrice > 0 ? (t.markup / t.purchasePrice) * 100 : 0 }
})

/** Шкала полосы — самый крупный месяц года: видно, какие месяцы сильнее. */
const salesMax = computed(() => Math.max(0, ...salesMonths.value.map((m) => m.totalPrice)))

const yearBusy = computed(() =>
  yearView.value === 'sales' ? salesLoading.value || summaryLoading.value : overviewBusy.value,
)

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
  metricSource.value = 'deals'
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

/** Догрузить следующую порцию — сделок или платежей, смотря что открыто. */
async function loadMoreBreakdown() {
  if (metricLoading.value) return
  metricLoading.value = true
  try {
    const q = timelinessQuery.value
    if (metricSource.value === 'timeliness' && q) {
      const res = await fetchTimelinessDetails({
        side: q.side,
        bucket: q.bucket,
        cashBoxId: selectedCashBoxId.value,
        limit: BREAKDOWN_PAGE,
        offset: metricItems.value.length,
      })
      metricItems.value = [
        ...metricItems.value,
        ...res.items.map((p) => timelinessDetailRow(q.side, p)),
      ]
      return
    }

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

// ── Расшифровка своевременности ──────────────────────────────────────────
// Та же модалка, что у показателей сводки: вопрос один — «откуда эта цифра».
// Отличается только источником строк, поэтому источник запоминаем: от него
// зависит и догрузка, и подпись «5 платежей» вместо «5 сделок».
const metricSource = ref<'deals' | 'timeliness'>('deals')
const timelinessQuery = ref<{ side: 'overdue' | 'early'; bucket: TimelinessBucketKey | null } | null>(null)
const metricUnit = computed<'deals' | 'payments'>(() =>
  metricSource.value === 'timeliness' ? 'payments' : 'deals',
)

/** Строка списка из платежа: сама сделка, клиент и чем этот платёж попал в выборку. */
function timelinessDetailRow(side: 'overdue' | 'early', p: TimelinessDetailRow) {
  const parts = [
    { label: 'платёж', value: `№${p.paymentNumber}` },
    { label: 'срок', value: formatDate(p.dueDate) },
    {
      label: side === 'overdue' ? 'просрочен на' : 'раньше срока на',
      value: `${p.days} ${pluralDays(p.days)}`,
    },
  ]
  if (side === 'early' && p.paidAt) parts.push({ label: 'оплачен', value: formatDate(p.paidAt) })
  return {
    id: p.dealId,
    title: p.productName || 'Сделка',
    subtitle: p.clientName || '—',
    value: p.amount,
    parts,
  }
}

/**
 * Открыть расшифровку: всю сторону (клик по карточке) или одну полосу возраста.
 * Пустую полосу не открываем — показывать там нечего.
 */
async function openTimeliness(side: string, bucket: string | null) {
  const s = side === 'early' ? 'early' : 'overdue'
  const b = (bucket as TimelinessBucketKey | null) ?? null
  const meta = timelinessSides.value.find((x) => x.key === s)
  if (!meta) return

  metricSource.value = 'timeliness'
  timelinessQuery.value = { side: s, bucket: b }
  metricTitle.value = b ? `${meta.title} · ${TIMELINESS_LABELS[b]}` : meta.title
  metricHint.value = s === 'overdue'
    ? 'Платежи, срок которых уже прошёл, а деньги не поступили. Нажмите на строку — откроется сделка.'
    : 'Платежи, внесённые раньше своего срока. Нажмите на строку — откроется сделка.'
  metricColor.value = meta.color
  metricItems.value = []
  metricTotal.value = 0
  metricCount.value = 0
  metricOpen.value = true
  metricLoading.value = true
  try {
    const res = await fetchTimelinessDetails({
      side: s,
      bucket: b,
      cashBoxId: selectedCashBoxId.value,
      limit: BREAKDOWN_PAGE,
    })
    metricItems.value = res.items.map((p) => timelinessDetailRow(s, p))
    metricCount.value = res.count
    // Итог считает сервер по всей выборке — в списке может быть лишь часть.
    metricTotal.value = res.total
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить расшифровку')
  } finally {
    metricLoading.value = false
  }
}

</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
      <!-- Вкладки раздела. «Отчёты» видны только с правом и тарифом. -->
      <div v-if="canSeeReports" class="page-tabs-row">
        <div class="page-tabs">
          <button
            class="page-tab"
            :class="{ active: activeTab === 'overview' }"
            type="button"
            @click="activeTab = 'overview'"
          >
            <v-icon icon="mdi-view-dashboard-outline" size="16" />
            Обзор
          </button>
          <button
            class="page-tab"
            :class="{ active: activeTab === 'reports' }"
            type="button"
            @click="activeTab = 'reports'"
          >
            <v-icon icon="mdi-file-chart-outline" size="16" />
            Отчёты
          </button>
        </div>

        <div
          v-if="activeTab === 'reports' && reportsTabRef?.canExport && reportsTabRef?.ready"
          class="page-tabs-actions"
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
      <!-- Пока считаются новые цифры, обзор гаснет и показывает вращающийся
           индикатор: смена кассы меняет здесь всё сразу, а старые суммы,
           стоящие на экране, выглядят как уже пересчитанные. -->
      <div
        class="an-sections-wrap"
        :class="{ 'an-sections-wrap--reorder': !hasCharts, 'an-sections-wrap--busy': overviewBusy }"
      >
        <div v-if="overviewBusy" class="an-busy-overlay">
          <v-progress-circular indeterminate size="30" width="3" color="primary" />
        </div>


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
            <!-- Два взгляда на год: деньги по дате оплаты и договоры по дате
                 сделки. Разные вопросы — «как собираем» и «растём ли мы». -->
            <div class="yc-tabs" role="tablist">
              <button
                class="yc-tab"
                :class="{ 'yc-tab--on': yearView === 'inflow' }"
                role="tab"
                @click="yearView = 'inflow'"
              >
                <v-icon icon="mdi-cash-multiple" size="15" />
                Оплаты
              </button>
              <button
                class="yc-tab"
                :class="{ 'yc-tab--on': yearView === 'sales' }"
                role="tab"
                @click="yearView = 'sales'"
              >
                <v-icon icon="mdi-file-sign" size="15" />
                Эффективность
              </button>
            </div>
          </div>

          <!-- Итоги года: продажи -->
          <div v-if="yearView === 'sales'" class="yc-header-stats">
            <div class="yc-stat">
              <div class="yc-stat-value">{{ salesTotal.dealsCount }}</div>
              <div class="yc-stat-label">Договоров оформлено</div>
            </div>
            <div class="yc-stat-divider" />
            <div class="yc-stat">
              <ExactValue class="yc-stat-value" :value="salesTotal.totalPrice">{{ formatCurrencyShort(salesTotal.totalPrice) }}</ExactValue>
              <div class="yc-stat-label">Сумма договоров</div>
              <div class="yc-stat-sub">
                в рассрочку <ExactValue :value="salesTotal.financed" :hint="false">{{ formatCurrencyShort(salesTotal.financed) }}</ExactValue>
              </div>
            </div>
            <template v-if="canSeeCost">
              <div class="yc-stat-divider" />
              <div class="yc-stat">
                <ExactValue class="yc-stat-value" style="color: #3b82f6;" :value="salesTotal.purchasePrice">{{ formatCurrencyShort(salesTotal.purchasePrice) }}</ExactValue>
                <div class="yc-stat-label">Закупка</div>
              </div>
              <div class="yc-stat-divider" />
              <div class="yc-stat">
                <ExactValue class="yc-stat-value" style="color: #34d399;" :value="salesTotal.markup">{{ formatCurrencyShort(salesTotal.markup) }}</ExactValue>
                <div class="yc-stat-label">Наценка</div>
                <div v-if="salesTotal.purchasePrice > 0" class="yc-stat-sub">
                  {{ formatPercent(salesTotal.markupPct) }} к закупке
                </div>
              </div>
            </template>
          </div>

          <!-- Итоги года: поступления -->
          <div v-else class="yc-header-stats">
            <div class="yc-stat">
              <ExactValue class="yc-stat-value" style="color: #34d399;" :value="Math.max(0, yearTotal.partnerEarned)">{{ formatCurrencyShort(Math.max(0, yearTotal.partnerEarned)) }}</ExactValue>
              <div class="yc-stat-label">Мой чистый доход</div>
              <div v-if="yearTotal.coInvestorEarned > 0" class="yc-stat-sub">
                весь доход <ExactValue :value="yearTotal.earned" :hint="false">{{ formatCurrencyShort(yearTotal.earned) }}</ExactValue> · инвесторам <ExactValue :value="yearTotal.coInvestorEarned" :hint="false">{{ formatCurrencyShort(yearTotal.coInvestorEarned) }}</ExactValue>
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

        <!-- ── Продажи: договоры по дате сделки ── -->
        <template v-if="yearView === 'sales'">
          <div class="yc-caption yc-caption--sales" :class="{ 'yc-caption--nocost': !canSeeCost }">
            <span class="yc-cap-month">Месяц</span>
            <span class="yc-cap-num yc-cap-num--mid">Договоров</span>
            <span class="yc-cap-num yc-cap-num--mid">Клиентов</span>
            <span class="yc-cap-num">Сумма договоров</span>
            <span class="yc-cap-num">Первые взносы</span>
            <span class="yc-cap-num">В рассрочку</span>
            <span v-if="canSeeCost" class="yc-cap-num">Закупка</span>
            <span v-if="canSeeCost" class="yc-cap-num">Наценка</span>
            <span class="yc-cap-num">Средний договор</span>
            <span class="yc-cap-chev" />
          </div>

          <div class="yc-list">
            <div v-for="sk in (yearBusy ? 12 : 0)" :key="`ys-sk-${sk}`" class="yc-row yc-row--sales yc-row--sk" :class="{ 'yc-row--nocost': !canSeeCost }">
              <div class="yc-row-month"><div class="an-sk an-sk--sm" /></div>
              <div v-for="n in (canSeeCost ? 7 : 5)" :key="n" class="yc-row-num"><div class="an-sk an-sk--sm" /></div>
            </div>

            <div
              v-for="m in (yearBusy ? [] : salesMonths)"
              :key="`ys-${m.month}`"
              class="yc-row yc-row--sales yc-row--static"
              :class="{
                'yc-row--current': m.isCurrent,
                'yc-row--empty': m.dealsCount === 0,
                'yc-row--nocost': !canSeeCost,
              }"
            >
              <div class="yc-row-month">
                <div class="yc-month-head">
                  <span class="yc-row-mname" :class="{ 'yc-row-mname--current': m.isCurrent }">{{ MONTH_NAMES[m.month] }}</span>
                  <span v-if="m.isCurrent" class="yc-month-now">сейчас</span>
                </div>

                <!-- Компактная строка — только на телефоне, где колонок нет -->
                <div v-if="m.dealsCount > 0" class="yc-row-mmoney">
                  <span><b>{{ m.dealsCount }}</b> договоров</span>
                  <span><b>{{ formatCurrencyShort(m.totalPrice) }}</b> сумма</span>
                  <span v-if="canSeeCost" class="yc-mm--net"><b>+{{ formatCurrencyShort(m.markup) }}</b> наценка</span>
                  <span v-else><b>{{ formatCurrencyShort(m.financed) }}</b> в рассрочку</span>
                </div>
              </div>

              <div class="yc-row-num yc-row-num--mid">
                <span v-if="m.dealsCount > 0" class="yc-num-count">{{ m.dealsCount }}</span>
                <span v-else class="yc-num-empty">—</span>
              </div>
              <div class="yc-row-num yc-row-num--mid">
                <span v-if="m.clientsCount > 0" class="yc-num-count">{{ m.clientsCount }}</span>
                <span v-else class="yc-num-empty">—</span>
              </div>
              <div class="yc-row-num">
                <ExactValue v-if="m.totalPrice > 0" class="yc-num-val" :value="m.totalPrice">{{ formatCurrencyShort(m.totalPrice) }}</ExactValue>
                <span v-else class="yc-num-empty">—</span>
              </div>
              <div class="yc-row-num">
                <ExactValue v-if="m.downPayment > 0" class="yc-num-val" :value="m.downPayment">{{ formatCurrencyShort(m.downPayment) }}</ExactValue>
                <span v-else class="yc-num-empty">—</span>
              </div>
              <div class="yc-row-num">
                <ExactValue v-if="m.financed > 0" class="yc-num-val" :value="m.financed">{{ formatCurrencyShort(m.financed) }}</ExactValue>
                <span v-else class="yc-num-empty">—</span>
              </div>
              <template v-if="canSeeCost">
                <div class="yc-row-num">
                  <ExactValue v-if="m.purchasePrice > 0" class="yc-num-val yc-num-val--pending" :value="m.purchasePrice">{{ formatCurrencyShort(m.purchasePrice) }}</ExactValue>
                  <span v-else class="yc-num-empty">—</span>
                </div>
                <div class="yc-row-num">
                  <ExactValue v-if="m.markup !== 0" class="yc-num-val yc-num-val--net" :value="m.markup">+{{ formatCurrencyShort(m.markup) }}</ExactValue>
                  <span v-else class="yc-num-empty">—</span>
                </div>
              </template>
              <div class="yc-row-num">
                <ExactValue v-if="m.avgDeal > 0" class="yc-num-val" :value="m.avgDeal">{{ formatCurrencyShort(m.avgDeal) }}</ExactValue>
                <span v-else class="yc-num-empty">—</span>
              </div>
              <span class="yc-row-chev" />
            </div>
          </div>

          <div class="yc-footer">
            <div class="yc-legend-hint">
              <v-icon icon="mdi-information-outline" size="14" />
              Месяц — по дате оформления договора. Наведите на сумму — покажем точное значение.
            </div>
          </div>
        </template>

        <template v-else>
        <!-- Column captions (desktop) -->
        <div class="yc-caption yc-caption--pay">
          <span class="yc-cap-month">Месяц</span>
          <span class="yc-cap-num yc-cap-num--mid">Платежей</span>
          <span class="yc-cap-num yc-cap-num--mid">Досрочно</span>
          <span class="yc-cap-num yc-cap-num--mid">С опозданием</span>
          <span class="yc-cap-num">Ожидается</span>
          <span class="yc-cap-num">Пришло</span>
          <span class="yc-cap-num">Осталось</span>
          <span class="yc-cap-num">Весь доход</span>
          <span class="yc-cap-num">Мой чистый доход</span>
          <span class="yc-cap-num">Инвесторам</span>
          <span class="yc-cap-chev" />
        </div>

        <!-- Month list — one row per month -->
        <div class="yc-list">
          <!-- Пока считаются новые цифры, показываем заглушки той же формы:
               иначе при смене кассы месяцы пару секунд стоят со старыми
               суммами. -->
          <div v-for="sk in (overviewBusy ? 12 : 0)" :key="`yc-sk-${sk}`" class="yc-row yc-row--pay yc-row--sk">
            <div class="yc-row-month"><div class="an-sk an-sk--sm" /></div>
            <div v-for="n in 9" :key="n" class="yc-row-num"><div class="an-sk an-sk--sm" /></div>
          </div>

          <div
            v-for="m in (overviewBusy ? [] : yearMonths)"
            :key="m.month"
            class="yc-row yc-row--pay"
            :class="{
              'yc-row--current': m.isCurrent,
              'yc-row--empty': m.planned === 0,
            }"
            @click="openMonthDetail(m)"
          >
            <!-- Месяц — якорь строки: мягкая подложка со скруглением справа
                 показывает, что все цифры правее относятся именно к нему.
                 Полоса сбора живёт здесь же, под названием: своей колонки она
                 не стоила — это подпись к месяцу, а не отдельный показатель. -->
            <div class="yc-row-month">
              <div class="yc-month-head">
                <span class="yc-row-mname" :class="{ 'yc-row-mname--current': m.isCurrent }">{{ MONTH_NAMES[m.month] }}</span>
                <span v-if="m.isCurrent" class="yc-month-now">сейчас</span>
              </div>
              <div v-if="m.planned > 0" class="yc-progress">
                <div
                  v-if="m.received > 0"
                  class="yc-progress-fill yc-progress-fill--earned"
                  :style="{ width: (m.received / m.planned * 100) + '%' }"
                />
                <div
                  v-if="m.pendingAmount > 0"
                  class="yc-progress-fill yc-progress-fill--pending"
                  :style="{ width: (m.pendingAmount / m.planned * 100) + '%' }"
                />
              </div>
            </div>

            <!-- Компактная строка сумм — только на телефоне, где колонок нет -->
            <div v-if="m.planned > 0" class="yc-row-mmoney">
              <span><b>{{ formatCurrencyShort(m.planned) }}</b> ожидается</span>
              <span class="yc-mm--green"><b>{{ formatCurrencyShort(m.received) }}</b> пришло</span>
              <span v-if="m.pendingAmount > 0" class="yc-mm--pending"><b>{{ formatCurrencyShort(m.pendingAmount) }}</b> осталось</span>
              <span v-if="m.partnerEarned > 0" class="yc-mm--net"><b>+{{ formatCurrencyShort(Math.max(0, m.partnerEarned)) }}</b> чисто</span>
              <span v-if="m.payments > 0">{{ m.payments }}&nbsp;плат.</span>
              <span v-if="m.earlyOffMonth > 0">{{ m.earlyOffMonth }}&nbsp;досрочно</span>
              <span v-if="m.lateOffMonth > 0">{{ m.lateOffMonth }}&nbsp;с&nbsp;опозданием</span>
            </div>

            <!-- Платежи месяца: сколько всего, из них досрочно и с опозданием.
                 Досрочные и опоздавшие оплачены не в свой месяц — их доход
                 учтён там, где деньги реально пришли. -->
            <div class="yc-row-num yc-row-num--mid">
              <span v-if="m.payments > 0" class="yc-num-count">{{ m.payments }}</span>
              <span v-else class="yc-num-empty">—</span>
            </div>
            <div class="yc-row-num yc-row-num--mid">
              <span
                v-if="m.earlyOffMonth > 0"
                class="yc-num-count yc-num-count--early"
                title="Оплачены раньше своего срока — доход учтён в месяце фактической оплаты"
              >{{ m.earlyOffMonth }}</span>
              <span v-else class="yc-num-empty">—</span>
            </div>
            <div class="yc-row-num yc-row-num--mid">
              <span
                v-if="m.lateOffMonth > 0"
                class="yc-num-count yc-num-count--late"
                title="Оплачены позже срока — доход учтён в месяце фактической оплаты"
              >{{ m.lateOffMonth }}</span>
              <span v-else class="yc-num-empty">—</span>
            </div>

            <!-- Деньги месяца: план, факт, остаток и доход -->
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
              <ExactValue v-if="m.earned !== 0" class="yc-num-val" :value="m.earned">{{ formatCurrencyShort(m.earned) }}</ExactValue>
              <span v-else class="yc-num-empty">—</span>
            </div>
            <div class="yc-row-num">
              <ExactValue v-if="m.partnerEarned !== 0" class="yc-num-val yc-num-val--net" :value="Math.max(0, m.partnerEarned)">+{{ formatCurrencyShort(Math.max(0, m.partnerEarned)) }}</ExactValue>
              <span v-else class="yc-num-empty">—</span>
            </div>
            <div class="yc-row-num">
              <ExactValue v-if="m.coInvestorEarned > 0" class="yc-num-val yc-num-val--ci" :value="m.coInvestorEarned">{{ formatCurrencyShort(m.coInvestorEarned) }}</ExactValue>
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
        </template>
      </v-card>

      <!-- Своевременность: просрочка и оплаты, сделанные заранее. Две стороны
           одного вопроса, поэтому рядом и в одинаковой шкале возраста.
           Стоит сразу под годовым обзором: тот показывает, сколько денег
           пришло по месяцам, а этот — насколько вовремя они приходят. -->
      <div class="an-timeliness-section">
        <div class="an-section-title">Своевременность платежей</div>
        <v-row class="mb-6">
          <v-col v-for="side in timelinessSides" :key="side.key" cols="12" lg="6">
            <v-card rounded="lg" elevation="0" border class="pa-5 h-100">
              <div class="chart-title mb-1">{{ side.title }}</div>
              <div class="chart-subtitle mb-4">{{ side.subtitle }}</div>

              <!-- Любая плитка открывает всю сторону целиком: за всеми
                   четырьмя числами стоит одна и та же выборка платежей. -->
              <div class="tl-stats">
                <div
                  class="tl-stat"
                  :class="{ 'tl-stat--click': side.data.count > 0 }"
                  @click="side.data.count && openTimeliness(side.key, null)"
                >
                  <div class="tl-stat-value" :style="{ color: side.color }">{{ side.data.count }}</div>
                  <div class="tl-stat-label">{{ side.countLabel }}</div>
                </div>
                <div
                  class="tl-stat"
                  :class="{ 'tl-stat--click': side.data.count > 0 }"
                  @click="side.data.count && openTimeliness(side.key, null)"
                >
                  <ExactValue :value="side.data.amount" :hint="false">
                    <div class="tl-stat-value" :style="{ color: side.color }">
                      {{ formatCurrencyShort(side.data.amount) }}<span
                        v-if="pctOfInvested(side.data.amount)"
                        class="tl-stat-pct"
                      >&nbsp;/&nbsp;{{ pctOfInvested(side.data.amount) }}</span>
                    </div>
                  </ExactValue>
                  <div class="tl-stat-label">
                    Сумма<template v-if="pctOfInvested(side.data.amount)"> и доля вложенного</template>
                    <v-tooltip v-if="pctOfInvested(side.data.amount)" :text="investedHint" location="top" max-width="320">
                      <template #activator="{ props }">
                        <!-- Клик по бейджу не должен открывать детализацию стороны. -->
                        <v-icon
                          v-bind="props"
                          icon="mdi-information-outline"
                          size="12"
                          class="tl-info"
                          @click.stop
                        />
                      </template>
                    </v-tooltip>
                  </div>
                </div>
                <div
                  class="tl-stat"
                  :class="{ 'tl-stat--click': side.data.count > 0 }"
                  @click="side.data.count && openTimeliness(side.key, null)"
                >
                  <div class="tl-stat-value">{{ side.data.deals }}</div>
                  <div class="tl-stat-label">Сделок</div>
                </div>
                <div
                  class="tl-stat"
                  :class="{ 'tl-stat--click': side.data.count > 0 }"
                  @click="side.data.count && openTimeliness(side.key, null)"
                >
                  <div class="tl-stat-value">{{ side.data.clients }}</div>
                  <div class="tl-stat-label">Клиентов</div>
                </div>
              </div>

              <div class="tl-age-head">
                <span class="tl-age-title">
                  {{ side.ageTitle }}
                  <v-tooltip v-if="investedBase > 0" :text="investedHint" location="top" max-width="320">
                    <template #activator="{ props }">
                      <v-icon v-bind="props" icon="mdi-information-outline" size="12" class="tl-info" />
                    </template>
                  </v-tooltip>
                </span>
                <span v-if="side.data.count" class="tl-age-avg">
                  в среднем {{ side.data.avgDays }} дн. · максимум {{ side.data.maxDays }}
                </span>
              </div>

              <div v-if="side.data.count" class="tl-ages">
                <!-- Клик по полосе показывает платежи именно этого возраста —
                     цифра рядом перестаёт быть числом «из ниоткуда». -->
                <div
                  v-for="b in side.data.buckets"
                  :key="b.key"
                  class="tl-age"
                  :class="{ 'tl-age--click': b.count > 0 }"
                  :title="b.count ? 'Показать платежи этого возраста' : ''"
                  @click="b.count && openTimeliness(side.key, b.key)"
                >
                  <div class="tl-age-lbl">{{ TIMELINESS_LABELS[b.key] }}</div>
                  <div class="tl-age-bar-wrap">
                    <div
                      class="tl-age-bar"
                      :style="{ width: barWidth(b, side.data.buckets), background: side.color }"
                    />
                  </div>
                  <div class="tl-age-val">
                    {{ formatCurrencyShort(b.amount) }}
                    <span v-if="pctOfInvested(b.amount)" class="tl-age-pct">· {{ pctOfInvested(b.amount) }}</span>
                    <span class="tl-age-count">· {{ b.count }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="tl-empty">{{ side.emptyText }}</div>
            </v-card>
          </v-col>
        </v-row>
      </div>

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
          <!-- Пока считается период, показываем заглушки той же формы: число
               реальных карточек зависит от данных (от одной до четырёх), и без
               заглушек блок скакал по высоте при каждой смене месяца. -->
          <div class="pd-stats mb-4">
            <template v-if="monthDealsLoading">
              <div v-for="i in 3" :key="`pd-sk-stat-${i}`" class="pd-stat pd-stat--sk">
                <div class="an-sk an-sk--sm" />
                <div class="an-sk pd-sk-value" />
                <div class="an-sk pd-sk-hint" />
                <div class="an-sk an-sk--sm pd-sk-hint" />
              </div>
            </template>
            <template v-else>
            <div v-if="profitDetailMode === 'all'" class="pd-stat">
              <div class="pd-stat-label">Ожидается за месяц</div>
              <div class="pd-stat-value">{{ formatCurrency(profitDetailPlanned) }}</div>
              <!-- Платежи и сделки вместе: у месяца в годовом обзоре стоит
                   число ПЛАТЕЖЕЙ, а список здесь — по сделкам, и без обеих
                   цифр окно выглядело так, будто часть месяца потерялась. -->
              <div class="pd-stat-hint">
                весь план: пришло + осталось ·
                {{ monthDealsTotals?.paymentsCount ?? 0 }}
                {{ plural(monthDealsTotals?.paymentsCount ?? 0, ['платёж', 'платежа', 'платежей']) }}
                по {{ monthDealsTotals?.dealsCount ?? 0 }}
                {{ plural(monthDealsTotals?.dealsCount ?? 0, ['сделке', 'сделкам', 'сделкам']) }}
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
              <div class="pd-stat-label">Инвесторам</div>
              <div class="pd-stat-value" style="color: #8b5cf6;">{{ formatCurrency(profitDetailCoInvestorAll) }}</div>
              <div class="pd-stat-hint">доля инвесторов со всех платежей<template v-if="profitDetailProfitAll > 0"> · ≈ {{ Math.round(profitDetailCoInvestorAll / profitDetailProfitAll * 100) }}% дохода</template></div>
            </div>
            </template>
          </div>

          <!-- Filter tabs -->
          <div v-if="monthDealsLoading" class="pd-filter">
            <div v-for="i in 3" :key="`pd-sk-filter-${i}`" class="an-sk pd-sk-filter" />
          </div>
          <div v-else-if="dealFilterCounts.all > 0" class="pd-filter">
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
          <!-- Заглушка таблицы: шапка настоящая, строки — пустые той же сетки.
               Раньше на месте загрузки висел прошлый месяц, а потом список
               резко подменялся; при первом открытии вместо этого успевало
               мелькнуть «нет платежей за период». -->
          <div v-if="monthDealsLoading" class="pdt">
            <div class="pdt-head">
              <span class="pdt-h-deal">Сделка</span>
              <span class="pdt-h-num">Платёж за месяц</span>
              <span class="pdt-h-num">Ваша прибыль</span>
              <span class="pdt-h-chev" />
            </div>
            <div
              v-for="i in monthDealsSkeletonRows"
              :key="`pd-sk-row-${i}`"
              class="pdt-row pdt-row--sk"
            >
              <div class="pdt-deal">
                <div class="an-sk pd-sk-name" />
                <div class="an-sk an-sk--sm pd-sk-meta" />
              </div>
              <div class="pdt-num">
                <div class="an-sk pd-sk-num" />
                <div class="an-sk pd-sk-sub" />
              </div>
              <div class="pdt-num">
                <div class="an-sk pd-sk-num" />
                <div class="an-sk pd-sk-sub" />
                <div class="an-sk pd-sk-sub" />
                <div class="an-sk pd-sk-sub" />
              </div>
              <span />
            </div>
          </div>

          <div v-else-if="displayPayments.length" class="pdt">
            <!-- Header -->
            <div class="pdt-head">
              <span class="pdt-h-deal">Платёж</span>
              <span class="pdt-h-num" title="Сумма этого платежа: оплаченного или ожидаемого по графику">Сумма</span>
              <span class="pdt-h-num" title="Ваш чистый заработок с этого платежа — доля наценки за вычетом доли инвесторов">Ваша прибыль</span>
              <span class="pdt-h-chev" />
            </div>

            <!-- Rows: один платёж — одна строка. Из них и складывается месяц. -->
            <div
              v-for="p in displayPayments"
              :key="p.paymentId ?? `down-${p.dealId}`"
              class="pdt-row"
              @click="profitDetailDialog = false; router.push(`/deals/${p.dealId}`)"
            >
              <!-- Что за платёж и по какой сделке -->
              <div class="pdt-deal">
                <div class="pdt-deal-name">{{ p.productName }}</div>
                <div class="pdt-deal-meta">{{ p.clientName }}</div>
                <div class="pdt-badges">
                  <span
                    class="pdt-badge"
                    :class="p.status === 'PAID' ? 'pdt-badge--paid' : p.status === 'OVERDUE' ? 'pdt-badge--overdue' : 'pdt-badge--pending'"
                  >
                    <v-icon
                      :icon="p.status === 'PAID' ? 'mdi-check-circle-outline' : p.status === 'OVERDUE' ? 'mdi-alert-circle-outline' : 'mdi-clock-outline'"
                      size="11"
                    />
                    {{ p.status === 'PAID' ? 'оплачен' : p.status === 'OVERDUE' ? 'просрочен' : 'ожидается' }}
                    {{ formatDate(p.date) }}
                  </span>
                  <span v-if="p.isDown" class="pdt-badge pdt-badge--down" title="Первоначальный взнос — деньги получены в день сделки">
                    первоначальный взнос
                  </span>
                  <span v-else class="pdt-badge pdt-badge--muted">платёж №{{ p.paymentNumber }}</span>
                </div>
              </div>

              <!-- Сумма платежа -->
              <div class="pdt-num">
                <span class="pdt-num-label">Сумма</span>
                <div class="pdt-num-val" :class="p.status === 'PAID' ? 'pdt-num-val--in' : 'pdt-num-val--left'">
                  {{ formatCurrency(p.amount) }}
                </div>
                <div class="pdt-num-sub">{{ p.status === 'PAID' ? 'деньги получены' : 'ещё не оплачен' }}</div>
              </div>

              <!-- Ваша прибыль с этого платежа -->
              <div class="pdt-num">
                <span class="pdt-num-label">Ваша прибыль</span>
                <div class="pdt-num-val" :class="p.status === 'PAID' ? 'pdt-num-val--profit' : 'pdt-num-val--proj'">
                  {{ p.status === 'PAID' ? '+' : '~' }}{{ formatCurrency(Math.max(0, p.net)) }}
                  <ProfitFormula
                    :amount="p.amount"
                    :gross="p.gross"
                    :co-investor="p.ci"
                    :net="p.net"
                    :share="profitShareOf(p)"
                    :projected="p.status !== 'PAID'"
                  />
                </div>
                <div class="pdt-num-sub" title="Какая доля платежа — прибыль. Остальное — возврат вложенных денег за товар">
                  прибыль {{ Math.round(profitShareOf(p) * 100) }}% от платежа
                </div>
                <div v-if="p.ci > 0" class="pdt-num-sub">инвесторам {{ formatCurrency(p.ci) }}</div>
                <div v-if="p.status !== 'PAID'" class="pdt-num-sub pdt-num-sub--proj">будет после оплаты</div>
              </div>

              <v-icon icon="mdi-chevron-right" size="16" class="pdt-chev" />
            </div>
          </div>

          <div v-else class="text-center pa-8 text-medium-emphasis text-body-2">
            {{ dealFilter === 'paid' ? 'Нет оплаченных платежей за период' : dealFilter === 'pending' ? 'Нет неоплаченных платежей за период' : 'Нет платежей за выбранный период' }}
          </div>

        </div>

        <!-- Пагинация — подвал окна, вне прокрутки. Внутри тела она прилипала
             поверх списка, и под ней оставались недочитанные строки. -->
        <div v-if="monthDealsCount > 0" class="pd-foot">
          <ServerPager
            :page="monthDealsPage"
            :total="monthDealsCount"
            :per-page="monthDealsPerPage"
            :busy="monthDealsLoading"
            :per-page-options="PER_PAGE_OPTIONS"
            @update:page="monthDealsPage = $event"
            @update:per-page="monthDealsPerPage = $event"
          />
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
      :unit="metricUnit"
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
  background: rgb(var(--v-theme-surface));
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
/* Обзор во время пересчёта: содержимое гаснет, поверх — индикатор. Тот же
   приём, что в списках сделок и платежей. */
.an-sections-wrap { position: relative; }
.an-sections-wrap--busy > :not(.an-busy-overlay) {
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.15s;
}
.an-busy-overlay {
  position: absolute; inset: 0; z-index: 3;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 80px;
}

/* Заглушки обзора: та же высота и сетка, чтобы блок не «прыгал» при переходе
   от заглушки к цифрам. */
.an-sk {
  height: 12px; border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  animation: an-sk-pulse 1.2s ease-in-out infinite;
}
.an-sk--sm { width: 60%; }
.yc-row--sk { cursor: default; }
.yc-row--sk:hover { background: transparent; }
@keyframes an-sk-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

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

/* Вкладки обзора: «Поступления» и «Продажи» — сегмент под годом. */
.yc-tabs {
  display: inline-flex; gap: 2px; margin-top: 12px; padding: 3px;
  border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.05);
  align-self: flex-start;
}
.yc-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border: none; border-radius: 8px; cursor: pointer;
  font-size: 13px; font-weight: 600; background: none;
  color: rgba(var(--v-theme-on-surface), 0.55);
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.yc-tab:hover { color: rgba(var(--v-theme-on-surface), 0.85); }
.yc-tab--on {
  background: rgb(var(--v-theme-surface)); color: #047857;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.yc-header-stats {
  display: flex; align-items: stretch; gap: 20px;
}
/* Показатели с подписями разной длины раньше «гуляли» по вертикали, потому
   что выравнивались по центру. Теперь все начинаются с одной линии сверху. */
.yc-stat {
  text-align: center;
  display: flex; flex-direction: column; align-items: center;
}
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
/* «Оплаты»: у каждого показателя своя колонка, поэтому полоса — узкая, а
   сетка своя. Раньше полоса занимала половину ширины, а числа платежей,
   досрочных и опоздавших ютились подписями под ней. */
.yc-caption--pay,
.yc-row--pay {
  grid-template-columns:
    166px 82px 84px 108px
    minmax(74px, 1fr) minmax(74px, 1fr) minmax(74px, 1fr)
    minmax(74px, 1fr) minmax(84px, 1fr) minmax(74px, 1fr) 18px;
  gap: 10px;
}
/* «Эффективность»: без полосы — только счётчики и суммы. Два последних
   столбца (закупка и наценка) появляются лишь у тех, кому они открыты. */
.yc-caption--sales,
.yc-row--sales {
  grid-template-columns:
    166px 90px 90px
    minmax(84px, 1fr) minmax(84px, 1fr) minmax(84px, 1fr)
    minmax(84px, 1fr) minmax(84px, 1fr) minmax(88px, 1fr) 18px;
  gap: 10px;
}
.yc-caption--sales.yc-caption--nocost,
.yc-row--sales.yc-row--nocost {
  grid-template-columns:
    166px 90px 90px
    minmax(96px, 1fr) minmax(96px, 1fr) minmax(96px, 1fr) minmax(96px, 1fr) 18px;
}
/* Узкие заголовки не должны ломаться по слогам: «ПЛАТЕЖЕ/Й» читается как
   опечатка. Лучше чуть мельче шрифт, чем перенос. */
.yc-caption--pay span { white-space: nowrap; font-size: 10.5px; }
/* Счётчики: платежи, досрочные, опоздавшие */
.yc-num-count {
  font-size: 13.5px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.yc-num-count--early { color: #0369a1; }
.yc-num-count--late { color: #b45309; }
.yc-num-val--ci { color: rgba(var(--v-theme-on-surface), 0.55); }
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
/* Отчётливый разделитель между месяцами.
   Начинается от колонки с цифрами: подложку месяца он пересекать не должен —
   иначе линия рассекает «таблетку» пополам. 202px = отступ строки (26) +
   колонка месяца (166) + зазор сетки (10). */
.yc-row + .yc-row::after {
  content: '';
  position: absolute;
  top: 0; left: 202px; right: 26px;
  height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.yc-row:hover { background: rgba(var(--v-theme-on-surface), 0.035); }
/* Строка продаж ничего не открывает — не делаем вид, что по ней можно нажать. */
.yc-row--static { cursor: default; }
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

/* Месяц — якорь строки.
   Мягкая подложка с острыми левыми и скруглёнными правыми углами: строка
   «начинается» от края таблицы и читается как «всё правее — про этот месяц».
   Отрицательный отступ вытягивает подложку под паддинг строки, чтобы она
   доходила до самого края карточки. */
.yc-row-month {
  display: flex; flex-direction: column; gap: 6px;
  /* Подложка занимает почти всю высоту строки, между месяцами остаётся
     небольшой зазор: без него они сливаются в сплошной серый столбец. */
  margin: -11px 0 -11px -26px;
  padding: 11px 16px 11px 26px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 0 12px 12px 0;
}
.yc-row--current .yc-row-month { background: rgba(16, 185, 129, 0.1); }
.yc-row--empty .yc-row-month { background: rgba(var(--v-theme-on-surface), 0.02); }
.yc-month-head { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; }

/* Полоса сбора — как на странице сделки: тонкая, со скруглёнными краями и
   спокойным фоном. Это подпись к месяцу, а не самостоятельный показатель. */
.yc-progress {
  height: 6px; border-radius: 3px; overflow: hidden;
  display: flex;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.yc-progress-fill {
  height: 100%;
  transition: width 0.4s cubic-bezier(0.23, 1, 0.32, 1);
  min-width: 0; flex-shrink: 0;
}
.yc-progress-fill:first-child { border-radius: 3px 0 0 3px; }
.yc-progress-fill:last-child { border-radius: 0 3px 3px 0; }
.yc-progress-fill--earned { background: #10b981; }
.yc-progress-fill--pending { background: #3b82f6; }
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
/* Продажи: закупка светлее наценки — видно, какая часть договора заработок. */
.yc-bar--cost { background: #93c5fd; }
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
/* Счётчики (платежи, досрочные, опоздавшие, договоры, клиенты) — по центру:
   это короткие числа, и у правого края они висели далеко от заголовка. */
.yc-row-num--mid { text-align: center; }
.yc-cap-num--mid { text-align: center; }
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
/* Табы раздела — общий стиль, см. styles/page-tabs.css */
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
.an-tab-export--excel {
  border-color: rgba(16, 124, 65, 0.3);
  color: #107c41;
}
.an-tab-export--excel:hover:not(:disabled) { background: rgba(16, 124, 65, 0.07); }

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
/* Прокручивается только тело: шапка сверху и пагинация снизу остаются на
   месте. min-height: 0 обязателен — без него flex-элемент не даёт себя сжать,
   и прокрутка уезжает на всё окно вместе с подвалом. */
.pd-body { padding: 20px 24px 24px; overflow-y: auto; flex: 1 1 auto; min-height: 0; }

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

/* Без скругления: строки идут сплошным списком, разделённые только чертой —
   скруглённая подсветка разрывала его на отдельные карточки. */
.pdt-row {
  padding: 14px 12px;
  cursor: pointer;
  transition: background 0.15s;
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
/* Состояние платежа прямо в строке: деньги получены, ждём или просрочено. */
.pdt-badge--paid { color: #059669; background: rgba(16, 185, 129, 0.1); }
.pdt-badge--pending { color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
.pdt-badge--overdue { color: #ef4444; background: rgba(239, 68, 68, 0.1); }
.pdt-badge--down { color: #8b5cf6; background: rgba(139, 92, 246, 0.1); }
.pdt-badge--muted {
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgba(var(--v-theme-on-surface), 0.05);
}

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

/* В окне месяца лента-подгрузка не нужна: список короткий и листается
   страницами, а переключатель режима только сбивал бы с толку. */
.pd-foot :deep(.sp-auto) { display: none; }
/* Панель уже стоит в подвале — прилипать ей некуда и не от чего отделяться
   тенью: границу даёт сам подвал. */
.pd-foot { flex-shrink: 0; }
.pd-foot :deep(.sp-pager) {
  position: static;
  margin: 0;
  padding: 12px 24px;
  box-shadow: none;
  border-radius: 0;
}

/* Заглушки диалога месяца: повторяют геометрию реальных строк, чтобы окно не
   меняло высоту, когда приезжают цифры. Высоты выверены по замеру живой
   разметки: карточка показателя 124px, строка сделки ~112px. */
.pd-stat--sk { pointer-events: none; min-height: 124px; }
.pd-sk-value { height: 20px; width: 78%; margin-top: 6px; }
.pd-sk-hint { height: 10px; margin-top: 8px; }
.pd-sk-filter { width: 104px; height: 36px; border-radius: 9px; }
/* Строка чуть ниже самой длинной реальной: у той бывает от двух до четырёх
   подписей, и попадать точно всё равно не во что. */
.pdt-row--sk { cursor: default; min-height: 104px; }
.pdt-row--sk:hover { background: transparent; }
.pd-sk-name { height: 14px; width: 74%; }
.pd-sk-meta { margin-top: 6px; }
/* Числовые колонки выровнены по правому краю — заглушки тоже. */
.pd-sk-num { height: 14px; width: 68%; margin-left: auto; }
.pd-sk-sub { height: 10px; width: 50%; margin-top: 6px; margin-left: auto; }

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
  .yc-row-month {
    margin: -8px -16px 0;
    padding: 8px 16px;
    border-radius: 0;
    background: transparent;
  }
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

/* Своевременность: две симметричные карточки — просрочка и оплаты заранее.
   Шкала возраста у обеих одна, поэтому и вёрстка полос общая. */
.tl-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
  margin-bottom: 18px;
}
.tl-stat {
  text-align: center; padding: 12px 8px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.tl-stat-value {
  font-size: 20px; font-weight: 800; line-height: 1.1;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.tl-stat-label {
  font-size: 11.5px; margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
/* Доля от вложенного — приглушённее самой суммы: это её пояснение, а не
   второй равноправный показатель. */
.tl-stat-pct {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.tl-age-pct { color: rgba(var(--v-theme-on-surface), 0.45); font-weight: 600; }
.tl-info {
  color: rgba(var(--v-theme-on-surface), 0.35);
  cursor: help; vertical-align: baseline;
  margin-left: 3px;
}
.tl-age-title { display: inline-flex; align-items: center; }
.tl-age-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  font-size: 12px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 10px;
}
.tl-age-avg {
  font-size: 11px; font-weight: 600;
  text-transform: none; letter-spacing: 0;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.tl-ages { display: flex; flex-direction: column; gap: 8px; }
/* Отрицательные поля — чтобы подсветка при наведении выходила за текст полосы
   и строка читалась как одна кликабельная область. */
.tl-age {
  display: flex; align-items: center; gap: 10px;
  padding: 3px 8px; margin: 0 -8px;
  border-radius: 8px;
  transition: background 0.15s;
}
.tl-age--click { cursor: pointer; }
.tl-age--click:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
/* Плитка показателя открывает всю сторону целиком. */
.tl-stat--click { cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.tl-stat--click:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
  border-color: rgba(var(--v-theme-on-surface), 0.12);
}
.tl-age-lbl {
  flex: 0 0 92px; font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.tl-age-bar-wrap {
  flex: 1; height: 8px; border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  overflow: hidden;
}
/* Пустая корзина всё равно занимает строку — шкала возраста должна читаться
   целиком, иначе «пропуск» между 8–30 и 91–180 выглядит как сбой. */
.tl-age-bar { height: 100%; border-radius: 6px; transition: width 0.25s; }
.tl-age-val {
  /* Шире прежнего: к сумме и счётчику добавилась доля от вложенного, а
     переносить строку возраста нельзя — полосы перестанут быть сравнимыми. */
  flex: 0 0 auto; min-width: 150px; text-align: right;
  font-size: 12px; font-weight: 700; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.tl-age-count { font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.45); }
.tl-empty {
  padding: 18px 0; text-align: center; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

@media (max-width: 600px) {
  .tl-stats { grid-template-columns: repeat(2, 1fr); }
  .tl-age-lbl { flex-basis: 78px; font-size: 11.5px; }
  .tl-age-val { min-width: 84px; font-size: 11.5px; }
}

@media (max-width: 480px) {
  .kpi-row { grid-template-columns: 1fr; }
  .payment-summary-card { flex: 1 1 100%; }
}

</style>
