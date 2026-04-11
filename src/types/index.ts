// Investor (authenticated user in partner web)
export type VerificationLevel = 'NONE' | 'BASIC' | 'VERIFIED' | 'FULL'
export type SubscriptionPlan = 'FREE' | 'PRO' | 'BUSINESS'
export type StaffRole = 'MANAGER' | 'OPERATOR'

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
  staffId?: string
  staffRole?: StaffRole
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
  createdAt: string
  updatedAt: string
}

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  MANAGER: 'Менеджер',
  OPERATOR: 'Оператор',
}

// Routes accessible per role (owner = all routes)
export const ROLE_ROUTE_ACCESS: Record<StaffRole, string[]> = {
  MANAGER: ['/', '/analytics', '/deals', '/clients', '/payments', '/products', '/requests', '/co-investors', '/finance', '/registry', '/notifications', '/activity', '/calculator', '/create-deal', '/create-product', '/import'],
  OPERATOR: ['/', '/analytics', '/deals', '/clients', '/payments', '/notifications', '/activity', '/calculator'],
}

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
  numberOfPayments: number
  paidPayments: number
  paymentInterval: PaymentInterval
  paymentType: PaymentType
  firstPaymentDate?: string
  status: DealStatus
  createdAt: string
  completedAt?: string
  deletedAt?: string
  updatedAt: string
  payments?: Payment[]
}

// Payment
export type PaymentStatus = 'PENDING' | 'PAID' | 'OVERDUE'
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

// Helpers
export function userName(u?: Partial<User> | null): string {
  if (!u) return '—'
  return `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—'
}
