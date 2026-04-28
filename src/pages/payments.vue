<script lang="ts" setup>
import { usePaymentsStore } from '@/stores/payments'
import { useDealsStore } from '@/stores/deals'
import { formatCurrency, formatDate, formatDateShort, formatPercent, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { PAYMENT_STATUS_CONFIG, DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { type Payment, type Deal, userName, clientProfileName } from '@/types'
import { useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useSubscription } from '@/composables/useSubscription'
import { useFolders } from '@/composables/useFolders'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'
import SendRemindersDialog from '@/components/SendRemindersDialog.vue'

const router = useRouter()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const subscription = useSubscription()
const paymentsStore = usePaymentsStore()
const dealsStore = useDealsStore()
const { folders, fetchFolders } = useFolders()
const filterFolder = ref<string | null>(null)
const { coInvestors: ciList, fetchCoInvestors } = useCoInvestors()
fetchCoInvestors()
const filterCoInvestor = ref<string | null>(null)
const filterCoInvestorObj = computed(() =>
  filterCoInvestor.value ? ciList.value.find((c) => c.id === filterCoInvestor.value) ?? null : null,
)

// Staff assignee filter (partner-only)
const authStore = useAuthStore()
interface StaffOption { id: string; firstName: string; lastName: string; isActive: boolean }
const staffList = ref<StaffOption[]>([])
const filterStaff = ref<string | null>(null)
const filterStaffObj = computed(() =>
  filterStaff.value ? staffList.value.find((s) => s.id === filterStaff.value) ?? null : null,
)
async function loadStaffList() {
  if (!authStore.isOwner) return
  try {
    const list = await api.get<StaffOption[]>('/auth/investor/staff')
    staffList.value = list.filter((s) => s.isActive)
  } catch { /* ignore */ }
}
loadStaffList()

const pageLoading = ref(true)

// Dialog flow replaces the old "blast everyone" button — partner now picks
// who gets a reminder, sees the list with phones, and confirms.
const showRemindersDialog = ref(false)

function openRemindersDialog() {
  showRemindersDialog.value = true
}

// Kept as a no-op wrapper for now — `sendingBulk` is referenced in the
// template's loading state for the trigger button, but the dialog handles
// its own sending state. Remove this when the trigger button is migrated.
const sendingBulk = ref(false)

async function sendBulkReminders() {
  openRemindersDialog()
}

onMounted(async () => {
  try {
    await Promise.all([
      paymentsStore.fetchPayments(),
      dealsStore.fetchDeals(),
      fetchFolders(),
    ])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки платежей')
  } finally {
    pageLoading.value = false
  }
})

const tab = ref(0)
watch(tab, (v) => {
  sortField.value = 'dueDate'
  sortAsc.value = v === 2 ? false : true
})
const search = ref('')
const viewMode = ref<'table' | 'calendar'>('table')

// Month filter
const now = new Date()
const filterMonth = ref<string | null>(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const filterYear = ref(new Date().getFullYear())

const availableYears = computed(() => {
  const years = new Set<number>()
  paymentsStore.allPaymentsFlat.forEach(p => {
    years.add(parseInt(p.dueDate.slice(0, 4)))
  })
  years.add(new Date().getFullYear())
  return Array.from(years).sort((a, b) => b - a)
})

// Count payments per month for the selected year
const monthPaymentCounts = computed(() => {
  const counts: Record<string, number> = {}
  paymentsStore.allPaymentsFlat.forEach(p => {
    const ym = p.dueDate.slice(0, 7)
    if (ym.startsWith(String(filterYear.value))) {
      counts[ym] = (counts[ym] || 0) + 1
    }
  })
  return counts
})

const filterMonthLabel = computed(() => {
  if (!filterMonth.value) return 'Все'
  const [, m] = filterMonth.value.split('-')
  return MONTH_NAMES[parseInt(m) - 1]
})

// Calendar
const calendarMonth = ref(new Date().getMonth())
const calendarYear = ref(new Date().getFullYear())
const selectedCalendarDate = ref<string | null>(null)
const calendarScale = ref<'month' | 'year'>('month')

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function prevMonth() {
  if (calendarMonth.value === 0) {
    calendarMonth.value = 11
    calendarYear.value--
  } else {
    calendarMonth.value--
  }
  selectedCalendarDate.value = null
}

function nextMonth() {
  if (calendarMonth.value === 11) {
    calendarMonth.value = 0
    calendarYear.value++
  } else {
    calendarMonth.value++
  }
  selectedCalendarDate.value = null
}

// Map: dateKey (YYYY-MM-DD) -> payments[]
const paymentsByDate = computed(() => {
  if (!subscription.canAccess('analyticsCharts')) return {} as Record<string, (Payment & { _dealName: string; _clientName: string; _isExternal: boolean })[]>
  const map: Record<string, (Payment & { _dealName: string; _clientName: string; _isExternal: boolean })[]> = {}
  paymentsStore.allPaymentsFlat.forEach(p => {
    const key = p.dueDate.slice(0, 10)
    if (!map[key]) map[key] = []
    const deal = getDealForPayment(p)
    map[key].push({
      ...p,
      _dealName: getDealName(p),
      _clientName: getClientName(p),
      _isExternal: !deal?.client && !deal?.clientProfile?.userId && !!(deal?.clientProfile || deal?.externalClientName),
    })
  })
  return map
})

type CalendarDay = {
  day: number
  dateKey: string
  isCurrentMonth: boolean
  isToday: boolean
  payments: (Payment & { _dealName: string; _clientName: string; _isExternal: boolean })[]
  totalAmount: number
  hasOverdue: boolean
  hasPending: boolean
  hasPaid: boolean
}

const calendarDays = computed((): CalendarDay[] => {
  const year = calendarYear.value
  const month = calendarMonth.value
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  // Monday-based: 0=Mon ... 6=Sun
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6

  const days: CalendarDay[] = []
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  // Previous month days
  const prevMonthLast = new Date(year, month, 0).getDate()
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevMonthLast - i
    const m = month === 0 ? 12 : month
    const y = month === 0 ? year - 1 : year
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const ps = paymentsByDate.value[key] || []
    days.push({
      day: d, dateKey: key, isCurrentMonth: false, isToday: key === todayKey,
      payments: ps, totalAmount: ps.reduce((s, p) => s + p.amount, 0),
      hasOverdue: ps.some(p => p.status === 'OVERDUE'),
      hasPending: ps.some(p => p.status === 'PENDING'),
      hasPaid: ps.some(p => p.status === 'PAID'),
    })
  }

  // Current month days
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const ps = paymentsByDate.value[key] || []
    days.push({
      day: d, dateKey: key, isCurrentMonth: true, isToday: key === todayKey,
      payments: ps, totalAmount: ps.reduce((s, p) => s + p.amount, 0),
      hasOverdue: ps.some(p => p.status === 'OVERDUE'),
      hasPending: ps.some(p => p.status === 'PENDING'),
      hasPaid: ps.some(p => p.status === 'PAID'),
    })
  }

  // Next month days to fill 6 rows
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    const m = month === 11 ? 1 : month + 2
    const y = month === 11 ? year + 1 : year
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const ps = paymentsByDate.value[key] || []
    days.push({
      day: d, dateKey: key, isCurrentMonth: false, isToday: key === todayKey,
      payments: ps, totalAmount: ps.reduce((s, p) => s + p.amount, 0),
      hasOverdue: ps.some(p => p.status === 'OVERDUE'),
      hasPending: ps.some(p => p.status === 'PENDING'),
      hasPaid: ps.some(p => p.status === 'PAID'),
    })
  }

  return days
})

const selectedDatePayments = computed(() => {
  if (!selectedCalendarDate.value) return []
  return paymentsByDate.value[selectedCalendarDate.value] || []
})

// Monthly summary for sidebar
const monthSummary = computed(() => {
  const year = calendarYear.value
  const month = calendarMonth.value
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
  let total = 0, pending = 0, overdue = 0, paid = 0, count = 0
  paymentsStore.allPaymentsFlat.forEach(p => {
    if (p.dueDate.startsWith(prefix)) {
      count++
      total += p.amount
      if (p.status === 'PENDING') pending += p.amount
      if (p.status === 'OVERDUE') overdue += p.amount
      if (p.status === 'PAID') paid += p.amount
    }
  })
  return { total, pending, overdue, paid, count }
})

function prevYear() {
  calendarYear.value--
  selectedCalendarDate.value = null
}

function nextYear() {
  calendarYear.value++
  selectedCalendarDate.value = null
}

function goToMonthFromYear(monthIndex: number) {
  calendarMonth.value = monthIndex
  calendarScale.value = 'month'
}

// Yearly calendar: mini-month data
type YearMonthData = {
  monthIndex: number
  name: string
  days: {
    day: number
    dateKey: string
    isCurrentMonth: boolean
    hasOverdue: boolean
    hasPending: boolean
    hasPaid: boolean
    isToday: boolean
    paymentCount: number
    totalAmount: number
  }[]
  totalAmount: number
  paymentCount: number
  hasOverdue: boolean
}

const yearMonths = computed((): YearMonthData[] => {
  const year = calendarYear.value
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  return MONTH_NAMES.map((name, monthIndex) => {
    const firstDay = new Date(year, monthIndex, 1)
    const lastDay = new Date(year, monthIndex + 1, 0)

    let startDow = firstDay.getDay() - 1
    if (startDow < 0) startDow = 6

    const days: YearMonthData['days'] = []

    // Previous month padding
    const prevMonthLast = new Date(year, monthIndex, 0).getDate()
    for (let i = startDow - 1; i >= 0; i--) {
      const d = prevMonthLast - i
      days.push({ day: d, dateKey: '', isCurrentMonth: false, hasOverdue: false, hasPending: false, hasPaid: false, isToday: false, paymentCount: 0, totalAmount: 0 })
    }

    // Current month days
    let monthTotal = 0
    let monthPaymentCount = 0
    let monthHasOverdue = false
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const ps = paymentsByDate.value[key] || []
      const amt = ps.reduce((s, p) => s + p.amount, 0)
      const hasOverdue = ps.some(p => p.status === 'OVERDUE')
      monthTotal += amt
      monthPaymentCount += ps.length
      if (hasOverdue) monthHasOverdue = true
      days.push({
        day: d, dateKey: key, isCurrentMonth: true,
        hasOverdue,
        hasPending: ps.some(p => p.status === 'PENDING'),
        hasPaid: ps.some(p => p.status === 'PAID'),
        isToday: key === todayKey,
        paymentCount: ps.length,
        totalAmount: amt,
      })
    }

    // Fill to 42
    const remaining = 42 - days.length
    for (let d = 1; d <= remaining; d++) {
      days.push({ day: d, dateKey: '', isCurrentMonth: false, hasOverdue: false, hasPending: false, hasPaid: false, isToday: false, paymentCount: 0, totalAmount: 0 })
    }

    return { monthIndex, name, days, totalAmount: monthTotal, paymentCount: monthPaymentCount, hasOverdue: monthHasOverdue }
  })
})

