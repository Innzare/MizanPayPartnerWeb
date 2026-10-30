<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useSections } from '@/composables/useSections'
import { todayIso } from '@/utils/dateInput'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api/client'
import ServerPager from '@/components/ServerPager.vue'
import DateField from '@/components/DateField.vue'
import { useCashBoxesStore, type CashBoxSummary } from '@/stores/cashboxes'
import { useAuthStore } from '@/stores/auth'
import { isAccountNegative, useAccountingStore, type AvailableMoney, type AvailableStep } from '@/stores/accounting'
import { FLOW_ORDER, stepText } from '@/utils/availableSteps'
import BankLogo from '@/components/BankLogo.vue'
import type { CashBoxMonthRow, CashBoxMonthsResponse } from '@/types/analytics'
import type { PeriodRange } from '@/types/reports'
import { rangeForPreset } from '@/composables/useReports'
import CashBoxMonthChart from '@/components/CashBoxMonthChart.vue'
import MonthPaymentsList from '@/components/MonthPaymentsList.vue'
import OperationDialog from '@/components/OperationDialog.vue'
import AccountOperationItems from '@/components/AccountOperationItems.vue'
import { OPERATION_KINDS, type OperationKind } from '@/constants/operationKinds'
import { useToast } from '@/composables/useToast'
import { usePageHeaderStore } from '@/stores/pageHeader'
import { useIsDark } from '@/composables/useIsDark'
import { formatCurrency, formatCurrencyShort, formatDate, formatPhone, CURRENCY_MASK, parseMasked, formatDateShort } from '@/utils/formatters'
import CashflowJournal from '@/components/CashflowJournal.vue'
import AllocateUnallocatedDialog from '@/components/AllocateUnallocatedDialog.vue'
import CashBoxEditDialog from '@/components/CashBoxEditDialog.vue'
import CashBoxResetDialog from '@/components/CashBoxResetDialog.vue'
import CashBoxDeleteDialog from '@/components/CashBoxDeleteDialog.vue'

const route = useRoute()
// Границы даты денежной операции — те же, что при отметке оплаты.
const sections = useSections()
const router = useRouter()
const toast = useToast()
const { isDark } = useIsDark()
const store = useCashBoxesStore()
const auth = useAuthStore()
// Право «Видеть капитал и операции кассы». Без него блок капитала/операций
// скрыт (и мы не грузим финансовые данные, чтобы не ловить 403).
const canSeeCapital = computed(() => auth.can('cashboxes.capitalView'))

// Reactive mobile flag для fullscreen-диалогов на телефонах.
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
function updateMobile() { isMobile.value = window.innerWidth < 768 }
onMounted(() => window.addEventListener('resize', updateMobile))
onUnmounted(() => window.removeEventListener('resize', updateMobile))

const id = computed(() => route.params.id as string)

// ─── Type definitions (mirror finance.vue) ───────────────────────────────
interface CapitalOperation {
  type: 'EXPENSE' | 'INCOME' | 'PAYOUT'
  amount: number
  date: string
  description: string
  dealId: string | null
  productName: string | null
  transactionId?: string
  category?: { id: string; name: string; icon?: string; color?: string }
  isManual?: boolean
}
interface CapitalDealPayment {
  id: string
  number: number
  amount: number
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CLOSED_EARLY'
  dueDate: string
  paidAt: string | null
}
interface CapitalDeal {
  id: string
  productName: string
  client: string | null
  purchasePrice: number
  wholesalePrice?: number | null
  profitSplitBase?: 'MARKUP_ONLY' | 'FULL_MARGIN'
  totalPrice: number
  markup: number
  downPayment: number
  received: number
  status: string
  progress: number
  /** Приходит не со списком, а при раскрытии конкретной сделки. */
  payments?: CapitalDealPayment[]
  // Profit accrued to co-investors on THIS deal. Partner's cut = earned − this.
  coInvestorProfit?: number
  // Per-investor breakdown: name, terms (why), optional clarifying note, amount.
  coInvestorBreakdown?: { id: string; name: string; modeLabel: string; note?: string | null; amount: number }[]
  // Cost-fee rate of this deal (if the investor is in «commission from purchase» mode).
  costFeeRatePct?: number | null
}
interface CapitalDetails {
  initialCapital: number
  // Вложено партнёром сейчас: стартовый капитал кассы + его пополнения −
  // снятое из капитала. Именно эта величина, а не «сырой» initialCapital,
  // входит в totalCapital и показывается в составе капитала.
  investedCapital?: number
  // Phase 2: real CI capital sitting in this cashbox (sum of CI.capital)
  coInvestorCapital: number
  totalCapital: number
  deployed: number
  received: number
  netProfit: number
  // Profit accrued to co-investors (gross netProfit minus this = partner's cut).
  coInvestorProfit?: number
  // Partner's net profit = netProfit − coInvestorProfit.
  partnerNetProfit?: number
  inProgress: number
  // Phase 2 cash-basis: obligation owed to CIs (accrued profit minus paid
  // dividends). Reported but NOT subtracted from availableCapital — the
  // money is still in the cashbox until DIVIDEND_OUT moves it out.
  pendingCIPayout: number
  /** Выводы капитала инвесторов в процессе (схема v2) — обещаны к выдаче. */
  pendingCapitalReturns?: number
  /** Вес партнёра в пуле «по вкладу» сейчас — по правилу кассы. */
  partnerPoolCapital?: number
  // Legacy alias for clients still reading the old field name.
  coInvestorPayout: number
  manualBalance: number
  availableCapital: number
  /**
   * Слагаемые доступного капитала — расходные приходят отрицательными, как
   * лежат в журнале. Сумма всех строк равна availableCapital.
   */
  availableBreakdown?: {
    initialCapital: number
    coInvestorCashIn: number
    received: number
    deployed: number
    dividendOut: number
    manualBalance: number
    capitalTopup: number
    capitalWithdraw: number
    loansNet?: number
    supplierCredit?: number
    supplierPayouts?: number
    journalOther: number
  }
  /** Сколько ещё должны поставщикам — напоминание, из денег кассы не вычитается. */
  supplierDebt?: number
  /**
   * Статистика по сделкам кассы. Раньше веб считал её сам, пройдя по всему
   * массиву сделок; теперь сами сделки приезжают постранично, а суммы даёт
   * сервер — иначе они зависели бы от того, сколько строк успело загрузиться.
   */
  /** Число ручных операций кассы — для кнопки панели (список ленив). */
  manualCount?: number
  /**
   * Из чего сложилось сальдо ручных операций (manualBalance):
   * −expense + income + transfers. Почти всегда это одни расходы по бизнесу,
   * но у части касс есть и прочие доходы, а у старых — переводы между кассами.
   */
  manualBreakdown?: {
    expense: number
    expenseCount: number
    income: number
    incomeCount: number
    transfers: number
  }
  dealsStats?: {
    activeCount: number
    profitCount: number
    activeCost: number
    activeRecovered: number
  }
  // Co-investors of this cashbox with per-deal accrual breakdown (reserve panel).
  coInvestors?: Array<CashBoxCoInvestor & {
    balanceOwed?: number
    /** Хвост за пределами показанного списка сделок (0 — список полный). */
    dealsRest?: { count: number; amount: number }
    deals?: Array<{
      id: string
      productName: string
      amount: number
      /** Вся прибыль сделки на полученные деньги — считает сервер. */
      gross?: number
      purchasePrice?: number
      isCostFee?: boolean
      /** Подпись способа деления: «Фикс 30%» / «По вкладу · комиссия 5%». */
      modeLabel?: string
    }>
  }>
}

interface CashBoxCoInvestor {
  id: string
  name: string
  capital: number
  currentCapital: number
  realizedProfit: number
  totalPayout: number
  // Phase 3: nullable. Set (1..99) = fixed share; null = weight-based.
  profitPercent: number | null
  // Phase 4/5: commission on by-capital share, and cost-fee mode.
  managementFeePct?: number
  costFeeMode?: boolean
  costFeeDefaultRatePct?: number | null
}

// ─── State ────────────────────────────────────────────────────────────────
/**
 * Счета этой кассы — «где лежат её деньги».
 *
 * Касса отвечает на вопрос «чьи деньги», счёт — «где они». Раздел
 * «Бухгалтерия» ведёт счета, а здесь показываем срез по одной кассе, чтобы за
 * ответом не приходилось уходить в другой раздел.
 */
const accounting = useAccountingStore()

const boxAccounts = computed(() =>
  accounting.accounts.filter((a) => !a.disabledAt && a.cashBoxId === id.value),
)

/**
 * Верхняя секция — два ответа об одних и тех же деньгах.
 *
 * «Капитал» отвечает, сколько денег у кассы и из чего они сложились; «Где
 * лежат деньги» — в каком сейфе и на какой карте. Раньше второй ответ висел
 * отдельной плашкой под первым: он читался как довесок, а по смыслу это
 * равноправная половина.
 */
const topTab = ref<'capital' | 'where'>('capital')

/** Сколько денег кассы ещё не разложено по её счетам. */
const unallocated = ref(0)
const showAllocate = ref(false)

async function refreshUnallocated() {
  try {
    unallocated.value = Math.round((await accounting.fetchCashBoxFree(id.value)).unallocated)
  } catch {
    unallocated.value = 0
  }
}

const onAccounts = computed(() =>
  boxAccounts.value.reduce((sum, a) => sum + (a.balance ?? 0), 0),
)

/**
 * Счета кассы по видам денег.
 *
 * Наличные, карты и магазины-партнёры — разные деньги, и складывать их
 * взглядом в один список нельзя: у сейфа и карты разные риски и разный способ
 * добраться до денег. Тот же порядок и те же названия, что в «Бухгалтерии», —
 * человек ходит между разделами и не должен пересобирать картину заново.
 */
const WHERE_GROUPS: Array<{ type: string; title: string; hint: string; icon: string }> = [
  { type: 'CASH', title: 'Наличные', hint: 'Сейф, деньги на руках', icon: 'mdi-cash' },
  { type: 'BANK_CARD', title: 'Банки', hint: 'Карты и счета', icon: 'mdi-credit-card-outline' },
  { type: 'PAYMENT_POINT', title: 'Пункты приёма', hint: 'Магазины, принимающие оплату', icon: 'mdi-store-outline' },
]

const accountGroups = computed(() =>
  WHERE_GROUPS.map((g) => {
    const items = boxAccounts.value.filter((a) => a.type === g.type)
    return { ...g, items, sum: items.reduce((s2, a) => s2 + (a.balance ?? 0), 0) }
  }).filter((g) => g.items.length > 0),
)

/**
 * Все деньги кассы: то, что лежит на счетах, плюс то, что ещё не разложено.
 *
 * Касса в минусе (расходов больше, чем пришло) — показываем тот же минус, что
 * на плитке «Деньги в кассе». Раньше здесь стоял ноль: «не разнесено» в
 * минусе отбрасывалось, и две цифры одной кассы спорили (20 касс на проде).
 */
const boxMoney = computed(() => {
  const cash = capitalDetails.value?.availableCapital
  if (cash != null && cash < 0 && onAccounts.value <= 0) return Math.round(cash)
  return onAccounts.value + Math.max(unallocated.value, 0)
})

/** Доля счёта в деньгах кассы — полосой, чтобы не считать проценты в уме. */
function shareOfBox(amount: number | null): number {
  const total = boxMoney.value
  if (!total || !amount || amount <= 0) return 0
  return Math.round((amount / total) * 100)
}

const allocatedPct = computed(() => {
  const total = boxMoney.value
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((onAccounts.value / total) * 100)))
})

/** Лента месяцев — за тем же правом, что «Аналитика». */
const canSeePlan = computed(() => auth.can('analytics.view'))
const PLAN_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'

// ─── Лента «Касса по месяцам» ───
// Под плитками: плитки — «сейчас», лента — «как шло по месяцам». Тот же
// доступ, что у аналитики (право и тариф); без него — ленты нет вовсе.
const months = ref<CashBoxMonthRow[]>([])
const forecast = ref<CashBoxMonthsResponse['forecast'] | null>(null)
const monthsCanSeeCost = ref(false)
const monthsLoading = ref(false)
const monthsDenied = ref(false)
/**
 * Выбранный месяц ленты: плитки и детали показывают его. '' — «За всё время»,
 * null — лента ещё не загружена (тогда открывается текущий месяц).
 */
const selectedMonth = ref<string | null>(null)
/**
 * С чего открыть кассу: если лента будет, сразу текущий месяц (в том же
 * поясе, что считает сервер), — журнал не грузится сперва за всё время, а
 * потом ещё раз за месяц. Лента потом подтверждает месяц своим ответом.
 */
