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
    const overrides = user.value?.accessOverrides || []
    // Match against the longest applicable base route, then deny if it's been
    // disabled per-staff. e.g. /co-investors/123 matches /co-investors.
    const matched = allowed.find((r) => path === r || path.startsWith(r + '/'))
    if (!matched) return false
    if (overrides.some((r) => matched === r)) return false
    return true
  }

  /** Where to send the user after login or when a route is denied. Owner → `/`,
   *  staff → /deals if accessible, otherwise the first allowed non-subscription-
   *  gated route. Avoiding subscription-gated paths here prevents redirect
   *  loops if the partner is on the free plan and their staff would otherwise
   *  land on e.g. /co-investors and bounce to /settings (which staff can't see). */
  const defaultRoute = computed(() => {
    if (!isStaff.value) return '/'
    const role = staffRole.value
    if (!role) return '/login'
    const overrides = user.value?.accessOverrides || []
    const SUBSCRIPTION_GATED = new Set([
      '/analytics', '/import', '/activity', '/registry', '/co-investors', '/finance',
    ])
    const allowed = (ROLE_ROUTE_ACCESS[role] || []).filter((r) => !overrides.includes(r))
    const ungated = allowed.filter((r) => !SUBSCRIPTION_GATED.has(r))
    if (ungated.includes('/deals')) return '/deals'
    if (ungated.includes('/payments')) return '/payments'
    if (ungated.includes('/clients')) return '/clients'
    return ungated[0] || allowed[0] || '/calculator'
  })

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

  return { user, accessToken, refreshToken, isLoading, error, isAuthenticated, isStaff, staffRole, isOwner, userName, canAccess, defaultRoute, login, logout, checkAuth, updateProfile, changePassword }
})