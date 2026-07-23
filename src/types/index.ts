// Investor (authenticated user in partner web)
export type VerificationLevel = 'NONE' | 'BASIC' | 'VERIFIED' | 'FULL'
export type SubscriptionPlan = 'FREE' | 'PRO' | 'BUSINESS' | 'PREMIUM'
export type StaffRole = 'MANAGER' | 'OPERATOR'
export type DealsAccessMode = 'ALL' | 'ASSIGNED_ONLY'

export interface PlanFeatures {
  analytics: boolean
  analyticsCharts: boolean
  pdfContract: boolean
  pdfExport: boolean
  excelExport: boolean
  import: boolean
  activity: boolean
  registry: boolean
  coInvestors: boolean
  finance: boolean
  staff: boolean
  whatsapp: boolean
}

// Minimum plan required for each feature. Mirrors backend PLAN_FEATURES —
// keep in sync when changing the matrix in subscription-plans.ts.
export const FEATURE_MIN_PLAN: Record<keyof PlanFeatures, SubscriptionPlan> = {
  analytics: 'PRO',
  analyticsCharts: 'BUSINESS',
  pdfContract: 'PRO',
  pdfExport: 'PRO',
  excelExport: 'BUSINESS',
  import: 'BUSINESS',
  activity: 'PRO',
  registry: 'PRO',
  coInvestors: 'BUSINESS',
  finance: 'PRO',
  staff: 'PREMIUM',
  whatsapp: 'PREMIUM',
}

export const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  FREE: 'Без подписки',
  PRO: 'Стандарт',
  BUSINESS: 'Бизнес',
  PREMIUM: 'Премиум',
}

export function minPlanLabelForFeature(feature: keyof PlanFeatures): string {
  return PLAN_LABELS[FEATURE_MIN_PLAN[feature]]
}

export interface User {
  id: string
  email: string
  phone?: string
  firstName: string
  lastName: string
  patronymic?: string
  city?: string
  avatar?: string
  rating: number
  completedDeals: number
  activeDeals: number
  verificationLevel: VerificationLevel
  passportPhoto?: string
  selfiePhoto?: string
  isBlocked: boolean
  subscriptionPlan: SubscriptionPlan
  subscriptionExpiry?: string
  initialCapital?: number | null
  planLimits?: { maxActiveDeals: number; responseCost: number; maxCashBoxes: number; maxAccessibleDeals?: number }
  planFeatures?: PlanFeatures
  daysUntilExpiry?: number | null
  // Порог доступа к сделкам по тарифу: сделка залочена, если её dealNumber
  // меньше threshold. null = ограничения нет. Используется, чтобы помечать
  // недоступные сделки во всех местах, где они показываются.
  dealAccessThreshold?: number | null
  staffId?: string
  staffRole?: StaffRole
  accessOverrides?: string[]
  canCreateDeals?: boolean
  createdAt: string
  updatedAt: string
}

export interface StaffMember {
  id: string
  email: string
  firstName: string
  lastName: string
  role: StaffRole
  investorId: string
  isActive: boolean
  // Per-staff visibility for deals/payments. ALL = sees everything (default),
  // ASSIGNED_ONLY = sees only deals explicitly assigned to them.
  dealsAccessMode?: DealsAccessMode
  // Routes disabled by the partner on top of the role's base set.
  // Effective access = ROLE_ROUTE_ACCESS[role] - accessOverrides.
  accessOverrides?: string[]
  // Whether the partner allows this staff to create deals/imports.
  canCreateDeals?: boolean
  // Cashbox ids hidden from this staff (deny-list). Empty = sees all cashboxes.
  cashBoxOverrides?: string[]
  createdAt: string
  updatedAt: string
}

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  MANAGER: 'Менеджер',
  OPERATOR: 'Оператор',
}

// Routes accessible per role (owner = all routes). The home page `/` is
// owner-only — staff is redirected to /deals (or first accessible route).
export const ROLE_ROUTE_ACCESS: Record<StaffRole, string[]> = {
  MANAGER: ['/analytics', '/deals', '/clients', '/payments', '/broadcasts', '/products', '/requests', '/co-investors', '/cashboxes', '/registry', '/notifications', '/activity', '/calculator', '/create-deal', '/create-product', '/import', '/messages'],
  OPERATOR: ['/analytics', '/deals', '/clients', '/payments', '/broadcasts', '/notifications', '/activity', '/calculator', '/messages'],
}

