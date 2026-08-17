<script lang="ts" setup>
import { usePaymentsStore } from '@/stores/payments'
import { useDealsStore } from '@/stores/deals'
import { formatCurrency, formatDate, formatDateShort, formatPercent, formatPhone, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { PAYMENT_STATUS_CONFIG, DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { type Payment, type Deal, userName, clientProfileName } from '@/types'
import { attributionMonthStr, offMonthKind, monthPrepositional, dueYearMonth, isLivePayment } from '@/utils/paymentAttribution'
import { useRoute, useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useSubscription } from '@/composables/useSubscription'
import { useDealLock } from '@/composables/useDealLock'
import { useFolders } from '@/composables/useFolders'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useSections } from '@/composables/useSections'
import { api } from '@/api/client'
import ServerPager from '@/components/ServerPager.vue'
import MarkPaidDialog from '@/components/MarkPaidDialog.vue'
import ReschedulePaymentDialog from '@/components/ReschedulePaymentDialog.vue'

const router = useRouter()
const route = useRoute()
const { isDark, statusStyle } = useIsDark()

// Reactive mobile detection — used to make dialogs fullscreen on phones.
// Listens for viewport resize, keeps the flag in sync with media-query.
const isMobile = ref(false)
function updateMobile() { isMobile.value = window.innerWidth < 768 }
onMounted(() => {
  updateMobile()
  window.addEventListener('resize', updateMobile)
})
onUnmounted(() => window.removeEventListener('resize', updateMobile))
const toast = useToast()
const subscription = useSubscription()
const paymentsStore = usePaymentsStore()
const dealsStore = useDealsStore()
const { folders, fetchFolders } = useFolders()
const filterFolder = ref<string | null>(null)
const cashBoxesStore = useCashBoxesStore()
const { items: cashBoxes } = storeToRefs(cashBoxesStore)
cashBoxesStore.fetchAll()
const filterCashBoxId = ref<string | null>(null)
const filterCashBoxObj = computed(() =>
  filterCashBoxId.value ? cashBoxes.value.find((b) => b.id === filterCashBoxId.value) ?? null : null,
)

// Staff assignee filter (partner-only)
const authStore = useAuthStore()
const sections = useSections()
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

// The reminder flow now lives on the dedicated /broadcasts page — the
// "Напомнить всем" button just navigates there.

onMounted(async () => {
  try {
    // Ни все платежи, ни весь портфель сделок здесь больше не грузятся — в
    // этом и был основной вес страницы.
    await Promise.all([
      refreshList(),
      fetchFolders(),
    ])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки платежей')
  } finally {
    pageLoading.value = false
  }
})

const tab = ref(0)
// Сброс сортировки при смене вкладки живёт НИЖЕ, в серверном блоке: здесь он
// сработал бы на восстановление вкладки из адреса и затёр бы сортировку,
// которую партнёр туда сохранил.
const search = ref('')
const viewMode = ref<'table' | 'calendar'>('table')

// Month filter
const now = new Date()
const filterMonth = ref<string | null>(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const filterYear = ref(new Date().getFullYear())

const availableYears = computed(() => {
  const years = new Set<number>(paymentsStore.facets?.years ?? [])
  years.add(new Date().getFullYear())
  return Array.from(years).sort((a, b) => b - a)
})

// Count payments per month for the selected year. На вкладке «Оплаченные»
// считаем по месяцу ФАКТИЧЕСКОЙ оплаты (paidAt) — согласованно с фильтром и
// аналитикой; на остальных вкладках — по плановому сроку (график).
// Счётчики месяцев считает сервер: на вкладке «Оплаченные» — по дате
// фактической оплаты, на остальных — по плановому сроку.
const monthPaymentCounts = computed<Record<string, number>>(() => {
  const months = paymentsStore.facets?.months
  if (!months) return {}
  const src = tab.value === 3 ? months.paid : months.due
  const year = String(filterYear.value)
  const out: Record<string, number> = {}
  for (const [ym, cnt] of Object.entries(src)) {
    if (ym.startsWith(year)) out[ym] = cnt
  }
  return out
})

// «Оплачен не в свой месяц» для строки списка (только вкладка «Оплаченные»).
function paidOffMonth(p: Payment): 'early' | 'late' | null {
  return offMonthKind(p)
}
// Подпись бейджа: «оплачен в июле · срок был в сентябре».
function offMonthLabel(p: Payment): string {
  if (!p.paidAt) return ''
  const paid = new Date(p.paidAt)
  const due = dueYearMonth(p.dueDate)
  if (!due) return ''
  const paidStr = monthPrepositional(paid.getFullYear(), paid.getMonth(), due.year)
  const dueStr = monthPrepositional(due.year, due.month, paid.getFullYear())
  return `оплачен в ${paidStr} · срок был в ${dueStr}`
}

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

/**
 * Календарь работает на агрегатах сервера: он считает по каждому дню число и
 * суммы платежей в разрезе статусов. Раньше страница выкачивала все платежи
 * партнёра и раскладывала их по датам в браузере.
 *
 * Заодно чинится расхождение: точки на днях «мёртвые» строки (досрочно
 * закрытые, хвосты отменённых сделок) уже исключали, а суммы месяца и года —
 * нет, и итоги завышались. Сервер применяет то же правило к обоим.
 */
const CAL_ENABLED = () => subscription.canAccess('analyticsCharts')

/** Границы сетки месяца: 42 ячейки, включая хвосты соседних месяцев. */
function monthGridRange(year: number, month: number): { from: string; to: string } {
  const firstDay = new Date(year, month, 1)
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6
  const from = new Date(year, month, 1 - startDow)
  const to = new Date(from)
  to.setDate(to.getDate() + 41)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: fmt(from), to: fmt(to) }
}

const calendarRange = computed(() =>
  calendarScale.value === 'year'
    ? { from: `${calendarYear.value}-01-01`, to: `${calendarYear.value}-12-31` }
    : monthGridRange(calendarYear.value, calendarMonth.value),
)

type CalendarDay = {
  day: number
  dateKey: string
  isCurrentMonth: boolean
  isToday: boolean
  count: number
  totalAmount: number
  /** До трёх точек — по наличию статусов, а не по первым платежам дня. */
  dots: ('OVERDUE' | 'PENDING' | 'PAID')[]
  hasOverdue: boolean
  hasPending: boolean
  hasPaid: boolean
}

/** Собирает ячейку дня из агрегата сервера (пустой день — нули). */
function buildDay(key: string, day: number, isCurrentMonth: boolean, todayKey: string): CalendarDay {
  const a = paymentsStore.calendarAgg[key]
  const hasOverdue = (a?.overdueCount ?? 0) > 0
  const hasPending = (a?.pendingCount ?? 0) > 0
  const hasPaid = (a?.paidCount ?? 0) > 0
  const dots: ('OVERDUE' | 'PENDING' | 'PAID')[] = []
  if (hasOverdue) dots.push('OVERDUE')
  if (hasPending) dots.push('PENDING')
  if (hasPaid) dots.push('PAID')
  return {
    day,
    dateKey: key,
    isCurrentMonth,
    isToday: key === todayKey,
    count: (a?.pendingCount ?? 0) + (a?.overdueCount ?? 0) + (a?.paidCount ?? 0),
    totalAmount: (a?.pendingSum ?? 0) + (a?.overdueSum ?? 0) + (a?.paidSum ?? 0),
    dots,
    hasOverdue,
    hasPending,
    hasPaid,
  }
}

const calendarDays = computed((): CalendarDay[] => {
  const year = calendarYear.value
  const month = calendarMonth.value
  const lastDay = new Date(year, month + 1, 0)

  // Monday-based: 0=Mon ... 6=Sun
  const firstDay = new Date(year, month, 1)
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6

  const days: CalendarDay[] = []
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const prevMonthLast = new Date(year, month, 0).getDate()
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevMonthLast - i
    const m = month === 0 ? 12 : month
    const y = month === 0 ? year - 1 : year
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push(buildDay(key, d, false, todayKey))
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push(buildDay(key, d, true, todayKey))
  }

  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    const m = month === 11 ? 1 : month + 2
    const y = month === 11 ? year + 1 : year
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push(buildDay(key, d, false, todayKey))
  }

  return days
})

