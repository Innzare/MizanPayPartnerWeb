import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'
import type { ActivityLog, ActivityType } from '@/types'

interface ActivityResponse {
  items: ActivityLog[]
  total: number
}

export interface ActivityFilters {
  types?: ActivityType[]
  actorId?: string
  from?: string
  to?: string
}

export const useActivityStore = defineStore('activity', () => {
  const items = ref<ActivityLog[]>([])
  const total = ref(0)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const hasMore = ref(false)

  // Synchronous lock to prevent double-clicks from firing parallel requests
  // with the same offset (isLoading flips only after the async boundary).
  let inFlight = false

  const filters = ref<ActivityFilters>({})
  const limit = 50

  async function fetch(reset = true) {
    if (inFlight) return
    inFlight = true
    isLoading.value = true
    error.value = null
    try {
      const offset = reset ? 0 : items.value.length
      const params = new URLSearchParams()
      if (filters.value.types?.length) params.set('types', filters.value.types.join(','))
      if (filters.value.actorId) params.set('actorId', filters.value.actorId)
      if (filters.value.from) params.set('from', filters.value.from)
      if (filters.value.to) params.set('to', filters.value.to)
      params.set('limit', String(limit))
      params.set('offset', String(offset))

      const data = await api.get<ActivityResponse>(`/activity?${params.toString()}`)

      if (reset) {
        items.value = data.items
      } else {
        items.value.push(...data.items)
      }
      total.value = data.total
      hasMore.value = items.value.length < data.total
    } catch (e: any) {
      error.value = e.message || 'Ошибка загрузки истории'
    } finally {
      isLoading.value = false
      inFlight = false
    }
  }

  function setFilters(f: ActivityFilters) {
    filters.value = f
    fetch(true)
  }

  function clearFilters() {
    filters.value = {}
    fetch(true)
  }

  function loadMore() {
    if (!hasMore.value || inFlight) return
    fetch(false)
  }

  return {
    items, total, isLoading, error, hasMore, filters,
    fetch, setFilters, clearFilters, loadMore,
  }
})