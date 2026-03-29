import type { DealStatus, PaymentStatus, RequestStatus } from '@/types'

interface StatusConfig {
  label: string
  color: string
  bgLight: string
  bgDark: string
}

export const DEAL_STATUS_CONFIG: Record<DealStatus, StatusConfig> = {
  ACTIVE: { label: 'Активна', color: '#047857', bgLight: '#f0fdf4', bgDark: '#052e16' },
  COMPLETED: { label: 'Завершена', color: '#047857', bgLight: '#ecfdf5', bgDark: '#064e3b' },
  DISPUTED: { label: 'Спор', color: '#ef4444', bgLight: '#fef2f2', bgDark: '#450a0a' },
  CANCELLED: { label: 'Отменена', color: '#94a3b8', bgLight: '#f8fafc', bgDark: '#1e293b' },
}

export const PAYMENT_STATUS_CONFIG: Record<PaymentStatus, StatusConfig> = {
  PENDING: { label: 'Ожидается', color: '#f59e0b', bgLight: '#fffbeb', bgDark: '#451a03' },
  PAID: { label: 'Оплачено', color: '#047857', bgLight: '#f0fdf4', bgDark: '#052e16' },
  OVERDUE: { label: 'Просрочено', color: '#ef4444', bgLight: '#fef2f2', bgDark: '#450a0a' },
}

export const REQUEST_STATUS_CONFIG: Record<RequestStatus, StatusConfig> = {
  MODERATION: { label: 'На модерации', color: '#64748b', bgLight: '#f1f5f9', bgDark: '#334155' },
  ACTIVE: { label: 'Активна', color: '#047857', bgLight: '#f0fdf4', bgDark: '#052e16' },
  ACCEPTED: { label: 'Принята', color: '#3b82f6', bgLight: '#eff6ff', bgDark: '#1e3a5f' },
  IN_PROGRESS: { label: 'В процессе', color: '#8b5cf6', bgLight: '#f5f3ff', bgDark: '#2e1065' },
  COMPLETED: { label: 'Завершена', color: '#047857', bgLight: '#ecfdf5', bgDark: '#064e3b' },
  CANCELLED: { label: 'Отменена', color: '#94a3b8', bgLight: '#f8fafc', bgDark: '#1e293b' },
}