/**
 * Платежи выбранного дня. Отдельный запрос: агрегаты календаря несут только
 * счётчики и суммы, а сайдбару нужны сами строки. У крупного партнёра первое
 * число месяца может собрать сотни платежей — отсюда лимит и догрузка.
 */
const DAY_PAGE_SIZE = 200
type DayPayment = Payment & { _dealName: string; _clientName: string }
const dayPayments = ref<DayPayment[]>([])
const dayPaymentsTotal = ref(0)
const dayPaymentsLoading = ref(false)
let dayReq = 0

const selectedDatePayments = computed(() => dayPayments.value)
/** Сумма загруженных платежей дня — в подзаголовке модалки. */
const dayTotalAmount = computed(() => dayPayments.value.reduce((s, p) => s + p.amount, 0))
const dayHasMore = computed(() => dayPayments.value.length < dayPaymentsTotal.value)

function decorateDayPayment(p: Payment): DayPayment {
  const deal = getDealForPayment(p)
  return {
    ...p,
    _dealName: getDealName(p),
    _clientName: getClientName(p),
  }
}

async function loadDayPayments(key: string, append = false) {
  const req = ++dayReq
  dayPaymentsLoading.value = true
  try {
    const qs = new URLSearchParams({
      tab: 'all',
      dueFrom: key,
      dueTo: key,
      tz: TZ,
      limit: String(DAY_PAGE_SIZE),
      offset: String(append ? dayPayments.value.length : 0),
    })
    if (filterFolder.value) qs.set('folderId', filterFolder.value)
    if (filterCashBoxId.value) qs.set('cashBoxId', filterCashBoxId.value)
    if (filterStaff.value) qs.set('assignedStaffId', filterStaff.value)
    if (debouncedSearch.value.trim()) qs.set('q', debouncedSearch.value.trim())

    const res = await api.get<{ items: Payment[]; total: number }>(`/payments?${qs.toString()}`)
    if (req !== dayReq) return
    // «Мёртвые» строки в списочном ответе есть — агрегаты дня их уже
    // исключают, поэтому фильтруем здесь тем же правилом, иначе список
    // разошёлся бы с точкой на календаре.
    const rows = res.items.filter((x) => isLivePayment(x, getDealForPayment(x))).map(decorateDayPayment)
    dayPayments.value = append ? [...dayPayments.value, ...rows] : rows
    dayPaymentsTotal.value = res.total
  } catch (e: any) {
    if (req !== dayReq) return
    console.error('Failed to load day payments:', e)
  } finally {
    if (req === dayReq) dayPaymentsLoading.value = false
  }
}

watch(selectedCalendarDate, (key) => {
  if (!key) {
    dayPayments.value = []
    dayPaymentsTotal.value = 0
    return
  }
  loadDayPayments(key)
})