function initialMonth(): string | null {
  if (!canSeePlan.value || !canSeeCapital.value) return null
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: PLAN_TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`
}
let monthsSeq = 0
async function loadMonths() {
  // Лента стоит в блоке капитала: без права на капитал её некуда показать.
  if (!canSeePlan.value || !canSeeCapital.value || monthsDenied.value) return
  const seq = ++monthsSeq
  monthsLoading.value = true
  try {
    const q = new URLSearchParams({ cashBoxId: id.value, tz: PLAN_TZ })
    const r = await api.get<CashBoxMonthsResponse>(`/analytics/cashbox-months?${q}`)
    if (seq !== monthsSeq) return
    months.value = r.months
    forecast.value = r.forecast
    monthsCanSeeCost.value = r.canSeeCost
    if (selectedMonth.value === null || (selectedMonth.value && !r.months.some((m) => m.month === selectedMonth.value))) {
      selectedMonth.value = r.currentMonth
    }
  } catch (e: any) {
    if (seq !== monthsSeq) return
    // 403 — закрытый раздел, не ошибка; прочий сбой — тихо, лента просто не видна.
    if (e?.status === 403) monthsDenied.value = true
    else console.error('Не удалось загрузить ленту месяцев кассы:', e)
    // Ленты нет — показываем «За всё время», как без неё и было.
    if (!months.value.length) selectedMonth.value = null
  } finally {
    if (seq === monthsSeq) monthsLoading.value = false
  }
}
const monthRow = computed(() => (selectedMonth.value ? months.value.find((m) => m.month === selectedMonth.value) ?? null : null))
/** Журнал под месяцем — сразу на этом месяце. */
const monthPeriod = computed<PeriodRange | undefined>(() => {
  if (!selectedMonth.value) return undefined
  const [y, m] = selectedMonth.value.split('-').map(Number) as [number, number]
  return rangeForPreset('month', new Date(y, m - 1, 1))
})
/** Выбрали месяц (или «За всё время») — выбранная плитка остаётся, меняется её период. */
function selectMonth(m: string) {
  selectedMonth.value = m
  if (!m && wfExpanded.value === 'remaining') wfExpanded.value = 'received'
}
/** Остатки (в отличие от потоков) у будущего месяца неизвестны. */
const STOCK_KEYS = new Set(['available', 'deployed', 'capital', 'pendingCI'])
/** Заголовок меню — выбранный период. */
const navTitle = computed(() => (monthRow.value ? monthPeriod.value?.label ?? monthRow.value.month : 'За всё время'))

const accountsCountLabel = computed(() => {
  const n = boxAccounts.value.length
  const last = n % 10
  const teen = n % 100 >= 11 && n % 100 <= 14
  const word = !teen && last === 1 ? 'счёт' : !teen && last >= 2 && last <= 4 ? 'счёта' : 'счетов'
  return `${n} ${word} этой кассы`
})

const box = ref<CashBoxSummary | null>(null)
const capitalDetails = ref<CapitalDetails | null>(null)
type FlowRow = { key: string; label: string; value: number; hint: string; base?: boolean; total?: boolean; final?: boolean; muted?: boolean }

/**
 * Расклад «Доступно сейчас» по кассе — тот же, что в «Балансе» бухгалтерии:
 * каждое движение своей строкой (вложили и вывели — порознь, а не сальдо),
 * потом поправки, то, чем пользоваться нельзя, и «доступно». Нужен ещё и
 * доступ к остаткам счетов: без него — прежний короткий расклад.
 */
const canSeeAvailable = computed(() => canSeeCapital.value && auth.can('finance.view') && auth.can('accounting.balanceView'))
const avail = ref<AvailableMoney | null>(null)
// Ответ прежней кассы, пришедший после переключения, не должен лечь на новую.
let availSeq = 0
async function loadAvailable() {
  if (!canSeeAvailable.value) return
  const seq = ++availSeq
  try {
    const r = await api.get<AvailableMoney>(`/finance/available?cashBoxId=${encodeURIComponent(id.value)}`)
    if (seq === availSeq) avail.value = r
  } catch {
    if (seq === availSeq) avail.value = null // покажем прежний расклад
  }
}
/** Реинвест и товар в долг — «не живые деньги»: строки приглушены. */
const MUTED_ROWS = new Set(['ciReinvest', 'dividendsReinvested', 'supplierCredit'])
const signed = (st: AvailableStep) => (st.sign === '-' ? -st.amount : st.amount)

const fullAvailableRows = computed<FlowRow[] | null>(() => {
  const a = avail.value
  if (!a) return null
  const order = (st: AvailableStep) => FLOW_ORDER.indexOf(st.group ?? 'other')
  const flow = a.inflow
    .filter((st) => st.group !== 'adjust' && st.amount !== 0)
    .map((st, i) => ({ st, i }))
    .sort((x, y) => order(x.st) - order(y.st) || x.i - y.i)
    .map((x) => x.st)
  const rows: FlowRow[] = []
  for (const st of flow) {
    // Составную строку («вы вложили» = стартовый капитал + пополнения)
    // раскрываем: на странице кассы места хватает, а слагаемые нагляднее.
    const parts = st.detail && st.detail.length > 1 ? st.detail : [st]
    for (const d of parts) {
      if (!d.amount) continue
      const t = stepText(d)
      rows.push({
        key: d.key,
        label: d.key === 'seed' ? 'Стартовый капитал кассы' : t.title,
        value: signed(d),
        hint: t.note,
        muted: MUTED_ROWS.has(d.key),
      })
    }
  }
  rows.push({ key: 'journal', label: 'Деньги в кассе', value: a.flow?.journal ?? 0, hint: '', total: true })
  const adjust = a.inflow.filter((st) => st.group === 'adjust' && st.amount !== 0)
  for (const st of adjust) rows.push({ key: `adj-${st.key}`, label: stepText(st).title, value: signed(st), hint: stepText(st).note })
  if (adjust.length) rows.push({ key: 'cashInBox', label: 'Есть на самом деле', value: a.cashInBox, hint: 'С поправками, о которых журнал кассы не знает', total: true })
  for (const st of a.locked.filter((x) => x.amount !== 0)) {
    const t = stepText(st, true)
    rows.push({ key: `lock-${st.key}`, label: t.title, value: -st.amount, hint: t.note })
  }
  rows.push({ key: 'available', label: 'Доступно сейчас', value: a.available, hint: 'Можно тратить прямо сейчас', total: true, final: true })
  return rows
})

/**
 * Прежний расклад — по сводке кассы (без доступа к остаткам счетов).
 * Порядок — как деньги движутся: сначала то, что в кассу завели, потом
 * обороты по сделкам и выплаты. Нулевые строки прячем, базовые показываем
 * всегда — иначе расклад читается как обрубленный.
 */
const availableRows = computed<FlowRow[]>(() => {
  if (fullAvailableRows.value) return fullAvailableRows.value
  const b = capitalDetails.value?.availableBreakdown
  if (!b) return []
  const rows = [
    { key: 'seed', label: 'Стартовый капитал кассы', value: b.initialCapital, base: true, hint: '', always: true },
    {
      key: 'ci', label: 'Инвесторы: внесли минус вывели', value: b.coInvestorCashIn, base: true,
      hint: 'Вклады инвесторов этой кассы за вычетом возвращённых', always: true,
    },
    {
      key: 'topup', label: 'Пополнения капитала', value: b.capitalTopup, base: false,
      hint: 'Ваши собственные взносы в кассу', always: false,
    },
    {
      key: 'received', label: 'Поступления от клиентов', value: b.received, base: false,
      hint: 'Оплаченные платежи и первоначальные взносы', always: true,
    },
    {
      key: 'deployed', label: 'Закупки по сделкам', value: b.deployed, base: false,
      hint: 'Деньги, вложенные в товар', always: true,
    },
    {
      key: 'dividend', label: 'Выплачено инвесторам', value: b.dividendOut, base: false,
      hint: 'Дивиденды, ушедшие из кассы', always: false,
    },
    {
      key: 'withdraw', label: 'Снятия капитала', value: b.capitalWithdraw, base: false,
      hint: 'Ваши выводы денег из кассы', always: false,
    },
    {
      key: 'manual', label: 'Доходы и расходы', value: b.manualBalance, base: false,
      hint: 'Доходы минус расходы, внесённые вручную', always: false,
    },
    {
      key: 'loans', label: 'Временные операции', value: b.loansNet ?? 0, base: false,
      hint: 'Взяли и вернули в долг, дали и нам вернули', always: false,
    },
    {
      key: 'supplierCredit', label: 'Товар в долг у поставщиков', value: b.supplierCredit ?? 0, base: false,
      hint: 'Закупка взята в долг — из кассы при покупке ничего не ушло', always: false,
    },
    {
      key: 'supplierPayouts', label: 'Выплачено поставщикам', value: b.supplierPayouts ?? 0, base: false,
      hint: 'Деньги, отданные поставщикам за товар, взятый в долг', always: false,
    },
    {
      key: 'other', label: 'Прочие движения', value: b.journalOther, base: false,
      hint: 'Записи журнала, не попавшие в строки выше', always: false,
    },
  ]
  return rows.filter(r => r.always || Math.abs(r.value) > 0)
})

// Инвесторы кассы — из того же ответа details (те же поля и тот же отбор, что
// у /co-investors с фильтром по кассе). Раньше страница отдельно тянула всех
// инвесторов кабинета со статистикой — самый долгий запрос при открытии.
const cashBoxCoInvestors = computed<CashBoxCoInvestor[]>(() =>
  (capitalDetails.value?.coInvestors ?? []).map((ci) => ({
    id: ci.id,
    name: ci.name,
    capital: ci.capital,
    currentCapital: ci.currentCapital,
    realizedProfit: ci.realizedProfit,
    totalPayout: ci.totalPayout,
    profitPercent: ci.profitPercent,
    managementFeePct: ci.managementFeePct,
    costFeeMode: ci.costFeeMode,
    costFeeDefaultRatePct: ci.costFeeDefaultRatePct,
  })),
)
const loading = ref(true)

const showEdit = ref(false)

const pageHeader = usePageHeaderStore()

// Открывается журнал кассы: на странице кассы чаще всего ищут операцию.
// ?section=available — пришли из «Баланса» по кнопке «Доступно сейчас».
const wfExpanded = ref<string | null>(route.query.section === 'available' ? 'available' : 'journal')

/**
 * Разделы водопада: название раздела и пояснение к нему. Заголовок панели
 * справа берётся отсюда, чтобы совпадать с подписью на плитке — иначе не
 * понять, какой именно раздел сейчас открыт.
 */
/** Значок и цвет шапки — те же, что у плитки: видно, чья это панель. */
const WF_SECTIONS: Record<string, { label: string; hint: string; icon: string; color: string }> = {
  capital: { label: 'Общий капитал', hint: 'Сколько денег вложено в дело', icon: 'mdi-bank-outline', color: '#6366f1' },
  profit: { label: 'Чистая прибыль', hint: 'Прибыль по сделкам кассы', icon: 'mdi-trending-up', color: '#10b981' },
  deployed: { label: 'В работе', hint: 'Капитал в активных сделках', icon: 'mdi-progress-clock', color: '#f59e0b' },
  manual: { label: 'Расходы', hint: 'По бизнесу и иные — вносятся в Бухгалтерии', icon: 'mdi-cart-arrow-down', color: '#ef4444' },
  available: { label: 'Деньги в кассе', hint: 'Из чего сложились деньги в кассе', icon: 'mdi-safe-square-outline', color: '#047857' },
  pendingCI: { label: 'Резерв для инвесторов', hint: 'Начислено инвесторам, но ещё не выплачено', icon: 'mdi-account-cash-outline', color: '#f59e0b' },
  journal: { label: 'Журнал кассы', hint: 'Все движения денег кассы', icon: 'mdi-book-open-page-variant-outline', color: '#475569' },
  received: { label: 'Пришло от клиентов', hint: 'Первые взносы и оплаты по графику', icon: 'mdi-cash-plus', color: '#10b981' },
  remaining: { label: 'Осталось получить', hint: 'Неоплаченные платежи месяца', icon: 'mdi-calendar-clock-outline', color: '#4f46e5' },
  forecast: { label: 'Прогноз', hint: 'Платежи по графикам в следующих месяцах', icon: 'mdi-chart-timeline-variant', color: '#4f46e5' },
}
const wfSection = computed(() => (wfExpanded.value ? WF_SECTIONS[wfExpanded.value] : null))

/**
 * Hero выбранной плитки — фирменный зелёный блок, как на «Балансе»: название,
 * главная сумма и то, из чего она сложилась. Раньше эти цифры стояли серыми
 * строками внутри раздела и не отделялись от списка под ними.
 */
interface HeroMetric { label: string; value: string }
type Hero = { title: string; hint: string; icon: string; amount: string | null; metrics: HeroMetric[]; note: string | null }

/** Hero выбранной плитки за месяц: потоки — за месяц, остатки — на его конец. */
function monthHero(key: string, m: CashBoxMonthRow, hero: Hero, money: (n: number) => string, signed: (n: number) => string): Hero {
  const name = monthPeriod.value?.label ?? m.month
  const stock = STOCK_KEYS.has(key)
  hero.hint = `${name} · ${stock ? (m.current ? 'на сегодня' : 'на конец месяца') : 'за месяц'}`
  const est = (n: number) => `≈ ${money(n)}`
  const push = (label: string, value: string) => hero.metrics.push({ label, value })
  const f = m.flows
  const b = m.balances
  if (m.future && stock) {
    hero.amount = '—'
    hero.note = 'Месяц ещё не наступил — остатки станут известны, когда он пройдёт.'
    return hero
  }
  if (key === 'remaining') {
    hero.hint = `${name} · по графикам платежей`
    hero.amount = money(m.unpaid)
    push('Платежей', m.unpaidCount.toLocaleString('ru-RU'))
    push('Из них прибыль ≈', money(m.unpaidGross))
    if (!m.current && !m.future && m.unpaid > 0) hero.note = 'Срок этих платежей прошёл — это просрочка, она же в «Должниках».'
    return hero
  }
  if (key === 'received') {
    if (m.future) {
      hero.amount = est(m.pending)
      push('Платежей по графику', m.pendingCount.toLocaleString('ru-RU'))
      push('Прибыль ≈', money(m.expectedGross))
      hero.note = 'Месяц ещё не наступил — показано ожидаемое по графикам платежей.'
    } else {
      hero.amount = money(m.received)
      push('Оплат', m.paidCount.toLocaleString('ru-RU'))
      push('Из них прибыль', money(m.gross))
      if (m.sales.count) push(`Продаж · ${m.sales.count}`, money(m.sales.total))
      if (m.current && m.pending > 0) push('Ещё ожидается', money(m.pending))
    }
  } else if (key === 'profit') {
    if (m.future) {
      hero.amount = est(m.expectedGross - m.expectedInvestors)
      push('Прибыль кассы ≈', money(m.expectedGross))
      if (m.expectedInvestors) push('Инвесторам ≈', money(m.expectedInvestors))
    } else {
      hero.amount = signed(m.partner)
      push('Прибыль кассы', money(m.gross))
      if (m.investors) push('Инвесторам', money(m.investors))
      if (m.current && m.expectedGross > 0) push('Ещё ожидается ≈', money(m.expectedGross))
    }
  } else if (key === 'manual') {
    hero.amount = signed(f.manualBalance)
    if (f.expenses) push(`Расходы · ${f.expenseCount}`, money(f.expenses))
    if (f.otherExpenses) push(`Иные расходы · ${f.otherExpenseCount}`, money(f.otherExpenses))
    if (f.otherIncome) push('Прочие доходы', `+${money(f.otherIncome)}`)
    if (f.cashboxTransfers) push('Переводы между кассами', signed(f.cashboxTransfers))
  } else if (key === 'available' && b) {
    hero.amount = money(b.cashEnd)
    push('На начало месяца', money(b.cashStart))
    push('Пришло за месяц', `+${money(f.in)}`)
    push('Ушло за месяц', `−${money(f.out)}`)
    if (m.current && f.futureDated) push('Записи будущей датой', signed(f.futureDated))
  } else if (key === 'deployed' && b) {
    hero.amount = money(b.inWorkEnd)
    push('Активных сделок', b.activeDealsEnd.toLocaleString('ru-RU'))
    if (f.deployed) push('В закупки за месяц', money(-f.deployed))
    if (m.received - m.gross > 0) push('Вернулось закупки', money(m.received - m.gross))
  } else if (key === 'capital' && b) {
    hero.amount = money(b.totalCapitalEnd)
    push('Ваш капитал', money(b.investedEnd))
    if (b.ciCapitalEnd) push('Капитал инвесторов', money(b.ciCapitalEnd))
    if (f.seed + f.topup) push('Вы вложили за месяц', `+${money(f.seed + f.topup)}`)
    if (f.partnerOut) push('Вы забрали за месяц', money(f.partnerOut))
    if (f.ciIn) push('Инвесторы внесли', `+${money(f.ciIn)}`)
    if (f.ciOut) push('Инвесторы вывели', money(f.ciOut))
  } else if (key === 'pendingCI' && b) {
    hero.amount = money(b.owedEnd)
    if (m.investors) push('Начислено за месяц', money(m.investors))
    if (f.investorsPaid) push('Выплачено за месяц', money(f.investorsPaid))
    if (f.investorsReinvested) push('В капитал (реинвест)', money(f.investorsReinvested))
  }
  return hero
}

const wfHero = computed(() => {
  const d = capitalDetails.value
  const sec = wfSection.value
  const key = wfExpanded.value
  if (!d || !sec || !key) return null
  const hero: Hero = {
    title: sec.label,
    hint: sec.hint,
    icon: sec.icon,
    amount: null,
    metrics: [],
    note: null,
  }
  const money = (n: number) => formatCurrency(Math.round(n))
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCurrency(Math.abs(Math.round(n)))}`
  const m = monthRow.value
  if (key === 'forecast') {
    const f = forecast.value
    hero.hint = 'Неоплаченные платежи по графикам после текущего месяца'
    hero.amount = money(f?.amount ?? 0)
    if (f) {
      hero.metrics.push({ label: 'Платежей', value: f.count.toLocaleString('ru-RU') })
      hero.metrics.push({ label: 'Месяцев', value: f.months.length.toLocaleString('ru-RU') })
      hero.metrics.push({ label: 'Из них прибыль ≈', value: money(f.gross) })
      if (f.investors) {
        hero.metrics.push({ label: 'Инвесторам ≈', value: money(f.investors) })
        hero.metrics.push({ label: 'Вам ≈', value: money(f.gross - f.investors) })
      }
    }
    return hero
  }
  if (m) return monthHero(key, m, hero, money, signed)
  if (key === 'received') {
    hero.amount = money(d.availableBreakdown?.received ?? 0)
    hero.note = 'Все деньги, полученные от клиентов: первые взносы и оплаты по графику.'
  }
  if (key === 'capital') {
    const own = d.investedCapital ?? d.initialCapital
    hero.amount = money(d.totalCapital)
    hero.metrics.push({ label: 'Собственный капитал кассы', value: money(own) })
    if (own !== d.initialCapital) hero.metrics.push({ label: 'Из них стартовый капитал', value: money(d.initialCapital) })
    if (d.coInvestorCapital > 0) hero.metrics.push({ label: 'Капитал инвесторов', value: money(d.coInvestorCapital) })
  } else if (key === 'profit') {
    hero.amount = signed(d.partnerNetProfit ?? d.netProfit)
    if ((d.coInvestorProfit ?? 0) > 0) {
      hero.metrics.push({ label: 'Вся прибыль сделок', value: money(d.netProfit) })
      hero.metrics.push({ label: 'Инвесторам', value: money(d.coInvestorProfit ?? 0) })
    }
    if (profitDeals.value.total) hero.metrics.push({ label: 'Сделок с прибылью', value: profitDeals.value.total.toLocaleString('ru-RU') })
  } else if (key === 'deployed') {
    hero.amount = money(d.inProgress)
    hero.metrics.push({ label: 'Закупка по активным сделкам', value: money(activeDealsPurchaseTotal.value) })
    hero.metrics.push({
      label: 'Возврат закупки клиентами',
      value: activeDealsCostRecovered.value > 0 ? `−${money(activeDealsCostRecovered.value)}` : money(0),
    })
    hero.metrics.push({ label: 'Активных сделок', value: (d.dealsStats?.activeCount ?? 0).toLocaleString('ru-RU') })
    hero.note = 'Каждый платёж клиента делится на возврат закупки и прибыль в пропорции «наценка / итоговая цена». Прибыль учитывается отдельно.'
  } else if (key === 'manual') {
    const b = d.manualBreakdown
    hero.amount = signed(d.manualBalance)
    if (b) {
      hero.metrics.push({ label: `Расходы · ${b.expenseCount}`, value: b.expense > 0 ? `−${money(b.expense)}` : money(0) })
      if (b.income) hero.metrics.push({ label: `Прочие доходы · ${b.incomeCount}`, value: `+${money(b.income)}` })
      if (b.transfers) hero.metrics.push({ label: 'Старые переводы между кассами', value: signed(b.transfers) })
    }
  } else if (key === 'available') {
    hero.amount = money(d.availableCapital)
    hero.note = 'Реальные деньги кассы на сейчас. Обязательства перед инвесторами сюда не заложены — они в «Резерве для инвесторов».'
    if (d.pendingCIPayout > 0) hero.metrics.push({ label: 'Резерв для инвесторов (не вычтен)', value: money(d.pendingCIPayout) })
  } else if (key === 'pendingCI') {
    hero.amount = money(d.pendingCIPayout)
    hero.metrics.push({ label: 'Инвесторов к выплате', value: pendingCiList.value.length.toLocaleString('ru-RU') })
    hero.note = 'Деньги, причитающиеся инвесторам, но ещё физически в кассе. Из денег кассы не вычитаются — уйдут при выплате дивидендов.'
  }
  return hero
})

/**
 * Длинные списки в панели — по 20 строк, нашей обычной пагинацией: у кассы
 * бывает несколько десятков инвесторов, и панель вытягивалась на экраны.
 */
