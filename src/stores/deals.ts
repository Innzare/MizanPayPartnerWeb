import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Deal, CreateDealInput } from '@/types'
import { MOCK_DEALS } from '@/constants/mock/deals'

export const useDealsStore = defineStore('deals', () => {
  const deals = ref<Deal[]>([...MOCK_DEALS])
  const isLoading = ref(false)

  const investorDeals = computed(() =>
    deals.value.filter((d) => d.investorId === 'investor-1')
  )

  const activeDeals = computed(() =>
    investorDeals.value.filter((d) => d.status === 'active' || d.status === 'contract_signed')
  )

  const completedDeals = computed(() =>
    investorDeals.value.filter((d) => d.status === 'completed')
  )

  const totalInvested = computed(() =>
    investorDeals.value.reduce((sum, d) => sum + d.purchasePrice, 0)
  )

  const totalRevenue = computed(() =>
    investorDeals.value.reduce((sum, d) => sum + d.totalPrice, 0)
  )

  const totalProfit = computed(() =>
    investorDeals.value.reduce((sum, d) => sum + d.markup, 0)
  )

  const totalRemaining = computed(() =>
    activeDeals.value.reduce((sum, d) => sum + d.remainingAmount, 0)
  )

  const monthlyIncome = computed(() => {
    return activeDeals.value.reduce((sum, d) => {
      if (d.numberOfPayments > 0) {
        return sum + (d.totalPrice - d.downPayment) / d.numberOfPayments
      }
      return sum
    }, 0)
  })

  const roi = computed(() => {
    if (totalInvested.value === 0) return 0
    return (totalProfit.value / totalInvested.value) * 100
  })

  function getDeal(id: string) {
    return deals.value.find((d) => d.id === id)
  }

  function createDeal(input: CreateDealInput) {
    const newDeal: Deal = {
      id: 'deal-' + Date.now(),
      ...input,
      clientName: 'Новый клиент',
      clientRating: 4.0,
      investorId: 'investor-1',
      investorName: 'Мухаммад Хаджиев',
      investorRating: 4.8,
      remainingAmount: input.totalPrice - input.downPayment,
      paidPayments: 0,
      status: 'created',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    deals.value.unshift(newDeal)
    return newDeal
  }

  function updateDealStatus(id: string, status: Deal['status']) {
    const deal = deals.value.find((d) => d.id === id)
    if (deal) {
      deal.status = status
      deal.updatedAt = new Date().toISOString()
    }
  }

  return {
    deals, isLoading, investorDeals, activeDeals, completedDeals,
    totalInvested, totalRevenue, totalProfit, totalRemaining, monthlyIncome, roi,
    getDeal, createDeal, updateDealStatus,
  }
})
