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

/** Параметры страницы — ровно то, что понимает сервер. */
export interface DebtorsPageParams {
  q?: string
  promise?: string
  /** 'unassigned' | staffId. «Мои» страница разворачивает в свой staffId. */
  assignee?: string | null
  sort?: string
  dir?: 'asc' | 'desc'
  limit: number
  offset: number
}

/** KPI шапки — считаются на сервере по всей выборке, а не по странице. */
export interface DebtorsKpi {
  count: number
  overdueAmount: number
  overdueCount: number
  unassigned: number
  broken: number
}

interface Page<T> { items: T[]; total: number; limit: number; offset: number }

function debtorsQuery(p: DebtorsPageParams): string {
  const qs = new URLSearchParams()
  if (p.q?.trim()) qs.set('q', p.q.trim())
  if (p.promise && p.promise !== 'all') qs.set('promise', p.promise)
  if (p.assignee) qs.set('assignee', p.assignee)
  if (p.sort) qs.set('sort', p.sort)
  if (p.dir) qs.set('dir', p.dir)
  qs.set('limit', String(p.limit))
  if (p.offset) qs.set('offset', String(p.offset))
  return qs.toString()
}

export const useDebtorsStore = defineStore('debtors', () => {
  // Строки ТЕКУЩЕЙ страницы, а не весь список: раздел больше не выкачивает
  // всех должников партнёра в браузер.
  const rows = ref<DebtorRow[]>([])
  const total = ref(0)
  const archiveRows = ref<DebtorRow[]>([])
  const archiveTotal = ref(0)
  const archiveLoading = ref(false)
  const loading = ref(false)
  const kpi = ref<DebtorsKpi | null>(null)
  const kpiLoading = ref(false)
  const settings = ref<DebtorSettings>({ minOverdueDays: 1, minOverdueAmount: 0 })
  const settingsLoading = ref(false)
  const staff = ref<StaffMember[]>([])

  // Защита от гонок: быстрый набор в поиске порождает несколько запросов, и
  // ответ на устаревший может прийти последним, затерев свежий результат.
  let listReq = 0
  let archiveReq = 0
  // Последний запрос страницы — чтобы модалки могли перезагрузить список, не
  // зная ни фильтров, ни номера страницы.
  let lastParams: { params: DebtorsPageParams; archive: boolean } | null = null

  async function fetchDebtors(params: DebtorsPageParams) {
    lastParams = { params, archive: false }
    const req = ++listReq
    loading.value = true
    try {
      const res = await api.get<Page<DebtorRow>>(`/debtors?${debtorsQuery(params)}`)
      if (req !== listReq) return
      rows.value = res.items
      total.value = res.total
    } finally {
      if (req === listReq) loading.value = false
    }
  }

  async function fetchArchive(params: DebtorsPageParams) {
    lastParams = { params, archive: true }
    const req = ++archiveReq
    archiveLoading.value = true
    try {
      const res = await api.get<Page<DebtorRow>>(`/debtors/archive?${debtorsQuery(params)}`)
      if (req !== archiveReq) return
      archiveRows.value = res.items
      archiveTotal.value = res.total
    } finally {
      if (req === archiveReq) archiveLoading.value = false
    }
  }

  /** Перезагрузить текущую страницу теми же условиями (после мутации). */
  function refreshCurrent(): Promise<void> {
    if (!lastParams) return Promise.resolve()
    return lastParams.archive ? fetchArchive(lastParams.params) : fetchDebtors(lastParams.params)
  }

  async function fetchKpi() {
    kpiLoading.value = true
    try {
      kpi.value = await api.get<DebtorsKpi>('/debtors/kpi')
    } finally {
      kpiLoading.value = false
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

  /**
   * Назначить ответственного. `matching` включает режим «вся выборка»: сервер
   * сам найдёт сделки теми же фильтрами, а `dealIds` тогда означает снятые
   * галочки (исключения).
   */
  async function bulkAssign(
    dealIds: string[],
    staffId: string | null,
    matching?: { mode: 'active' | 'archive'; q?: string; promise?: string; assignee?: string | null } | null,
  ): Promise<{ updated: number }> {
    const res = await api.patch<{ updated: number }>('/debtors/bulk-assign', {
      dealIds,
      staffId,
      ...(matching
        ? {
            allMatching: matching.mode,
            ...(matching.q?.trim() ? { q: matching.q.trim() } : {}),
            ...(matching.promise && matching.promise !== 'all' ? { promise: matching.promise } : {}),
            ...(matching.assignee ? { assignee: matching.assignee } : {}),
          }
        : {}),
    })
    // В режиме «вся выборка» dealIds — это исключения, локально их править
    // нельзя: страницу перезагружает вызывающий.
    if (!matching) {
      const name = staffId ? (staff.value.find((s) => s.id === staffId) ?? null) : null
      const staffName = name ? `${name.firstName ?? ''} ${name.lastName ?? ''}`.trim() : null
      for (const id of dealIds) patchRow(id, { assignedStaffId: staffId, assignedStaffName: staffName })
    }
    return res
  }

  /** Локально обновить строку списка без полного рефетча. */
  function patchRow(dealId: string, partial: Partial<DebtorRow>) {
    for (const list of [rows, archiveRows]) {
      const idx = list.value.findIndex((r) => r.dealId === dealId)
      if (idx >= 0) list.value[idx] = { ...list.value[idx], ...partial } as DebtorRow
    }
  }

  return {
    rows, total, archiveRows, archiveTotal, archiveLoading, loading, kpi, kpiLoading,
    settings, settingsLoading, staff,
    fetchDebtors, fetchArchive, refreshCurrent, fetchKpi, fetchSettings, updateSettings,
    fetchDealPayments, fetchActivities, addActivity, addPromise, editPromise, deletePromise, deleteActivity, patchRow,
    fetchStaff, bulkAssign, fetchAnalytics,
  }
})
