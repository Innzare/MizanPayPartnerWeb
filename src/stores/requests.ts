import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Request, Category } from '@/types'
import { MOCK_REQUESTS } from '@/constants/mock/requests'

interface RequestFilters {
  city?: string
  category?: Category
  minPrice?: number
  maxPrice?: number
  maxTerm?: number
  minRating?: number
  search?: string
}

export const useRequestsStore = defineStore('requests', () => {
  const requests = ref<Request[]>([...MOCK_REQUESTS])
  const filters = ref<RequestFilters>({})
  const isLoading = ref(false)

  const activeRequests = computed(() =>
    requests.value.filter((r) => r.status === 'active')
  )

  const filteredRequests = computed(() => {
    let result = activeRequests.value
    const f = filters.value

    if (f.search) {
      const s = f.search.toLowerCase()
      result = result.filter(
        (r) => r.title.toLowerCase().includes(s) || r.clientName.toLowerCase().includes(s)
      )
    }
    if (f.city) result = result.filter((r) => r.city === f.city)
    if (f.category) result = result.filter((r) => r.category === f.category)
    if (f.minPrice) result = result.filter((r) => r.price >= f.minPrice!)
    if (f.maxPrice) result = result.filter((r) => r.price <= f.maxPrice!)
    if (f.maxTerm) result = result.filter((r) => r.desiredTermMonths <= f.maxTerm!)
    if (f.minRating) result = result.filter((r) => r.clientRating >= f.minRating!)

    return result
  })

  function setFilters(newFilters: Partial<RequestFilters>) {
    filters.value = { ...filters.value, ...newFilters }
  }

  function clearFilters() {
    filters.value = {}
  }

  function acceptRequest(id: string) {
    const request = requests.value.find((r) => r.id === id)
    if (request) {
      request.status = 'accepted'
      request.acceptedBy = 'investor-1'
      request.updatedAt = new Date().toISOString()
    }
  }

  return {
    requests, filters, isLoading, activeRequests, filteredRequests,
    setFilters, clearFilters, acceptRequest,
  }
})