// Year summary
const yearSummary = computed(() => {
  const year = calendarYear.value
  const prefix = `${year}-`
  let total = 0, pending = 0, overdue = 0, paid = 0, count = 0
  paymentsStore.allPaymentsFlat.forEach(p => {
    if (p.dueDate.startsWith(prefix)) {
      count++
      total += p.amount
      if (p.status === 'PENDING') pending += p.amount
      if (p.status === 'OVERDUE') overdue += p.amount
      if (p.status === 'PAID') paid += p.amount
    }
  })
  return { total, pending, overdue, paid, count }
})

function selectYearDay(day: YearMonthData['days'][0]) {
  if (day.paymentCount > 0 && day.isCurrentMonth) {
    selectedCalendarDate.value = selectedCalendarDate.value === day.dateKey ? null : day.dateKey
  }
}

function selectDay(day: CalendarDay) {
  if (day.payments.length) {
    selectedCalendarDate.value = selectedCalendarDate.value === day.dateKey ? null : day.dateKey
  }
}

function formatSelectedDate(key: string) {
  const d = new Date(key)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Sorting
type SortField = 'dueDate' | 'amount' | 'number' | 'deal' | 'client' | 'status'
const sortField = ref<SortField>('dueDate')
const sortAsc = ref(true)

function toggleSort(field: SortField) {
  if (sortField.value === field) {
    sortAsc.value = !sortAsc.value
  } else {
    sortField.value = field
    sortAsc.value = field === 'dueDate' || field === 'number'
  }
}

function sortIcon(field: SortField) {
  if (sortField.value !== field) return 'mdi-unfold-more-horizontal'
  return sortAsc.value ? 'mdi-chevron-up' : 'mdi-chevron-down'
}

// Deal detail dialog
const selectedDeal = ref<Deal | null>(null)
const showDealDialog = ref(false)

function openDealFromPayment(payment: Payment) {
  const deal = getDealForPayment(payment)
  if (deal) {
    selectedDeal.value = deal
    showDealDialog.value = true
  }
}

function goToDeal(deal: Deal) {
  router.push(`/deals/${deal.id}`)
}

function getDealProgress(deal: Deal) {
  return deal.numberOfPayments > 0 ? (deal.paidPayments / deal.numberOfPayments) * 100 : 0
}

const selectedDealPayments = computed(() => {
  if (!selectedDeal.value) return []
  return paymentsStore.getPaymentsForDeal(selectedDeal.value.id)
})

const selectedDealPaidTotal = computed(() =>
  selectedDealPayments.value.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0)
)

// Reschedule dialog
const rescheduleDialog = ref(false)
const reschedulePaymentRef = ref<Payment | null>(null)
const rescheduleDate = ref('')
const rescheduleReason = ref('')

// Active payments = pending + overdue (no paid in default view)
const activePayments = computed(() =>
  paymentsStore.allPaymentsFlat.filter(p => p.status === 'PENDING' || p.status === 'OVERDUE')
)