// Sections that the partner can disable per-staff via accessOverrides.
// Excludes always-on stuff (`/`, `/calculator`, `/notifications`, `/messages`)
// and action shortcuts (`/create-deal`, `/import`) — those follow their parent.
export const STAFF_TOGGLEABLE_ROUTES: { path: string; label: string; icon: string }[] = [
  { path: '/analytics', label: 'Аналитика', icon: 'mdi-chart-line' },
  { path: '/deals', label: 'Сделки', icon: 'mdi-briefcase' },
  { path: '/clients', label: 'Клиенты', icon: 'mdi-account-group' },
  { path: '/payments', label: 'Платежи', icon: 'mdi-cash-multiple' },
  { path: '/co-investors', label: 'Со-инвесторы', icon: 'mdi-account-group-outline' },
  { path: '/cashboxes', label: 'Кассы', icon: 'mdi-wallet-outline' },
  { path: '/registry', label: 'Реестр клиентов', icon: 'mdi-shield-account' },
  { path: '/activity', label: 'История действий', icon: 'mdi-history' },
]

// Category
export type Category =
  | 'ELECTRONICS'
  | 'APPLIANCES'
  | 'FURNITURE'
  | 'AUTO'
  | 'CLOTHING'
  | 'CONSTRUCTION'
  | 'MEDICAL'
  | 'EDUCATION'
  | 'OTHER'

export interface CategoryItem {
  id: Category
  label: string
  icon: string
}

// Deal
export type DealStatus =
  | 'ACTIVE'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED'

export type PaymentInterval = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'
export type PaymentType = 'EQUAL' | 'DECREASING' | 'CUSTOM'

export interface Deal {
  id: string
  dealNumber: number
  // Тарифная блокировка: сделка недоступна на текущем тарифе (на FREE открыты
  // только последние N сделок). Видна в списке, но открыть/менять нельзя.
  locked?: boolean
  requestId?: string
  clientId: string
  investorId: string
  client?: Partial<User>
  investor?: Partial<User>
  productName: string
  productPhotos: string[]
  contractPhotos?: string[]
  productUrl?: string
  purchasePrice: number
  markup: number
  markupPercent: number
  totalPrice: number
  remainingAmount: number
  downPayment?: number
  // Wholesale cost (what partner paid the supplier). Visible only to
  // the partner — never exposed to client UI/PDF/contracts. Combined
  // with profitSplitBase=FULL_MARGIN, drives a different cashflow split
  // — see backend cash-flow.service.ts for full semantics.
  wholesalePrice?: number | null
  profitSplitBase?: 'MARKUP_ONLY' | 'FULL_MARGIN'
  externalClientName?: string
  externalClientPhone?: string
  clientProfileId?: string
  clientProfile?: ClientProfile
  guarantorProfileId?: string
  guarantorProfile?: ClientProfile
  // До 5 поручителей, упорядочены (order 0 = основной = legacy guarantorProfile).
  guarantors?: { id: string; order: number; clientProfileId: string; clientProfile: ClientProfile }[]
  numberOfPayments: number
  paidPayments: number
  paymentInterval: PaymentInterval
  paymentType: PaymentType
  firstPaymentDate?: string
  dealDate?: string
  status: DealStatus
  folderId?: string | null
  folder?: DealFolder | null
  // Cashbox the deal belongs to (Phase 1 cashboxes). Nullable in API
  // responses until all clients are upgraded; backend always populates it.
  cashBoxId?: string | null
  // Linked co-investors (only id+name as returned by findMyDeals)
  coInvestors?: { coInvestor: { id: string; name: string } }[]
  // Staff member assigned as the responsible party for this deal
  assignedStaffId?: string | null
  assignedStaff?: { id: string; firstName: string; lastName: string } | null
  createdAt: string
  completedAt?: string
  deletedAt?: string
  updatedAt: string
  payments?: Payment[]
}

// Deal Folder
export interface DealFolder {
  id: string
  name: string
  color: string
  icon: string
  order: number
  _count?: { deals: number }
  createdAt: string
}

export type PayoutSchedule = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL'

