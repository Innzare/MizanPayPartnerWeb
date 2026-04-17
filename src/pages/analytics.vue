<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { formatCurrency, formatCurrencyShort, formatPercent, formatDate } from '@/utils/formatters'
import { useRouter } from 'vue-router'
import { userName, clientProfileName } from '@/types'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useSubscription } from '@/composables/useSubscription'
import { useCapital } from '@/composables/useCapital'
import HeroSummary from '@/components/HeroSummary.vue'
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
const { canAccess: canAccessFeature } = useSubscription()
const hasCharts = computed(() => canAccessFeature('analyticsCharts'))

const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()
const { capital, isCapitalSet, fetchCapital } = useCapital()

const capitalUtilization = computed(() => {
  if (!capital.value || capital.value.totalCapital <= 0) return 0
  return Math.min(Math.round((capital.value.deployed / capital.value.totalCapital) * 100), 100)
})

const pageLoading = ref(true)

onMounted(async () => {
  try {
    await Promise.all([
      dealsStore.fetchDeals(),
      paymentsStore.fetchPayments(),
      fetchCapital(),
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

// ── Profit calculation ──
// Each payment contains a profit portion: amount * (markupPercent / (100 + markupPercent))
function getDealForPayment(payment: any) {
  return dealsStore.getDeal(payment.dealId) || payment.deal
}

function getPaymentProfit(payment: { amount: number; dealId: string; deal?: any }) {
  const deal = getDealForPayment(payment)
  if (!deal || !deal.markupPercent) return 0
  return payment.amount * (deal.markupPercent / (100 + deal.markupPercent))
}

// ── KPI ──

const paymentHealth = computed(() => {
  const paid = paymentsStore.paidPayments
  if (!paid.length) return 100
  const onTime = paid.filter(p => p.paidAt && new Date(p.paidAt) <= new Date(p.dueDate)).length
  return Math.round((onTime / paid.length) * 100)
})

const overdueAmount = computed(() =>
  paymentsStore.overduePayments.reduce((s, p) => s + p.amount, 0)
)

// Total earned profit (from paid payments)
const earnedProfit = computed(() =>
  paymentsStore.paidPayments.reduce((s, p) => s + getPaymentProfit(p), 0)
)

// Expected profit (from pending + overdue payments — not yet received)
const expectedProfit = computed(() =>
  paymentsStore.allPaymentsFlat
    .filter(p => p.status === 'PENDING' || p.status === 'OVERDUE')
    .reduce((s, p) => s + getPaymentProfit(p), 0)
)

// This month's earned profit
const thisMonthProfit = computed(() => {
  const now = new Date()
  const thisMonth = now.getMonth()
  const thisYear = now.getFullYear()
  return paymentsStore.paidPayments
    .filter(p => {
      const { year: y, month: m } = parseDateStr(p.dueDate)
      return m === thisMonth && y === thisYear
    })
    .reduce((s, p) => s + getPaymentProfit(p), 0)
})

// ── Profit detail dialog ──

const profitDetailDialog = ref(false)
const profitDetailMonth = ref<string | null>(null) // null = all time / all year
const profitDetailMode = ref<'earned' | 'expected' | 'all'>('earned')
const profitDetailYear = ref<number | null>(null) // null = default 6 months

interface DealProfit {
  dealId: string
  productName: string
  clientName: string
  markupPercent: number
  totalReceived: number
  profitEarned: number
  paidProfit: number
  pendingProfit: number
  paymentsCount: number
  paidCount: number
  pendingCount: number
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

const profitByDeal = computed(() => {
  const mode = profitDetailMode.value
  const year = profitDetailYear.value
  const monthKey = profitDetailMonth.value

  // Select source payments based on mode
  let sourcePayments: typeof paymentsStore.allPaymentsFlat
  if (mode === 'all') {
    sourcePayments = paymentsStore.allPaymentsFlat
  } else if (mode === 'expected') {
    sourcePayments = paymentsStore.allPaymentsFlat.filter(p => p.status === 'PENDING' || p.status === 'OVERDUE')
  } else {
    sourcePayments = paymentsStore.paidPayments
  }

  // Filter by month and/or year (always by dueDate string — no timezone issues)
  const paidPayments = sourcePayments.filter(p => {
    if (!p.dueDate) return false
    const { year: y, month: m } = parseDateStr(p.dueDate)

    // Filter by year if set (and no specific month selected = "whole year")
    if (year && !monthKey) {
      return y === year
    }

    // Filter by specific month key
    if (monthKey) {
      return getMonthKeyFromStr(p.dueDate) === monthKey
    }

    return true // "За всё время" without year
  })

  // Group by deal
  const dealMap: Record<string, { received: number; profit: number; paidProfit: number; pendingProfit: number; count: number; paidCount: number; pendingCount: number }> = {}
  for (const p of paidPayments) {
    if (!dealMap[p.dealId]) dealMap[p.dealId] = { received: 0, profit: 0, paidProfit: 0, pendingProfit: 0, count: 0, paidCount: 0, pendingCount: 0 }
    const pr = getPaymentProfit(p)
    dealMap[p.dealId].received += p.amount
    dealMap[p.dealId].profit += pr
    dealMap[p.dealId].count++
    if (p.status === 'PAID') {
      dealMap[p.dealId].paidCount++
      dealMap[p.dealId].paidProfit += pr
    } else {
      dealMap[p.dealId].pendingCount++
      dealMap[p.dealId].pendingProfit += pr
    }
  }

  const result: DealProfit[] = []
  for (const [dealId, data] of Object.entries(dealMap)) {
    const deal = dealsStore.getDeal(dealId)
    // Fallback: find deal data from one of the payments
    const paymentDeal = !deal ? paidPayments.find(p => p.dealId === dealId)?.deal : null
    const d = deal || paymentDeal
    if (!d) continue
    result.push({
      dealId,
      productName: d.productName || 'Товар',
      clientName: d.client ? userName(d.client) : d.clientProfile ? clientProfileName(d.clientProfile) : (d as any).externalClientName || '—',
      markupPercent: d.markupPercent || 0,
      totalReceived: data.received,
      profitEarned: data.profit,
      paidProfit: data.paidProfit,
      pendingProfit: data.pendingProfit,
      paymentsCount: data.count,
      paidCount: data.paidCount,
      pendingCount: data.pendingCount,
      status: d.status || 'ACTIVE',
    })
  }

  return result.sort((a, b) => b.profitEarned - a.profitEarned)
})

const profitDetailTotal = computed(() =>
  profitByDeal.value.reduce((s, d) => s + d.profitEarned, 0)
)

const profitDetailEarned = computed(() =>
  profitByDeal.value.reduce((s, d) => s + d.paidProfit, 0)
)

const profitDetailExpected = computed(() =>
  profitByDeal.value.reduce((s, d) => s + d.pendingProfit, 0)
)

const profitDetailReceived = computed(() =>
  profitByDeal.value.reduce((s, d) => s + d.totalReceived, 0)
)

function openProfitDetail(monthKey?: string, mode: 'earned' | 'expected' | 'all' = 'earned', year?: number) {
  profitDetailMonth.value = monthKey || null
  profitDetailMode.value = mode
  profitDetailYear.value = year || null
  profitDetailDialog.value = true
}

// ── Year calendar ──

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

const calYear = ref(new Date().getFullYear())
const calMode = ref<'earned' | 'expected'>('earned')

function prevYear() { calYear.value-- }
function nextYear() { calYear.value++ }

interface MonthData {
  month: number
  label: string
  earned: number
  expected: number
  received: number
  payments: number
  isCurrent: boolean
  isPast: boolean
}

const yearMonths = computed((): MonthData[] => {
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  return Array.from({ length: 12 }, (_, i) => {
    const isPast = calYear.value < currentYear || (calYear.value === currentYear && i <= currentMonth)
    const isCurrent = calYear.value === currentYear && i === currentMonth

    // All payments due this month (grouped by dueDate string — no timezone issues)
    const monthPayments = paymentsStore.allPaymentsFlat.filter(p => {
      const { year: y, month: m } = parseDateStr(p.dueDate)
      return y === calYear.value && m === i
    })

    const paidInMonth = monthPayments.filter(p => p.status === 'PAID')
    const pendingInMonth = monthPayments.filter(p => p.status === 'PENDING' || p.status === 'OVERDUE')

    const earned = paidInMonth.reduce((s, p) => s + getPaymentProfit(p), 0)
    const expected = pendingInMonth.reduce((s, p) => s + getPaymentProfit(p), 0)
    const received = paidInMonth.reduce((s, p) => s + p.amount, 0)

    return {
      month: i,
      label: MONTH_SHORT[i],
      earned: Math.round(earned),
      expected: Math.round(expected),
      received: Math.round(received),
      payments: paidInMonth.length + pendingInMonth.length,
      isCurrent,
      isPast,
    }
  })
})

const yearTotal = computed(() => {
  return yearMonths.value.reduce((s, m) => ({
    earned: s.earned + m.earned,
    expected: s.expected + m.expected,
    received: s.received + m.received,
  }), { earned: 0, expected: 0, received: 0 })
})

const yearMaxValue = computed(() => {
  return Math.max(...yearMonths.value.map(m => calMode.value === 'earned' ? m.earned : m.expected), 1)
})

const yearMaxBoth = computed(() => {
  return Math.max(...yearMonths.value.map(m => m.earned + m.expected), 1)
})

// Max single value for proportional bars (each bar independent, track = flex row)
const yearMaxSingle = computed(() => {
  return Math.max(
    ...yearMonths.value.map(m => Math.max(m.earned, m.expected)),
    1
  )
})

function openMonthDetail(m: MonthData) {
  const d = new Date(calYear.value, m.month, 1)
  const key = getMonthKey(d)
  openProfitDetail(key, 'all', calYear.value)
}

// ── CHART 1: Revenue by month (last 6) ──

const revenueChartData = computed(() => {
  const months = getLast6Months()

  paymentsStore.allPaymentsFlat.filter(p => p.status === 'PAID').forEach(p => {
    const key = getMonthKeyFromStr(p.dueDate)
    if (key in months) months[key] += p.amount
  })

  return {
    labels: Object.keys(months),
    datasets: [{
      label: 'Поступления',
      data: Object.values(months),
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
  const months = getLast6Months()

  paymentsStore.allPaymentsFlat.filter(p => p.status === 'PAID').forEach(p => {
    const key = getMonthKeyFromStr(p.dueDate)
    if (key in months) months[key] += getPaymentProfit(p)
  })

  return {
    labels: Object.keys(months),
    datasets: [{
      label: 'Доход',
      data: Object.values(months).map(v => Math.round(v)),
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
  const months = getNext6Months()

  paymentsStore.allPaymentsFlat.filter(p => p.status === 'PENDING' || p.status === 'OVERDUE').forEach(p => {
    const key = getMonthKeyFromStr(p.dueDate)
    if (key in months) months[key] += p.amount
  })

  return {
    labels: Object.keys(months),
    datasets: [{
      label: 'Ожидаемые платежи',
      data: Object.values(months),
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
  const months = getNext6Months()

  paymentsStore.allPaymentsFlat.filter(p => p.status === 'PENDING' || p.status === 'OVERDUE').forEach(p => {
    const key = getMonthKeyFromStr(p.dueDate)
    if (key in months) months[key] += getPaymentProfit(p)
  })

  return {
    labels: Object.keys(months),
    datasets: [{
      label: 'Ожидаемый доход',
      data: Object.values(months).map(v => Math.round(v)),
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
  const active = dealsStore.activeDeals.length
  const completed = dealsStore.completedDeals.length
  const disputed = dealsStore.deals.filter(d => d.status === 'DISPUTED').length
  const cancelled = dealsStore.deals.filter(d => d.status === 'CANCELLED').length
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
const breakdownOpen = ref(false)
const breakdownTitle = ref('')
const breakdownHint = ref('')
const breakdownIcon = ref('')
const breakdownColor = ref('')
const breakdownDeals = ref<{ deal: any; value: number; extra?: string; progress?: number }[]>([])
const breakdownTotal = ref(0)
const breakdownSuffix = ref('')

function openBreakdown(metric: string) {
  let deals: { deal: any; value: number; extra?: string; progress?: number }[] = []
  let title = ''
  let hint = ''
  let icon = ''
  let color = ''
  let suffix = ''

  switch (metric) {
    case 'invested':
      title = 'Инвестировано'
      hint = 'Сумма закупочных цен по всем сделкам'
      icon = 'mdi-cash-multiple'
      color = '#047857'
      deals = dealsStore.investorDeals.map(d => ({
        deal: d, value: d.purchasePrice,
        extra: `Наценка ${d.markupPercent}% · итого ${formatCurrency(d.totalPrice)}`,
        progress: d.numberOfPayments > 0 ? Math.round((d.paidPayments / d.numberOfPayments) * 100) : 0,
      }))
      break
    case 'revenue':
      title = 'Общий оборот'
      hint = 'Закупочная цена + наценка по всем сделкам'
      icon = 'mdi-chart-arc'
      color = '#3b82f6'
      deals = dealsStore.investorDeals.map(d => ({
        deal: d, value: d.totalPrice,
        extra: `${formatCurrency(d.purchasePrice)} закупка + ${formatCurrency(d.markup)} наценка`,
      }))
      break
    case 'profit':
      title = 'Прибыль'
      hint = 'Наценка по каждой сделке (totalPrice - purchasePrice)'
      icon = 'mdi-trending-up'
      color = '#10b981'
      deals = dealsStore.investorDeals.map(d => ({
        deal: d, value: d.markup,
        extra: `${d.markupPercent}% от ${formatCurrency(d.purchasePrice)}`,
      }))
      break
    case 'remaining':
      title = 'Ожидается к получению'
      hint = 'Остаток по активным сделкам (неоплаченные платежи)'
      icon = 'mdi-clock-outline'
      color = '#f59e0b'
      deals = dealsStore.activeDeals.map(d => ({
        deal: d, value: d.remainingAmount,
        extra: `${d.paidPayments} из ${d.numberOfPayments} платежей`,
        progress: d.numberOfPayments > 0 ? Math.round((d.paidPayments / d.numberOfPayments) * 100) : 0,
      }))
      break
    case 'monthly':
      title = 'Доход / мес'
      hint = 'Средний ежемесячный платёж по активным сделкам'
      icon = 'mdi-calendar-month'
      color = '#047857'
      deals = dealsStore.activeDeals
        .filter(d => d.numberOfPayments > 0)
        .map(d => ({
          deal: d, value: Math.round(d.totalPrice / d.numberOfPayments),
          extra: `${formatCurrency(d.totalPrice)} ÷ ${d.numberOfPayments} мес`,
        }))
      break
    case 'overdue':
      title = 'Просрочено'
      hint = 'Сумма просроченных платежей'
      icon = 'mdi-alert-circle'
      color = '#ef4444'
      deals = paymentsStore.overduePayments.map(p => ({
        deal: { productName: p.deal?.productName || 'Сделка', id: p.dealId },
        value: p.amount,
        extra: `Срок: ${formatDate(p.dueDate)}`,
      }))
      break
    default:
      return
  }

  breakdownDeals.value = deals.sort((a, b) => b.value - a.value)
  breakdownTotal.value = deals.reduce((s, d) => s + d.value, 0)
  breakdownTitle.value = title
  breakdownHint.value = hint
  breakdownIcon.value = icon
  breakdownColor.value = color
  breakdownSuffix.value = suffix
  breakdownOpen.value = true
}

const BD_COLORS = ['#047857', '#3b82f6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ef4444']
function bdInitial(name?: string) { return name ? name.charAt(0).toUpperCase() : '?' }
function bdColor(name?: string) {
  if (!name) return BD_COLORS[0]
  return BD_COLORS[name.charCodeAt(0) % BD_COLORS.length]
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
      <!-- Hero summary -->
      <HeroSummary class="mb-6" @metric="openBreakdown" />

      <!-- KPI Cards -->
      <div class="kpi-row mb-6">
        <div class="kpi-card">
          <div class="kpi-icon-wrap" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">
            <v-icon icon="mdi-trending-up" size="20" />
          </div>
          <div class="kpi-info">
            <div class="kpi-value">{{ formatCurrencyShort(earnedProfit) }}</div>
            <div class="kpi-label">Заработано</div>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon-wrap" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
            <v-icon icon="mdi-clock-outline" size="20" />
          </div>
          <div class="kpi-info">
            <div class="kpi-value">{{ formatCurrencyShort(expectedProfit) }}</div>
            <div class="kpi-label">Ожидается дохода</div>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon-wrap" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
            <v-icon icon="mdi-calendar-month" size="20" />
          </div>
          <div class="kpi-info">
            <div class="kpi-value">{{ formatCurrencyShort(thisMonthProfit) }}</div>
            <div class="kpi-label">Доход за месяц</div>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon-wrap" :style="{ background: paymentHealth >= 90 ? 'rgba(4, 120, 87, 0.1)' : 'rgba(245, 158, 11, 0.1)', color: paymentHealth >= 90 ? '#047857' : '#f59e0b' }">
            <v-icon icon="mdi-heart-pulse" size="20" />
          </div>
          <div class="kpi-info">
            <div class="kpi-value">{{ paymentHealth }}%</div>
            <div class="kpi-label">Своевременность</div>
          </div>
        </div>

        <div class="kpi-card" v-if="overdueAmount > 0">
          <div class="kpi-icon-wrap" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
            <v-icon icon="mdi-alert-circle" size="20" />
          </div>
          <div class="kpi-info">
            <div class="kpi-value" style="color: #ef4444;">{{ formatCurrencyShort(overdueAmount) }}</div>
            <div class="kpi-label">Просрочено</div>
          </div>
        </div>

        <div class="kpi-card" v-if="isCapitalSet && capital" @click="router.push('/finance')" style="cursor: pointer;">
          <div class="kpi-icon-wrap" style="background: rgba(124, 58, 237, 0.1); color: #7c3aed;">
            <v-icon icon="mdi-wallet-outline" size="20" />
          </div>
          <div class="kpi-info">
            <div class="kpi-value" style="color: #7c3aed;">{{ formatCurrencyShort(capital.availableCapital) }}</div>
            <div class="kpi-label">Доступный капитал</div>
          </div>
        </div>

        <div class="kpi-card" v-if="isCapitalSet && capital">
          <div class="kpi-icon-wrap" style="background: rgba(124, 58, 237, 0.1); color: #7c3aed;">
            <v-icon icon="mdi-chart-donut" size="20" />
          </div>
          <div class="kpi-info">
            <div class="kpi-value">{{ capitalUtilization }}%</div>
            <div class="kpi-label">В работе</div>
          </div>
        </div>
      </div>

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
              <div class="yc-stat-value" style="color: #34d399;">{{ formatCurrencyShort(yearTotal.earned) }}</div>
              <div class="yc-stat-label">Заработано</div>
            </div>
            <div class="yc-stat-divider" />
            <div class="yc-stat">
              <div class="yc-stat-value">{{ formatCurrencyShort(yearTotal.expected) }}</div>
              <div class="yc-stat-label">Ожидается</div>
            </div>
            <div class="yc-stat-divider" />
            <div class="yc-stat">
              <div class="yc-stat-value">{{ formatCurrencyShort(yearTotal.earned + yearTotal.expected) }}</div>
              <div class="yc-stat-label">Итого</div>
            </div>
          </div>
        </div>

        <!-- Month grid -->
        <div class="yc-grid">
          <div
            v-for="m in yearMonths"
            :key="m.month"
            class="yc-month"
            :class="{
              'yc-month--current': m.isCurrent,
              'yc-month--empty': m.earned === 0 && m.expected === 0,
            }"
            @click="openMonthDetail(m)"
          >
            <!-- Month name -->
            <div class="yc-month-name" :class="{ 'yc-month-name--current': m.isCurrent }">
              {{ MONTH_NAMES[m.month] }}
              <span v-if="m.isCurrent" class="yc-month-now">сейчас</span>
            </div>

            <!-- Progress bar: earned / total -->
            <div v-if="m.earned > 0 || m.expected > 0" class="yc-bars">
              <div class="yc-bar-track">
                <div
                  v-if="m.earned > 0"
                  class="yc-bar yc-bar--earned"
                  :style="{ width: (m.earned / (m.earned + m.expected) * 100) + '%' }"
                />
                <div
                  v-if="m.expected > 0"
                  class="yc-bar yc-bar--expected"
                  :style="{ width: (m.expected / (m.earned + m.expected) * 100) + '%' }"
                />
              </div>
            </div>
            <div v-else class="yc-bars">
              <div class="yc-bar-track" />
            </div>

            <!-- Values -->
            <div class="yc-month-values">
              <span v-if="m.earned > 0" class="yc-val yc-val--earned">+{{ formatCurrencyShort(m.earned) }}</span>
              <span v-if="m.expected > 0" class="yc-val yc-val--expected">~{{ formatCurrencyShort(m.expected) }}</span>
              <span v-if="m.earned === 0 && m.expected === 0" class="yc-val yc-val--empty">—</span>
            </div>
          </div>
        </div>

        <!-- Legend -->
        <div class="yc-footer">
          <div class="yc-legend">
            <span class="yc-legend-dot" style="background: #10b981;" />
            <span>Заработано</span>
          </div>
          <div class="yc-legend">
            <span class="yc-legend-dot" style="background: #3b82f6;" />
            <span>Ожидается</span>
          </div>
          <div class="yc-legend-hint">
            <v-icon icon="mdi-cursor-default-click-outline" size="13" />
            Нажмите на месяц для детализации
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
                {{ formatCurrency(paymentsStore.paidPayments.reduce((s, p) => s + p.amount, 0)) }}
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
                  {{ formatCurrency(paymentsStore.pendingPayments.reduce((s, p) => s + p.amount, 0)) }}
                </div>
              </div>
              <div class="forecast-summary-item">
                <div class="forecast-summary-label">Платежей</div>
                <div class="forecast-summary-value" style="color: #f59e0b;">
                  {{ paymentsStore.pendingPayments.length }}
                </div>
              </div>
              <div class="forecast-summary-item">
                <div class="forecast-summary-label">Средний платёж</div>
                <div class="forecast-summary-value" style="color: #8b5cf6;">
                  {{ formatCurrency(paymentsStore.pendingPayments.length > 0 ? paymentsStore.pendingPayments.reduce((s, p) => s + p.amount, 0) / paymentsStore.pendingPayments.length : 0) }}
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
                  <span class="status-legend-count">{{ dealsStore.activeDeals.length }}</span>
                </div>
                <div class="status-legend-item">
                  <div class="status-dot" style="background: #3b82f6;" />
                  <span>Завершённые</span>
                  <span class="status-legend-count">{{ dealsStore.completedDeals.length }}</span>
                </div>
                <div class="status-legend-item">
                  <div class="status-dot" style="background: #f59e0b;" />
                  <span>Спорные</span>
                  <span class="status-legend-count">{{ dealsStore.deals.filter(d => d.status === 'DISPUTED').length }}</span>
                </div>
                <div class="status-legend-item">
                  <div class="status-dot" style="background: #ef4444;" />
                  <span>Отменённые</span>
                  <span class="status-legend-count">{{ dealsStore.deals.filter(d => d.status === 'CANCELLED').length }}</span>
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
                <div class="payment-summary-value">{{ paymentsStore.paidPayments.length }}</div>
                <div class="payment-summary-label">Оплаченных</div>
                <div class="payment-summary-amount" style="color: #047857;">{{ formatCurrencyShort(paymentsStore.paidPayments.reduce((s, p) => s + p.amount, 0)) }}</div>
              </div>
              <div class="payment-summary-card">
                <div class="payment-summary-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
                  <v-icon icon="mdi-clock-outline" size="22" />
                </div>
                <div class="payment-summary-value">{{ paymentsStore.pendingPayments.length }}</div>
                <div class="payment-summary-label">Ожидаемых</div>
                <div class="payment-summary-amount" style="color: #3b82f6;">{{ formatCurrencyShort(paymentsStore.pendingPayments.reduce((s, p) => s + p.amount, 0)) }}</div>
              </div>
              <div class="payment-summary-card">
                <div class="payment-summary-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
                  <v-icon icon="mdi-alert-circle" size="22" />
                </div>
                <div class="payment-summary-value">{{ paymentsStore.overduePayments.length }}</div>
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

    <!-- Profit Detail Dialog -->
    <v-dialog v-model="profitDetailDialog" max-width="680" scrollable>
      <v-card rounded="lg">
        <div class="pa-5">
          <div class="d-flex align-center justify-space-between mb-2">
            <div>
              <div class="text-h6 font-weight-bold">{{ profitDetailMode === 'expected' ? 'Ожидаемый доход' : 'Детализация дохода' }}</div>
              <div class="text-caption text-medium-emphasis">{{ profitDetailMode === 'expected' ? 'Прогноз дохода по сделкам' : 'Доход по каждой сделке' }}</div>
            </div>
            <button class="dialog-close-sm" @click="profitDetailDialog = false">
              <v-icon icon="mdi-close" size="18" />
            </button>
          </div>

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

          <!-- Summary -->
          <div class="pd-summary mb-4">
            <div class="pd-summary-item">
              <div class="pd-summary-label">Заработано</div>
              <div class="pd-summary-value" style="color: #10b981;">{{ formatCurrency(profitDetailEarned) }}</div>
            </div>
            <div v-if="profitDetailExpected > 0" class="pd-summary-divider" />
            <div v-if="profitDetailExpected > 0" class="pd-summary-item">
              <div class="pd-summary-label">Ожидается</div>
              <div class="pd-summary-value" style="color: #3b82f6;">{{ formatCurrency(profitDetailExpected) }}</div>
            </div>
            <div class="pd-summary-divider" />
            <div class="pd-summary-item">
              <div class="pd-summary-label">Сумма платежей</div>
              <div class="pd-summary-value">{{ formatCurrency(profitDetailReceived) }}</div>
            </div>
            <div class="pd-summary-divider" />
            <div class="pd-summary-item">
              <div class="pd-summary-label">Сделок</div>
              <div class="pd-summary-value">{{ profitByDeal.length }}</div>
            </div>
            <div class="pd-summary-divider" />
            <div class="pd-summary-item">
              <div class="pd-summary-label">Платежей</div>
              <div class="pd-summary-value">{{ profitByDeal.reduce((s, d) => s + d.paymentsCount, 0) }}</div>
            </div>
          </div>

          <!-- Deal list -->
          <div v-if="profitByDeal.length" class="pd-list">
            <div
              v-for="d in profitByDeal"
              :key="d.dealId"
              class="pd-deal"
              @click="profitDetailDialog = false; router.push(`/deals/${d.dealId}`)"
            >
              <div class="pd-deal-main">
                <div class="pd-deal-name">{{ d.productName }}</div>
                <div class="pd-deal-meta">
                  {{ d.clientName }} · {{ d.paymentsCount }} {{ d.paymentsCount === 1 ? 'платёж' : 'платежей' }} · наценка {{ Math.round(d.markupPercent) }}%
                </div>
              </div>
              <div class="pd-deal-numbers">
                <div class="pd-deal-profit" :style="{ color: d.paidCount > 0 ? '#10b981' : '#3b82f6' }">{{ d.paidCount > 0 && d.pendingCount === 0 ? '+' : d.paidCount === 0 ? '~' : '' }}{{ formatCurrency(d.profitEarned) }}</div>
                <div class="pd-deal-received">из {{ formatCurrency(d.totalReceived) }}</div>
              </div>
              <v-icon icon="mdi-chevron-right" size="16" class="pd-deal-chevron" />
            </div>
          </div>

          <div v-else class="text-center pa-8 text-medium-emphasis text-body-2">
            Нет платежей за выбранный период
          </div>
        </div>
      </v-card>
    </v-dialog>

    <!-- Metric Breakdown Dialog -->
    <v-dialog v-model="breakdownOpen" max-width="580" scrollable>
      <v-card rounded="xl" class="bd-dialog">
        <!-- Header -->
        <div class="bd-header">
          <div class="bd-header-left">
            <div class="bd-header-icon" :style="{ background: breakdownColor + '15', color: breakdownColor }">
              <v-icon :icon="breakdownIcon" size="20" />
            </div>
            <div>
              <div class="bd-header-title">{{ breakdownTitle }}</div>
              <div class="bd-header-hint">{{ breakdownHint }}</div>
            </div>
          </div>
          <button class="bd-close" @click="breakdownOpen = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <!-- Total hero -->
        <div class="bd-total-hero" :style="{ background: breakdownColor + '08' }">
          <div class="bd-total-value" :style="{ color: breakdownColor }">
            {{ breakdownSuffix ? (Math.round(breakdownTotal * 10) / 10) + breakdownSuffix : formatCurrency(breakdownTotal) }}
          </div>
          <div class="bd-total-label">{{ breakdownDeals.length }} {{ breakdownDeals.length === 1 ? 'сделка' : breakdownDeals.length < 5 ? 'сделки' : 'сделок' }}</div>
        </div>

        <!-- Deals list -->
        <div class="bd-list" style="max-height: 400px; overflow-y: auto;">
          <div v-if="!breakdownDeals.length" class="bd-empty">
            <v-icon icon="mdi-package-variant-closed" size="36" color="grey-lighten-1" />
            <div>Нет данных</div>
          </div>

          <router-link
            v-for="(item, i) in breakdownDeals" :key="i"
            :to="`/deals/${item.deal?.id}`"
            class="bd-row"
          >
            <div class="bd-avatar" :style="{ background: bdColor(item.deal?.productName) }">
              {{ bdInitial(item.deal?.productName) }}
            </div>
            <div class="bd-info">
              <div class="bd-product">{{ item.deal?.productName || 'Товар' }}</div>
              <div class="bd-extra">{{ item.extra }}</div>
              <!-- Progress bar -->
              <div v-if="item.progress !== undefined" class="bd-progress">
                <div class="bd-progress-bar">
                  <div class="bd-progress-fill" :style="{ width: item.progress + '%', background: breakdownColor }" />
                </div>
                <span class="bd-progress-text">{{ item.progress }}%</span>
              </div>
            </div>
            <div class="bd-right">
              <div class="bd-value" :style="{ color: breakdownColor }">
                {{ breakdownSuffix ? item.value + breakdownSuffix : formatCurrency(item.value) }}
              </div>
              <!-- Share of total -->
              <div class="bd-share">{{ breakdownTotal > 0 ? Math.round((item.value / breakdownTotal) * 100) : 0 }}%</div>
            </div>
          </router-link>
        </div>
      </v-card>
    </v-dialog>
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
.yc-stat-divider {
  width: 1px; height: 28px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

/* Month grid */
.yc-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 16px 20px;
  gap: 8px;
}
@media (max-width: 800px) { .yc-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 500px) { .yc-grid { grid-template-columns: repeat(2, 1fr); } }

.yc-month {
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  cursor: pointer;
  transition: all 0.15s;
}
.yc-month:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-color: rgba(var(--v-theme-on-surface), 0.15);
}
.yc-month--current {
  background: rgba(16, 185, 129, 0.05);
  border-color: rgba(16, 185, 129, 0.35);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.08);
}
.yc-month--empty { opacity: 0.45; }
.yc-month--empty:hover { opacity: 0.65; }

.yc-month-name {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-bottom: 10px;
  display: flex; align-items: center; gap: 6px;
}
.yc-month-name--current { color: #047857; }
.yc-month-now {
  font-size: 10px; font-weight: 700;
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  padding: 1px 6px; border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* Dual horizontal bars — flex stack */
.yc-bars { margin-bottom: 8px; }
.yc-bar-track {
  height: 6px;
  border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  display: flex;
  overflow: hidden;
  gap: 1px;
}
.yc-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s cubic-bezier(0.23, 1, 0.32, 1);
  min-width: 0;
  flex-shrink: 0;
}
.yc-bar--earned { background: #10b981; }
.yc-bar--expected { background: #3b82f6; }

.yc-month-values {
  display: flex; align-items: center; gap: 8px;
  min-height: 18px;
}
.yc-val {
  font-size: 13px; font-weight: 700;
}
.yc-val--earned { color: #10b981; }
.yc-val--expected { color: #3b82f6; }
.yc-val--empty {
  color: rgba(var(--v-theme-on-surface), 0.2);
  font-weight: 500;
}

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

.pd-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pd-deal {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.pd-deal:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.pd-deal-main {
  flex: 1;
  min-width: 0;
}
.pd-deal-name {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pd-deal-meta {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.pd-deal-numbers {
  text-align: right;
  flex-shrink: 0;
}
.pd-deal-profit {
  font-size: 15px;
  font-weight: 700;
}
.pd-deal-received {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 1px;
}
.pd-deal-chevron {
  color: rgba(var(--v-theme-on-surface), 0.2);
  flex-shrink: 0;
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


</style>
