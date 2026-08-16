import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Page, Payment, PaymentCalendarDay, PaymentFacets } from '@/types'
import { api } from '@/api/client'

/** Параметры страницы платежей — ровно то, что понимает сервер. */
export interface PaymentsPageParams {
  tab?: 'active' | 'pending' | 'overdue' | 'paid' | 'all'
  /** 'YYYY-MM'; отсутствие — все месяцы. */
  month?: string
  /** По плановому сроку или по дате фактической оплаты. */
  monthBasis?: 'due' | 'paid'
  tz?: string
  dueFrom?: string
  dueTo?: string
  folderId?: string | null
  cashBoxId?: string | null
  assignedStaffId?: string | null
  q?: string
  sort?: string
  dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/** Собирает query-строку, пропуская пустые параметры. */
function paymentsQuery(p: PaymentsPageParams): string {
  const qs = new URLSearchParams()
  if (p.tab) qs.set('tab', p.tab)
  if (p.month) qs.set('month', p.month)
  if (p.monthBasis) qs.set('monthBasis', p.monthBasis)
  if (p.tz) qs.set('tz', p.tz)
  if (p.dueFrom) qs.set('dueFrom', p.dueFrom)
  if (p.dueTo) qs.set('dueTo', p.dueTo)
  if (p.folderId) qs.set('folderId', p.folderId)
  if (p.cashBoxId) qs.set('cashBoxId', p.cashBoxId)
  if (p.assignedStaffId) qs.set('assignedStaffId', p.assignedStaffId)
  if (p.q?.trim()) qs.set('q', p.q.trim())
  if (p.sort) qs.set('sort', p.sort)
  if (p.dir) qs.set('dir', p.dir)
  if (p.limit != null) qs.set('limit', String(p.limit))
  if (p.offset) qs.set('offset', String(p.offset))
  return qs.toString()
}

export const usePaymentsStore = defineStore('payments', () => {
  const payments = ref<Record<string, Payment[]>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ══════════════════════════════════════════════════════════════════
  // Постраничный список (страница «Платежи»)
  //
  // `payments` выше — НЕ полный набор: это кэш графиков точечно открытых
  // сделок. Полной загрузки платежей в кабинете больше нет.
  // ══════════════════════════════════════════════════════════════════

  const list = ref<Payment[]>([])
  const listTotal = ref(0)
  /** Сумма по ВСЕЙ выборке, а не по странице — сервер считает её вместе с total. */
  const listSum = ref(0)
  const listLoading = ref(false)
  const facets = ref<PaymentFacets | null>(null)
  const facetsLoading = ref(false)
  /** Агрегаты календаря по дням: ключ — 'YYYY-MM-DD'. */
  const calendarAgg = ref<Record<string, PaymentCalendarDay>>({})
  const calendarLoading = ref(false)

  // Защита от гонок: быстрые переключения вкладок и набор в поиске порождают
  // несколько запросов, и ответ на устаревший может прийти последним.
  let pageReq = 0
  let facetsReq = 0
  let calendarReq = 0

  async function fetchPaymentsPage(params: PaymentsPageParams) {
    const req = ++pageReq
    listLoading.value = true
    try {
      const res = await api.get<Page<Payment> & { sums?: { amount: number } }>(
        `/payments?${paymentsQuery(params)}`,
      )
      if (req !== pageReq) return
      list.value = res.items
      listTotal.value = res.total
      listSum.value = res.sums?.amount ?? 0
    } catch (e: any) {
      if (req !== pageReq) return
      error.value = e.message || 'Ошибка загрузки платежей'
      console.error('Failed to fetch payments page:', e)
    } finally {
      if (req === pageReq) listLoading.value = false
    }
  }

  async function fetchPaymentsFacets(params: PaymentsPageParams) {
    const req = ++facetsReq
    facetsLoading.value = true
    try {
      const res = await api.get<PaymentFacets>(`/payments/facets?${paymentsQuery(params)}`)
      if (req !== facetsReq) return
      facets.value = res
    } catch (e: any) {
      if (req !== facetsReq) return
      console.error('Failed to fetch payment facets:', e)
    } finally {
      if (req === facetsReq) facetsLoading.value = false
    }
  }

  async function fetchPaymentsCalendar(from: string, to: string, params: PaymentsPageParams) {
    const req = ++calendarReq
    calendarLoading.value = true
    try {
      const qs = paymentsQuery({ ...params, dueFrom: undefined, dueTo: undefined })
      const res = await api.get<PaymentCalendarDay[]>(
        `/payments/calendar?from=${from}&to=${to}${qs ? `&${qs}` : ''}`,
      )
      if (req !== calendarReq) return
      const byDate: Record<string, PaymentCalendarDay> = {}
      for (const d of res) byDate[d.date] = d
      calendarAgg.value = byDate
    } catch (e: any) {
      if (req !== calendarReq) return
      console.error('Failed to fetch payments calendar:', e)
    } finally {
      if (req === calendarReq) calendarLoading.value = false
    }
  }

  // Fetch payments for a specific deal
  async function fetchPaymentsForDeal(dealId: string) {
    try {
      const data = await api.get<Payment[]>(`/payments/deal/${dealId}`)
      payments.value = { ...payments.value, [dealId]: data }
    } catch (e: any) {
      error.value = e.message || 'Ошибка загрузки платежей сделки'
      throw e
    }
  }

  function getPaymentsForDeal(dealId: string): Payment[] {
    return payments.value[dealId] || []
  }

  function getNextPayment(dealId: string): Payment | undefined {
    const dealPayments = payments.value[dealId] || []
    return dealPayments.find((p) => p.status === 'PENDING')
  }

  async function markAsPaid(
    paymentId: string,
    dealId: string,
    options?: {
      amount?: number
      method?: string
      proofScreenshot?: string
      note?: string
      onTime?: boolean
      paidAt?: string
      redistributeMode?: 'EQUAL' | 'NEXT' | 'LAST' | 'MANUAL'
      remainingSchedule?: Array<{ paymentId: string; amount: number }>
    }
  ) {
    try {
      await api.patch<Payment>(`/payments/${paymentId}/paid`, options || {})
      // Backend may have redistributed sister payment amounts and rewritten
      // `remainingAfter` across the whole schedule (custom-amount overflow,
      // overpayment closure, etc). Replacing just the one payment in cache
      // would leave the rest stale — refetch the deal's full payments list.
      await fetchPaymentsForDeal(dealId)
    } catch (e: any) {
      error.value = e.message || 'Ошибка при отметке оплаты'
      throw e
    }
  }

  async function reschedulePayment(
    paymentId: string,
    dealId: string,
    newDate: string,
    reason?: string
  ) {
    try {
      const updated = await api.patch<Payment>(`/payments/${paymentId}/reschedule`, {
        newDueDate: newDate,
        ...(reason ? { reason } : {}),
      })
      const dealPayments = payments.value[dealId]
      if (dealPayments) {
        const idx = dealPayments.findIndex((p) => p.id === paymentId)
        if (idx !== -1) {
          dealPayments[idx] = updated
          payments.value = { ...payments.value, [dealId]: [...dealPayments] }
        }
      }
    } catch (e: any) {
      error.value = e.message || 'Ошибка при переносе платежа'
      throw e
    }
  }

  async function undoReschedulePayment(paymentId: string, dealId: string) {
    try {
      const updated = await api.patch<Payment>(`/payments/${paymentId}/undo-reschedule`)
      const dealPayments = payments.value[dealId]
      if (dealPayments) {
        const idx = dealPayments.findIndex((p) => p.id === paymentId)
        if (idx !== -1) {
          dealPayments[idx] = updated
          payments.value = { ...payments.value, [dealId]: [...dealPayments] }
        }
      }
    } catch (e: any) {
      error.value = e.message || 'Ошибка при возврате даты'
      throw e
    }
  }

  async function unmarkPaid(paymentId: string, dealId: string) {
    try {
      await api.patch<Payment>(`/payments/${paymentId}/unpaid`)
      // Same reason as markAsPaid: backend redistributes PENDING amounts and
      // rewrites remainingAfter for every payment of this deal. Single-row
      // cache update would leave sister payments stale.
      await fetchPaymentsForDeal(dealId)
    } catch (e: any) {
      error.value = e.message || 'Ошибка при отмене оплаты'
      throw e
    }
  }

  function addPayments(dealId: string, newPayments: Payment[]) {
    payments.value = { ...payments.value, [dealId]: newPayments }
  }

  /**
   * Remove a payment row from a deal. Server rejects PAID rows; partner
   * has to unmarkPaid first. Re-fetches the schedule because the deletion
   * shifts remainingAfter on every row that came after the removed one.
   */
  async function removePayment(paymentId: string, dealId: string) {
    try {
      await api.delete(`/payments/${paymentId}`)
      await fetchPaymentsForDeal(dealId)
    } catch (e: any) {
      error.value = e.message || 'Не удалось удалить платёж'
      throw e
    }
  }

  /**
   * Append a new payment row to a deal's schedule. Used when the original
   * installment plan ran out before the client's debt did (chronic
   * underpayment) or for ad-hoc side payments. Re-fetches the full
   * schedule because the backend may have shifted `remainingAfter` across
   * the whole list.
   */
  async function addPayment(
    dealId: string,
    input: { amount: number; dueDate: string; note?: string },
  ) {
    try {
      const created = await api.post<Payment>(`/payments/deal/${dealId}`, input)
      await fetchPaymentsForDeal(dealId)
      return created
    } catch (e: any) {
      error.value = e.message || 'Не удалось добавить платёж'
      throw e
    }
  }

  return {
    payments,
    loading,
    error,
    // Постраничный список страницы «Платежи» — отдельно от полного набора.
    list, listTotal, listSum, listLoading,
    facets, facetsLoading,
    calendarAgg, calendarLoading,
    fetchPaymentsPage, fetchPaymentsFacets, fetchPaymentsCalendar,
    fetchPaymentsForDeal,
    getPaymentsForDeal,
    getNextPayment,
    markAsPaid,
    addPayment,
    removePayment,
    unmarkPaid,
    reschedulePayment,
    undoReschedulePayment,
    addPayments,
  }
})