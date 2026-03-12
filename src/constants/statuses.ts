import type { DealStatus, PaymentStatus, RequestStatus } from '@/types'

interface StatusConfig {
  label: string
  color: string
  bgLight: string
  bgDark: string
}

export const DEAL_STATUS_CONFIG: Record<DealStatus, StatusConfig> = {
  created: { label: 'Создана', color: '#64748b', bgLight: '#f1f5f9', bgDark: '#334155' },
  pending_approval: { label: 'Ожидает подтверждения', color: '#f59e0b', bgLight: '#fffbeb', bgDark: '#451a03' },
  approved: { label: 'Подтверждена', color: '#3b82f6', bgLight: '#eff6ff', bgDark: '#1e3a5f' },
  goods_purchased: { label: 'Товар куплен', color: '#8b5cf6', bgLight: '#f5f3ff', bgDark: '#2e1065' },
  goods_delivered: { label: 'Товар передан', color: '#6366f1', bgLight: '#eef2ff', bgDark: '#312e81' },
  contract_signed: { label: 'Договор подписан', color: '#0ea5e9', bgLight: '#f0f9ff', bgDark: '#0c4a6e' },
  active: { label: 'Активна', color: '#047857', bgLight: '#f0fdf4', bgDark: '#052e16' },
  completed: { label: 'Завершена', color: '#047857', bgLight: '#ecfdf5', bgDark: '#064e3b' },
  disputed: { label: 'Спор', color: '#ef4444', bgLight: '#fef2f2', bgDark: '#450a0a' },
  cancelled: { label: 'Отменена', color: '#94a3b8', bgLight: '#f8fafc', bgDark: '#1e293b' },
}

export const PAYMENT_STATUS_CONFIG: Record<PaymentStatus, StatusConfig> = {
  pending: { label: 'Ожидается', color: '#f59e0b', bgLight: '#fffbeb', bgDark: '#451a03' },
  paid: { label: 'Оплачено', color: '#047857', bgLight: '#f0fdf4', bgDark: '#052e16' },
  overdue: { label: 'Просрочено', color: '#ef4444', bgLight: '#fef2f2', bgDark: '#450a0a' },
}

export const REQUEST_STATUS_CONFIG: Record<RequestStatus, StatusConfig> = {
  moderation: { label: 'На модерации', color: '#64748b', bgLight: '#f1f5f9', bgDark: '#334155' },
  active: { label: 'Активна', color: '#047857', bgLight: '#f0fdf4', bgDark: '#052e16' },
  accepted: { label: 'Принята', color: '#3b82f6', bgLight: '#eff6ff', bgDark: '#1e3a5f' },
  in_progress: { label: 'В процессе', color: '#8b5cf6', bgLight: '#f5f3ff', bgDark: '#2e1065' },
  completed: { label: 'Завершена', color: '#047857', bgLight: '#ecfdf5', bgDark: '#064e3b' },
  cancelled: { label: 'Отменена', color: '#94a3b8', bgLight: '#f8fafc', bgDark: '#1e293b' },
}