export const PAYOUT_SCHEDULE_LABELS: Record<PayoutSchedule, string> = {
  MONTHLY: 'Ежемесячно',
  QUARTERLY: 'Раз в квартал',
  SEMIANNUAL: 'Раз в полгода',
  ANNUAL: 'Раз в год',
}

export type PoolModel = 'PARTICIPATING' | 'MANAGING'

export const POOL_MODEL_LABELS: Record<PoolModel, string> = {
  PARTICIPATING: 'Совместная мудараба',
  MANAGING: 'Управление с комиссией',
}

// Phase 3: single CI model. profitPercent is optional —
//   • set (1..99) → fixed share of every deal in the cashbox.
//   • null        → weight-based (share by capital ratio).
// Every CI lives in exactly one cashbox and participates in all its deals.
export interface CoInvestor {
  id: string
  name: string
  phone: string | null
  capital: number
  profitPercent: number | null
  // Phase 4: partner's commission on THIS CI's by-capital share (0..100). Does
  // not apply to a fixed-percent CI. 0 = partner takes no cut (old mudaraba).
  managementFeePct?: number
  // Phase 5: cost-fee mode — partner takes rate% × purchasePrice per deal, the
  // investor gets the rest of the markup. Actual rate is per-deal.
  costFeeMode?: boolean
  costFeeDefaultRatePct?: number | null
  cashBoxId: string
  payoutSchedule?: PayoutSchedule
  // Planned date of the next dividend payout. Auto-advances after each
  // actual payDividends call by one `payoutSchedule` period.
  nextPayoutDate?: string | null
  // Live balances. Backend returns these via the `...ci` spread on findAll.
  currentCapital?: number
  realizedProfit?: number
  totalPayout?: number
  // Public read-only share link. Partner can hand the URL to the CI.
  shareToken?: string | null
  createdAt: string
}

// ── Unified investor person (participation across several cashboxes) ──
// A person groups several STAKES — one per cashbox. Capital/percent/mode/accruals
// live on each stake; the person is a shared header + one public share link.

// Per-cashbox stake as returned in the persons LIST (`GET /co-investors/persons`).
export interface PersonStake {
  id: string
  cashBox: { id: string; name: string; color: string; icon?: string }
  capital: number
  currentCapital: number
  realizedProfit: number
  totalPayout: number
  balanceOwed: number
  profitPercent: number | null
  managementFeePct?: number
  costFeeMode?: boolean
  costFeeDefaultRatePct?: number | null
  // Распределение прибыли по этой кассе (для раскрытия списка).
  coInvestorShare?: number
  myShare?: number
  effectivePct?: number
}

// Агрегат распределения прибыли по всем кассам персоны (для KPI/полосы).
export interface PersonDistribution {
  totalProfit: number
  coInvestorShare: number
  myShare: number
  investorPct: number
}

// Per-cashbox stake as returned in the person DETAIL
// (`GET /co-investors/persons/:personId`) — carries the summary-level fields.
export interface PersonStakeDetail extends PersonStake {
  currentCapital: number
  realizedProfit: number
  totalPayout: number
  balanceOwed: number
  activeDeployment: number
  activeDealsCount: number
  effectivePct: number
  shareBreakdown?: ShareBreakdown | null
  activeDealsBreakdown: CoInvestorSummary['activeDealsBreakdown']
}

export interface InvestorPersonTotals {
  capital: number
  currentCapital: number
  realizedProfit: number
  totalPayout: number
  balanceOwed: number
  // Only present on the detail totals.
  activeDeployment?: number
}

// Row in `GET /co-investors/persons`.
export interface InvestorPerson {
  id: string
  name: string
  phone: string | null
  shareToken: string | null
  payoutSchedule?: PayoutSchedule
  nextPayoutDate?: string | null
  cashBoxCount: number
  totals: InvestorPersonTotals
  distribution?: PersonDistribution
  stakes: PersonStake[]
}

// `GET /co-investors/persons/:personId`.
export interface InvestorPersonDetail {
  person: {
    id: string
    name: string
    phone: string | null
    shareToken: string | null
    payoutSchedule?: PayoutSchedule
    nextPayoutDate?: string | null
    // Показывать ли долю партнёра инвестору в публичном кабинете по ссылке.
    showPartnerShareToInvestor?: boolean
  }
  totals: InvestorPersonTotals
  stakes: PersonStakeDetail[]
}

