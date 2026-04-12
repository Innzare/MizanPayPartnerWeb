<script lang="ts" setup>
import { api } from '@/api/client'
import { formatPhone, formatDate, PHONE_MASK } from '@/utils/formatters'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useRouter } from 'vue-router'

const { isDark } = useIsDark()
const toast = useToast()
const router = useRouter()

// ── Types ──

interface BlacklistReason {
  investorName: string
  reason: string
  date: string
}

interface ClientReview {
  investorName: string
  rating: number
  comment: string
  date: string
}

interface ClientProfile {
  id: string
  phone: string
  firstName: string
  lastName: string
  patronymic?: string
  hasPassport: boolean
  names: string[]
  totalDeals: number
  completedDeals: number
  activeDeals: number
  totalPayments: number
  paidPayments: number
  overduePayments: number
  currentOverdue: number
  onTimeRate: number
  avgDelayDays: number
  rating: number
  status: 'reliable' | 'delayed' | 'unreliable' | 'blacklisted'
  isOnPlatform: boolean
  platformUserId?: string
  blacklisted: boolean
  blacklistReasons: BlacklistReason[]
  reviews: ClientReview[]
}

type StatusFilter = 'all' | 'reliable' | 'delayed' | 'unreliable' | 'blacklisted'
type ClientTypeFilter = 'all' | 'platform' | 'external'

// ── State ──

const pageLoading = ref(true)
const searchLoading = ref(false)
const clients = ref<ClientProfile[]>([])
const search = ref('')
const activeTab = ref<StatusFilter>('all')
const clientTypeFilter = ref<ClientTypeFilter>('all')
const expandedPhones = ref<string[]>([])

// Blacklist dialog
const showBlacklistDialog = ref(false)
const blacklistLoading = ref(false)
const blacklistForm = ref({ phone: '', name: '', reason: '' })

// Review dialog
const showReviewDialog = ref(false)
const reviewLoading = ref(false)
const reviewForm = ref({ phone: '', name: '', rating: 5, comment: '' })

// ── Colors ──

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; bgDark: string; icon: string }> = {
  reliable: { label: 'Надёжный', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', bgDark: 'rgba(16, 185, 129, 0.15)', icon: 'mdi-shield-check' },
  delayed: { label: 'С задержками', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', bgDark: 'rgba(245, 158, 11, 0.15)', icon: 'mdi-clock-alert-outline' },
  unreliable: { label: 'Ненадёжный', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', bgDark: 'rgba(239, 68, 68, 0.15)', icon: 'mdi-alert-circle-outline' },
  blacklisted: { label: 'В чёрном списке', color: '#fff', bg: '#1a1a1a', bgDark: '#0a0a0a', icon: 'mdi-cancel' },
}

const RATING_COLORS: Record<number, string> = {
  5: '#10b981',
  4: '#3b82f6',
  3: '#f59e0b',
  2: '#f97316',
  1: '#ef4444',
}

const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#047857', '#3b82f6', '#0ea5e9', '#ec4899', '#f59e0b']

function getAvatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}

function getRatingColor(rating: number) {
  return RATING_COLORS[Math.round(rating)] || '#9ca3af'
}

// ── Registry mode: My clients vs Global search ──
const registryMode = ref<'my' | 'global'>('my')

// ── Fetch ──

let searchTimeout: ReturnType<typeof setTimeout> | null = null

const allClients = ref<ClientProfile[]>([])

async function fetchClients() {
  try {
    const params = new URLSearchParams()
    if (search.value.trim()) params.set('search', search.value.trim())
    params.set('limit', '200')
    const query = params.toString()

    const endpoint = registryMode.value === 'my' ? '/registry/my-clients' : '/registry/clients'
    allClients.value = await api.get<ClientProfile[]>(`${endpoint}${query ? '?' + query : ''}`)
    applyFilters()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки реестра')
  } finally {
    pageLoading.value = false
    searchLoading.value = false
  }
}

function switchMode(mode: 'my' | 'global') {
  registryMode.value = mode
  pageLoading.value = true
  fetchClients()
}

function onSearchInput() {
  searchLoading.value = true
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => fetchClients(), 400)
}

function applyFilters() {
  let result = allClients.value
  if (activeTab.value !== 'all') {
    result = result.filter((c) => c.status === activeTab.value)
  }
  if (clientTypeFilter.value === 'platform') {
    result = result.filter((c) => c.isOnPlatform)
  } else if (clientTypeFilter.value === 'external') {
    result = result.filter((c) => !c.isOnPlatform)
  }
  clients.value = result
}

watch(activeTab, applyFilters)
watch(clientTypeFilter, applyFilters)

onMounted(fetchClients)

// ── Computed ──

const stats = computed(() => {
  const all = allClients.value
  return {
    total: all.length,
    reliable: all.filter((c) => c.status === 'reliable').length,
    delayed: all.filter((c) => c.status === 'delayed').length,
    unreliable: all.filter((c) => c.status === 'unreliable').length,
    blacklisted: all.filter((c) => c.status === 'blacklisted').length,
    platform: all.filter((c) => c.isOnPlatform).length,
    external: all.filter((c) => !c.isOnPlatform).length,
  }
})

const tabs: { key: StatusFilter; label: string; color?: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'reliable', label: 'Надёжные', color: '#10b981' },
  { key: 'delayed', label: 'С задержками', color: '#f59e0b' },
  { key: 'unreliable', label: 'Ненадёжные', color: '#ef4444' },
  { key: 'blacklisted', label: 'Чёрный список', color: '#1a1a1a' },
]

