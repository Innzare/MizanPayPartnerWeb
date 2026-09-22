<script lang="ts" setup>
import SearchInput from '@/components/SearchInput.vue'
import { useAuthStore } from '@/stores/auth'
import { useClientProfilesStore } from '@/stores/clientProfiles'
import { formatCurrency, formatDate, formatDateShort, formatPercent, formatPhone, timeAgo } from '@/utils/formatters'
import { type ClientProfile, userName, clientProfileName } from '@/types'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api/client'
import ServerPager from '@/components/ServerPager.vue'
import { useAutoLoad } from '@/composables/useAutoLoad'
import { useTableColumns, type TableColumn } from '@/composables/useTableColumns'
import { PER_PAGE_OPTIONS, useListSort, usePageSize } from '@/composables/useListPrefs'
import { useVirtualRows } from '@/composables/useVirtualRows'
import { useIsDark } from '@/composables/useIsDark'
import { useClientCities } from '@/composables/useClientCities'
import { useToast } from '@/composables/useToast'
import { useSections } from '@/composables/useSections'
import { useClientsFilters } from '@/composables/useClientsFilters'
import ClientsFilterPanel from '@/components/ClientsFilterPanel.vue'
import GuarantorsPanel from '@/components/guarantors/GuarantorsPanel.vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

/**
 * Вкладки раздела: клиенты и поручители.
 *
 * Поручитель — тот же человек из справочника клиентов, поэтому отдельного
 * раздела у него больше нет. Вкладка живёт в адресе (?tab=guarantors): ссылку
 * можно отправить коллеге, а обновление страницы не сбрасывает выбор.
 */
type ClientsTab = 'clients' | 'guarantors'
const canSeeGuarantors = computed(() => authStore.can('guarantors.view'))
const tab = ref<ClientsTab>(
  route.query.tab === 'guarantors' && canSeeGuarantors.value ? 'guarantors' : 'clients',
)
watch(tab, v => {
  const query = { ...route.query }
  if (v === 'guarantors') query.tab = 'guarantors'
  else delete query.tab
  router.replace({ query })
})
const { isDark } = useIsDark()
const toast = useToast()
const sections = useSections()

// Reactive mobile flag для fullscreen-диалога деталей сделки.
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
function updateMobile() { isMobile.value = window.innerWidth < 768 }
onMounted(() => window.addEventListener('resize', updateMobile))
onUnmounted(() => window.removeEventListener('resize', updateMobile))

// ══════════════════════════════════════════════════════════════════
// Серверный список клиентов
//
// Раньше страница выкачивала весь портфель, все платежи и все профили и
// группировала клиентов в браузере. Теперь группирует сервер — тем же ключом,
// что фильтрует сделки клиента, поэтому счётчик в карточке всегда совпадает с
// её содержимым.
// ══════════════════════════════════════════════════════════════════

/** Строка списка в том же виде, что раньше собирал стор. */
interface ClientRow {
  key: string
  clientProfileId: string | null
  userId: string | null
  firstName: string
  lastName: string
  phone: string | null
  city: string | null
  rating: number
  hasPassport: boolean
  isExternal: boolean
  dealCount: number
  activeDealCount: number
  totalVolume: number
  totalProfit: number
  remaining: number
  onTimeRate: number
  nextPaymentDate: string | null
  completedDealCount: number
  overdueCount: number
  overdueAmount: number
  lastDealDate: string | null
}

// Размер страницы партнёр выбирает сам — как в остальных списках.
const perPage = usePageSize('clients:page-size')
const rows = ref<ClientRow[]>([])
const total = ref(0)
const totalsAgg = ref<{ count: number; totalVolume: number; totalProfit: number; totalRemaining: number } | null>(null)
const listLoading = ref(false)
const page = ref(1)
const search = ref('')
const debouncedSearch = ref('')
// Защита от гонок: партнёр печатает быстрее, чем отвечает сеть.
let listReq = 0

const pageLoading = ref(true)

/** Фильтр по городу: значения — фактические города клиентов партнёра. */
const filterCity = ref<string | null>(null)
const { cities: clientCities } = useClientCities()
const cityOptions = computed(() =>
  clientCities.value.map((c) => ({ title: `${c.city} (${c.count})`, value: c.city })),
)

/** @param append дописать порцию (автоподгрузка), а не заменить список. */
// ── Расширенные фильтры ──
// Та же панель, что в остальных списках. Условия здесь про состояние
// договоров человека.
const filtersOpen = ref(false)
const filters = useClientsFilters()

watch(
  () => filters.query.value,
  () => { page.value = 1; loadClients() },
  { deep: true },
)

