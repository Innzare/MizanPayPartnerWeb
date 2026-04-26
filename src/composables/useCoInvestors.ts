import { ref } from 'vue'
import { api } from '@/api/client'
import type { CoInvestor } from '@/types'

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

  async function createCoInvestor(data: { name: string; phone?: string; capital: number; profitPercent: number }) {
    const created = await api.post<CoInvestor>('/co-investors', data)
    coInvestors.value.push(created)
    return created
  }

  return { coInvestors, loading, fetchCoInvestors, createCoInvestor }
}
