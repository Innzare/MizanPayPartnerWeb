import { ref } from 'vue'
import { api } from '@/api/client'

export type CashFlowEntryType =
  | 'CAPITAL_TOPUP_OWN'
  | 'DEAL_DEPLOY'
  | 'PAYMENT_IN'
  | 'DIVIDEND_OUT'
  | 'MANUAL_INCOME'
  | 'MANUAL_EXPENSE'
  | 'CAPITAL_IN'
  | 'CAPITAL_OUT'
  | 'PROFIT_ACCRUED'
  | 'DIVIDEND_PAID'

export interface CashFlowEntry {
  id: string
  type: CashFlowEntryType
  date: string
  amount: number          // signed: positive = in, negative = out
  note: string | null
  dealId: string | null
  dealNumber: number | null
  dealProductName: string | null
  paymentId: string | null
  paymentNumber: number | null
  coInvestorId: string | null
  coInvestorName: string | null
}

export interface JournalResponse {
  total: number
  limit: number
  offset: number
  entries: CashFlowEntry[]
}

export interface JournalFilters {
  types?: CashFlowEntryType[]
  from?: string
  to?: string
  dealId?: string
  coInvestorId?: string
  search?: string
  limit?: number
  offset?: number
}

export type JournalSummary = Record<CashFlowEntryType, { total: number; count: number }>

export function useCashflow() {
  const entries = ref<CashFlowEntry[]>([])
  const total = ref(0)
  const summary = ref<JournalSummary | null>(null)
  const loading = ref(false)

  function buildQuery(f: JournalFilters): string {
    const params = new URLSearchParams()
    if (f.types?.length) params.set('types', f.types.join(','))
    if (f.from) params.set('from', f.from)
    if (f.to) params.set('to', f.to)
    if (f.dealId) params.set('dealId', f.dealId)
    if (f.coInvestorId) params.set('coInvestorId', f.coInvestorId)
    if (f.search) params.set('search', f.search)
    if (f.limit != null) params.set('limit', String(f.limit))
    if (f.offset != null) params.set('offset', String(f.offset))
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }

  /**
   * Fetch journal page. By default replaces `entries`; pass `mode: 'append'`
   * to merge with previously loaded ones (used for "load more" pagination).
   */
  async function fetchJournal(f: JournalFilters = {}, mode: 'replace' | 'append' = 'replace') {
    loading.value = true
    try {
      const res = await api.get<JournalResponse>(`/finance/cashflow/journal${buildQuery(f)}`)
      entries.value = mode === 'append' ? [...entries.value, ...res.entries] : res.entries
      total.value = res.total
      return res
    } finally {
      loading.value = false
    }
  }

  async function fetchSummary(f: { from?: string; to?: string } = {}) {
    const params = new URLSearchParams()
    if (f.from) params.set('from', f.from)
    if (f.to) params.set('to', f.to)
    const qs = params.toString()
    summary.value = await api.get<JournalSummary>(
      `/finance/cashflow/summary${qs ? `?${qs}` : ''}`,
    )
  }

  return { entries, total, summary, loading, fetchJournal, fetchSummary }
}