async function loadClients(append = false) {
  const cur = ++listReq
  listLoading.value = true
  try {
    const qs = new URLSearchParams({
      limit: String(perPage.value),
      offset: String(append ? rows.value.length : (page.value - 1) * perPage.value),
      // Сортировка считается на сервере: список постраничный, и порядок
      // «того, что уже загружено» разъезжался бы между страницами.
      sort: sortCol.value,
      dir: sortDir.value,
    })
    if (debouncedSearch.value.trim()) qs.set('q', debouncedSearch.value.trim())
    if (filterCity.value) qs.set('city', filterCity.value)
    for (const [k, v] of Object.entries(filters.query.value)) qs.set(k, String(v))

    const res = await api.get<{
      items: any[]
      total: number
      totals: { count: number; totalVolume: number; totalProfit: number; totalRemaining: number }
    }>(`/client-profiles/summary?${qs.toString()}`)
    if (cur !== listReq) return

    const mapped = res.items.map((r) => ({
      key: r.key,
      clientProfileId: r.clientProfileId ?? null,
      userId: r.userId ?? null,
      // Имя: платформенное → реестровое → внешнее из импорта.
      //
      // Внешнее имя НЕ разбираем на части: это произвольная строка из файла
      // импорта. Разбор по пробелу переставлял «Магомедов Магомед
      // Магомедович» в «Магомед Магомедов» (отчество терялось), а
      // односложное имя оставляло аватар без первой буквы.
      firstName: r.firstName ?? (r.externalName ? String(r.externalName).trim() : ''),
      lastName: r.lastName ?? '',
      phone: r.phone ?? null,
      city: r.city ?? null,
      rating: r.rating ?? 0,
      hasPassport: !!r.hasPassport,
      // Внешний — тот, кого нет на платформе.
      isExternal: !r.userId,
      dealCount: r.dealCount,
      activeDealCount: r.activeDealCount,
      completedDealCount: r.completedDealCount ?? 0,
      overdueCount: r.overdueCount ?? 0,
      overdueAmount: r.overdueAmount ?? 0,
      lastDealDate: r.lastDealDate ?? null,
      totalVolume: r.totalVolume,
      totalProfit: r.totalProfit,
      remaining: r.remaining,
      onTimeRate: r.onTimeRate,
      nextPaymentDate: r.nextPaymentDate ?? null,
    }))
    if (append) {
      // Дубли по ключу клиента: между запросами выборка могла сдвинуться.
      const seen = new Set(rows.value.map((c) => c.key))
      rows.value = [...rows.value, ...mapped.filter((c) => !seen.has(c.key))]
    } else {
      rows.value = mapped
    }
    total.value = res.total
    totalsAgg.value = res.totals
  } catch (e: any) {
    if (cur !== listReq) return
    toast.error(e?.message || 'Не удалось загрузить клиентов')
  } finally {
    if (cur === listReq) listLoading.value = false
  }
}

// Поиск с задержкой: без неё каждый символ уходил бы запросом.
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedSearch.value = v
    page.value = 1
  }, 350)
})

watch(filterCity, () => { page.value = 1 })
onMounted(async () => {
  try {
    await loadClients()
  } finally {
    pageLoading.value = false
  }
})

function goToClientProfile(client: ClientRow) {
  if (client.clientProfileId) router.push(`/clients/${client.clientProfileId}`)
}

function hasClientProfile(client: ClientRow): boolean {
  return !!client.clientProfileId
}

// ── Действия прямо в карточке клиента ──
// Раньше, чтобы написать клиенту или завести ему сделку, приходилось сначала
// открывать его страницу.

/** Право заводить сделки — без него кнопку не показываем. */
const canCreateDeal = computed(() => authStore.can('deals.create'))

function writeWhatsApp(client: ClientRow, e?: Event) {
  e?.stopPropagation()
  const digits = (client.phone || '').replace(/\D/g, '')
  if (digits) router.push(`/broadcasts?chat=${digits}`)
}

/** Новая сделка с уже подставленным клиентом. */
function createDealFor(client: ClientRow, e?: Event) {
  e?.stopPropagation()
  const q = client.clientProfileId ? `?clientProfileId=${client.clientProfileId}` : ''
  router.push(`/create-deal${q}`)
}


// Deal dialog

/** Поиск серверный — список уже отфильтрован. */
const filteredClients = computed(() => rows.value)

// ── Автоподгрузка ────────────────────────────────────────────────────
const hasMore = computed(() => rows.value.length < total.value)

// Виртуализация: у крупного партнёра клиентов под девять тысяч, а строка —
// это полтора десятка ячеек.
const tableViewport = ref<HTMLElement | null>(null)
const virtual = useVirtualRows(filteredClients, {
  viewport: tableViewport,
  estimatedRowHeight: 56,
})
const markerRow = virtual.markerRow

const autoLoad = useAutoLoad({
  storageKey: 'clients:auto-load',
  hasMore,
  busy: listLoading,
  loadMore: () => loadClients(true),
})
/** Метка конца списка — её отслеживает автоподгрузка. */
const autoLoadSentinel = autoLoad.sentinel

// Переключение режима возвращает к началу выборки.
watch(
  () => autoLoad.enabled.value,
  () => {
    autoLoad.reset()
    if (page.value !== 1) page.value = 1
    else loadClients()
  },
)