// ── Expand ──

function toggleExpand(phone: string) {
  const idx = expandedPhones.value.indexOf(phone)
  if (idx >= 0) expandedPhones.value.splice(idx, 1)
  else expandedPhones.value.push(phone)
}

function isExpanded(phone: string) {
  return expandedPhones.value.includes(phone)
}

// ── Blacklist ──

function openBlacklistDialog(client?: ClientProfile) {
  blacklistForm.value = {
    phone: client?.phone || '',
    name: client?.names[0] || '',
    reason: '',
  }
  showBlacklistDialog.value = true
}

async function submitBlacklist() {
  if (!blacklistForm.value.phone.trim()) return toast.error('Укажите номер телефона')
  if (!blacklistForm.value.name.trim()) return toast.error('Укажите имя клиента')
  blacklistLoading.value = true
  try {
    await api.post('/registry/blacklist', {
      phone: blacklistForm.value.phone.trim(),
      name: blacklistForm.value.name.trim(),
      reason: blacklistForm.value.reason.trim() || undefined,
    })
    toast.success('Клиент добавлен в чёрный список')
    showBlacklistDialog.value = false
    await fetchClients()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка добавления в чёрный список')
  } finally {
    blacklistLoading.value = false
  }
}

async function removeFromBlacklist(phone: string) {
  try {
    await api.delete(`/registry/blacklist?phone=${encodeURIComponent(phone)}`)
    toast.success('Клиент убран из чёрного списка')
    await fetchClients()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления из чёрного списка')
  }
}

// ── Review ──

function openReviewDialog(client?: ClientProfile) {
  reviewForm.value = {
    phone: client?.phone || '',
    name: client?.names[0] || '',
    rating: 5,
    comment: '',
  }
  showReviewDialog.value = true
}

async function submitReview() {
  if (!reviewForm.value.phone.trim()) return toast.error('Укажите номер телефона')
  if (!reviewForm.value.name.trim()) return toast.error('Укажите имя клиента')
  if (reviewForm.value.rating < 1 || reviewForm.value.rating > 5) return toast.error('Укажите рейтинг от 1 до 5')
  reviewLoading.value = true
  try {
    await api.post('/registry/review', {
      phone: reviewForm.value.phone.trim(),
      name: reviewForm.value.name.trim(),
      rating: reviewForm.value.rating,
      comment: reviewForm.value.comment.trim() || undefined,
    })
    toast.success('Отзыв отправлен')
    showReviewDialog.value = false
    await fetchClients()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка отправки отзыва')
  } finally {
    reviewLoading.value = false
  }
}

// ── Helpers ──

function pluralDeals(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'сделка'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'сделки'
  return 'сделок'
}

function renderStars(rating: number): string[] {
  const result: string[] = []
  const rounded = Math.round(rating)
  for (let i = 1; i <= 5; i++) {
    result.push(i <= rounded ? 'mdi-star' : 'mdi-star-outline')
  }
  return result
}
</script>

