import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api/client'
import type { Deal } from '@/types'

interface DealAnalytics {
  totalDeals: number
  activeDeals: number
  completedDeals: number
  revenue: number
  avgRating: number
}

export const useDealsStore = defineStore('deals', () => {
  const deals = ref<Deal[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const investorDeals = computed(() => deals.value.filter((d) => !d.deletedAt))

  const activeDeals = computed(() =>
    deals.value.filter((d) => d.status === 'ACTIVE' && !d.deletedAt)
  )

  const completedDeals = computed(() =>
    deals.value.filter((d) => d.status === 'COMPLETED' && !d.deletedAt)
  )

  const totalInvested = computed(() =>
    investorDeals.value.reduce((sum, d) => sum + d.purchasePrice, 0)
  )

  const totalRevenue = computed(() =>
    investorDeals.value.reduce((sum, d) => sum + d.totalPrice, 0)
  )

  const totalProfit = computed(() =>
    investorDeals.value.reduce((sum, d) => sum + d.markup, 0)
  )

  const totalRemaining = computed(() =>
    activeDeals.value.reduce((sum, d) => sum + d.remainingAmount, 0)
  )

  const monthlyIncome = computed(() => {
    return activeDeals.value.reduce((sum, d) => {
      if (d.numberOfPayments > 0) {
        return sum + d.totalPrice / d.numberOfPayments
      }
      return sum
    }, 0)
  })

  const roi = computed(() => {
    if (totalInvested.value === 0) return 0
    return (totalProfit.value / totalInvested.value) * 100
  })

  async function fetchDeals(params?: { status?: string }) {
    isLoading.value = true
    error.value = null
    try {
      let query = '?role=investor'
      if (params?.status) query += `&status=${params.status}`
      deals.value = await api.get<Deal[]>(`/deals${query}`)
    } catch (e: any) {
      error.value = e.message || 'Ошибка загрузки сделок'
      console.error('Failed to fetch deals:', e)
    } finally {
      isLoading.value = false
    }
  }

  function getDeal(id: string): Deal | undefined {
    return deals.value.find((d) => d.id === id)
  }

  async function fetchDeal(id: string): Promise<Deal | null> {
    try {
      const deal = await api.get<Deal>(`/deals/${id}`)
      const index = deals.value.findIndex((d) => d.id === id)
      if (index >= 0) {
        deals.value[index] = deal
      } else {
        deals.value.push(deal)
      }
      return deal
    } catch (e: any) {
      console.error('Failed to fetch deal:', e)
      return null
    }
  }

  async function updateDealStatus(id: string, status: Deal['status']) {
    try {
      const updated = await api.patch<Deal>(`/deals/${id}/status`, { status })
      const index = deals.value.findIndex((d) => d.id === id)
      if (index >= 0) {
        deals.value[index] = updated
      }
    } catch (e: any) {
      console.error('Failed to update deal status:', e)
      throw e
    }
  }

  async function fetchAnalytics(): Promise<DealAnalytics | null> {
    try {
      return await api.get<DealAnalytics>('/deals/analytics')
    } catch (e: any) {
      console.error('Failed to fetch analytics:', e)
      return null
    }
  }

  async function createDirectDeal(data: {
    clientId?: string
    externalClientName?: string
    externalClientPhone?: string
    clientProfileId?: string
    guarantorProfileId?: string
    productName: string
    productPhotos?: string[]
    contractPhotos?: string[]
    productUrl?: string
    purchasePrice: number
    markupPercent: number
    downPayment?: number
    numberOfPayments: number
    paymentInterval?: string
    paymentType?: string
    dealDate?: string
    firstPaymentDate?: string
  }) {
    isLoading.value = true
    error.value = null
    try {
      const deal = await api.post<Deal>('/deals/direct', data)
      deals.value.unshift(deal)
      return deal
    } catch (e: any) {
      error.value = e.message || 'Не удалось создать сделку'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  // ==================== TRASH ====================

  const trash = ref<Deal[]>([])
  const trashLoading = ref(false)

  async function fetchTrash() {
    trashLoading.value = true
    try {
      trash.value = await api.get<Deal[]>('/deals/trash/list')
    } catch (e: any) {
      console.error('Failed to fetch trash:', e)
    } finally {
      trashLoading.value = false
    }
  }

  async function restoreDeal(id: string) {
    await api.patch(`/deals/trash/${id}/restore`)
    const deal = trash.value.find((d) => d.id === id)
    trash.value = trash.value.filter((d) => d.id !== id)
    if (deal) deals.value.unshift(deal)
  }

  async function restoreBatch(ids: string[]) {
    await api.post('/deals/trash/restore-batch', { ids })
    const restored = trash.value.filter((d) => ids.includes(d.id))
    trash.value = trash.value.filter((d) => !ids.includes(d.id))
    deals.value.unshift(...restored)
  }

  async function permanentDelete(id: string) {
    await api.delete(`/deals/trash/${id}/permanent`)
    trash.value = trash.value.filter((d) => d.id !== id)
  }

  async function emptyTrash() {
    await api.delete('/deals/trash/empty')
    trash.value = []
  }

  async function updateGuarantor(dealId: string, guarantorProfileId: string | null) {
    const updated = await api.patch<Deal>(`/deals/${dealId}/guarantor`, { guarantorProfileId })
    const idx = deals.value.findIndex(d => d.id === dealId)
    if (idx !== -1) deals.value[idx] = updated
    return updated
  }

  return {
    deals, isLoading, error, investorDeals, activeDeals, completedDeals,
    totalInvested, totalRevenue, totalProfit, totalRemaining, monthlyIncome, roi,
    fetchDeals, getDeal, fetchDeal, updateDealStatus, fetchAnalytics, createDirectDeal,
    trash, trashLoading, fetchTrash, restoreDeal, restoreBatch, permanentDelete, emptyTrash,
    updateGuarantor,
  }
})