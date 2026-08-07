import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

export interface SupplierRow {
  id: string
  name: string
  activity: string | null
  contactName: string | null
  phone: string | null
  email: string | null
  city: string | null
  address: string | null
  lat: number | null
  lng: number | null
  notes: string | null
  archivedAt: number | null
  debtTotal: number
  openDebtsCount: number
  plannedDebtsCount: number
  dealsCount: number
}

export interface SupplierInput {
  name: string
  activity?: string
  contactName?: string
  phone?: string
  email?: string
  city?: string
  address?: string
  lat?: number
  lng?: number
  notes?: string
}

export interface SupplierSummary {
  totalDebt: number
  suppliersWithDebt: number
  suppliersCount: number
}

export type DebtStatus = 'OPEN' | 'SETTLED' | 'CANCELLED'
export interface SupplierDebt {
  id: string
  dealId: string
  dealNumber: number
  productName: string
  dealDate: number
  dealStatus: string
  amount: number
  paidAmount: number
  remaining: number
  status: DebtStatus
  inRouteSheet: boolean
  routeSheetNumber: number | null
  routeSheetId: string | null
  createdAt: number
}
export interface SupplierDeal {
  dealId: string
  dealNumber: number
  productName: string
  purchasePrice: number
  totalPrice: number
  status: string
  dealDate: number
  paidToSupplier: boolean
  debt: { amount: number; paidAmount: number; remaining: number; status: DebtStatus } | null
}
export interface SupplierPayout {
  id: string
  amount: number
  date: number
  note: string | null
  fromRouteSheet: boolean
  allocations: { amount: number; dealNumber: number; productName: string }[]
}
export interface PayoutInput {
  amount: number
  date?: string
  note?: string
  allocations?: { debtId: string; amount: number }[]
  idemKey?: string
}

export type SupplierRequestStatus = 'NEW' | 'CONVERTED' | 'REJECTED' | 'CANCELLED'
export interface SupplierRequest {
  id: string
  supplierId: string
  supplierName: string | null
  supplierCity: string | null
  productName: string
  category: string | null
  city: string | null
  price: number | null
  clientProfileId: string | null
  clientName: string | null
  clientPhone: string | null
  comment: string | null
  photos: string[]
  status: SupplierRequestStatus
  dealId: string | null
  dealNumber: number | null
  createdAt: number
}
export interface SupplierRequestInput {
  supplierId: string
  productName: string
  category?: string
  city?: string
  price?: number
  clientProfileId?: string | null
  comment?: string
  photos?: string[]
}

export type SupplierActivityType =
  | 'SUPPLIER_CREATED' | 'SUPPLIER_UPDATED' | 'SUPPLIER_DELETED'
  | 'SUPPLIER_PAYOUT' | 'SUPPLIER_PAYOUT_CANCELLED'
  | 'SUPPLIER_REQUEST_CREATED' | 'SUPPLIER_REQUEST_STATUS'
  | 'ROUTE_SHEET_CREATED' | 'ROUTE_SHEET_LINE_PAID' | 'ROUTE_SHEET_CANCELLED'
export interface SupplierActivity {
  id: string
  actorType: string
  actorName: string
  type: SupplierActivityType
  title: string
  description: string | null
  entityType: string | null
  entityId: string | null
  createdAt: string
}

