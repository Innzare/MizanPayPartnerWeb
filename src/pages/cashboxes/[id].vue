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
import { useAccountingStore } from '@/stores/accounting'
import BankLogo from '@/components/BankLogo.vue'
import type { AnalyticsSummary, AnalyticsMonthlyRow } from '@/types/analytics'
import { useToast } from '@/composables/useToast'
import { usePageHeaderStore } from '@/stores/pageHeader'
import { useIsDark } from '@/composables/useIsDark'
import { formatCurrency, formatCurrencyShort, formatDate, formatPhone, CURRENCY_MASK, parseMasked, formatDateShort } from '@/utils/formatters'
import type { CapitalSummary } from '@/types'
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
    journalOther: number
  }
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
  coInvestors?: Array<{
    id: string
    name: string
    realizedProfit: number
    totalPayout: number
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
const topTab = ref<'capital' | 'where' | 'plan'>('capital')

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

/**
 * Вкладка «Аналитика»: что происходит с вложенными деньгами.
 *
 * Начальный капитал сам по себе ничего не говорит: партнёр завёл миллион — и
 * дальше цифра просто стоит. Здесь она становится точкой отсчёта: сколько из
 * вложенного сейчас в товаре, сколько уже отбито прибылью, когда по текущему
 * графику платежей вложенное вернётся полностью и что придёт сверху.
 *
 * Считает всё сервер — теми же формулами, что «Аналитика» и «Отчёты»
 * (`/analytics/summary`, `/analytics/monthly` с фильтром по кассе). Своей
 * арифметики здесь нет намеренно: разойдись она с отчётами хоть на рубль,
 * доверия не будет ни к одной из цифр.
 */
/** Роль без права на аналитику вкладку не увидит — там нечего показывать. */
const canSeePlan = computed(() => auth.can('analytics.view'))

const planSummary = ref<AnalyticsSummary | null>(null)
const planMonths = ref<AnalyticsMonthlyRow[]>([])
const planLoading = ref(false)
/** 403 — тариф без аналитики или роль без права. Это не ошибка, а закрытый раздел. */
const planDenied = ref(false)

const PLAN_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'
/** Горизонт прогноза: три года — дальше графики платежей обычно не уходят. */
const PLAN_HORIZON_MONTHS = 36

function planDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function loadPlan() {
  if (planLoading.value || planSummary.value) return
  planLoading.value = true
  try {
    const now = new Date()
    const from = planDay(new Date(now.getFullYear(), now.getMonth(), 1))
    // Последний день месяца через «нулевое» число следующего.
    const to = planDay(new Date(now.getFullYear(), now.getMonth() + PLAN_HORIZON_MONTHS + 1, 0))
    const base = { tz: PLAN_TZ, cashBoxId: id.value }
    const [sum, months] = await Promise.all([
      api.get<AnalyticsSummary>(`/analytics/summary?${new URLSearchParams(base)}`),
      api.get<AnalyticsMonthlyRow[]>(`/analytics/monthly?${new URLSearchParams({ ...base, from, to })}`),
    ])
    planSummary.value = sum
    planMonths.value = months
  } catch (e: any) {
    if (e?.status === 403) planDenied.value = true
    else console.error('Не удалось загрузить аналитику кассы:', e)
  } finally {
    planLoading.value = false
  }
}

watch(topTab, (t) => { if (t === 'plan') void loadPlan() })

/** Чистый доход партнёра, ожидаемый в месяце: валовый минус доля со-инвесторов. */
function planMonthProfit(r: AnalyticsMonthlyRow): number {
  return Math.max(0, Math.round((r.expectedGross || 0) - (r.ciExpected || 0)))
}

/** Заработано чистыми за всё время по сделкам этой кассы. */
const planEarned = computed(() => Math.round(planSummary.value?.deals.earnedNet ?? 0))
/** Сколько ещё принесут текущие сделки — тоже чистыми партнёру. */
const planProfitLeft = computed(() => Math.round(planSummary.value?.deals.profitLeft ?? 0))
const planInvested = computed(() => Math.round(investedCapital.value))

/** Какую часть вложенного уже вернула прибыль. */
const planPaybackPct = computed(() => {
  const inv = planInvested.value
  if (inv <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((planEarned.value / inv) * 100)))
})

/**
 * Месяц, в котором накопленная прибыль перекроет вложенное.
 *
 * Идём от уже заработанного и прибавляем ожидаемый доход месяц за месяцем —
 * ровно так это и происходит в жизни. `null` значит «на горизонте прогноза
 * не окупится»: текущих сделок для этого не хватает.
 */
const planPaybackMonth = computed<string | null>(() => {
  const inv = planInvested.value
  if (inv <= 0 || planEarned.value >= inv) return null
  let acc = planEarned.value
  for (const r of planMonths.value) {
    acc += planMonthProfit(r)
    if (acc >= inv) return r.month
  }
  return null
})

const planPaidBack = computed(() => planInvested.value > 0 && planEarned.value >= planInvested.value)

/** Ближайший год — то, что показываем столбиками. */
const planChart = computed(() => {
  const rows = planMonths.value.slice(0, 12)
  return rows.map((r) => {
    const total = Math.round(r.pendingAmount || 0)
    const profit = Math.min(planMonthProfit(r), total)
    return { month: r.month, total, profit, principal: Math.max(0, total - profit) }
  })
})
const planChartMax = computed(() => Math.max(1, ...planChart.value.map((m) => m.total)))

