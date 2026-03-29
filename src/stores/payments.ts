import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Payment } from '@/types'
import { api } from '@/api/client'

export const usePaymentsStore = defineStore('payments', () => {
  const payments = ref<Record<string, Payment[]>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed: flat list of all payments
  const allPaymentsFlat = computed(() => {
    const result: Payment[] = []
    for (const dealPayments of Object.values(payments.value)) {
      result.push(...dealPayments)
    }
    return result
  })

  const pendingPayments = computed(() =>
    allPaymentsFlat.value.filter((p) => p.status === 'PENDING')
  )

  const overduePayments = computed(() =>
    allPaymentsFlat.value.filter((p) => p.status === 'OVERDUE')
  )

  const paidPayments = computed(() =>
    allPaymentsFlat.value.filter((p) => p.status === 'PAID')
  )

  const allUpcoming = computed(() => {
    const upcoming: { payment: Payment; dealId: string }[] = []
    for (const [dealId, dealPayments] of Object.entries(payments.value)) {
      for (const p of dealPayments) {
        if (p.status === 'PENDING' || p.status === 'OVERDUE') {
          upcoming.push({ payment: p, dealId })
        }
      }
    }
    return upcoming.sort(
      (a, b) => new Date(a.payment.dueDate).getTime() - new Date(b.payment.dueDate).getTime()
    )
  })

  // Fetch all payments and group by dealId
  async function fetchPayments() {
    loading.value = true
    error.value = null
    try {
      const data = await api.get<Payment[]>('/payments')
      const grouped: Record<string, Payment[]> = {}
      for (const p of data) {
        if (!grouped[p.dealId]) grouped[p.dealId] = []
        grouped[p.dealId]!.push(p)
      }
      payments.value = grouped
    } catch (e: any) {
      error.value = e.message || 'Ошибка загрузки платежей'
      throw e
    } finally {
      loading.value = false
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
    options?: { method?: string; proofScreenshot?: string; note?: string }
  ) {
    try {
      const updated = await api.patch<Payment>(`/payments/${paymentId}/paid`, options || {})
      const dealPayments = payments.value[dealId]
      if (dealPayments) {
        const idx = dealPayments.findIndex((p) => p.id === paymentId)
        if (idx !== -1) {
          dealPayments[idx] = updated
          payments.value = { ...payments.value, [dealId]: [...dealPayments] }
        }
      }
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

  function addPayments(dealId: string, newPayments: Payment[]) {
    payments.value = { ...payments.value, [dealId]: newPayments }
  }

  return {
    payments,
    loading,
    error,
    allPaymentsFlat,
    pendingPayments,
    overduePayments,
    paidPayments,
    allUpcoming,
    fetchPayments,
    fetchPaymentsForDeal,
    getPaymentsForDeal,
    getNextPayment,
    markAsPaid,
    reschedulePayment,
    addPayments,
  }
})