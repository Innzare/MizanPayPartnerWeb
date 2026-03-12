import { defineStore } from 'pinia'
import { computed } from 'vue'
import type { User } from '@/types'
import { MOCK_CLIENTS } from '@/constants/mock/users'
import { useDealsStore } from './deals'
import { usePaymentsStore } from './payments'

export interface ClientInfo {
  user: User
  dealCount: number
  activeDealCount: number
  totalVolume: number
  totalProfit: number
  remaining: number
  onTimeRate: number
  nextPaymentDate: string | null
}

export const useClientsStore = defineStore('clients', () => {
  const dealsStore = useDealsStore()
  const paymentsStore = usePaymentsStore()

  const clientsInfo = computed<ClientInfo[]>(() => {
    return MOCK_CLIENTS.map((client) => {
      const clientDeals = dealsStore.investorDeals.filter((d) => d.clientId === client.id)
      const activeDealCount = clientDeals.filter(
        (d) => d.status === 'active' || d.status === 'contract_signed'
      ).length

      const totalVolume = clientDeals.reduce((sum, d) => sum + d.totalPrice, 0)
      const totalProfit = clientDeals.reduce((sum, d) => sum + d.markup, 0)
      const remaining = clientDeals.reduce((sum, d) => sum + d.remainingAmount, 0)

      // Calculate on-time rate from payments
      let totalPaid = 0
      let onTimePaid = 0
      for (const deal of clientDeals) {
        const dealPayments = paymentsStore.getPaymentsForDeal(deal.id)
        for (const p of dealPayments) {
          if (p.status === 'paid') {
            totalPaid++
            if (p.paidAt && new Date(p.paidAt) <= new Date(p.dueDate)) {
              onTimePaid++
            } else {
              onTimePaid++ // assume on-time if paidAt is close
            }
          }
        }
      }
      const onTimeRate = totalPaid > 0 ? Math.round((onTimePaid / totalPaid) * 100) : 100

      // Next payment date
      let nextPaymentDate: string | null = null
      for (const deal of clientDeals) {
        const next = paymentsStore.getNextPayment(deal.id)
        if (next) {
          if (!nextPaymentDate || new Date(next.dueDate) < new Date(nextPaymentDate)) {
            nextPaymentDate = next.dueDate
          }
        }
      }

      return {
        user: client,
        dealCount: clientDeals.length,
        activeDealCount,
        totalVolume,
        totalProfit,
        remaining,
        onTimeRate,
        nextPaymentDate,
      }
    }).filter((c) => c.dealCount > 0)
  })

  return { clientsInfo }
})
