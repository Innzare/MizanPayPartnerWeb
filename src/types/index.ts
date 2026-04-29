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
  planLimits?: { maxActiveDeals: number; responseCost: number }
  planFeatures?: PlanFeatures
  daysUntilExpiry?: number | null
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
  MANAGER: ['/analytics', '/deals', '/clients', '/payments', '/products', '/requests', '/co-investors', '/finance', '/registry', '/notifications', '/activity', '/calculator', '/create-deal', '/create-product', '/import', '/messages'],
  OPERATOR: ['/analytics', '/deals', '/clients', '/payments', '/notifications', '/activity', '/calculator', '/messages'],
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
  { path: '/finance', label: 'Мой капитал', icon: 'mdi-wallet-outline' },
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
  externalClientName?: string
  externalClientPhone?: string
  clientProfileId?: string
  clientProfile?: ClientProfile
  guarantorProfileId?: string
  guarantorProfile?: ClientProfile
  numberOfPayments: number
  paidPayments: number
  paymentInterval: PaymentInterval
  paymentType: PaymentType
  firstPaymentDate?: string
  status: DealStatus
  folderId?: string | null
  folder?: DealFolder | null
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

export type CoInvestorMode = 'PER_DEAL' | 'POOL'
export type PoolModel = 'PARTICIPATING' | 'MANAGING'

export const CO_INVESTOR_MODE_LABELS: Record<CoInvestorMode, string> = {
  PER_DEAL: 'По сделкам',
  POOL: 'Общий пул',
}

export const POOL_MODEL_LABELS: Record<PoolModel, string> = {
  PARTICIPATING: 'Совместная мудараба',
  MANAGING: 'Управление с комиссией',
}

export interface CoInvestor {
  id: string
  name: string
  phone: string | null
  capital: number
  profitPercent: number
  payoutSchedule?: PayoutSchedule
  mode?: CoInvestorMode
  // Live balances. Backend returns these via the `...ci` spread on findAll.
  currentCapital?: number
  realizedProfit?: number
  totalPayout?: number
  createdAt: string
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
  coInvestor: { id: string; name: string; phone: string | null; profitPercent: number; payoutSchedule?: PayoutSchedule; mode?: CoInvestorMode }
  currentCapital: number
  capitalIn: number
  capitalOut: number
  realizedProfit: number
  totalPayout: number
  balanceOwed: number
  activeDeployment: number
  activeDealsCount: number
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
  inProgress: number
  coInvestorPayout: number
  manualBalance: number
  availableCapital: number
}

// Helpers
export function userName(u?: Partial<User> | null): string {
  if (!u) return '—'
  return `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—'
}