// Итоги по ВСЕЙ выборке, а не по странице.
const stats = computed(() => ({
  count: totalsAgg.value?.count ?? 0,
  totalVolume: totalsAgg.value?.totalVolume ?? 0,
  totalProfit: totalsAgg.value?.totalProfit ?? 0,
  totalRemaining: totalsAgg.value?.totalRemaining ?? 0,
  avgOnTime: rows.value.length
    ? Math.round(rows.value.reduce((s, c) => s + c.onTimeRate, 0) / rows.value.length)
    : 0,
}))

// ── Колонки таблицы ───────────────────────────────────────────────────
// Тот же механизм, что в сделках и должниках: состав, порядок и наборы
// колонок партнёр настраивает под себя, всё хранится в браузере.

type ColGroup = 'client' | 'deals' | 'money' | 'discipline'

const COLUMN_GROUPS: { key: ColGroup; label: string }[] = [
  { key: 'client', label: 'Клиент' },
  { key: 'deals', label: 'Сделки' },
  { key: 'money', label: 'Деньги' },
  { key: 'discipline', label: 'Платёжная дисциплина' },
]

const ALL_COLUMNS: TableColumn<ColGroup>[] = [
  // ── Клиент ──
  // Телефон идёт подписью под именем: отдельная колонка под него занимала
  // место, а читаются они всё равно вместе.
  { key: 'client', label: 'Клиент', align: 'start', sortable: true, group: 'client', tdStyle: 'min-width: 230px;' },
  { key: 'city', label: 'Город', align: 'start', sortable: false, group: 'client', tdClass: 'text-no-wrap' },
  { key: 'passport', label: 'Паспорт', align: 'center', sortable: false, group: 'client', tdClass: 'text-center text-no-wrap' },

  // ── Сделки ──
  { key: 'dealCount', label: 'Всего сделок', align: 'center', sortable: true, group: 'deals', tdClass: 'text-center text-no-wrap' },
  { key: 'activeDeals', label: 'Действующих', align: 'center', sortable: true, group: 'deals', tdClass: 'text-center text-no-wrap' },
  { key: 'completedDeals', label: 'Закрытых', align: 'center', sortable: true, group: 'deals', tdClass: 'text-center text-no-wrap' },
  { key: 'lastDeal', label: 'Последняя сделка', align: 'end', sortable: true, group: 'deals', tdClass: 'text-end text-no-wrap' },

  // ── Деньги ──
  { key: 'volume', label: 'Объём договоров', align: 'end', sortable: true, group: 'money', tdClass: 'text-end text-no-wrap' },
  { key: 'profit', label: 'Заработано', align: 'end', sortable: true, group: 'money', tdClass: 'text-end text-no-wrap' },
  { key: 'remaining', label: 'Остаток долга', align: 'end', sortable: true, group: 'money', tdClass: 'text-end text-no-wrap' },

  // ── Дисциплина ──
  { key: 'overdueAmount', label: 'Сумма просрочки', align: 'end', sortable: true, group: 'discipline', tdClass: 'text-end text-no-wrap font-weight-bold' },
  { key: 'overdueCount', label: 'Просрочек', align: 'center', sortable: false, group: 'discipline', tdClass: 'text-center text-no-wrap' },
  { key: 'nextPayment', label: 'Следующий платёж', align: 'end', sortable: true, group: 'discipline', tdClass: 'text-end text-no-wrap' },
]

const COLUMN_PRESETS = [
  { key: 'min', label: 'Минимум', columns: ['client', 'dealCount', 'activeDeals', 'remaining'] },
  { key: 'calls', label: 'Для обзвона', columns: ['client', 'city', 'overdueAmount', 'overdueCount', 'nextPayment'] },
  { key: 'money', label: 'Деньги', columns: ['client', 'volume', 'profit', 'remaining', 'overdueAmount'] },
  { key: 'trust', label: 'Надёжность', columns: ['client', 'dealCount', 'completedDeals', 'overdueCount', 'overdueAmount', 'lastDeal'] },
  { key: 'full', label: 'Полный', columns: ALL_COLUMNS.map((c) => c.key) },
]

const cols = useTableColumns<ColGroup>({
  storageKey: 'clients',
  columns: ALL_COLUMNS,
  defaultVisible: ['client', 'dealCount', 'activeDeals', 'profit', 'remaining', 'overdueAmount', 'nextPayment'],
  groups: COLUMN_GROUPS,
  presets: COLUMN_PRESETS,
})
const shownColumns = cols.shownColumns

/** Колонок в строке — с учётом номера и колонки действий. */
const columnCount = computed(() => shownColumns.value.length + 2)

// ── Сортировка ──
// Считается на сервере: список постраничный, и сортировать «то, что уже
// загружено» означало бы разный порядок на разных страницах.
const TEXT_COLS = new Set(['client'])
const { col: sortCol, dir: sortDir } = useListSort<string>('clients:table-sort', 'activeDeals')

function toggleSort(key: string) {
  if (cols.wasDragged()) return
  if (sortCol.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortCol.value = key
    sortDir.value = TEXT_COLS.has(key) ? 'asc' : 'desc'
  }
}

