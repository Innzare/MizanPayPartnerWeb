import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

export interface CashBoxSummary {
  id: string
  name: string
  color: string
  icon: string
  initialCapital: number
  isDefault: boolean
  archivedAt: string | null
  order: number
  balance: number
  inProgress: number
  activeDealsCount: number
  dealsCount: number
}

export interface CreateCashBoxInput {
  name: string
  color?: string
  icon?: string
  initialCapital?: number
}

export type UpdateCashBoxInput = Partial<CreateCashBoxInput>

export interface TransferInput {
  toCashBoxId: string
  amount: number
  note?: string
}

export const useCashBoxesStore = defineStore('cashboxes', () => {
  const items = ref<CashBoxSummary[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetchAll() {
    isLoading.value = true
    error.value = null
    try {
      items.value = await api.get<CashBoxSummary[]>('/cashboxes')
    } catch (e: any) {
      error.value = e.message || 'Ошибка загрузки касс'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function findById(id: string): Promise<CashBoxSummary> {
    return api.get<CashBoxSummary>(`/cashboxes/${id}`)
  }

  async function create(data: CreateCashBoxInput): Promise<CashBoxSummary> {
    const created = await api.post<CashBoxSummary>('/cashboxes', data)
    items.value.push(created)
    return created
  }

  async function update(id: string, data: UpdateCashBoxInput): Promise<CashBoxSummary> {
    const updated = await api.patch<CashBoxSummary>(`/cashboxes/${id}`, data)
    const idx = items.value.findIndex((b) => b.id === id)
    if (idx >= 0) items.value[idx] = updated
    return updated
  }

  async function remove(id: string): Promise<void> {
    await api.delete<{ deleted: true }>(`/cashboxes/${id}`)
    items.value = items.value.filter((b) => b.id !== id)
  }

  async function transfer(fromId: string, input: TransferInput): Promise<void> {
    await api.post(`/cashboxes/${fromId}/transfer`, input)
    // Refresh both cashboxes' summaries
    await fetchAll()
  }

  async function moveDeal(dealId: string, toCashBoxId: string): Promise<void> {
    await api.post(`/deals/${dealId}/move-cashbox`, { cashBoxId: toCashBoxId })
    await fetchAll()
  }

  function getById(id: string): CashBoxSummary | undefined {
    return items.value.find((b) => b.id === id)
  }

  function getDefault(): CashBoxSummary | undefined {
    return items.value.find((b) => b.isDefault)
  }

  return {
    items, isLoading, error,
    fetchAll, findById, create, update, remove, transfer, moveDeal,
    getById, getDefault,
  }
})