const WF_PAGE = 20
const ciPage = ref(1)
const reservePage = ref(1)
watch(wfExpanded, () => {
  ciPage.value = 1
  reservePage.value = 1
})
function pageOf<T>(list: T[], page: number): T[] {
  return list.slice((page - 1) * WF_PAGE, page * WF_PAGE)
}
const expandedInProfit = ref<Set<string>>(new Set())
const expandedInProgress = ref<Set<string>>(new Set())
const expandedReserveCi = ref<Set<string>>(new Set())
function toggleReserveCi(id: string) {
  const next = new Set(expandedReserveCi.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expandedReserveCi.value = next
}


// ─── Loaders ──────────────────────────────────────────────────────────────
async function loadAll() {
  loading.value = true
  try {
    const [b] = await Promise.all([
      store.findById(id.value),
      store.items.length === 0 ? store.fetchAll() : Promise.resolve(),
      // Финансовые данные грузим только при наличии права — иначе 403.
      canSeeCapital.value ? loadDetails() : Promise.resolve(),
      // Счета нужны для вкладки «где лежат деньги»; сбой не должен ронять кассу.
      canSeeCapital.value ? accounting.fetchAccounts().catch(() => {}) : Promise.resolve(),
      canSeeCapital.value ? refreshUnallocated() : Promise.resolve(),
    ])
    box.value = b
  } catch (e: any) {
    toast.error(e, 'Не удалось загрузить кассу')
    router.push('/cashboxes')
  } finally {
    loading.value = false
  }
}

async function loadDetails() {
  try {
    // slim=1 — только агрегаты: списки сделок и лента приезжают постранично.
    // Без этого признака сервер отдаёт прежний тяжёлый ответ (нужен мобильному
    // приложению, пока оно не переведено на новые эндпоинты).
    // ciDeals=0 — без сделок инвесторов: это самый долгий кусок, а нужен он
    // только панели «Резерв» — она грузит его сама (loadCiDeals).
    capitalDetails.value = await api.get<CapitalDetails>(`/cashboxes/${id.value}/capital/details?slim=1&ciDeals=0`)
  } catch (e: any) {
    toast.error(e, 'Не удалось загрузить детали кассы')
  }
}

// After mutating manual operations the cashbox balance (manualBalance) and
// per-box summary cards on /cashboxes both change. Refresh both: details
// (waterfall + operations tab) and the store-cached summaries (cashbox list).
async function refreshAfterMutation() {
  await Promise.all([
    loadDetails(),
    store.fetchAll(),
    // Списки тоже устаревают: раньше их привозил тот же запрос, что и суммы.
    // Без этого удалённая операция оставалась на экране, а счётчик и итоги
    // уже показывали новое значение — экран спорил сам с собой.
    manualOperations.value.length || wfExpanded.value === 'manual' ? loadManualOperations() : Promise.resolve(),
    avail.value || wfExpanded.value === 'available' ? loadAvailable() : Promise.resolve(),
    ciDeals.value || wfExpanded.value === 'pendingCI' ? loadCiDeals() : Promise.resolve(),
    months.value.length ? loadMonths() : Promise.resolve(),
  ])
  // Re-sync local `box` with the refreshed store data so the header values
  // (balance, dealsCount, activeDealsCount) stay in sync without remounting.
  const fresh = store.items.find((b) => b.id === id.value)
  if (fresh) box.value = fresh
}

watch(() => id.value, () => {
  // Сбрасываем всё постраничное: в текущей навигации компонент пересоздаётся,
  // но если появится переход «соседняя касса», без сброса покажутся её данные.
  manualOperations.value = []
  profitDeals.value = emptySection()
  activeDeals.value = emptySection()
  dealPayments.value = {}
  avail.value = null
  availSeq++
  ciDeals.value = null
  ciDealsSeq++
  months.value = []
  forecast.value = null
  // Пунктов «Осталось получить» и «Прогноз» у другой кассы может не быть.
  if (wfExpanded.value === 'remaining' || wfExpanded.value === 'forecast') wfExpanded.value = 'journal'
  // Ответ прежней кассы, если ещё в пути, не должен лечь на новую.
  monthsSeq++
  selectedMonth.value = initialMonth()
  void loadMonths()
  void loadAvailable()
  void loadAll()
})
// В шапку — имя кассы. Чистим при уходе, иначе оно утечёт на соседний экран.
watch(box, (b) => { if (b) pageHeader.set(b.name) }, { immediate: true })
onUnmounted(() => pageHeader.clear())

// Лента месяцев — после основных цифр: первая отрисовка кассы её не ждёт.
// Лента и разбор «доступно» — независимые запросы: идут вместе с основными
// цифрами, а не после них. Первую отрисовку кассы они не держат.
onMounted(() => {
  selectedMonth.value = initialMonth()
  void loadMonths()
  // Из разбора «доступно» — долги по временным операциям.
  void loadAvailable()
  void loadAll()
})

// ─── Helpers (mirror finance.vue) ─────────────────────────────────────────
const PAYMENT_STATUS_LABEL: Record<CapitalDealPayment['status'], string> = {
  PENDING: 'Ожидается',
  PAID: 'Оплачено',
  OVERDUE: 'Просрочено',
  CLOSED_EARLY: 'Закрыто досрочно',
}

function dealRealCost(d: CapitalDeal): number {
  return d.wholesalePrice != null && d.wholesalePrice > 0 ? d.wholesalePrice : d.purchasePrice
}
function dealTotalMargin(d: CapitalDeal): number {
  const retailMargin = d.wholesalePrice != null && d.wholesalePrice > 0
    ? Math.max(0, d.purchasePrice - d.wholesalePrice)
    : 0
  return retailMargin + d.markup
}
function dealCostRatio(d: CapitalDeal): number {
  return d.totalPrice > 0 ? dealRealCost(d) / d.totalPrice : 0
}
function dealCostRecovered(d: CapitalDeal): number {
  return Math.round(d.received * dealCostRatio(d))
}
function dealProfitEarned(d: CapitalDeal): number {
  if (d.totalPrice <= 0) return 0
  // Кламп [0,1]: прибыль не может превышать полученные деньги (битые данные —
  // наценка в рублях при цене в тысячах — иначе дают коэффициент в сотни раз).
  return Math.round(d.received * Math.min(dealTotalMargin(d) / d.totalPrice, 1))
}
// Partner's own cut on this deal = earned profit minus co-investors' share.
function dealPartnerProfit(d: CapitalDeal): number {
  return Math.max(0, dealProfitEarned(d) - (d.coInvestorProfit ?? 0))
}
// Доля партнёра в прибыли конкретной сделки (для полоски в раскладе).
function dealPartnerPct(d: CapitalDeal): number {
  const gross = dealProfitEarned(d)
  if (gross <= 0) return 100
  return Math.round((dealPartnerProfit(d) / gross) * 100)
}
// Cost-fee-раскладку («возврат закупки») показываем только когда инвестор
// в этой сделке ОДИН и он cost-fee (иначе легаси-микс нарисовал бы возврат
// закупки чужому by-capital инвестору).
function isSoleCostFee(d: CapitalDeal): boolean {
  return d.costFeeRatePct != null && (d.coInvestorBreakdown?.length ?? 0) === 1
}
// Числовое пояснение доли инвестора для фикс/по-вкладу (как у cost-fee выше):
// «30% от 15 000 ₽» для фикса, «≈14% от 15 000 ₽ по вкладу» — для по-вкладу.
function dealCiFormula(d: CapitalDeal, ci: { modeLabel: string; amount: number }): string {
  const earned = dealProfitEarned(d)
  if (earned <= 0) return ''
  const pct = Math.round((ci.amount / earned) * 100)
  if (ci.modeLabel.startsWith('Фикс')) return `${pct}% от ${formatCurrencyShort(earned)}`
  return `≈${pct}% от ${formatCurrencyShort(earned)} по вкладу`
}
function dealInProgress(d: CapitalDeal): number {
  return Math.max(dealRealCost(d) - dealCostRecovered(d), 0)
}
function dealProfitRemaining(d: CapitalDeal): number {
  return Math.max(dealTotalMargin(d) - dealProfitEarned(d), 0)
}
function paymentProfit(d: CapitalDeal, p: CapitalDealPayment): number {
  if (d.totalPrice <= 0) return 0
  return Math.round(p.amount * Math.min(dealTotalMargin(d) / d.totalPrice, 1))
}

function toggleProfitDeal(id: string) {
  const next = new Set(expandedInProfit.value)
  if (next.has(id)) next.delete(id); else { next.add(id); loadDealPayments(id) }
  expandedInProfit.value = next
}
function toggleProgressDeal(id: string) {
  const next = new Set(expandedInProgress.value)
  if (next.has(id)) next.delete(id); else { next.add(id); loadDealPayments(id) }
  expandedInProgress.value = next
}

// ─── Derived ─────────────────────────────────────────────────────────────
/**
 * Плитки кассы — сначала потоки (пришло, прибыль, расходы), потом остатки
 * (деньги, в работе, капитал, резерв, долг поставщикам). За всё время — итоги
 * и остатки на сегодня; за месяц — движение месяца и остатки на его конец.
 */
/** Группы навигации: что за период, что впереди, что есть и что должны. */
type WfGroup = 'top' | 'flow' | 'expect' | 'stock' | 'debt'
interface WfTile {
  key: string
  group: WfGroup
  value: string
  label: string
  reserve?: boolean
  danger?: boolean
  muted?: boolean
  info?: string
  /** Сколько штук за пунктом (платежей, сделок, операций) — своим цветом рядом с названием. */
  count?: number
  /** Цвет суммы: пришло — зелёный, ушло — красный, ожидается — синий, как в «Аналитике». */
  tone?: 'in' | 'out' | 'expect'
}
/** Группы — по смыслу; цвет у сумм движения, ожидаемого и долгов. */
const WF_GROUPS: Array<{ key: WfGroup; title: string }> = [
  { key: 'flow', title: 'Движение' },
  { key: 'expect', title: 'Ожидается' },
  { key: 'stock', title: 'Остатки' },
  { key: 'debt', title: 'Долги' },
]
const tiles = computed<WfTile[]>(() => {
  const d = capitalDetails.value
  if (!d || !box.value) return []
  const fmt = (n: number) => formatCurrency(Math.round(n))
  const signedFmt = (n: number) => `${n > 0 ? '+' : ''}${fmt(n)}`
  const m = monthRow.value
  const b = m?.balances ?? null
  const none = '—'
  const out: WfTile[] = []
  const reserveDanger = d.availableCapital < d.pendingCIPayout
  // Цифры «на сегодня» в прошлом месяце — приглушены: помесячно они не ведутся.
  const todayOnly = !!m && !m.current

  // Общий капитал — главная цифра кассы, сразу под журналом.
  out.push({
    key: 'capital', group: 'top', label: 'Общий капитал',
    value: m ? (b ? fmt(b.totalCapitalEnd) : none) : fmt(d.totalCapital),
  })

  // Движение за период. У будущего месяца это ожидаемое — синим.
  const sign = (n: number): WfTile['tone'] => (n > 0 ? 'in' : n < 0 ? 'out' : undefined)
  const flowTone = (n: number): WfTile['tone'] => (m?.future ? 'expect' : sign(n))
  out.push({
    key: 'received', group: 'flow', label: 'Пришло от клиентов',
    value: !m ? fmt(d.availableBreakdown?.received ?? 0) : m.future ? `≈ ${fmt(m.pending)}` : fmt(m.received),
    tone: flowTone(1),
  })
  out.push({
    key: 'profit', group: 'flow', label: 'Чистая прибыль',
    value: !m
      ? signedFmt(d.partnerNetProfit ?? d.netProfit)
      : m.future ? `≈ ${fmt(m.expectedGross - m.expectedInvestors)}` : signedFmt(m.partner),
    tone: flowTone(!m ? d.partnerNetProfit ?? d.netProfit : m.future ? 1 : m.partner),
  })
  if (!m) {
    if (d.manualBalance !== 0 || (d.manualCount ?? 0) > 0 || manualOperations.value.length > 0) {
      out.push({
        key: 'manual', group: 'flow', value: signedFmt(d.manualBalance), tone: sign(d.manualBalance),
        label: 'Расходы', count: d.manualBreakdown?.expenseCount ?? d.manualCount ?? 0,
      })
    }
  } else {
    out.push({
      key: 'manual', group: 'flow',
      value: m.future && !m.flows.manualBalance ? none : signedFmt(m.flows.manualBalance),
      tone: sign(m.flows.manualBalance),
      label: 'Расходы', count: m.flows.expenseCount + m.flows.otherExpenseCount,
    })
  }

  // Ожидается: остаток выбранного месяца и всё, что после текущего.
  if (m) {
    const overdue = !m.current && !m.future && m.unpaid > 0
    out.push({
      key: 'remaining', group: 'expect', label: 'Осталось получить', count: m.unpaidCount,
      value: fmt(m.unpaid), tone: 'expect',
      info: overdue ? 'Срок прошёл — это просрочка' : 'Неоплаченные платежи этого месяца',
    })
  }
  if (forecast.value?.count) {
    out.push({
      key: 'forecast', group: 'expect', label: 'Прогноз', count: forecast.value.count,
      value: fmt(forecast.value.amount), tone: 'expect',
      info: 'Платежи по графикам после текущего месяца',
    })
  }

  // Остатки: на конец месяца (у текущего — на сегодня).
  out.push({
    key: 'available', group: 'stock', label: 'Деньги в кассе',
    value: m ? (b ? fmt(b.cashEnd) : none) : fmt(d.availableCapital),
    info: 'Реальные деньги кассы',
  })
  out.push({
    key: 'deployed', group: 'stock',
    label: 'В работе', count: m ? b?.activeDealsEnd : d.dealsStats?.activeCount ?? 0,
    value: m ? (b ? `-${fmt(b.inWorkEnd)}` : none) : `-${fmt(d.inProgress)}`,
  })

  // Долги: что мы должны и что должны нам.
  if (!m ? d.pendingCIPayout > 0 : (b?.owedEnd ?? 0) > 0 || d.pendingCIPayout > 0) {
    out.push({
      key: 'pendingCI', group: 'debt', reserve: true,
      label: 'Резерв для инвесторов', count: m ? undefined : pendingCiList.value.length,
      value: !m ? fmt(d.pendingCIPayout) : b ? fmt(b.owedEnd) : none,
    })
  }
  if ((d.supplierDebt ?? 0) > 0) {
    out.push({
      key: 'supplier', group: 'debt', value: fmt(d.supplierDebt ?? 0), label: 'Долг поставщикам',
      reserve: true, muted: todayOnly,
      info: 'Не вычитается из денег кассы — это напоминание, сколько вы ещё должны за товар',
    })
  }
  const borrowed = avail.value?.notes.borrowed ?? 0
  if (borrowed > 0) {
    out.push({
      key: 'borrowed', group: 'debt', value: fmt(borrowed), label: 'Взяли в долг',
      reserve: true, muted: todayOnly, info: 'Временные операции: взято и ещё не возвращено',
    })
  }
  const lent = avail.value?.notes.lentOut ?? 0
  if (lent > 0) {
    out.push({
      key: 'lent', group: 'debt', value: fmt(lent), label: 'Дали в долг',
      muted: todayOnly, info: 'Временные операции: должны нам — дали и ещё не вернули',
    })
  }
  return out
})
const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
function monthTitle(ym: string) {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return `${MONTH_NAMES[m - 1]} ${y}`
}
/** Строка прогноза → этот месяц на ленте и его неоплаченные платежи. */
function openForecastMonth(m: string) {
  selectMonth(m)
  wfExpanded.value = 'remaining'
}
const capitalTile = computed(() => tiles.value.find((t) => t.group === 'top') ?? null)
const navGroups = computed(() =>
  WF_GROUPS.map((g) => ({ ...g, items: tiles.value.filter((t) => t.group === g.key) })).filter((g) => g.items.length),
)
function openTile(key: string) {
  if (key === 'supplier') router.push({ path: '/suppliers', query: { debt: '1' } })
  else if (key === 'borrowed' || key === 'lent') {
    router.push({ path: '/accounting/temporary-ops', query: { cashBoxId: id.value, tab: key === 'borrowed' ? 'in' : 'out' } })
  } else wfExpanded.value = key
}

// Суммы по активным сделкам считает сервер: в браузере лежит одна страница
// списка, и складывать её строки было бы неверно.
const activeDealsPurchaseTotal = computed(() => capitalDetails.value?.dealsStats?.activeCost ?? 0)
const activeDealsCostRecovered = computed(() => capitalDetails.value?.dealsStats?.activeRecovered ?? 0)

// ══════════════════════════════════════════════════════════════════
// Списки сделок раскрывающихся блоков — серверные страницы
//
// Раньше карточка получала ВСЕ сделки кассы вместе с графиками платежей:
// 14 813 сделок и 93 998 платежей, 39,7 МБ на запрос. Теперь блоки «Прибыль
// по сделкам» и «В работе» листаются, а графики грузятся при раскрытии
// конкретной сделки.
// ══════════════════════════════════════════════════════════════════

const DEALS_PAGE = 25

/** Одна страница списка сделок для блока. */
interface DealsSection {
  items: CapitalDeal[]
  total: number
  page: number
  loading: boolean
}
function emptySection(): DealsSection {
  return { items: [], total: 0, page: 1, loading: false }
}

const profitDeals = ref<DealsSection>(emptySection())
const activeDeals = ref<DealsSection>(emptySection())

// Защита от гонок: блок можно свернуть и развернуть быстрее, чем придёт ответ.
const dealsReq = { profit: 0, active: 0 }

async function loadDealsSection(kind: 'profit' | 'active') {
  const section = kind === 'profit' ? profitDeals : activeDeals
  const req = ++dealsReq[kind]
  section.value.loading = true
  try {
    const qs = new URLSearchParams({
      filter: kind,
      limit: String(DEALS_PAGE),
      offset: String((section.value.page - 1) * DEALS_PAGE),
    })
    const res = await api.get<{ items: CapitalDeal[]; total: number }>(
      `/cashboxes/${id.value}/capital/deals?${qs}`,
    )
    if (req !== dealsReq[kind]) return
    section.value.items = res.items
    section.value.total = res.total
  } catch (e: any) {
    // «Не загрузилось» и «нет данных» — разные вещи: на финансовом экране
    // пустой список без объяснения читается как «сделок нет».
    if (req === dealsReq[kind]) {
      section.value.items = []
      section.value.total = 0
      toast.error(e, 'Не удалось загрузить сделки')
    }
  } finally {
    if (req === dealsReq[kind]) section.value.loading = false
  }
}

/** График платежей сделки — грузится при раскрытии строки. */
const dealPayments = ref<Record<string, CapitalDealPayment[]>>({})
const dealPaymentsLoading = ref<Set<string>>(new Set())

async function loadDealPayments(dealId: string) {
  if (dealPayments.value[dealId] || dealPaymentsLoading.value.has(dealId)) return
  const busy = new Set(dealPaymentsLoading.value)
  busy.add(dealId)
  dealPaymentsLoading.value = busy
  try {
    const list = await api.get<CapitalDealPayment[]>(`/payments/deal/${dealId}`)
    dealPayments.value = { ...dealPayments.value, [dealId]: list }
  } catch {
    dealPayments.value = { ...dealPayments.value, [dealId]: [] }
  } finally {
    const next = new Set(dealPaymentsLoading.value)
    next.delete(dealId)
    dealPaymentsLoading.value = next
  }
}

// Списки грузятся, только когда их открывают: до этого они не нужны.
watch(wfExpanded, (v) => {
  if (v === 'profit' && !profitDeals.value.items.length) loadDealsSection('profit')
  if (v === 'deployed' && !activeDeals.value.items.length) loadDealsSection('active')
  if (v === 'manual' && !manualOperations.value.length) loadManualOperations()
  if (v === 'available' && !avail.value) loadAvailable()
  if (v === 'pendingCI' && !ciDeals.value) loadCiDeals()
}, { immediate: true })
watch(() => profitDeals.value.page, () => loadDealsSection('profit'))
watch(() => activeDeals.value.page, () => loadDealsSection('active'))



// Последние расходы по бизнесу — для панели плитки. Весь список и правка — в
// «Бухгалтерии → Пополнения и расходы», здесь только несколько свежих строк.
const MANUAL_RECENT = 8
const manualOperations = ref<CapitalOperation[]>([])
async function loadManualOperations() {
  try {
    const res = await api.get<{ items: CapitalOperation[] }>(
      `/cashboxes/${id.value}/capital/operations?kinds=MANUAL_EXPENSE&limit=${MANUAL_RECENT}`,
    )
    manualOperations.value = res.items
  } catch {
    manualOperations.value = []
  }
}

// Phase 3: per-CI share labels. fixed-% CIs take their slice first; weight
// CIs split (100 − Σ fixedPct) pro-rata by currentCapital. Mirrors backend
// accrueProfit so partner sees the same numbers the engine uses.
const ciShareLabels = computed(() => {
  const cis = cashBoxCoInvestors.value
  const fixedTotal = cis.reduce(
    (s, ci) => s + (ci.profitPercent != null && ci.profitPercent > 0 ? ci.profitPercent : 0),
    0,
  )
  const remainderPct = Math.max(100 - fixedTotal, 0)
  // By-capital pool EXCLUDES cost-fee CIs (their capital isn't part of the
  // pooled split) and, mirroring the engine, includes the partner's own
  // capital only when the cashbox flag is set.
  const weightSum = cis
    .filter((ci) => ci.profitPercent == null && !ci.costFeeMode)
    .reduce((s, ci) => s + (ci.currentCapital || 0), 0)
  // Вес партнёра — как считает сервер: его деньги в кассе (и прибыль прошлых
  // месяцев, если она работает как капитал); нет капитала — только управляет.
  const partnerCap = capitalDetails.value?.partnerPoolCapital ?? 0
  const pool = weightSum + partnerCap

  const labels: Record<string, { label: string; kind: 'fixed' | 'weight' | 'costfee'; icon: string }> = {}
  for (const ci of cis) {
    if (ci.costFeeMode) {
      // Cost-fee: rate is per-deal, so the cashbox view just names the mode.
      labels[ci.id] = {
        label: `Комиссия от закупки${ci.costFeeDefaultRatePct != null ? ` ${ci.costFeeDefaultRatePct}%` : ''}`,
        kind: 'costfee',
        icon: 'mdi-tag-outline',
      }
    } else if (ci.profitPercent != null && ci.profitPercent > 0) {
      labels[ci.id] = {
        label: `Фикс ${ci.profitPercent}%`,
        kind: 'fixed',
        icon: 'mdi-handshake-outline',
      }
    } else if (pool > 0 && (ci.currentCapital || 0) > 0) {
      // gross share by capital weight, minus the partner's commission on it.
      const gross = ((ci.currentCapital || 0) / pool) * remainderPct
      const eff = gross * (1 - (ci.managementFeePct ?? 0) / 100)
      labels[ci.id] = {
        label: `По вкладу ${eff.toFixed(1)}%`,
        kind: 'weight',
        icon: 'mdi-scale-balance',
      }
    } else {
      labels[ci.id] = { label: 'По вкладу', kind: 'weight', icon: 'mdi-scale-balance' }
    }
  }
  return labels
})

// Phase 2: CIs in this cashbox with a pending dividend balance (realized
// profit not yet paid out). Drives the "Резерв для инвесторов" breakdown
// panel — clicking the reserve row opens this per-CI list with amounts owed.
/** Сделки инвесторов для панели «Резерв» — грузятся при её открытии. */
type CiDealsRow = { id: string; deals: NonNullable<NonNullable<CapitalDetails['coInvestors']>[number]['deals']>; dealsRest: { count: number; amount: number } }
const ciDeals = ref<Map<string, CiDealsRow> | null>(null)
const ciDealsLoading = ref(false)
let ciDealsSeq = 0
async function loadCiDeals() {
  if (!canSeeCapital.value) return
  const seq = ++ciDealsSeq
  ciDealsLoading.value = true
  try {
    const rows = await api.get<CiDealsRow[]>(`/cashboxes/${id.value}/capital/ci-deals`)
    if (seq === ciDealsSeq) ciDeals.value = new Map(rows.map((r) => [r.id, r]))
  } catch (e: any) {
    if (seq === ciDealsSeq) toast.error(e, 'Не удалось загрузить сделки инвесторов')
  } finally {
    if (seq === ciDealsSeq) ciDealsLoading.value = false
  }
}

const pendingCiList = computed(() =>
  // From capitalDetails.coInvestors (carries per-deal accrual breakdown), not the
  // separate /co-investors list — so the reserve shows WHICH deals it came from.
  (capitalDetails.value?.coInvestors ?? [])
    .map((ci) => ({
      ...ci,
      pendingPayout: ci.balanceOwed ?? Math.max(0, (ci.realizedProfit ?? 0) - (ci.totalPayout ?? 0)),
      // Обогащаем каждую сделку разбором доли этого инвестора (как в «Чистой прибыли»).
      // Поля сделки приходят вместе с суммой: общего списка сделок на клиенте
      // больше нет (он весил мегабайты).
      dealsRest: ciDeals.value?.get(ci.id)?.dealsRest ?? ci.dealsRest,
      deals: (ciDeals.value?.get(ci.id)?.deals ?? ci.deals ?? []).map((dl) => {
        const gross = dl.gross ?? 0
        return {
          id: dl.id,
          productName: dl.productName,
          amount: dl.amount, // прибыль инвестора с этой сделки (идёт в резерв)
          gross, // вся прибыль сделки
          isCostFee: dl.isCostFee ?? false,
          purchasePrice: dl.purchasePrice ?? 0,
          partnerShare: Math.max(0, gross - dl.amount),
          onHand: (dl.purchasePrice ?? 0) + dl.amount, // на руки (для cost-fee)
          // Подпись способа деления приходит с сервера («Фикс 30%», «По
          // вкладу · комиссия 5%») — раньше она терялась для всех, кроме
          // режима комиссии.
          mode: dl.modeLabel ?? (dl.isCostFee ? 'Комиссия от закупки' : ''),
        }
      }),
    }))
    .filter((ci) => ci.pendingPayout > 0)
    .sort((a, b) => b.pendingPayout - a.pendingPayout),
)

// ─── Капитал кассы: вложенное, доход к снятию, доступно ──────────────────
// Вложение и снятие капитала теперь вносятся в «Бухгалтерии → Приход и
// расход» (кнопка в шапке ведёт туда), здесь — только цифры для карточки.
// Обязательство перед со-инвесторами (cash-basis: деньги ещё в кассе).
const pendingCIPayout = computed(() => capitalDetails.value?.pendingCIPayout ?? 0)

// ─── «Пополнить / снять» прямо со страницы кассы ───────────────────────────────
// Те же формы, что в Бухгалтерии; касса подставлена и не меняется. Сначала
// главное — капитал и прибыль, затем расходы, внизу временные операции.
const CASHBOX_OPS: Array<{ title: string; kinds: OperationKind[] }> = [
  { title: 'Основные', kinds: ['DEPOSIT', 'WITHDRAW_PROFIT', 'WITHDRAW_OWNER'] },
  { title: 'Расходы', kinds: ['EXPENSE', 'OTHER_EXPENSE'] },
  { title: 'Временные', kinds: ['BORROW', 'LEND', 'PENDING_OUT', 'PENDING_IN'] },
]
const canAnyOp = computed(() =>
  CASHBOX_OPS.some((sec) => sec.kinds.some((k) => {
    const info = OPERATION_KINDS.find((x) => x.kind === k)
    return !!info && auth.can(info.permission)
  })),
)
const opMenu = ref(false)
const opDialog = ref(false)
const opKind = ref<OperationKind>('DEPOSIT')
function pickOp(k: OperationKind) {
  opMenu.value = false
  opKind.value = k
  opDialog.value = true
}

// ─── Пополнения и расходы — в Бухгалтерии ─────────────────────────────────────
// Ручные движения денег (капитал, доходы и расходы) ведутся в одном разделе;
// из кассы открываем его уже отфильтрованным по этой кассе.
const canOpenFlows = computed(() => auth.canAccess('/accounting/temporary'))
function openFlows() {
  void router.push({ path: '/accounting/temporary', query: { cashBoxId: id.value } })
}

/**
 * Все расходы этой кассы «за всё время». Без фильтра вида: в плитке сложены и
 * расходы по бизнесу, и иные — список должен показать обе части итога.
 */
function openExpenses() {
  void router.push({
    path: '/accounting/temporary',
    query: { cashBoxId: id.value, tab: 'out', period: 'all' },
  })
}

// ─── Очистка кассы ───────────────────────────────────────────────────────
// Кнопка — в окне «Изменить кассу», только владельцу; здесь — подтверждение
// словом и паролем. Сервер проверяет то же.
const showReset = ref(false)
function afterReset() {
  // Перезагрузка: сводка, журнал и списки сделок держат старые данные.
  window.location.reload()
}

// ─── Удаление ────────────────────────────────────────────────────────────
// Кнопка — в окне «Изменить кассу», подтверждение — словом в отдельном окне.
const showDelete = ref(false)
</script>

<template>
  <div class="cb-page" :class="{ dark: isDark }">
    <div v-if="loading || !box" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
      <!-- Back link -->
      <button class="back-btn" @click="router.push('/cashboxes')">
        <v-icon icon="mdi-arrow-left" size="18" />
        Все кассы
      </button>

      <!-- Read-only banner — cashbox locked because the plan limit is exceeded -->
      <div v-if="box.lockedAt" class="cb-locked-banner">
        <div class="cb-locked-icon">
          <v-icon icon="mdi-lock-outline" size="20" />
        </div>
        <div class="cb-locked-text">
          <div class="cb-locked-title">Касса в режиме «только просмотр»</div>
          <div class="cb-locked-sub">
            Превышен лимит касс тарифа. Можно отмечать платежи и выплачивать дивиденды,
            но нельзя создавать новые сделки.
          </div>
        </div>
        <div class="cb-locked-actions">
          <button class="cb-locked-btn cb-locked-btn--primary" @click="router.push('/cashboxes')">
            Сделать активной
          </button>
          <button class="cb-locked-btn" @click="router.push({ path: '/settings', query: { tab: 'subscription' } })">
            Повысить тариф
          </button>
        </div>
      </div>

      <!-- Header -->
      <div class="cb-header mb-4">
        <div class="cb-header-left">
          <div class="cb-header-icon" :style="{ background: box.color + '20', color: box.color }">
            <v-icon :icon="box.icon" size="28" />
          </div>
          <div>
            <h1 class="cb-header-title">
              {{ box.name }}
              <span v-if="box.isDefault" class="cb-header-badge">основная</span>
            </h1>
            <!-- Сделки кассы — на странице «Сделки» с фильтром по ней. -->
            <router-link :to="{ path: '/deals', query: { cashBoxId: id, tab: '2' } }" class="cb-header-meta cb-header-deals">
              {{ box.dealsCount }} {{ box.dealsCount === 1 ? 'сделка' : 'сделок' }} · из них {{ box.activeDealsCount }} активны
              <v-icon icon="mdi-arrow-right" size="13" />
            </router-link>
          </div>
        </div>
        <div class="cb-header-actions">
          <!-- Пополнить / снять: операции кассы прямо отсюда, в тех же формах,
               что в Бухгалтерии. На телефоне — шторкой снизу. -->
          <template v-if="canAnyOp">
            <v-menu v-if="!isMobile" v-model="opMenu" location="bottom end" offset="6">
              <template #activator="{ props: menuProps }">
                <button class="cb-action-btn cb-action-btn--capital" v-bind="menuProps">
                  <v-icon icon="mdi-swap-vertical-circle-outline" size="17" />
                  Пополнить / снять
                  <v-icon icon="mdi-chevron-down" size="16" />
                </button>
              </template>
              <v-card rounded="lg" elevation="6" class="cb-opmenu">
                <AccountOperationItems :sections="CASHBOX_OPS" @pick="pickOp" />
                <template v-if="canOpenFlows">
                  <div class="cb-opmenu-divider" />
                  <button type="button" class="cb-opmenu-all" @click="opMenu = false; openFlows()">
                    Все операции в Бухгалтерии
                    <v-icon icon="mdi-arrow-right" size="15" />
                  </button>
                </template>
              </v-card>
            </v-menu>
            <button v-else class="cb-action-btn cb-action-btn--capital" @click="opMenu = true">
              <v-icon icon="mdi-swap-vertical-circle-outline" size="17" />
              Пополнить / снять
            </button>
          </template>
          <button
            v-else-if="canOpenFlows"
            class="cb-action-btn cb-action-btn--capital"
            title="Вложить или снять капитал, внести доход или расход"
            @click="openFlows"
          >
            <v-icon icon="mdi-swap-vertical-circle-outline" size="17" />
            Пополнения и расходы
          </button>
          <button class="cb-action-btn" @click="showEdit = true" title="Изменить кассу">
            <v-icon icon="mdi-pencil-outline" size="17" />
            Изменить
          </button>
        </div>
      </div>

      <!-- Нет права видеть капитал/операции кассы -->
      <div v-if="!canSeeCapital" class="cb-no-capital">
        <v-icon icon="mdi-lock-outline" size="30" />
        <div class="cb-no-capital-title">Финансовые данные скрыты</div>
        <div class="cb-no-capital-sub">У вашей роли нет доступа к капиталу и операциям этой кассы.</div>
      </div>

      <!-- ============================ -->
      <!-- Capital waterfall (left + details right). Mirrors finance.vue. -->
      <!-- ============================ -->
      <div v-if="capitalDetails" class="wf mb-6">
        <div class="wf-title-row">
          <!-- Две половины одного ответа: сколько денег и где они лежат. -->
          <div class="fn-tabs">
            <button
              class="fn-tab"
              :class="{ 'fn-tab--active': topTab === 'capital' }"
              @click="topTab = 'capital'"
            >
              Капитал кассы
            </button>
            <button
              class="fn-tab"
              :class="{ 'fn-tab--active': topTab === 'where' }"
              @click="topTab = 'where'"
            >
              Где лежат деньги
              <span v-if="unallocated > 0" class="cb-tab-dot" title="Есть неразнесённые деньги" />
            </button>
          </div>
        </div>

        <template v-if="topTab === 'where'">
          <!-- Одна сумма и то, как она поделена: сначала «сколько денег»,
               потом «где они». Две отдельные цифры рядом читались как два
               независимых показателя. -->
          <div class="cb-where-top">
            <div class="cb-where-total">
              <div class="cb-where-total-label">Деньги кассы</div>
              <div class="cb-where-total-value">{{ formatCurrency(boxMoney) }}</div>
              <div class="cb-where-total-note">{{ accountsCountLabel }}</div>
            </div>
            <div class="cb-where-actions">
              <button
                v-if="unallocated > 0 && canSeeCapital"
                class="cb-where-btn cb-where-btn--main"
                @click="showAllocate = true"
              >
                <v-icon icon="mdi-arrow-decision-outline" size="16" />
                Разнести по счетам
              </button>
              <button class="cb-where-btn" @click="router.push('/accounting/balance')">
                <v-icon icon="mdi-plus" size="16" />
                Новый счёт
              </button>
            </div>
          </div>

          <div class="cb-where-split">
            <!-- Полоса и две карточки под ней — один и тот же ответ двумя
                 способами: сначала пропорция глазом, потом точные суммы. -->
            <div class="cb-where-bar">
              <div class="cb-where-bar-fill" :style="{ width: allocatedPct + '%' }" />
            </div>

            <div class="cb-where-cards">
              <div class="cb-where-card cb-where-card--ok">
                <div class="cb-where-card-ico">
                  <v-icon icon="mdi-check-decagram-outline" size="18" />
                </div>
                <div class="cb-where-card-body">
                  <div class="cb-where-card-label">Разнесено по счетам</div>
                  <div class="cb-where-card-value">{{ formatCurrency(onAccounts) }}</div>
                </div>
                <div class="cb-where-card-pct">{{ allocatedPct }}%</div>
              </div>

              <div
                class="cb-where-card"
                :class="unallocated > 0 ? 'cb-where-card--warn' : 'cb-where-card--calm'"
              >
                <div class="cb-where-card-ico">
                  <v-icon :icon="unallocated > 0 ? 'mdi-help-circle-outline' : 'mdi-check-circle-outline'" size="18" />
                </div>
                <div class="cb-where-card-body">
                  <div class="cb-where-card-label">Не разнесено</div>
                  <div v-if="unallocated > 0" class="cb-where-card-value">{{ formatCurrency(unallocated) }}</div>
                  <div v-else class="cb-where-card-value cb-where-card-value--calm">Всё на счетах</div>
                </div>
                <div class="cb-where-card-pct">{{ Math.max(100 - allocatedPct, 0) }}%</div>
              </div>
            </div>
          </div>

          <div v-if="boxAccounts.length" class="cb-where-list">
            <div v-for="g in accountGroups" :key="g.type" class="cb-where-group">
              <!-- Смысловая граница: наличные, банки и пункты приёма — разные
                   деньги, и складывать их взглядом в одну кучу нельзя. -->
              <div class="cb-where-grouprow">
                <v-icon :icon="g.icon" size="14" />
                <span class="cb-where-grouptitle">{{ g.title }}</span>
                <span class="cb-where-groupcount">{{ g.items.length }}</span>
                <span class="cb-where-grouphint">{{ g.hint }}</span>
                <span class="cb-where-groupsum">{{ formatCurrency(g.sum) }}</span>
              </div>

              <div
                v-for="a in g.items"
                :key="a.id"
                class="cb-where-row"
                @click="router.push(`/accounting/accounts/${a.id}`)"
              >
                <BankLogo :bank-name="a.bank?.name" :color="a.bank?.color || a.color" :fallback="a.code" :size="32" />
                <div class="cb-where-body">
                  <div class="cb-where-name">
                    {{ a.name }}
                    <span class="cb-where-code">{{ a.code }}</span>
                  </div>
                  <!-- Что за счёт: банк узнают по названию, остальные — по виду
                       денег. Банковский счёт без указанного банка так и пишем,
                       иначе карта подписывалась «Наличные». -->
                  <div class="cb-where-meta">
                    <template v-if="a.bank">{{ a.bank.name }}</template>
                    <template v-else-if="a.type === 'BANK_CARD'">Банковский счёт</template>
                    <template v-else-if="a.type === 'PAYMENT_POINT'">Пункт приёма</template>
                    <template v-else>Наличные</template>
                    <template v-if="a.transferPhone"> · {{ formatPhone(a.transferPhone) }}</template>
                  </div>
                </div>
                <div class="cb-where-num">
                  <div class="cb-where-sum" :class="{ 'cb-where-sum--neg': isAccountNegative(a) }">{{ a.balance !== null ? formatCurrency(a.balance) : '—' }}</div>
                  <div v-if="isAccountNegative(a)" class="cb-where-neg">в минусе</div>
                  <div v-if="shareOfBox(a.balance)" class="cb-where-share">
                    <span class="cb-where-share-bar">
                      <span class="cb-where-share-fill" :style="{ width: shareOfBox(a.balance) + '%' }" />
                    </span>
                    {{ shareOfBox(a.balance) }}%
                  </div>
                </div>
                <v-icon icon="mdi-chevron-right" size="18" class="cb-where-go" />
              </div>
            </div>
          </div>

          <div v-else class="cb-where-empty">
            <v-icon icon="mdi-wallet-outline" size="26" />
            <div class="cb-where-empty-title">У этой кассы нет счетов</div>
            <div class="cb-where-empty-text">
              Заведите счёт в «Бухгалтерии» и укажите там эту кассу — тогда будет видно,
              в каком сейфе и на какой карте лежат её деньги.
            </div>
          </div>
        </template>

        <template v-else>

        <!-- Слева — навигация: журнал и показатели кассы за выбранный период;
             справа — лента месяцев и содержимое выбранного пункта. -->
        <div class="cb-layout">
          <aside class="cb-nav">
            <div v-if="months.length" class="cb-nav-period">{{ navTitle }}</div>
            <nav class="cb-nav-list" aria-label="Разделы кассы">
              <button
                type="button"
                class="cb-nav-item cb-nav-item--journal"
                :class="{ 'cb-nav-item--on': wfExpanded === 'journal' }"
                @click="wfExpanded = 'journal'"
              >
                <v-icon icon="mdi-book-open-page-variant-outline" size="17" class="cb-nav-ico" />
                <span class="cb-nav-label">Журнал кассы</span>
              </button>
              <button
                v-if="capitalTile"
                type="button"
                class="cb-nav-item cb-nav-item--capital"
                :class="{ 'cb-nav-item--on': wfExpanded === 'capital' }"
                @click="openTile('capital')"
              >
                <v-icon :icon="WF_SECTIONS.capital!.icon" size="17" class="cb-nav-ico" />
                <span class="cb-nav-label">{{ capitalTile.label }}</span>
                <span class="cb-nav-value">{{ capitalTile.value }}</span>
              </button>
              <template v-for="grp in navGroups" :key="grp.key">
                <div class="cb-nav-group">{{ grp.title }}</div>
                <button
                  v-for="t in grp.items"
                  :key="t.key"
                  type="button"
                  class="cb-nav-item"
                  :class="{
                    'cb-nav-item--on': wfExpanded === t.key,
                    'cb-nav-item--danger': t.danger,
                    'cb-nav-item--muted': t.muted,
                  }"
                  :title="t.danger ? 'Денег в кассе меньше, чем вы должны инвесторам — выплатите дивиденды' : t.info"
                  @click="openTile(t.key)"
                >
                  <span class="cb-nav-label">
                    {{ t.label }}
                    <span v-if="t.count != null" class="cb-nav-count">{{ t.count.toLocaleString('ru-RU') }}</span>
                    <v-icon v-if="t.danger" icon="mdi-alert-circle" size="13" class="cb-nav-alert" />
                  </span>
                  <span class="cb-nav-value" :class="[grp.key === 'debt' ? 'cb-nav-value--debt' : t.tone ? `cb-nav-value--${t.tone}` : '']">{{ t.value }}</span>
                  <v-icon
                    v-if="['supplier', 'borrowed', 'lent'].includes(t.key)"
                    icon="mdi-arrow-top-right"
                    size="13"
                    class="cb-nav-out"
                  />
                </button>
              </template>
            </nav>
          </aside>

          <section class="cb-main">
          <CashBoxMonthChart
            v-if="canSeePlan && !monthsDenied && (months.length || monthsLoading)"
            class="cb-months"
            :months="months"
            :selected="selectedMonth ?? ''"
            :loading="monthsLoading"
            :can-see-cost="monthsCanSeeCost"
            :metric="wfExpanded"
            @select="selectMonth"
          />

          <!-- Содержимое выбранного пункта навигации. -->
          <div class="wf-right cb-detail">
            <!-- Hero выбранной плитки: название, главная сумма и из чего она
                 сложилась — фирменным зелёным блоком, как на «Балансе». -->
            <div v-if="wfHero" class="wf-hero">
              <div class="wf-hero-top">
                <span class="wf-hero-ico"><v-icon :icon="wfHero.icon" size="20" /></span>
                <div class="wf-hero-titles">
                  <div class="wf-hero-label">{{ wfHero.title }}</div>
                  <div class="wf-hero-hint">{{ wfHero.hint }}</div>
                </div>
                <button
                  v-if="wfExpanded === 'manual' && canOpenFlows"
                  class="wf-hero-btn"
                  @click="openExpenses"
                >
                  Смотреть все
                  <v-icon icon="mdi-arrow-right" size="15" />
                </button>
              </div>
              <div v-if="wfHero.amount" class="wf-hero-amount">{{ wfHero.amount }}</div>
              <div v-if="wfHero.metrics.length" class="wf-hero-metrics">
                <template v-for="(m, i) in wfHero.metrics" :key="m.label">
                  <div v-if="i" class="wf-hero-divider" />
                  <div class="wf-hero-metric">
                    <div class="wf-hero-metric-value">{{ m.value }}</div>
                    <div class="wf-hero-metric-label">{{ m.label }}</div>
                  </div>
                </template>
              </div>
              <div v-if="wfHero.note" class="wf-hero-note">
                <v-icon icon="mdi-information-outline" size="14" />
                <span>{{ wfHero.note }}</span>
              </div>
            </div>

            <!-- Инвесторы за выбранный месяц — расчёт месяца на их странице. -->
            <div v-if="monthRow && !monthRow.future && ['profit', 'capital', 'pendingCI'].includes(wfExpanded ?? '')" class="cb-month-links">
              <button type="button" class="cb-month-link" @click="router.push({ path: '/co-investors', query: { box: id, month: monthRow.month } })">
                <v-icon icon="mdi-account-group-outline" size="15" />
                Инвесторы за этот месяц
                <v-icon icon="mdi-chevron-right" size="15" />
              </button>
            </div>

            <!-- Журнал — с общей шапкой панели; его фильтры и пагинация — свои. -->
            <template v-if="wfExpanded === 'journal'">
              <CashflowJournal class="wf-journal" :cash-box-id="id" :period="monthPeriod" @changed="refreshAfterMutation" />
            </template>

            <!-- Оплаты от клиентов — в журнале кассы, за выбранный месяц. -->
            <template v-else-if="wfExpanded === 'received'">
              <CashflowJournal
                :key="'received-' + (selectedMonth ?? '')"
                class="wf-journal"
                :cash-box-id="id"
                :period="monthPeriod"
                :types="['PAYMENT_IN']"
                @changed="refreshAfterMutation"
              />
            </template>

            <!-- Осталось получить: неоплаченные платежи месяца поштучно. -->
            <template v-else-if="wfExpanded === 'remaining'">
              <MonthPaymentsList
                v-if="monthRow"
                :cash-box-id="id"
                :month="monthRow.month"
                only="pending"
                accent="gross"
              />
            </template>

            <!-- Прогноз по месяцам: клик — платежи этого месяца. -->
            <template v-else-if="wfExpanded === 'forecast'">
              <div class="wf-expand-subtitle">По месяцам</div>
              <div v-if="forecast?.months.length" class="cb-fc">
                <div class="cb-fc-row cb-fc-row--head">
                  <span>Месяц</span>
                  <span class="cb-fc-num">Платежей</span>
                  <span class="cb-fc-num">Сумма</span>
                  <span class="cb-fc-num">Прибыль ≈</span>
                </div>
                <component
                  :is="months.some((x) => x.month === f.month) ? 'button' : 'div'"
                  v-for="f in forecast.months"
                  :key="f.month"
                  type="button"
                  class="cb-fc-row"
                  :class="{ 'cb-fc-row--link': months.some((x) => x.month === f.month) }"
                  @click="months.some((x) => x.month === f.month) && openForecastMonth(f.month)"
                >
                  <span class="cb-fc-month">{{ monthTitle(f.month) }}</span>
                  <span class="cb-fc-num">{{ f.count.toLocaleString('ru-RU') }}</span>
                  <span class="cb-fc-num cb-fc-sum">{{ formatCurrency(f.amount) }}</span>
                  <span class="cb-fc-num cb-fc-gross">{{ formatCurrency(f.gross) }}</span>
                </component>
              </div>
              <div v-else class="wf-expand-empty">Ожидаемых платежей после текущего месяца нет</div>
            </template>

            <template v-else-if="wfExpanded === 'available'">
              <div class="wf-expand-subtitle">Из чего сложились деньги кассы{{ monthRow && !monthRow.current ? ' · на сегодня' : '' }}</div>
              <div v-if="availableRows.length" class="wf-flow">
                <div
                  v-for="r in availableRows"
                  :key="r.key"
                  class="wf-flow-row"
                  :class="{ 'wf-flow-row--base': r.base, 'wf-flow-row--total': r.total, 'wf-flow-row--final': r.final, 'wf-flow-row--muted': r.muted }"
                >
                  <div class="wf-flow-main">
                    <span class="wf-flow-label">{{ r.label }}</span>
                    <span
                      class="wf-flow-val"
                      :class="r.total ? '' : r.value > 0 ? 'wf-flow-val--in' : r.value < 0 ? 'wf-flow-val--out' : ''"
                    >
                      {{ r.value > 0 && !r.base && !r.total ? '+' : '' }}{{ formatCurrency(r.value) }}
                    </span>
                  </div>
                  <div v-if="r.hint" class="wf-flow-hint">{{ r.hint }}</div>
                </div>

              </div>
              <div v-else class="wf-expand-empty">Нет данных для разбора</div>
            </template>

            <template v-else-if="wfExpanded === 'capital'">
              <div v-if="cashBoxCoInvestors.length > 0" class="wf-ci-breakdown">
                <div class="wf-ci-breakdown-head">
                  <span>Инвесторы кассы</span>
                  <router-link to="/co-investors" class="wf-panel-link">
                    <v-icon icon="mdi-arrow-top-right" size="13" />
                    Управление
                  </router-link>
                </div>
                <div class="wf-ci-list wf-scroll">
                  <router-link
                    v-for="ci in pageOf(cashBoxCoInvestors, ciPage)"
                    :key="ci.id"
                    :to="`/co-investors/${ci.id}`"
                    class="wf-ci-row"
                  >
                    <div class="wf-ci-info">
                      <div class="wf-ci-head">
                        <div class="wf-ci-name">{{ ci.name }}</div>
                        <div class="wf-ci-mode" :class="`wf-ci-mode--${ciShareLabels[ci.id]?.kind}`">
                          <v-icon :icon="ciShareLabels[ci.id]?.icon || 'mdi-scale-balance'" size="11" />
                          {{ ciShareLabels[ci.id]?.label }}
                        </div>
                      </div>
                      <div class="wf-ci-meta">
                        Капитал {{ formatCurrencyShort(ci.currentCapital || ci.capital) }}
                        <span v-if="(ci.realizedProfit - ci.totalPayout) > 0">
                          · к выплате <strong style="color: #f59e0b;">{{ formatCurrencyShort(ci.realizedProfit - ci.totalPayout) }}</strong>
                        </span>
                      </div>
                    </div>
                    <v-icon icon="mdi-arrow-right" size="14" class="wf-ci-arrow" />
                  </router-link>
                </div>
                <ServerPager
                  compact
                  v-if="cashBoxCoInvestors.length > WF_PAGE"
                  :page="ciPage"
                  :total="cashBoxCoInvestors.length"
                  :per-page="WF_PAGE"
                  :per-page-options="[WF_PAGE]"
                  @update:page="ciPage = $event"
                />
              </div>
            </template>

            <template v-else-if="wfExpanded === 'profit'">
              <div v-if="monthRow" class="wf-expand-subtitle">Сделки с прибылью · за всё время</div>
              <div v-if="profitDeals.loading && !profitDeals.items.length" class="d-flex justify-center pa-6">
                <v-progress-circular indeterminate color="primary" size="28" />
              </div>
              <div class="wf-scroll">
              <div
                v-for="d in profitDeals.items"
                :key="d.id"
                class="wf-acc"
              >
                <button class="wf-acc-head" @click="toggleProfitDeal(d.id)">
                  <v-icon
                    :icon="expandedInProfit.has(d.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                    size="16"
                    class="wf-acc-chevron"
                  />
                  <div class="wf-acc-title">
                    <router-link :to="`/deals/${d.id}`" class="wf-expand-link" @click.stop>
                      {{ d.productName }}
                      <span v-if="d.client" class="wf-expand-dim"> · {{ d.client }}</span>
                      <span
                        v-if="d.wholesalePrice != null && d.wholesalePrice > 0"
                        class="wf-pill-wholesale"
                        :title="`Оптовая ${formatCurrencyShort(d.wholesalePrice)} · Розничная ${formatCurrencyShort(d.purchasePrice)}`"
                      >опт</span>
                    </router-link>
                    <span class="wf-acc-sub">из ожидаемой {{ formatCurrencyShort(dealTotalMargin(d)) }}</span>
                    <span v-if="(d.coInvestorProfit ?? 0) > 0" class="wf-acc-sub">
                      ваша {{ formatCurrencyShort(dealPartnerProfit(d)) }} · инвесторам {{ formatCurrencyShort(d.coInvestorProfit!) }}
                    </span>
                  </div>
                  <span class="wf-expand-val" style="color: #10b981;">+{{ formatCurrency(dealPartnerProfit(d)) }}</span>
                </button>

                <div v-if="expandedInProfit.has(d.id)" class="wf-acc-body">
                  <!-- Итог сделки одной строкой: у сделки бывают десятки инвесторов,
                       и перечисление каждого раздувало раскрытие на экран. -->
                  <div class="wf-deal-sum">
                    <div class="wf-deal-sum-item">
                      <span>Прибыль сделки</span>
                      <b>{{ formatCurrency(dealProfitEarned(d)) }}</b>
                    </div>
                    <div v-if="(d.coInvestorBreakdown?.length ?? 0) > 0" class="wf-deal-sum-item">
                      <span>Инвесторам · {{ d.coInvestorBreakdown!.length }}</span>
                      <b class="wf-deal-sum-ci">{{ formatCurrency(d.coInvestorProfit ?? 0) }}</b>
                    </div>
                    <div class="wf-deal-sum-item wf-deal-sum-item--you">
                      <span>Ваша прибыль</span>
                      <b>{{ formatCurrency(dealPartnerProfit(d)) }}</b>
                    </div>
                  </div>
                  <div v-if="d.downPayment > 0" class="wf-pay-row">
                    <span class="wf-pay-status wf-pay-status--paid">✓</span>
                    <span class="wf-pay-name">Первоначальный взнос</span>
                    <span class="wf-pay-amount-dim">({{ formatCurrencyShort(d.downPayment) }})</span>
                    <span class="wf-pay-flex" />
                    <span class="wf-pay-profit">+{{ formatCurrency(Math.round(d.downPayment * (dealTotalMargin(d) / Math.max(d.totalPrice, 1)))) }}</span>
                  </div>
                  <div v-if="dealPaymentsLoading.has(d.id)" class="wf-pay-row">
                    <span class="wf-pay-name text-medium-emphasis">Загружаем график…</span>
                  </div>
                  <div v-for="p in (dealPayments[d.id] ?? [])" :key="p.id" class="wf-pay-row">
                    <span class="wf-pay-status" :class="`wf-pay-status--${p.status.toLowerCase()}`">
                      <v-icon
                        :icon="p.status === 'PAID' ? 'mdi-check' : (p.status === 'OVERDUE' ? 'mdi-alert' : 'mdi-clock-outline')"
                        size="11"
                      />
                    </span>
                    <span class="wf-pay-name">Платёж #{{ p.number }}</span>
                    <span class="wf-pay-amount-dim">({{ formatCurrencyShort(p.amount) }})</span>
                    <span class="wf-pay-status-text">{{ PAYMENT_STATUS_LABEL[p.status] }}</span>
                    <span class="wf-pay-flex" />
                    <span v-if="p.status === 'PAID'" class="wf-pay-profit">+{{ formatCurrency(paymentProfit(d, p)) }}</span>
                    <span v-else class="wf-pay-profit-future">— ожидается {{ formatCurrencyShort(paymentProfit(d, p)) }}</span>
                  </div>
                  <router-link :to="`/deals/${d.id}`" class="wf-deal-open">
                    Открыть страницу сделки
                    <v-icon icon="mdi-arrow-right" size="14" />
                  </router-link>
                </div>
              </div>
              </div>
              <div v-if="!profitDeals.loading && !profitDeals.total" class="wf-expand-empty">Прибыли пока нет</div>
              <ServerPager
                compact
                v-if="profitDeals.total > DEALS_PAGE"
                :page="profitDeals.page"
                :total="profitDeals.total"
                :per-page="DEALS_PAGE"
                :busy="profitDeals.loading"
                :per-page-options="[DEALS_PAGE]"
                @update:page="profitDeals.page = $event"
              />
            </template>

            <template v-else-if="wfExpanded === 'deployed'">
              <div class="wf-expand-subtitle">Активные сделки{{ monthRow && !monthRow.current ? ' · на сегодня' : '' }}</div>
              <div v-if="activeDeals.loading && !activeDeals.items.length" class="d-flex justify-center pa-6">
                <v-progress-circular indeterminate color="primary" size="28" />
              </div>
              <div class="wf-scroll">
              <div v-for="d in activeDeals.items" :key="d.id" class="wf-acc">
                <button class="wf-acc-head" @click="toggleProgressDeal(d.id)">
                  <v-icon
                    :icon="expandedInProgress.has(d.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                    size="16"
                    class="wf-acc-chevron"
                  />
                  <div class="wf-acc-title">
                    <router-link :to="`/deals/${d.id}`" class="wf-expand-link" @click.stop>
                      {{ d.productName }}
                      <span v-if="d.client" class="wf-expand-dim"> · {{ d.client }}</span>
                    </router-link>
                    <span class="wf-acc-sub">{{ d.progress }}% оплачено</span>
                  </div>
                  <span class="wf-expand-val" style="color: #f59e0b;">{{ formatCurrency(dealInProgress(d)) }}</span>
                </button>
                <div v-if="expandedInProgress.has(d.id)" class="wf-acc-body">
                  <table class="wf-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th class="wf-table-num">Получено</th>
                        <th class="wf-table-num">Ожидается</th>
                        <th class="wf-table-num">Всего</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td class="wf-table-row-label">Возврат закупки</td>
                        <td class="wf-table-num">{{ formatCurrency(dealCostRecovered(d)) }}</td>
                        <td class="wf-table-num wf-table-num--dim">{{ formatCurrency(dealInProgress(d)) }}</td>
                        <td class="wf-table-num wf-table-num--dim">{{ formatCurrency(dealRealCost(d)) }}</td>
                      </tr>
                      <tr>
                        <td class="wf-table-row-label">
                          {{ d.wholesalePrice != null && d.wholesalePrice > 0 ? 'Прибыль' : 'Прибыль (наценка)' }}
                        </td>
                        <td class="wf-table-num" style="color: #10b981;">{{ formatCurrency(dealProfitEarned(d)) }}</td>
                        <td class="wf-table-num wf-table-num--dim">{{ formatCurrency(dealProfitRemaining(d)) }}</td>
                        <td class="wf-table-num wf-table-num--dim">{{ formatCurrency(dealTotalMargin(d)) }}</td>
                      </tr>
                      <tr class="wf-table-total">
                        <td class="wf-table-row-label">Поступления</td>
                        <td class="wf-table-num">{{ formatCurrency(d.received) }}</td>
                        <td class="wf-table-num">{{ formatCurrency(Math.max(d.totalPrice - d.received, 0)) }}</td>
                        <td class="wf-table-num">{{ formatCurrency(d.totalPrice) }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <router-link :to="`/deals/${d.id}`" class="wf-deal-open">
                    Открыть страницу сделки
                    <v-icon icon="mdi-arrow-right" size="14" />
                  </router-link>
                </div>
              </div>
              </div>
              <div v-if="!activeDeals.loading && !activeDeals.total" class="wf-expand-empty">Нет активных сделок</div>
              <ServerPager
                compact
                v-if="activeDeals.total > DEALS_PAGE"
                :page="activeDeals.page"
                :total="activeDeals.total"
                :per-page="DEALS_PAGE"
                :busy="activeDeals.loading"
                :per-page-options="[DEALS_PAGE]"
                @update:page="activeDeals.page = $event"
              />
            </template>

            <template v-else-if="wfExpanded === 'manual'">
              <div class="wf-expand-subtitle">Последние расходы</div>
              <div v-if="!manualOperations.length" class="wf-expand-empty">Расходов пока нет</div>
              <div v-for="(op, i) in manualOperations" :key="op.transactionId ?? i" class="wf-expand-row wf-exp-row">
                <span class="wf-exp-main">
                  <span class="wf-exp-title">{{ op.category?.name || op.description }}</span>
                  <span class="wf-expand-dim">
                    {{ formatDateShort(op.date) }}<template v-if="op.category?.name && op.description"> · {{ op.description }}</template>
                  </span>
                </span>
                <span class="wf-expand-val" style="color: #ef4444;">−{{ formatCurrency(op.amount) }}</span>
              </div>
              <button
                v-if="canOpenFlows && (capitalDetails.manualBreakdown?.expenseCount ?? 0) > manualOperations.length"
                class="wf-moved-btn"
                @click="openExpenses"
              >
                Смотреть все {{ capitalDetails.manualBreakdown?.expenseCount }} в Бухгалтерии
                <v-icon icon="mdi-arrow-right" size="14" />
              </button>
            </template>

            <template v-else-if="wfExpanded === 'pendingCI'">
              <div class="wf-expand-subtitle">По инвесторам{{ monthRow && !monthRow.current ? ' · на сегодня' : '' }}</div>
              <div class="wf-ci-list wf-scroll">
                <div v-for="ci in pageOf(pendingCiList, reservePage)" :key="ci.id" class="wf-acc">
                  <button class="wf-acc-head" @click="toggleReserveCi(ci.id)">
                    <v-icon :icon="expandedReserveCi.has(ci.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="16" class="wf-acc-chevron" />
                    <div class="wf-acc-title">
                      <router-link :to="`/co-investors/${ci.id}`" class="wf-expand-link" @click.stop>{{ ci.name }}</router-link>
                      <span class="wf-acc-sub">{{ ciShareLabels[ci.id]?.label }} · начислено {{ formatCurrencyShort(ci.realizedProfit) }}</span>
                    </div>
                    <span class="wf-expand-val" style="color: #f59e0b;">{{ formatCurrency(ci.pendingPayout) }}</span>
                  </button>
                  <div v-if="expandedReserveCi.has(ci.id)" class="wf-acc-body">
                    <!-- Разбор доли инвестора по каждой сделке -->
                    <div v-if="!ciDeals" class="wf-pay-row">
                      <span class="wf-pay-name text-medium-emphasis">{{ ciDealsLoading ? 'Загружаем сделки…' : 'Сделки не загрузились' }}</span>
                    </div>
                    <div v-for="dl in ci.deals" :key="dl.id" class="ps-deal">
                      <template v-if="dl.isCostFee">
                        <div class="ps-deal-head">
                          <span>{{ dl.productName }}</span>
                          <span class="ps-deal-gross" style="color:#f59e0b">+{{ formatCurrency(dl.amount) }}</span>
                        </div>
                        <div class="ps-econ" style="margin-top:8px">
                          <div class="ps-econ-row"><span>Закупка (возврат капитала)</span><span class="ps-econ-val">{{ formatCurrency(dl.purchasePrice) }}</span></div>
                          <div class="ps-econ-row"><span>Наценка рассрочки</span><span class="ps-econ-val">{{ formatCurrency(dl.gross) }}</span></div>
                          <div class="ps-econ-row"><span>− Доля партнёра</span><span class="ps-econ-val">{{ formatCurrency(dl.partnerShare) }}</span></div>
                        </div>
                        <div class="ps-payout">
                          <span class="ps-payout-label">
                            <span class="ps-payout-name">Инвестору на руки</span>
                            <span class="ps-payout-sub">в резерв идёт прибыль {{ formatCurrencyShort(dl.amount) }}</span>
                          </span>
                          <span class="ps-payout-val">{{ formatCurrency(dl.onHand) }}</span>
                        </div>
                      </template>
                      <template v-else>
                        <div class="ps-deal-head">
                          <span>{{ dl.productName }}</span>
                          <span class="ps-deal-gross">{{ formatCurrency(dl.gross) }}</span>
                        </div>
                        <div class="ps-row" style="margin-top:6px">
                          <span class="ps-dot ps-dot--ci" />
                          <span class="ps-label">
                            <span class="ps-name">Доля инвестора</span>
                            <span v-if="dl.mode" class="ps-sub">{{ dl.mode }}</span>
                          </span>
                          <span class="ps-val ps-val--ci">{{ formatCurrency(dl.amount) }}</span>
                        </div>
                      </template>
                    </div>
                    <!-- Хвост за пределами показанных сделок: без него сумма
                         строк не сходится с «Начислено» выше. -->
                    <div v-if="(ci.dealsRest?.count ?? 0) > 0" class="ps-deal ps-deal--rest">
                      <div class="ps-row">
                        <span class="ps-dot ps-dot--ci" />
                        <span class="ps-label">
                          <span class="ps-name">
                            и ещё {{ ci.dealsRest!.count }}
                            {{ ci.dealsRest!.count === 1 ? 'сделка' : ci.dealsRest!.count < 5 ? 'сделки' : 'сделок' }}
                          </span>
                          <span class="ps-sub">показаны крупнейшие по начислению</span>
                        </span>
                        <span class="ps-val ps-val--ci">{{ formatCurrency(ci.dealsRest!.amount) }}</span>
                      </div>
                    </div>
                    <!-- Итог: начислено − выплачено = к выплате -->
                    <div class="wf-rf" style="margin-top:4px">
                      <div class="wf-rf-row"><span>Начислено прибыли</span><span class="wf-rf-val">{{ formatCurrency(ci.realizedProfit) }}</span></div>
                      <div class="wf-rf-row"><span>− Уже выплачено</span><span class="wf-rf-val">{{ formatCurrency(ci.totalPayout) }}</span></div>
                      <div class="wf-rf-row wf-rf-total"><span>К выплате</span><span class="wf-rf-val">{{ formatCurrency(ci.pendingPayout) }}</span></div>
                    </div>
                  </div>
                </div>
              </div>
              <ServerPager
                compact
                v-if="pendingCiList.length > WF_PAGE"
                :page="reservePage"
                :total="pendingCiList.length"
                :per-page="WF_PAGE"
                :per-page-options="[WF_PAGE]"
                @update:page="reservePage = $event"
              />
            </template>

            <template v-else>
              <div class="wf-panel-empty">
                <v-icon icon="mdi-cursor-default-click-outline" size="28" color="grey-lighten-2" />
                <div>Выберите пункт слева</div>
              </div>
            </template>
          </div>
          </section>
        </div>

        </template>
      </div>

    </template>

    <!-- Edit dialog -->
    <!-- Раскладываем по счетам именно этой кассы: чужие счета её деньги
         держать не могут. -->
    <AllocateUnallocatedDialog
      v-model="showAllocate"
      :amount="unallocated"
      :cash-box-id="id"
      @done="() => { void accounting.fetchAccounts(); void refreshUnallocated(); void loadDetails() }"
    />

    <v-bottom-sheet v-if="isMobile" v-model="opMenu">
      <v-card class="cb-opmenu cb-opmenu--sheet" rounded="t-xl">
        <div class="cb-opmenu-head">Пополнить / снять</div>
        <AccountOperationItems :sections="CASHBOX_OPS" @pick="pickOp" />
        <template v-if="canOpenFlows">
          <div class="cb-opmenu-divider" />
          <button type="button" class="cb-opmenu-all" @click="opMenu = false; openFlows()">
            Все операции в Бухгалтерии
            <v-icon icon="mdi-arrow-right" size="15" />
          </button>
        </template>
      </v-card>
    </v-bottom-sheet>
    <OperationDialog
      v-model="opDialog"
      :kind="opKind"
      :cash-box-id="id"
      lock-cash-box
      @done="refreshAfterMutation"
    />
    <CashBoxEditDialog v-model="showEdit" :cashbox="box" @saved="(b) => { box = b; loadDetails() }" @reset="showReset = true" @delete="showDelete = true" />
    <CashBoxResetDialog v-if="box" v-model="showReset" :cash-box-id="box.id" :name="box.name" @done="afterReset" />
    <CashBoxDeleteDialog v-if="box" v-model="showDelete" :cashbox="box" @deleted="router.push('/cashboxes')" />

  </div>
</template>

<style scoped>
.cb-page { max-width: 1440px; margin: 0 auto; padding: 24px; }
/* Пагинация журнала прилипает к низу экрана, как в «Сделках» и «Платежах»:
   у v-card overflow: hidden, а внутри такого контейнера sticky не работает. */
.cb-journal-card { overflow: visible; }
.cb-header-deals { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }
.cb-header-deals:hover { color: #047857; text-decoration: underline; }

/* Read-only (locked) banner */
.cb-locked-banner {
  display: flex; align-items: center; gap: 14px;
  background: rgba(245, 158, 11, 0.09);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 14px; padding: 14px 18px; margin-bottom: 18px;
}
.cb-locked-icon {
  width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(245, 158, 11, 0.15); color: #b45309;
}
.cb-locked-text { flex: 1; min-width: 0; }
.cb-locked-title { font-size: 14.5px; font-weight: 800; color: #92400e; }
.cb-locked-sub { font-size: 12.5px; line-height: 1.45; color: #a16207; margin-top: 2px; }
.cb-locked-actions { display: flex; gap: 8px; flex-shrink: 0; }
.cb-locked-btn {
  height: 34px; padding: 0 14px; border-radius: 9px;
  border: 1px solid rgba(245, 158, 11, 0.4); background: transparent;
  color: #b45309; font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: all 0.15s; white-space: nowrap;
}
.cb-locked-btn:hover { background: rgba(245, 158, 11, 0.12); }
.cb-locked-btn--primary { background: #b45309; color: #fff; border-color: #b45309; }
.cb-locked-btn--primary:hover { background: #92400e; }
.cb-page.dark .cb-locked-banner { background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); }
.cb-page.dark .cb-locked-title { color: #fbbf24; }
.cb-page.dark .cb-locked-sub { color: #d4a24e; }
@media (max-width: 599px) {
  .cb-locked-banner { flex-wrap: wrap; }
  .cb-locked-actions { width: 100%; }
  .cb-locked-btn { flex: 1; }
}

/* Header */
.cb-no-capital {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px;
  padding: 40px 24px; border-radius: 16px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 24px;
}
.cb-no-capital-title { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); margin-top: 4px; }
.cb-no-capital-sub { font-size: 13px; max-width: 340px; }

.cb-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.cb-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; }
.cb-header-icon {
  width: 54px; height: 54px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.cb-header-title {
  font-size: 22px; font-weight: 800; color: rgb(var(--v-theme-on-surface));
  letter-spacing: -0.3px; display: flex; align-items: center; gap: 10px;
}
.cb-header-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 3px 8px; border-radius: 6px;
}
.cb-header-meta { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; }
.cb-header-actions { display: flex; gap: 8px; flex-shrink: 0; }
.cb-action-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 14px; border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.cb-action-btn:hover { border-color: #047857; color: #047857; }
.cb-action-btn--danger { color: #ef4444; }
.cb-action-btn--danger:hover { border-color: #ef4444; color: #ef4444; }
.cb-action-btn--capital { border-color: rgba(59, 130, 246, 0.35); color: #3b82f6; }
.cb-action-btn--capital:hover { border-color: #3b82f6; color: #3b82f6; background: rgba(59, 130, 246, 0.06); }

/* ── Модалка капитала кассы ── */
.cap-summary {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
}
@media (max-width: 500px) { .cap-summary { grid-template-columns: 1fr; } }
.cap-summary-item {
  padding: 12px 14px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.cap-summary-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55); }
.cap-summary-value { font-size: 16px; font-weight: 800; margin-top: 4px; font-variant-numeric: tabular-nums; }
.cap-max-btn {
  margin-top: 8px; padding: 0; border: none; background: none; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #3b82f6;
}
.cap-max-btn:hover { text-decoration: underline; }
.cap-calc {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  font-size: 12.5px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.cap-calc .v-icon { flex-shrink: 0; margin-top: 1px; }
.cap-calc--ok { background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); }
.cap-calc--ok .v-icon { color: #10b981; }
.cap-calc--warn { background: rgba(245, 158, 11, 0.09); border: 1px solid rgba(245, 158, 11, 0.28); }
.cap-calc--warn .v-icon { color: #d97706; }

/* ─── Waterfall ─────────────────────────────────────────────────────── */
.wf {
  background: rgb(var(--v-theme-surface));
  border-radius: 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  padding: 20px 24px;
}
.wf-title-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; flex-wrap: wrap;
  margin-bottom: 16px;
}
.wf-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-transform: uppercase; letter-spacing: 0.5px;
}

/* ── Касса: навигация слева, содержимое справа ──
   Слева — что выбрать (журнал и показатели за период), справа — лента месяцев
   и то, что выбрано. На узком экране навигация — лентой карточек сверху. */
.cb-layout {
  display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 20px; align-items: start;
}
/* Навигация — строгий список на еле заметном сером с рамкой: название
   слева, сумма справа, заголовки групп — полосой потемнее. Цвет — только у
   выбранного пункта (фирменный зелёный, как в меню сайта) и у сумм долгов. */
.cb-nav {
  position: sticky; top: 84px; overflow: hidden;
  border-radius: 8px; background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 1.5%, rgb(var(--v-theme-surface)));
  border: 1px solid rgb(var(--v-theme-border));
}
.cb-nav-period {
  padding: 14px 14px 12px; font-size: 20px; font-weight: 700; line-height: 1.2; letter-spacing: -0.2px;
  color: rgba(var(--v-theme-on-surface), 0.92);
}
.cb-nav-list { display: flex; flex-direction: column; }
.cb-nav-group {
  padding: 7px 14px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.5); background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 6%, rgb(var(--v-theme-surface)));
  border-top: 1px solid rgb(var(--v-theme-border));
  border-bottom: 1px solid rgb(var(--v-theme-border));
}
.cb-nav-item {
  position: relative; display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 14px; text-align: left; cursor: pointer; color: inherit; background: transparent;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  transition: background 0.12s;
}
.cb-nav-period + .cb-nav-list > .cb-nav-item:first-child { border-top: 1px solid rgb(var(--v-theme-border)); }
.cb-nav-group + .cb-nav-item { border-top: none; }
.cb-nav-item:hover { background: rgba(var(--v-theme-on-surface), 0.035); }
.cb-nav-item--on, .cb-nav-item--on:hover { background: color-mix(in srgb, #047857 8%, transparent); }
.cb-nav-ico { flex: none; color: rgba(var(--v-theme-on-surface), 0.38); }
.cb-nav-label {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px;
  font-size: 14px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.82);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cb-nav-alert { flex: none; color: #dc2626; }
/* Количество — серым, отдельно от названия и от суммы. */
.cb-nav-count {
  flex: none; margin-left: 2px; font-size: 12.5px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.42); font-variant-numeric: tabular-nums;
}
.cb-nav-item--on .cb-nav-count { color: color-mix(in srgb, #047857 60%, transparent); }
.cb-nav-value {
  flex: none; font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.78);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.cb-nav-value--debt, .cb-nav-value--out { color: #c2413b; }
.cb-nav-value--in { color: #059669; }
.cb-nav-value--expect { color: #3b82f6; }
.cb-nav-item--on .cb-nav-ico, .cb-nav-item--on .cb-nav-label, .cb-nav-item--on .cb-nav-value:not([class*='cb-nav-value--']) { color: #047857; }
.cb-nav-item--on .cb-nav-label { font-weight: 600; }
.cb-nav-out { flex: none; margin-left: -4px; color: rgba(var(--v-theme-on-surface), 0.35); }
/* Общий капитал — главная цифра кассы: сумма чуть крупнее. */
.cb-nav-item--capital .cb-nav-value { font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.88); }
.cb-nav-item--danger .cb-nav-value { color: #dc2626 !important; }
.cb-nav-item--muted .cb-nav-label, .cb-nav-item--muted .cb-nav-value { opacity: 0.65; }
.cb-page.dark .cb-nav-item--on .cb-nav-ico,
.cb-page.dark .cb-nav-item--on .cb-nav-label,
.cb-page.dark .cb-nav-item--on .cb-nav-value:not([class*='cb-nav-value--']) { color: #059669; }
.cb-page.dark .cb-nav-item--on, .cb-page.dark .cb-nav-item--on:hover { background: color-mix(in srgb, #047857 15%, transparent); }
.cb-page.dark .cb-nav-value--debt { color: #ef8a80; }

/* Прогноз по месяцам — таблица; строка внутри ленты ведёт к платежам месяца. */
.cb-fc { border: 1px solid rgba(var(--v-theme-on-surface), 0.08); border-radius: 8px; overflow: hidden; }
.cb-fc-row {
  display: grid; grid-template-columns: minmax(0, 1.4fr) 0.8fr 1fr 1fr; gap: 12px; align-items: center;
  width: 100%; padding: 10px 14px; text-align: left; color: inherit; background: transparent;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06); font-size: 13.5px;
}
.cb-fc-row:first-child { border-top: none; }
.cb-fc-row--head {
  font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45); background: rgba(var(--v-theme-on-surface), 0.025);
}
.cb-fc-row--link { cursor: pointer; transition: background 0.12s; }
.cb-fc-row--link:hover { background: rgba(79, 70, 229, 0.05); }
.cb-fc-month { font-weight: 600; }
.cb-fc-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cb-fc-sum { font-weight: 700; color: #4f46e5; }
.cb-fc-gross { color: #059669; }
.cb-main { min-width: 0; }
.cb-main .cb-months {
  margin-top: 0;
  /* Лента кассы — в своём бирюзовом тоне, отличном от «Инвесторов». */
  background: linear-gradient(180deg, rgba(15, 118, 110, 0.06) 0%, rgba(15, 118, 110, 0) 70%), rgb(var(--v-theme-surface));
  border-color: rgba(15, 118, 110, 0.16);
}
/* Детали — в правой колонке, без полосы-разделителя на всю карточку. */
.wf-right.cb-detail { margin: 16px 0 0; padding: 0; border-top: none; min-height: 0; }
@media (max-width: 960px) {
  .cb-layout { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .cb-nav { position: static; }
  .cb-nav-list { flex-direction: row; overflow-x: auto; scrollbar-width: none; }
  .cb-nav-list::-webkit-scrollbar { display: none; }
  .cb-nav-group { display: none; }
  .cb-nav-item {
    flex: 0 0 auto; flex-direction: column; align-items: flex-start; gap: 2px; width: auto; min-width: 128px;
    border-top: none; border-left: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  }
  .cb-nav-item:first-child { border-left: none; }
  .cb-nav-item--on, .cb-nav-item--on:hover { box-shadow: inset 0 -2px 0 #047857; }
  .cb-nav-ico, .cb-nav-out { display: none; }
  .cb-nav-item--capital { border-top: none; }
  .cb-fc-row { grid-template-columns: minmax(0, 1fr) auto auto; padding: 10px 12px; }
  .cb-fc-row > :nth-child(4) { display: none; }
  .cb-nav-label { font-size: 13px; }
}

/* Ряд плиток: сколько влезает в ширину, остальные переносятся. На телефоне —
   одна строка с прокруткой вбок, чтобы выбранная деталь была сразу под ней. */

/* Шеврон «вправо» был подсказкой для вертикального списка с панелью справа. */

/* Плитка читается сверху вниз: заголовок — главное, сумма под ним. Кнопка
   по умолчанию центрирует содержимое по вертикали — прижимаем к верху. */

/* Выбранная плитка — с полосой снизу: её содержимое открыто под рядом. */

/* Детали плитки — на белом фоне карточки. От ряда плиток отделены полосой
   во всю ширину карточки (фон страницы) и hero-блоком: сверху — что выбрать,
   снизу — что выбрано. */
.wf-right {
  min-height: 120px;
  margin: 8px -24px 0;
  padding: 24px 24px 0;
  border-top: 8px solid rgba(var(--v-theme-on-surface), 0.035);
}

/* Hero выбранной плитки — тот же приём, что шапка «Баланса»: фирменный
   зелёный градиент, крупная сумма, показатели через разделители. */
.wf-hero {
  position: relative;
  padding: 20px 24px 18px; border-radius: 16px; margin-bottom: 20px;
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  color: #fff;
}
.dark .wf-hero { background: linear-gradient(135deg, #047857 0%, #064e3b 50%, #022c22 100%); }
.wf-hero-top { display: flex; align-items: center; gap: 12px; }
.wf-hero-ico {
  width: 40px; height: 40px; border-radius: 11px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.16); color: #fff;
}
.wf-hero-titles { flex: 1; min-width: 0; }
.wf-hero-label { font-size: 18px; font-weight: 800; letter-spacing: -0.2px; }
.wf-hero-hint { font-size: 12.5px; color: rgba(255, 255, 255, 0.65); margin-top: 2px; }
.wf-hero-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 15px; border-radius: 11px; cursor: pointer;
  background: #fff; border: none; color: #047857; font-size: 13px; font-weight: 700;
}
.wf-hero-btn:hover { background: #ecfdf5; }
.wf-hero-amount {
  font-size: 32px; font-weight: 800; letter-spacing: -0.6px; margin-top: 14px;
  font-variant-numeric: tabular-nums;
}
.wf-hero-metrics {
  display: flex; align-items: center; gap: 22px; flex-wrap: wrap;
  margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.14);
}
.wf-hero-divider { width: 1px; height: 30px; background: rgba(255, 255, 255, 0.16); }
.wf-hero-metric-value { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
.wf-hero-metric-label { font-size: 11.5px; color: rgba(255, 255, 255, 0.6); margin-top: 2px; }
.wf-hero-note {
  display: flex; align-items: flex-start; gap: 7px; margin-top: 14px;
  padding: 9px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.45;
  background: rgba(0, 0, 0, 0.14); color: rgba(255, 255, 255, 0.82);
}
.wf-hero-note .v-icon { margin-top: 1px; flex: none; }
@media (max-width: 700px) {
  .wf-hero { padding: 16px; }
  .wf-hero-top { flex-wrap: wrap; }
  .wf-hero-btn { width: 100%; justify-content: center; order: 3; }
  .wf-hero-amount { font-size: 26px; }
  .wf-hero-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .wf-hero-divider { display: none; }
}

/* Итог раскрытой сделки и переход на неё. */
.wf-deal-sum {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px;
  margin-bottom: 10px;
}
.wf-deal-sum-item {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.035);
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.55);
}
.wf-deal-sum-item b { font-size: 15px; color: rgba(var(--v-theme-on-surface), 0.9); font-variant-numeric: tabular-nums; }
.wf-deal-sum-ci { color: #f59e0b !important; }
.wf-deal-sum-item--you { background: rgba(16, 185, 129, 0.1); }
.wf-deal-sum-item--you b { color: #047857; }
.wf-deal-open {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 12px;
  padding: 8px 14px; border-radius: 9px; text-decoration: none;
  border: 1px solid rgba(4, 120, 87, 0.35); color: #047857; font-size: 12.5px; font-weight: 700;
}
.wf-deal-open:hover { background: rgba(4, 120, 87, 0.08); }
/* У журнала своя маленькая шапка не нужна — её заменяет шапка панели. */
.wf-journal :deep(.cfj-title) { display: none; }
.cb-months { margin-top: 0; }
.cb-month-links { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.cb-month-link {
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 10px;
  font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.8);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgb(var(--v-theme-surface));
  transition: border-color 0.15s, background 0.15s;
}
.cb-month-link:hover { border-color: rgba(var(--v-theme-primary), 0.4); background: rgba(var(--v-theme-primary), 0.04); }
/* Пагинация журнала — во всю ширину карточки и вплотную к её низу: у неё
   отрицательные поля под padding, а у панели своего padding больше нет. */
.wf-right :deep(.sp-pager:not(.sp-pager--compact)) {
  margin: 0 -24px -20px;
  border-radius: 0 0 16px 16px;
}
.wf-exp-row { align-items: center; gap: 12px; }
.wf-exp-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.wf-exp-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }

.wf-panel-title {
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
  text-transform: uppercase; letter-spacing: 0.4px;
  margin-bottom: 12px;
}
.wf-panel-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 32px 16px; text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.4); font-size: 13px;
  min-height: 200px;
}

.wf-expand-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px;
}
.wf-expand-row--sub {
  padding-left: 12px;
  font-size: 11px;
  opacity: 0.6;
}
.wf-expand-row:last-child { border-bottom: none; }
.wf-expand-row--sub { padding-left: 16px; opacity: 0.75; font-size: 12px; }
.wf-expand-val { font-weight: 700; }
.wf-flow-row {
  padding: 9px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.wf-flow-row--base { background: rgba(var(--v-theme-on-surface), 0.02); }
.wf-flow-row--total {
  border-bottom: none;
  border-top: 2px solid rgba(var(--v-theme-on-surface), 0.12);
  margin-top: 4px;
  padding-top: 12px;
}
.wf-flow-main {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
}
.wf-flow-label { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.8); }
.wf-flow-val { font-weight: 700; font-size: 13px; white-space: nowrap; }
.wf-flow-val--in { color: #10b981; }
.wf-flow-val--out { color: #ef4444; }
.wf-flow-row--total .wf-flow-label { font-weight: 700; }
.wf-flow-row--total .wf-flow-val { font-size: 17px; font-weight: 800; }
/* Итог перед вычетами — не в конце списка: под ним ещё строки. */
.wf-flow-row--total:not(.wf-flow-row--final) { border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05); padding-bottom: 10px; }
.wf-flow-row--total:not(.wf-flow-row--final) .wf-flow-val { font-size: 15px; }
.wf-flow-row--final .wf-flow-label, .wf-flow-row--final .wf-flow-val { color: #047857; }
.wf-flow-row--muted .wf-flow-label, .wf-flow-row--muted .wf-flow-val { color: rgba(var(--v-theme-on-surface), 0.45); }
.dark .wf-flow-row--final .wf-flow-label, .dark .wf-flow-row--final .wf-flow-val { color: #34d399; }
.wf-flow-hint {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 2px; line-height: 1.4; max-width: 92%;
}

/* Ручные операции переехали в «Бухгалтерию → Пополнения и расходы» */
.wf-moved {
  display: flex; gap: 12px; padding: 14px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.035);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.wf-moved-title { font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.wf-moved-text { font-size: 12.5px; line-height: 1.5; margin-top: 4px; }
.wf-moved-btn {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 10px;
  padding: 8px 12px; border-radius: 9px; border: none; cursor: pointer;
  background: #047857; color: #fff; font-size: 12.5px; font-weight: 600;
}

.wf-expand-empty {
  padding: 24px; text-align: center;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.wf-expand-subtitle {
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.4px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin: 14px 0 8px;
}

.wf-formula {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 10px; padding: 12px;
  font-size: 13px;
}
.wf-formula-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 0;
}
.wf-formula-row--minus { color: rgba(var(--v-theme-on-surface), 0.65); }
.wf-formula-row--total {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  padding-top: 8px; margin-top: 4px; font-weight: 700;
}
.wf-formula-val { font-weight: 700; }
.wf-formula-hint {
  display: flex; align-items: flex-start; gap: 6px;
  margin-top: 10px; padding-top: 10px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.1);
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55);
  line-height: 1.4;
}

.wf-acc {
  margin-bottom: 6px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.wf-acc:last-child { margin-bottom: 0; }
/* Наведение — понятно, что строка раскрывается. */
.wf-acc:hover { border-color: rgba(4, 120, 87, 0.35); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05); }
.wf-acc:hover .wf-acc-chevron { color: #047857; }
/* Раскрытая — с зелёной рамкой и подложкой шапки. */
.wf-acc:has(> .wf-acc-body) { border-color: rgba(4, 120, 87, 0.45); box-shadow: 0 4px 16px rgba(4, 120, 87, 0.08); }
.wf-acc:has(> .wf-acc-body) > .wf-acc-head {
  background: rgba(4, 120, 87, 0.05);
  border-bottom: 1px solid rgba(4, 120, 87, 0.12);
  border-radius: 11px 11px 0 0;
}
.wf-acc:has(> .wf-acc-body) .wf-acc-chevron { color: #047857; }

/* Прозрачный расклад прибыли сделки: вся → полоска → инвесторам (и почему) → ваша */
.ps-deal {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 10px;
  padding: 11px 13px;
  margin-bottom: 8px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.ps-econ {
  padding-bottom: 9px; margin-bottom: 9px;
  border-bottom: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
}
.ps-econ-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 2px 0;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.ps-econ-val { font-weight: 600; color: rgb(var(--v-theme-on-surface)); }
.ps-deal-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.ps-deal-gross { font-size: 14px; font-weight: 800; color: rgb(var(--v-theme-on-surface)); }
.ps-bar {
  display: flex; height: 7px; border-radius: 4px; overflow: hidden;
  margin: 9px 0 4px;
  background: #f59e0b;
}
.ps-bar-you { background: #10b981; border-radius: 4px 0 0 4px; transition: width 0.4s; }
.ps-row {
  display: flex; align-items: center; gap: 9px;
  padding: 5px 0;
}
.ps-row + .ps-row { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.05); }
.ps-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.ps-dot--you { background: #10b981; }
.ps-dot--ci { background: #f59e0b; }
.ps-label { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.ps-name { font-size: 13px; font-weight: 600; color: rgb(var(--v-theme-on-surface)); }
.ps-sub { font-size: 10.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.ps-sub--dim { color: rgba(var(--v-theme-on-surface), 0.4); font-style: italic; }
.ps-split-title {
  font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin: 4px 0 2px;
}
.ps-val { font-size: 14px; font-weight: 700; white-space: nowrap; }
.ps-val--you { color: #10b981; }
.ps-val--ci { color: #f59e0b; }
.ps-payout {
  display: flex; align-items: center; justify-content: space-between; gap: 9px;
  margin-top: 8px; padding-top: 9px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.15);
}
.ps-payout-label { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ps-payout-name { font-size: 13px; font-weight: 700; color: rgb(var(--v-theme-on-surface)); }
.ps-payout-sub { font-size: 10.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.ps-payout-val { font-size: 15px; font-weight: 800; color: #3b82f6; white-space: nowrap; }

/* Резерв: откуда цифра — начислено − выплачено = к выплате (по инвестору) */
.wf-ci-row--reserve { align-items: stretch; }
.wf-rf { margin-top: 6px; }
.wf-rf-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 3px 0;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.wf-rf-val { font-weight: 600; color: rgb(var(--v-theme-on-surface)); }
.wf-rf-deal {
  padding: 1px 0 1px 10px;
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.wf-rf-deal .wf-rf-val { font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.6); }
.wf-rf-total {
  margin-top: 2px; padding-top: 6px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  font-size: 13px; font-weight: 700; color: rgb(var(--v-theme-on-surface));
}
.wf-rf-total .wf-rf-val { color: #f59e0b; font-weight: 800; }
.wf-acc-head {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 12px 14px;
  background: transparent; border: none; cursor: pointer;
  font-size: 13px;
}
.wf-acc-chevron { color: rgba(var(--v-theme-on-surface), 0.4); flex-shrink: 0; }
.wf-acc-title { flex: 1; min-width: 0; text-align: left; }
.wf-acc-sub {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5);
  font-weight: 500; display: block; margin-top: 1px;
}
.wf-expand-link {
  color: rgb(var(--v-theme-on-surface)); font-weight: 600;
  text-decoration: none;
}
.wf-expand-link:hover { color: #047857; }
.wf-expand-dim { color: rgba(var(--v-theme-on-surface), 0.5); font-weight: 500; }
.wf-pill-wholesale {
  display: inline-block;
  font-size: 9px; font-weight: 700;
  background: rgba(124, 58, 237, 0.12); color: #7c3aed;
  padding: 1px 5px; border-radius: 5px; margin-left: 6px;
  text-transform: uppercase; letter-spacing: 0.3px;
}
.wf-acc-body {
  padding: 12px 14px 14px 38px;
}

.wf-pay-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0; font-size: 12px;
}
.wf-pay-status {
  width: 18px; height: 18px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; flex-shrink: 0;
}
.wf-pay-status--paid { background: rgba(16,185,129,0.15); color: #10b981; }
.wf-pay-status--overdue { background: rgba(239,68,68,0.15); color: #ef4444; }
.wf-pay-status--pending { background: rgba(245,158,11,0.15); color: #f59e0b; }
.wf-pay-status--closed_early { background: rgba(124,58,237,0.15); color: #7c3aed; }
.wf-pay-name { font-weight: 600; }
.wf-pay-amount-dim { color: rgba(var(--v-theme-on-surface), 0.5); }
.wf-pay-status-text {
  font-size: 10px; color: rgba(var(--v-theme-on-surface), 0.5);
  padding: 1px 6px; border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.wf-pay-flex { flex: 1; }
.wf-pay-profit { color: #10b981; font-weight: 700; }
.wf-pay-profit-future {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
  font-style: italic;
}

.wf-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  margin-top: 6px;
}
.wf-table th, .wf-table td {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  text-align: left;
}
.wf-table th {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
  font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.5);
}
.wf-table-num { text-align: right; font-weight: 600; }
.wf-table-num--dim { color: rgba(var(--v-theme-on-surface), 0.5); }
.wf-table-row-label { font-weight: 600; }
.wf-table-row-hint {
  display: block; font-size: 10px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.wf-table-total td { font-weight: 800; border-bottom: none; padding-top: 12px; }

.cb-opmenu { padding: 6px; min-width: 310px; max-width: 360px; }
.cb-opmenu--sheet { max-width: none; padding: 8px 8px 16px; }
.cb-opmenu-head { padding: 8px 10px 4px; font-size: 15px; font-weight: 800; }
.cb-opmenu-divider { height: 1px; margin: 5px 0; background: rgba(var(--v-theme-on-surface), 0.08); }
.cb-opmenu-all {
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  padding: 9px 10px; border-radius: 8px; font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-primary));
}
.cb-opmenu-all:hover { background: rgba(var(--v-theme-primary), 0.06); }

/* ── Вкладка «Где лежат деньги» ── */
.cb-tab-dot {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: #f59e0b; margin-left: 6px; vertical-align: middle;
}
.cb-where-top {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; padding: 16px 0 14px;
}
.cb-where-total-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.cb-where-total-value {
  font-size: 28px; font-weight: 700; letter-spacing: -0.6px; margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.cb-where-total-note { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.48); margin-top: 3px; }

/* Полоса «разнесено / не разнесено»: одна сумма, поделённая надвое. */
.cb-where-split { padding-bottom: 18px; }

/* Полоса деления. Цвет несёт смысл: изумруд — деньги на своих местах,
   янтарь — деньги, про которые ещё не сказано, где они лежат. */
.cb-where-bar {
  height: 10px; border-radius: 6px; overflow: hidden;
  background: linear-gradient(90deg, #fde68a 0%, #fbbf24 100%);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
}
.cb-where-bar-fill {
  height: 100%; border-radius: 6px 0 0 6px;
  background: linear-gradient(90deg, #10b981 0%, #059669 60%, #047857 100%);
  box-shadow: 0 0 0 1px rgba(4, 120, 87, 0.18);
  transition: width 0.4s;
}

/* Две карточки вместо строчки-легенды: суммы читаются как показатели, а не
   как подпись к картинке. */
.cb-where-cards {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px; margin-top: 12px;
}
.cb-where-card {
  display: flex; align-items: center; gap: 11px;
  padding: 12px 14px; border-radius: 12px;
  border: 1px solid transparent;
}
.cb-where-card-ico {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 10px; flex: none;
}
.cb-where-card-body { min-width: 0; flex: 1; }
.cb-where-card-label {
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.2px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cb-where-card-value {
  font-size: 17px; font-weight: 700; margin-top: 2px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.cb-where-card-value--calm { font-size: 14.5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.cb-where-card-pct {
  font-size: 12.5px; font-weight: 700; padding: 3px 9px; border-radius: 8px;
  font-variant-numeric: tabular-nums; flex: none;
}

.cb-where-card--ok {
  background: linear-gradient(180deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.04));
  border-color: rgba(16, 185, 129, 0.24);
}
.cb-where-card--ok .cb-where-card-ico { background: rgba(16, 185, 129, 0.16); color: #047857; }
.cb-where-card--ok .cb-where-card-value { color: #047857; }
.cb-where-card--ok .cb-where-card-pct { background: rgba(16, 185, 129, 0.16); color: #047857; }

.cb-where-card--warn {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.04));
  border-color: rgba(245, 158, 11, 0.3);
}
.cb-where-card--warn .cb-where-card-ico { background: rgba(245, 158, 11, 0.18); color: #b45309; }
.cb-where-card--warn .cb-where-card-value { color: #b45309; }
.cb-where-card--warn .cb-where-card-pct { background: rgba(245, 158, 11, 0.18); color: #b45309; }

/* Нечего разносить — карточка не должна тревожить цветом. */
.cb-where-card--calm {
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-color: rgba(var(--v-theme-on-surface), 0.08);
}
.cb-where-card--calm .cb-where-card-ico {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.cb-where-card--calm .cb-where-card-pct {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.4);
}

.cb-where-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cb-where-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 14px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.cb-where-btn:hover { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.cb-where-btn--main {
  background: linear-gradient(135deg, #10b981, #047857);
  border-color: #047857; color: #fff;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}
.cb-where-btn--main:hover { background: linear-gradient(135deg, #059669, #036b4e); color: #fff; }

/* Подзаголовок вида денег — тот же приём, что в списке счетов «Баланса»:
   полоса во всю ширину карточки, поэтому список выходит за её поля. */
.cb-where-grouprow {
  display: flex; align-items: center; gap: 7px;
  padding: 11px 24px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-on-surface), 0.03);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cb-where-grouptitle {
  font-size: 12.5px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.78);
}
.cb-where-groupcount {
  font-size: 11px; font-weight: 700; padding: 0 6px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cb-where-grouphint { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.38); }
.cb-where-groupsum {
  margin-left: auto; font-size: 13px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: rgba(var(--v-theme-on-surface), 0.8);
}

.cb-where-code {
  margin-left: 6px; padding: 1px 6px; border-radius: 5px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.3px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cb-where-num { text-align: right; min-width: 120px; }
.cb-where-share {
  display: flex; align-items: center; justify-content: flex-end; gap: 6px;
  margin-top: 4px; font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.42);
  font-variant-numeric: tabular-nums;
}
.cb-where-share-bar {
  width: 46px; height: 3px; border-radius: 2px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.cb-where-share-fill {
  display: block; height: 100%; border-radius: 2px;
  background: linear-gradient(90deg, #10b981, #047857);
}

.cb-where-go { color: rgba(var(--v-theme-on-surface), 0.3); flex: none; }
.cb-where-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 36px 24px; text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.cb-where-empty-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.cb-where-empty-text { font-size: 13px; max-width: 420px; line-height: 1.5; }
@media (max-width: 700px) {
  .cb-where-actions { margin-left: 0; width: 100%; }
  .cb-where-grouphint { display: none; }
  .cb-where-cards { grid-template-columns: minmax(0, 1fr); }
  .cb-where-grouprow, .cb-where-row { padding-left: 16px; padding-right: 16px; }
}

/* ─── Tabs row ──────────────────────────────────────────────────────── */
.fn-tabs {
  display: inline-flex; padding: 4px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.fn-tab {
  height: 32px; padding: 0 14px; border-radius: 7px;
  border: none; background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 13px; font-weight: 600;
  transition: all 0.15s;
}
.fn-tab:hover { color: rgb(var(--v-theme-on-surface)); }
.fn-tab--active {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

/* Operations list */

.fn-transactions-list {
  display: flex; flex-direction: column;
}
.fn-transaction-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.fn-transaction-row:last-child { border-bottom: none; }
.fn-transaction-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
}
.fn-transaction-info { flex: 1; min-width: 0; }
.fn-transaction-title {
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}
.fn-transaction-meta {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}
.fn-transaction-amount {
  font-size: 14px; font-weight: 700;
  flex-shrink: 0;
}
.fn-transaction-amount--income { color: #10b981; }
.fn-transaction-amount--expense { color: #ef4444; }
.fn-load-more { text-align: center; margin-top: 12px; }
.fn-load-more-btn {
  background: transparent; border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  padding: 8px 16px; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.fn-load-more-btn:hover { border-color: #047857; color: #047857; }

/* Deals tab */

/* ─── Waterfall "Ручные операции" panel ──────────────────────────── */
.wf-panel-title {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
}
.wf-panel-add {
  display: inline-flex; align-items: center; gap: 4px;
  height: 26px; padding: 0 10px;
  border-radius: 7px;
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
  border: 1px solid rgba(59, 130, 246, 0.25);
  font-size: 11px; font-weight: 700;
  text-transform: none; letter-spacing: 0.2px;
  cursor: pointer;
  transition: all 0.15s;
}
.wf-panel-add:hover {
  background: rgba(59, 130, 246, 0.18);
  border-color: #3b82f6;
}

.wf-manual-list { display: flex; flex-direction: column; }
.wf-manual-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.wf-manual-row:last-child { border-bottom: none; }
.wf-manual-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
}
.wf-manual-info { flex: 1; min-width: 0; }
.wf-manual-title {
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wf-manual-meta {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}
.wf-manual-amount {
  font-size: 13px; font-weight: 700;
  flex-shrink: 0;
}
.wf-manual-icon-btn {
  width: 28px; height: 28px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}
.wf-manual-icon-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-on-surface));
}
.wf-manual-icon-btn--danger:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* ─── Operations tab toolbar (filters) ───────────────────────────── */
/* Mirrors the Касса tab (CashflowJournal.vue) for visual consistency. */

/* "Add" button uses the same compact pill style as filter-btn, but filled */

/* ─── Dialogs (mirrors old finance.vue look) ─────────────────────── */
.fn-dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.fn-dialog-title {
  font-size: 17px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.fn-dialog-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.fn-dialog-close:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.fn-dialog-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

/* ── Type toggle (Доход/Расход pill) ── */
.fn-type-toggle {
  display: flex; gap: 0;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 10px; padding: 3px;
}
.fn-type-btn {
  flex: 1; padding: 10px 16px;
  border-radius: 8px; border: none;
  background: transparent; font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
  display: inline-flex; align-items: center; justify-content: center;
}
.fn-type-btn:hover { color: rgba(var(--v-theme-on-surface), 0.75); }
.fn-type-btn--active {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  font-weight: 600;
}
.fn-type-btn--income.fn-type-btn--active { background: #10b981; color: #fff; }
.fn-type-btn--expense.fn-type-btn--active { background: #ef4444; color: #fff; }

/* ── Form fields ── */
.fn-field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}
/* Цвета — на theme-переменных, а не хардкодом: диалог уезжает в body, класс
   .dark со страницы до него не достаёт, и светлый фон оставался светлым в
   тёмной теме — текст в поле становился нечитаемым. */
.fn-field-input {
  width: 100%; padding: 10px 14px;
  border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.03); font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: all 0.15s;
  font-family: inherit;
}
.fn-field-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.3); }
.fn-field-input:focus {
  border-color: #6366f1; background: rgba(var(--v-theme-on-surface), 0.06);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);
}
.fn-field-input-wrap { position: relative; }
.fn-field-input-wrap .fn-field-input { padding-right: 36px; }
.fn-field-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.fn-field-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='%239ca3af' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
  cursor: pointer;
}

/* Form-styled dropdown trigger (looks like fn-field-input, opens v-menu) */
.fn-field-select-btn {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 10px 12px 10px 14px;
  border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.03); font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit; text-align: left;
}
.fn-field-select-btn:hover {
  border-color: rgba(99, 102, 241, 0.4);
}
.fn-field-select-btn:focus-visible,
.fn-field-select-btn[aria-expanded="true"] {
  border-color: #6366f1; background: rgba(var(--v-theme-on-surface), 0.06);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);
}
.fn-field-select-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  flex-shrink: 0;
}
.fn-field-select-dot {
  width: 10px; height: 10px; border-radius: 50%;
  flex-shrink: 0;
}
.fn-field-select-value {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: 500;
}
.fn-field-select-value--placeholder {
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-weight: 400;
}
.fn-field-select-chevron {
  opacity: 0.5;
  flex-shrink: 0;
}

/* Menu shown by fn-field-select-btn — width matches the activator field.
   Vuetify's connected location-strategy already sets the overlay's min-width
   to the activator width by default; we override .cfj-menu's own min-width
   and stretch the inner v-card to fill that overlay width. */
.fn-select-menu {
  min-width: 0;
  width: 100%;
}

.fn-static-value {
  padding: 10px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

/* ── Color picker (category) ── */
.fn-color-picker { display: flex; gap: 8px; flex-wrap: wrap; }
.fn-color-dot {
  width: 28px; height: 28px; border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer; transition: all 0.15s;
  position: relative;
}
.fn-color-dot:hover { transform: scale(1.15); }
.fn-color-dot--active {
  border-color: rgba(var(--v-theme-on-surface), 0.3);
  box-shadow: 0 0 0 3px rgba(var(--v-theme-on-surface), 0.08);
}

/* ── Categories manager ── */
.fn-cat-section-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.fn-cat-section-title {
  font-size: 13px; font-weight: 600;
  display: flex; align-items: center;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.fn-cat-add-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px; border-radius: 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: transparent;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.fn-cat-add-btn:hover {
  border-color: #047857; color: #047857;
  background: rgba(4, 120, 87, 0.04);
}
.fn-cat-list { display: flex; flex-direction: column; gap: 6px; }
.fn-cat-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  transition: all 0.15s;
}
.fn-cat-row:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.18);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.fn-cat-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.fn-cat-name {
  flex: 1; font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.fn-cat-count {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  flex-shrink: 0;
  margin-right: 4px;
}
.fn-cat-empty {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.35);
  padding: 12px 14px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  text-align: center;
}

/* Locked type toggle in edit mode (existing categories can't change type) */
.fn-type-toggle--locked { opacity: 0.6; }
.fn-type-toggle--locked .fn-type-btn { cursor: not-allowed; }

/* ── Buttons ── */
.fn-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 9px 20px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.fn-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.fn-btn--primary { background: #047857; color: #fff; }
.fn-btn--primary:hover:not(:disabled) {
  background: #065f46;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}
.fn-btn--ghost {
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.5);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.fn-btn--ghost:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.04); }
.fn-btn--danger { background: #ef4444; color: #fff; }
.fn-btn--danger:hover:not(:disabled) {
  background: #dc2626;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
}

/* ── Delete confirmation ── */
.fn-delete-icon {
  width: 72px; height: 72px; margin: 0 auto;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: rgba(239, 68, 68, 0.08);
}
.fn-delete-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.fn-delete-subtitle {
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.5);
}

/* ── Phase 2: waterfall CI section ── */

.wf-panel-link {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-decoration: none;
  text-transform: none;
  letter-spacing: 0;
}
.wf-panel-link:hover { color: #047857; }

.wf-ci-breakdown {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.1);
}
.wf-ci-breakdown-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase; letter-spacing: 0.4px;
}
.wf-ci-list { display: flex; flex-direction: column; gap: 6px; }
.wf-ci-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  transition: all 0.15s;
  text-decoration: none;
  color: inherit;
}
.wf-ci-row:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.18);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.wf-ci-arrow {
  opacity: 0.35;
  flex-shrink: 0;
}
.wf-ci-row:hover .wf-ci-arrow { opacity: 0.7; }
.wf-ci-pending {
  text-align: right;
  flex-shrink: 0;
}
.wf-ci-pending-val {
  font-size: 13px; font-weight: 700;
  color: #f59e0b;
  font-variant-numeric: tabular-nums;
}
.wf-ci-pending-label {
  font-size: 10px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 1px;
}
.wf-ci-mode {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 7px;
  border-radius: 5px;
  font-size: 10px; font-weight: 700;
  flex-shrink: 0;
  white-space: nowrap;
}
.wf-ci-mode--weight {
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
}
.wf-ci-mode--fixed {
  background: rgba(124, 58, 237, 0.1);
  color: #7c3aed;
}
.wf-ci-mode--costfee {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}
.wf-ci-info { flex: 1; min-width: 0; }
.wf-ci-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wf-ci-name {
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}
.wf-ci-meta {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}

/* ───── Mobile ───── */
@media (max-width: 599px) {
  .cb-page { padding: 16px 12px; }

  /* Заголовок кассы — стекаем actions под именем. */
  .cb-header {
    flex-direction: column;
    align-items: stretch;
  }
  .cb-header-left { gap: 12px; }
  .cb-header-icon {
    width: 44px; height: 44px;
    border-radius: 12px;
  }
  .cb-header-title {
    font-size: 20px;
    word-break: break-word;
  }
  .cb-header-actions {
    flex-wrap: wrap;
  }
  .cb-action-btn {
    flex: 1 1 calc(50% - 4px);
    justify-content: center;
  }

  /* Waterfall — отступы и шрифты помельче. */
  .wf-title { font-size: 16px; }
  
  
  
}

/* ── Список счетов: строки во всю ширину карточки ── */
.cb-where-list { margin: 0 -24px -6px; }
.cb-where-row {
  display: flex; align-items: center; gap: 11px;
  padding: 11px 24px; cursor: pointer;
}
.cb-where-row:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.cb-where-body { flex: 1; min-width: 0; }
.cb-where-name {
  font-size: 13.5px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cb-where-meta { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 1px; }
.cb-where-sum { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
/* Счёт кассы в минусе — тем же красным, что на «Балансе». */
.cb-where-sum--neg { color: #dc2626; }
.cb-where-neg {
  display: inline-block; margin-top: 3px; padding: 1px 6px; border-radius: 5px;
  font-size: 10.5px; font-weight: 700;
  background: rgba(239, 68, 68, 0.13); color: #dc2626;
}
</style>