const displayedPayments = computed(() => {
  let payments: Payment[] = []

  if (tab.value === 0) payments = [...activePayments.value]
  else if (tab.value === 1) payments = [...paymentsStore.pendingPayments]
  else if (tab.value === 2) payments = [...paymentsStore.overduePayments]
  else if (tab.value === 3) payments = [...paymentsStore.paidPayments]
  else payments = [...paymentsStore.allPaymentsFlat]

  // Month filter
  if (filterMonth.value) {
    payments = payments.filter(p => p.dueDate.slice(0, 7) === filterMonth.value)
  }

  // Folder filter
  if (filterFolder.value) {
    payments = payments.filter(p => {
      const deal = getDealForPayment(p)
      return deal?.folderId === filterFolder.value
    })
  }

  // Co-investor filter
  if (filterCoInvestor.value) {
    payments = payments.filter(p => {
      const deal = getDealForPayment(p)
      return deal?.coInvestors?.some(link => link.coInvestor.id === filterCoInvestor.value)
    })
  }

  // Staff assignee filter
  if (filterStaff.value) {
    payments = payments.filter(p => {
      const deal = getDealForPayment(p) as any
      return deal?.assignedStaffId === filterStaff.value
    })
  }

  if (search.value) {
    const s = search.value.toLowerCase()
    payments = payments.filter((p) => {
      const deal = getDealForPayment(p)
      const clientName = deal?.client ? userName(deal.client) : deal?.clientProfile ? clientProfileName(deal.clientProfile) : deal?.externalClientName || ''
      return deal?.productName.toLowerCase().includes(s) || clientName.toLowerCase().includes(s)
    })
  }

  // Sort
  const dir = sortAsc.value ? 1 : -1
  payments.sort((a, b) => {
    switch (sortField.value) {
      case 'dueDate':
        return dir * (new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      case 'amount':
        return dir * (a.amount - b.amount)
      case 'number':
        return dir * (a.number - b.number)
      case 'deal': {
        const da = getDealName(a)
        const db = getDealName(b)
        return dir * da.localeCompare(db, 'ru')
      }
      case 'client': {
        const ca = getClientName(a)
        const cb = getClientName(b)
        return dir * ca.localeCompare(cb, 'ru')
      }
      case 'status': {
        const order: Record<string, number> = { OVERDUE: 0, PENDING: 1, PAID: 2 }
        return dir * ((order[a.status] ?? 3) - (order[b.status] ?? 3))
      }
      default:
        return 0
    }
  })

  return payments
})

function getDealForPayment(payment: Payment): Deal | undefined {
  return dealsStore.getDeal(payment.dealId) || payment.deal
}

function getDealName(payment: Payment) {
  return getDealForPayment(payment)?.productName || payment.dealId
}

function getClientName(payment: Payment) {
  const deal = getDealForPayment(payment)
  if (!deal) return '—'
  if (deal.client) return userName(deal.client)
  if (deal.clientProfile) return clientProfileName(deal.clientProfile)
  return deal.externalClientName || '—'
}

function daysUntil(dateStr: string) {
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
  if (diff < 0) return `${Math.abs(diff)} дн. назад`
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Завтра'
  return `через ${diff} дн.`
}

const markPaidDialog = ref(false)
const markPaidTarget = ref<Payment | null>(null)
const markPaidAmount = ref<number | null>(null)
const markPaidLoading = ref(false)
const markPaidOnTime = ref(false)

function handleMarkPaid(e: Event, payment: Payment) {
  e.stopPropagation()
  markPaidTarget.value = payment
  markPaidAmount.value = Math.round(payment.amount)
  markPaidOnTime.value = false
  markPaidDialog.value = true
}

async function confirmMarkPaid() {
  if (!markPaidTarget.value) return
  markPaidLoading.value = true
  try {
    const amount = markPaidAmount.value && markPaidAmount.value !== markPaidTarget.value.amount
      ? markPaidAmount.value : undefined
    await paymentsStore.markAsPaid(markPaidTarget.value.id, markPaidTarget.value.dealId, {
      amount,
      onTime: markPaidOnTime.value || undefined,
    })
    toast.success('Платёж отмечен как оплаченный')
    markPaidDialog.value = false
    markPaidTarget.value = null
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при отметке оплаты')
  } finally {
    markPaidLoading.value = false
  }
}

const unpaidLoading = ref<string | null>(null)

async function handleUnmarkPaid(e: Event, payment: Payment) {
  e.stopPropagation()
  unpaidLoading.value = payment.id
  try {
    await paymentsStore.unmarkPaid(payment.id, payment.dealId)
    toast.success('Оплата отменена')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при отмене оплаты')
  } finally {
    unpaidLoading.value = null
  }
}

function openReschedule(e: Event, payment: Payment) {
  e.stopPropagation()
  reschedulePaymentRef.value = payment
  const d = new Date(payment.dueDate)
  d.setDate(d.getDate() + 7)
  rescheduleDate.value = d.toISOString().slice(0, 10)
  rescheduleReason.value = ''
  rescheduleDialog.value = true
}

const minRescheduleDate = computed(() => {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.toISOString().slice(0, 10)
})

async function confirmReschedule() {
  if (!reschedulePaymentRef.value || !rescheduleDate.value) return
  try {
    await paymentsStore.reschedulePayment(
      reschedulePaymentRef.value.id,
      reschedulePaymentRef.value.dealId,
      new Date(rescheduleDate.value).toISOString(),
      rescheduleReason.value || undefined,
    )
    toast.success('Платёж перенесён')
    rescheduleDialog.value = false
    reschedulePaymentRef.value = null
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при переносе платежа')
  }
}

const rescheduleReasonOptions = [
  'Клиент попросил отсрочку',
  'Задержка зарплаты клиента',
  'По договорённости сторон',
  'Другая причина',
]
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Page loader -->
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
    <!-- Summary stats -->
    <div class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
          <v-icon icon="mdi-cash-multiple" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ activePayments.length }}</div>
          <div class="stat-label">Текущих платежей</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
          <v-icon icon="mdi-clock-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(paymentsStore.pendingPayments.reduce((s, p) => s + p.amount, 0)) }}</div>
          <div class="stat-label">Ожидается</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
          <v-icon icon="mdi-alert-circle-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ paymentsStore.overduePayments.length }}</div>
          <div class="stat-label">Просрочено</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-check-circle-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(paymentsStore.paidPayments.reduce((s, p) => s + p.amount, 0)) }}</div>
          <div class="stat-label">Получено</div>
        </div>
      </div>
    </div>

    <!-- View mode toggle -->
    <div class="d-flex ga-2 mb-4 align-center">
      <v-tooltip v-if="!subscription.canAccess('whatsapp')" text="Доступно с плана Стандарт" location="bottom">
        <template #activator="{ props: tip }">
          <button
            class="btn-whatsapp btn-whatsapp--locked"
            v-bind="tip"
            @click="router.push({ path: '/settings', query: { tab: 'subscription' } })"
          >
            <v-icon icon="mdi-whatsapp" size="18" />
            Напомнить всем
            <v-icon icon="mdi-crown" size="14" class="btn-whatsapp-crown" />
          </button>
        </template>
      </v-tooltip>
      <button v-else class="btn-whatsapp" :disabled="sendingBulk" @click="sendBulkReminders">
        <v-progress-circular v-if="sendingBulk" indeterminate size="14" width="2" color="white" />
        <v-icon v-else icon="mdi-whatsapp" size="18" />
        {{ sendingBulk ? 'Рассылка...' : 'Напомнить всем' }}
      </button>
      <v-spacer />
      <!-- Co-investor filter -->
      <v-menu v-if="ciList.length > 0" :close-on-content-click="true">
        <template #activator="{ props: cp }">
          <button v-bind="cp" class="pf-folder-btn" :class="{ 'pf-folder-btn--active': filterCoInvestor }">
            <v-icon icon="mdi-account-group-outline" size="15" />
            <template v-if="filterCoInvestorObj">
              {{ filterCoInvestorObj.name }}
            </template>
            <template v-else>Со-инвестор</template>
            <v-icon icon="mdi-chevron-down" size="13" style="opacity: 0.4;" />
          </button>
        </template>
        <v-card rounded="lg" elevation="4" class="pf-folder-menu">
          <div class="pf-folder-header">
            <span>Со-инвесторы</span>
          </div>
          <div class="pf-folder-body">
            <button class="pf-folder-item" :class="{ 'pf-folder-item--active': !filterCoInvestor }" @click="filterCoInvestor = null">
              <v-icon icon="mdi-view-list" size="18" style="color: rgba(var(--v-theme-on-surface), 0.35);" />
              <span class="pf-folder-item-name">Все платежи</span>
            </button>
            <div class="pf-folder-divider" />
            <button
              v-for="ci in ciList"
              :key="ci.id"
              class="pf-folder-item"
              :class="{ 'pf-folder-item--active': filterCoInvestor === ci.id }"
              @click="filterCoInvestor = filterCoInvestor === ci.id ? null : ci.id"
            >
              <v-icon icon="mdi-account-outline" size="14" style="color: rgba(var(--v-theme-on-surface), 0.45);" />
              <span class="pf-folder-item-name">{{ ci.name }}</span>
            </button>
          </div>
        </v-card>
      </v-menu>

      <!-- Staff assignee filter -->
      <v-menu v-if="authStore.isOwner && staffList.length > 0" :close-on-content-click="true">
        <template #activator="{ props: sp }">
          <button v-bind="sp" class="pf-folder-btn" :class="{ 'pf-folder-btn--active': filterStaff }">
            <v-icon icon="mdi-account-tie-outline" size="15" />
            <template v-if="filterStaffObj">
              {{ filterStaffObj.firstName }} {{ filterStaffObj.lastName }}
            </template>
            <template v-else>Сотрудник</template>
            <v-icon icon="mdi-chevron-down" size="13" style="opacity: 0.4;" />
          </button>
        </template>
        <v-card rounded="lg" elevation="4" class="pf-folder-menu">
          <div class="pf-folder-header">
            <span>Ответственные</span>
          </div>
          <div class="pf-folder-body">
            <button class="pf-folder-item" :class="{ 'pf-folder-item--active': !filterStaff }" @click="filterStaff = null">
              <v-icon icon="mdi-view-list" size="18" style="color: rgba(var(--v-theme-on-surface), 0.35);" />
              <span class="pf-folder-item-name">Все платежи</span>
            </button>
            <div class="pf-folder-divider" />
            <button
              v-for="s in staffList"
              :key="s.id"
              class="pf-folder-item"
              :class="{ 'pf-folder-item--active': filterStaff === s.id }"
              @click="filterStaff = filterStaff === s.id ? null : s.id"
            >
              <v-icon icon="mdi-account-outline" size="14" style="color: rgba(var(--v-theme-on-surface), 0.45);" />
              <span class="pf-folder-item-name">{{ s.firstName }} {{ s.lastName }}</span>
            </button>
          </div>
        </v-card>
      </v-menu>

      <!-- Folder filter -->
      <v-menu :close-on-content-click="false">
        <template #activator="{ props: fp }">
          <button v-bind="fp" class="pf-folder-btn" :class="{ 'pf-folder-btn--active': filterFolder }">
            <v-icon icon="mdi-folder-outline" size="15" />
            <template v-if="filterFolder">
              <span class="pf-folder-dot" :style="{ background: folders.find(f => f.id === filterFolder)?.color || '#6366f1' }" />
              {{ folders.find(f => f.id === filterFolder)?.name || 'Папка' }}
            </template>
            <template v-else>Папки</template>
            <v-icon icon="mdi-chevron-down" size="13" style="opacity: 0.4;" />
          </button>
        </template>
        <v-card rounded="lg" elevation="4" class="pf-folder-menu">
          <div class="pf-folder-header">
            <span>Папки</span>
          </div>
          <div class="pf-folder-body">
            <button class="pf-folder-item" :class="{ 'pf-folder-item--active': !filterFolder }" @click="filterFolder = null">
              <v-icon icon="mdi-view-list" size="18" style="color: rgba(var(--v-theme-on-surface), 0.35);" />
              <span class="pf-folder-item-name">Все платежи</span>
            </button>
            <div v-if="folders.length" class="pf-folder-divider" />
            <button
              v-for="f in folders" :key="f.id"
              class="pf-folder-item" :class="{ 'pf-folder-item--active': filterFolder === f.id }"
              @click="filterFolder = filterFolder === f.id ? null : f.id"
            >
              <span class="pf-folder-dot" :style="{ background: f.color }" />
              <span class="pf-folder-item-name">{{ f.name }}</span>
            </button>
            <div class="pf-folder-divider" />
            <router-link to="/deals" class="pf-folder-hint">
              <v-icon icon="mdi-folder-cog-outline" size="13" />
              Управление папками
            </router-link>
          </div>
        </v-card>
      </v-menu>
      <div class="view-toggle">
        <button class="view-toggle-btn" :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">
          <v-icon icon="mdi-table" size="16" />
          <span class="d-none d-sm-inline">Таблица</span>
        </button>
        <button
          class="view-toggle-btn"
          :class="{
            active: viewMode === 'calendar',
            'view-toggle-btn--locked': !subscription.canAccess('analyticsCharts') && viewMode !== 'calendar',
          }"
          @click="viewMode = 'calendar'"
        >
          <v-icon icon="mdi-calendar-month" size="16" />
          <span class="d-none d-sm-inline">Календарь</span>
          <v-icon v-if="!subscription.canAccess('analyticsCharts')" icon="mdi-crown" size="14" class="view-toggle-crown" />
        </button>
      </div>
    </div>

    <!-- CALENDAR VIEW -->
    <template v-if="viewMode === 'calendar'">
      <div class="cal-section" :class="{ 'cal-section--locked': !subscription.canAccess('analyticsCharts') }">
      <div v-if="!subscription.canAccess('analyticsCharts')" class="cal-overlay" @click="router.push({ path: '/settings', query: { tab: 'subscription' } })">
        <div class="cal-overlay-content">
          <div class="cal-overlay-icon">
            <v-icon icon="mdi-crown" size="24" />
          </div>
          <div class="cal-overlay-title">Календарь платежей</div>
          <div class="cal-overlay-text">Визуальный календарь с платежами по дням доступен с плана Бизнес</div>
          <button class="cal-overlay-btn">
            Перейти на план
            <v-icon icon="mdi-arrow-right" size="16" />
          </button>
        </div>
      </div>
      <v-row>
        <v-col :cols="12" :lg="calendarScale === 'month' ? 8 : 12">
          <v-card rounded="lg" elevation="0" border>
            <div class="pa-4">
              <!-- Scale toggle + navigation -->
              <div class="d-flex align-center justify-space-between mb-4">
                <div class="d-flex align-center ga-2">
                  <button class="cal-nav-btn" @click="calendarScale === 'month' ? prevMonth() : prevYear()">
                    <v-icon icon="mdi-chevron-left" size="20" />
                  </button>
                  <div class="cal-month-title" style="cursor: pointer;" @click="calendarScale === 'month' ? calendarScale = 'year' : undefined">
                    <template v-if="calendarScale === 'month'">{{ MONTH_NAMES[calendarMonth] }} {{ calendarYear }}</template>
                    <template v-else>{{ calendarYear }}</template>
                  </div>
                  <button class="cal-nav-btn" @click="calendarScale === 'month' ? nextMonth() : nextYear()">
                    <v-icon icon="mdi-chevron-right" size="20" />
                  </button>
                </div>

                <div class="cal-scale-toggle">
                  <button class="cal-scale-btn" :class="{ active: calendarScale === 'month' }" @click="calendarScale = 'month'">
                    <v-icon icon="mdi-calendar-month" size="16" />
                    <span class="d-none d-sm-inline">Месяц</span>
                  </button>
                  <button class="cal-scale-btn" :class="{ active: calendarScale === 'year' }" @click="calendarScale = 'year'">
                    <v-icon icon="mdi-calendar-text" size="16" />
                    <span class="d-none d-sm-inline">Год</span>
                  </button>
                </div>
              </div>

              <!-- MONTH SCALE -->
              <template v-if="calendarScale === 'month'">
                <!-- Month summary — inline -->
                <div class="cal-month-stats mb-4">
                  <div class="cal-month-stat">
                    <span class="cal-month-stat-dot" style="background: #3b82f6;" />
                    <span class="cal-month-stat-label">Всего</span>
                    <span class="cal-month-stat-value">{{ monthSummary.count }} · {{ formatCurrency(monthSummary.total) }}</span>
                  </div>
                  <div class="cal-month-stat">
                    <span class="cal-month-stat-dot" style="background: #f59e0b;" />
                    <span class="cal-month-stat-label">Ожидается</span>
                    <span class="cal-month-stat-value">{{ formatCurrency(monthSummary.pending) }}</span>
                  </div>
                  <div class="cal-month-stat">
                    <span class="cal-month-stat-dot" style="background: #ef4444;" />
                    <span class="cal-month-stat-label">Просрочено</span>
                    <span class="cal-month-stat-value" :style="{ color: monthSummary.overdue ? '#ef4444' : undefined }">{{ formatCurrency(monthSummary.overdue) }}</span>
                  </div>
                  <div class="cal-month-stat">
                    <span class="cal-month-stat-dot" style="background: #047857;" />
                    <span class="cal-month-stat-label">Оплачено</span>
                    <span class="cal-month-stat-value" style="color: #047857;">{{ formatCurrency(monthSummary.paid) }}</span>
                  </div>
                </div>

                <!-- Weekday headers -->
                <div class="cal-grid cal-header">
                  <div v-for="w in WEEKDAYS" :key="w" class="cal-weekday">{{ w }}</div>
                </div>

                <!-- Days grid -->
                <div class="cal-grid">
                  <div
                    v-for="(day, idx) in calendarDays"
                    :key="idx"
                    class="cal-day"
                    :class="{
                      'cal-day--other': !day.isCurrentMonth,
                      'cal-day--today': day.isToday,
                      'cal-day--has-payments': day.payments.length > 0,
                      'cal-day--selected': selectedCalendarDate === day.dateKey,
                      'cal-day--overdue': day.hasOverdue && day.isCurrentMonth,
                    }"
                    @click="selectDay(day)"
                  >
                    <span class="cal-day-num">{{ day.day }}</span>
                    <div v-if="day.payments.length && day.isCurrentMonth" class="cal-day-dots">
                      <span
                        v-for="(p, pi) in day.payments.slice(0, 3)"
                        :key="pi"
                        class="cal-dot"
                        :style="{ background: p.status === 'OVERDUE' ? '#ef4444' : p.status === 'PAID' ? '#047857' : '#f59e0b' }"
                      />
                    </div>
                    <div v-if="day.payments.length && day.isCurrentMonth" class="cal-day-amount">
                      {{ day.totalAmount >= 1000 ? Math.round(day.totalAmount / 1000) + 'k' : day.totalAmount }}
                    </div>
                  </div>
                </div>
              </template>

              <!-- YEAR SCALE -->
              <template v-else>
                <!-- Year summary -->
                <div class="cal-month-stats mb-4">
                  <div class="cal-month-stat">
                    <span class="cal-month-stat-dot" style="background: #3b82f6;" />
                    <span class="cal-month-stat-label">Всего за год</span>
                    <span class="cal-month-stat-value">{{ yearSummary.count }} · {{ formatCurrency(yearSummary.total) }}</span>
                  </div>
                  <div class="cal-month-stat">
                    <span class="cal-month-stat-dot" style="background: #f59e0b;" />
                    <span class="cal-month-stat-label">Ожидается</span>
                    <span class="cal-month-stat-value">{{ formatCurrency(yearSummary.pending) }}</span>
                  </div>
                  <div class="cal-month-stat">
                    <span class="cal-month-stat-dot" style="background: #ef4444;" />
                    <span class="cal-month-stat-label">Просрочено</span>
                    <span class="cal-month-stat-value" :style="{ color: yearSummary.overdue ? '#ef4444' : undefined }">{{ formatCurrency(yearSummary.overdue) }}</span>
                  </div>
                  <div class="cal-month-stat">
                    <span class="cal-month-stat-dot" style="background: #047857;" />
                    <span class="cal-month-stat-label">Оплачено</span>
                    <span class="cal-month-stat-value" style="color: #047857;">{{ formatCurrency(yearSummary.paid) }}</span>
                  </div>
                </div>

                <!-- 12 mini-months grid -->
                <div class="year-grid">
                  <div
                    v-for="m in yearMonths"
                    :key="m.monthIndex"
                    class="year-month-card"
                    :class="{ 'year-month-card--has-overdue': m.hasOverdue }"
                  >
                    <div class="year-month-header" @click="goToMonthFromYear(m.monthIndex)">
                      <span class="year-month-name">{{ m.name }}</span>
                      <span v-if="m.paymentCount" class="year-month-badge">
                        {{ m.paymentCount }}
                      </span>
                    </div>
                    <div v-if="m.totalAmount" class="year-month-total">
                      {{ formatCurrency(m.totalAmount) }}
                    </div>
                    <!-- Mini weekday headers -->
                    <div class="mini-cal-grid mini-cal-header">
                      <div v-for="(w, wi) in ['П', 'В', 'С', 'Ч', 'П', 'С', 'В']" :key="wi" class="mini-weekday">{{ w }}</div>
                    </div>
                    <!-- Mini days -->
                    <div class="mini-cal-grid">
                      <div
                        v-for="(d, di) in m.days"
                        :key="di"
                        class="mini-day"
                        :class="{
                          'mini-day--other': !d.isCurrentMonth,
                          'mini-day--today': d.isToday,
                          'mini-day--has-payment': d.paymentCount > 0 && d.isCurrentMonth,
                          'mini-day--overdue': d.hasOverdue && d.isCurrentMonth,
                          'mini-day--paid': d.hasPaid && !d.hasOverdue && !d.hasPending && d.isCurrentMonth,
                          'mini-day--pending': d.hasPending && !d.hasOverdue && d.isCurrentMonth,
                          'mini-day--selected': selectedCalendarDate === d.dateKey,
                        }"
                        @click="selectYearDay(d)"
                      >
                        {{ d.isCurrentMonth ? d.day : '' }}
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </v-card>
        </v-col>

        <!-- Sidebar — month view only -->
        <v-col v-if="calendarScale === 'month'" cols="12" lg="4">
          <v-card rounded="lg" elevation="0" border class="position-sticky" style="top: 80px;">
            <div class="pa-4">
              <!-- Selected date -->
              <template v-if="selectedCalendarDate">
                <div class="d-flex align-center justify-space-between mb-3">
                  <div>
                    <div class="text-body-2 font-weight-bold">{{ formatSelectedDate(selectedCalendarDate) }}</div>
                    <div class="text-caption text-medium-emphasis">
                      {{ selectedDatePayments.length }} {{ selectedDatePayments.length === 1 ? 'платёж' : 'платежей' }}
                    </div>
                  </div>
                  <button class="dialog-close-sm" @click="selectedCalendarDate = null">
                    <v-icon icon="mdi-close" size="16" />
                  </button>
                </div>

                <div class="cal-payments-list">
                  <div
                    v-for="p in selectedDatePayments"
                    :key="p.id"
                    class="cal-payment-item"
                    @click="openDealFromPayment(p)"
                  >
                    <div class="d-flex align-center justify-space-between mb-2">
                      <span class="font-weight-medium" style="font-size: 13px;">{{ p._dealName }}</span>
                      <div
                        class="payment-status-chip"
                        :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])"
                      >
                        {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                      </div>
                    </div>
                    <div class="d-flex align-center justify-space-between">
                      <span class="text-caption text-medium-emphasis">{{ p._clientName }} <span v-if="p._isExternal" class="external-badge">Внешний</span></span>
                      <span class="font-weight-bold" style="font-size: 15px;">{{ formatCurrency(p.amount) }}</span>
                    </div>
                    <div class="d-flex ga-1 mt-2" v-if="p.status === 'PENDING' || p.status === 'OVERDUE'">
                      <button class="action-btn action-btn--success" style="width: 26px; height: 26px;" @click.stop="handleMarkPaid($event, p)">
                        <v-icon icon="mdi-check" size="14" />
                      </button>
                      <button class="action-btn action-btn--warning" style="width: 26px; height: 26px;" @click.stop="openReschedule($event, p)">
                        <v-icon icon="mdi-calendar-arrow-right" size="14" />
                      </button>
                    </div>
                    <div class="d-flex ga-1 mt-2" v-else-if="p.status === 'PAID'">
                      <button class="action-btn action-btn--danger" style="width: 26px; height: 26px;" :disabled="unpaidLoading === p.id" @click.stop="handleUnmarkPaid($event, p)">
                        <v-progress-circular v-if="unpaidLoading === p.id" indeterminate size="10" width="2" />
                        <v-icon v-else icon="mdi-undo" size="14" />
                      </button>
                    </div>
                  </div>
                </div>
              </template>

              <!-- Empty state — no date selected -->
              <template v-else>
                <div class="cal-sidebar-empty">
                  <div class="cal-sidebar-empty-icon">
                    <v-icon icon="mdi-cursor-default-click" size="28" />
                  </div>
                  <div class="cal-sidebar-empty-title">Выберите день</div>
                  <div class="cal-sidebar-empty-text">Нажмите на выделенный день в календаре, чтобы увидеть платежи</div>

                  <!-- Legend -->
                  <div class="cal-legend">
                    <div class="cal-legend-item">
                      <span class="cal-legend-dot" style="background: #f59e0b;" />
                      <span>Ожидается</span>
                    </div>
                    <div class="cal-legend-item">
                      <span class="cal-legend-dot" style="background: #ef4444;" />
                      <span>Просрочено</span>
                    </div>
                    <div class="cal-legend-item">
                      <span class="cal-legend-dot" style="background: #047857;" />
                      <span>Оплачено</span>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Year view — date detail dialog -->
      <v-dialog v-if="calendarScale === 'year'" :model-value="!!selectedCalendarDate" @update:model-value="v => { if (!v) selectedCalendarDate = null }" max-width="440">
        <v-card v-if="selectedCalendarDate" rounded="lg">
          <div class="pa-5">
            <div class="d-flex align-center justify-space-between mb-3">
              <div>
                <div class="text-body-2 font-weight-bold">{{ formatSelectedDate(selectedCalendarDate) }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ selectedDatePayments.length }} {{ selectedDatePayments.length === 1 ? 'платёж' : 'платежей' }}
                </div>
              </div>
              <button class="dialog-close-sm" @click="selectedCalendarDate = null">
                <v-icon icon="mdi-close" size="16" />
              </button>
            </div>

            <div class="cal-payments-list">
              <div
                v-for="p in selectedDatePayments"
                :key="p.id"
                class="cal-payment-item"
                @click="selectedCalendarDate = null; openDealFromPayment(p)"
              >
                <div class="d-flex align-center justify-space-between mb-2">
                  <span class="font-weight-medium" style="font-size: 13px;">{{ p._dealName }}</span>
                  <div
                    class="payment-status-chip"
                    :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])"
                  >
                    {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                  </div>
                </div>
                <div class="d-flex align-center justify-space-between">
                  <span class="text-caption text-medium-emphasis">{{ p._clientName }} <span v-if="p._isExternal" class="external-badge">Внешний</span></span>
                  <span class="font-weight-bold" style="font-size: 15px;">{{ formatCurrency(p.amount) }}</span>
                </div>
                <div class="d-flex ga-1 mt-2" v-if="p.status === 'PENDING' || p.status === 'OVERDUE'">
                  <button class="action-btn action-btn--success" style="width: 26px; height: 26px;" @click.stop="handleMarkPaid($event, p)">
                    <v-icon icon="mdi-check" size="14" />
                  </button>
                  <button class="action-btn action-btn--warning" style="width: 26px; height: 26px;" @click.stop="openReschedule($event, p)">
                    <v-icon icon="mdi-calendar-arrow-right" size="14" />
                  </button>
                </div>
                <div class="d-flex ga-1 mt-2" v-else-if="p.status === 'PAID'">
                  <button class="action-btn action-btn--danger" style="width: 26px; height: 26px;" :disabled="unpaidLoading === p.id" @click.stop="handleUnmarkPaid($event, p)">
                    <v-progress-circular v-if="unpaidLoading === p.id" indeterminate size="10" width="2" />
                    <v-icon v-else icon="mdi-undo" size="14" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </v-card>
      </v-dialog>
      </div>
    </template>

    <!-- TABLE VIEW -->
    <v-card v-if="viewMode === 'table'" rounded="lg" elevation="0" border>
      <div class="pa-4">
        <!-- Tabs + search -->
        <div class="d-flex flex-wrap ga-2 align-center mb-4">
          <div class="d-flex ga-2">
            <button
              v-for="(f, i) in [
                { label: 'Текущие', count: activePayments.length },
                { label: 'Ожидаемые', count: paymentsStore.pendingPayments.length },
                { label: 'Просроченные', count: paymentsStore.overduePayments.length },
                { label: 'Оплаченные', count: paymentsStore.paidPayments.length },
                { label: 'Все', count: paymentsStore.allPaymentsFlat.length },
              ]"
              :key="i"
              class="tab-btn"
              :class="{ active: tab === i }"
              @click="tab = i"
            >
              {{ f.label }}
              <span class="tab-count">{{ f.count }}</span>
            </button>
          </div>

          <v-spacer class="d-none d-md-block" />

          <v-menu :close-on-content-click="false">
            <template #activator="{ props: menuProps }">
              <button v-bind="menuProps" class="month-filter-btn">
                <v-icon icon="mdi-calendar-month-outline" size="16" />
                {{ filterMonth ? filterMonthLabel + ' ' + filterMonth.split('-')[0] : 'Все месяцы' }}
                <span v-if="filterMonth" class="month-filter-clear" @click.stop="filterMonth = null">
                  <v-icon icon="mdi-close" size="12" />
                </span>
                <v-icon v-else icon="mdi-chevron-down" size="14" />
              </button>
            </template>
            <v-card rounded="xl" elevation="4" class="month-menu">
              <!-- Year selector -->
              <div class="month-menu-year">
                <button class="month-menu-year-btn" @click="filterYear--">
                  <v-icon icon="mdi-chevron-left" size="18" />
                </button>
                <span class="month-menu-year-label">{{ filterYear }}</span>
                <button class="month-menu-year-btn" @click="filterYear++">
                  <v-icon icon="mdi-chevron-right" size="18" />
                </button>
              </div>

              <!-- Month grid -->
              <div class="month-menu-grid">
                <button
                  v-for="(name, i) in MONTH_NAMES"
                  :key="i"
                  class="month-menu-cell"
                  :class="{
                    active: filterMonth === `${filterYear}-${String(i + 1).padStart(2, '0')}`,
                    'has-data': monthPaymentCounts[`${filterYear}-${String(i + 1).padStart(2, '0')}`] > 0,
                  }"
                  @click="filterMonth = `${filterYear}-${String(i + 1).padStart(2, '0')}`"
                >
                  <span class="month-menu-cell-name">{{ name.slice(0, 3) }}</span>
                  <span v-if="monthPaymentCounts[`${filterYear}-${String(i + 1).padStart(2, '0')}`]" class="month-menu-cell-count">
                    {{ monthPaymentCounts[`${filterYear}-${String(i + 1).padStart(2, '0')}`] }}
                  </span>
                </button>
              </div>

              <!-- Reset -->
              <div class="month-menu-footer">
                <button class="month-menu-reset" @click="filterMonth = null">
                  Сбросить фильтр
                </button>
              </div>
            </v-card>
          </v-menu>

          <div class="filter-input-wrap" style="max-width: 280px; min-width: 160px;">
            <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
            <input
              v-model="search"
              type="text"
              placeholder="Поиск по сделке или клиенту..."
              class="filter-input"
            />
          </div>
        </div>

        <!-- Month filter notice -->
        <div v-if="filterMonth" class="month-filter-notice">
          <v-icon icon="mdi-filter-outline" size="15" />
          <span>Показаны платежи за <strong>{{ filterMonthLabel }} {{ filterMonth.split('-')[0] }}</strong></span>
          <span class="month-filter-notice-count">{{ displayedPayments.length }} из {{ paymentsStore.allPaymentsFlat.length }}</span>
          <button class="month-filter-notice-clear" @click="filterMonth = null">
            Показать все
            <v-icon icon="mdi-close" size="12" />
          </button>
        </div>

        <!-- Table -->
        <v-table v-if="displayedPayments.length" density="comfortable" hover class="payments-table">
          <thead>
            <tr>
              <th class="th-index">№</th>
              <th class="sortable-th" @click="toggleSort('deal')">
                Сделка
                <v-icon :icon="sortIcon('deal')" size="14" class="sort-icon" :class="{ active: sortField === 'deal' }" />
              </th>
              <th class="sortable-th" @click="toggleSort('client')">
                Клиент
                <v-icon :icon="sortIcon('client')" size="14" class="sort-icon" :class="{ active: sortField === 'client' }" />
              </th>
              <th class="sortable-th text-right" @click="toggleSort('amount')">
                Сумма
                <v-icon :icon="sortIcon('amount')" size="14" class="sort-icon" :class="{ active: sortField === 'amount' }" />
              </th>
              <th class="sortable-th" @click="toggleSort('dueDate')">
                Дата
                <v-icon :icon="sortIcon('dueDate')" size="14" class="sort-icon" :class="{ active: sortField === 'dueDate' }" />
              </th>
              <th>Срок</th>
              <th class="sortable-th" @click="toggleSort('status')">
                Статус
                <v-icon :icon="sortIcon('status')" size="14" class="sort-icon" :class="{ active: sortField === 'status' }" />
              </th>
              <th class="text-center">Действия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, idx) in displayedPayments" :key="p.id" class="clickable-row" @click="openDealFromPayment(p)">
              <td class="td-index">{{ idx + 1 }}</td>
              <td>
                <span class="font-weight-medium">{{ getDealName(p) }}</span>
              </td>
              <td class="text-medium-emphasis">
                {{ getClientName(p) }}
                <span v-if="!getDealForPayment(p)?.client && !getDealForPayment(p)?.clientProfile?.userId" class="external-badge">Внешний</span>
              </td>
              <td class="text-right text-no-wrap">
                <span class="font-weight-bold">{{ formatCurrency(p.amount) }}</span>
                <span class="payment-of-total">{{ p.number }} из {{ getDealForPayment(p)?.numberOfPayments || '?' }}</span>
              </td>
              <td>
                <div>
                  <span>{{ formatDateShort(p.dueDate) }}</span>
                  <div v-if="p.rescheduledFrom" class="rescheduled-hint">
                    <v-icon icon="mdi-calendar-arrow-right" size="12" />
                    <span>с {{ formatDateShort(p.rescheduledFrom) }}</span>
                  </div>
                </div>
              </td>
              <td>
                <span :class="{ 'text-error font-weight-medium': p.status === 'OVERDUE' || (p.status === 'PENDING' && new Date(p.dueDate) < new Date()) }">
                  {{ p.status === 'PAID' ? '—' : daysUntil(p.dueDate) }}
                </span>
              </td>
              <td>
                <div
                  class="payment-status-chip"
                  :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])"
                >
                  {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                </div>
              </td>
              <td class="text-center">
                <div v-if="p.status === 'PENDING' || p.status === 'OVERDUE'" class="d-flex align-center justify-center ga-1">
                  <v-tooltip text="Отметить оплаченным" location="top">
                    <template #activator="{ props }">
                      <button v-bind="props" class="action-btn action-btn--success" @click="handleMarkPaid($event, p)">
                        <v-icon icon="mdi-check" size="16" />
                      </button>
                    </template>
                  </v-tooltip>
                  <v-tooltip text="Перенести дату" location="top">
                    <template #activator="{ props }">
                      <button v-bind="props" class="action-btn action-btn--warning" @click="openReschedule($event, p)">
                        <v-icon icon="mdi-calendar-arrow-right" size="16" />
                      </button>
                    </template>
                  </v-tooltip>
                </div>
                <div v-else class="d-flex align-center justify-center">
                  <v-tooltip text="Отменить оплату" location="top">
                    <template #activator="{ props }">
                      <button v-bind="props" class="action-btn action-btn--danger" :disabled="unpaidLoading === p.id" @click="handleUnmarkPaid($event, p)">
                        <v-progress-circular v-if="unpaidLoading === p.id" indeterminate size="12" width="2" />
                        <v-icon v-else icon="mdi-undo" size="16" />
                      </button>
                    </template>
                  </v-tooltip>
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>

        <div v-else class="text-center pa-12">
          <v-icon icon="mdi-cash-multiple" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Нет платежей</p>
          <p class="text-body-2 text-medium-emphasis">
            {{ search ? 'Попробуйте изменить параметры поиска' : 'Платежи появятся после создания сделки' }}
          </p>
        </div>
      </div>
    </v-card>

    <!-- /TABLE VIEW -->

    <!-- Deal Detail Dialog -->
    <v-dialog v-model="showDealDialog" max-width="680" scrollable>
      <v-card v-if="selectedDeal" rounded="lg">
        <div class="dialog-hero">
          <button class="dialog-close" @click="showDealDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
          <div class="dialog-hero-photo" :class="{ 'dialog-hero-photo--empty': !selectedDeal.productPhotos?.length }">
            <img v-if="selectedDeal.productPhotos?.[0]" :src="selectedDeal.productPhotos[0]" alt="" />
            <div v-else class="dialog-hero-photo-placeholder">
              <v-icon icon="mdi-image-off-outline" size="28" />
              <span>Нет фото</span>
            </div>
          </div>
          <div class="dialog-hero-content">
            <div
              class="dialog-status"
              :style="{ color: DEAL_STATUS_CONFIG[selectedDeal.status]?.color }"
            >
              <span class="dialog-status-dot" :style="{ background: DEAL_STATUS_CONFIG[selectedDeal.status]?.color }" />
              {{ DEAL_STATUS_CONFIG[selectedDeal.status]?.label }}
            </div>
            <div class="dialog-title">{{ selectedDeal.productName }}</div>
            <div class="dialog-hero-meta">
              <v-icon icon="mdi-account" size="14" />
              {{ selectedDeal.client ? userName(selectedDeal.client) : selectedDeal.clientProfile ? clientProfileName(selectedDeal.clientProfile) : selectedDeal.externalClientName || '—' }}
              <span class="mx-1">·</span>
              Создано {{ formatDate(selectedDeal.createdAt) }}
            </div>
          </div>
        </div>

        <v-card-text class="pa-5">

          <div class="dialog-finance-grid mb-5">
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Закупочная</div>
              <div class="dialog-finance-value">{{ formatCurrency(selectedDeal.purchasePrice) }}</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Итого</div>
              <div class="dialog-finance-value font-weight-bold">{{ formatCurrency(selectedDeal.totalPrice) }}</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Наценка</div>
              <div class="dialog-finance-value" style="color: #047857;">+{{ formatCurrency(selectedDeal.markup) }} ({{ formatPercent(selectedDeal.markupPercent) }})</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Оплачено</div>
              <div class="dialog-finance-value" style="color: #047857;">{{ formatCurrency(selectedDealPaidTotal) }}</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Остаток</div>
              <div class="dialog-finance-value" style="color: #f59e0b;">{{ formatCurrency(selectedDeal.remainingAmount) }}</div>
            </div>
          </div>

          <div class="mb-5">
            <div class="d-flex justify-space-between align-center mb-2">
              <span class="text-body-2 font-weight-medium">Прогресс платежей</span>
              <span class="text-caption text-medium-emphasis">{{ selectedDeal.paidPayments }} из {{ selectedDeal.numberOfPayments }}</span>
            </div>
            <v-progress-linear
              :model-value="getDealProgress(selectedDeal)"
              color="primary"
              rounded
              height="8"
            />
          </div>

          <button class="detail-link-btn mb-5" @click="showDealDialog = false; goToDeal(selectedDeal!)">
            <v-icon icon="mdi-open-in-new" size="16" />
            Открыть полную страницу сделки
          </button>

          <div v-if="selectedDealPayments.length">
            <div class="text-body-2 font-weight-bold mb-3">График платежей</div>
            <div class="schedule-list">
              <div
                v-for="p in selectedDealPayments"
                :key="p.id"
                class="schedule-item"
                :class="{ 'schedule-item--paid': p.status === 'PAID', 'schedule-item--overdue': p.status === 'OVERDUE' }"
              >
                <div class="schedule-num">{{ p.number }}</div>
                <div class="schedule-info">
                  <div class="schedule-date">{{ formatDateShort(p.dueDate) }}</div>
                  <div v-if="p.paidAt" class="schedule-paid-at">Оплачено {{ formatDateShort(p.paidAt) }}</div>
                  <div v-if="p.rescheduledFrom" class="rescheduled-hint">
                    <v-icon icon="mdi-calendar-arrow-right" size="11" />
                    с {{ formatDateShort(p.rescheduledFrom) }}
                  </div>
                </div>
                <div class="schedule-amount">{{ formatCurrency(p.amount) }}</div>
                <div
                  class="schedule-status"
                  :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])"
                >
                  {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                </div>
              </div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Reschedule Dialog -->
    <!-- Mark Paid Dialog -->
    <v-dialog v-model="markPaidDialog" max-width="420">
      <v-card rounded="lg" class="pa-6">
        <div class="text-h6 font-weight-bold mb-1">Отметить оплату</div>
        <div class="text-caption text-medium-emphasis mb-4">Подтвердите получение платежа</div>

        <div v-if="markPaidTarget" class="reschedule-info mb-4">
          <div class="d-flex justify-space-between mb-1">
            <span class="text-caption text-medium-emphasis">Платёж #{{ markPaidTarget.number }}</span>
            <span class="font-weight-bold">{{ formatCurrency(markPaidTarget.amount) }}</span>
          </div>
          <div class="d-flex justify-space-between">
            <span class="text-caption text-medium-emphasis">Срок</span>
            <span>{{ formatDateShort(markPaidTarget.dueDate) }}</span>
          </div>
        </div>

        <div class="mb-4">
          <label class="field-label">Фактическая сумма</label>
          <div style="position: relative;">
            <input :value="markPaidAmount || ''" v-maska="CURRENCY_MASK" @maska="(e: any) => markPaidAmount = parseMasked(e)" type="text" inputmode="numeric" class="field-input" style="padding-right: 36px;" />
            <span style="position: absolute; right: 14px; top: 50%; transform: translateY(-50%); font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.35); pointer-events: none;">₽</span>
          </div>
          <div v-if="markPaidTarget && markPaidAmount && markPaidAmount !== markPaidTarget.amount" class="text-caption mt-1" :style="{ color: markPaidAmount > markPaidTarget.amount ? '#10b981' : '#f59e0b' }">
            {{ markPaidAmount > markPaidTarget.amount ? `Переплата ${formatCurrency(markPaidAmount - markPaidTarget.amount)} — оставшиеся платежи будут пересчитаны` : `Недоплата ${formatCurrency(markPaidTarget.amount - markPaidAmount)}` }}
          </div>
        </div>

        <!-- On-time toggle -->
        <div v-if="markPaidTarget && markPaidTarget.status === 'OVERDUE'" class="ontime-toggle mb-4" :class="{ 'ontime-toggle--active': markPaidOnTime }" @click="markPaidOnTime = !markPaidOnTime">
          <div class="ontime-toggle-icon">
            <v-icon :icon="markPaidOnTime ? 'mdi-check-circle' : 'mdi-clock-alert-outline'" size="18" :color="markPaidOnTime ? '#047857' : '#f59e0b'" />
          </div>
          <div class="ontime-toggle-content">
            <div class="ontime-toggle-title">Оплачено без просрочки</div>
            <div class="ontime-toggle-desc">Не повлияет на рейтинг клиента</div>
          </div>
          <div class="ontime-toggle-switch">
            <div class="ontime-switch-track" :class="{ 'ontime-switch-track--on': markPaidOnTime }">
              <div class="ontime-switch-thumb" />
            </div>
          </div>
        </div>

        <div class="d-flex ga-3 justify-end">
          <button class="btn-secondary" @click="markPaidDialog = false">Отмена</button>
          <button class="btn-primary" :disabled="markPaidLoading || !markPaidAmount" @click="confirmMarkPaid">
            <v-progress-circular v-if="markPaidLoading" indeterminate size="14" width="2" color="white" class="mr-1" />
            {{ markPaidLoading ? 'Оплата...' : 'Подтвердить' }}
          </button>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rescheduleDialog" max-width="440">
      <v-card v-if="reschedulePaymentRef" rounded="lg">
        <div class="pa-5">
          <div class="d-flex align-center justify-space-between mb-4">
            <div class="text-h6 font-weight-bold">Перенос платежа</div>
            <button class="dialog-close-sm" @click="rescheduleDialog = false">
              <v-icon icon="mdi-close" size="18" />
            </button>
          </div>

          <div class="reschedule-info mb-4">
            <div class="reschedule-info-row">
              <span class="reschedule-info-label">Сделка</span>
              <span class="reschedule-info-value">{{ getDealForPayment(reschedulePaymentRef)?.productName || reschedulePaymentRef.dealId }}</span>
            </div>
            <div class="reschedule-info-row">
              <span class="reschedule-info-label">Платёж №{{ reschedulePaymentRef.number }}</span>
              <span class="reschedule-info-value font-weight-bold">{{ formatCurrency(reschedulePaymentRef.amount) }}</span>
            </div>
            <div class="reschedule-info-row">
              <span class="reschedule-info-label">Текущая дата</span>
              <span class="reschedule-info-value" :class="{ 'text-error': reschedulePaymentRef.status === 'OVERDUE' }">
                {{ formatDate(reschedulePaymentRef.dueDate) }}
              </span>
            </div>
          </div>

          <div class="mb-4">
            <label class="field-label">Новая дата</label>
            <input
              v-model="rescheduleDate"
              type="date"
              class="field-input"
              :min="minRescheduleDate"
            />
          </div>

          <div class="mb-5">
            <label class="field-label">Причина переноса</label>
            <div class="d-flex flex-wrap ga-2 mb-2">
              <button
                v-for="r in rescheduleReasonOptions"
                :key="r"
                class="reason-chip"
                :class="{ active: rescheduleReason === r }"
                @click="rescheduleReason = rescheduleReason === r ? '' : r"
              >
                {{ r }}
              </button>
            </div>
            <textarea
              v-if="rescheduleReason === 'Другая причина'"
              v-model="rescheduleReason"
              class="field-input field-textarea"
              placeholder="Укажите причину..."
              rows="2"
            />
          </div>

          <div class="d-flex ga-2">
            <button class="btn-secondary flex-grow-1" @click="rescheduleDialog = false">
              Отмена
            </button>
            <button
              class="btn-primary flex-grow-1"
              :disabled="!rescheduleDate"
              @click="confirmReschedule"
            >
              <v-icon icon="mdi-calendar-arrow-right" size="16" />
              Перенести
            </button>
          </div>
        </div>
      </v-card>
    </v-dialog>
    </template>

    <!-- WhatsApp bulk reminders dialog (preview + per-row selection) -->
    <SendRemindersDialog v-model="showRemindersDialog" />
  </div>
</template>

<style scoped>
/* Stats row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .stats-row { grid-template-columns: 1fr; } }

.stat-card {
  display: flex; align-items: center; gap: 12px;
  padding: 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.stat-icon {
  width: 40px; height: 40px; min-width: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.stat-value {
  font-size: 18px; font-weight: 700; line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.stat-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Tab buttons */
.tab-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 20px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.tab-btn:hover { background: rgba(var(--v-theme-primary), 0.08); color: rgb(var(--v-theme-primary)); }
.tab-btn.active { background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); font-weight: 600; }
.tab-count {
  font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  line-height: 18px; min-width: 20px; text-align: center;
}
.tab-btn.active .tab-count {
  background: rgba(var(--v-theme-primary), 0.15); color: rgb(var(--v-theme-primary));
}

