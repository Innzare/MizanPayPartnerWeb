import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

/**
 * Единый признак «сделка недоступна на текущем тарифе».
 *
 * На FREE открыты только последние N сделок (по dealNumber). Признак берётся
 * из двух источников:
 *   1. `deal.locked` — приходит с бэкенда в списке `/deals` (и всех местах,
 *      где сделка резолвится из dealsStore);
 *   2. порог `dealAccessThreshold` из профиля — для поверхностей с собственными
 *      эндпоинтами (поиск ⌘K, cashflow, рассылки), где есть только `dealNumber`.
 *
 * Так одна функция помечает залоченные сделки ВЕЗДЕ единообразно.
 */
export function useDealLock() {
  const authStore = useAuthStore()
  const threshold = computed<number | null>(() => authStore.user?.dealAccessThreshold ?? null)

  function isDealLocked(deal?: { locked?: boolean; dealNumber?: number | null } | null): boolean {
    if (!deal) return false
    if (deal.locked) return true
    const t = threshold.value
    return t != null && deal.dealNumber != null && deal.dealNumber < t
  }

  return { isDealLocked, threshold }
}
