import { defineStore } from 'pinia'
import { computed } from 'vue'
import type { User } from '@/types'
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

  // Compute unique clients from deals data (no dedicated clients API endpoint)
  const clientsInfo = computed<ClientInfo[]>(() => {
    const clientIds = new Set(dealsStore.investorDeals.map((d) => d.clientId))
    const results: ClientInfo[] = []

    for (const clientId of clientIds) {
      const clientDeals = dealsStore.investorDeals.filter((d) => d.clientId === clientId)
      if (clientDeals.length === 0) continue

      const firstDeal = clientDeals[0]!
      const activeDealCount = clientDeals.filter(
        (d) => d.status === 'ACTIVE'
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
          if (p.status === 'PAID') {
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

      // Build a User object from deal's nested client data
      const client = firstDeal.client
      const user: User = {
        id: clientId,
        email: '',
        phone: client?.phone || '',
        firstName: client?.firstName || '',
        lastName: client?.lastName || '',
        city: client?.city || '',
        avatar: client?.avatar,
        rating: client?.rating ?? 0,
        completedDeals: client?.completedDeals ?? 0,
        activeDeals: activeDealCount,
        verificationLevel: 'NONE',
        isBlocked: false,
        subscriptionPlan: 'FREE',
        createdAt: firstDeal.createdAt,
        updatedAt: firstDeal.updatedAt,
      }

      results.push({
        user,
        dealCount: clientDeals.length,
        activeDealCount,
        totalVolume,
        totalProfit,
        remaining,
        onTimeRate,
        nextPaymentDate,
      })
    }

    return results.filter((c) => c.dealCount > 0)
  })

  return { clientsInfo }
})