<script lang="ts" setup>
import { api } from '@/api/client'
import ServerPager from '@/components/ServerPager.vue'
import { formatPhone, formatDate, PHONE_MASK } from '@/utils/formatters'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useIsMobile } from '@/composables/useIsMobile'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const { isDark } = useIsDark()
const toast = useToast()
const { isMobile } = useIsMobile()
const router = useRouter()
const authStore = useAuthStore()

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
  isPublic: boolean
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

// Delete client
const deleteLoading = ref<string | null>(null)
const showDeleteDialog = ref(false)
const clientToDelete = ref<ClientProfile | null>(null)

// Удалять ли сделки вместе с клиентом — выбор в окне подтверждения.
const deleteWithDeals = ref(false)

function confirmDeleteClient(client: ClientProfile) {
  clientToDelete.value = client
  deleteWithDeals.value = false
  showDeleteDialog.value = true
}

async function doDelete() {
  if (!clientToDelete.value) return
  deleteLoading.value = clientToDelete.value.id
  try {
    const res = await api.delete<{ dealsDeleted?: number }>(
      `/client-profiles/${clientToDelete.value.id}${deleteWithDeals.value ? '?withDeals=1' : ''}`,
    )
    toast.success(
      res?.dealsDeleted ? `Клиент удалён, сделок в корзину: ${res.dealsDeleted}` : 'Клиент удалён',
    )
    showDeleteDialog.value = false
    clientToDelete.value = null
    // Страницу и счётчики пересобирает сервер — иначе на месте удалённого
    // осталась бы дырка, а следующая страница поехала бы на строку вверх.
    await Promise.all([fetchClients(), fetchCounts()])
  } catch (e: any) {
    toast.error(e.response?.data?.message || e.message || 'Ошибка удаления')
  } finally {
    deleteLoading.value = null
  }
}

// Publish to global
const publishLoading = ref<string | null>(null)

async function togglePublish(client: ClientProfile) {
  publishLoading.value = client.id
  try {
    const endpoint = client.isPublic
      ? `/registry/unpublish/${client.id}`
      : `/registry/publish/${client.id}`
    await api.patch(endpoint)
    client.isPublic = !client.isPublic
    toast.success(client.isPublic ? 'Клиент добавлен в глобальный реестр' : 'Клиент убран из глобального реестра')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  } finally {
    publishLoading.value = null
  }
}

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

// ── Постраничная загрузка ──

const PAGE_SIZE_KEY = 'registry:perPage'
const PER_PAGE_OPTIONS = [25, 50, 100, 200] // 200 — серверный максимум

const page = ref(1)
const perPage = ref(
  PER_PAGE_OPTIONS.includes(Number(localStorage.getItem(PAGE_SIZE_KEY)))
    ? Number(localStorage.getItem(PAGE_SIZE_KEY))
    : 50,
)
const total = ref(0)
watch(perPage, (v) => localStorage.setItem(PAGE_SIZE_KEY, String(v)))

/** Счётчики шапки и вкладок — приходят с сервера по всей выборке. */
const counts = ref({
  total: 0, reliable: 0, delayed: 0, unreliable: 0, blacklisted: 0, platform: 0, external: 0,
})

// ── Fetch ──

let searchTimeout: ReturnType<typeof setTimeout> | null = null
// Защита от гонки: при быстром наборе ответ на устаревший запрос может прийти
// последним и затереть свежий результат.
let listReq = 0

interface Page<T> { items: T[]; total: number }

async function fetchClients() {
  const req = ++listReq
  try {
    const params = new URLSearchParams()
    if (search.value.trim()) params.set('search', search.value.trim())
    if (activeTab.value !== 'all') params.set('status', activeTab.value)
    if (clientTypeFilter.value !== 'all') params.set('kind', clientTypeFilter.value)
    params.set('limit', String(perPage.value))
    params.set('offset', String((page.value - 1) * perPage.value))

    if (registryMode.value === 'my') {
      const res = await api.get<Page<ClientProfile>>(`/registry/my-clients?${params}`)
      if (req !== listReq) return
      clients.value = res.items
      total.value = res.total
    } else {
      // Глобальный поиск — отдельная выдача по всей базе, без постраничности.
      const gp = new URLSearchParams()
      if (search.value.trim()) gp.set('search', search.value.trim())
      gp.set('limit', '200')
      const res = await api.get<ClientProfile[]>(`/registry/clients?${gp}`)
      if (req !== listReq) return
      clients.value = res
      total.value = res.length
    }
  } catch (e: any) {
    if (req === listReq) toast.error(e.message || 'Ошибка загрузки реестра')
  } finally {
    if (req === listReq) {
      pageLoading.value = false
      searchLoading.value = false
    }
  }
}