// Сортировка и размер страницы считаются на сервере — при их смене список
// перечитывается целиком, а не переупорядочивается в браузере.
watch([page, debouncedSearch, filterCity, sortCol, sortDir, perPage], ([p], [prevPage]) => {
  // Смена сортировки или размера страницы возвращает к началу выборки:
  // иначе «страница 7» показывала бы строки из другого порядка.
  if (p === prevPage && page.value !== 1) {
    page.value = 1
    return
  }
  loadClients()
})

function getScoreColor(rate: number) {
  if (rate >= 90) return '#047857'
  if (rate >= 70) return '#f59e0b'
  return '#ef4444'
}

function getScoreBg(rate: number) {
  if (rate >= 90) return 'rgba(4, 120, 87, 0.1)'
  if (rate >= 70) return 'rgba(245, 158, 11, 0.1)'
  return 'rgba(239, 68, 68, 0.1)'
}

const AVATAR_COLORS = ['#047857', '#3b82f6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ef4444']
function getAvatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}


</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
    <!-- Поручители показываются здесь же вкладкой: свой раздел им не нужен.
         Табы раздела — общий стиль, см. styles/page-tabs.css -->
    <div v-if="canSeeGuarantors" class="page-tabs">
      <button class="page-tab" :class="{ active: tab === 'clients' }" @click="tab = 'clients'">
        <v-icon icon="mdi-account-group" size="18" />
        <span>Клиенты</span>
        <span v-if="stats.count" class="page-tab-count">{{ stats.count }}</span>
      </button>
      <button class="page-tab" :class="{ active: tab === 'guarantors' }" @click="tab = 'guarantors'">
        <v-icon icon="mdi-account-check-outline" size="18" />
        <span>Поручители</span>
      </button>
    </div>

    <GuarantorsPanel v-if="tab === 'guarantors'" />

    <template v-else>
    <!-- KPI Cards — скрываются у ролей без права clients.kpi -->
    <div v-if="authStore.can('clients.kpi')" class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-account-group" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.count }}</div>
          <div class="stat-label">Клиентов</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
          <v-icon icon="mdi-cash-multiple" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(stats.totalVolume) }}</div>
          <div class="stat-label">Общий объём</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
          <v-icon icon="mdi-trending-up" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(stats.totalProfit) }}</div>
          <div class="stat-label">Прибыль</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" :style="{ background: getScoreBg(stats.avgOnTime), color: getScoreColor(stats.avgOnTime) }">
          <v-icon icon="mdi-heart-pulse" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.avgOnTime }}%</div>
          <div class="stat-label">Ср. своевременность</div>
        </div>
      </div>
    </div>

    <!-- Hint -->
    <div class="clients-hint">
      <v-icon icon="mdi-information-outline" size="18" />
      <div>
        Здесь отображаются только клиенты с активными или завершёнными сделками.
        Для полного списка перейдите в
        <router-link to="/registry" class="clients-hint-link">реестр клиентов</router-link>.
      </div>
    </div>

    <!-- Main card -->
    <v-card rounded="lg" elevation="0" border class="clients-card">
      <div class="pa-4">
        <!-- Search -->
        <div class="clients-search-row">
          <!-- Настройка колонок — тот же механизм, что в сделках и должниках. -->
          <v-menu :close-on-content-click="false" location="bottom start">
            <template #activator="{ props: menuProps }">
              <button class="clients-filter-btn" v-bind="menuProps" title="Колонки таблицы">
                <v-icon icon="mdi-table-cog" size="16" />
                <span class="d-none d-sm-inline">Колонки</span>
              </button>
            </template>
            <div class="col-menu">
              <div class="col-menu-head">
                <span class="col-menu-title">Колонки таблицы</span>
                <button class="col-menu-reset" @click="cols.resetColumns">Сбросить</button>
              </div>

              <!-- Готовые наборы под частые задачи. -->
              <div class="col-menu-presets">
                <button
                  v-for="p in cols.presets"
                  :key="p.key"
                  type="button"
                  class="col-menu-preset"
                  @click="cols.applyPreset(p)"
                >{{ p.label }}</button>
              </div>

              <!-- Свои наборы: сохранённый состав и порядок колонок. -->
              <div v-if="cols.savedPresets.value.length" class="col-menu-presets col-menu-presets--own">
                <span v-for="p in cols.savedPresets.value" :key="p.id" class="col-menu-own">
                  <button type="button" class="col-menu-own-apply" @click="cols.applySavedPreset(p)">
                    {{ p.name }}
                  </button>
                  <button type="button" class="col-menu-own-del" title="Удалить набор" @click="cols.removePreset(p)">
                    <v-icon icon="mdi-close" size="11" />
                  </button>
                </span>
              </div>

              <div class="col-menu-save">
                <input
                  v-model="cols.presetName.value"
                  type="text"
                  placeholder="Сохранить набор как…"
                  @keyup.enter="cols.savePreset"
                />
                <button :disabled="!cols.presetName.value.trim()" @click="cols.savePreset">Сохранить</button>
              </div>

              <div class="col-menu-search">
                <v-icon icon="mdi-magnify" size="15" />
                <input v-model="cols.colSearch.value" type="text" placeholder="Найти колонку" />
                <button v-if="cols.colSearch.value" class="col-menu-search-clear" @click="cols.colSearch.value = ''">
                  <v-icon icon="mdi-close" size="13" />
                </button>
              </div>

              <div class="col-menu-hint">
                Потяните за <v-icon icon="mdi-drag-horizontal-variant" size="13" />, чтобы поменять порядок
              </div>

              <div v-for="g in cols.menuGroups.value" :key="g.key" class="col-menu-group">
                <div class="col-menu-group-title">{{ g.label }}</div>
                <div
                  v-for="c in g.columns"
                  :key="c.key"
                  class="col-menu-item"
                  :class="{ 'col-menu-item--dragging': cols.dragColKey.value === c.key }"
                  draggable="true"
                  @dragstart="cols.onColDragStart(c.key, $event)"
                  @dragover="cols.onColDragOver(c.key, $event)"
                  @dragend="cols.onColDragEnd"
                  @drop.prevent="cols.onColDragEnd"
                >
                  <v-icon icon="mdi-drag-horizontal-variant" size="16" class="col-menu-grip" />
                  <label class="col-menu-label">
                    <input type="checkbox" :checked="cols.isColVisible(c.key)" @change="cols.toggleColumn(c.key)" />
                    <span>{{ c.label }}</span>
                  </label>
                </div>
              </div>

              <div v-if="!cols.menuGroups.value.length" class="col-menu-empty">Ничего не найдено</div>
            </div>
          </v-menu>

          <SearchInput v-model="search" placeholder="Поиск по имени, городу, адресу, телефону..." class="clients-search-input" />
          <!-- Фильтр по городу: список наполняется фактическими городами
               партнёра, поэтому пустых пунктов в нём не бывает. -->
          <v-select
            v-if="cityOptions.length"
            v-model="filterCity"
            :items="cityOptions"
            item-title="title"
            item-value="value"
            label="Город"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            class="clients-city-filter"
            prepend-inner-icon="mdi-city-variant-outline"
          />
          <!-- Расширенные фильтры: состояние договоров, товар, город. -->
          <button
            class="clients-filter-btn"
            :class="{ 'clients-filter-btn--active': filters.hasAny.value }"
            @click="filtersOpen = true"
          >
            <v-icon icon="mdi-filter-variant" size="16" />
            Фильтры
            <span v-if="filters.activeCount.value" class="clients-filter-count">
              {{ filters.activeCount.value }}
            </span>
          </button>

        </div>

        <!-- Плашки включённых фильтров. -->
        <div v-if="filters.chips.value.length" class="active-filters">
          <button
            v-for="chip in filters.chips.value"
            :key="chip.key"
            type="button"
            class="af-chip"
            @click="chip.clear()"
          >
            <span>{{ chip.label }}</span>
            <v-icon icon="mdi-close" size="13" />
          </button>
          <button type="button" class="af-clear" @click="filters.reset()">Сбросить всё</button>
        </div>

        <!-- Таблица клиентов -->
        <!-- Обёртка для виртуализации: от её положения отсчитывается список. -->
        <div v-if="filteredClients.length" ref="tableViewport">
        <v-table density="default" hover class="at-table clients-table">
          <thead>
            <tr>
              <th class="th-index">№</th>
              <th
                v-for="c in shownColumns"
                :key="c.key"
                :class="[
                  c.align === 'end' ? 'text-end' : c.align === 'center' ? 'text-center' : 'text-start',
                  { 'th-sortable': c.sortable, 'th-sorted': sortCol === c.key, 'th-dragging': cols.dragColKey.value === c.key },
                ]"
                draggable="true"
                @click="c.sortable && toggleSort(c.key)"
                @dragstart="cols.onColDragStart(c.key, $event)"
                @dragover="cols.onColDragOver(c.key, $event)"
                @dragend="cols.onColDragEnd"
                @drop.prevent="cols.onColDragEnd"
              >
                <span class="th-inner">
                  {{ c.label }}
                  <v-icon
                    v-if="c.sortable"
                    :icon="sortCol === c.key ? (sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down') : 'mdi-unfold-more-horizontal'"
                    size="14"
                    class="th-sort-ico"
                  />
                </span>
              </th>
              <th class="text-end col-actions">Действия</th>
            </tr>
          </thead>

          <tbody>
            <!-- Верхняя распорка: место строк выше экрана и точка отсчёта списка. -->
            <tr ref="markerRow" class="virtual-pad" aria-hidden="true">
              <td :colspan="columnCount"><div :style="{ height: virtual.padTop.value + 'px' }" /></td>
            </tr>

            <tr
              v-for="(client, idx) in virtual.visibleRows.value"
              :key="client.key"
              :ref="virtual.rowRef(virtual.offset.value + idx)"
              data-virtual-row
              class="cursor-pointer"
              @click="goToClientProfile(client)"
            >
              <td class="td-index text-medium-emphasis">
                {{ (page - 1) * perPage + virtual.offset.value + idx + 1 }}
              </td>

              <td v-for="c in shownColumns" :key="c.key" :class="c.tdClass" :style="c.tdStyle">
                <template v-if="c.key === 'client'">
                  <div class="cl-name-cell">
                    <div
                      class="cl-avatar"
                      :style="{ background: client.isExternal ? '#6366f1' : getAvatarColor(client.firstName) }"
                    >
                      {{ (client.firstName || '?')[0] }}{{ (client.lastName || '')[0] }}
                    </div>
                    <div class="cl-name-main">
                      <div class="cl-name">{{ client.firstName }} {{ client.lastName }}</div>
                      <div v-if="client.phone" class="cl-name-sub">
                        {{ formatPhone(client.phone) }}
                        <button
                          v-if="sections.visible('whatsapp')"
                          class="td-phone-wa"
                          title="Написать в WhatsApp"
                          @click.stop="writeWhatsApp(client, $event)"
                        >
                          <v-icon icon="mdi-whatsapp" size="12" />
                        </button>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else-if="c.key === 'city'">{{ client.city || '—' }}</template>

                <template v-else-if="c.key === 'passport'">
                  <span
                    v-if="hasClientProfile(client)"
                    class="passport-badge"
                    :class="client.hasPassport ? 'passport-badge--ok' : 'passport-badge--warn'"
                  >
                    <v-icon :icon="client.hasPassport ? 'mdi-card-account-details-outline' : 'mdi-alert-circle-outline'" size="11" />
                    {{ client.hasPassport ? 'Есть' : 'Нет' }}
                  </span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <template v-else-if="c.key === 'dealCount'">{{ client.dealCount }}</template>
                <template v-else-if="c.key === 'activeDeals'">
                  <span :class="{ 'font-weight-medium': client.activeDealCount > 0 }">
                    {{ client.activeDealCount }}
                  </span>
                </template>
                <template v-else-if="c.key === 'completedDeals'">{{ client.completedDealCount }}</template>
                <template v-else-if="c.key === 'lastDeal'">
                  {{ client.lastDealDate ? formatDate(client.lastDealDate) : '—' }}
                </template>

                <template v-else-if="c.key === 'volume'">{{ formatCurrency(client.totalVolume) }}</template>
                <template v-else-if="c.key === 'profit'">
                  <span class="cl-profit">{{ formatCurrency(client.totalProfit) }}</span>
                </template>
                <template v-else-if="c.key === 'remaining'">
                  <span :class="{ 'cl-remaining': client.remaining > 0 }">
                    {{ client.remaining > 0 ? formatCurrency(client.remaining) : '—' }}
                  </span>
                </template>

                <template v-else-if="c.key === 'overdueAmount'">
                  <span v-if="client.overdueAmount > 0" class="cl-overdue">
                    {{ formatCurrency(client.overdueAmount) }}
                  </span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>
                <template v-else-if="c.key === 'overdueCount'">
                  <span v-if="client.overdueCount > 0" class="cl-overdue">{{ client.overdueCount }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <template v-else-if="c.key === 'nextPayment'">
                  {{ client.nextPaymentDate ? formatDate(client.nextPaymentDate) : '—' }}
                </template>
              </td>

              <td class="text-end col-actions" @click.stop>
                <div class="row-actions">
                  <button
                    v-if="canCreateDeal"
                    class="row-action-btn row-action-btn--success"
                    title="Новая сделка для этого клиента"
                    @click="createDealFor(client, $event)"
                  >
                    <v-icon icon="mdi-plus-box-outline" size="17" />
                  </button>
                  <button
                    v-if="hasClientProfile(client)"
                    class="row-action-btn"
                    title="Открыть карточку клиента"
                    @click="goToClientProfile(client)"
                  >
                    <v-icon icon="mdi-open-in-new" size="16" />
                  </button>
                </div>
              </td>
            </tr>

            <tr class="virtual-pad" aria-hidden="true">
              <td :colspan="columnCount"><div :style="{ height: virtual.padBottom.value + 'px' }" /></td>
            </tr>
          </tbody>
        </v-table>
        </div>

        <!-- Empty state -->
        <div v-else-if="!listLoading" class="text-center pa-12">
          <v-icon icon="mdi-account-group-outline" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Нет клиентов</p>
          <p class="text-body-2 text-medium-emphasis">
            {{ search ? 'Попробуйте изменить параметры поиска' : 'Клиенты появятся после создания сделок' }}
          </p>
        </div>

        <!-- Пагинация серверного списка. -->
        <!-- Метка конца списка для автоподгрузки. -->
        <div v-if="autoLoad.enabled.value" ref="autoLoadSentinel" class="auto-load-sentinel" />

        <ServerPager
          :page="page"
          :total="total"
          :per-page="perPage"
          :busy="listLoading"
          :per-page-options="PER_PAGE_OPTIONS"
          :auto-load="autoLoad.enabled.value"
          :loaded="rows.length"
          :has-more="hasMore"
          @update:page="page = $event"
          @update:per-page="perPage = $event"
          @update:auto-load="autoLoad.enabled.value = $event"
          @load-more="autoLoad.loadMoreManually()"
        />

      </div>
    </v-card>

    </template>
    </template>
  </div>

    <!-- Панель расширенных фильтров -->
    <ClientsFilterPanel
      v-model="filtersOpen"
      :state="filters.state.value"
      :active-count="filters.activeCount.value"
      :presets="filters.saved.value"
      @reset="filters.reset()"
      @save-preset="filters.savePreset($event)"
      @apply-preset="filters.applyPresetSaved($event)"
      @remove-preset="filters.removePreset($event)"
    />

</template>

<style scoped>

/* ── Таблица клиентов ───────────────────────────────────────────────── */

.clients-table :deep(tbody tr) { transition: background 0.12s; }
/* Заголовки той же насыщенности, что в таблице поручителей. */
.clients-table :deep(thead th) { font-weight: 600 !important; }

/* Строки плотнее, чем по умолчанию: под именем идёт телефон, и при обычной
   высоте строка вырастала вдвое — на экран помещалось вдвое меньше людей. */
.clients-table :deep(tbody td) {
  height: auto !important;
  padding-top: 6px !important;
  padding-bottom: 6px !important;
}

.cl-name-cell { display: flex; align-items: center; gap: 9px; }
.cl-avatar {
  width: 28px; height: 28px; min-width: 28px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase;
}
.cl-name-main { min-width: 0; line-height: 1.25; }
.cl-name { font-weight: 500; white-space: nowrap; }
.cl-name-sub {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); white-space: nowrap;
}
.cl-profit { color: #047857; }
.cl-remaining { color: #f59e0b; }
.cl-overdue { color: #ef4444; font-weight: 600; }

.cl-score {
  display: inline-flex; align-items: center; padding: 2px 8px;
  border-radius: 6px; font-size: 12.5px; font-weight: 600;
}

/* Распорки виртуализации — см. пояснение в разделе сделок: высоту задаёт
   блок внутри ячейки, собственную высоту и анимацию ячейки снимаем. */
/* Распорки виртуализации: держат место неотрисованных строк и сами строкой
   выглядеть не должны. Селектор перекрывает компактные отступы выше — иначе
   пустая распорка занимала двенадцать пикселей и подсвечивалась под курсором,
   как настоящая строка. */
.clients-table :deep(tbody tr.virtual-pad td) {
  height: 0 !important;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  overflow-anchor: none;
  transition: none !important;
}
/* Подсветку при наведении Vuetify рисует псевдоэлементом — гасим и его. */
.clients-table :deep(tbody tr.virtual-pad:hover td::after) { content: none !important; }

.col-actions { width: 1%; white-space: nowrap; }

/* Кнопка расширенных фильтров рядом с поиском. */
.clients-filter-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: pointer; white-space: nowrap;
}
.clients-filter-btn:hover { border-color: rgba(var(--v-theme-primary), 0.45); }
.clients-filter-btn--active {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
}
.clients-filter-count {
  font-size: 11px; font-weight: 700; line-height: 1;
  padding: 2px 6px; border-radius: 10px;
  background: rgb(var(--v-theme-primary)); color: #fff;
}

/* Плашки включённых фильтров над списком. */
.active-filters {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-bottom: 12px;
}
.af-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 8px 5px 11px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.07);
  color: rgb(var(--v-theme-primary));
  font-size: 12.5px; font-weight: 500; cursor: pointer;
}
.af-chip:hover { background: rgba(var(--v-theme-primary), 0.14); }
.af-clear {
  font-size: 12.5px; padding: 5px 8px; border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.5); cursor: pointer;
}
.af-clear:hover { background: rgba(var(--v-theme-on-surface), 0.05); }