/* Filter inputs */
.filter-input-wrap { position: relative; flex: 1; }
.filter-input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #9ca3af; pointer-events: none;
}
.filter-input {
  width: 100%; height: 40px; padding: 0 16px 0 38px;
  border: 1px solid #e4e4e7; border-radius: 10px;
  background: #f4f4f5; font-size: 14px; color: inherit;
  outline: none; transition: all 0.15s ease;
}
.filter-input::placeholder { color: #9ca3af; }
.filter-input:focus {
  border-color: #047857; background: #fff;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}

/* Table */
.payments-table :deep(td) { font-size: 14px; }
.payments-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}

.th-index {
  width: 40px; padding-left: 12px !important; padding-right: 4px !important;
}
.td-index {
  width: 40px; padding-left: 12px !important; padding-right: 4px !important;
  color: rgba(var(--v-theme-on-surface), 0.35);
  font-size: 12px !important;
}
.payment-of-total {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 1px;
}
.sortable-th {
  cursor: pointer; user-select: none; white-space: nowrap;
}
.sortable-th:hover {
  color: rgba(var(--v-theme-on-surface), 0.8) !important;
}
.sort-icon {
  opacity: 0.3; margin-left: 2px; vertical-align: middle;
  transition: opacity 0.15s;
}
.sort-icon.active {
  opacity: 1; color: rgb(var(--v-theme-primary));
}

.clickable-row {
  cursor: pointer;
}
.clickable-row:hover td {
  background: rgba(var(--v-theme-primary), 0.03);
}

.payment-status-chip {
  display: inline-block; font-size: 11px; font-weight: 600;
  padding: 4px 10px; border-radius: 6px; white-space: nowrap;
}

.rescheduled-hint {
  display: flex; align-items: center; gap: 3px;
  font-size: 11px; color: #f59e0b; margin-top: 1px;
}

/* Action buttons */
.action-btn {
  width: 30px; height: 30px; border-radius: 8px; border: none;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.action-btn--success {
  background: rgba(4, 120, 87, 0.1); color: #047857;
}
.action-btn--success:hover {
  background: rgba(4, 120, 87, 0.2);
}
.action-btn--warning {
  background: rgba(245, 158, 11, 0.1); color: #f59e0b;
}
.action-btn--warning:hover {
  background: rgba(245, 158, 11, 0.2);
}
.action-btn--danger {
  background: rgba(239, 68, 68, 0.1); color: #ef4444;
}
.action-btn--danger:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* On-time toggle */
.ontime-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
  user-select: none;
}
.ontime-toggle:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.ontime-toggle--active {
  border-color: rgba(4, 120, 87, 0.3);
  background: rgba(4, 120, 87, 0.04);
}
.ontime-toggle-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ontime-toggle--active .ontime-toggle-icon {
  background: rgba(4, 120, 87, 0.1);
}
.ontime-toggle-content {
  flex: 1;
  min-width: 0;
}
.ontime-toggle-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.87);
  line-height: 1.3;
}
.ontime-toggle-desc {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  line-height: 1.3;
  margin-top: 1px;
}
.ontime-switch-track {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.15);
  position: relative;
  transition: background 0.2s ease;
  flex-shrink: 0;
}
.ontime-switch-track--on {
  background: #047857;
}
.ontime-switch-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.ontime-switch-track--on .ontime-switch-thumb {
  transform: translateX(16px);
}

