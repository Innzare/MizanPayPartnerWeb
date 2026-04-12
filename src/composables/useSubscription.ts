import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import type { PlanFeatures } from '@/types'

const DEFAULT_FREE_FEATURES: PlanFeatures = {
  analytics: false,
  analyticsCharts: false,
  pdfContract: false,
  pdfExport: false,
  excelExport: false,
  import: false,
  activity: false,
  registry: false,
  coInvestors: false,
  finance: false,
  staff: false,
  whatsapp: false,
}

export function useSubscription() {
  const authStore = useAuthStore()

  const features = computed(() => authStore.user?.planFeatures || DEFAULT_FREE_FEATURES)
  const plan = computed(() => authStore.user?.subscriptionPlan || 'FREE')
  const isFree = computed(() => plan.value === 'FREE')

  function canAccess(feature: keyof PlanFeatures): boolean {
    return features.value[feature] ?? false
  }

  return { plan, features, isFree, canAccess }
}
