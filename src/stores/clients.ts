import { defineStore } from 'pinia'
import { computed } from 'vue'
import type { User, Deal } from '@/types'
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
  isExternal: boolean // client not on the platform
}

export const useClientsStore = defineStore('clients', () => {
  const dealsStore = useDealsStore()
  const paymentsStore = usePaymentsStore()

  const clientsInfo = computed<ClientInfo[]>(() => {
    // Group deals by client key
    // Platform clients: by clientId
    // External clients: by "ext:name:phone"
    const groups: Record<string, Deal[]> = {}

    for (const deal of dealsStore.investorDeals) {
      let key: string
      if (deal.clientId) {
        key = deal.clientId
      } else if (deal.clientProfileId) {
        // If clientProfile is linked to a registered user, group by userId
        key = deal.clientProfile?.userId
          ? deal.clientProfile.userId
          : `cp:${deal.clientProfileId}`
      } else if (deal.externalClientName) {
        const phone = deal.externalClientPhone || ''
        key = `ext:${deal.externalClientName.toLowerCase().trim()}:${phone.replace(/\D/g, '')}`
      } else {
        key = 'ext:unknown'
      }

      if (!groups[key]) groups[key] = []
      groups[key]!.push(deal)
    }

    const results: ClientInfo[] = []

    for (const [key, clientDeals] of Object.entries(groups)) {
      if (clientDeals.length === 0) continue

      const firstDeal = clientDeals[0]!
      const isExternal = key.startsWith('ext:')
      const isClientProfile = key.startsWith('cp:')
      const activeDealCount = clientDeals.filter((d) => d.status === 'ACTIVE').length
      const totalVolume = clientDeals.reduce((sum, d) => sum + d.totalPrice, 0)
      const totalProfit = clientDeals.reduce((sum, d) => sum + d.markup, 0)
      const remaining = clientDeals.reduce((sum, d) => sum + d.remainingAmount, 0)

      // On-time rate
      let totalPaid = 0
      let onTimePaid = 0
      for (const deal of clientDeals) {
        const dealPayments = paymentsStore.getPaymentsForDeal(deal.id)
        for (const p of dealPayments) {
          if (p.status === 'PAID') {
            totalPaid++
            onTimePaid++
          }
        }
      }
      const onTimeRate = totalPaid > 0 ? Math.round((onTimePaid / totalPaid) * 100) : 100

      // Next payment
      let nextPaymentDate: string | null = null
      for (const deal of clientDeals) {
        const next = paymentsStore.getNextPayment(deal.id)
        if (next && (!nextPaymentDate || new Date(next.dueDate) < new Date(nextPaymentDate))) {
          nextPaymentDate = next.dueDate
        }
      }

      // Build user object
      let user: User
      if (isClientProfile) {
        const cp = firstDeal.clientProfile
        user = {
          id: key,
          email: '',
          phone: cp?.phone || '',
          firstName: cp?.firstName || '',
          lastName: cp?.lastName || '',
          city: '',
          rating: 0,
          completedDeals: clientDeals.filter((d) => d.status === 'COMPLETED').length,
          activeDeals: activeDealCount,
          verificationLevel: 'NONE',
          isBlocked: false,
          subscriptionPlan: 'FREE',
          createdAt: firstDeal.createdAt,
          updatedAt: firstDeal.updatedAt,
        }
      } else if (isExternal) {
        user = {
          id: key,
          email: '',
          phone: firstDeal.externalClientPhone || '',
          firstName: firstDeal.externalClientName || 'Без имени',
          lastName: '',
          city: '',
          rating: 0,
          completedDeals: clientDeals.filter((d) => d.status === 'COMPLETED').length,
          activeDeals: activeDealCount,
          verificationLevel: 'NONE',
          isBlocked: false,
          subscriptionPlan: 'FREE',
          createdAt: firstDeal.createdAt,
          updatedAt: firstDeal.updatedAt,
        }
      } else {
        // Platform client — try deal.client first, fall back to clientProfile
        const client = clientDeals.find(d => d.client)?.client
        const cp = clientDeals.find(d => d.clientProfile)?.clientProfile
        user = {
          id: firstDeal.clientId || key,
          email: '',
          phone: client?.phone || cp?.phone || '',
          firstName: client?.firstName || cp?.firstName || '',
          lastName: client?.lastName || cp?.lastName || '',
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
        isExternal: isExternal || (isClientProfile && !firstDeal.clientProfile?.userId),
      })
    }

    return results.filter((c) => c.dealCount > 0).sort((a, b) => b.activeDealCount - a.activeDealCount)
  })

  return { clientsInfo }
})