/** Счётчики зависят только от поиска — статус и тип на них не влияют. */
async function fetchCounts() {
  if (registryMode.value !== 'my') return
  try {
    const p = new URLSearchParams()
    if (search.value.trim()) p.set('search', search.value.trim())
    counts.value = await api.get<typeof counts.value>(`/registry/my-clients/counts?${p}`)
  } catch {
    /* счётчики не критичны — молча оставляем прежние */
  }
}

/** Смена фильтра всегда возвращает на первую страницу. */
function reload(resetPage = true) {
  if (resetPage) page.value = 1
  clearSelection()
  fetchClients()
}

// ── Выделение и массовое удаление ──
//
// Два режима, как в массовом удалении сделок: обычный — выбраны перечисленные
// строки; «вся выборка» — выбрано всё под текущими фильтрами, а снятые галочки
// работают как исключения. Иначе шестнадцать тысяч клиентов пришлось бы
// отмечать вручную.
const canBulkDelete = computed(() => authStore.can('clients.delete'))
// Режим выделения включается кнопкой: постоянные галочки в списке только
// мешают, пока ничего удалять не собираются.
const selectionMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const selectAllMatching = ref(false)
const excludedIds = ref<Set<string>>(new Set())
const bulkDeleting = ref(false)
const showBulkDeleteDialog = ref(false)
// Удалять ли сделки вместе с клиентами. По умолчанию нет — сделки это история
// денег, и терять её вместе с карточками партнёр обычно не хочет.
const bulkWithDeals = ref(false)

function openBulkDeleteDialog() {
  bulkWithDeals.value = false
  showBulkDeleteDialog.value = true
}

function clearSelection() {
  selectedIds.value = new Set()
  selectAllMatching.value = false
  excludedIds.value = new Set()
}

function exitSelection() {
  clearSelection()
  selectionMode.value = false
}

function isSelected(id: string): boolean {
  return selectAllMatching.value ? !excludedIds.value.has(id) : selectedIds.value.has(id)
}

function toggleSelect(id: string) {
  if (selectAllMatching.value) {
    const next = new Set(excludedIds.value)
    next.has(id) ? next.delete(id) : next.add(id)
    excludedIds.value = next
  } else {
    const next = new Set(selectedIds.value)
    next.has(id) ? next.delete(id) : next.add(id)
    selectedIds.value = next
  }
}

/** Галочка в шапке отмечает и снимает только показанную страницу. */
const pageAllSelected = computed(
  () => clients.value.length > 0 && clients.value.every((c) => isSelected(c.id)),
)

function togglePage() {
  const ids = clients.value.map((c) => c.id)
  const select = !pageAllSelected.value
  if (selectAllMatching.value) {
    const next = new Set(excludedIds.value)
    for (const id of ids) select ? next.delete(id) : next.add(id)
    excludedIds.value = next
  } else {
    const next = new Set(selectedIds.value)
    for (const id of ids) select ? next.add(id) : next.delete(id)
    selectedIds.value = next
  }
}

/** Сколько клиентов сейчас выбрано — с учётом режима «вся выборка». */
const selectedCount = computed(() =>
  selectAllMatching.value ? Math.max(0, total.value - excludedIds.value.size) : selectedIds.value.size,
)

function selectAll() {
  selectAllMatching.value = true
  excludedIds.value = new Set()
  selectedIds.value = new Set()
}

/** Отмечена ли хоть одна строка страницы — для промежуточного состояния. */
const pageSomeSelected = computed(() => clients.value.some((c) => isSelected(c.id)))

