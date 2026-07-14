import { ref } from 'vue'
import { api } from '@/api/client'
import type { CoInvestor, CoInvestorJournal, CoInvestorJournalEntry, CoInvestorSummary, DealCoInvestors, InvestorPerson, InvestorPersonDetail, AddStakeInput } from '@/types'

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

  async function createCoInvestor(data: { name: string; phone?: string; capital: number; profitPercent: number | null; managementFeePct?: number; costFeeMode?: boolean; costFeeDefaultRatePct?: number | null; cashBoxId?: string; nextPayoutDate?: string | null }) {
    const created = await api.post<CoInvestor>('/co-investors', data)
    coInvestors.value.push(created)
    return created
  }

  async function updateCoInvestor(id: string, data: { name?: string; phone?: string; profitPercent?: number | null; managementFeePct?: number; costFeeMode?: boolean; costFeeDefaultRatePct?: number | null; payoutSchedule?: string; nextPayoutDate?: string | null }) {
    const updated = await api.patch<CoInvestor>(`/co-investors/${id}`, data)
    const idx = coInvestors.value.findIndex((c) => c.id === id)
    if (idx >= 0) coInvestors.value[idx] = { ...coInvestors.value[idx], ...updated }
    return updated
  }

  // ── Unified investor person (participation across several cashboxes) ──
  // A person groups several per-cashbox stakes under one shared header + link.
  async function fetchPersons() {
    return api.get<InvestorPerson[]>('/co-investors/persons')
  }

  async function fetchPerson(personId: string) {
    return api.get<InvestorPersonDetail>(`/co-investors/persons/${personId}`)
  }

  // Update the PERSON identity/schedule. Synced into all the person's stakes
  // by the backend. Body fields are all optional.
  async function updatePerson(
    personId: string,
    data: { name?: string; phone?: string; payoutSchedule?: string; nextPayoutDate?: string | null },
  ) {
    return api.patch<{ id: string }>(`/co-investors/persons/${personId}`, data)
  }

  // Update ONE stake (per-cashbox participation). `capital` is treated as a
  // delta/adjustment by the backend. Share-mode fields update the split.
  async function updateStake(
    stakeId: string,
    data: {
      capital?: number
      profitPercent?: number | null
      managementFeePct?: number
      costFeeMode?: boolean
      costFeeDefaultRatePct?: number | null
      name?: string
      phone?: string
      payoutSchedule?: string
      nextPayoutDate?: string | null
    },
  ) {
    return api.patch<{ id: string }>(`/co-investors/${stakeId}`, data)
  }

  // Create a stake for this person in another cashbox. A duplicate stake in a
  // cashbox where the person already participates → 400 «уже участвует».
  async function addStake(personId: string, data: AddStakeInput) {
    return api.post<{ id: string }>(`/co-investors/persons/${personId}/stakes`, data)
  }

  // ── Phase 4: per-deal participation ──
  // Who shares a specific deal's profit + which cashbox CIs are still available.
  async function fetchDealCoInvestors(dealId: string) {
    return api.get<DealCoInvestors>(`/co-investors/deal/${dealId}`)
  }

  // Replace the full set of participants for a deal. Omitted CIs are detached.
  async function saveDealCoInvestors(
    dealId: string,
    participants: Array<{ coInvestorId: string; profitPercentOverride?: number | null; managementFeePctOverride?: number | null; costFeeRatePct?: number | null }>,
  ) {
    return api.put<DealCoInvestors>(`/co-investors/deal/${dealId}`, { participants })
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

  // ── Capital pop/withdraw (signed amount) + dividend reinvest ──
  // adjustCapital: amount SIGNED — positive = пополнение, negative = снятие.
  // Снятие ограничено currentCapital (иначе бэк вернёт 400). Возвращает summary.
  async function adjustCapital(id: string, amount: number, note?: string) {
    return api.post<CoInvestorSummary>(`/co-investors/${id}/capital`, {
      amount,
      note: note?.trim() || undefined,
    })
  }

  // reinvest: часть «к выплате» (balanceOwed) возвращается в капитал. amount > 0
  // и ≤ balanceOwed (иначе 400). Деньги из кассы не выходят. Возвращает summary.
  async function reinvest(id: string, amount: number) {
    return api.post<CoInvestorSummary>(`/co-investors/${id}/reinvest`, { amount })
  }

  // cancelCapital: отменяет запись пополнения/снятия капитала (CAPITAL_IN /
  // CAPITAL_OUT) и откатывает капитал. 400 если запись не капитальная, реинвест
  // или откат уведёт капитал в минус. Возвращает обновлённую summary.
  async function cancelCapital(coInvestorId: string, entryId: string) {
    return api.delete<CoInvestorSummary>(`/co-investors/${coInvestorId}/capital/${entryId}`)
  }

  // cancelDividend: отменяет дивидендную запись (DIVIDEND_PAID) — обычную выплату
  // ИЛИ реинвест (бэк определяет по типу). Обычная выплата → сумма снова
  // причитается; реинвест → капитал откатывается и сумма снова причитается.
  // 400 если запись не дивидендная. Возвращает обновлённую summary.
  async function cancelDividend(coInvestorId: string, entryId: string) {
    return api.delete<CoInvestorSummary>(`/co-investors/${coInvestorId}/dividend/${entryId}`)
  }

  // ── Removal (backend-ready) ──
  // Two operations sharing the same `mode`/`unpaid` query semantics:
  //  • removeStake  — drop ONE stake from its cashbox (the person stays).
  //  • deletePerson — drop the investor across ALL their cashboxes.
  // mode=exclude keeps history + archives; mode=full wipes everything (capital,
  // accruals AND dividend payouts). `unpaid` only matters for exclude+debt.
  type RemoveOpts = { mode: 'full' | 'exclude'; unpaid?: 'keep' | 'writeoff' }

  function removeQuery({ mode, unpaid }: RemoveOpts) {
    const q = new URLSearchParams({ mode })
    if (unpaid) q.set('unpaid', unpaid)
    return q.toString()
  }

  async function removeStake(stakeId: string, opts: RemoveOpts) {
    return api.delete<void>(`/co-investors/${stakeId}?${removeQuery(opts)}`)
  }

  async function deletePerson(personId: string, opts: RemoveOpts) {
    return api.delete<void>(`/co-investors/persons/${personId}?${removeQuery(opts)}`)
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
    updateCoInvestor,
    fetchSummary,
    fetchJournal,
    payDividends,
    adjustCapital,
    reinvest,
    cancelCapital,
    cancelDividend,
    fetchDetail,
    fetchDealCoInvestors,
    saveDealCoInvestors,
    fetchPersons,
    fetchPerson,
    updatePerson,
    updateStake,
    addStake,
    removeStake,
    deletePerson,
  }
}

export type { CoInvestorJournalEntry, CoInvestorSummary }
