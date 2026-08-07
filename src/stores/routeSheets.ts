import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

export type RouteSheetStatus = 'ISSUED' | 'COMPLETED' | 'CANCELLED'
export type RouteSheetLineStatus = 'PENDING' | 'PAID' | 'SKIPPED'

export interface RouteSheetRow {
  id: string
  number: number
  date: number
  status: RouteSheetStatus
  note: string | null
  assignedStaffId: string | null
  assignedStaffName: string | null
  linesCount: number
  paidLinesCount: number
  totalPlanned: number
  totalDebt: number
  totalPaid: number
  createdAt: number
}

export interface RouteSheetLineDebt {
  debtId: string
  dealId: string
  amountPlanned: number
  debtTotal: number
  dealNumber: number
  productName: string
  remaining: number
  debtStatus: 'OPEN' | 'SETTLED' | 'CANCELLED'
}

export interface RouteSheetLine {
  id: string
  supplierId: string
  supplierName: string
  supplierCity: string | null
  supplierPhone: string | null
  supplierAddress: string | null
  order: number
  amountPlanned: number
  debtTotal: number
  amountPaid: number | null
  comment: string | null
  status: RouteSheetLineStatus
  paidAt: number | null
  debts: RouteSheetLineDebt[]
}

export interface RouteSheetDetail {
  id: string
  number: number
  date: number
  status: RouteSheetStatus
  note: string | null
  assignedStaffId: string | null
  assignedStaffName: string | null
  lines: RouteSheetLine[]
}

export interface RouteSheetLineInput {
  supplierId: string
  amountPlanned?: number
  comment?: string
  debts?: { debtId: string; amount: number }[]
}
export interface RouteSheetInput {
  date?: string
  assignedStaffId?: string
  note?: string
  lines: RouteSheetLineInput[]
}

export const useRouteSheetsStore = defineStore('routeSheets', () => {
  const rows = ref<RouteSheetRow[]>([])
  const loading = ref(false)

  async function fetchList(status?: RouteSheetStatus | 'all') {
    loading.value = true
    try {
      rows.value = await api.get<RouteSheetRow[]>(`/route-sheets${status ? '?status=' + status : ''}`)
    } finally {
      loading.value = false
    }
  }
  function getOne(id: string) {
    return api.get<RouteSheetDetail>(`/route-sheets/${id}`)
  }
  function create(data: RouteSheetInput) {
    return api.post<RouteSheetDetail>('/route-sheets', data)
  }
  function update(id: string, data: { date?: string; assignedStaffId?: string | null; note?: string; lines?: RouteSheetLineInput[] }) {
    return api.patch<RouteSheetDetail>(`/route-sheets/${id}`, data)
  }
  function payLine(id: string, lineId: string, data: { date?: string; note?: string; allowPartial?: boolean } = {}) {
    return api.post<RouteSheetDetail>(`/route-sheets/${id}/lines/${lineId}/pay`, data)
  }
  function skipLine(id: string, lineId: string, comment?: string) {
    return api.post<RouteSheetDetail>(`/route-sheets/${id}/lines/${lineId}/skip`, { comment })
  }
  function revertLine(id: string, lineId: string) {
    return api.post<RouteSheetDetail>(`/route-sheets/${id}/lines/${lineId}/revert`, {})
  }
  function cancel(id: string) {
    return api.post<RouteSheetDetail>(`/route-sheets/${id}/cancel`, {})
  }
  function remove(id: string) {
    return api.delete<{ deleted: true }>(`/route-sheets/${id}`)
  }

  return { rows, loading, fetchList, getOne, create, update, payLine, skipLine, revertLine, cancel, remove }
})