/**
 * Предложение расширить выбор на всю выборку показываем ровно тогда, когда
 * оно осмысленно: страница отмечена целиком, а за ней есть ещё клиенты.
 */
const canOfferSelectAll = computed(
  () => !selectAllMatching.value && pageAllSelected.value && total.value > clients.value.length,
)

interface BulkDeleteResult {
  deleted: number
  dealsDeleted: number
  remaining: number
  skipped: Record<string, number>
  examples: { name: string; reason: string }[]
}

// Сколько уже удалено — показывается на кнопке, пока идёт длинная чистка.
const bulkProgress = ref(0)

async function doBulkDelete() {
  bulkDeleting.value = true
  bulkProgress.value = 0
  try {
    const pickedIds = [...selectedIds.value]
    let deleted = 0
    let dealsDeleted = 0
    let skipped: Record<string, number> = {}
    let offset = 0

    // Сервер обрабатывает выборку пачками и возвращает остаток: удаление
    // сделок пересобирает журнал кассы по каждой, и одним запросом на
    // пятнадцати тысячах это обернулось бы обрывом по таймауту. Повторяем,
    // пока остаток не иссякнет; прерывание безопасно — сделанное сохранится.
    for (;;) {
      const body = {
        ...(selectAllMatching.value
          ? {
              allMatching: {
                ...(search.value.trim() ? { search: search.value.trim() } : {}),
                ...(activeTab.value !== 'all' ? { status: activeTab.value } : {}),
                ...(clientTypeFilter.value !== 'all' ? { kind: clientTypeFilter.value } : {}),
              },
              excludeIds: [...excludedIds.value],
            }
          : { ids: pickedIds.slice(offset) }),
        withDeals: bulkWithDeals.value,
      }

      const res = await api.post<BulkDeleteResult>('/registry/bulk-delete', body)
      deleted += res.deleted
      dealsDeleted += res.dealsDeleted ?? 0
      skipped = res.skipped ?? skipped
      bulkProgress.value = deleted

      // Ни одного удаления и остаток не убывает — дальше идти некуда.
      if (!res.remaining || res.deleted === 0) break
      offset += res.deleted
    }

    const skippedTotal = Object.values(skipped).reduce((s, n) => s + n, 0)
    const dealsPart = dealsDeleted ? `, сделок в корзину: ${dealsDeleted}` : ''
    if (deleted > 0 && skippedTotal === 0) {
      toast.success(`Удалено клиентов: ${deleted}${dealsPart}`)
    } else if (deleted > 0) {
      toast.success(`Удалено: ${deleted}${dealsPart}. Пропущено: ${skippedTotal} — ${skipSummary(skipped)}`)
    } else {
      toast.error(`Ничего не удалено. ${skipSummary(skipped)}`)
    }

    showBulkDeleteDialog.value = false
    exitSelection()
    page.value = 1
    await Promise.all([fetchClients(), fetchCounts()])
  } catch (e: any) {
    toast.error(e.response?.data?.message || e.message || 'Не удалось удалить клиентов')
  } finally {
    bulkDeleting.value = false
    bulkProgress.value = 0
  }
}

const SKIP_REASONS: Record<string, string> = {
  platform: 'зарегистрированы на платформе',
  foreign: 'созданы другим партнёром',
  public: 'опубликованы в глобальном реестре',
  active_deals: 'есть действующие сделки',
  guarantor: 'выступают поручителями',
}

function pluralClients(n: number): string {
  const ten = n % 100
  if (ten >= 11 && ten <= 14) return 'клиентов'
  switch (n % 10) {
    case 1: return 'клиента'
    case 2:
    case 3:
    case 4: return 'клиентов'
    default: return 'клиентов'
  }
}

