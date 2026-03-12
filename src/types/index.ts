// User
export type UserRole = 'client' | 'investor' | 'both'
export type VerificationLevel = 0 | 1 | 2 | 3
export type SubscriptionPlan = 'free' | 'pro' | 'business'

export interface User {
  id: string
  phone: string
  firstName: string
  lastName: string
  patronymic?: string
  city: string
  role: UserRole
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
  createdAt: string
  updatedAt: string
}

// Category
export type Category =
  | 'electronics'
  | 'appliances'
  | 'furniture'
  | 'auto'
  | 'clothing'
  | 'construction'
  | 'medical'
  | 'education'
  | 'other'

export interface CategoryItem {
  id: Category
  label: string
  icon: string
}

// Deal
export type DealStatus =
  | 'created'
  | 'pending_approval'
  | 'approved'
  | 'goods_purchased'
  | 'goods_delivered'
  | 'contract_signed'
  | 'active'
  | 'completed'
  | 'disputed'
  | 'cancelled'

export type PaymentInterval = 'weekly' | 'biweekly' | 'monthly'
export type PaymentType = 'equal' | 'decreasing' | 'custom'

export interface CreateDealInput {
  requestId?: string
  clientId: string
  productName: string
  productPhotos: string[]
  productUrl?: string
  purchasePrice: number
  markup: number
  markupPercent: number
  totalPrice: number
  downPayment: number
  numberOfPayments: number
  paymentInterval: PaymentInterval
  paymentType: PaymentType
  firstPaymentDate: string
}

export interface Deal {
  id: string
  requestId?: string
  clientId: string
  clientName: string
  clientRating: number
  investorId: string
  investorName: string
  investorRating: number
  productName: string
  productPhotos: string[]
  productUrl?: string
  purchasePrice: number
  markup: number
  markupPercent: number
  totalPrice: number
  downPayment: number
  remainingAmount: number
  numberOfPayments: number
  paidPayments: number
  paymentInterval: PaymentInterval
  paymentType: PaymentType
  firstPaymentDate: string
  purchaseReceiptPhoto?: string
  deliveryPhoto?: string
  contractPdf?: string
  status: DealStatus
  createdAt: string
  signedAt?: string
  completedAt?: string
  updatedAt: string
}

// Payment
export type PaymentStatus = 'pending' | 'paid' | 'overdue'
export type PaymentMethod = 'transfer' | 'card' | 'cash' | 'auto'

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
export type RequestStatus = 'moderation' | 'active' | 'accepted' | 'in_progress' | 'completed' | 'cancelled'

export interface CreateRequestInput {
  title: string
  description?: string
  category: Category
  productUrl?: string
  photos: string[]
  price: number
  desiredTermMonths: number
  downPayment?: number
  city: string
  comment?: string
}

export interface Request {
  id: string
  clientId: string
  clientName: string
  clientRating: number
  clientCompletedDeals: number
  title: string
  description?: string
  category: Category
  productUrl?: string
  photos: string[]
  price: number
  desiredTermMonths: number
  downPayment?: number
  city: string
  comment?: string
  status: RequestStatus
  acceptedBy?: string
  createdAt: string
  updatedAt: string
}

// Product
export interface Product {
  id: string
  investorId: string
  investorName: string
  investorRating: number
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

// Common
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
