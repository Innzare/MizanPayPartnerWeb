import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'
import type { CapitalSummary } from '@/types'

export interface CashBoxSummary {
  id: string
  name: string
  color: string
  icon: string
  initialCapital: number
  isDefault: boolean
  archivedAt: string | null
  // Not null → the cashbox is in read-only mode because the active cashbox
  // count exceeds the plan limit (e.g. after a downgrade). Locked cashboxes
  // can still record payments / dividend payouts, but can't get new deals.
  lockedAt: string | null
  order: number
  // Phase 4: partner's own capital joins the by-capital profit split in this
  // cashbox (true) or partner only manages, taking a cut via each CI's
  // commission (false).
  partnerParticipatesByCapital: boolean
  balance: number
  inProgress: number
  activeDealsCount: number
  dealsCount: number
}

// One deal's contribution to the cashbox figures — used by the "В работе"
// info modal on the list page.
export interface CashBoxDealBreakdown {
  id: string
  productName: string
  client: string | null
  purchasePrice: number
  totalPrice: number
  downPayment: number
  received: number
  status: string
  progress: number
}

export interface CreateCashBoxInput {
  name: string
  color?: string
  icon?: string
  initialCapital?: number
  partnerParticipatesByCapital?: boolean
}

export type UpdateCashBoxInput = Partial<CreateCashBoxInput>

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

  // Per-deal breakdown for the "В работе" info modal. The list page's
  // inProgress counts ACTIVE deals as (purchasePrice − received), so the modal
  // filters to ACTIVE and reuses the same per-deal `received` (which includes
  // the down payment, since it's booked as PAYMENT_IN).
  async function fetchDeals(id: string): Promise<CashBoxDealBreakdown[]> {
    const details = await api.get<{ deals: CashBoxDealBreakdown[] }>(`/cashboxes/${id}/capital/details`)
    return details.deals ?? []
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

  // Partner's own capital summary for a cashbox (incl. investedCapital /
  // withdrawableProfit — see task contract).
  async function fetchCapital(cashBoxId: string): Promise<CapitalSummary> {
    return api.get<CapitalSummary>(`/cashboxes/${cashBoxId}/capital`)
  }

  // Пополнение (+) / снятие (−) собственного капитала кассы. amount SIGNED.
  // Бэк: снятие сначала из дохода, затем из вложенного капитала; 400 если
  // снятие > доступного. Возвращает обновлённую сводку капитала.
  async function adjustPartnerCapital(cashBoxId: string, amount: number, note?: string): Promise<CapitalSummary> {
    return api.post<CapitalSummary>(`/cashboxes/${cashBoxId}/capital/adjust`, {
      amount,
      note: note?.trim() || undefined,
    })
  }

  // Отмена записи пополнения/снятия собственного капитала кассы
  // (CAPITAL_TOPUP_OWN / CAPITAL_WITHDRAW_OWN). Откатывает капитал; 400 если
  // запись не та или доступный капитал уйдёт в минус. Возвращает сводку капитала.
  async function cancelPartnerCapital(cashBoxId: string, entryId: string): Promise<CapitalSummary> {
    return api.delete<CapitalSummary>(`/cashboxes/${cashBoxId}/capital/${entryId}`)
  }

  async function moveDeal(dealId: string, toCashBoxId: string): Promise<void> {
    await api.post(`/deals/${dealId}/move-cashbox`, { cashBoxId: toCashBoxId })
    await fetchAll()
  }

  // Choose which cashboxes stay ACTIVE when the plan limit is exceeded. The
  // backend locks everything not in `activeIds` (must be ≤ limit, ≥ 1) and
  // returns the refreshed list. 400 if more than the limit.
  async function setActive(activeIds: string[]): Promise<CashBoxSummary[]> {
    const updated = await api.post<CashBoxSummary[]>('/cashboxes/active-selection', { activeIds })
    items.value = updated
    return updated
  }

  function getById(id: string): CashBoxSummary | undefined {
    return items.value.find((b) => b.id === id)
  }

  function getDefault(): CashBoxSummary | undefined {
    return items.value.find((b) => b.isDefault)
  }

  return {
    items, isLoading, error,
    fetchAll, findById, fetchDeals, fetchCapital, adjustPartnerCapital, cancelPartnerCapital, create, update, remove, moveDeal, setActive,
    getById, getDefault,
  }
})
