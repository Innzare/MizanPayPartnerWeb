import { ref, computed } from 'vue'
import { api } from '@/api/client'
import type { CapitalSummary } from '@/types'

const capital = ref<CapitalSummary | null>(null)
const loading = ref(false)
/**
 * Ответ по капиталу получен хотя бы раз.
 *
 * Раздел «Финансы» закрыт тарифом, и на бесплатном плане запрос отвечает 403.
 * Без этого признака «не смогли узнать» было неотличимо от «капитал не
 * настроен» — и на главной всплывала подсказка завести капитал у партнёра, у
 * которого он давно заведён.
 */
const loaded = ref(false)

export function useCapital() {
  const isCapitalSet = computed(() =>
    capital.value?.initialCapital !== null && capital.value?.initialCapital !== undefined
  )

  async function fetchCapital() {
    loading.value = true
    try {
      capital.value = await api.get<CapitalSummary>('/finance/capital')
      loaded.value = true
    } catch {
      // Молча: раздел может быть закрыт тарифом или правами.
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

  return { capital, loading, loaded, isCapitalSet, fetchCapital, setInitialCapital }
}