/** Всё, что ждём по текущим сделкам, и наш доход в этих деньгах. */
const planExpectedTotal = computed(() =>
  planMonths.value.reduce((s, r) => s + Math.round(r.pendingAmount || 0), 0),
)
/** Месяц последнего планового платежа — когда текущие сделки закончатся. */
const planLastMonth = computed<string | null>(() => {
  for (let i = planMonths.value.length - 1; i >= 0; i--) {
    if ((planMonths.value[i]!.pendingAmount || 0) > 0) return planMonths.value[i]!.month
  }
  return null
})

const planOverdue = computed(() => ({
  sum: Math.round(planSummary.value?.payments.overdueSum ?? 0),
  count: planSummary.value?.payments.overdueCount ?? 0,
}))

/** Доля вложенного, которая сейчас в товаре, — остальное лежит свободным. */
const planInWorkPct = computed(() => {
  const base = capitalDetails.value?.inProgress ?? 0
  const total = base + Math.max(availableCap.value, 0)
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((base / total) * 100)))
})

/** «2027-03» → «март 2027» — месяц называют словом, а не номером. */
const PLAN_MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]
function planMonthName(m: string): string {
  const [y, mo] = m.split('-')
  return `${PLAN_MONTH_NAMES[Number(mo) - 1] ?? m} ${y}`
}
/** Короткая подпись столбика: «мар», а январь подписываем годом. */
function planMonthShort(m: string): string {
  const [y, mo] = m.split('-')
  const short = (PLAN_MONTH_NAMES[Number(mo) - 1] ?? '').slice(0, 3)
  return mo === '01' ? `${short} ${y!.slice(2)}` : short
}

const accountsCountLabel = computed(() => {
  const n = boxAccounts.value.length
  const last = n % 10
  const teen = n % 100 >= 11 && n % 100 <= 14
  const word = !teen && last === 1 ? 'счёт' : !teen && last >= 2 && last <= 4 ? 'счёта' : 'счетов'
  return `${n} ${word} этой кассы`
})

const box = ref<CashBoxSummary | null>(null)
const capitalDetails = ref<CapitalDetails | null>(null)
/**
 * Расклад «Доступного капитала» по слагаемым. Порядок — как деньги движутся:
 * сначала то, что в кассу завели, потом обороты по сделкам и выплаты.
 * Нулевые строки прячем, чтобы не забивать панель, но базовые (заведённые
 * деньги) показываем всегда — иначе расклад читается как обрубленный.
 */
const availableRows = computed(() => {
  const b = capitalDetails.value?.availableBreakdown
  if (!b) return []
  const rows = [
    { key: 'seed', label: 'Стартовый капитал кассы', value: b.initialCapital, base: true, hint: '', always: true },
    {
      key: 'ci', label: 'Заведено инвесторами', value: b.coInvestorCashIn, base: true,
      hint: 'Живые деньги, которые инвесторы внесли в эту кассу', always: true,
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
      key: 'other', label: 'Прочие движения', value: b.journalOther, base: false,
      hint: 'Записи журнала, не попавшие в строки выше', always: false,
    },
  ]
  return rows.filter(r => r.always || Math.abs(r.value) > 0)
})

// Сводка собственного капитала кассы (investedCapital / withdrawableProfit /
// availableCapital). Нужна модалке «Капитал» — пополнить/снять.
const capitalSummary = ref<CapitalSummary | null>(null)
// Phase 2: co-investors living in this cashbox. Loaded from /co-investors and
// filtered client-side by cashBoxId. Drives the "Со-инвесторы кассы" panel.
const cashBoxCoInvestors = ref<CashBoxCoInvestor[]>([])
const loading = ref(true)

const showEdit = ref(false)

const pageHeader = usePageHeaderStore()

// Открывается журнал кассы: на странице кассы чаще всего ищут операцию.
const wfExpanded = ref<string | null>('journal')

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
  manual: { label: 'Расходы по бизнесу', hint: 'Аренда, зарплата, реклама — вносятся в Бухгалтерии', icon: 'mdi-cart-arrow-down', color: '#ef4444' },
  available: { label: 'Деньги в кассе', hint: 'Из чего сложились деньги в кассе', icon: 'mdi-safe-square-outline', color: '#047857' },
  pendingCI: { label: 'Резерв для инвесторов', hint: 'Начислено инвесторам, но ещё не выплачено', icon: 'mdi-account-cash-outline', color: '#f59e0b' },
  journal: { label: 'Журнал кассы', hint: 'Все движения денег кассы', icon: 'mdi-book-open-page-variant-outline', color: '#475569' },
}
const wfSection = computed(() => (wfExpanded.value ? WF_SECTIONS[wfExpanded.value] : null))

/**
 * Hero выбранной плитки — фирменный зелёный блок, как на «Балансе»: название,
 * главная сумма и то, из чего она сложилась. Раньше эти цифры стояли серыми
 * строками внутри раздела и не отделялись от списка под ними.
 */