/* Невидимый якорь автоподгрузки в конце списка. */
.auto-load-sentinel { height: 1px; }

/* Кнопки действий в шапке карточки: на узком экране статистика уезжает вниз,
   а кнопки должны остаться рядом со стрелкой раскрытия. */

/* Прилипающая пагинация (ServerPager) требует, чтобы карточка не обрезала
   содержимое — у v-card overflow: hidden по умолчанию. */
.clients-card { overflow: visible; }

/* Stats row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
/* На мобиле каждая KPI карточка отдельной строкой — крупные суммы
   (например «Остаток к получению» с 7-значной цифрой) не помещались
   в 2-col layout и переносились или обрезались. */
@media (max-width: 600px) { .stats-row { grid-template-columns: 1fr; gap: 8px; } }

.clients-hint {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(59, 130, 246, 0.06);
  border: 1px solid rgba(59, 130, 246, 0.15);
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 16px;
}
.clients-hint .v-icon {
  color: #3b82f6;
  flex-shrink: 0;
  margin-top: 1px;
}
.clients-hint-link {
  color: #3b82f6;
  text-decoration: none;
  font-weight: 600;
}
.clients-hint-link:hover {
  text-decoration: underline;
}

/* Строка поиска: на десктопе input ограничен 360px и слева, счётчик справа.
   На мобиле input — на всю ширину, счётчик уходит под него. */
