import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Request, Category } from '@/types'
import { api } from '@/api/client'

interface RequestFilters {
  city?: string
  category?: Category
  minPrice?: number
  maxPrice?: number
  minRating?: number
  search?: string
}

export const useRequestsStore = defineStore('requests', () => {
  const requests = ref<Request[]>([])
  const filters = ref<RequestFilters>({})
  const isLoading = ref(false)

  const activeRequests = computed(() =>
    requests.value.filter((r) => r.status === 'ACTIVE')
  )

  const myOffers = computed(() =>
    requests.value.filter((r) => r.status === 'OFFER_SENT')
  )

  const filteredRequests = computed(() => {
    let result = activeRequests.value
    const f = filters.value

    if (f.search) {
      const s = f.search.toLowerCase()
      result = result.filter(
        (r) => r.title.toLowerCase().includes(s) || `${r.client?.firstName || ''} ${r.client?.lastName || ''}`.toLowerCase().includes(s)
      )
    }
    if (f.city) result = result.filter((r) => r.city === f.city)
    if (f.category) result = result.filter((r) => r.category === f.category)
    if (f.minPrice) result = result.filter((r) => r.price >= f.minPrice!)
    if (f.maxPrice) result = result.filter((r) => r.price <= f.maxPrice!)
    if (f.minRating) result = result.filter((r) => (r.client?.rating ?? 0) >= f.minRating!)

    return result
  })

  async function fetchRequests() {
    isLoading.value = true
    try {
      const params = new URLSearchParams()
      const f = filters.value
      if (f.category) params.set('category', f.category)
      if (f.city) params.set('city', f.city)
      if (f.search) params.set('search', f.search)
      if (f.minPrice) params.set('minPrice', String(f.minPrice))
      if (f.maxPrice) params.set('maxPrice', String(f.maxPrice))
      if (f.minRating) params.set('minRating', String(f.minRating))

      const query = params.toString()
      const data = await api.get<Request[]>(`/requests${query ? '?' + query : ''}`)
      requests.value = data
    } catch (e) {
      console.error('Failed to fetch requests:', e)
    } finally {
      isLoading.value = false
    }
  }

  function setFilters(newFilters: Partial<RequestFilters>) {
    filters.value = { ...filters.value, ...newFilters }
  }

  function clearFilters() {
    filters.value = {}
  }

  async function sendOffer(id: string, offer: {
    tiers: { termMonths: number; markupPercent: number; minDownPaymentPercent: number }[]
  }) {
    try {
      const updated = await api.patch<Request>(`/requests/${id}/offer`, offer)
      const idx = requests.value.findIndex((r) => r.id === id)
      if (idx !== -1) {
        requests.value[idx] = updated
      }
      return updated
    } catch (e) {
      console.error('Failed to send offer:', e)
      throw e
    }
  }

  return {
    requests, filters, isLoading, activeRequests, myOffers, filteredRequests,
    setFilters, clearFilters, sendOffer, fetchRequests,
  }
})