function skipSummary(skipped: Record<string, number>): string {
  const parts = Object.entries(skipped ?? {})
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${n} ${SKIP_REASONS[reason] ?? reason}`)
  return parts.length ? parts.join(', ') : ''
}

function switchMode(mode: 'my' | 'global') {
  registryMode.value = mode
  pageLoading.value = true
  page.value = 1
  clients.value = []
  fetchClients()
  fetchCounts()
}

function onSearchInput() {
  searchLoading.value = true
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    page.value = 1
    fetchClients()
    fetchCounts()
  }, 400)
}

// Фильтры и постраничность считает сервер: показываем ровно то, что он отдал.
watch(activeTab, () => reload())
watch(clientTypeFilter, () => reload())
watch(page, () => fetchClients())
watch(perPage, () => reload())

onMounted(() => {
  fetchClients()
  fetchCounts()
})

// ── Computed ──

// Счётчики берём с сервера — по всей выборке. Раньше они складывались из
// загруженных строк и показывали не весь реестр, а только первую страницу.
const stats = computed(() => counts.value)

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
  <div class="at-page rg-page" :class="{ dark: isDark }">
    <!-- Hero search section (заголовок раздела — в верхнем баре) -->
    <div class="rg-hero">
      <div class="rg-hero-content">
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

    <!-- Stats bar (KPI) — скрывается у ролей без права registry.kpi -->
    <div v-if="authStore.can('registry.kpi')" class="stats-row mb-5">
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
    <v-card class="rg-list-card" rounded="lg" elevation="0" border>
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

          <div class="rg-filter-spacer" />

          <button
            v-if="canBulkDelete && registryMode === 'my' && clients.length && !selectionMode"
            class="rg-type-btn"
            @click="selectionMode = true"
          >
            <v-icon icon="mdi-checkbox-multiple-outline" size="14" class="mr-1" />
            Выбрать
          </button>
        </div>

        <!-- Режим выделения -->
        <div v-if="selectionMode" class="rg-sel">
          <v-checkbox-btn
            :model-value="pageAllSelected"
            :indeterminate="pageSomeSelected && !pageAllSelected"
            density="compact"
            hide-details
            @update:model-value="togglePage"
          />
          <span class="rg-sel-count">
            {{ selectedCount ? `Выбрано: ${selectedCount}` : 'Выберите клиентов' }}
          </span>

          <template v-if="canOfferSelectAll || selectAllMatching">
            <span class="rg-sel-dot">·</span>
            <button v-if="canOfferSelectAll" class="rg-sel-link" @click="selectAll">
              Выбрать все {{ total }}
            </button>
            <button v-else class="rg-sel-link" @click="clearSelection">Снять выбор</button>
          </template>

          <div class="rg-sel-spacer" />

          <button
            v-if="selectedCount"
            class="rg-sel-danger"
            :disabled="bulkDeleting"
            @click="openBulkDeleteDialog"
          >
            <v-icon icon="mdi-delete-outline" size="16" />
            Удалить
          </button>
          <button class="rg-sel-close" title="Выйти из режима выбора" @click="exitSelection">
            <v-icon icon="mdi-close" size="18" />
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
              'rg-card--picked': selectionMode && isSelected(client.id),
            }"
          >
            <!-- Card header. В режиме выбора клик по строке отмечает клиента,
                 а не раскрывает карточку — так ставить галочки быстрее. -->
            <div
              class="rg-header"
              @click="selectionMode ? toggleSelect(client.id) : toggleExpand(client.phone)"
            >
              <div v-if="selectionMode" class="rg-pick">
                <v-checkbox-btn
                  :model-value="isSelected(client.id)"
                  density="compact"
                  hide-details
                  tabindex="-1"
                  style="pointer-events: none;"
                />
              </div>
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
                  <span v-if="client.isPublic" class="rg-public-badge">
                    <v-icon icon="mdi-earth" size="10" class="mr-1" /> Глобальный
                  </span>
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
                    class="rg-btn rg-btn--outline"
                    @click.stop="router.push(`/clients/${client.id}`)"
                  >
                    <v-icon icon="mdi-account-details-outline" size="16" class="mr-1" />
                    Профиль клиента
                  </button>
                  <button
                    v-if="registryMode === 'my' && !client.isPublic"
                    class="rg-btn rg-btn--success"
                    :disabled="publishLoading === client.id"
                    @click.stop="togglePublish(client)"
                  >
                    <v-icon icon="mdi-earth-plus" size="16" class="mr-1" />
                    {{ publishLoading === client.id ? 'Публикация...' : 'В глобальный реестр' }}
                  </button>
                  <button
                    v-if="registryMode === 'my' && client.isPublic"
                    class="rg-btn rg-btn--ghost"
                    :disabled="publishLoading === client.id"
                    @click.stop="togglePublish(client)"
                  >
                    <v-icon icon="mdi-earth-minus" size="16" class="mr-1" />
                    {{ publishLoading === client.id ? 'Снятие...' : 'Убрать из глобального' }}
                  </button>
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
                  <button
                    v-if="registryMode === 'my' && !client.isOnPlatform && !client.isPublic"
                    class="rg-btn rg-btn--danger"
                    :disabled="deleteLoading === client.id"
                    @click.stop="confirmDeleteClient(client)"
                  >
                    <v-icon icon="mdi-delete-outline" size="16" class="mr-1" />
                    {{ deleteLoading === client.id ? 'Удаление...' : 'Удалить клиента' }}
                  </button>
                </div>
              </div>
            </v-expand-transition>
          </div>
        </div>

        <!-- Постраничность. В глобальном поиске её нет: там отдельная выдача
             по всей базе, ограниченная запросом. -->
        <ServerPager
          v-if="registryMode === 'my' && total > 0"
          :page="page"
          :total="total"
          :per-page="perPage"
          :busy="pageLoading || searchLoading"
          :per-page-options="PER_PAGE_OPTIONS"
          @update:page="page = $event"
          @update:per-page="perPage = $event"
        />
      </div>
    </v-card>

    <!-- Blacklist Dialog -->
    <v-dialog v-model="showBlacklistDialog" max-width="480" persistent :fullscreen="isMobile">
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
    <v-dialog v-model="showReviewDialog" max-width="480" persistent :fullscreen="isMobile">
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

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="showDeleteDialog" max-width="420" persistent :fullscreen="isMobile">
      <v-card rounded="lg">
        <div class="rg-dialog-header">
          <span class="rg-dialog-title">Удалить клиента</span>
          <button class="rg-dialog-close" @click="showDeleteDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <div class="rg-dialog-warning mb-4">
            <v-icon icon="mdi-alert-circle-outline" size="20" class="mr-2" />
            Профиль клиента будет удалён безвозвратно. Все отзывы и записи в чёрном списке, связанные с этим клиентом, также будут удалены.
          </div>

          <div v-if="clientToDelete" class="mb-4" style="font-size: 15px; color: rgba(var(--v-theme-on-surface), 0.7);">
            Вы уверены, что хотите удалить профиль <strong>{{ clientToDelete.firstName }} {{ clientToDelete.lastName }}</strong>?
          </div>

          <label class="rg-bulk-choice" :class="{ 'rg-bulk-choice--on': deleteWithDeals }">
            <v-checkbox-btn v-model="deleteWithDeals" density="compact" hide-details color="error" />
            <div>
              <div class="rg-bulk-choice-title">Удалить и сделки этого клиента</div>
              <div class="rg-bulk-choice-sub">
                {{ deleteWithDeals
                  ? 'Сделки уйдут в корзину — их можно восстановить. Доход по ним уйдёт из кассы.'
                  : 'Сейчас сделки останутся: имя и телефон в них сохранятся.' }}
              </div>
            </div>
          </label>
        </div>

        <div class="rg-dialog-actions">
          <button class="rg-btn rg-btn--ghost" @click="showDeleteDialog = false" :disabled="!!deleteLoading">
            Отмена
          </button>
          <button class="rg-btn rg-btn--danger" @click="doDelete" :disabled="!!deleteLoading">
            <v-progress-circular v-if="deleteLoading" indeterminate size="16" width="2" color="white" class="mr-2" />
            <v-icon v-else icon="mdi-delete-outline" size="16" class="mr-1" />
            Удалить
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Массовое удаление -->
    <v-dialog v-model="showBulkDeleteDialog" max-width="480" persistent :fullscreen="isMobile">
      <v-card rounded="lg">
        <div class="rg-dialog-header">
          <span class="rg-dialog-title">Удалить {{ selectedCount }} {{ pluralClients(selectedCount) }}?</span>
          <button class="rg-dialog-close" :disabled="bulkDeleting" @click="showBulkDeleteDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="pa-5">
          <div class="rg-dialog-warning mb-4">
            <v-icon icon="mdi-alert-circle-outline" size="20" class="mr-2" />
            Действие нельзя отменить.
          </div>

          <!-- Выбор: удалять ли сделки вместе с клиентами -->
          <label class="rg-bulk-choice" :class="{ 'rg-bulk-choice--on': bulkWithDeals }">
            <v-checkbox-btn v-model="bulkWithDeals" density="compact" hide-details color="error" />
            <div>
              <div class="rg-bulk-choice-title">Удалить и сделки этих клиентов</div>
              <div class="rg-bulk-choice-sub">
                Сделки отправятся в корзину — их можно восстановить. Доход по ним уйдёт
                из кассы и аналитики.
              </div>
            </div>
          </label>

          <div class="rg-bulk-facts mt-4">
            <template v-if="bulkWithDeals">
              <div class="rg-bulk-fact">
                <v-icon icon="mdi-delete-clock-outline" size="17" color="#ef4444" />
                <span>Все сделки этих клиентов, включая действующие, уйдут <b>в корзину</b></span>
              </div>
              <div class="rg-bulk-fact">
                <v-icon icon="mdi-restore" size="17" color="#10b981" />
                <span>Из корзины сделки можно вернуть, но карточки клиентов — уже нет</span>
              </div>
              <div class="rg-bulk-fact">
                <v-icon icon="mdi-shield-alert-outline" size="17" color="#f59e0b" />
                <span>
                  Поручители по действующим договорам, клиенты платформы и опубликованные
                  в глобальном реестре будут <b>пропущены</b>
                </span>
              </div>
            </template>
            <template v-else>
              <div class="rg-bulk-fact">
                <v-icon icon="mdi-check-circle-outline" size="17" color="#10b981" />
                <span>Сделки этих клиентов <b>останутся</b> — имя и телефон в них сохранятся</span>
              </div>
              <div class="rg-bulk-fact">
                <v-icon icon="mdi-shield-alert-outline" size="17" color="#f59e0b" />
                <span>
                  Клиенты с действующими сделками, поручители, клиенты платформы и
                  опубликованные в глобальном реестре будут <b>пропущены</b> — их удалить нельзя
                </span>
              </div>
            </template>
            <div class="rg-bulk-fact">
              <v-icon icon="mdi-close-circle-outline" size="17" color="#ef4444" />
              <span>Отзывы и записи чёрного списка по ним будут удалены</span>
            </div>
          </div>

          <div v-if="selectAllMatching" class="rg-bulk-scope mt-4">
            <v-icon icon="mdi-filter-outline" size="16" />
            <span>
              Выбрана вся текущая выборка<template v-if="search.trim()"> по запросу «{{ search.trim() }}»</template><template
                v-if="activeTab !== 'all'"
              >, вкладка «{{ tabs.find((t) => t.key === activeTab)?.label }}»</template><template
                v-if="clientTypeFilter !== 'all'"
              >, {{ clientTypeFilter === 'platform' ? 'на платформе' : 'внешние' }}</template>.
            </span>
          </div>
        </div>

        <div class="rg-dialog-actions">
          <button class="rg-btn rg-btn--ghost" :disabled="bulkDeleting" @click="showBulkDeleteDialog = false">
            Отмена
          </button>
          <button class="rg-btn rg-btn--danger" :disabled="bulkDeleting" @click="doBulkDelete">
            <v-progress-circular v-if="bulkDeleting" indeterminate size="16" width="2" color="white" class="mr-2" />
            <v-icon v-else icon="mdi-delete-outline" size="16" class="mr-1" />
            {{ bulkDeleting ? (bulkProgress ? `Удалено ${bulkProgress} из ${selectedCount}…` : 'Удаление…') : 'Удалить' }}
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* ── Page ── */
/* Ширину и отступы задаёт общий .at-page, как в остальных разделах: страница
   занимает всё доступное место, а не колонку в 1200 пикселей по центру.
   Снизу добавлен запас под прилипающую панель страниц. */
.rg-page {
  padding-bottom: 72px;
}
/* Панель страниц прилипает к низу — карточка списка не должна обрезать
   содержимое (так же сделано в сделках, платежах и должниках). */
.rg-list-card {
  overflow: visible;
}

/* ── Режим выбора ── */
/* Кнопка «Выбрать» отодвинута вправо от фильтров типа клиента. */
.rg-filter-spacer { flex: 1 1 auto; }

.rg-sel {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 8px 6px 10px; margin-bottom: 12px;
  border-radius: 10px;
  background: rgba(4, 120, 87, 0.07);
  border: 1px solid rgba(4, 120, 87, 0.18);
  font-size: 13px;
}
/* Счётчик и «выбрать все» держатся вплотную к галочке: это одна мысль —
   что выбрано и как выбрать больше, — а не три разрозненных элемента. */
.rg-sel :deep(.v-selection-control) { flex: 0 0 auto; min-height: 0; }
.rg-sel-count { font-weight: 600; white-space: nowrap; margin-left: -4px; }
.rg-sel-spacer { flex: 1 1 auto; }
/* Разделитель между счётчиком и действием — вместо пустого зазора. */
.rg-sel-dot { color: rgba(var(--v-theme-on-surface), 0.3); margin: 0 -4px; }
.rg-sel-link {
  background: none; border: none; padding: 0;
  color: #047857; font-size: 13px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
.rg-sel-link:hover { text-decoration: underline; }
.rg-sel-danger {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 8px;
  background: #ef4444; color: #fff;
  font-size: 13px; font-weight: 600;
  border: none; cursor: pointer; white-space: nowrap;
}
.rg-sel-danger:hover { background: #dc2626; }
.rg-sel-danger:disabled { opacity: 0.6; cursor: default; }
.rg-sel-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 8px;
  background: none; border: none; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.rg-sel-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.8);
}

/* Галочка в карточке — слева от аватара, без сдвига остальной вёрстки. */
.rg-pick { flex: 0 0 auto; margin-right: -4px; }
/* Отмеченная карточка подсвечивается — видно выбор, не вглядываясь в галочки. */
.rg-card--picked {
  border-color: rgba(4, 120, 87, 0.45) !important;
  background: rgba(4, 120, 87, 0.045);
}

/* Выбор «удалить и сделки» — отдельным блоком: последствия совсем другие,
   мимо него взгляд проскочить не должен. */
.rg-bulk-choice {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 10px 12px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  cursor: pointer; transition: all 0.15s;
}
.rg-bulk-choice--on {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.05);
}
.rg-bulk-choice-title { font-size: 13.5px; font-weight: 600; margin-top: 3px; }
.rg-bulk-choice-sub {
  font-size: 12.5px; line-height: 1.4; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* Пояснения в окне подтверждения */
.rg-bulk-facts { display: flex; flex-direction: column; gap: 10px; font-size: 13.5px; line-height: 1.45; }
.rg-bulk-fact { display: flex; align-items: flex-start; gap: 8px; }
.rg-bulk-scope {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7);
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
  color: rgba(255, 255, 255, 0.85);
  /* Otherwise the icon swallows clicks meant for the underlying input,
     and users wonder why focus jumps but the caret doesn't go where
     they tapped. */
  pointer-events: none;
  z-index: 1;
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
.rg-public-badge {
  display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 4px;
  background: rgba(59, 130, 246, 0.1); color: #3b82f6;
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
.rg-btn--success {
  background: #3b82f6;
  color: #fff;
}
.rg-btn--success:hover:not(:disabled) {
  background: #2563eb;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
}
.rg-btn--danger {
  background: #ef4444;
  color: #fff;
}
.rg-btn--danger:hover:not(:disabled) {
  background: #dc2626;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
}
.rg-btn--outline {
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
}
.rg-btn--outline:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.85);
  border-color: rgba(var(--v-theme-on-surface), 0.25);
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

/* ── Mobile ── */
@media (max-width: 768px) {
  /* Hero */
  .rg-hero {
    padding: 20px 18px;
    margin-bottom: 16px;
    border-radius: 14px;
  }
  .rg-hero::before { width: 220px; height: 220px; }
  .rg-hero::after { width: 180px; height: 180px; }
  .rg-hero-title { font-size: 18px; margin-bottom: 4px; }
  .rg-hero-subtitle { font-size: 12.5px; margin-bottom: 14px; line-height: 1.4; }
  .rg-search-input {
    padding: 12px 42px 12px 42px;
    font-size: 14px;
    border-radius: 10px;
  }
  .rg-search-icon { left: 12px; }
  .rg-search-spinner { right: 12px; }

  /* Mode switch — full-width, 2 кнопки на всю ширину */
  .rg-mode-switch {
    width: 100%;
    gap: 4px;
  }
  .rg-mode-btn {
    flex: 1;
    justify-content: center;
    padding: 0 10px;
    font-size: 12.5px;
    height: 36px;
    gap: 5px;
  }
  .rg-mode-btn .v-icon { font-size: 16px !important; }
  .rg-mode-count { min-width: 16px; height: 16px; font-size: 10px; padding: 0 4px; }

  /* Stats row */
  .stats-row { grid-template-columns: 1fr; gap: 8px; }
  .stat-card { padding: 12px 14px; gap: 12px; }
  .stat-icon { width: 36px; height: 36px; min-width: 36px; border-radius: 9px; }
  .stat-value { font-size: 17px; }
  .stat-label { font-size: 11px; }

  /* Tabs (status filter) */
  .rg-tabs {
    flex-wrap: nowrap;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .rg-tabs::-webkit-scrollbar { display: none; }
  .rg-tab { padding: 7px 12px; font-size: 12.5px; }

  /* Type filter (platform/external) */
  .rg-type-filter {
    overflow-x: auto;
    flex-wrap: nowrap;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .rg-type-filter::-webkit-scrollbar { display: none; }
  .rg-type-btn { flex-shrink: 0; padding: 7px 11px; font-size: 11.5px; }

  /* Card header */
  .rg-header { padding: 12px 14px; gap: 10px; }
  .rg-avatar { width: 40px; height: 40px; min-width: 40px; border-radius: 11px; font-size: 14px; }
  .rg-name { font-size: 14px; }
  .rg-meta { font-size: 12px; line-height: 1.4; }
  .rg-status-badge { font-size: 10px; padding: 2px 7px; }

  /* Expanded section — компактнее */
  .rg-expanded { padding: 0 14px 14px; }
  .rg-stats-mobile { gap: 6px; margin: 12px 0; }
  .rg-stat-m { padding: 8px 10px; }
  .rg-stat-m-label { font-size: 10.5px; }
  .rg-stat-m-value { font-size: 13.5px; }

  .rg-detail-section { margin-top: 12px; }
  .rg-section-title { font-size: 12px; margin-bottom: 8px; }
  .rg-detail-grid { gap: 6px; }
  .rg-detail-item { padding: 8px 10px; }
  .rg-detail-label { font-size: 10.5px; }
  .rg-detail-value { font-size: 14px; }

  .rg-bl-reason { padding: 10px 12px; font-size: 12.5px; }

  /* Hints / disclaimers */
  .rg-disclaimer { padding: 10px 12px; gap: 8px; }
  .rg-disclaimer-title { font-size: 12px; }
  .rg-disclaimer-text { font-size: 11.5px; line-height: 1.4; }
  .rg-global-hint { padding: 10px 12px; font-size: 12px; gap: 8px; }

  /* Empty state */
  .rg-empty { padding: 32px 16px; }
  .rg-empty-icon { width: 64px; height: 64px; margin-bottom: 12px; }
  .rg-empty-title { font-size: 16px; }
  .rg-empty-subtitle { font-size: 13px; }
}

/* Очень узкие экраны (<480px) — ещё компактнее */
@media (max-width: 480px) {
  .rg-hero { padding: 16px 14px; }
  .rg-hero-title { font-size: 16px; }
  .rg-hero-subtitle { display: none; }

  .rg-mode-btn span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .rg-stats-mobile { grid-template-columns: repeat(2, 1fr); }
  .rg-detail-grid { grid-template-columns: 1fr; }
}
</style>