export const useSuppliersStore = defineStore('suppliers', () => {
  const rows = ref<SupplierRow[]>([])
  const loading = ref(false)
  const summary = ref<SupplierSummary>({ totalDebt: 0, suppliersWithDebt: 0, suppliersCount: 0 })

  async function fetchList(params: { search?: string; hasDebt?: boolean; sort?: 'debt' | 'name'; archived?: boolean } = {}) {
    loading.value = true
    try {
      const q = new URLSearchParams()
      if (params.search) q.set('search', params.search)
      if (params.hasDebt) q.set('hasDebt', 'true')
      if (params.sort) q.set('sort', params.sort)
      if (params.archived) q.set('archived', 'true')
      const qs = q.toString()
      rows.value = await api.get<SupplierRow[]>(`/suppliers${qs ? '?' + qs : ''}`)
    } finally {
      loading.value = false
    }
  }

  async function fetchSummary() {
    summary.value = await api.get<SupplierSummary>('/suppliers/summary')
  }

  function getOne(id: string) {
    return api.get<SupplierRow & { paidTotal: number }>(`/suppliers/${id}`)
  }

  async function create(data: SupplierInput): Promise<SupplierRow> {
    return api.post<SupplierRow>('/suppliers', data)
  }
  async function update(id: string, data: Partial<SupplierInput>): Promise<SupplierRow> {
    return api.patch<SupplierRow>(`/suppliers/${id}`, data)
  }
  function remove(id: string): Promise<{ deleted: boolean; archived: boolean }> {
    return api.delete<{ deleted: boolean; archived: boolean }>(`/suppliers/${id}`)
  }

  // ── Detail: debts / deals / payouts ──
  function fetchDebts(id: string, status?: 'OPEN' | 'SETTLED' | 'all', excludeRouteSheetId?: string) {
    const q = new URLSearchParams()
    if (status) q.set('status', status)
    if (excludeRouteSheetId) q.set('excludeRouteSheet', excludeRouteSheetId)
    const qs = q.toString()
    return api.get<SupplierDebt[]>(`/suppliers/${id}/debts${qs ? '?' + qs : ''}`)
  }
  function fetchDeals(id: string) {
    return api.get<SupplierDeal[]>(`/suppliers/${id}/deals`)
  }
  function fetchPayouts(id: string) {
    return api.get<SupplierPayout[]>(`/suppliers/${id}/payouts`)
  }
  function createPayout(id: string, data: PayoutInput) {
    return api.post(`/suppliers/${id}/payouts`, data)
  }
  function cancelPayout(id: string, payoutId: string) {
    return api.delete<{ deleted: true }>(`/suppliers/${id}/payouts/${payoutId}`)
  }

  // ── Заявки от поставщиков ──
  const requestsNewCount = ref(0)

  function fetchRequests(params: { status?: SupplierRequestStatus | 'all'; supplierId?: string } = {}) {
    const q = new URLSearchParams()
    if (params.status) q.set('status', params.status)
    if (params.supplierId) q.set('supplierId', params.supplierId)
    const qs = q.toString()
    return api.get<SupplierRequest[]>(`/supplier-requests${qs ? '?' + qs : ''}`)
  }
  async function fetchRequestsCount() {
    const res = await api.get<{ newCount: number }>('/supplier-requests/count')
    requestsNewCount.value = res.newCount
    return res.newCount
  }
  function getRequest(id: string) {
    return api.get<SupplierRequest>(`/supplier-requests/${id}`)
  }
  function createRequest(data: SupplierRequestInput) {
    return api.post<SupplierRequest>('/supplier-requests', data)
  }
  function updateRequest(id: string, data: Partial<SupplierRequestInput>) {
    return api.patch<SupplierRequest>(`/supplier-requests/${id}`, data)
  }
  function setRequestStatus(id: string, status: 'NEW' | 'REJECTED' | 'CANCELLED') {
    return api.post<SupplierRequest>(`/supplier-requests/${id}/status`, { status })
  }
  function removeRequest(id: string) {
    return api.delete<{ deleted: true }>(`/supplier-requests/${id}`)
  }

  // ── История операций раздела ──
  function fetchActivity(params: { types?: string[]; limit?: number; offset?: number } = {}) {
    const q = new URLSearchParams()
    if (params.types?.length) q.set('types', params.types.join(','))
    if (params.limit != null) q.set('limit', String(params.limit))
    if (params.offset != null) q.set('offset', String(params.offset))
    const qs = q.toString()
    return api.get<{ items: SupplierActivity[]; total: number }>(`/suppliers/activity${qs ? '?' + qs : ''}`)
  }

  return {
    rows, loading, summary, fetchList, fetchSummary, getOne, create, update, remove,
    fetchDebts, fetchDeals, fetchPayouts, createPayout, cancelPayout,
    requestsNewCount, fetchRequests, fetchRequestsCount, getRequest, createRequest, updateRequest, setRequestStatus, removeRequest,
    fetchActivity,
  }
})
