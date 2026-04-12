import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'
import type { ClientProfile, ClientProfileStats } from '@/types'

export interface CreateClientProfileInput {
  phone: string
  firstName: string
  lastName: string
  patronymic?: string
  birthDate?: string
  passportSeries?: string
  passportNumber?: string
  passportIssuedBy?: string
  passportIssuedAt?: string
  registrationAddress?: string
  residentialAddress?: string
  inn?: string
}

export type UpdateClientProfileInput = Partial<Omit<CreateClientProfileInput, 'phone'>>

export const useClientProfilesStore = defineStore('clientProfiles', () => {
  const myClients = ref<ClientProfile[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetchMyClients() {
    isLoading.value = true
    error.value = null
    try {
      myClients.value = await api.get<ClientProfile[]>('/client-profiles')
    } catch (e: any) {
      error.value = e.message || 'Ошибка загрузки клиентов'
    } finally {
      isLoading.value = false
    }
  }

  async function search(query: string, limit = 10): Promise<ClientProfile[]> {
    if (!query.trim()) return []
    return api.get<ClientProfile[]>(`/client-profiles/search?q=${encodeURIComponent(query)}&limit=${limit}`)
  }

  async function findByPhone(phone: string): Promise<ClientProfile | null> {
    return api.get<ClientProfile | null>(`/client-profiles/by-phone?phone=${encodeURIComponent(phone)}`)
  }

  async function findById(id: string): Promise<ClientProfile> {
    return api.get<ClientProfile>(`/client-profiles/${id}`)
  }

  async function getStats(id: string): Promise<ClientProfileStats> {
    return api.get<ClientProfileStats>(`/client-profiles/${id}/stats`)
  }

  async function create(data: CreateClientProfileInput): Promise<ClientProfile> {
    const profile = await api.post<ClientProfile>('/client-profiles', data)
    myClients.value.unshift(profile)
    return profile
  }

  async function update(id: string, data: UpdateClientProfileInput): Promise<ClientProfile> {
    const updated = await api.patch<ClientProfile>(`/client-profiles/${id}`, data)
    const idx = myClients.value.findIndex((c) => c.id === id)
    if (idx >= 0) myClients.value[idx] = updated
    return updated
  }

  function getClient(id: string): ClientProfile | undefined {
    return myClients.value.find((c) => c.id === id)
  }

  return {
    myClients, isLoading, error,
    fetchMyClients, search, findByPhone, findById, getStats, create, update, getClient,
  }
})