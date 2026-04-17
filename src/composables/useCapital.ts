import { ref, computed } from 'vue'
import { api } from '@/api/client'
import type { CapitalSummary } from '@/types'

const capital = ref<CapitalSummary | null>(null)
const loading = ref(false)

export function useCapital() {
  const isCapitalSet = computed(() =>
    capital.value?.initialCapital !== null && capital.value?.initialCapital !== undefined
  )

  async function fetchCapital() {
    loading.value = true
    try {
      capital.value = await api.get<CapitalSummary>('/finance/capital')
    } catch {
      // silent
    } finally {
      loading.value = false
    }
  }

  async function setInitialCapital(amount: number) {
    loading.value = true
    try {
      await api.patch('/finance/capital', { initialCapital: amount })
      await fetchCapital()
    } finally {
      loading.value = false
    }
  }

  return { capital, loading, isCapitalSet, fetchCapital, setInitialCapital }
}
