import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Payment } from '@/types'
import { MOCK_PAYMENTS } from '@/constants/mock/payments'

export const usePaymentsStore = defineStore('payments', () => {
  const payments = ref<Record<string, Payment[]>>(
    JSON.parse(JSON.stringify(MOCK_PAYMENTS))
  )

  // Auto-detect overdue: pending payments with dueDate in the past
  function refreshOverdueStatuses() {
    const now = new Date()
    for (const dealPayments of Object.values(payments.value)) {
      for (const p of dealPayments) {
        if (p.status === 'pending' && new Date(p.dueDate) < now) {
          p.status = 'overdue'
        }
      }
    }
  }
  refreshOverdueStatuses()

  const allPaymentsFlat = computed(() => {
    const result: Payment[] = []
    for (const dealPayments of Object.values(payments.value)) {
      result.push(...dealPayments)
    }
    return result
  })

  const pendingPayments = computed(() =>
    allPaymentsFlat.value.filter((p) => p.status === 'pending')
  )

  const overduePayments = computed(() =>
    allPaymentsFlat.value.filter((p) => p.status === 'overdue')
  )

  const paidPayments = computed(() =>
    allPaymentsFlat.value.filter((p) => p.status === 'paid')
  )

  const allUpcoming = computed(() => {
    const upcoming: { payment: Payment; dealId: string }[] = []
    for (const [dealId, dealPayments] of Object.entries(payments.value)) {
      for (const p of dealPayments) {
        if (p.status === 'pending' || p.status === 'overdue') {
          upcoming.push({ payment: p, dealId })
        }
      }
    }
    return upcoming.sort(
      (a, b) => new Date(a.payment.dueDate).getTime() - new Date(b.payment.dueDate).getTime()
    )
  })

  function getPaymentsForDeal(dealId: string): Payment[] {
    return payments.value[dealId] || []
  }

  function getNextPayment(dealId: string): Payment | undefined {
    const dealPayments = payments.value[dealId] || []
    return dealPayments.find((p) => p.status === 'pending')
  }

  function markAsPaid(paymentId: string, dealId: string) {
    const dealPayments = payments.value[dealId]
    if (!dealPayments) return
    const payment = dealPayments.find((p) => p.id === paymentId)
    if (payment) {
      payment.status = 'paid'
      payment.paidAt = new Date().toISOString()
      payment.method = 'transfer'
    }
  }

  function reschedulePayment(paymentId: string, dealId: string, newDate: string, reason?: string) {
    const dealPayments = payments.value[dealId]
    if (!dealPayments) return
    const payment = dealPayments.find((p) => p.id === paymentId)
    if (payment && (payment.status === 'pending' || payment.status === 'overdue')) {
      payment.rescheduledFrom = payment.dueDate
      payment.dueDate = newDate
      payment.rescheduledAt = new Date().toISOString()
      payment.rescheduleReason = reason
      if (payment.status === 'overdue') {
        payment.status = 'pending'
      }
    }
  }

  function addPayments(dealId: string, newPayments: Payment[]) {
    payments.value[dealId] = newPayments
  }

  return {
    payments, allPaymentsFlat, pendingPayments, overduePayments, paidPayments,
    allUpcoming, getPaymentsForDeal, getNextPayment, markAsPaid, reschedulePayment, addPayments,
  }
})