<template>
  <div class="rg-page" :class="{ dark: isDark }">
    <!-- Hero search section -->
    <div class="rg-hero">
      <div class="rg-hero-content">
        <h1 class="rg-hero-title">Реестр клиентов</h1>
        <p class="rg-hero-subtitle">Проверяйте платёжеспособность клиентов перед заключением сделок</p>
        <div class="rg-search-wrap">
          <v-icon icon="mdi-magnify" size="22" class="rg-search-icon" />
          <input
            v-model="search"
            type="text"
            class="rg-search-input"
            placeholder="Поиск по имени или номеру телефона..."
            @input="onSearchInput"
          />
          <v-progress-circular
            v-if="searchLoading"
            indeterminate
            size="18"
            width="2"
            class="rg-search-spinner"
          />
        </div>
      </div>
    </div>

    <!-- Mode switch: My clients / Global search -->
    <div class="rg-mode-switch mb-4">
      <button
        class="rg-mode-btn"
        :class="{ 'rg-mode-btn--active': registryMode === 'my' }"
        @click="switchMode('my')"
      >
        <v-icon icon="mdi-account-group-outline" size="18" />
        <span>Мои клиенты</span>
        <span class="rg-mode-count">{{ registryMode === 'my' ? stats.total : '' }}</span>
      </button>
      <button
        class="rg-mode-btn"
        :class="{ 'rg-mode-btn--active': registryMode === 'global' }"
        @click="switchMode('global')"
      >
        <v-icon icon="mdi-earth" size="18" />
        <span>Глобальный поиск</span>
      </button>
    </div>

    <!-- Global search hint -->
    <div v-if="registryMode === 'global' && !search.trim()" class="rg-global-hint mb-4">
      <v-icon icon="mdi-information-outline" size="18" />
      <span>Введите телефон или имя клиента для поиска по всей базе MizanPay. Здесь отображаются все зарегистрированные клиенты всех инвесторов.</span>
    </div>

    <!-- External disclaimer -->
    <div v-if="clientTypeFilter === 'external' || (clientTypeFilter === 'all' && stats.external > 0)" class="rg-disclaimer mb-6">
      <v-icon icon="mdi-alert-circle-outline" size="18" />
      <div>
        <div class="rg-disclaimer-title">Обратите внимание</div>
        <div class="rg-disclaimer-text">Данные о внешних клиентах (не зарегистрированных на платформе) сформированы на основе сделок инвесторов. Сервис не может ручаться за их корректность. Будьте внимательны при заключении сделок.</div>
      </div>
    </div>

    <!-- Stats bar -->
    <div class="stats-row mb-5">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(99, 102, 241, 0.1); color: #6366f1;">
          <v-icon icon="mdi-account-multiple" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">Всего клиентов</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">
          <v-icon icon="mdi-shield-check" size="20" />
        </div>
        <div>
          <div class="stat-value" style="color: #10b981;">{{ stats.reliable }}</div>
          <div class="stat-label">Надёжных</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
          <v-icon icon="mdi-clock-alert-outline" size="20" />
        </div>
        <div>
          <div class="stat-value" style="color: #f59e0b;">{{ stats.delayed }}</div>
          <div class="stat-label">С задержками</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
          <v-icon icon="mdi-alert-circle-outline" size="20" />
        </div>
        <div>
          <div class="stat-value" style="color: #ef4444;">{{ stats.unreliable }}</div>
          <div class="stat-label">Ненадёжных</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(26, 26, 26, 0.1); color: #1a1a1a;">
          <v-icon icon="mdi-cancel" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.blacklisted }}</div>
          <div class="stat-label">В чёрном списке</div>
        </div>
      </div>
    </div>

    <!-- Main content card -->
    <v-card rounded="lg" elevation="0" border>
      <div class="pa-4">
        <!-- Filter tabs -->
        <div class="rg-tabs mb-4">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="rg-tab"
            :class="{ 'rg-tab--active': activeTab === tab.key }"
            :style="activeTab === tab.key && tab.color ? { '--tab-color': tab.color } : {}"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
            <span v-if="tab.key !== 'all'" class="rg-tab-count" :style="tab.color ? { color: tab.color } : {}">
              {{ tab.key === 'reliable' ? stats.reliable : tab.key === 'delayed' ? stats.delayed : tab.key === 'unreliable' ? stats.unreliable : stats.blacklisted }}
            </span>
          </button>
        </div>

        <!-- Client type filter -->
        <div class="rg-type-filter mb-4">
          <button class="rg-type-btn" :class="{ active: clientTypeFilter === 'all' }" @click="clientTypeFilter = 'all'">
            Все ({{ stats.total }})
          </button>
          <button class="rg-type-btn rg-type-btn--platform" :class="{ active: clientTypeFilter === 'platform' }" @click="clientTypeFilter = 'platform'">
            <v-icon icon="mdi-account-check" size="14" class="mr-1" />
            На платформе ({{ stats.platform }})
          </button>
          <button class="rg-type-btn rg-type-btn--external" :class="{ active: clientTypeFilter === 'external' }" @click="clientTypeFilter = 'external'">
            <v-icon icon="mdi-account-outline" size="14" class="mr-1" />
            Внешние ({{ stats.external }})
          </button>
        </div>

        <!-- Loading -->
        <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 300px;">
          <v-progress-circular indeterminate color="primary" size="40" />
        </div>

        <!-- Empty state -->
        <div v-else-if="!clients.length" class="rg-empty">
          <div class="rg-empty-icon">
            <v-icon icon="mdi-shield-search-outline" size="48" color="grey" />
          </div>
          <div class="rg-empty-title">Клиенты не найдены</div>
          <div class="rg-empty-subtitle">
            {{ search ? 'Попробуйте изменить запрос поиска' : 'В реестре пока нет данных о клиентах' }}
          </div>
        </div>

        <!-- Client list -->
        <div v-else class="rg-list">
          <div
            v-for="client in clients"
            :key="client.phone"
            class="rg-card"
            :class="{
              'rg-card--expanded': isExpanded(client.phone),
              'rg-card--blacklisted': client.blacklisted,
            }"
          >
            <!-- Card header -->
            <div class="rg-header" @click="toggleExpand(client.phone)">
              <div
                class="rg-avatar"
                :style="{
                  background: client.blacklisted ? '#1a1a1a' : getAvatarColor(client.names[0] || '?'),
                  opacity: client.blacklisted ? 0.9 : 1,
                }"
              >
                <span :style="{ textDecoration: client.blacklisted ? 'line-through' : 'none' }">
                  {{ getInitials(client.names[0] || '?') }}
                </span>
              </div>

              <div class="rg-main">
                <div class="rg-name-row">
                  <span class="rg-name" :class="{ 'rg-name--blacklisted': client.blacklisted }">
                    {{ client.names.join(' / ') }}
                  </span>
                  <span
                    class="rg-status-badge"
                    :style="{
                      background: isDark ? STATUS_CONFIG[client.status]?.bgDark : STATUS_CONFIG[client.status]?.bg,
                      color: STATUS_CONFIG[client.status]?.color,
                    }"
                  >
                    <v-icon :icon="STATUS_CONFIG[client.status]?.icon" size="12" class="mr-1" />
                    {{ STATUS_CONFIG[client.status]?.label }}
                  </span>
                </div>
                <div class="rg-meta">
                  {{ formatPhone(client.phone) }}
                  <span v-if="client.isOnPlatform" class="rg-platform-badge rg-platform-badge--link" @click.stop="router.push(`/clients/${client.id}`)">
                    <v-icon icon="mdi-open-in-new" size="10" class="mr-1" /> На платформе
                  </span>
                  <span v-else class="rg-external-badge">Внешний</span>
                  <span class="rg-meta-sep">·</span>
                  {{ client.totalDeals }} {{ pluralDeals(client.totalDeals) }}
                  <span class="rg-meta-sep">·</span>
                  <span :style="{ color: getRatingColor(client.rating) }">
                    {{ client.rating.toFixed(1) }}
                  </span>
                </div>
              </div>

              <!-- Rating stars (desktop) -->
              <div class="rg-rating d-none d-md-flex">
                <v-icon
                  v-for="(star, i) in renderStars(client.rating)"
                  :key="i"
                  :icon="star"
                  size="16"
                  :color="getRatingColor(client.rating)"
                />
              </div>

              <!-- Desktop stats -->
              <div class="rg-stats d-none d-lg-flex">
                <div class="rg-stat">
                  <div class="rg-stat-value">{{ client.completedDeals }}/{{ client.totalDeals }}</div>
                  <div class="rg-stat-label">Сделок</div>
                </div>
                <div class="rg-stat">
                  <div class="rg-stat-value" :style="{ color: client.overduePayments > 0 ? '#ef4444' : '#10b981' }">
                    {{ client.overduePayments }}
                  </div>
                  <div class="rg-stat-label">Просрочек</div>
                </div>
                <div class="rg-stat">
                  <div class="rg-stat-value" :style="{ color: client.onTimeRate >= 80 ? '#10b981' : client.onTimeRate >= 50 ? '#f59e0b' : '#ef4444' }">
                    {{ Math.round(client.onTimeRate) }}%
                  </div>
                  <div class="rg-stat-label">Вовремя</div>
                </div>
              </div>

              <div class="expand-icon">
                <v-icon :icon="isExpanded(client.phone) ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="20" />
              </div>
            </div>

            <!-- Expanded content -->
            <v-expand-transition>
              <div v-if="isExpanded(client.phone)" class="rg-expanded">
                <!-- Mobile stats -->
                <div class="rg-stats-mobile d-lg-none">
                  <div class="rg-stat-m">
                    <div class="rg-stat-m-label">Рейтинг</div>
                    <div class="rg-stat-m-value d-flex align-center ga-1">
                      <v-icon
                        v-for="(star, i) in renderStars(client.rating)"
                        :key="i"
                        :icon="star"
                        size="14"
                        :color="getRatingColor(client.rating)"
                      />
                      <span class="ml-1" :style="{ color: getRatingColor(client.rating) }">{{ client.rating.toFixed(1) }}</span>
                    </div>
                  </div>
                  <div class="rg-stat-m">
                    <div class="rg-stat-m-label">Сделок</div>
                    <div class="rg-stat-m-value">{{ client.completedDeals }}/{{ client.totalDeals }}</div>
                  </div>
                  <div class="rg-stat-m">
                    <div class="rg-stat-m-label">Просрочек</div>
                    <div class="rg-stat-m-value" :style="{ color: client.overduePayments > 0 ? '#ef4444' : '#10b981' }">
                      {{ client.overduePayments }}
                    </div>
                  </div>
                  <div class="rg-stat-m">
                    <div class="rg-stat-m-label">Своевременность</div>
                    <div class="rg-stat-m-value" :style="{ color: client.onTimeRate >= 80 ? '#10b981' : client.onTimeRate >= 50 ? '#f59e0b' : '#ef4444' }">
                      {{ Math.round(client.onTimeRate) }}%
                    </div>
                  </div>
                </div>

                <!-- Detailed stats -->
                <div class="rg-detail-section">
                  <div class="rg-section-title">Подробная статистика</div>
                  <div class="rg-detail-grid">
                    <div class="rg-detail-item">
                      <span class="rg-detail-label">Всего сделок</span>
                      <span class="rg-detail-value">{{ client.totalDeals }}</span>
                    </div>
                    <div class="rg-detail-item">
                      <span class="rg-detail-label">Завершённых</span>
                      <span class="rg-detail-value" style="color: #10b981;">{{ client.completedDeals }}</span>
                    </div>
                    <div class="rg-detail-item">
                      <span class="rg-detail-label">Активных</span>
                      <span class="rg-detail-value" style="color: #3b82f6;">{{ client.activeDeals }}</span>
                    </div>
                    <div class="rg-detail-item">
                      <span class="rg-detail-label">Всего платежей</span>
                      <span class="rg-detail-value">{{ client.totalPayments }}</span>
                    </div>
                    <div class="rg-detail-item">
                      <span class="rg-detail-label">Оплачено</span>
                      <span class="rg-detail-value" style="color: #10b981;">{{ client.paidPayments }}</span>
                    </div>
                    <div class="rg-detail-item">
                      <span class="rg-detail-label">Просрочено</span>
                      <span class="rg-detail-value" :style="{ color: client.overduePayments > 0 ? '#ef4444' : 'inherit' }">{{ client.overduePayments }}</span>
                    </div>
                    <div class="rg-detail-item">
                      <span class="rg-detail-label">Текущих просрочек</span>
                      <span class="rg-detail-value" :style="{ color: client.currentOverdue > 0 ? '#ef4444' : '#10b981' }">{{ client.currentOverdue }}</span>
                    </div>
                    <div class="rg-detail-item">
                      <span class="rg-detail-label">Ср. задержка (дн.)</span>
                      <span class="rg-detail-value" :style="{ color: client.avgDelayDays > 0 ? '#f59e0b' : '#10b981' }">{{ client.avgDelayDays }}</span>
                    </div>
                  </div>
                </div>

                <!-- Blacklist reasons -->
                <div v-if="client.blacklistReasons.length > 0" class="rg-detail-section">
                  <div class="rg-section-title" style="color: #ef4444;">
                    <v-icon icon="mdi-alert-circle" size="16" class="mr-1" />
                    Причины чёрного списка ({{ client.blacklistReasons.length }})
                  </div>
                  <div class="rg-blacklist-reasons">
                    <div v-for="(br, idx) in client.blacklistReasons" :key="idx" class="rg-bl-reason">
                      <div class="rg-bl-reason-header">
                        <span class="rg-bl-reason-author">{{ br.investorName }}</span>
                        <span class="rg-bl-reason-date">{{ formatDate(br.date) }}</span>
                      </div>
                      <div class="rg-bl-reason-text" v-if="br.reason">{{ br.reason }}</div>
                      <div class="rg-bl-reason-text rg-bl-reason-text--empty" v-else>Причина не указана</div>
                    </div>
                  </div>
                </div>

                <!-- Reviews -->
                <div v-if="client.reviews.length > 0" class="rg-detail-section">
                  <div class="rg-section-title">
                    <v-icon icon="mdi-comment-text-multiple-outline" size="16" class="mr-1" />
                    Отзывы инвесторов ({{ client.reviews.length }})
                  </div>
                  <div class="rg-reviews">
                    <div v-for="(rev, idx) in client.reviews" :key="idx" class="rg-review">
                      <div class="rg-review-header">
                        <span class="rg-review-author">{{ rev.investorName }}</span>
                        <div class="rg-review-stars">
                          <v-icon
                            v-for="s in 5"
                            :key="s"
                            :icon="s <= rev.rating ? 'mdi-star' : 'mdi-star-outline'"
                            size="14"
                            :color="getRatingColor(rev.rating)"
                          />
                        </div>
                        <span class="rg-review-date">{{ formatDate(rev.date) }}</span>
                      </div>
                      <div v-if="rev.comment" class="rg-review-text">{{ rev.comment }}</div>
                    </div>
                  </div>
                </div>

                <!-- Actions -->
                <div class="rg-actions">
                  <button
                    v-if="!client.blacklisted"
                    class="rg-btn rg-btn--dark"
                    @click.stop="openBlacklistDialog(client)"
                  >
                    <v-icon icon="mdi-cancel" size="16" class="mr-1" />
                    В чёрный список
                  </button>
                  <button
                    v-else
                    class="rg-btn rg-btn--ghost"
                    @click.stop="removeFromBlacklist(client.phone)"
                  >
                    <v-icon icon="mdi-undo" size="16" class="mr-1" />
                    Убрать из чёрного списка
                  </button>
                  <button class="rg-btn rg-btn--primary" @click.stop="openReviewDialog(client)">
                    <v-icon icon="mdi-star-plus-outline" size="16" class="mr-1" />
                    Оставить отзыв
                  </button>
                </div>
              </div>
            </v-expand-transition>
          </div>
        </div>
      </div>
    </v-card>

    <!-- Blacklist Dialog -->
    <v-dialog v-model="showBlacklistDialog" max-width="480" persistent>
      <v-card rounded="lg">
        <div class="rg-dialog-header">
          <span class="rg-dialog-title">Добавить в чёрный список</span>
          <button class="rg-dialog-close" @click="showBlacklistDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <div class="rg-dialog-warning mb-4">
            <v-icon icon="mdi-alert-circle-outline" size="20" class="mr-2" />
            Это действие повлияет на репутацию клиента для всех инвесторов
          </div>

          <!-- Phone -->
          <div class="rg-field mb-4">
            <label class="rg-field-label">Телефон <span style="color: #ef4444;">*</span></label>
            <input
              v-model="blacklistForm.phone"
              v-maska="PHONE_MASK"
              type="tel"
              class="rg-field-input"
              placeholder="+7 (___) ___-__-__"
            />
          </div>

          <!-- Name -->
          <div class="rg-field mb-4">
            <label class="rg-field-label">Имя клиента <span style="color: #ef4444;">*</span></label>
            <input
              v-model="blacklistForm.name"
              type="text"
              class="rg-field-input"
              placeholder="Фамилия Имя"
            />
          </div>

          <!-- Reason -->
          <div class="rg-field">
            <label class="rg-field-label">Причина</label>
            <textarea
              v-model="blacklistForm.reason"
              class="rg-field-textarea"
              placeholder="Опишите причину добавления в чёрный список..."
              rows="3"
            />
          </div>
        </div>

        <div class="rg-dialog-actions">
          <button class="rg-btn rg-btn--ghost" @click="showBlacklistDialog = false" :disabled="blacklistLoading">
            Отмена
          </button>
          <button class="rg-btn rg-btn--dark" @click="submitBlacklist" :disabled="blacklistLoading">
            <v-progress-circular v-if="blacklistLoading" indeterminate size="16" width="2" color="white" class="mr-2" />
            <v-icon v-else icon="mdi-cancel" size="16" class="mr-1" />
            Добавить в чёрный список
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Review Dialog -->
    <v-dialog v-model="showReviewDialog" max-width="480" persistent>
      <v-card rounded="lg">
        <div class="rg-dialog-header">
          <span class="rg-dialog-title">Оставить отзыв</span>
          <button class="rg-dialog-close" @click="showReviewDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <!-- Phone -->
          <div class="rg-field mb-4">
            <label class="rg-field-label">Телефон <span style="color: #ef4444;">*</span></label>
            <input
              v-model="reviewForm.phone"
              v-maska="PHONE_MASK"
              type="tel"
              class="rg-field-input"
              placeholder="+7 (___) ___-__-__"
            />
          </div>

          <!-- Name -->
          <div class="rg-field mb-4">
            <label class="rg-field-label">Имя клиента <span style="color: #ef4444;">*</span></label>
            <input
              v-model="reviewForm.name"
              type="text"
              class="rg-field-input"
              placeholder="Фамилия Имя"
            />
          </div>

          <!-- Rating -->
          <div class="rg-field mb-4">
            <label class="rg-field-label">Рейтинг <span style="color: #ef4444;">*</span></label>
            <div class="rg-star-picker">
              <button
                v-for="s in 5"
                :key="s"
                class="rg-star-btn"
                :class="{ 'rg-star-btn--active': s <= reviewForm.rating }"
                :style="{ color: s <= reviewForm.rating ? getRatingColor(reviewForm.rating) : undefined }"
                @click="reviewForm.rating = s"
              >
                <v-icon :icon="s <= reviewForm.rating ? 'mdi-star' : 'mdi-star-outline'" size="28" />
              </button>
            </div>
          </div>

          <!-- Comment -->
          <div class="rg-field">
            <label class="rg-field-label">Комментарий</label>
            <textarea
              v-model="reviewForm.comment"
              class="rg-field-textarea"
              placeholder="Расскажите о вашем опыте работы с этим клиентом..."
              rows="3"
            />
          </div>
        </div>

        <div class="rg-dialog-actions">
          <button class="rg-btn rg-btn--ghost" @click="showReviewDialog = false" :disabled="reviewLoading">
            Отмена
          </button>
          <button class="rg-btn rg-btn--primary" @click="submitReview" :disabled="reviewLoading">
            <v-progress-circular v-if="reviewLoading" indeterminate size="16" width="2" color="white" class="mr-2" />
            Отправить отзыв
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* ── Page ── */
.rg-page {
  max-width: 1200px;
  margin: 0 auto;
  padding-top: 32px;
  padding-bottom: 32px;
}