/* Deal Dialog */
.dialog-hero {
  position: relative;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  display: flex; gap: 16px; align-items: stretch;
  padding: 20px 24px;
  min-height: 160px;
}
.dialog-close {
  position: absolute; top: 12px; right: 12px; z-index: 3;
  width: 30px; height: 30px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
  backdrop-filter: blur(8px);
}
.dialog-close:hover { background: rgba(255, 255, 255, 0.3); }
.dialog-edit {
  position: absolute; top: 12px; right: 52px; z-index: 3;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 11px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.2);
  color: #fff; font-size: 12px; font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.15s;
}
.dialog-edit:hover { background: rgba(255, 255, 255, 0.3); }
.dialog-hero-photo {
  flex-shrink: 0;
  width: 120px; height: 120px;
  border-radius: 12px; overflow: hidden;
  align-self: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.dialog-hero-photo img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.dialog-hero-photo--empty {
  display: flex; align-items: center; justify-content: center;
}
.dialog-hero-photo-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  color: rgba(255, 255, 255, 0.55); font-size: 10px;
}
.dialog-hero-content {
  flex: 1; min-width: 0; color: #fff;
  display: flex; flex-direction: column; justify-content: flex-start;
  padding-right: 44px; /* room for close button */
}
.dialog-status {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  font-size: 11px; font-weight: 600;
  padding: 4px 10px; border-radius: 999px;
  background: #fff; margin-bottom: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.dialog-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.dialog-title {
  font-size: 20px; font-weight: 700; color: #fff; line-height: 1.25;
  margin-bottom: 6px; word-break: break-word;
}
.dialog-hero-meta {
  font-size: 12px; opacity: 0.85;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  margin-top: auto;
}
.dialog-avatar {
  width: 36px; height: 36px; min-width: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 14px;
}

