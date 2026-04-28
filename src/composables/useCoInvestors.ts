import { ref } from 'vue'
import { api } from '@/api/client'
import type { CoInvestor, CoInvestorJournal, CoInvestorJournalEntry, CoInvestorSummary } from '@/types'

const coInvestors = ref<CoInvestor[]>([])
const loading = ref(false)

export function useCoInvestors() {
  async function fetchCoInvestors() {
    loading.value = true
    try {
      coInvestors.value = await api.get<CoInvestor[]>('/co-investors')
    } catch { /* silent */ }
    finally { loading.value = false }
  }

  async function createCoInvestor(data: { name: string; phone?: string; capital: number; profitPercent: number }) {
    const created = await api.post<CoInvestor>('/co-investors', data)
    coInvestors.value.push(created)
    return created
  }

  async function fetchSummary(id: string) {
    return api.get<CoInvestorSummary>(`/co-investors/${id}/summary`)
  }

  async function fetchJournal(id: string, params: { types?: string[]; from?: string; to?: string; limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams()
    if (params.types?.length) query.set('types', params.types.join(','))
    if (params.from) query.set('from', params.from)
    if (params.to) query.set('to', params.to)
    if (params.limit != null) query.set('limit', String(params.limit))
    if (params.offset != null) query.set('offset', String(params.offset))
    const qs = query.toString()
    return api.get<CoInvestorJournal>(`/co-investors/${id}/cashflow${qs ? '?' + qs : ''}`)
  }

  async function payDividends(id: string, body: { amount: number; note?: string; date?: string; idemKey?: string }) {
    return api.post<CoInvestorSummary>(`/co-investors/${id}/dividends`, body)
  }

  async function fetchDetail(id: string) {
    return api.get<CoInvestor & {
      stats: { totalDeals: number; activeDeals: number; completedDeals: number; totalProfit: number; coInvestorShare: number; myShare: number }
    }>(`/co-investors/${id}`)
  }

  return {
    coInvestors,
    loading,
    fetchCoInvestors,
    createCoInvestor,
    fetchSummary,
    fetchJournal,
    payDividends,
    fetchDetail,
  }
}

export type { CoInvestorJournalEntry, CoInvestorSummary }