// Body for `POST /co-investors/persons/:personId/stakes`.
export interface AddStakeInput {
  cashBoxId: string
  capital: number
  profitPercent?: number | null
  managementFeePct?: number
  costFeeMode?: boolean
  costFeeDefaultRatePct?: number | null
  payoutSchedule?: PayoutSchedule
  nextPayoutDate?: string | null
}

export type CoInvestorEntryType = 'CAPITAL_IN' | 'CAPITAL_OUT' | 'PROFIT_ACCRUED' | 'DIVIDEND_PAID'

export interface CoInvestorJournalEntry {
  id: string
  type: CoInvestorEntryType
  date: string
  amount: number
  note: string | null
  dealId: string | null
  dealNumber: number | null
  dealProductName: string | null
  paymentId: string | null
  paymentNumber: number | null
  meta: Record<string, unknown> | null
}

export interface CoInvestorJournal {
  total: number
  limit: number
  offset: number
  entries: CoInvestorJournalEntry[]
}

export interface CoInvestorSummary {
  coInvestor: { id: string; name: string; phone: string | null; profitPercent: number | null; payoutSchedule?: PayoutSchedule; nextPayoutDate?: string | null }
  currentCapital: number
  capitalIn: number
  capitalOut: number
  realizedProfit: number
  totalPayout: number
  balanceOwed: number
  activeDeployment: number
  activeDealsCount: number
  // Phase 3: CI's effective share of cashbox profit (0..100). Mirrors
  // accrueProfitForCoInvestors so the UI breakdown matches journal entries.
  effectivePct: number
  // Derivation of effectivePct for the detail page (where "16.67%" comes from).
  shareBreakdown?: ShareBreakdown | null
  activeDealsBreakdown: Array<{
    id: string
    dealNumber: number
    productName: string
    purchasePrice: number
    dealDate: string
    totalPrice?: number
    // Статус сделки — для фильтра «Все / Активные / Завершённые».
    status?: 'ACTIVE' | 'COMPLETED'
    stake: number
    // Expected profit for THIS investor from this deal (for cost-fee = his income).
    expectedProfit?: number
    // Вся прибыль сделки (наценка) и способ деления — для разбора доли.
    dealProfit?: number
    // Доля ПАРТНЁРА = прибыль − доли всех со-инвесторов. В публичном кабинете
    // инвестора отсутствует, если у личности выключен showPartnerShareToInvestor.
    partnerProfit?: number
    // Прогресс к завершению сделки.
    paidPayments?: number
    numberOfPayments?: number
    modeLabel?: string
    // Cost-fee deals carry the per-deal split for the «В работе» modal.
    costFee?: { ratePct: number; partnerFee: number; investorShare: number }
  }>
}

// How a co-investor's effective profit % is derived.
export type ShareBreakdown =
  | { mode: 'fixed'; fixedPct: number; effectivePct: number }
  | {
      mode: 'weight'
      capital: number            // this CI's capital in the pool
      partnerCapital: number     // partner's capital in the pool (0 if not participating)
      partnerParticipates: boolean
      otherCICapital: number     // sum of other by-capital CIs' capital
      poolCapital: number        // denominator = capital + partnerCapital + otherCICapital
      remainingPct: number       // 100 − Σ fixed-% investors (what by-capital pool splits)
      hasFixedInvestors: boolean
      grossPct: number           // remainingPct × capital / poolCapital (before commission)
      commissionPct: number      // partner's commission on this CI
      effectivePct: number       // grossPct × (1 − commission)
    }
  // Phase 5: cost-fee — rate is per-deal, so the cashbox-level view just names
  // the mode + default rate; real numbers are per-deal in activeDealsBreakdown.
  | { mode: 'cost_fee'; defaultRatePct: number | null }