.dialog-finance-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 600px) { .dialog-finance-grid { grid-template-columns: repeat(2, 1fr); } }
.dialog-finance-item {
  padding: 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.dialog-finance-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 2px;
}
.dialog-finance-value {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Detail link */
.detail-link-btn {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 10px 16px; border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.04);
  color: rgb(var(--v-theme-primary));
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  justify-content: center;
}
.detail-link-btn:hover {
  background: rgba(var(--v-theme-primary), 0.1);
  border-color: rgba(var(--v-theme-primary), 0.5);
}

/* Schedule */
.schedule-list { display: flex; flex-direction: column; gap: 4px; }
.schedule-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 8px;
  transition: background 0.15s;
}
.schedule-item:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.schedule-item--paid { opacity: 0.65; }
.schedule-item--overdue { background: rgba(239, 68, 68, 0.04); }
.schedule-num {
  width: 24px; height: 24px; min-width: 24px;
  border-radius: 6px; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.schedule-info { flex: 1; min-width: 0; }
.schedule-date {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.schedule-paid-at {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.schedule-amount {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
}
.schedule-status {
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px; white-space: nowrap;
}

/* Reschedule Dialog */
.dialog-close-sm {
  width: 28px; height: 28px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.dialog-close-sm:hover {
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.reschedule-info {
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-radius: 10px; padding: 12px 16px;
}
.reschedule-info-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 0;
}
.reschedule-info-label {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
}
.reschedule-info-value {
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Form fields */
.field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.field-input {
  width: 100%; height: 42px; padding: 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.03);
  outline: none; transition: all 0.15s;
}
.field-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}
.field-textarea {
  height: auto; padding: 10px 14px; resize: vertical;
}

/* Reason chips */
.reason-chip {
  padding: 6px 12px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.reason-chip:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.reason-chip.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}

/* Buttons */
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 42px; padding: 0 20px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.btn-primary:hover { background: #065f46; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 42px; padding: 0 20px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.btn-secondary:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* View toggle */
.view-toggle {
  display: flex; border-radius: 10px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: #fff;
}
.view-toggle-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px; border: none; background: transparent;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
}
.view-toggle-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.view-toggle-btn.active {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}
.view-toggle-btn--locked {
  opacity: 0.55;
  border: 1px solid rgba(232, 185, 49, 0.35);
  border-radius: 0 8px 8px 0;
}
.view-toggle-btn--locked:hover {
  opacity: 0.75;
  border-color: rgba(232, 185, 49, 0.55);
  background: rgba(232, 185, 49, 0.06);
}
.view-toggle-crown {
  color: #e8b931;
  margin-left: 2px;
}

/* Calendar lock */
.cal-section {
  position: relative;
}
.cal-section--locked {
  pointer-events: none;
  user-select: none;
}
.cal-section--locked > *:not(.cal-overlay) {
  filter: blur(5px);
  opacity: 0.7;
}
.cal-overlay {
  position: absolute; inset: 0; z-index: 2;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 80px;
  pointer-events: auto; cursor: pointer;
  border-radius: 16px;
}
.cal-overlay-content {
  text-align: center; padding: 28px 32px;
  background: #fff;
  border-radius: 18px;
  border: 1px solid rgba(232, 185, 49, 0.3);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.1);
  max-width: 360px;
}
.cal-overlay-icon {
  width: 48px; height: 48px; border-radius: 12px; margin: 0 auto 12px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(232, 185, 49, 0.1);
  color: #e8b931;
}
.cal-overlay-title {
  font-size: 17px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 6px;
}
.cal-overlay-text {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  line-height: 1.5; margin-bottom: 16px;
}
.cal-overlay-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 20px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.cal-overlay-btn:hover { background: #065f46; }

.dark .cal-overlay-content {
  background: #1e1e2e;
  border-color: rgba(232, 185, 49, 0.25);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}
.dark .cal-overlay-icon {
  background: rgba(232, 185, 49, 0.12);
}

/* Calendar */
.cal-nav-btn {
  width: 34px; height: 34px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.6);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.cal-nav-btn:hover { background: rgba(var(--v-theme-primary), 0.1); color: rgb(var(--v-theme-primary)); }

.cal-month-title {
  font-size: 16px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  text-transform: capitalize;
}

/* Month stats inline */
.cal-month-stats {
  display: flex; flex-wrap: wrap; gap: 4px 16px;
  justify-content: space-around;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.cal-month-stat {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px;
}
.cal-month-stat-dot {
  width: 8px; height: 8px; min-width: 8px; border-radius: 50%;
}
.cal-month-stat-label {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.cal-month-stat-value {
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Sidebar empty state */
.cal-sidebar-empty {
  text-align: center; padding: 24px 8px;
}
.cal-sidebar-empty-icon {
  width: 56px; height: 56px; border-radius: 14px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 14px;
}
.cal-sidebar-empty-title {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 6px;
}
.cal-sidebar-empty-text {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  line-height: 1.5; margin-bottom: 20px;
}
.cal-legend {
  display: flex; justify-content: center; gap: 16px;
}
.cal-legend-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
}
.cal-legend-dot {
  width: 8px; height: 8px; border-radius: 50%;
}

.cal-grid {
  display: grid; grid-template-columns: repeat(7, 1fr);
}
.cal-header { margin-bottom: 2px; }
.cal-weekday {
  text-align: center; font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.4);
  padding: 8px 0; text-transform: uppercase;
}

.cal-day {
  position: relative;
  min-height: 80px; padding: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  cursor: default;
  transition: all 0.15s;
  display: flex; flex-direction: column;
}
.cal-day--other {
  opacity: 0.3;
  background: rgba(var(--v-theme-on-surface), 0.01);
}
.cal-day--today {
  border-color: rgb(var(--v-theme-primary));
}
.cal-day--today .cal-day-num {
  background: rgb(var(--v-theme-primary));
  color: #fff; border-radius: 50%;
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 700;
}
.cal-day--has-payments {
  cursor: pointer;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border-color: rgba(var(--v-theme-on-surface), 0.12);
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-on-surface), 0.04);
}
.cal-day--has-payments:hover {
  background: rgba(var(--v-theme-primary), 0.04);
  border-color: rgba(var(--v-theme-primary), 0.25);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.cal-day--selected {
  background: rgba(var(--v-theme-primary), 0.06) !important;
  border-color: rgb(var(--v-theme-primary)) !important;
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.15), 0 2px 8px rgba(0, 0, 0, 0.06) !important;
}
.cal-day--overdue {
  background: rgba(239, 68, 68, 0.03);
  border-color: rgba(239, 68, 68, 0.2);
}
.cal-day--overdue:hover {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.35);
}

.cal-day-num {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.55);
  line-height: 1;
}
.cal-day--has-payments .cal-day-num {
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.cal-day-dots {
  display: flex; gap: 3px; margin-top: 6px;
}
.cal-dot {
  width: 6px; height: 6px; border-radius: 50%;
}

.cal-day-amount {
  font-size: 11px; font-weight: 700; margin-top: auto;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.cal-day--has-payments .cal-day-amount {
  color: rgba(var(--v-theme-on-surface), 0.65);
}

/* Calendar sidebar */
.cal-payments-list {
  display: flex; flex-direction: column; gap: 8px;
}
.cal-payment-item {
  padding: 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  cursor: pointer; transition: all 0.15s;
}
.cal-payment-item:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}

/* Calendar scale toggle */
.cal-scale-toggle {
  display: flex; border-radius: 8px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.cal-scale-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 12px; border: none; background: transparent;
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
}
.cal-scale-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.cal-scale-btn.active {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}

/* Year grid — 12 mini months */
.year-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1280px) { .year-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 960px) { .year-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .year-grid { grid-template-columns: 1fr; } }

