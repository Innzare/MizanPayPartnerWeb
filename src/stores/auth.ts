import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User, StaffRole } from '@/types'
import { api } from '@/api/client'

// Раздел → требуемое право сотрудника. Навигация и роут-гвард гейтятся по
// ПРАВАМ (из назначенной роли или legacy-шима), а не по устаревшему
// ROLE_ROUTE_ACCESS по enum-роли — иначе меню не отражает кастомные роли.
const NAV_PERMISSION: Record<string, string> = {
  '/analytics': 'analytics.view',
  '/deals': 'deals.view',
  '/create-deal': 'deals.create',
  '/import': 'deals.import',
  '/clients': 'clients.view',
  '/payments': 'payments.view',
  '/debtors': 'debtors.view',
  '/suppliers/requests': 'suppliers.requests',
  '/suppliers/route-sheets': 'suppliers.routesheet',
  '/suppliers': 'suppliers.view',
  '/broadcasts': 'broadcasts.view',
  '/co-investors': 'coinvestors.view',
  '/cashboxes': 'cashboxes.view',
  '/registry': 'registry.view',
  '/activity': 'activity.view',
  '/staff': 'staff.manage',
  '/roles': 'staff.manage',
}
// Доступны любому аутентифицированному сотруднику (не гейтятся правом).
// /messages — переписка с владельцем, доступна всегда.
// /help — обучающая справка: она нужна сотруднику не меньше, чем владельцу,
// и без этой строки неизвестный роут закрывается редиректом (см. canAccess ниже).
const STAFF_ALWAYS = ['/calculator', '/notifications', '/messages', '/help']
// Только владелец аккаунта.
const OWNER_ONLY = ['/', '/settings']

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

  // RBAC: эффективные права сотрудника (владелец — может всё).
  const permissions = computed<string[]>(() => user.value?.permissions ?? [])
  /** Есть ли у пользователя право `key`. Владелец всегда true. */
  function can(key: string): boolean {
    if (isOwner.value) return true
    return permissions.value.includes(key)
  }

  function canAccess(path: string): boolean {
    if (!isStaff.value) return true // owner sees everything
    // Только владелец.
    if (OWNER_ONLY.some((r) => path === r || path.startsWith(r + '/'))) return false
    // Всегда доступно сотруднику.
    if (STAFF_ALWAYS.some((r) => path === r || path.startsWith(r + '/'))) return true
    // Гейт по праву: берём самый длинный подходящий базовый путь
    // (/deals/123 → /deals, /create-deal → /create-deal).
    const base = Object.keys(NAV_PERMISSION)
      .filter((r) => path === r || path.startsWith(r + '/'))
      .sort((a, b) => b.length - a.length)[0]
    if (base) return can(NAV_PERMISSION[base])
    return false // неизвестный сотруднику роут — закрыт
  }

  /** Куда отправить после логина / при отказе в доступе. Владелец → `/`,
   *  сотрудник → первый доступный по правам не-подписочный раздел (чтобы не
   *  ловить редирект-петлю на подписочных разделах на FREE-плане). */
  const defaultRoute = computed(() => {
    if (!isStaff.value) return '/'
    for (const p of ['/deals', '/payments', '/clients']) {
      if (can(NAV_PERMISSION[p])) return p
    }
    return '/messages' // переписка с владельцем — всегда доступна сотруднику
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

  async function updateProfile(updates: Partial<Pick<User, 'firstName' | 'lastName' | 'patronymic' | 'phone' | 'city' | 'companyName'>> & { avatar?: string; birthDate?: string }) {
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

  return { user, accessToken, refreshToken, isLoading, error, isAuthenticated, isStaff, staffRole, isOwner, userName, permissions, can, canAccess, defaultRoute, login, logout, checkAuth, updateProfile, changePassword }
})