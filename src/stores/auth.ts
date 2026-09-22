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
  // Старый адрес поручителей: страница ведёт на вкладку в «Клиентах», но
  // открывать её должен тот, кому эта вкладка вообще положена.
  '/guarantors': 'guarantors.view',
  '/suppliers/requests': 'suppliers.requests',
  '/suppliers/route-sheets': 'suppliers.routesheet',
  '/suppliers': 'suppliers.view',
  '/broadcasts': 'broadcasts.view',
  '/co-investors': 'coinvestors.view',
  '/cashboxes': 'cashboxes.view',
  // Старый адрес инкассации ведёт на «Пункты приёма»; карточка рейса
  // (/collections/:id) открывается оттуда и живёт по тому же праву.
  '/collections': 'collections.view',
  // Инкассатору нужен доступ к вкладке «Пункты приёма» по своему праву, без
  // доступа ко всей бухгалтерии.
  '/accounting/points': 'accounting.view|collections.view',
  '/accounting/reports': 'accounting.reports',
  '/accounting/audit': 'accounting.audit',
  '/accounting': 'accounting.view',
  '/registry': 'registry.view',
  '/activity': 'activity.view',
  // Роли — вкладка внутри «Сотрудников», своего адреса у них нет.
  '/staff': 'staff.manage',
  // Копия — файл с персональными данными: раздел открыт тем, кто настраивает
  // расписание, и тем, кому разрешено скачивать готовые файлы.
  '/backups': 'backups.manage|backups.download',
}
// Доступны любому аутентифицированному сотруднику (не гейтятся правом).
// /messages — переписка с владельцем, доступна всегда.
// /help — обучающая справка: она нужна сотруднику не меньше, чем владельцу,
// и без этой строки неизвестный роут закрывается редиректом (см. canAccess ниже).
const STAFF_ALWAYS = ['/me', '/calculator', '/messages', '/help']
// Кабинет пункта приёма: там работает только оператор пункта, а он — только там.
const POINT_ROOT = '/point'
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
  /**
   * Оператор пункта приёма — внешний человек с отдельным кабинетом. У него
   * нет ни прав, ни общей навигации: только четыре своих экрана.
   */
  const isPointOperator = computed(() => user.value?.staffRole === 'POINT_OPERATOR')
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
    // Кабинет пункта — только для оператора пункта, и для него только он.
    const isPointPath = path === POINT_ROOT || path.startsWith(POINT_ROOT + '/')
    if (isPointOperator.value) return isPointPath
    if (isPointPath) return false
    if (!isStaff.value) return true // owner sees everything
    // Свою страницу сотрудник открывает всегда: это его собственная работа.
    // Раздел «Сотрудники» при этом остаётся закрытым, как и был.
    if (user.value?.staffId && path === `/staff/${user.value.staffId}`) return true
    // Чужой профиль — по праву «Статистика сотрудников». Без этой строки
    // человек видел бы сравнительную таблицу, но не мог открыть из неё никого:
    // сервер такой профиль отдаёт, а интерфейс был строже сервера.
    if (path.startsWith('/staff/') && can('staff.stats')) return true
    // Только владелец.
    if (OWNER_ONLY.some((r) => path === r || path.startsWith(r + '/'))) return false
    // Всегда доступно сотруднику.
    if (STAFF_ALWAYS.some((r) => path === r || path.startsWith(r + '/'))) return true
    // Гейт по праву: берём самый длинный подходящий базовый путь
    // (/deals/123 → /deals, /create-deal → /create-deal).
    const base = Object.keys(NAV_PERMISSION)
      .filter((r) => path === r || path.startsWith(r + '/'))
      .sort((a, b) => b.length - a.length)[0]
    // У раздела может быть несколько подходящих прав («или»), см. /accounting/points.
    if (base) return (NAV_PERMISSION[base] ?? '').split('|').some((key) => can(key))
    return false // неизвестный сотруднику роут — закрыт
  }

  /** Куда отправить после логина / при отказе в доступе. Владелец → `/`,
   *  сотрудник → первый доступный по правам не-подписочный раздел (чтобы не
   *  ловить редирект-петлю на подписочных разделах на FREE-плане). */
  const defaultRoute = computed(() => {
    if (isPointOperator.value) return POINT_ROOT
    if (!isStaff.value) return '/'
    for (const p of ['/deals', '/payments', '/clients']) {
      if (can(NAV_PERMISSION[p] ?? '')) return p
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

      // Оператору пункта профиль партнёра недоступен (и не нужен): там тариф,
      // настройки и данные компании. Берём то, что вернул вход.
      if (data.staffRole === 'POINT_OPERATOR') {
        data.user.staffId = data.staffId
        data.user.staffRole = data.staffRole
        user.value = data.user
        localStorage.setItem('user', JSON.stringify(data.user))
        return
      }

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

    // Validate with backend. Оператору пункта профиль партнёра закрыт — для
    // него проверяем токен его же эндпоинтом, иначе вход выбрасывало бы наружу.
    try {
      if (user.value?.staffRole === 'POINT_OPERATOR') {
        await api.getSilent('/point/context')
      } else {
        const profile = await api.getSilent<User>('/auth/investor/profile')
        user.value = profile
        localStorage.setItem('user', JSON.stringify(profile))
      }
    } catch {
      await logout()
    }
  }

  async function updateProfile(updates: Partial<Pick<User, 'firstName' | 'lastName' | 'patronymic' | 'phone' | 'city' | 'companyName'>> & { avatar?: string; birthDate?: string }) {
    if (!user.value) return
    isLoading.value = true
    try {
      const updated = await api.patch<User>('/auth/investor/profile', updates)
      // Дописываем поверх, а не заменяем целиком: в профиле лежит и тариф
      // (planFeatures, dealAccessThreshold), и права сотрудника. Ответ, где
      // их не окажется, иначе «отключил» бы подписку до перезагрузки —
      // разделы покрывались коронами после сохранения личных данных.
      const merged = { ...(user.value as any), ...(updated as any) } as User
      user.value = merged
      localStorage.setItem('user', JSON.stringify(merged))
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

  return { user, accessToken, refreshToken, isLoading, error, isAuthenticated, isStaff, staffRole, isPointOperator, isOwner, userName, permissions, can, canAccess, defaultRoute, login, logout, checkAuth, updateProfile, changePassword }
})