.year-month-card {
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
  transition: all 0.15s;
}
.year-month-card:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.year-month-card--has-overdue {
  border-color: rgba(239, 68, 68, 0.15);
}

.year-month-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 4px; cursor: pointer; padding: 2px 0;
}
.year-month-header:hover .year-month-name {
  color: rgb(var(--v-theme-primary));
}
.year-month-name {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
  transition: color 0.15s;
}
.year-month-badge {
  font-size: 10px; font-weight: 700;
  padding: 1px 6px; border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.year-month-total {
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 6px;
}

/* Mini calendar grid */
.mini-cal-grid {
  display: grid; grid-template-columns: repeat(7, 1fr);
}
.mini-cal-header { margin-bottom: 1px; }
.mini-weekday {
  text-align: center; font-size: 9px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.3);
  padding: 2px 0;
}

.mini-day {
  text-align: center;
  font-size: 10px; line-height: 1;
  padding: 3px 1px;
  border-radius: 4px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: default;
  transition: all 0.1s;
}
.mini-day--other {
  visibility: hidden;
}
.mini-day--today {
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-primary));
}
.mini-day--has-payment {
  cursor: pointer;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.mini-day--pending {
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
}
.mini-day--overdue {
  background: rgba(239, 68, 68, 0.15);
  color: #dc2626;
}
.mini-day--paid {
  background: rgba(4, 120, 87, 0.12);
  color: #047857;
}
.mini-day--has-payment:hover {
  transform: scale(1.3);
  z-index: 1;
}
.mini-day--selected {
  background: rgb(var(--v-theme-primary)) !important;
  color: #fff !important;
  font-weight: 700;
}

/* Dark mode */
.dark .cal-summary-card { background: #1e1e2e; border-color: #2e2e42; }
.dark .stat-card { background: #1e1e2e; border-color: #2e2e42; }
.dark .view-toggle { background: #252538; border-color: #2e2e42; }
.dark .view-toggle-btn.active { background: rgba(4, 120, 87, 0.15); }
.dark .cal-scale-toggle { background: #252538; border-color: #2e2e42; }
.dark .cal-scale-btn.active { background: rgba(4, 120, 87, 0.15); }
.dark .year-month-card { background: #1e1e2e; border-color: #2e2e42; }
.dark .mini-day--pending { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
.dark .mini-day--overdue { background: rgba(239, 68, 68, 0.2); color: #f87171; }
.dark .mini-day--paid { background: rgba(4, 120, 87, 0.2); color: #34d399; }
.dark .filter-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .filter-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .field-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .field-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .filter-input::placeholder { color: #71717a; }
.dark .cal-day { border-color: #2e2e42; }
.dark .cal-day--has-payments { border-color: #3e3e52; background: rgba(255, 255, 255, 0.02); }
.dark .cal-payment-item { background: rgba(255, 255, 255, 0.04); }
.dark .cal-month-stats { background: #1e1e2e; border-color: #2e2e42; }
.dark .dialog-finance-item { background: rgba(255, 255, 255, 0.04); }
.dark .reschedule-info { background: #1e1e2e; border-color: #2e2e42; }
.btn-whatsapp {
  display: inline-flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 16px; border-radius: 10px; border: none;
  background: #25d366; color: #fff;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.btn-whatsapp:hover { background: #1da851; }
.btn-whatsapp:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-whatsapp--locked {
  opacity: 0.55;
  border: 1px solid rgba(232, 185, 49, 0.4);
}
.btn-whatsapp--locked:hover {
  opacity: 0.75;
  background: #25d366;
}
.btn-whatsapp-crown {
  color: #e8b931;
}
.external-badge {
  display: inline-flex; padding: 2px 6px; border-radius: 5px;
  background: rgba(99, 102, 241, 0.1); color: #6366f1;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  margin-left: 4px; vertical-align: middle;
}

/* Month filter */
.month-filter-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.12s; white-space: nowrap;
}
.month-filter-btn:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.month-filter-clear {
  width: 20px; height: 20px; border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.4);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.12s; margin-left: 2px;
}
.month-filter-clear:hover { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

.month-menu { padding: 0; width: 320px; overflow: hidden; }
.month-menu-year {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.month-menu-year-label { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.month-menu-year-btn {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.12s;
}
.month-menu-year-btn:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

.month-menu-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 6px; padding: 12px;
}
.month-menu-cell {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 10px 4px; border-radius: 10px; border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.35);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.12s;
}
.month-menu-cell.has-data { color: rgba(var(--v-theme-on-surface), 0.7); }
.month-menu-cell:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.month-menu-cell.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary)); font-weight: 700;
}
.month-menu-cell-name { font-size: 13px; }
.month-menu-cell-count {
  font-size: 10px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.3);
}
.month-menu-cell.active .month-menu-cell-count { color: rgb(var(--v-theme-primary)); }
.month-menu-cell.has-data .month-menu-cell-count { color: rgba(var(--v-theme-on-surface), 0.45); }

.month-menu-footer {
  padding: 8px 12px 12px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.month-menu-reset {
  width: 100%; padding: 8px; border-radius: 8px; border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 12px; font-weight: 500;
  cursor: pointer; transition: all 0.12s;
}
.month-menu-reset:hover { background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.7); }

.month-filter-notice {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; margin-bottom: 12px; border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.06);
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55);
}
.month-filter-notice strong { color: rgba(var(--v-theme-on-surface), 0.8); }
.month-filter-notice-count {
  margin-left: auto; font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.month-filter-notice-clear {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 10px; border-radius: 6px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 11px; font-weight: 500; cursor: pointer;
  transition: all 0.12s; margin-left: 8px;
}
.month-filter-notice-clear:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* Folder filter */
.pf-folder-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 8px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: #fff; color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.12s;
}
.pf-folder-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.2); color: rgba(var(--v-theme-on-surface), 0.8); }
.pf-folder-btn--active {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
  color: rgba(var(--v-theme-on-surface), 0.8); font-weight: 600;
}
.pf-folder-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.pf-folder-menu { width: 220px; padding: 0; overflow: hidden; }
.pf-folder-header {
  display: flex; align-items: center; padding: 12px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  font-size: 13px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.6);
}
.pf-folder-body { padding: 6px; }
.pf-folder-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border-radius: 8px; border: none; background: none;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.65);
  cursor: pointer; text-align: left; transition: background 0.1s;
}
.pf-folder-item:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.pf-folder-item--active {
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}
.pf-folder-item-name { flex: 1; }
.pf-folder-divider { height: 1px; background: rgba(var(--v-theme-on-surface), 0.06); margin: 4px 6px; }
.pf-folder-hint {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; font-size: 11px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.35);
  text-decoration: none; transition: color 0.12s;
}
.pf-folder-hint:hover { color: rgb(var(--v-theme-primary)); }

.dark .pf-folder-header { border-bottom-color: rgba(255,255,255,0.06); }
.dark .pf-folder-btn { background: #252538; border-color: #2e2e42; }
.dark .pf-folder-btn:hover { border-color: #3e3e52; }
.dark .pf-folder-item:hover { background: rgba(255,255,255,0.04); }
.dark .pf-folder-item--active { background: rgba(var(--v-theme-primary), 0.1); }

.dark .month-filter-btn { background: rgba(255,255,255,0.06); }
.dark .month-filter-btn:hover { background: rgba(255,255,255,0.1); }
.dark .month-menu-year { border-color: rgba(255,255,255,0.06); }
.dark .month-menu-year-btn { background: rgba(255,255,255,0.06); }
.dark .month-menu-footer { border-color: rgba(255,255,255,0.06); }
</style>
