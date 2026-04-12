import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User, StaffRole } from '@/types'
import { ROLE_ROUTE_ACCESS } from '@/types'
import { api } from '@/api/client'

interface AuthResponse {
  user: User
  accessToken: string
  refreshToken: string
  staffId?: string
  staffRole?: StaffRole
  staffName?: string
}

function loadCachedUser(): User | null {
  try {
    const raw = localStorage.getItem('user')
    return raw ? JSON.parse(raw) as User : null
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(loadCachedUser())
  const accessToken = ref<string | null>(localStorage.getItem('access_token'))
  const refreshToken = ref<string | null>(localStorage.getItem('refresh_token'))
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!accessToken.value)
  const isStaff = computed(() => !!user.value?.staffId)
  const staffRole = computed(() => user.value?.staffRole)
  const isOwner = computed(() => isAuthenticated.value && !isStaff.value)
  const userName = computed(() => {
    if (!user.value) return ''
    return `${user.value.firstName} ${user.value.lastName}`
  })

  function canAccess(path: string): boolean {
    if (!isStaff.value) return true // owner sees everything
    const role = staffRole.value
    if (!role) return false
    const allowed = ROLE_ROUTE_ACCESS[role] || []
    return allowed.some((r) => path === r || path.startsWith(r + '/'))
  }

  async function login(email: string, password: string) {
    isLoading.value = true
    error.value = null
    try {
      const data = await api.post<AuthResponse>('/auth/investor/login', { email, password })
      accessToken.value = data.accessToken
      refreshToken.value = data.refreshToken
      localStorage.setItem('access_token', data.accessToken)
      localStorage.setItem('refresh_token', data.refreshToken)

      // Fetch full profile (includes planFeatures, planLimits, etc.)
      try {
        const profile = await api.getSilent<User>('/auth/investor/profile')
        if (data.staffId) {
          profile.staffId = data.staffId
          profile.staffRole = data.staffRole
        }
        user.value = profile
        localStorage.setItem('user', JSON.stringify(profile))
      } catch {
        // Fallback to login response data
        if (data.staffId) {
          data.user.staffId = data.staffId
          data.user.staffRole = data.staffRole
        }
        user.value = data.user
        localStorage.setItem('user', JSON.stringify(data.user))
      }
    } catch (e: any) {
      error.value = e.message || 'Ошибка входа'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function logout() {
    try {
      if (refreshToken.value) {
        await api.post('/auth/investor/logout', { refreshToken: refreshToken.value })
      }
    } catch {
      // Ignore logout errors — clear local state regardless
    } finally {
      user.value = null
      accessToken.value = null
      refreshToken.value = null
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('user')
    }
  }

  async function checkAuth() {
    const savedToken = localStorage.getItem('access_token')
    if (!savedToken) return

    accessToken.value = savedToken
    refreshToken.value = localStorage.getItem('refresh_token')

    // Load cached user immediately for faster UI
    const savedUser = localStorage.getItem('user')
    if (savedUser) {
      try {
        user.value = JSON.parse(savedUser)
      } catch {
        // ignore parse errors
      }
    }

    // Validate with backend
    try {
      const profile = await api.getSilent<User>('/auth/investor/profile')
      user.value = profile
      localStorage.setItem('user', JSON.stringify(profile))
    } catch {
      await logout()
    }
  }

  async function updateProfile(updates: Partial<Pick<User, 'firstName' | 'lastName' | 'patronymic' | 'phone' | 'city'>> & { avatar?: string }) {
    if (!user.value) return
    isLoading.value = true
    try {
      const updated = await api.patch<User>('/auth/investor/profile', updates)
      user.value = updated
      localStorage.setItem('user', JSON.stringify(updated))
    } finally {
      isLoading.value = false
    }
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    isLoading.value = true
    try {
      await api.patch('/auth/investor/password', { currentPassword, newPassword })
    } finally {
      isLoading.value = false
    }
  }

  return { user, accessToken, refreshToken, isLoading, error, isAuthenticated, isStaff, staffRole, isOwner, userName, canAccess, login, logout, checkAuth, updateProfile, changePassword }
})