// Monthly summary for sidebar
/** Сводка месяца из агрегатов: суммируем дни выбранного месяца. */
const monthSummary = computed(() => {
  const prefix = `${calendarYear.value}-${String(calendarMonth.value + 1).padStart(2, '0')}`
  let total = 0, pending = 0, overdue = 0, paid = 0, count = 0
  for (const [key, a] of Object.entries(paymentsStore.calendarAgg)) {
    if (!key.startsWith(prefix)) continue
    count += a.pendingCount + a.overdueCount + a.paidCount
    pending += a.pendingSum
    overdue += a.overdueSum
    paid += a.paidSum
    total += a.pendingSum + a.overdueSum + a.paidSum
  }
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
      const a = paymentsStore.calendarAgg[key]
      const cnt = (a?.pendingCount ?? 0) + (a?.overdueCount ?? 0) + (a?.paidCount ?? 0)
      const amt = (a?.pendingSum ?? 0) + (a?.overdueSum ?? 0) + (a?.paidSum ?? 0)
      const hasOverdue = (a?.overdueCount ?? 0) > 0
      monthTotal += amt
      monthPaymentCount += cnt
      if (hasOverdue) monthHasOverdue = true
      days.push({
        day: d, dateKey: key, isCurrentMonth: true,
        hasOverdue,
        hasPending: (a?.pendingCount ?? 0) > 0,
        hasPaid: (a?.paidCount ?? 0) > 0,
        isToday: key === todayKey,
        paymentCount: cnt,
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

/** Сводка года из агрегатов: годовая шкала запрашивает весь год разом. */
const yearSummary = computed(() => {
  const prefix = `${calendarYear.value}-`
  let total = 0, pending = 0, overdue = 0, paid = 0, count = 0
  for (const [key, a] of Object.entries(paymentsStore.calendarAgg)) {
    if (!key.startsWith(prefix)) continue
    count += a.pendingCount + a.overdueCount + a.paidCount
    pending += a.pendingSum
    overdue += a.overdueSum
    paid += a.paidSum
    total += a.pendingSum + a.overdueSum + a.paidSum
  }
  return { total, pending, overdue, paid, count }
})

function selectYearDay(day: YearMonthData['days'][0]) {
  if (day.paymentCount > 0 && day.isCurrentMonth) {
    selectedCalendarDate.value = selectedCalendarDate.value === day.dateKey ? null : day.dateKey
  }
}

function selectDay(day: CalendarDay) {
  if (day.count) {
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

// ══════════════════════════════════════════════════════════════════
// Серверный список платежей
//
// Раньше страница выкачивала ВСЕ платежи партнёра и весь его портфель сделок,
// а вкладки, месяцы, поиск и сортировку считала поверх этих массивов. Теперь
// сервер отдаёт страницу, счётчики и агрегаты календаря.
//
// Порядок объявлений в этом блоке важен: initFromQuery() читает refs, которые
// объявлены выше по файлу, и вызывается ДО watch'ей — иначе восстановление
// состояния из адреса было бы принято за действие партнёра.
// ══════════════════════════════════════════════════════════════════

const PER_PAGE_OPTIONS = [25, 50, 100, 200] // 200 — серверный максимум
const page = ref(1)
const perPage = ref(50)

/** Часовой пояс: от него зависит, в какой месяц и день попадёт платёж. */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'

const TAB_KEYS = ['active', 'pending', 'overdue', 'paid', 'all'] as const

// Поиск с задержкой: без неё каждый символ уходил бы отдельным запросом.
const debouncedSearch = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { debouncedSearch.value = v }, 350)
})

/**
 * На вкладке «Оплаченные» месяц считается по дате фактической оплаты, на
 * остальных — по плановому сроку. Зеркалит прежнюю клиентскую логику и
 * атрибуцию дохода в аналитике.
 */
const monthBasis = computed<'due' | 'paid'>(() => (tab.value === 3 ? 'paid' : 'due'))

const serverFilters = computed(() => ({
  folderId: filterFolder.value,
  cashBoxId: filterCashBoxId.value,
  assignedStaffId: filterStaff.value,
  q: debouncedSearch.value,
}))

/** Параметры счётчиков и календаря — фильтры без вкладки, страницы и сортировки. */
const facetParams = computed(() => ({ ...serverFilters.value, tz: TZ }))

const serverParams = computed(() => ({
  ...serverFilters.value,
  tab: TAB_KEYS[tab.value] ?? 'all',
  month: filterMonth.value ?? undefined,
  monthBasis: monthBasis.value,
  tz: TZ,
  sort: sortField.value,
  dir: sortAsc.value ? ('asc' as const) : ('desc' as const),
  limit: perPage.value,
  offset: (page.value - 1) * perPage.value,
}))

const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

function initFromQuery() {
  const q = route.query
  const str = (v: unknown): string | null => {
    const s = Array.isArray(v) ? v[0] : v
    return typeof s === 'string' && s.trim() ? s : null
  }
  const int = (v: unknown, def: number): number => {
    const n = parseInt(str(v) ?? '', 10)
    return Number.isFinite(n) && n > 0 ? n : def
  }

  const t = int(q.tab, 0)
  tab.value = t >= 0 && t <= 4 ? t : 0
  perPage.value = PER_PAGE_OPTIONS.includes(int(q.per, 50)) ? int(q.per, 50) : 50
  page.value = int(q.page, 1)

  const qs = str(q.q)
  if (qs) {
    search.value = qs
    debouncedSearch.value = qs // иначе первый запрос ушёл бы без поиска
  }

  // Месяц: 'all' — все месяцы, 'YYYY-MM' — конкретный, отсутствие — текущий.
  const m = str(q.month)
  if (m === 'all') {
    filterMonth.value = null
  } else if (m && /^\d{4}-\d{2}$/.test(m)) {
    filterMonth.value = m
    filterYear.value = parseInt(m.slice(0, 4), 10)
  }

  // Валидируем по локальному списку полей: серверные константы сюда тянуть
  // незачем, а обращение к объявленному ниже const упало бы в браузере.
  const sc = str(q.sort)
  if (sc && (['dueDate', 'amount', 'number', 'deal', 'client', 'status'] as string[]).includes(sc)) {
    sortField.value = sc as SortField
  }
  if (str(q.dir)) sortAsc.value = str(q.dir) === 'asc'

  filterFolder.value = str(q.folder)
  filterCashBoxId.value = str(q.box)
  filterStaff.value = str(q.staff)
  if (str(q.view) === 'calendar') viewMode.value = 'calendar'
}

// ДО watch'ей ниже — см. комментарий в шапке блока.
initFromQuery()

// Смена вкладки сбрасывает сортировку на дату (просроченные — сначала свежие).
// Стоит после initFromQuery, иначе затёрло бы сортировку из адреса.
watch(tab, (v) => {
  sortField.value = 'dueDate'
  sortAsc.value = v !== 2
})

watch(
  () => [tab.value, page.value, perPage.value, debouncedSearch.value, sortField.value,
         sortAsc.value, filterMonth.value, filterFolder.value, filterCashBoxId.value,
         filterStaff.value, viewMode.value],
  () => {
    const q: Record<string, string> = {}
    if (tab.value) q.tab = String(tab.value)
    if (page.value > 1) q.page = String(page.value)
    if (perPage.value !== 50) q.per = String(perPage.value)
    if (debouncedSearch.value.trim()) q.q = debouncedSearch.value.trim()
    if (sortField.value !== 'dueDate') q.sort = sortField.value
    if (!sortAsc.value) q.dir = 'desc'
    if (filterMonth.value === null) q.month = 'all'
    else if (filterMonth.value !== currentMonthStr) q.month = filterMonth.value
    if (filterFolder.value) q.folder = filterFolder.value
    if (filterCashBoxId.value) q.box = filterCashBoxId.value
    if (filterStaff.value) q.staff = filterStaff.value
    if (viewMode.value === 'calendar') q.view = 'calendar'
    // replace, а не push: перебор фильтров не должен забивать историю браузера.
    router.replace({ query: q }).catch(() => {})
  },
)

// Смена выборки — всегда с первой страницы: иначе после сужения партнёр
// оказался бы на пустой странице.
watch(
  () => [serverFilters.value, tab.value, filterMonth.value, sortField.value, sortAsc.value, perPage.value],
  () => { page.value = 1 },
  { deep: true },
)

// Страница и счётчики перезапрашиваются РАЗДЕЛЬНО: переход по страницам не
// должен тянуть агрегаты, которые от него не зависят.
watch(serverParams, () => { paymentsStore.fetchPaymentsPage(serverParams.value) }, { deep: true })
watch(facetParams, () => { paymentsStore.fetchPaymentsFacets(facetParams.value) }, { deep: true })

/**
 * Перечитать всё, на что влияет правка графика: страницу, счётчики, а в режиме
 * календаря — ещё агрегаты дней и список открытого дня. Отметка об оплате
 * меняет и соседние платежи (перерасчёт), поэтому точечным обновлением строки
 * не обойтись.
 */
async function refreshList() {
  const jobs: Promise<unknown>[] = [
    paymentsStore.fetchPaymentsPage(serverParams.value),
    paymentsStore.fetchPaymentsFacets(facetParams.value),
  ]
  if (viewMode.value === 'calendar' && CAL_ENABLED()) {
    const { from, to } = calendarRange.value
    jobs.push(paymentsStore.fetchPaymentsCalendar(from, to, facetParams.value))
    if (selectedCalendarDate.value) jobs.push(loadDayPayments(selectedCalendarDate.value))
  }
  await Promise.all(jobs)
}

// Календарь запрашивает агрегаты за видимый диапазон. Стоит здесь, а не рядом
// с остальным кодом календаря: наблюдатель читает serverFilters/facetParams,
// объявленные выше по файлу, — обращение к ним из верхней части файла упало бы
// в браузере (const в мёртвой зоне), а типы и сборка этого не ловят.
watch(
  () => [viewMode.value, calendarScale.value, calendarMonth.value, calendarYear.value, serverFilters.value],
  () => {
    if (viewMode.value !== 'calendar' || !CAL_ENABLED()) return
    const { from, to } = calendarRange.value
    paymentsStore.fetchPaymentsCalendar(from, to, facetParams.value)
  },
  { deep: true, immediate: true },
)

function sortIcon(field: SortField) {
  if (sortField.value !== field) return 'mdi-unfold-more-horizontal'
  return sortAsc.value ? 'mdi-chevron-up' : 'mdi-chevron-down'
}

// Deal detail dialog
const selectedDeal = ref<Deal | null>(null)
const showDealDialog = ref(false)

const { isDealLocked } = useDealLock()
// Платёж по залоченной сделке — показываем как недоступный.
function isPaymentLocked(payment: Payment): boolean {
  return isDealLocked(getDealForPayment(payment))
}

function openDealFromPayment(payment: Payment) {
  const deal = getDealForPayment(payment)
  if (!deal) return
  // Залоченная сделка: не открываем превью, ведём на страницу (там экран блокировки).
  if (isDealLocked(deal)) { router.push(`/deals/${deal.id}`); return }
  selectedDeal.value = deal
  showDealDialog.value = true
  // График подтягиваем на открытие: карта платежей больше не пред-заполнена
  // полным набором, и блок «График платежей» был бы пуст.
  dealPaymentsLoading.value = true
  paymentsStore.fetchPaymentsForDeal(deal.id)
    .catch(() => {})
    .finally(() => { dealPaymentsLoading.value = false })
}

/** Идёт загрузка графика для превью сделки. */
const dealPaymentsLoading = ref(false)

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

const selectedDealPhone = computed<string | null>(() => {
  const d = selectedDeal.value
  if (!d) return null
  const raw = d.clientProfile?.phone || d.client?.phone || d.externalClientPhone
  return raw ? formatPhone(raw) : null
})

const selectedDealPaidTotal = computed(() =>
  selectedDealPayments.value.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0)
)

// Перенос даты — общий компонент ReschedulePaymentDialog: дату, причину и
// отправку он держит сам, странице остаётся только выбор платежа.
const rescheduleDialog = ref(false)
const reschedulePaymentRef = ref<Payment | null>(null)

/**
 * Строки страницы. Сервер уже применил вкладку, месяц, фильтры, поиск и
 * сортировку — здесь ничего не пересчитываем. Прежняя клиентская выборка
 * работала поверх ВСЕХ платежей партнёра в памяти; у крупного партнёра это
 * сотни тысяч строк.
 */
const displayedPayments = computed(() => paymentsStore.list)

/** Всего строк в выборке — для пагинатора и подписи «показано X из N». */
const totalRows = computed(() => paymentsStore.listTotal)
/** Сквозной номер строки: на 2-й странице по 50 счёт идёт с 51. */
function rowNumber(idx: number): number {
  return (page.value - 1) * perPage.value + idx + 1
}

/** Идёт запрос списка — строки гаснут, элементы управления блокируются. */
const listBusy = computed(() => paymentsStore.listLoading)
/** Идёт запрос счётчиков — KPI показывают скелетон вместо старых цифр. */
const statsBusy = computed(() => paymentsStore.facetsLoading)

/**
 * Вкладки со счётчиками сервера. Считаются по ТЕКУЩИМ фильтрам (папка, касса,
 * сотрудник, поиск) — как на странице сделок, поэтому цифры совпадают с тем,
 * что видно в таблице.
 */
const tabFilters = computed(() => {
  const t = paymentsStore.facets?.tabs
  return [
    { label: 'Текущие', count: t?.active ?? 0 },
    { label: 'Ожидаемые', count: t?.pending ?? 0 },
    { label: 'Просроченные', count: t?.overdue ?? 0 },
    { label: 'Оплаченные', count: t?.paid ?? 0 },
    { label: 'Все', count: t?.all ?? 0 },
  ]
})

function getDealForPayment(payment: Payment): Deal | undefined {
  // Сначала сделка, пришедшая вместе с платежом: полный портфель эта страница
  // больше не грузит, и стор сделок здесь по большей части пуст.
  return payment.deal || dealsStore.getDeal(payment.dealId)
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

function getClientPhone(payment: Payment): string | null {
  const deal = getDealForPayment(payment)
  if (!deal) return null
  // Mirror backend priority: ClientProfile → User → external phone.
  const raw = deal.clientProfile?.phone || deal.client?.phone || deal.externalClientPhone
  return raw ? formatPhone(raw) : null
}

function daysUntil(dateStr: string) {
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
  if (diff < 0) return `${Math.abs(diff)} дн. назад`
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Завтра'
  return `через ${diff} дн.`
}

// Отметка оплаты — общий компонент MarkPaidDialog: та же модалка и тот же
// функционал, что на странице сделки. Раньше здесь стояла своя урезанная
// версия (сумма и галочка «в срок»), без перерасчёта графика, фактической
// даты оплаты, квитанции и скриншота.
const markPaidDialog = ref(false)
const markPaidTarget = ref<Payment | null>(null)

/** Сделка отмечаемого платежа — приходит вместе с ним в списке. */
const markPaidDeal = computed(() =>
  markPaidTarget.value ? getDealForPayment(markPaidTarget.value) ?? null : null,
)

function handleMarkPaid(e: Event, payment: Payment) {
  e.stopPropagation()
  markPaidTarget.value = payment
  markPaidDialog.value = true
}

/** Платёж отмечен: перечитываем страницу, счётчики и календарь. */
async function onMarkPaidDone() {
  markPaidTarget.value = null
  await refreshList()
}

const unpaidLoading = ref<string | null>(null)

async function handleUnmarkPaid(e: Event, payment: Payment) {
  e.stopPropagation()
  unpaidLoading.value = payment.id
  try {
    await paymentsStore.unmarkPaid(payment.id, payment.dealId)
    toast.success('Оплата отменена')
    await refreshList()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при отмене оплаты')
  } finally {
    unpaidLoading.value = null
  }
}

function openReschedule(e: Event, payment: Payment) {
  e.stopPropagation()
  reschedulePaymentRef.value = payment
  rescheduleDialog.value = true
}

/** Сделка переносимого платежа — показываем её название в шапке диалога. */
const rescheduleDeal = computed(() =>
  reschedulePaymentRef.value ? getDealForPayment(reschedulePaymentRef.value) ?? null : null,
)

/** Дата перенесена: перечитываем страницу, счётчики и календарь. */
async function onRescheduled() {
  reschedulePaymentRef.value = null
  await refreshList()
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Page loader -->
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
    <!-- Summary stats (KPI) — скрываются у ролей без права payments.kpi -->
    <div v-if="authStore.can('payments.kpi')" class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
          <v-icon icon="mdi-cash-multiple" size="20" />
        </div>
        <div>
          <div v-if="statsBusy" class="stat-skel stat-skel--sm" />
          <div v-else class="stat-value">{{ paymentsStore.facets?.tabs.active ?? 0 }}</div>
          <div class="stat-label">Текущих платежей</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
          <v-icon icon="mdi-clock-outline" size="20" />
        </div>
        <div>
          <div v-if="statsBusy" class="stat-skel stat-skel--md" />
          <div v-else class="stat-value">{{ formatCurrency(paymentsStore.facets?.sums.pending ?? 0) }}</div>
          <div class="stat-label">Ожидается</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
          <v-icon icon="mdi-alert-circle-outline" size="20" />
        </div>
        <div>
          <div v-if="statsBusy" class="stat-skel stat-skel--sm" />
          <div v-else class="stat-value">{{ paymentsStore.facets?.tabs.overdue ?? 0 }}</div>
          <div class="stat-label">Просрочено</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-check-circle-outline" size="20" />
        </div>
        <div>
          <div v-if="statsBusy" class="stat-skel stat-skel--md" />
          <div v-else class="stat-value">{{ formatCurrency(paymentsStore.facets?.sums.paid ?? 0) }}</div>
          <div class="stat-label">Получено</div>
        </div>
      </div>
    </div>

    <!-- View mode toggle -->
    <div class="d-flex ga-2 mb-4 align-center flex-wrap">
      <v-tooltip v-if="!subscription.canAccess('whatsapp')" text="Доступно с плана Премиум" location="bottom">
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
      <button v-else class="btn-whatsapp" @click="router.push('/broadcasts')">
        <v-icon icon="mdi-whatsapp" size="18" />
        Напомнить всем
      </button>
      <v-spacer />
      <!-- Filter group (cashbox + staff + folder).
           Display: contents — на десктопе обёртка прозрачна, ничего не
           ломает. На мобиле получает flex: 100% и переезжает на следующую
           строку (см. CSS). -->
      <div class="toolbar-filters">
      <!-- Cashbox filter -->
      <v-menu v-if="cashBoxes.length > 1" :close-on-content-click="true">
        <template #activator="{ props: cp }">
          <button v-bind="cp" class="pf-folder-btn" :class="{ 'pf-folder-btn--active': filterCashBoxId }">
            <v-icon icon="mdi-wallet-outline" size="15" />
            <template v-if="filterCashBoxObj">
              {{ filterCashBoxObj.name }}
            </template>
            <template v-else>Касса</template>
            <v-icon icon="mdi-chevron-down" size="13" style="opacity: 0.4;" />
          </button>
        </template>
        <v-card rounded="lg" elevation="4" class="pf-folder-menu">
          <div class="pf-folder-header">
            <span>Кассы</span>
          </div>
          <div class="pf-folder-body">
            <button class="pf-folder-item" :class="{ 'pf-folder-item--active': !filterCashBoxId }" @click="filterCashBoxId = null">
              <v-icon icon="mdi-view-list" size="18" style="color: rgba(var(--v-theme-on-surface), 0.35);" />
              <span class="pf-folder-item-name">Все платежи</span>
            </button>
            <div class="pf-folder-divider" />
            <button
              v-for="b in cashBoxes"
              :key="b.id"
              class="pf-folder-item"
              :class="{ 'pf-folder-item--active': filterCashBoxId === b.id }"
              @click="filterCashBoxId = filterCashBoxId === b.id ? null : b.id"
            >
              <v-icon icon="mdi-wallet-outline" size="14" :style="{ color: b.color }" />
              <span class="pf-folder-item-name">{{ b.name }}</span>
              <span v-if="b.isDefault" class="pf-folder-item-meta">осн.</span>
            </button>
          </div>
        </v-card>
      </v-menu>

      <!-- Staff assignee filter -->
      <v-menu v-if="authStore.isOwner && sections.visible('staff') && staffList.length > 0" :close-on-content-click="true">
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
      </div><!-- /toolbar-filters -->
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
        <v-col cols="12">
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
                      'cal-day--has-payments': day.count > 0,
                      'cal-day--selected': selectedCalendarDate === day.dateKey,
                      'cal-day--overdue': day.hasOverdue && day.isCurrentMonth,
                    }"
                    @click="selectDay(day)"
                  >
                    <span class="cal-day-num">{{ day.day }}</span>
                    <!-- Точка на каждый статус, присутствующий в дне (до трёх):
                         сервер отдаёт счётчики по статусам, а не сами платежи. -->
                    <div v-if="day.count && day.isCurrentMonth" class="cal-day-dots">
                      <span
                        v-for="st in day.dots"
                        :key="st"
                        class="cal-dot"
                        :style="{ background: st === 'OVERDUE' ? '#ef4444' : st === 'PAID' ? '#047857' : '#f59e0b' }"
                      />
                    </div>
                    <div v-if="day.count && day.isCurrentMonth" class="cal-day-amount">
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
      </v-row>

      <!-- Year view — date detail dialog -->
      <!-- Платежи выбранного дня. Одна модалка на оба масштаба календаря и
           обычная таблица внутри — та же подача, что в остальных разделах,
           вместо отдельного списка со своими карточками. -->
      <v-dialog
        :model-value="!!selectedCalendarDate"
        max-width="1100"
        scrollable
        :fullscreen="isMobile"
        @update:model-value="v => { if (!v) selectedCalendarDate = null }"
      >
        <v-card v-if="selectedCalendarDate" rounded="lg" class="day-dialog">
          <div class="day-dialog-head">
            <div>
              <div class="day-dialog-title">{{ formatSelectedDate(selectedCalendarDate) }}</div>
              <div class="day-dialog-sub">
                {{ dayPaymentsTotal.toLocaleString('ru-RU') }}
                {{ dayPaymentsTotal === 1 ? 'платёж' : dayPaymentsTotal < 5 ? 'платежа' : 'платежей' }}
                <template v-if="dayTotalAmount">
                  · {{ formatCurrency(dayTotalAmount) }}
                </template>
              </div>
            </div>
            <button class="dialog-close-sm" @click="selectedCalendarDate = null">
              <v-icon icon="mdi-close" size="16" />
            </button>
          </div>

          <div class="day-dialog-body">
            <div v-if="dayPaymentsLoading && !selectedDatePayments.length" class="d-flex justify-center py-10">
              <v-progress-circular indeterminate size="30" width="3" color="primary" />
            </div>

            <v-table v-else-if="selectedDatePayments.length" density="comfortable" hover class="payments-table">
              <thead>
                <tr>
                  <th class="th-index">№</th>
                  <th>Сделка</th>
                  <th>Клиент</th>
                  <th class="text-right">Сумма</th>
                  <th>Дата</th>
                  <th>Статус</th>
                  <th class="text-center">Действия</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(p, idx) in selectedDatePayments"
                  :key="p.id"
                  class="clickable-row"
                  :class="{ 'deal-locked-dim': isPaymentLocked(p) }"
                  @click="selectedCalendarDate = null; openDealFromPayment(p)"
                >
                  <td class="td-index">{{ idx + 1 }}</td>
                  <td>
                    <span class="font-weight-medium">{{ p._dealName }}</span>
                    <span v-if="isPaymentLocked(p)" class="deal-locked-chip ml-2"><v-icon icon="mdi-lock-outline" />Недоступно</span>
                  </td>
                  <td>
                    <div class="client-name">
                      {{ p._clientName }}
                    </div>
                    <div v-if="getClientPhone(p)" class="client-phone">{{ getClientPhone(p) }}</div>
                  </td>
                  <td class="text-right text-no-wrap">
                    <span class="font-weight-bold">{{ formatCurrency(p.amount) }}</span>
                    <span class="payment-of-total">{{ p.number }} из {{ getDealForPayment(p)?.numberOfPayments || '?' }}</span>
                  </td>
                  <td>
                    <span>{{ formatDateShort(p.dueDate) }}</span>
                    <div v-if="p.rescheduledFrom" class="rescheduled-hint">
                      <v-icon icon="mdi-calendar-arrow-right" size="12" />
                      <span>с {{ formatDateShort(p.rescheduledFrom) }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="payment-status-chip" :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])">
                      {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                    </div>
                  </td>
                  <td class="text-center">
                    <div v-if="p.status === 'PENDING' || p.status === 'OVERDUE'" class="d-flex align-center justify-center ga-1">
                      <v-tooltip text="Отметить оплаченным" location="top">
                        <template #activator="{ props }">
                          <button v-bind="props" class="action-btn action-btn--success" @click.stop="handleMarkPaid($event, p)">
                            <v-icon icon="mdi-check" size="16" />
                          </button>
                        </template>
                      </v-tooltip>
                      <v-tooltip text="Перенести дату" location="top">
                        <template #activator="{ props }">
                          <button v-bind="props" class="action-btn action-btn--warning" @click.stop="openReschedule($event, p)">
                            <v-icon icon="mdi-calendar-arrow-right" size="16" />
                          </button>
                        </template>
                      </v-tooltip>
                    </div>
                    <div v-else class="d-flex align-center justify-center">
                      <v-tooltip text="Отменить оплату" location="top">
                        <template #activator="{ props }">
                          <button v-bind="props" class="action-btn action-btn--danger" :disabled="unpaidLoading === p.id" @click.stop="handleUnmarkPaid($event, p)">
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

            <div v-else class="text-center py-10 text-medium-emphasis">Платежей нет</div>

            <!-- День может собрать больше платежей, чем помещается в один
                 запрос: у крупного партнёра первое число набирает сотни строк. -->
            <button
              v-if="dayHasMore"
              class="cal-day-more"
              :disabled="dayPaymentsLoading"
              @click="selectedCalendarDate && loadDayPayments(selectedCalendarDate, true)"
            >
              <v-progress-circular v-if="dayPaymentsLoading" indeterminate size="14" width="2" />
              <span v-else>Показать ещё ({{ dayPaymentsTotal - selectedDatePayments.length }})</span>
            </button>
          </div>
        </v-card>
      </v-dialog>
      </div>
    </template>

    <!-- TABLE VIEW -->
    <v-card v-if="viewMode === 'table'" rounded="lg" elevation="0" border class="payments-card">
      <div class="pa-4">
        <!-- Tabs + search -->
        <div class="d-flex flex-wrap ga-2 align-center mb-4">
          <div class="d-flex ga-2">
            <button
              v-for="(f, i) in tabFilters"
              :key="i"
              class="tab-btn"
              :class="{ active: tab === i }"
              :disabled="listBusy && tab !== i"
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
          <span class="month-filter-notice-count">{{ totalRows.toLocaleString('ru-RU') }} из {{ (paymentsStore.facets?.tabs.all ?? 0).toLocaleString('ru-RU') }}</span>
          <button class="month-filter-notice-clear" @click="filterMonth = null">
            Показать все
            <v-icon icon="mdi-close" size="12" />
          </button>
        </div>

        <!-- Table (desktop) -->
        <!-- Список с индикацией: строки гаснут, а не исчезают — иначе
             таблица «прыгала» бы при каждом переходе. -->
        <div class="pl-list-wrap" :class="{ 'pl-list-wrap--busy': listBusy }">
          <div v-if="listBusy" class="pl-list-overlay">
            <v-progress-circular indeterminate size="30" width="3" color="primary" />
          </div>

        <v-table v-if="displayedPayments.length" density="comfortable" hover class="payments-table payments-table--desktop">
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
            <tr v-for="(p, idx) in displayedPayments" :key="p.id" class="clickable-row" :class="{ 'deal-locked-dim': isPaymentLocked(p) }" @click="openDealFromPayment(p)">
              <td class="td-index">{{ rowNumber(idx) }}</td>
              <td>
                <span class="font-weight-medium">{{ getDealName(p) }}</span>
                <span v-if="isPaymentLocked(p)" class="deal-locked-chip ml-2"><v-icon icon="mdi-lock-outline" />Недоступно</span>
              </td>
              <td>
                <div class="client-name">
                  {{ getClientName(p) }}
                </div>
                <div v-if="getClientPhone(p)" class="client-phone">{{ getClientPhone(p) }}</div>
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
                  <!-- «Оплачен не в свой месяц»: платёж за другой месяц, но
                       оплачен раньше/позже → доход учтён по факту оплаты. -->
                  <div
                    v-if="paidOffMonth(p)"
                    class="offmonth-chip"
                    :class="paidOffMonth(p) === 'early' ? 'offmonth-chip--early' : 'offmonth-chip--late'"
                    :title="offMonthLabel(p)"
                  >
                    <v-icon :icon="paidOffMonth(p) === 'early' ? 'mdi-calendar-arrow-left' : 'mdi-calendar-arrow-right'" size="11" />
                    <span>{{ paidOffMonth(p) === 'early' ? 'оплачен досрочно' : 'оплачен позже срока' }}</span>
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

        <!-- Mobile card view (shown only on <768px via CSS) -->
        <div v-if="displayedPayments.length" class="payments-cards">
          <div
            v-for="(p, idx) in displayedPayments"
            :key="p.id"
            class="pay-card"
            :class="{ 'pay-card--overdue': p.status === 'OVERDUE', 'deal-locked-dim': isPaymentLocked(p) }"
            @click="openDealFromPayment(p)"
          >
            <div class="pay-card-head">
              <div class="pay-card-num">#{{ rowNumber(idx) }}</div>
              <div
                class="payment-status-chip"
                :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])"
              >
                {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
              </div>
            </div>
            <div class="pay-card-deal">
              {{ getDealName(p) }}
              <span v-if="isPaymentLocked(p)" class="deal-locked-chip"><v-icon icon="mdi-lock-outline" />Недоступно</span>
            </div>
            <div class="pay-card-client">
              <span>{{ getClientName(p) }}</span>
            </div>
            <div v-if="getClientPhone(p)" class="pay-card-phone">{{ getClientPhone(p) }}</div>

            <div class="pay-card-row">
              <div class="pay-card-amount">
                <span class="pay-card-amount-value">{{ formatCurrency(p.amount) }}</span>
                <span class="pay-card-amount-of">{{ p.number }} из {{ getDealForPayment(p)?.numberOfPayments || '?' }}</span>
              </div>
              <div class="pay-card-date">
                <div>{{ formatDateShort(p.dueDate) }}</div>
                <div v-if="p.rescheduledFrom" class="rescheduled-hint">
                  <v-icon icon="mdi-calendar-arrow-right" size="11" />
                  <span>с {{ formatDateShort(p.rescheduledFrom) }}</span>
                </div>
                <div
                  v-if="paidOffMonth(p)"
                  class="offmonth-chip"
                  :class="paidOffMonth(p) === 'early' ? 'offmonth-chip--early' : 'offmonth-chip--late'"
                  :title="offMonthLabel(p)"
                >
                  <v-icon :icon="paidOffMonth(p) === 'early' ? 'mdi-calendar-arrow-left' : 'mdi-calendar-arrow-right'" size="11" />
                  <span>{{ paidOffMonth(p) === 'early' ? 'оплачен досрочно' : 'оплачен позже срока' }}</span>
                </div>
                <div
                  v-if="p.status !== 'PAID'"
                  class="pay-card-due"
                  :class="{ 'pay-card-due--overdue': p.status === 'OVERDUE' || (p.status === 'PENDING' && new Date(p.dueDate) < new Date()) }"
                >
                  {{ daysUntil(p.dueDate) }}
                </div>
              </div>
            </div>

            <div class="pay-card-actions" @click.stop>
              <button
                v-if="p.status === 'PENDING' || p.status === 'OVERDUE'"
                class="action-btn action-btn--success"
                @click="handleMarkPaid($event, p)"
              >
                <v-icon icon="mdi-check" size="16" />
                Отметить оплачено
              </button>
              <button
                v-if="p.status === 'PENDING' || p.status === 'OVERDUE'"
                class="action-btn action-btn--warning"
                @click="openReschedule($event, p)"
              >
                <v-icon icon="mdi-calendar-arrow-right" size="16" />
                Перенести
              </button>
              <button
                v-if="p.status === 'PAID'"
                class="action-btn action-btn--danger"
                :disabled="unpaidLoading === p.id"
                @click="handleUnmarkPaid($event, p)"
              >
                <v-progress-circular v-if="unpaidLoading === p.id" indeterminate size="12" width="2" />
                <v-icon v-else icon="mdi-undo" size="16" />
                Отменить оплату
              </button>
            </div>
          </div>
        </div>

        <div v-if="!displayedPayments.length && !listBusy" class="text-center pa-12">
          <v-icon icon="mdi-cash-multiple" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Нет платежей</p>
          <p class="text-body-2 text-medium-emphasis">
            {{ search ? 'Попробуйте изменить параметры поиска' : 'Платежи появятся после создания сделки' }}
          </p>
        </div>
        </div>

        <!-- Пагинация серверного списка — общий компонент разделов. -->
        <ServerPager
          :page="page"
          :total="totalRows"
          :per-page="perPage"
          :busy="listBusy"
          :per-page-options="PER_PAGE_OPTIONS"
          @update:page="page = $event"
          @update:per-page="perPage = $event"
        />
      </div>
    </v-card>

    <!-- /TABLE VIEW -->

    <!-- Deal Detail Dialog -->
    <v-dialog v-model="showDealDialog" max-width="680" scrollable :fullscreen="isMobile">
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
              <template v-if="selectedDealPhone">
                <span class="mx-1">·</span>
                <v-icon icon="mdi-phone-outline" size="13" />
                {{ selectedDealPhone }}
              </template>
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
            <div v-if="dealPaymentsLoading && !selectedDealPayments.length" class="d-flex justify-center py-4">
              <v-progress-circular indeterminate size="22" width="2" color="primary" />
            </div>
            <div v-else class="schedule-list">
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
    <!-- Отметка оплаты — общий компонент: тот же функционал, что на странице
         сделки (перерасчёт графика, фактическая дата, квитанция, скриншот). -->
    <MarkPaidDialog
      v-model="markPaidDialog"
      :payment="markPaidTarget"
      :deal="markPaidDeal"
      :fullscreen="isMobile"
      @paid="onMarkPaidDone"
    />

    <!-- Перенос даты — общий компонент: тот же диалог, что на странице сделки
         и в превью сделки. Сделку передаём — в списке платежей перемешаны
         договоры, и без неё непонятно, что именно переносим. -->
    <ReschedulePaymentDialog
      v-model="rescheduleDialog"
      :payment="reschedulePaymentRef"
      :deal="rescheduleDeal"
      :fullscreen="isMobile"
      @rescheduled="onRescheduled"
    />
    </template>

    <!-- WhatsApp bulk reminders dialog (preview + per-row selection) -->
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
/* На мобиле 2×2 вместо одного столбца — компактнее, не растягивает экран. */
@media (max-width: 600px) { .stats-row { grid-template-columns: repeat(2, 1fr); gap: 8px; } }

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
.payments-table :deep(td) {
  font-size: 14px;
  /* Двухстрочные клетки (имя клиента + телефон) — без vertical padding
     ряд выглядит сдавленным. Поднимаем минимальную высоту строки. */
  padding-top: 8px !important;
  padding-bottom: 8px !important;
}
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

/* «Оплачен не в свой месяц» — приглушённый чип (их бывает много). */
.offmonth-chip {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10.5px; font-weight: 600; margin-top: 2px;
  padding: 1px 6px; border-radius: 6px; white-space: nowrap;
}
.offmonth-chip--early { color: #059669; background: rgba(16, 185, 129, 0.1); }
.offmonth-chip--late { color: #d97706; background: rgba(245, 158, 11, 0.1); }

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
  background: rgb(var(--v-theme-surface));
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
  /* Календарь занимает всю ширину карточки, поэтому ячейки стали шире.
     Держим пропорцию: без этого дни выглядели приплюснутыми полосами. */
  min-height: 108px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  cursor: default;
  transition: all 0.15s;
  display: flex; flex-direction: column;
}

@media (min-width: 1600px) {
  .cal-day { min-height: 124px; }
}

@media (max-width: 900px) {
  .cal-day { min-height: 84px; padding: 8px; }
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
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.55);
  line-height: 1;
}
.cal-day--has-payments .cal-day-num {
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.cal-day-dots {
  display: flex; gap: 4px; margin-top: 8px;
}
.cal-dot {
  width: 7px; height: 7px; border-radius: 50%;
}

.cal-day-amount {
  font-size: 13px; font-weight: 700; margin-top: auto;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.cal-day--has-payments .cal-day-amount {
  color: rgba(var(--v-theme-on-surface), 0.65);
}

/* Calendar sidebar */

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
.dark .cal-summary-card { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
.dark .stat-card { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
.dark .view-toggle { background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); }
.dark .view-toggle-btn.active { background: rgba(4, 120, 87, 0.15); }
.dark .cal-scale-toggle { background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); }
.dark .cal-scale-btn.active { background: rgba(4, 120, 87, 0.15); }
.dark .year-month-card { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
.dark .mini-day--pending { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
.dark .mini-day--overdue { background: rgba(239, 68, 68, 0.2); color: #f87171; }
.dark .mini-day--paid { background: rgba(4, 120, 87, 0.2); color: #34d399; }
.dark .filter-input { background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); color: rgba(var(--v-theme-on-surface), 0.92); }
.dark .filter-input:focus {
  border-color: #047857; background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .filter-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.5); }
.dark .cal-day { border-color: rgb(var(--v-theme-border)); }
.dark .cal-day--has-payments { border-color: rgb(var(--v-theme-border)); background: rgba(255, 255, 255, 0.02); }
.dark .cal-month-stats { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
.dark .dialog-finance-item { background: rgba(255, 255, 255, 0.04); }
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
.dark .pf-folder-btn { background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); }
.dark .pf-folder-btn:hover { border-color: rgb(var(--v-theme-border)); }
.dark .pf-folder-item:hover { background: rgba(255,255,255,0.04); }
.dark .pf-folder-item--active { background: rgba(var(--v-theme-primary), 0.1); }

.dark .month-filter-btn { background: rgba(255,255,255,0.06); }
.dark .month-filter-btn:hover { background: rgba(255,255,255,0.1); }
.dark .month-menu-year { border-color: rgba(255,255,255,0.06); }
.dark .month-menu-year-btn { background: rgba(255,255,255,0.06); }
.dark .month-menu-footer { border-color: rgba(255,255,255,0.06); }

.client-name {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.92);
}
.client-phone {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}

/* Filter group wrapper: prozhrachen на десктопе, отдельная строка на мобиле. */
.toolbar-filters {
  display: contents;
}

/* ───── Mobile cards (alternative to the wide desktop table) ───── */
.payments-cards { display: none; }

@media (max-width: 767px) {
  /* Скрываем большую таблицу, показываем карточки. */
  .payments-table--desktop { display: none !important; }
  .payments-cards { display: flex; flex-direction: column; gap: 10px; }

  /* Фильтры (Касса/Сотрудник/Папки) — отдельной строкой под кнопкой
     «Напомнить всем» + переключателем «Таблица/Календарь». */
  .toolbar-filters {
    display: flex;
    flex: 1 1 100%;
    gap: 6px;
    flex-wrap: wrap;
    order: 99;
  }
  /* v-spacer теряет смысл на мобиле — прячем чтобы не давал лишний gap. */
  .d-flex.ga-2.mb-4.align-center.flex-wrap > .v-spacer {
    display: none;
  }
  /* Переключатель режима прижимаем направо в первой строке. */
  .view-toggle {
    margin-left: auto;
  }

  /* Вкладки «Текущие/Ожидаемые/...» — горизонтальный скролл ТОЛЬКО
     внутри своего контейнера. Фильтр месяца и поиск переносятся на
     следующую строку (flex-wrap parent остаётся как есть). */
  .pa-4 > .d-flex.flex-wrap.ga-2.align-center > .d-flex.ga-2 {
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    /* На полную ширину чтобы вкладки заняли свою строку и не делили её
       с фильтром месяца / поиском. */
    flex: 1 1 100%;
    min-width: 0;
    padding-bottom: 2px;
  }
  .pa-4 > .d-flex.flex-wrap.ga-2.align-center > .d-flex.ga-2::-webkit-scrollbar {
    display: none;
  }
  .tab-btn {
    flex-shrink: 0;
  }
  /* Поиск и фильтр месяца — на всю ширину следующей строкой. */
  .filter-input-wrap {
    flex: 1 1 100%;
    max-width: 100% !important;
  }

  /* Stat-карточки в шапке — текст чуть мельче чтобы 2-col не ломались. */
  .stat-card { padding: 12px; }
  .stat-value { font-size: 16px; }
  .stat-label { font-size: 11px; }
  .stat-icon { width: 32px; height: 32px; }
}

.pay-card {
  display: flex; flex-direction: column; gap: 6px;
  padding: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.pay-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.25);
}
.pay-card--overdue {
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.02);
}
.pay-card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.pay-card-num {
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.pay-card-deal {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.92);
  line-height: 1.3;
}
.pay-card-client {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.pay-card-phone {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.pay-card-row {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 12px; margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.pay-card-amount-value {
  font-size: 17px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
  display: block;
}
.pay-card-amount-of {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.pay-card-date {
  text-align: right;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.pay-card-due {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 3px;
}
.pay-card-due--overdue {
  color: #ef4444;
  font-weight: 600;
}
.pay-card-actions {
  display: flex; gap: 6px; flex-wrap: wrap;
  margin-top: 6px;
}
.pay-card-actions .action-btn {
  flex: 1 1 auto;
  width: auto;
  height: 38px;
  padding: 0 12px;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

/* Action-кнопки в десктоп-таблице (если виден) — увеличим минимальный
   размер до 36 на мобиле (на случай если таблица всё-таки видна). */
@media (max-width: 767px) {
  .action-btn {
    min-width: 36px;
    min-height: 36px;
  }
}
/* Догрузка платежей дня: день может содержать больше строк, чем один запрос. */
.cal-day-more {
  width: 100%;
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px dashed rgba(0, 0, 0, 0.16);
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--v-theme-primary));
  transition: background-color 0.15s;
}
.cal-day-more:hover:not(:disabled) { background: rgba(var(--v-theme-primary), 0.06); }
.cal-day-more:disabled { opacity: 0.6; }
.dark .cal-day-more { border-color: rgba(255, 255, 255, 0.18); }

/* ── Индикация загрузки списка ── */
.pl-list-wrap { position: relative; }

/* Строки гаснут, а не исчезают: таблица не «прыгает» при переходах. */
.pl-list-wrap--busy > :not(.pl-list-overlay) {
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.pl-list-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  /* Кружок у верхнего края: по центру длинной страницы он был бы за экраном. */
  padding-top: 64px;
  pointer-events: none;
}

.tab-btn:disabled { opacity: 0.5; cursor: default; }

/* ── Скелетон KPI ──
   Пока считаются счётчики, показываем плашку вместо цифры: иначе партнёр
   успевал прочитать значения предыдущей вкладки как значения новой. */
.stat-skel {
  height: 22px;
  border-radius: 6px;
  margin-bottom: 4px;
  background: linear-gradient(90deg,
    rgba(0, 0, 0, 0.06) 25%, rgba(0, 0, 0, 0.11) 37%, rgba(0, 0, 0, 0.06) 63%);
  background-size: 400% 100%;
  animation: pl-skel-shimmer 1.4s ease infinite;
}
.stat-skel--sm { width: 56px; }
.stat-skel--md { width: 108px; }

.dark .stat-skel {
  background: linear-gradient(90deg,
    rgba(255, 255, 255, 0.07) 25%, rgba(255, 255, 255, 0.13) 37%, rgba(255, 255, 255, 0.07) 63%);
  background-size: 400% 100%;
}

@keyframes pl-skel-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

@media (prefers-reduced-motion: reduce) {
  .stat-skel { animation: none; }
}

/* Прилипающая пагинация (ServerPager) требует, чтобы предки не обрезали
   содержимое — у v-card overflow: hidden по умолчанию. */
.payments-card { overflow: visible; }
/* ── Модалка платежей дня ──
   Обычная широкая таблица вместо прежнего узкого списка карточек: подача
   такая же, как в остальных разделах кабинета. */
.day-dialog { display: flex; flex-direction: column; max-height: 86vh; }

.day-dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.day-dialog-title { font-size: 16px; font-weight: 700; }
.day-dialog-sub {
  margin-top: 2px;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.day-dialog-body { padding: 4px 8px 12px; overflow-y: auto; }
.day-dialog-body .cal-day-more { margin: 12px 12px 0; width: calc(100% - 24px); }

@media (max-width: 767px) {
  .day-dialog { max-height: 100vh; }
  /* На телефоне таблица не помещается — даём горизонтальную прокрутку,
     а не ломаем колонки. */
  .day-dialog-body { overflow-x: auto; }
}
</style>