// Phase 4: per-deal co-investor participation.
// A co-investor participating in a specific deal, with an optional per-deal
// override of their profit percent and the resulting effective percent.
export interface DealParticipant {
  id: string
  name: string
  phone: string | null
  profitPercent: number | null
  managementFeePct?: number
  capital: number
  currentCapital?: number
  // Per-deal override of the fixed percent. null = use the CI's default mode.
  profitPercentOverride: number | null
  // Per-deal override of the partner's commission for a WEIGHT investor
  // (profitPercent == null, не cost-fee). null ⇒ дефолтная комиссия CI
  // (managementFeePct). Взаимоисключимо с profitPercentOverride/costFeeRatePct.
  managementFeePctOverride?: number | null
  // override ?? profitPercent — the fixed percent applied to THIS deal
  // (null ⇒ this CI shares by capital weight).
  effectivePercent: number | null
  // Phase 5: cost-fee. costFeeMode marks the investor; costFeeRatePct is the
  // rate applied to THIS deal (prefilled from the CI's default).
  costFeeMode?: boolean
  costFeeDefaultRatePct?: number | null
  costFeeRatePct?: number | null
}

// GET/PUT co-investors/deal/:dealId response.
export interface DealCoInvestors {
  cashBoxId: string | null
  partnerParticipatesByCapital: boolean
  participants: DealParticipant[]
  // Co-investors of the deal's cashbox not currently participating — the
  // partner can attach them.
  available: Array<{
    id: string
    name: string
    phone: string | null
    profitPercent: number | null
    managementFeePct?: number
    capital: number
    costFeeMode?: boolean
    costFeeDefaultRatePct?: number | null
  }>
}

// Payment
export type PaymentStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CLOSED_EARLY'
export type PaymentMethod = 'TRANSFER' | 'CARD' | 'CASH' | 'AUTO'

export interface Payment {
  id: string
  dealId: string
  number: number
  amount: number
  dueDate: string
  paidAt?: string
  status: PaymentStatus
  method?: PaymentMethod
  proofScreenshot?: string
  remainingAfter: number
  note?: string
  rescheduledFrom?: string
  rescheduledAt?: string
  rescheduleReason?: string
  deal?: Deal
}

// Request
export type RequestStatus = 'MODERATION' | 'ACTIVE' | 'OFFER_SENT' | 'COMPLETED' | 'CANCELLED'

export interface CreateRequestInput {
  title: string
  description?: string
  category: Category
  productUrl?: string
  photos: string[]
  price: number
  city: string
  comment?: string
}

export interface Request {
  id: string
  clientId: string
  client?: Partial<User>
  title: string
  description?: string
  category: Category
  productUrl?: string
  photos: string[]
  price: number
  city: string
  comment?: string
  status: RequestStatus
  acceptedById?: string
  acceptedBy?: Partial<User>

  // Offer tiers
  offerTiers?: { termMonths: number; markupPercent: number; minDownPaymentPercent: number }[]

  createdAt: string
  updatedAt: string
}

// Product
export interface Product {
  id: string
  investorId: string
  investor?: Partial<User>
  title: string
  description?: string
  category: Category
  photos: string[]
  price: number
  minTermMonths: number
  maxTermMonths: number
  minDownPaymentPercent: number
  city: string
  isAvailable: boolean
  createdAt: string
  updatedAt?: string
}

// Calculator
export type CalculatorMode = 'basic' | 'advanced' | 'reverse' | 'portfolio'

export interface BasicCalculatorInputs {
  purchasePrice: number
  markupType: 'percent' | 'fixed'
  markupValue: number
  termMonths: number
  downPayment: number
  paymentType: 'equal' | 'decreasing'
}

export interface AdvancedCalculatorInputs extends BasicCalculatorInputs {
  platformCommission: number
  transferFee: number
  riskPercent: number
  inflationPercent: number
  cac: number
}

export interface ReverseCalculatorInputs {
  purchasePrice: number
  desiredProfit: number
  termMonths: number
  downPayment: number
}

export interface PortfolioCalculatorInputs {
  activeDeals: number
  averageCheck: number
  averageMargin: number
  averageTerm: number
}

export interface CalculatorResult {
  totalPrice: number
  markup: number
  markupPercent: number
  profit: number
  monthlyPayment: number
  roi: number
  effectiveAnnualYield?: number
  netProfit?: number
  netYield?: number
  breakEvenPoint?: number
  riskAdjustedProfit?: number
}

export interface ReverseCalculatorResult {
  requiredMarkup: number
  requiredMarkupPercent: number
  totalPrice: number
  monthlyPayment: number
}