/* ── Hero search ── */
.rg-hero {
  margin-bottom: 24px;
  padding: 32px 28px;
  border-radius: 16px;
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  position: relative;
  overflow: hidden;
}
.rg-hero::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -20%;
  width: 400px;
  height: 400px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
}
.rg-hero::after {
  content: '';
  position: absolute;
  bottom: -30%;
  left: -10%;
  width: 300px;
  height: 300px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.03);
}
.rg-hero-content {
  position: relative;
  z-index: 1;
}
.rg-hero-title {
  font-size: 24px;
  font-weight: 800;
  color: #fff;
  margin-bottom: 6px;
}
.rg-hero-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 20px;
}
.rg-search-wrap {
  position: relative;
  max-width: 560px;
}
.rg-search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(255, 255, 255, 0.5);
}
.rg-search-input {
  width: 100%;
  padding: 14px 48px 14px 48px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(8px);
  font-size: 15px;
  color: #fff;
  outline: none;
  transition: all 0.2s;
}
.rg-search-input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}
.rg-search-input:focus {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.4);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.08);
}
.rg-search-spinner {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(255, 255, 255, 0.7) !important;
}

/* ── Stats row ── */
.stats-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
}
@media (max-width: 1100px) { .stats-row { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 700px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 500px) { .stats-row { grid-template-columns: 1fr; } }

.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e5e7eb;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.stat-card:hover {
  border-color: #d1d5db;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.stat-icon {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.stat-value {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.stat-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}

/* ── Tabs ── */
.rg-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.rg-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.rg-tab:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.rg-tab--active {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-weight: 600;
  border-color: rgba(var(--v-theme-on-surface), 0.1);
}
.rg-tab-count {
  font-size: 11px;
  font-weight: 700;
}

/* ── Empty ── */
.rg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px;
  text-align: center;
}
.rg-empty-icon {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}
.rg-empty-title {
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 6px;
}
.rg-empty-subtitle {
  font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  max-width: 360px;
}

/* ── Client list ── */
.rg-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rg-card {
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
  transition: all 0.2s;
}
.rg-card:hover {
  border-color: #d1d5db;
}
.rg-card--expanded {
  border-color: rgba(4, 120, 87, 0.35);
  box-shadow: 0 2px 12px rgba(4, 120, 87, 0.08);
}
.rg-card--blacklisted {
  border-color: rgba(26, 26, 26, 0.2);
  background: #fafafa;
}
.rg-card--blacklisted .rg-header {
  opacity: 0.85;
}

/* ── Card header ── */
.rg-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  cursor: pointer;
  transition: background 0.15s;
}
.rg-header:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}