interface HeroMetric { label: string; value: string }
const wfHero = computed(() => {
  const d = capitalDetails.value
  const sec = wfSection.value
  const key = wfExpanded.value
  if (!d || !sec || !key) return null
  const hero = {
    title: sec.label,
    hint: sec.hint,
    icon: sec.icon,
    amount: null as string | null,
    metrics: [] as HeroMetric[],
    note: null as string | null,
  }
  const money = (n: number) => formatCurrency(Math.round(n))
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCurrency(Math.abs(Math.round(n)))}`
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
      hero.metrics.push({ label: `Расходы по бизнесу · ${b.expenseCount}`, value: b.expense > 0 ? `−${money(b.expense)}` : money(0) })
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
      canSeeCapital.value ? loadCashBoxCoInvestors() : Promise.resolve(),
      canSeeCapital.value ? loadCapitalSummary() : Promise.resolve(),
    ])
    box.value = b
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить кассу')
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
    capitalDetails.value = await api.get<CapitalDetails>(`/cashboxes/${id.value}/capital/details?slim=1`)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить детали кассы')
  }
}

async function loadCapitalSummary() {
  try {
    capitalSummary.value = await store.fetchCapital(id.value)
  } catch {
    // silent — модалка капитала просто не покажет новые поля
  }
}

// Phase 2: fetch all CIs of this investor and keep only those living in
// the current cashbox. Reused on every mutation that can affect membership
// (move CI, archive, etc.) — currently called only on initial load.
async function loadCashBoxCoInvestors() {
  try {
    const all = await api.get<any[]>('/co-investors')
    cashBoxCoInvestors.value = all
      .filter((ci) => ci.cashBoxId === id.value)
      .map((ci) => ({
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
      }))
  } catch {
    // silent — CI section just won't render
  }
}

// After mutating manual operations the cashbox balance (manualBalance) and
// per-box summary cards on /cashboxes both change. Refresh both: details
// (waterfall + operations tab) and the store-cached summaries (cashbox list).
async function refreshAfterMutation() {
  await Promise.all([
    loadDetails(),
    loadCapitalSummary(),
    store.fetchAll(),
    // Списки тоже устаревают: раньше их привозил тот же запрос, что и суммы.
    // Без этого удалённая операция оставалась на экране, а счётчик и итоги
    // уже показывали новое значение — экран спорил сам с собой.
    manualOperations.value.length || wfExpanded.value === 'manual' ? loadManualOperations() : Promise.resolve(),
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
  loadAll()
})
// В шапку — имя кассы. Чистим при уходе, иначе оно утечёт на соседний экран.
watch(box, (b) => { if (b) pageHeader.set(b.name) }, { immediate: true })
onUnmounted(() => pageHeader.clear())

onMounted(loadAll)

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
const capitalUtilization = computed(() => {
  if (!capitalDetails.value || capitalDetails.value.totalCapital <= 0) return 0
  return Math.min(Math.round((capitalDetails.value.inProgress / capitalDetails.value.totalCapital) * 100), 100)
})

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
      toast.error(e?.message || 'Не удалось загрузить сделки')
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
})
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
  const partnerCap = box.value?.partnerParticipatesByCapital ? box.value?.initialCapital ?? 0 : 0
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
      deals: (ci.deals ?? []).map((dl) => {
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
const investedCapital = computed(() =>
  capitalSummary.value?.investedCapital ?? capitalDetails.value?.initialCapital ?? 0,
)
const withdrawableProfit = computed(() =>
  capitalSummary.value?.withdrawableProfit ?? Math.max(0, capitalDetails.value?.partnerNetProfit ?? capitalDetails.value?.netProfit ?? 0),
)
const availableCap = computed(() =>
  capitalSummary.value?.availableCapital ?? capitalDetails.value?.availableCapital ?? 0,
)
// Обязательство перед со-инвесторами (cash-basis: деньги ещё в кассе).
const pendingCIPayout = computed(() => capitalDetails.value?.pendingCIPayout ?? 0)

// ─── Пополнения и расходы — в Бухгалтерии ─────────────────────────────────────
// Все ручные движения денег (капитал, доходы и расходы, временные) ведутся в
// одном разделе; из кассы открываем его уже отфильтрованным по этой кассе.
const canOpenFlows = computed(() => auth.canAccess('/accounting/temporary'))
function openFlows() {
  void router.push({ path: '/accounting/temporary', query: { cashBoxId: id.value } })
}
/** Журнал кассы — в панели вкладки «Капитал кассы». */
function openJournal() {
  topTab.value = 'capital'
  wfExpanded.value = 'journal'
}

/** Все расходы по бизнесу этой кассы — сразу нужная ветка и «за всё время». */
function openExpenses() {
  void router.push({
    path: '/accounting/temporary',
    query: { cashBoxId: id.value, tab: 'out', section: 'main', kind: 'expense', period: 'all' },
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
          <!-- Вложение и снятие капитала, доходы и расходы — в «Бухгалтерии →
               Пополнения и расходы»: там все ручные движения денег в одном месте. -->
          <button
            v-if="canOpenFlows"
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
            <button
              v-if="canSeePlan"
              class="fn-tab"
              :class="{ 'fn-tab--active': topTab === 'plan' }"
              @click="topTab = 'plan'"
            >
              Аналитика
            </button>
          </div>
          <!-- Журнал кассы — отдельно от табов и плиток: это книга всех движений,
               из которой сложены их цифры. Открывается в панели «Капитала кассы». -->
          <button
            class="cb-journal-btn"
            :class="{ 'cb-journal-btn--on': topTab === 'capital' && wfExpanded === 'journal' }"
            @click="openJournal"
          >
            <v-icon icon="mdi-book-open-page-variant-outline" size="17" />
            Журнал кассы
          </button>
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
                  <div class="cb-where-sum">{{ a.balance !== null ? formatCurrency(a.balance) : '—' }}</div>
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

        <!-- ─────────── Аналитика вложенного ─────────── -->
        <template v-else-if="topTab === 'plan'">
          <div v-if="planDenied" class="cb-where-empty">
            <v-icon icon="mdi-lock-outline" size="26" />
            <div class="cb-where-empty-title">Аналитика недоступна</div>
            <div class="cb-where-empty-text">
              Раздел закрыт тарифом или правами роли — цифры о судьбе вложенных денег
              берутся оттуда же, откуда «Аналитика» и «Отчёты».
            </div>
          </div>

          <div v-else-if="planLoading && !planSummary" class="cb-plan-loading">
            <v-progress-circular indeterminate size="26" width="3" color="#047857" />
          </div>

          <template v-else-if="planSummary">
            <!-- Точка отсчёта: сколько своих денег партнёр держит в этой кассе. -->
            <div class="cb-plan-top">
              <div>
                <div class="cb-plan-top-label">Вложено в эту кассу</div>
                <div class="cb-plan-top-value">{{ formatCurrency(planInvested) }}</div>
                <div class="cb-plan-top-note">начальный капитал плюс пополнения, минус снятое из вложенного</div>
              </div>
              <button class="cb-where-btn" @click="router.push('/analytics')">
                <v-icon icon="mdi-chart-line" size="16" />
                Полная аналитика
              </button>
            </div>

            <!-- Где эти деньги прямо сейчас. -->
            <div class="cb-plan-cards">
              <div class="cb-plan-card">
                <div class="cb-plan-card-label">В товаре</div>
                <div class="cb-plan-card-value">{{ formatCurrency(capitalDetails.inProgress) }}</div>
                <div class="cb-plan-card-note">закуплено клиентам, вернётся платежами</div>
              </div>
              <div class="cb-plan-card">
                <div class="cb-plan-card-label">Свободно в кассе</div>
                <div class="cb-plan-card-value">{{ formatCurrency(availableCap) }}</div>
                <div class="cb-plan-card-note">можно пустить в новые сделки</div>
              </div>
              <div class="cb-plan-card cb-plan-card--profit">
                <div class="cb-plan-card-label">Заработано</div>
                <div class="cb-plan-card-value">{{ formatCurrency(planEarned) }}</div>
                <div class="cb-plan-card-note">
                  <template v-if="(capitalDetails.coInvestorProfit ?? 0) > 0">чистыми, за вычетом доли со-инвесторов</template>
                  <template v-else>чистая прибыль по сделкам этой кассы</template>
                </div>
              </div>
            </div>

            <div class="cb-plan-workbar">
              <div class="cb-plan-workbar-fill" :style="{ width: planInWorkPct + '%' }" />
            </div>
            <div class="cb-plan-worklegend">
              <span><span class="cb-plan-dot cb-plan-dot--work" /> В товаре {{ planInWorkPct }}%</span>
              <span><span class="cb-plan-dot cb-plan-dot--free" /> Свободно {{ 100 - planInWorkPct }}%</span>
            </div>

            <!-- Главный вопрос: когда вложенное вернётся прибылью. -->
            <div class="cb-plan-block">
              <div class="cb-plan-block-head">
                <span class="cb-plan-block-title">Окупаемость вложенного</span>
                <span class="cb-plan-block-pct">{{ planPaybackPct }}%</span>
              </div>
              <div class="cb-plan-pay">
                <div class="cb-plan-pay-fill" :style="{ width: planPaybackPct + '%' }" />
              </div>
              <div class="cb-plan-pay-row">
                <span>Заработано {{ formatCurrency(planEarned) }}</span>
                <span>Вложено {{ formatCurrency(planInvested) }}</span>
              </div>

              <div v-if="planInvested <= 0" class="cb-plan-verdict">
                <v-icon icon="mdi-information-outline" size="17" />
                <span>Капитал кассы не указан — сравнивать не с чем. Укажите его в настройках кассы или внесите деньги операцией «Капитал».</span>
              </div>
              <div v-else-if="planPaidBack" class="cb-plan-verdict cb-plan-verdict--ok">
                <v-icon icon="mdi-check-decagram-outline" size="17" />
                <span>
                  Вложенное окупилось: прибыль превысила вложенные деньги
                  на {{ formatCurrency(planEarned - planInvested) }}. Всё, что придёт дальше, — доход сверх вложенного.
                </span>
              </div>
              <div v-else-if="planPaybackMonth" class="cb-plan-verdict cb-plan-verdict--wait">
                <v-icon icon="mdi-calendar-clock" size="17" />
                <span>
                  Осталось заработать {{ formatCurrency(planInvested - planEarned) }}.
                  Если платежи придут по графику, вложенное окупится к <b>{{ planMonthName(planPaybackMonth) }}</b>,
                  и дальше пойдёт чистый доход.
                </span>
              </div>
              <div v-else class="cb-plan-verdict cb-plan-verdict--warn">
                <v-icon icon="mdi-alert-circle-outline" size="17" />
                <span>
                  Текущих сделок не хватает, чтобы окупить вложенное: до конца всех графиков
                  ожидается {{ formatCurrency(planProfitLeft) }} дохода, а не хватает
                  {{ formatCurrency(planInvested - planEarned) }}. Окупаемость придёт с новыми сделками.
                </span>
              </div>
            </div>

            <!-- Что придёт дальше: помесячно, с делением на возврат и доход. -->
            <div class="cb-plan-block">
              <div class="cb-plan-block-head">
                <span class="cb-plan-block-title">Что придёт дальше</span>
                <span class="cb-plan-block-sub">ближайший год, по графику платежей</span>
              </div>

              <div v-if="planChart.some((m) => m.total > 0)" class="cb-plan-chart">
                <div v-for="m in planChart" :key="m.month" class="cb-plan-col">
                  <div class="cb-plan-bar" :title="`${planMonthName(m.month)}: ${formatCurrency(m.total)}`">
                    <div
                      class="cb-plan-bar-profit"
                      :style="{ height: (m.profit / planChartMax) * 100 + '%' }"
                    />
                    <div
                      class="cb-plan-bar-principal"
                      :style="{ height: (m.principal / planChartMax) * 100 + '%' }"
                    />
                  </div>
                  <div class="cb-plan-col-label">{{ planMonthShort(m.month) }}</div>
                </div>
              </div>
              <div v-else class="cb-plan-nochart">По текущим сделкам платежей в ближайший год не запланировано</div>

              <div class="cb-plan-legend">
                <span><span class="cb-plan-dot cb-plan-dot--principal" /> Возврат вложенного</span>
                <span><span class="cb-plan-dot cb-plan-dot--profit" /> Ваш доход</span>
              </div>

              <div class="cb-plan-facts">
                <div class="cb-plan-fact">
                  <div class="cb-plan-fact-value">{{ formatCurrency(planExpectedTotal) }}</div>
                  <div class="cb-plan-fact-label">придёт до конца текущих сделок</div>
                </div>
                <div class="cb-plan-fact">
                  <div class="cb-plan-fact-value cb-plan-fact-value--profit">{{ formatCurrency(planProfitLeft) }}</div>
                  <div class="cb-plan-fact-label">из них ваш доход</div>
                </div>
                <div class="cb-plan-fact">
                  <div class="cb-plan-fact-value">
                    {{ planLastMonth ? planMonthName(planLastMonth) : '—' }}
                  </div>
                  <div class="cb-plan-fact-label">последний платёж текущих сделок</div>
                </div>
              </div>

              <!-- Просроченное в прогноз не двигаем: это деньги, которых ждут,
                   но срок уже прошёл — иначе окупаемость выглядела бы ближе. -->
              <div v-if="planOverdue.sum > 0" class="cb-plan-overdue">
                <v-icon icon="mdi-clock-alert-outline" size="17" />
                <span>
                  Просрочено {{ formatCurrency(planOverdue.sum) }} по {{ planOverdue.count }}
                  {{ planOverdue.count === 1 ? 'платежу' : 'платежам' }} — в прогноз выше эти деньги не включены.
                </span>
                <button class="cb-plan-overdue-btn" @click="router.push('/debtors')">Должники</button>
              </div>
            </div>
          </template>
        </template>

        <template v-else>

        <div class="wf-split">
          <!-- Плитки — горизонтальным рядом; детали выбранной — ниже. -->
          <div class="wf-left">
            <button
              class="wf-item"
              :class="{ 'wf-item--active': wfExpanded === 'capital' }"
              @click="wfExpanded = 'capital'"
            >
              <div class="wf-item-value">{{ formatCurrency(capitalDetails.totalCapital) }}</div>
              <div class="wf-item-label">Общий капитал</div>
                          <v-icon class="wf-item-chevron" icon="mdi-chevron-right" size="18" />
            </button>
            <button
              class="wf-item"
              :class="{ 'wf-item--active': wfExpanded === 'profit' }"
              @click="wfExpanded = 'profit'"
            >
              <div class="wf-item-value" style="color: #10b981;">+{{ formatCurrency(capitalDetails.partnerNetProfit ?? capitalDetails.netProfit) }}</div>
              <div class="wf-item-label">Чистая прибыль</div>
                          <v-icon class="wf-item-chevron" icon="mdi-chevron-right" size="18" />
            </button>
            <button
              class="wf-item"
              :class="{ 'wf-item--active': wfExpanded === 'deployed' }"
              @click="wfExpanded = 'deployed'"
            >
              <div class="wf-item-value" style="color: #f59e0b;">-{{ formatCurrency(capitalDetails.inProgress) }}</div>
              <div class="wf-item-label">В работе · {{ capitalDetails.dealsStats?.activeCount ?? 0 }}</div>
                          <v-icon class="wf-item-chevron" icon="mdi-chevron-right" size="18" />
            </button>
            <button
              v-if="capitalDetails.manualBalance !== 0 || (capitalDetails.manualCount ?? 0) > 0 || manualOperations.length > 0"
              class="wf-item"
              :class="{ 'wf-item--active': wfExpanded === 'manual' }"
              @click="wfExpanded = 'manual'"
            >
              <div class="wf-item-value" :style="{ color: capitalDetails.manualBalance > 0 ? '#3b82f6' : '#ef4444' }">
                {{ capitalDetails.manualBalance > 0 ? '+' : '' }}{{ formatCurrency(capitalDetails.manualBalance) }}
              </div>
              <div class="wf-item-label">
                Расходы по бизнесу · {{ capitalDetails.manualBreakdown?.expenseCount ?? capitalDetails.manualCount ?? 0 }}
              </div>
              <!-- Сальдо почти всегда — одни расходы. Если были прочие доходы или
                   старые переводы между кассами, показываем их, иначе цифра
                   плитки не совпала бы с подписью. -->
              <div
                v-if="capitalDetails.manualBreakdown && (capitalDetails.manualBreakdown.income || capitalDetails.manualBreakdown.transfers)"
                class="wf-item-sub"
              >
                расходы −{{ formatCurrencyShort(capitalDetails.manualBreakdown.expense) }}
                <template v-if="capitalDetails.manualBreakdown.income">
                  · прочие доходы +{{ formatCurrencyShort(capitalDetails.manualBreakdown.income) }}
                </template>
                <template v-if="capitalDetails.manualBreakdown.transfers">
                  · переводы {{ capitalDetails.manualBreakdown.transfers > 0 ? '+' : '−' }}{{ formatCurrencyShort(Math.abs(capitalDetails.manualBreakdown.transfers)) }}
                </template>
              </div>
                          <v-icon class="wf-item-chevron" icon="mdi-chevron-right" size="18" />
            </button>

            <button
              class="wf-item wf-item--result"
              :class="{ 'wf-item--active': wfExpanded === 'available' }"
              @click="wfExpanded = 'available'"
            >
              <div class="wf-item-value wf-item-value--big" :style="{ color: box.color }">
                {{ formatCurrency(capitalDetails.availableCapital) }}
              </div>
              <div class="wf-item-label">
                Деньги в кассе
                <v-icon icon="mdi-information-outline" size="11" class="ml-1" />
              </div>
                          <v-icon class="wf-item-chevron" icon="mdi-chevron-right" size="18" />
            </button>

            <!-- Phase 2 cash-basis: obligation owed to CIs. Reported as a
                 separate liability, NOT subtracted from availableCapital.
                 Clickable — opens a per-CI breakdown on the right.
                 Red warning chip appears if balance < pendingCIPayout
                 (partner has spent CI money and must replenish before payout). -->
            <button
              v-if="capitalDetails.pendingCIPayout > 0"
              class="wf-item wf-item--reserve"
              :class="{
                'wf-item--active': wfExpanded === 'pendingCI',
                'wf-item--reserve-danger': capitalDetails.availableCapital < capitalDetails.pendingCIPayout,
              }"
              @click="wfExpanded = 'pendingCI'"
            >
              <div class="wf-item-value" style="color: #f59e0b;">
                {{ formatCurrency(capitalDetails.pendingCIPayout) }}
              </div>
              <div class="wf-item-label">
                Резерв для инвесторов · {{ pendingCiList.length }}
                <span
                  v-if="capitalDetails.availableCapital < capitalDetails.pendingCIPayout"
                  class="wf-reserve-warning"
                >
                  <v-icon icon="mdi-alert-circle" size="11" />
                  Выплатите дивиденды
                </span>
              </div>
                          <v-icon class="wf-item-chevron" icon="mdi-chevron-right" size="18" />
            </button>
          </div>

        <!-- Utilization bar -->
        <div class="wf-utilization">
          <div class="wf-utilization-header">
            <span class="wf-utilization-label">Капитал в работе</span>
            <span class="wf-utilization-percent">{{ capitalUtilization }}%</span>
          </div>
          <div class="wf-utilization-bar">
            <div class="wf-utilization-fill" :style="{ width: capitalUtilization + '%', background: box.color }" />
          </div>
        </div>

          <!-- Детали выбранной плитки — под рядом плиток, во всю ширину. -->
          <div class="wf-right">
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

            <!-- Журнал — с общей шапкой панели; его фильтры и пагинация — свои. -->
            <template v-if="wfExpanded === 'journal'">
              <CashflowJournal class="wf-journal" :cash-box-id="id" @changed="refreshAfterMutation" />
            </template>

            <template v-else-if="wfExpanded === 'available'">
              <div class="wf-expand-subtitle">Из чего сложились деньги кассы</div>
              <div v-if="availableRows.length" class="wf-flow">
                <div
                  v-for="r in availableRows"
                  :key="r.key"
                  class="wf-flow-row"
                  :class="{ 'wf-flow-row--base': r.base }"
                >
                  <div class="wf-flow-main">
                    <span class="wf-flow-label">{{ r.label }}</span>
                    <span
                      class="wf-flow-val"
                      :class="r.value > 0 ? 'wf-flow-val--in' : r.value < 0 ? 'wf-flow-val--out' : ''"
                    >
                      {{ r.value > 0 && !r.base ? '+' : '' }}{{ formatCurrency(r.value) }}
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
              <div class="wf-expand-subtitle">По сделкам</div>
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
              <div class="wf-expand-subtitle">По инвесторам</div>
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
                <div>Нажмите на строку слева для просмотра деталей</div>
              </div>
            </template>
          </div>
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
.cb-journal-btn {
  display: inline-flex; align-items: center; gap: 7px;
  height: 40px; padding: 0 16px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.75);
  transition: all 0.15s;
}
.cb-journal-btn:hover { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.cb-journal-btn--on, .cb-journal-btn--on:hover {
  background: rgba(4, 120, 87, 0.08); border-color: #047857; color: #047857;
}
.wf-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-transform: uppercase; letter-spacing: 0.5px;
}

.wf-split {
  display: flex; flex-direction: column;
  gap: 16px;
}

/* Ряд плиток: сколько влезает в ширину, остальные переносятся. На телефоне —
   одна строка с прокруткой вбок, чтобы выбранная деталь была сразу под ней. */
.wf-left {
  display: grid; gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
}
@media (max-width: 700px) {
  .wf-left {
    display: flex; overflow-x: auto; scrollbar-width: none;
    margin: 0 -24px; padding: 0 24px 2px;
  }
  .wf-left::-webkit-scrollbar { display: none; }
  .wf-left .wf-item { flex: 0 0 168px; }
}
/* Шеврон «вправо» был подсказкой для вертикального списка с панелью справа. */
.wf-left .wf-item-chevron { display: none; }
/* Плитка читается сверху вниз: заголовок — главное, сумма под ним. Кнопка
   по умолчанию центрирует содержимое по вертикали — прижимаем к верху. */
.wf-left .wf-item {
  display: flex; flex-direction: column; justify-content: flex-start; align-items: stretch;
  padding: 14px 16px;
}
.wf-left .wf-item-label {
  order: -1; margin: 0 0 8px;
  font-size: 13.5px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85);
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
}
.wf-left .wf-item-value { font-size: 19px; }
.wf-left .wf-item-value--big { font-size: 22px; }
/* Выбранная плитка — с полосой снизу: её содержимое открыто под рядом. */
.wf-item--active { box-shadow: inset 0 -3px 0 #047857; }
.wf-item--journal .wf-item-value--journal {
  display: flex; align-items: center; gap: 6px;
  font-size: 15px; color: rgba(var(--v-theme-on-surface), 0.85);
}
.wf-item {
  display: block; width: 100%;
  /* Шеврон-подсказка стоит абсолютом справа — отсюда relative и запас справа. */
  position: relative;
  text-align: left; padding: 12px 30px 12px 14px;
  border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
  cursor: pointer; transition: all 0.15s;
}
.wf-item:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.18);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.wf-item--active {
  border-color: #047857; background: rgba(4, 120, 87, 0.06);
}
.wf-item--result {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.2);
  cursor: default;
}
.wf-item-value { font-size: 17px; font-weight: 800; line-height: 1.2; }
.wf-item-value--big { font-size: 22px; }
.wf-item-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 3px; font-weight: 500;
}
.wf-item-sub {
  font-size: 10px; color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 2px; font-weight: 500;
}

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
/* Пагинация журнала — во всю ширину карточки и вплотную к её низу: у неё
   отрицательные поля под padding, а у панели своего padding больше нет. */
.wf-right :deep(.sp-pager:not(.sp-pager--compact)) {
  margin: 0 -24px -20px;
  border-radius: 0 0 16px 16px;
}
.wf-exp-row { align-items: center; gap: 12px; }
.wf-exp-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.wf-exp-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.wf-item-chevron {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.25;
  transition: opacity 0.15s, color 0.15s;
}
.wf-item:hover .wf-item-chevron { opacity: 0.6; }
.wf-item--active .wf-item-chevron { opacity: 1; color: #047857; }


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
.wf-flow-hint {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 2px; line-height: 1.4; max-width: 92%;
}
.wf-item--result { cursor: pointer; }

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

.wf-utilization { margin-top: 0; }
.wf-utilization-header {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}
.wf-utilization-percent { font-weight: 700; }
.wf-utilization-bar {
  height: 6px; border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.06); overflow: hidden;
}
.wf-utilization-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

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
.wf-item--reserve {
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.2);
  cursor: default;
  padding: 10px 14px;
  border-radius: 10px;
}
.wf-item--reserve-danger {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}
.wf-item--reserve-danger .wf-item-value {
  color: #ef4444 !important;
}
.wf-reserve-warning {
  display: inline-flex; align-items: center; gap: 3px;
  margin-left: 6px;
  font-size: 10px; font-weight: 700;
  color: #ef4444;
  text-transform: uppercase; letter-spacing: 0.3px;
}

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
  .wf-item { padding: 10px 28px 10px 12px; }
  .wf-item-value { font-size: 15px; }
  .wf-item-label { font-size: 11px; }
}

/* ── Вкладка «Аналитика»: судьба вложенных денег ── */
.cb-plan-loading { display: flex; justify-content: center; padding: 48px 0; }

.cb-plan-top {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; padding: 16px 0 18px;
}
.cb-plan-top-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.cb-plan-top-value {
  font-size: 28px; font-weight: 700; letter-spacing: -0.6px; margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.cb-plan-top-note { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.48); margin-top: 3px; }

.cb-plan-cards {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
}
.cb-plan-card {
  padding: 13px 15px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.cb-plan-card--profit {
  background: linear-gradient(180deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.03));
  border-color: rgba(16, 185, 129, 0.22);
}
.cb-plan-card-label {
  font-size: 11.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cb-plan-card-value {
  font-size: 19px; font-weight: 700; margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.cb-plan-card--profit .cb-plan-card-value { color: #047857; }
.cb-plan-card-note {
  font-size: 11.5px; line-height: 1.4; margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.42);
}

/* Сколько вложенного сейчас работает, а сколько ждёт своей сделки. */
.cb-plan-workbar {
  height: 8px; border-radius: 5px; overflow: hidden; margin-top: 14px;
  background: rgba(37, 99, 235, 0.18);
}
.cb-plan-workbar-fill {
  height: 100%; border-radius: 5px 0 0 5px;
  background: linear-gradient(90deg, #34d399, #059669);
  transition: width 0.4s;
}
.cb-plan-worklegend {
  display: flex; gap: 18px; flex-wrap: wrap; margin-top: 8px;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.cb-plan-worklegend span { display: inline-flex; align-items: center; gap: 7px; }
.cb-plan-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.cb-plan-dot--work { background: #059669; }
.cb-plan-dot--free { background: rgba(37, 99, 235, 0.5); }
.cb-plan-dot--principal { background: rgba(37, 99, 235, 0.45); }
.cb-plan-dot--profit { background: #059669; }

.cb-plan-block {
  margin-top: 18px; padding: 16px 18px; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.cb-plan-block-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  margin-bottom: 12px;
}
.cb-plan-block-title { font-size: 14.5px; font-weight: 700; }
.cb-plan-block-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.42); }
.cb-plan-block-pct {
  font-size: 14px; font-weight: 700; color: #047857;
  font-variant-numeric: tabular-nums;
}

.cb-plan-pay {
  height: 10px; border-radius: 6px; overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.cb-plan-pay-fill {
  height: 100%; border-radius: 6px 0 0 6px;
  background: linear-gradient(90deg, #10b981, #047857);
  transition: width 0.4s;
}
.cb-plan-pay-row {
  display: flex; justify-content: space-between; gap: 12px; margin-top: 7px;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55);
  font-variant-numeric: tabular-nums;
}

.cb-plan-verdict {
  display: flex; align-items: flex-start; gap: 9px;
  margin-top: 12px; padding: 11px 13px; border-radius: 10px;
  font-size: 13px; line-height: 1.5;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.cb-plan-verdict b { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.cb-plan-verdict--ok {
  background: rgba(16, 185, 129, 0.09); color: #047857;
  border: 1px solid rgba(16, 185, 129, 0.22);
}
.cb-plan-verdict--ok b { color: #047857; }
.cb-plan-verdict--wait {
  background: rgba(37, 99, 235, 0.07); color: rgba(var(--v-theme-on-surface), 0.7);
  border: 1px solid rgba(37, 99, 235, 0.18);
}
.cb-plan-verdict--warn {
  background: rgba(245, 158, 11, 0.09); color: #b45309;
  border: 1px solid rgba(245, 158, 11, 0.25);
}

/* Столбики ожидаемых поступлений: снизу возврат вложенного, сверху доход. */
.cb-plan-chart {
  display: flex; align-items: flex-end; gap: 6px;
  height: 150px; padding-top: 6px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.09);
}
.cb-plan-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; height: 100%; }
.cb-plan-bar {
  flex: 1; width: 100%; max-width: 34px;
  display: flex; flex-direction: column; justify-content: flex-end;
  border-radius: 6px 6px 0 0; overflow: hidden;
}
.cb-plan-bar-profit { background: linear-gradient(180deg, #34d399, #059669); }
.cb-plan-bar-principal { background: rgba(37, 99, 235, 0.4); }
.cb-plan-col-label {
  margin-top: 6px; font-size: 10.5px; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.cb-plan-nochart {
  padding: 26px 0; text-align: center; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.cb-plan-legend {
  display: flex; gap: 18px; flex-wrap: wrap; margin-top: 10px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55);
}
.cb-plan-legend span { display: inline-flex; align-items: center; gap: 7px; }

.cb-plan-facts {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
  margin-top: 14px; padding-top: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.cb-plan-fact-value {
  font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.cb-plan-fact-value--profit { color: #047857; }
.cb-plan-fact-label {
  font-size: 11.5px; line-height: 1.4; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.cb-plan-overdue {
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
  margin-top: 12px; padding: 10px 13px; border-radius: 10px;
  font-size: 12.5px; line-height: 1.45;
  background: rgba(220, 38, 38, 0.06);
  border: 1px solid rgba(220, 38, 38, 0.18);
  color: #b91c1c;
}
.cb-plan-overdue span { flex: 1; min-width: 220px; }
.cb-plan-overdue-btn {
  height: 30px; padding: 0 12px; border-radius: 8px;
  border: 1px solid rgba(220, 38, 38, 0.3);
  font-size: 12.5px; font-weight: 600; color: #b91c1c; cursor: pointer;
}
.cb-plan-overdue-btn:hover { background: rgba(220, 38, 38, 0.08); }

@media (max-width: 700px) {
  .cb-plan-cards, .cb-plan-facts { grid-template-columns: minmax(0, 1fr); }
  .cb-plan-chart { height: 120px; }
  .cb-plan-col-label { font-size: 9.5px; }
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
</style>