.clients-search-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.clients-city-filter {
  flex: 0 1 220px;
  min-width: 180px;
}
.clients-search-input {
  /* Подсказка перечисляет четыре поля поиска — на 360px она обрезалась. */
  flex: 1 1 340px;
  min-width: 300px;
  max-width: 460px;
}
@media (max-width: 599px) {
  .clients-search-row {
    flex-wrap: wrap;
    gap: 8px;
  }
  .clients-search-input {
    flex: 1 1 100%;
    max-width: 100%;
  }
}

.stat-card {
  display: flex; align-items: center; gap: 12px;
  padding: 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.stat-icon {
  width: 40px; height: 40px; min-width: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.stat-value {
  font-size: 18px; font-weight: 700; line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.stat-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Filter inputs */
.filter-input-wrap { position: relative; flex: 1; }
.filter-input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #9ca3af; pointer-events: none;
}
.filter-input {
  width: 100%; height: 40px; padding: 0 16px 0 38px;
  border: 1px solid #e4e4e7; border-radius: 10px;
  background: #fff; font-size: 14px; color: inherit;
  outline: none; transition: all 0.15s ease;
}
.filter-input::placeholder { color: #9ca3af; }
.filter-input:focus {
  border-color: #047857; background: #fff;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}

/* Client list */

/* Client header */

.verified-badge {
  display: inline-flex; align-items: center;
}

/* Desktop stats */

/* Expanded content */

/* ───── Mobile (client cards) ───── */
@media (max-width: 599px) {
  /* Сжимаем padding header'а — на 360px каждый пиксель критичен. */

  /* Бэйджи в строке имени — компактнее, gap меньше. */
  /* Паспортный бейдж на узком экране лишний — имя важнее. */

  /* Шеврон поближе и поменьше отступы. */
}

/* Mobile stats */
@media (max-width: 599px) {
  /* На очень узких экранах stats в один столбец — иначе суммы сжимаются. */
}

/* On-time bar */
.ontime-bar { }
.ontime-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ontime-value {
  font-size: 14px; font-weight: 700;
}
.ontime-track {
  width: 100%; height: 6px; border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  overflow: hidden;
}
.ontime-fill {
  height: 100%; border-radius: 3px;
  transition: width 0.3s ease;
}

/* Next payment */

/* Deals section */

.deal-list {
  display: flex; flex-direction: column; gap: 4px;
}

.deal-chevron {
  color: rgba(var(--v-theme-on-surface), 0.25);
  flex-shrink: 0;
}

@media (max-width: 768px) {
}

/* Dialog */
.dialog-status {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  font-size: 11px; font-weight: 600;
  padding: 4px 10px; border-radius: 999px;
  background: #fff; margin-bottom: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.dialog-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.dialog-title {
  font-size: 20px; font-weight: 700; color: #fff; line-height: 1.25;
  margin-bottom: 6px; word-break: break-word;
}
.dialog-finance-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 600px) { .dialog-finance-grid { grid-template-columns: repeat(2, 1fr); } }
.dialog-finance-item {
  padding: 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.dialog-finance-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 2px;
}
.dialog-finance-value {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Schedule */
.schedule-list { display: flex; flex-direction: column; gap: 4px; }
.schedule-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 8px;
  transition: background 0.15s;
}
.schedule-item:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.schedule-item--paid { opacity: 0.65; }
.schedule-item--overdue { background: rgba(239, 68, 68, 0.04); }
.schedule-num {
  width: 24px; height: 24px; min-width: 24px;
  border-radius: 6px; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.schedule-info { flex: 1; min-width: 0; }
.schedule-date {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.schedule-paid-at {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.schedule-amount {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
}
.schedule-status {
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px; white-space: nowrap;
}

/* Detail link */

/* Dark mode */
.dark .stat-card {
  background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border));
}
.dark .client-card {
  background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border));
}
.dark .client-card--expanded {
  border-color: rgba(4, 120, 87, 0.3);
}
.dark .filter-input {
  background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); color: rgba(var(--v-theme-on-surface), 0.92);
}
.dark .filter-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.5); }
.dark .filter-input:focus {
  border-color: #047857; background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .dialog-finance-item { background: rgba(255, 255, 255, 0.04); }
.dark .next-payment {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.18);
}

/* Passport badge */
.passport-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}
.passport-badge--ok {
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
}
.passport-badge--warn {
  background: rgba(245, 158, 11, 0.1);
  color: #d97706;
}
/* Переход к полному списку сделок клиента: в карточке показываем только
   несколько последних. */
.client-all-deals {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-primary), 0.35);
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  transition: background-color 0.15s;
}
.client-all-deals:hover { background: rgba(var(--v-theme-primary), 0.06); }
</style>
