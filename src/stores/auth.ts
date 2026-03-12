import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@/types'
import { MOCK_INVESTOR } from '@/constants/mock/users'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const accessToken = ref<string | null>(localStorage.getItem('access_token'))
  const refreshToken = ref<string | null>(localStorage.getItem('refresh_token'))
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!accessToken.value)
  const userName = computed(() => {
    if (!user.value) return ''
    return `${user.value.firstName} ${user.value.lastName}`
  })

  async function login(_email: string, _password: string) {
    isLoading.value = true
    error.value = null
    try {
      // Mock login - accept any credentials
      await new Promise((resolve) => setTimeout(resolve, 500))
      user.value = { ...MOCK_INVESTOR }
      accessToken.value = 'mock-access-token-' + Date.now()
      refreshToken.value = 'mock-refresh-token-' + Date.now()
      localStorage.setItem('access_token', accessToken.value)
      localStorage.setItem('refresh_token', refreshToken.value)
      localStorage.setItem('user', JSON.stringify(user.value))
    } catch (e: any) {
      error.value = e.message || 'Ошибка входа'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function logout() {
    user.value = null
    accessToken.value = null
    refreshToken.value = null
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
  }

  async function checkAuth() {
    const savedToken = localStorage.getItem('access_token')
    const savedUser = localStorage.getItem('user')
    if (!savedToken || !savedUser) return
    accessToken.value = savedToken
    refreshToken.value = localStorage.getItem('refresh_token')
    try {
      user.value = JSON.parse(savedUser)
    } catch {
      await logout()
    }
  }

  async function updateProfile(updates: Partial<Pick<User, 'firstName' | 'lastName' | 'patronymic' | 'phone' | 'city'>>) {
    if (!user.value) return
    isLoading.value = true
    try {
      await new Promise((resolve) => setTimeout(resolve, 400))
      Object.assign(user.value, updates, { updatedAt: new Date().toISOString() })
      localStorage.setItem('user', JSON.stringify(user.value))
    } finally {
      isLoading.value = false
    }
  }

  async function changePassword(_currentPassword: string, _newPassword: string) {
    isLoading.value = true
    try {
      await new Promise((resolve) => setTimeout(resolve, 500))
      // Mock: always succeeds
    } finally {
      isLoading.value = false
    }
  }

  return { user, accessToken, refreshToken, isLoading, error, isAuthenticated, userName, login, logout, checkAuth, updateProfile, changePassword }
})
