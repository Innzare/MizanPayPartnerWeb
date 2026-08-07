import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

export type PromiseStatus = 'PENDING' | 'KEPT' | 'BROKEN' | 'SUPERSEDED'
export type CollectionActivityType = 'NOTE' | 'CALL' | 'WHATSAPP' | 'CONTACTED' | 'PROMISE' | 'SYSTEM'

export interface CollectionActivity {
  id: string
  type: CollectionActivityType
  text: string | null
  actorType: 'OWNER' | 'STAFF'
  actorId: string
  actorName: string
  promisedDate: number | null
  promisedAmount: number | null
  promiseStatus: PromiseStatus | null
  promisedPaymentNumbers: number[]
  createdAt: number
}

// One row in the debtors table — a deal with overdue payments plus aggregates.
export interface DebtorRow {
  dealId: string
  dealNumber: number
  clientName: string
  clientPhone: string | null
  productName: string
  totalPrice: number
  remainingAmount: number
  paidPayments: number
  numberOfPayments: number
  overdueAmount: number
  overdueCount: number
  overdueDays: number
  nextDueDate: number | null
  nextDueAmount: number
  promisedDate: number | null
  promisedAmount: number | null
  promiseStatus: PromiseStatus | null
  assignedStaffId: string | null
  assignedStaffName: string | null
  lastActivityAt: number | null
  lastActivityText: string | null
  lastActivityType: string | null
  dealStatus: string
  resolvedAt: number | null
}

export interface DebtorSettings {
  minOverdueDays: number
  minOverdueAmount: number
}

export type PaymentStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CLOSED_EARLY'
export interface DealPayment {
  id: string
  number: number
  dueDate: number
  amount: number
  status: PaymentStatus
  paidAt: number | null
  daysOverdue: number
}

export interface StaffMember {
  id: string
  firstName: string
  lastName: string
  isActive: boolean
}

export interface AgingBucket { count: number; amount: number }
export interface DebtorAnalytics {
  kpi: {
    debtorsCount: number
    overdueTotal: number
    overdueCount: number
    avgOverdueDays: number
    remainingTotal: number
    assigned: number
    unassigned: number
    collectedAmount: number
    collectedCount: number
  }
  aging: { d1_7: AgingBucket; d8_30: AgingBucket; d31_60: AgingBucket; d60p: AgingBucket }
  promises: { made: number; kept: number; broken: number; pending: number }
  byStaff: {
    staffId: string
    staffName: string
    assignedCount: number
    overdueAmount: number
    collectedAmount: number
    promisesMade: number
    promisesKept: number
    promisesBroken: number
  }[]
}

export const useDebtorsStore = defineStore('debtors', () => {
  const rows = ref<DebtorRow[]>([])
  const archiveRows = ref<DebtorRow[]>([])
  const archiveLoading = ref(false)
  const loading = ref(false)
  const settings = ref<DebtorSettings>({ minOverdueDays: 1, minOverdueAmount: 0 })
  const settingsLoading = ref(false)
  const staff = ref<StaffMember[]>([])

  async function fetchDebtors() {
    loading.value = true
    try {
      rows.value = await api.get<DebtorRow[]>('/debtors')
    } finally {
      loading.value = false
    }
  }

  async function fetchArchive() {
    archiveLoading.value = true
    try {
      archiveRows.value = await api.get<DebtorRow[]>('/debtors/archive')
    } finally {
      archiveLoading.value = false
    }
  }

  async function fetchSettings() {
    settingsLoading.value = true
    try {
      settings.value = await api.get<DebtorSettings>('/debtors/settings')
    } finally {
      settingsLoading.value = false
    }
  }

  async function updateSettings(data: Partial<DebtorSettings>): Promise<DebtorSettings> {
    settings.value = await api.patch<DebtorSettings>('/debtors/settings', data)
    return settings.value
  }

  // ── Платежи сделки (для модалки) ──
  function fetchDealPayments(dealId: string): Promise<DealPayment[]> {
    return api.get<DealPayment[]>(`/debtors/${dealId}/payments`)
  }

  // ── Лента активности ──
  function fetchActivities(dealId: string): Promise<CollectionActivity[]> {
    return api.get<CollectionActivity[]>(`/debtors/${dealId}/activities`)
  }

  async function addActivity(
    dealId: string,
    payload: { type: 'NOTE' | 'CALL' | 'WHATSAPP' | 'CONTACTED'; text: string },
  ): Promise<CollectionActivity> {
    const act = await api.post<CollectionActivity>(`/debtors/${dealId}/activities`, payload)
    patchRow(dealId, { lastActivityAt: act.createdAt, lastActivityText: act.text, lastActivityType: act.type })
    return act
  }

  type PromisePayload = { promisedDate: string; promisedAmount?: number; note?: string; paymentNumbers?: number[] }

  // Несколько обещаний на сделку. Колонку списка пересчитывает бэкенд из ленты,
  // поэтому после мутаций вызывающий обновляет строки через fetchDebtors.
  function addPromise(dealId: string, payload: PromisePayload): Promise<CollectionActivity> {
    return api.post<CollectionActivity>(`/debtors/${dealId}/promise`, payload)
  }
  function editPromise(activityId: string, payload: PromisePayload): Promise<CollectionActivity> {
    return api.patch<CollectionActivity>(`/debtors/promise/${activityId}`, payload)
  }
  function deletePromise(activityId: string): Promise<{ deleted: true }> {
    return api.delete<{ deleted: true }>(`/debtors/promise/${activityId}`)
  }

  function deleteActivity(id: string): Promise<{ deleted: true }> {
    return api.delete<{ deleted: true }>(`/debtors/activities/${id}`)
  }

  // ── Сотрудники + назначение ──
  async function fetchStaff() {
    const list = await api.get<StaffMember[]>('/auth/investor/staff')
    staff.value = list.filter((s) => s.isActive)
  }

  function fetchAnalytics(params: { from?: string; to?: string; staffId?: string | null }): Promise<DebtorAnalytics> {
    const q = new URLSearchParams()
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    if (params.staffId) q.set('staffId', params.staffId)
    const qs = q.toString()
    return api.get<DebtorAnalytics>(`/debtors/analytics${qs ? '?' + qs : ''}`)
  }

  async function bulkAssign(dealIds: string[], staffId: string | null): Promise<{ updated: number }> {
    const res = await api.patch<{ updated: number }>('/debtors/bulk-assign', { dealIds, staffId })
    const name = staffId ? (staff.value.find((s) => s.id === staffId) ?? null) : null
    const staffName = name ? `${name.firstName ?? ''} ${name.lastName ?? ''}`.trim() : null
    for (const id of dealIds) patchRow(id, { assignedStaffId: staffId, assignedStaffName: staffName })
    return res
  }

  /** Локально обновить строку списка без полного рефетча. */
  function patchRow(dealId: string, partial: Partial<DebtorRow>) {
    const idx = rows.value.findIndex((r) => r.dealId === dealId)
    if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...partial } as DebtorRow
  }

  return {
    rows, archiveRows, archiveLoading, loading, settings, settingsLoading, staff,
    fetchDebtors, fetchArchive, fetchSettings, updateSettings,
    fetchDealPayments, fetchActivities, addActivity, addPromise, editPromise, deletePromise, deleteActivity, patchRow,
    fetchStaff, bulkAssign, fetchAnalytics,
  }
})