export interface PortfolioCalculatorResult {
  totalTurnover: number
  totalProfit: number
  averageYield: number
  monthlyForecast: { month: string; amount: number }[]
  riskLevel: 'low' | 'medium' | 'high'
}

// ==================== CLIENT PROFILES ====================

export interface ClientProfile {
  id: string
  phone: string
  firstName: string
  lastName: string
  patronymic?: string
  birthDate?: string
  passportSeries?: string
  passportNumber?: string
  passportIssuedBy?: string
  passportIssuedAt?: string
  registrationAddress?: string
  residentialAddress?: string
  inn?: string
  userId?: string
  user?: Partial<User>
  createdByInvestorId?: string
  createdAt: string
  updatedAt: string
}

export interface ClientProfileStats {
  profile: ClientProfile
  totalDeals: number
  activeDeals: number
  completedDeals: number
  overduePayments: number
  totalVolume: number
  blacklistEntries: {
    id: string
    reason?: string
    createdAt: string
    investorName: string
    investorId: string
  }[]
  reviews: {
    id: string
    rating: number
    comment?: string
    createdAt: string
    investorName: string
    investorId: string
  }[]
}

export function clientProfileName(p?: ClientProfile | null): string {
  if (!p) return '—'
  return `${p.lastName || ''} ${p.firstName || ''} ${p.patronymic || ''}`.trim() || '—'
}

// ==================== ACTIVITY LOG ====================

export type ActivityType =
  | 'DEAL_CREATED'
  | 'DEAL_DELETED'
  | 'DEAL_RESTORED'
  | 'DEAL_PERMANENTLY_DELETED'
  | 'DEAL_STATUS_CHANGED'
  | 'PAYMENT_PAID'
  | 'PAYMENT_UNPAID'
  | 'PAYMENT_RESCHEDULED'
  | 'CLIENT_BLACKLISTED'
  | 'CLIENT_UNBLACKLISTED'
  | 'CLIENT_REVIEW_ADDED'
  | 'TRANSACTION_CREATED'
  | 'TRANSACTION_DELETED'
  | 'STAFF_INVITED'
  | 'STAFF_REMOVED'
  | 'STAFF_ROLE_CHANGED'
  | 'PROFILE_UPDATED'
  | 'REQUEST_OFFER_SENT'
  | 'PRODUCT_CREATED'
  | 'PRODUCT_DELETED'

export interface ActivityLog {
  id: string
  investorId: string
  actorType: 'OWNER' | 'STAFF'
  actorId: string
  actorName: string
  type: ActivityType
  title: string
  description?: string
  entityType?: string
  entityId?: string
  meta?: Record<string, any>
  createdAt: string
}

// ==================== CHATS (partner ↔ staff messaging) ====================

export type ChatAuthorType = 'OWNER' | 'STAFF'

export interface ChatCounterpart {
  id: string
  firstName: string
  lastName: string
  role?: StaffRole
  isActive?: boolean
}

export interface ChatLastMessage {
  text: string
  createdAt: string
  authorType: ChatAuthorType
}

export interface ChatThread {
  id: string
  counterpart: ChatCounterpart
  lastMessage: ChatLastMessage | null
  unreadCount: number
  updatedAt: string
}

export interface DealMention {
  dealId: string
  dealNumber: number
  productName: string
}

export interface ChatMessage {
  id: string
  chatId: string
  authorType: ChatAuthorType
  authorId: string
  text: string
  dealMentions: DealMention[] | null
  createdAt: string
}

// Capital
export interface CapitalSummary {
  initialCapital: number | null
  coInvestorCapital: number
  totalCapital: number
  deployed: number
  received: number
  netProfit: number
  // Profit accrued to co-investors (subtract from netProfit to get partner's cut).
  coInvestorProfit?: number
  // Partner's net profit = netProfit − coInvestorProfit.
  partnerNetProfit?: number
  inProgress: number
  coInvestorPayout: number
  manualBalance: number
  availableCapital: number
  // Капитал кассы: вложенный (seed + пополнения − снятое из капитала) и доход,
  // который можно снять без уменьшения капитала. Заполняются /cashboxes/:id/capital.
  investedCapital?: number
  withdrawableProfit?: number
}

// Helpers
export function userName(u?: Partial<User> | null): string {
  if (!u) return '—'
  return `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—'
}