.rg-avatar {
  width: 44px;
  height: 44px;
  min-width: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.5px;
}

.rg-main {
  flex: 1;
  min-width: 0;
}
.rg-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rg-name {
  font-size: 15px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.rg-name--blacklisted {
  text-decoration: line-through;
  opacity: 0.6;
}
.rg-status-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 6px;
  white-space: nowrap;
}
.rg-meta {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}
.rg-meta-sep {
  margin: 0 4px;
  opacity: 0.5;
}
.rg-platform-badge {
  display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 4px;
  background: rgba(16, 185, 129, 0.1); color: #10b981;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  margin-left: 4px;
}
.rg-platform-badge--link {
  cursor: pointer; transition: all 0.15s;
}
.rg-platform-badge--link:hover {
  background: rgba(16, 185, 129, 0.2);
}
/* Type filter */
.rg-type-filter {
  display: flex; gap: 6px; flex-wrap: wrap;
}
.rg-type-btn {
  display: inline-flex; align-items: center;
  padding: 6px 14px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
}
.rg-type-btn:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.rg-type-btn.active {
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.rg-type-btn--platform.active { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.rg-type-btn--external.active { background: rgba(99, 102, 241, 0.1); color: #6366f1; }

/* Disclaimer */
.rg-disclaimer {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 18px; border-radius: 12px;
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.15);
  color: #ff8c00;
}
.rg-disclaimer-title {
  font-size: 15px; font-weight: 700; margin-bottom: 2px;
}
.rg-disclaimer-text {
  font-size: 13px; line-height: 1.6;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.dark .rg-disclaimer { background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.2); }
.dark .rg-type-btn { background: #252538; }
.dark .rg-type-btn.active { background: #2e2e42; }
.dark .rg-type-btn--platform.active { background: rgba(16, 185, 129, 0.12); }
.dark .rg-type-btn--external.active { background: rgba(99, 102, 241, 0.12); }

.rg-external-badge {
  display: inline-flex; padding: 1px 6px; border-radius: 4px;
  background: rgba(99, 102, 241, 0.1); color: #6366f1;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  margin-left: 4px;
}

/* Rating */
.rg-rating {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: 8px;
}

/* Desktop stats */
.rg-stats {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-right: 8px;
}
.rg-stat {
  text-align: right;
}
.rg-stat-value {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
}
.rg-stat-label {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

.expand-icon {
  color: rgba(var(--v-theme-on-surface), 0.25);
  flex-shrink: 0;
}

/* ── Expanded content ── */
.rg-expanded {
  padding: 0 18px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

/* Mobile stats */
.rg-stats-mobile {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin: 16px 0;
}
.rg-stat-m {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.rg-stat-m-label {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.rg-stat-m-value {
  font-size: 15px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Detail sections */
.rg-detail-section {
  margin-top: 16px;
}
.rg-section-title {
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.rg-detail-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
@media (max-width: 700px) { .rg-detail-grid { grid-template-columns: repeat(2, 1fr); } }

.rg-detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.rg-detail-label {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.rg-detail-value {
  font-size: 16px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Blacklist reasons */
.rg-blacklist-reasons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rg-bl-reason {
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.04);
  border-left: 3px solid #ef4444;
}
.rg-bl-reason-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.rg-bl-reason-author {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.rg-bl-reason-date {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.rg-bl-reason-text {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  line-height: 1.5;
}
.rg-bl-reason-text--empty {
  font-style: italic;
  opacity: 0.5;
}

/* Reviews */
.rg-reviews {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rg-review {
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.rg-review-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.rg-review-author {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.rg-review-stars {
  display: flex;
  gap: 1px;
}
.rg-review-date {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-left: auto;
}
.rg-review-text {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  line-height: 1.5;
}

/* Actions */
.rg-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  flex-wrap: wrap;
}

/* ── Buttons ── */
.rg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 9px 18px;
  border-radius: 10px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.rg-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.rg-btn--primary {
  background: #047857;
  color: #fff;
}
.rg-btn--primary:hover:not(:disabled) {
  background: #065f46;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}
.rg-btn--dark {
  background: #1a1a1a;
  color: #fff;
}
.rg-btn--dark:hover:not(:disabled) {
  background: #0a0a0a;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.rg-btn--ghost {
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.5);
  border: 1px solid #e5e7eb;
}
.rg-btn--ghost:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* ── Dialog ── */
.rg-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.rg-dialog-title {
  font-size: 17px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.rg-dialog-close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.rg-dialog-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.rg-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.rg-dialog-warning {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.08);
  color: #b45309;
  font-size: 13px;
  font-weight: 500;
}

/* ── Form fields ── */
.rg-field-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}
.rg-field-input {
  width: 100%;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  font-size: 14px;
  outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: all 0.15s;
}
.rg-field-input:focus {
  border-color: #047857;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.08);
}
.rg-field-textarea {
  width: 100%;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  font-size: 14px;
  outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: all 0.15s;
  resize: vertical;
  font-family: inherit;
  min-height: 80px;
}
.rg-field-textarea:focus {
  border-color: #047857;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.08);
}

/* Star picker */
.rg-star-picker {
  display: flex;
  gap: 4px;
}
.rg-star-btn {
  padding: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.2);
  transition: all 0.15s;
  border-radius: 6px;
}
.rg-star-btn:hover {
  transform: scale(1.15);
}
.rg-star-btn--active {
  transform: scale(1.05);
}

/* ── Dark mode ── */
.dark .stat-card {
  background: #1e1e2e;
  border-color: #2e2e42;
}
.dark .rg-card {
  background: #1e1e2e;
  border-color: #2e2e42;
}
.dark .rg-card:hover {
  border-color: #3e3e52;
}
.dark .rg-card--expanded {
  border-color: rgba(4, 120, 87, 0.35);
}
.dark .rg-card--blacklisted {
  background: #161622;
  border-color: rgba(255, 255, 255, 0.08);
}
.dark .rg-field-input {
  background: #252538;
  border-color: #2e2e42;
  color: #e4e4e7;
}
.dark .rg-field-input:focus {
  border-color: #047857;
  background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .rg-field-textarea {
  background: #252538;
  border-color: #2e2e42;
  color: #e4e4e7;
}
.dark .rg-field-textarea:focus {
  border-color: #047857;
  background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .rg-btn--ghost {
  border-color: #2e2e42;
  color: #a1a1aa;
}
.dark .rg-btn--ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.04);
}
.dark .rg-btn--dark {
  background: #e4e4e7;
  color: #1a1a1a;
}
.dark .rg-btn--dark:hover:not(:disabled) {
  background: #fff;
}
.dark .rg-stat-m {
  background: rgba(255, 255, 255, 0.04);
}
.dark .rg-detail-item {
  background: rgba(255, 255, 255, 0.04);
}
.dark .rg-review {
  background: rgba(255, 255, 255, 0.03);
}
.dark .rg-bl-reason {
  background: rgba(239, 68, 68, 0.06);
}
.dark .rg-dialog-header {
  border-bottom-color: #2e2e42;
}
.dark .rg-dialog-actions {
  border-top-color: #2e2e42;
}
.dark .rg-dialog-warning {
  background: rgba(245, 158, 11, 0.1);
  color: #fbbf24;
}
.dark .rg-hero {
  background: linear-gradient(135deg, #065f46 0%, #064e3b 50%, #022c22 100%);
}
.dark .rg-tab--active {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}
.dark .rg-tab:hover {
  background: rgba(255, 255, 255, 0.04);
}
.dark .stat-icon:last-child {
  color: #a1a1aa !important;
}

/* ── Mode switch ── */
.rg-mode-switch {
  display: flex;
  gap: 8px;
  padding: 4px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 12px;
  width: fit-content;
}

.rg-mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 18px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.rg-mode-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.rg-mode-btn--active {
  background: rgba(var(--v-theme-surface), 1);
  color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.rg-mode-count {
  font-size: 11px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.rg-mode-count:empty { display: none; }

.rg-global-hint {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(59, 130, 246, 0.06);
  border: 1px solid rgba(59, 130, 246, 0.15);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px;
  line-height: 1.45;
}

.dark .rg-mode-switch {
  background: rgba(255, 255, 255, 0.04);
}

.dark .rg-mode-btn--active {
  background: #1e1e2e;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
</style>
