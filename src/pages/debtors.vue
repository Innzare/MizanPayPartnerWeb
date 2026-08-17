<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDebtorsStore, type DebtorRow, type PromiseStatus, type DebtorAnalytics } from '@/stores/debtors'
import { useAuthStore } from '@/stores/auth'
import { useSections } from '@/composables/useSections'
import { useIsDark } from '@/composables/useIsDark'
import { useIsMobile } from '@/composables/useIsMobile'
import { formatCurrency, formatDateShort } from '@/utils/formatters'
import ServerPager from '@/components/ServerPager.vue'
import DebtorDetailModal from '@/components/DebtorDetailModal.vue'
import PromiseDialog from '@/components/PromiseDialog.vue'

const store = useDebtorsStore()
const auth = useAuthStore()
const sections = useSections()
const router = useRouter()
const { isDark } = useIsDark()
const { isMobile } = useIsMobile()

type Tab = 'list' | 'archive' | 'analytics' | 'settings'
const tab = ref<Tab>('list')
const isArchive = computed(() => tab.value === 'archive')
const canSettings = computed(() => auth.can('debtors.settings'))
const canActivity = computed(() => auth.can('debtors.activity'))
// Назначение ответственного бессмысленно без раздела сотрудников.
const canAssign = computed(() => auth.can('debtors.assign') && sections.visible('staff'))
const isOwner = computed(() => auth.isOwner)
const myStaffId = computed(() => auth.user?.staffId ?? null)

// ── Модалка детали ──
const modalOpen = ref(false)
const selectedRow = ref<DebtorRow | null>(null)
function openRow(row: DebtorRow) {
  selectedRow.value = row
  modalOpen.value = true
}
// держим выбранную строку в синхроне со списком (patchRow обновляет rows)
const liveSelectedRow = computed(() => {
  if (!selectedRow.value) return null
  const id = selectedRow.value.dealId
  return store.rows.find((r) => r.dealId === id) ?? store.archiveRows.find((r) => r.dealId === id) ?? selectedRow.value
})

// ── Обещание прямо из строки таблицы ──
const rowPromiseOpen = ref(false)
const rowPromiseRow = ref<DebtorRow | null>(null)
function openRowPromise(row: DebtorRow, e?: Event) {
  e?.stopPropagation()
  rowPromiseRow.value = row
  rowPromiseOpen.value = true
}

// ── Настраиваемые колонки таблицы (как на странице сделок) ──
interface Col { key: string; label: string; align: 'start' | 'end' | 'center'; sortable: boolean }
const ALL_COLUMNS: Col[] = [
  { key: 'dealNumber', label: '№', align: 'start', sortable: true },
  { key: 'client', label: 'Клиент', align: 'start', sortable: true },
  { key: 'product', label: 'Товар', align: 'start', sortable: true },
  { key: 'overdueAmount', label: 'Сумма просрочки', align: 'end', sortable: true },
  { key: 'overdueCount', label: 'Просрочек', align: 'center', sortable: true },
  { key: 'overdueDays', label: 'Дней просрочки', align: 'end', sortable: true },
  { key: 'remaining', label: 'Остаток', align: 'end', sortable: true },
  { key: 'nextPayment', label: 'Следующий платёж', align: 'end', sortable: true },
  { key: 'promised', label: 'Обещал оплатить', align: 'end', sortable: true },
  { key: 'assignedStaff', label: 'Ответственный', align: 'start', sortable: true },
  { key: 'lastActivity', label: 'Последний контакт', align: 'start', sortable: true },
  { key: 'status', label: 'Статус', align: 'start', sortable: true },
  { key: 'total', label: 'Сумма договора', align: 'end', sortable: true },
  { key: 'progress', label: 'Прогресс', align: 'center', sortable: true },
]
const DEFAULT_VISIBLE = ['dealNumber', 'client', 'overdueAmount', 'overdueCount', 'overdueDays', 'nextPayment', 'promised', 'assignedStaff']
const COLS_STORAGE_KEY = 'debtors:table-columns'

function loadVisibleCols(): Record<string, boolean> {
  const base: Record<string, boolean> = {}
  for (const c of ALL_COLUMNS) base[c.key] = DEFAULT_VISIBLE.includes(c.key)
  try {
    const saved = localStorage.getItem(COLS_STORAGE_KEY)
    if (saved) Object.assign(base, JSON.parse(saved))
  } catch { /* ignore */ }
  return base
}
const visibleCols = ref<Record<string, boolean>>(loadVisibleCols())
watch(visibleCols, (v) => {
  try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(v)) } catch { /* ignore */ }
}, { deep: true })
const shownColumns = computed(() => ALL_COLUMNS.filter((c) => visibleCols.value[c.key]))
function isColVisible(key: string) { return visibleCols.value[key] }
function toggleColumn(key: string) { visibleCols.value[key] = !visibleCols.value[key] }

// ── Сортировка ──
const sortCol = ref('overdueDays')
const sortDir = ref<'asc' | 'desc'>('desc')
const TEXT_COLS = new Set(['client', 'product', 'assignedStaff'])
function toggleSort(key: string) {
  if (sortCol.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortCol.value = key
    sortDir.value = TEXT_COLS.has(key) ? 'asc' : 'desc'
  }
}
const DEAL_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Активна', COMPLETED: 'Завершена', DISPUTED: 'Спор', CANCELLED: 'Отменена',
}

// ── Поиск + фильтр по обещанию + сортировка ──
const search = ref('')
type PromiseFilter = 'all' | 'has' | 'today' | 'tomorrow' | 'next7' | 'overdue' | 'broken' | 'none'
const promiseFilter = ref<PromiseFilter>('all')
const PROMISE_FILTERS: { key: PromiseFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'has', label: 'Есть обещание' },
  { key: 'today', label: 'Обещал сегодня' },
  { key: 'tomorrow', label: 'Обещал завтра' },
  { key: 'next7', label: 'Ближайшие 7 дней' },
  { key: 'overdue', label: 'Просроченные обещания' },
  { key: 'broken', label: 'Нарушенные обещания' },
  { key: 'none', label: 'Без обещания' },
]
const promiseFilterLabel = computed(() => PROMISE_FILTERS.find((f) => f.key === promiseFilter.value)?.label || 'Все')

// Фильтр по ответственному: 'all' | 'unassigned' | 'mine' | <staffId>
const assigneeFilter = ref<string>('all')
const assigneeFilterLabel = computed(() => {
  const f = assigneeFilter.value
  if (f === 'all') return 'Все'
  if (f === 'unassigned') return 'Не назначены'
  if (f === 'mine') return 'Мои'
  const s = store.staff.find((x) => x.id === f)
  return s ? `${s.firstName} ${s.lastName}`.trim() : 'Сотрудник'
})


// ══════════════════════════════════════════════════════════════════
// Серверная страница
//
// Поиск, фильтры, сортировка и постраничность выполняются в базе. Раньше
// страница получала всех должников партнёра одним куском и фильтровала их в
// браузере — на профиле с 14 813 сделками это 3 886 строк и больше мегабайта
// на каждый заход в раздел.
// ══════════════════════════════════════════════════════════════════

const PER_PAGE_OPTIONS = [25, 50, 100, 200]
const PAGE_SIZE_KEY = 'debtors:page-size'
const perPage = ref(Number(localStorage.getItem(PAGE_SIZE_KEY)) || 50)
const page = ref(1)
watch(perPage, (v) => {
  try { localStorage.setItem(PAGE_SIZE_KEY, String(v)) } catch { /* ignore */ }
})

const displayedRows = computed(() => (isArchive.value ? store.archiveRows : store.rows))
const totalRows = computed(() => (isArchive.value ? store.archiveTotal : store.total))
const listLoading = computed(() => (isArchive.value ? store.archiveLoading : store.loading))

/** Фильтр «Мои» разворачивается в конкретного сотрудника — сервер знает только id. */
const assigneeParam = computed(() => {
  const f = assigneeFilter.value
  if (f === 'all') return null
  if (f === 'mine') return myStaffId.value
  return f
})

function pageParams() {
  return {
    q: search.value,
    promise: promiseFilter.value,
    assignee: assigneeParam.value,
    sort: sortCol.value,
    dir: sortDir.value,
    limit: perPage.value,
    offset: (page.value - 1) * perPage.value,
  }
}

function loadPage() {
  if (isArchive.value) store.fetchArchive(pageParams())
  else store.fetchDebtors(pageParams())
}

/** После правки обещания меняются и строка списка, и счётчик нарушенных. */
function refreshAfterMutation() {
  loadPage()
  if (auth.can('debtors.kpi')) store.fetchKpi()
}

// Любая смена условий возвращает на первую страницу — иначе можно оказаться
// на 40-й странице выборки, где всего две.
watch([search, promiseFilter, assigneeFilter, sortCol, sortDir, perPage], () => {
  page.value = 1
  loadPage()
})
watch(page, loadPage)
watch(tab, (t) => { if (t === 'list' || t === 'archive') { page.value = 1; loadPage() } })

// ── KPI ──
// Считаются на сервере по всей выборке: складывать загруженные строки больше
// нельзя — в браузере лежит только текущая страница.
const stats = computed(() => ({
  count: store.kpi?.count ?? 0,
  overdueAmount: store.kpi?.overdueAmount ?? 0,
  overdueCount: store.kpi?.overdueCount ?? 0,
  unassigned: store.kpi?.unassigned ?? 0,
}))
const brokenCount = computed(() => store.kpi?.broken ?? 0)
function toggleQuickFilter(f: PromiseFilter) { promiseFilter.value = promiseFilter.value === f ? 'all' : f }

// ── Настройки порогов ──
const settingsForm = ref({ minOverdueDays: 1, minOverdueAmount: 0 })
const savingSettings = ref(false)
const settingsSaved = ref(false)
watch(() => store.settings, (s) => { settingsForm.value = { ...s } }, { immediate: true, deep: true })
async function saveSettings() {
  savingSettings.value = true
  try {
    await store.updateSettings({
      minOverdueDays: Math.max(0, Math.round(Number(settingsForm.value.minOverdueDays) || 0)),
      minOverdueAmount: Math.max(0, Number(settingsForm.value.minOverdueAmount) || 0),
    })
    settingsSaved.value = true
    setTimeout(() => { settingsSaved.value = false }, 2500)
    // Пороги изменились — меняется и состав списка, и цифры в шапке.
    page.value = 1
    loadPage()
    if (auth.can('debtors.kpi')) await store.fetchKpi()
  } finally {
    savingSettings.value = false
  }
}

// ── Хелперы строки ──
function fmtDate(ts: number | null) { return ts ? formatDateShort(new Date(ts).toISOString()) : '—' }
const PROMISE_STATUS_META: Record<PromiseStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Ожидается', cls: 'ps--pending' },
  KEPT: { label: 'Сдержано', cls: 'ps--kept' },
  BROKEN: { label: 'Нарушено', cls: 'ps--broken' },
  SUPERSEDED: { label: 'Заменено', cls: 'ps--superseded' },
}
function daysLabel(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} день`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} дня`
  return `${n} дней`
}

// ── Написать в WhatsApp ──
function writeWhatsApp(row: DebtorRow, e?: Event) {
  e?.stopPropagation()
  const digits = (row.clientPhone || '').replace(/\D/g, '')
  if (digits) router.push(`/broadcasts?chat=${digits}`)
}

// ── Выбор строк (скрыт по умолчанию, включается кнопкой — как на сделках) ──
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
/**
 * Режим «вся выборка»: в браузере лежит только страница, поэтому выделение
 * всех найденных хранится флагом, а снятые галочки — списком исключений.
 * Такой же приём используется на странице сделок.
 */
const selectAllMatching = ref(false)
const excludedIds = ref<Set<string>>(new Set())

/** Сколько строк реально будет затронуто действием. */
const selectionCount = computed(() =>
  selectAllMatching.value ? Math.max(0, totalRows.value - excludedIds.value.size) : selectedIds.value.size,
)

function isRowSelected(id: string): boolean {
  return selectAllMatching.value ? !excludedIds.value.has(id) : selectedIds.value.has(id)
}

function toggleSelect(id: string) {
  if (selectAllMatching.value) {
    const ex = new Set(excludedIds.value)
    if (ex.has(id)) ex.delete(id); else ex.add(id)
    excludedIds.value = ex
    return
  }
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  selectedIds.value = s
}

/** Выделяет строки ТЕКУЩЕЙ страницы (вся выборка — отдельной кнопкой). */
function selectAll() {
  selectAllMatching.value = false
  excludedIds.value = new Set()
  if (selectedIds.value.size === displayedRows.value.length) selectedIds.value = new Set()
  else selectedIds.value = new Set(displayedRows.value.map((r) => r.dealId))
}

function selectWholeSelection() {
  selectAllMatching.value = true
  excludedIds.value = new Set()
  selectedIds.value = new Set()
}

function cancelSelect() {
  selectMode.value = false
  selectedIds.value = new Set()
  selectAllMatching.value = false
  excludedIds.value = new Set()
}
// выходим из режима выбора при смене вкладки
watch(tab, () => cancelSelect())

const assignOpen = ref(false)
const assignStaffId = ref<string | null>(null)
const assigning = ref(false)
const assignTargetIds = ref<string[]>([]) // bulk из панели или 1 id из модалки
// Назначение на всю выборку: сервер сам найдёт сделки теми же фильтрами.
const assignWholeSelection = ref(false)
function openBulkAssign() {
  assignWholeSelection.value = selectAllMatching.value
  assignTargetIds.value = selectAllMatching.value ? [...excludedIds.value] : [...selectedIds.value]
  assignStaffId.value = null
  assignOpen.value = true
}
async function confirmAssign() {
  if (!assignWholeSelection.value && !assignTargetIds.value.length) return
  assigning.value = true
  try {
    await store.bulkAssign(
      assignTargetIds.value,
      assignStaffId.value,
      assignWholeSelection.value
        ? { mode: isArchive.value ? 'archive' : 'active', q: search.value, promise: promiseFilter.value, assignee: assigneeParam.value }
        : null,
    )
    assignOpen.value = false
    cancelSelect()
    loadPage()
    if (auth.can('debtors.kpi')) store.fetchKpi()
  } finally {
    assigning.value = false
  }
}

// ── Аналитика ──
const analytics = ref<DebtorAnalytics | null>(null)
const analyticsLoading = ref(false)
// Локальная дата YYYY-MM-DD (без сдвига часового пояса, в отличие от toISOString).
function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
function fmtRu(d: Date) {
  return `${d.getDate()} ${MON_SHORT[d.getMonth()]} ${d.getFullYear()}`
}
const _now0 = new Date()
const anFrom = ref(isoDay(new Date(_now0.getFullYear(), _now0.getMonth(), 1)))
const anTo = ref(isoDay(_now0))
const anStaffId = ref<string>('')
type PresetKey = 'thisMonth' | 'lastMonth' | 'quarter' | 'year'
const activePreset = ref<PresetKey | null>('thisMonth')

// Пресеты периода с конкретным диапазоном «от — до» на каждой кнопке.
const anPresets = computed(() => {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const q = Math.floor(m / 3)
  const defs: { key: PresetKey; label: string; from: Date; to: Date }[] = [
    { key: 'thisMonth', label: 'Этот месяц', from: new Date(y, m, 1), to: now },
    { key: 'lastMonth', label: 'Прошлый месяц', from: new Date(y, m - 1, 1), to: new Date(y, m, 0) },
    { key: 'quarter', label: 'Этот квартал', from: new Date(y, q * 3, 1), to: now },
    { key: 'year', label: 'Этот год', from: new Date(y, 0, 1), to: now },
  ]
  return defs.map((d) => ({ ...d, range: `${fmtRu(d.from)} — ${fmtRu(d.to)}`, fromIso: isoDay(d.from), toIso: isoDay(d.to) }))
})

async function loadAnalytics() {
  analyticsLoading.value = true
  try {
    analytics.value = await store.fetchAnalytics({ from: anFrom.value, to: anTo.value, staffId: anStaffId.value || null })
  } finally {
    analyticsLoading.value = false
  }
}
function applyPreset(p: { key: PresetKey; fromIso: string; toIso: string }) {
  anFrom.value = p.fromIso
  anTo.value = p.toIso
  activePreset.value = p.key
  loadAnalytics()
}
// Ручная правка дат сбрасывает выбранный пресет (период становится «свой»).
function onDateEdit() { activePreset.value = null }
// Клик по полю даты открывает нативный календарь (там, где поддерживается showPicker).
function openCal(e: Event) {
  const input = (e.currentTarget as HTMLElement)?.querySelector('input') as HTMLInputElement | null
  try { input?.showPicker?.() } catch { /* нет поддержки — обычный клик */ }
}
const agingRows = computed(() => {
  const a = analytics.value?.aging
  if (!a) return []
  return [
    { label: '1–7 дней', ...a.d1_7, color: '#f59e0b' },
    { label: '8–30 дней', ...a.d8_30, color: '#f97316' },
    { label: '31–60 дней', ...a.d31_60, color: '#ef4444' },
    { label: '60+ дней', ...a.d60p, color: '#b91c1c' },
  ]
})
const agingMax = computed(() => Math.max(1, ...agingRows.value.map((r) => r.amount)))

const kpiCards = computed(() => {
  const k = analytics.value?.kpi
  if (!k) return []
  return [
    { label: 'Должников', value: String(k.debtorsCount), icon: 'mdi-account-alert-outline', color: '#ef4444' },
    { label: 'Сумма просрочки', value: formatCurrency(k.overdueTotal), icon: 'mdi-cash-remove', color: '#f59e0b' },
    { label: 'Просроченных платежей', value: String(k.overdueCount), icon: 'mdi-calendar-alert', color: '#f97316' },
    { label: 'Средняя просрочка', value: `${k.avgOverdueDays} дн.`, icon: 'mdi-clock-alert-outline', color: '#8b5cf6' },
    { label: 'Остаток к получению', value: formatCurrency(k.remainingTotal), icon: 'mdi-wallet-outline', color: '#3b82f6' },
    { label: 'Взыскано за период', value: formatCurrency(k.collectedAmount), icon: 'mdi-cash-check', color: '#10b981' },
    { label: 'Назначено', value: String(k.assigned), icon: 'mdi-account-check-outline', color: '#047857' },
    { label: 'Не назначено', value: String(k.unassigned), icon: 'mdi-account-question-outline', color: '#64748b' },
  ]
})

watch(tab, (t) => {
  if (t === 'analytics' && !analytics.value) loadAnalytics()
})

onMounted(() => {
  loadPage()
  if (auth.can('debtors.kpi')) store.fetchKpi()
  if (canSettings.value) store.fetchSettings()
  if (canAssign.value) store.fetchStaff()
})
</script>

<template>
  <div class="at-page dbt-page" :class="{ dark: isDark }">
    <!-- Заголовок раздела — в верхнем баре. -->

    <!-- KPI — скрываются у ролей без права debtors.kpi -->
    <div v-if="auth.can('debtors.kpi')" class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
          <v-icon icon="mdi-account-alert-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.count }}</div>
          <div class="stat-label">Должников</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
          <v-icon icon="mdi-cash-remove" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(stats.overdueAmount) }}</div>
          <div class="stat-label">Сумма просрочки</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
          <v-icon icon="mdi-calendar-alert" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.overdueCount }}</div>
          <div class="stat-label">Просроченных платежей</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
          <v-icon icon="mdi-account-question-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.unassigned }}</div>
          <div class="stat-label">Не назначены</div>
        </div>
      </div>
    </div>

    <!-- Табы (единый стиль проекта — как в настройках) -->
    <div class="settings-tabs">
      <button class="settings-tab" :class="{ active: tab === 'list' }" @click="tab = 'list'">
        <v-icon icon="mdi-account-alert-outline" size="18" />
        <span>Должники</span>
        <span class="dbt-tabcount" :class="{ 'dbt-tabcount--on': tab === 'list' }">{{ stats.count }}</span>
      </button>
      <button class="settings-tab" :class="{ active: tab === 'archive' }" @click="tab = 'archive'">
        <v-icon icon="mdi-archive-outline" size="18" />
        <span>Архив</span>
        <span v-if="store.archiveTotal" class="dbt-tabcount" :class="{ 'dbt-tabcount--on': tab === 'archive' }">{{ store.archiveTotal }}</span>
      </button>
      <button class="settings-tab" :class="{ active: tab === 'analytics' }" @click="tab = 'analytics'">
        <v-icon icon="mdi-chart-box-outline" size="18" />
        <span>Аналитика</span>
      </button>
      <button v-if="canSettings" class="settings-tab" :class="{ active: tab === 'settings' }" @click="tab = 'settings'">
        <v-icon icon="mdi-cog-outline" size="18" />
        <span>Настройки</span>
      </button>
    </div>

    <!-- ── Таб: Должники / Архив ── -->
    <div v-if="tab === 'list' || tab === 'archive'" class="dbt-card dbt-card--list">
      <div class="pa-4">
        <!-- Тулбар: колонки + фильтр обещаний + поиск -->
        <div class="d-flex justify-space-between align-center ga-2 mb-3 flex-wrap">
          <div class="d-flex align-center ga-2 flex-wrap">
            <v-menu v-if="!isMobile" :close-on-content-click="false" location="bottom start">
              <template #activator="{ props: menuProps }">
                <button class="fb-btn" v-bind="menuProps" title="Колонки таблицы">
                  <v-icon icon="mdi-table-cog" size="16" />
                  <span>Колонки</span>
                </button>
              </template>
              <div class="col-menu">
                <div class="col-menu-title">Колонки таблицы</div>
                <label v-for="c in ALL_COLUMNS" :key="c.key" class="col-menu-item">
                  <input type="checkbox" :checked="visibleCols[c.key]" @change="toggleColumn(c.key)" />
                  <span>{{ c.label }}</span>
                </label>
              </div>
            </v-menu>

            <!-- Фильтр по колонке «Обещал оплатить» -->
            <v-menu :close-on-content-click="true" location="bottom start">
              <template #activator="{ props: menuProps }">
                <button class="fb-btn" :class="{ 'fb-btn--active': promiseFilter !== 'all' }" v-bind="menuProps">
                  <v-icon icon="mdi-hand-coin-outline" size="16" />
                  <span>Обещание: {{ promiseFilterLabel }}</span>
                </button>
              </template>
              <div class="col-menu">
                <div class="col-menu-title">Фильтр обещаний</div>
                <label v-for="f in PROMISE_FILTERS" :key="f.key" class="col-menu-item" @click="promiseFilter = f.key">
                  <v-icon :icon="promiseFilter === f.key ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank'" size="16" :color="promiseFilter === f.key ? 'primary' : ''" />
                  <span>{{ f.label }}</span>
                </label>
              </div>
            </v-menu>

            <!-- Фильтр по ответственному -->
            <v-menu :close-on-content-click="true" location="bottom start">
              <template #activator="{ props: menuProps }">
                <button class="fb-btn" :class="{ 'fb-btn--active': assigneeFilter !== 'all' }" v-bind="menuProps">
                  <v-icon icon="mdi-account-outline" size="16" />
                  <span>Ответственный: {{ assigneeFilterLabel }}</span>
                </button>
              </template>
              <div class="col-menu">
                <div class="col-menu-title">Ответственный</div>
                <label class="col-menu-item" @click="assigneeFilter = 'all'">
                  <v-icon :icon="assigneeFilter === 'all' ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank'" size="16" :color="assigneeFilter === 'all' ? 'primary' : ''" />
                  <span>Все</span>
                </label>
                <label class="col-menu-item" @click="assigneeFilter = 'unassigned'">
                  <v-icon :icon="assigneeFilter === 'unassigned' ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank'" size="16" :color="assigneeFilter === 'unassigned' ? 'primary' : ''" />
                  <span>Не назначены</span>
                </label>
                <label v-for="s in store.staff" :key="s.id" class="col-menu-item" @click="assigneeFilter = s.id">
                  <v-icon :icon="assigneeFilter === s.id ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank'" size="16" :color="assigneeFilter === s.id ? 'primary' : ''" />
                  <span>{{ s.firstName }} {{ s.lastName }}</span>
                </label>
              </div>
            </v-menu>

            <!-- Быстрый чип: нарушенные обещания -->
            <button v-if="brokenCount" class="dbt-chip" :class="{ active: promiseFilter === 'broken' }" @click="toggleQuickFilter('broken')">
              <v-icon icon="mdi-alert-circle-outline" size="15" /> Нарушенные обещания
              <span class="dbt-chip-count">{{ brokenCount }}</span>
            </button>
            <!-- Быстрый чип: мои (для сотрудника) -->
            <button v-if="myStaffId" class="dbt-chip dbt-chip--neutral" :class="{ active: assigneeFilter === 'mine' }" @click="assigneeFilter = assigneeFilter === 'mine' ? 'all' : 'mine'">
              <v-icon icon="mdi-account-check-outline" size="15" /> Мои
            </button>
          </div>

          <div class="d-flex align-center ga-2">
            <div class="dbt-search">
              <v-icon icon="mdi-magnify" size="18" />
              <input v-model="search" type="text" placeholder="Поиск…" />
            </div>
            <!-- Включить режим выбора (скрыт по умолчанию — как на сделках) -->
            <button v-if="canAssign && !isArchive && !selectMode" class="fb-btn" title="Выбрать сделки" @click="selectMode = true">
              <v-icon icon="mdi-checkbox-multiple-outline" size="16" />
              <span>Выбрать</span>
            </button>
          </div>
        </div>

        <!-- Панель выбора (появляется по кнопке «Выбрать») -->
        <Transition name="dbt-slide">
          <div v-if="selectMode" class="dbt-selbar">
            <div class="dbt-selbar-left">
              <v-checkbox-btn
                :model-value="selectAllMatching || (selectedIds.size === displayedRows.length && displayedRows.length > 0)"
                :indeterminate="!selectAllMatching && selectedIds.size > 0 && selectedIds.size < displayedRows.length"
                density="compact"
                hide-details
                @update:model-value="selectAll"
              />
              <span class="dbt-selbar-count">
                {{ selectionCount > 0 ? `Выбрано ${selectionCount} из ${totalRows}` : 'Выберите сделки' }}
              </span>
              <!-- Выделение на странице охватывает только её строки; всю
                   выборку целиком выбирают отдельно — как на сделках. -->
              <button
                v-if="!selectAllMatching && selectedIds.size === displayedRows.length && displayedRows.length > 0 && totalRows > displayedRows.length"
                class="dbt-selbar-link"
                @click="selectWholeSelection"
              >
                Выбрать всех найденных ({{ totalRows }})
              </button>
            </div>
            <div class="dbt-selbar-right">
              <button v-if="canAssign && selectionCount > 0" class="dbt-selbar-primary" @click="openBulkAssign">
                <v-icon icon="mdi-account-arrow-right-outline" size="18" />
                <span>Назначить сотрудника ({{ selectionCount }})</span>
              </button>
              <button class="dbt-selbar-cancel" @click="cancelSelect">
                <v-icon icon="mdi-close" size="18" />
                <span>Отмена</span>
              </button>
            </div>
          </div>
        </Transition>

        <!-- Загрузка -->
        <div v-if="listLoading" class="d-flex justify-center pa-12">
          <v-progress-circular indeterminate color="primary" size="40" />
        </div>

        <!-- Таблица -->
        <v-table v-else-if="displayedRows.length" density="default" hover class="dbt-table">
          <thead>
            <tr>
              <th v-if="selectMode" style="width: 40px;">
                <v-checkbox-btn
                  :model-value="selectedIds.size === displayedRows.length && displayedRows.length > 0"
                  :indeterminate="selectedIds.size > 0 && selectedIds.size < displayedRows.length"
                  density="compact"
                  hide-details
                  @update:model-value="selectAll"
                />
              </th>
              <th class="th-index"></th>
              <th
                v-for="c in shownColumns"
                :key="c.key"
                :class="[`text-${c.align === 'end' ? 'end' : c.align === 'center' ? 'center' : 'start'}`, { 'th-sortable': c.sortable, 'th-sorted': sortCol === c.key }]"
                @click="c.sortable && toggleSort(c.key)"
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
              <th v-if="canActivity && !isArchive" class="text-end" style="width: 56px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in displayedRows" :key="row.dealId" class="cursor-pointer" :class="{ 'dbt-row--sel': isRowSelected(row.dealId) }" @click="selectMode ? toggleSelect(row.dealId) : openRow(row)">
              <td v-if="selectMode" @click.stop>
                <v-checkbox-btn
                  :model-value="isRowSelected(row.dealId)"
                  density="compact"
                  hide-details
                  @update:model-value="toggleSelect(row.dealId)"
                />
              </td>
              <td class="td-index text-medium-emphasis">{{ (page - 1) * perPage + idx + 1 }}</td>

              <td v-if="isColVisible('dealNumber')" class="text-start text-no-wrap"><span class="dbt-deal-num">#{{ row.dealNumber }}</span></td>

              <td v-if="isColVisible('client')" style="min-width: 220px;">
                <div>
                  <div class="text-no-wrap font-weight-medium">{{ row.clientName }}</div>
                  <div v-if="row.clientPhone" class="dbt-phone text-no-wrap">{{ row.clientPhone }}</div>
                </div>
              </td>

              <td v-if="isColVisible('product')">
                <span class="dbt-product">{{ row.productName }}</span>
              </td>

              <td v-if="isColVisible('overdueAmount')" class="text-end text-no-wrap font-weight-bold" :style="row.overdueAmount ? 'color: #ef4444;' : ''">
                <span v-if="row.overdueAmount">{{ formatCurrency(row.overdueAmount) }}</span>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
              <td v-if="isColVisible('overdueCount')" class="text-center text-no-wrap">{{ row.overdueCount || '—' }}</td>
              <td v-if="isColVisible('overdueDays')" class="text-end text-no-wrap">
                <span v-if="row.overdueDays" class="dbt-days">{{ daysLabel(row.overdueDays) }}</span>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
              <td v-if="isColVisible('remaining')" class="text-end text-no-wrap text-medium-emphasis">{{ formatCurrency(row.remainingAmount) }}</td>

              <td v-if="isColVisible('nextPayment')" class="text-end text-no-wrap">
                <template v-if="row.nextDueDate">
                  <div>{{ fmtDate(row.nextDueDate) }}</div>
                  <div class="dbt-sub">{{ formatCurrency(row.nextDueAmount) }}</div>
                </template>
                <template v-else>—</template>
              </td>

              <td v-if="isColVisible('promised')" class="text-end text-no-wrap">
                <template v-if="row.promisedDate">
                  <div>{{ fmtDate(row.promisedDate) }}</div>
                  <span v-if="row.promiseStatus && row.promiseStatus !== 'PENDING'" class="dbt-ps" :class="PROMISE_STATUS_META[row.promiseStatus].cls">
                    {{ PROMISE_STATUS_META[row.promiseStatus].label }}
                  </span>
                </template>
                <span v-else class="text-medium-emphasis">—</span>
              </td>

              <td v-if="isColVisible('assignedStaff')" class="text-start text-no-wrap">
                <span v-if="row.assignedStaffName" class="dbt-staff">{{ row.assignedStaffName }}</span>
                <span v-else class="dbt-unassigned">Не назначен</span>
              </td>

              <td v-if="isColVisible('lastActivity')" class="text-start text-no-wrap">
                <span v-if="row.lastActivityAt">{{ fmtDate(row.lastActivityAt) }}</span>
                <span v-else class="text-medium-emphasis">—</span>
              </td>

              <td v-if="isColVisible('status')" class="text-start text-no-wrap">
                <span class="dbt-dealstatus" :class="'dbt-dealstatus--' + row.dealStatus.toLowerCase()">{{ DEAL_STATUS_LABEL[row.dealStatus] || row.dealStatus }}</span>
                <div v-if="row.resolvedAt" class="dbt-sub">{{ fmtDate(row.resolvedAt) }}</div>
              </td>

              <td v-if="isColVisible('total')" class="text-end text-no-wrap">{{ formatCurrency(row.totalPrice) }}</td>

              <td v-if="isColVisible('progress')" class="text-center" style="min-width: 130px;">
                <div class="d-flex align-center ga-2">
                  <v-progress-linear
                    :model-value="row.numberOfPayments ? (row.paidPayments / row.numberOfPayments) * 100 : 0"
                    color="primary"
                    rounded
                    height="4"
                    style="width: 70px;"
                  />
                  <span class="text-caption text-medium-emphasis">{{ row.paidPayments }}/{{ row.numberOfPayments }}</span>
                </div>
              </td>

              <td v-if="canActivity && !isArchive" class="text-end" @click.stop>
                <button class="dbt-rowaction" title="Обещал оплатить" @click="openRowPromise(row, $event)">
                  <v-icon icon="mdi-hand-coin-outline" size="18" />
                </button>
              </td>
            </tr>
          </tbody>
        </v-table>

        <!-- Пусто -->
        <div v-else class="text-center pa-12">
          <v-icon :icon="isArchive ? 'mdi-archive-outline' : 'mdi-check-circle-outline'" size="56" color="grey-lighten-1" class="mb-3" />
          <div class="text-h6 mb-1">
            {{ search ? 'Ничего не найдено' : isArchive ? 'Архив пуст' : 'Должников нет' }}
          </div>
          <div class="text-body-2 text-medium-emphasis">
            {{ search ? 'Попробуйте изменить запрос' : isArchive ? 'Сюда попадают должники, по которым велась работа и просрочка погашена' : 'Ни по одной сделке нет просрочек, подходящих под настроенные пороги' }}
          </div>
        </div>

        <ServerPager
          v-if="totalRows > 0"
          :page="page"
          :total="totalRows"
          :per-page="perPage"
          :busy="listLoading"
          :per-page-options="PER_PAGE_OPTIONS"
          @update:page="page = $event"
          @update:per-page="perPage = $event"
        />
      </div>
    </div>

    <!-- ── Таб: Настройки ── -->
    <div v-else-if="tab === 'settings'" class="dbt-card">
      <div class="pa-6" style="max-width: 720px;">
        <!-- Заголовок секции -->
        <div class="dbt-set-head">
          <div class="dbt-set-ico"><v-icon icon="mdi-tune-variant" size="22" /></div>
          <div>
            <h2 class="dbt-set-title">Кто считается неплательщиком</h2>
            <p class="dbt-set-sub">Сделка попадает в список, только когда выполнены <b>оба</b> условия одновременно.</p>
          </div>
        </div>

        <!-- Пороги -->
        <div class="dbt-set-grid">
          <div class="dbt-set-field">
            <div class="dbt-set-field-head">
              <v-icon icon="mdi-calendar-clock" size="18" color="warning" />
              <span class="dbt-set-field-title">Минимум дней просрочки</span>
            </div>
            <p class="dbt-set-field-hint">Сколько дней должен быть просрочен платёж, чтобы клиент попал в список.</p>
            <v-text-field
              v-model.number="settingsForm.minOverdueDays"
              type="number" min="0" max="365"
              variant="outlined" density="comfortable" rounded="lg" suffix="дн." hide-details
            />
          </div>

          <div class="dbt-set-field">
            <div class="dbt-set-field-head">
              <v-icon icon="mdi-cash-remove" size="18" color="warning" />
              <span class="dbt-set-field-title">Минимальная сумма просрочки</span>
            </div>
            <p class="dbt-set-field-hint">Суммарная просроченная задолженность по сделке должна быть не меньше этой суммы.</p>
            <v-text-field
              v-model.number="settingsForm.minOverdueAmount"
              type="number" min="0"
              variant="outlined" density="comfortable" rounded="lg" suffix="₽" hide-details
            />
          </div>
        </div>

        <div class="d-flex align-center ga-3 mt-6">
          <v-btn color="primary" variant="flat" rounded="lg" size="large" :loading="savingSettings" @click="saveSettings">Сохранить</v-btn>
          <Transition name="dbt-slide">
            <span v-if="settingsSaved" class="dbt-saved">
              <v-icon icon="mdi-check-circle" size="18" /> Сохранено
            </span>
          </Transition>
        </div>
      </div>
    </div>

    <!-- ── Таб: Аналитика ── -->
    <div v-else-if="tab === 'analytics'">
      <!-- Фильтры периода -->
      <div class="dbt-card mb-4 pa-4">
        <!-- Пресеты с конкретным диапазоном на каждой кнопке -->
        <div class="dbt-an-presets">
          <button
            v-for="p in anPresets"
            :key="p.key"
            class="dbt-an-preset"
            :class="{ active: activePreset === p.key }"
            @click="applyPreset(p)"
          >
            <span class="dbt-an-preset-lbl">{{ p.label }}</span>
            <span class="dbt-an-preset-range">{{ p.range }}</span>
          </button>
        </div>

        <!-- Свой период + сотрудник + применить -->
        <div class="dbt-an-custom">
          <span class="dbt-an-clabel">Свой период</span>
          <div class="dbt-an-datebox" @click="openCal">
            <v-icon icon="mdi-calendar-outline" size="15" class="dbt-an-cal-ico" />
            <input v-model="anFrom" type="date" class="dbt-an-dateinput" @change="onDateEdit" />
          </div>
          <span class="dbt-an-dash">—</span>
          <div class="dbt-an-datebox" @click="openCal">
            <v-icon icon="mdi-calendar-outline" size="15" class="dbt-an-cal-ico" />
            <input v-model="anTo" type="date" class="dbt-an-dateinput" @change="onDateEdit" />
          </div>

          <div v-if="canAssign && store.staff.length" class="dbt-an-staffwrap">
            <v-icon icon="mdi-account-outline" size="15" class="dbt-an-staff-ico" />
            <select v-model="anStaffId" class="dbt-an-staffsel">
              <option value="">Все сотрудники</option>
              <option v-for="s in store.staff" :key="s.id" :value="s.id">{{ s.firstName }} {{ s.lastName }}</option>
            </select>
            <v-icon icon="mdi-chevron-down" size="15" class="dbt-an-staff-caret" />
          </div>

          <v-btn color="primary" variant="flat" rounded="lg" size="small" :loading="analyticsLoading" class="ml-auto" @click="loadAnalytics">Применить</v-btn>
        </div>
      </div>

      <div v-if="analyticsLoading && !analytics" class="d-flex justify-center pa-12">
        <v-progress-circular indeterminate color="primary" size="40" />
      </div>

      <template v-else-if="analytics">
        <!-- KPI-карточки с иконками -->
        <div class="dbt-an-kpis mb-4">
          <div v-for="c in kpiCards" :key="c.label" class="dbt-an-kpi">
            <div class="dbt-an-kpi-ico" :style="{ background: c.color + '1a', color: c.color }">
              <v-icon :icon="c.icon" size="20" />
            </div>
            <div class="dbt-an-kpi-body">
              <div class="dbt-an-kpi-val">{{ c.value }}</div>
              <div class="dbt-an-kpi-lbl">{{ c.label }}</div>
            </div>
          </div>
        </div>

        <div class="dbt-an-2col mb-4">
          <!-- Aging -->
          <div class="dbt-card pa-5">
            <h3 class="dbt-an-h">Возраст просрочки</h3>
            <div v-for="a in agingRows" :key="a.label" class="dbt-aging-row">
              <div class="dbt-aging-lbl">{{ a.label }}</div>
              <div class="dbt-aging-bar-wrap">
                <div class="dbt-aging-bar" :style="{ width: (a.amount / agingMax * 100) + '%', background: a.color }" />
              </div>
              <div class="dbt-aging-val">{{ formatCurrency(a.amount) }} <span class="dbt-sub">· {{ a.count }}</span></div>
            </div>
          </div>

          <!-- Обещания -->
          <div class="dbt-card pa-5">
            <h3 class="dbt-an-h">Обещания оплаты</h3>
            <div class="dbt-an-promises">
              <div class="dbt-an-pr"><span class="dbt-an-pr-val">{{ analytics.promises.made }}</span><span>Дано за период</span></div>
              <div class="dbt-an-pr"><span class="dbt-an-pr-val" style="color:#10b981">{{ analytics.promises.kept }}</span><span>Сдержано</span></div>
              <div class="dbt-an-pr"><span class="dbt-an-pr-val" style="color:#ef4444">{{ analytics.promises.broken }}</span><span>Нарушено</span></div>
              <div class="dbt-an-pr"><span class="dbt-an-pr-val" style="color:#f59e0b">{{ analytics.promises.pending }}</span><span>Ожидается</span></div>
            </div>
          </div>
        </div>

        <!-- По сотрудникам -->
        <div v-if="analytics.byStaff.length" class="dbt-card">
          <div class="pa-4"><h3 class="dbt-an-h mb-0">Работа сотрудников</h3></div>
          <v-table density="comfortable" class="dbt-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th class="text-center">Назначено</th>
                <th class="text-end">Просрочка</th>
                <th class="text-end">Взыскано</th>
                <th class="text-center">Обещаний</th>
                <th class="text-center">Сдержано / Нарушено</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in analytics.byStaff" :key="s.staffId">
                <td class="text-no-wrap">{{ s.staffName }}</td>
                <td class="text-center">{{ s.assignedCount }}</td>
                <td class="text-end text-no-wrap">{{ formatCurrency(s.overdueAmount) }}</td>
                <td class="text-end text-no-wrap" style="color:#10b981">{{ formatCurrency(s.collectedAmount) }}</td>
                <td class="text-center">{{ s.promisesMade }}</td>
                <td class="text-center text-no-wrap">
                  <span style="color:#10b981">{{ s.promisesKept }}</span> / <span style="color:#ef4444">{{ s.promisesBroken }}</span>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </template>
    </div>

    <!-- Модалка детали должника -->
    <DebtorDetailModal
      v-model="modalOpen"
      :row="liveSelectedRow"
      :can-activity="canActivity"
      :can-delete="isOwner"
      :can-assign="canAssign"
      @write="writeWhatsApp"
      @assign="(r) => { assignTargetIds = [r.dealId]; assignStaffId = r.assignedStaffId; assignOpen = true }"
    />

    <!-- Обещание из строки таблицы -->
    <PromiseDialog v-model="rowPromiseOpen" :row="rowPromiseRow" @saved="refreshAfterMutation()" />

    <!-- Диалог назначения сотрудника -->
    <v-dialog v-model="assignOpen" max-width="440">
      <v-card rounded="lg">
        <v-card-title class="d-flex align-center ga-2 pt-4">
          <v-icon icon="mdi-account-arrow-right-outline" color="primary" /> Назначить сотрудника
        </v-card-title>
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-4">
            Ответственный будет назначен на {{ assignTargetIds.length }} сделк{{ assignTargetIds.length === 1 ? 'у' : assignTargetIds.length < 5 ? 'и' : '' }}.
          </p>
          <v-radio-group v-model="assignStaffId" hide-details>
            <v-radio :value="null" label="— Без ответственного —" />
            <v-radio v-for="s in store.staff" :key="s.id" :value="s.id" :label="`${s.firstName} ${s.lastName}`" />
          </v-radio-group>
          <div v-if="!store.staff.length" class="text-body-2 text-medium-emphasis mt-2">
            Нет активных сотрудников. Добавьте их в разделе «Сотрудники».
          </div>
        </v-card-text>
        <v-card-actions class="px-4 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="assignOpen = false">Отмена</v-btn>
          <v-btn color="primary" variant="flat" rounded="lg" :loading="assigning" @click="confirmAssign">Назначить</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Нижний отступ, чтобы контент не был прижат к краю при прокрутке до конца */
.dbt-page { padding-bottom: 72px; }
.dbt-header { margin-bottom: 20px; }
.dbt-title { font-size: 24px; font-weight: 800; line-height: 1.2; color: rgba(var(--v-theme-on-surface), 0.92); }
.dbt-subtitle { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 4px; }

/* KPI */
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .stats-row { grid-template-columns: repeat(2, 1fr); gap: 8px; } }
.stat-card {
  display: flex; align-items: center; gap: 12px; padding: 16px;
  border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.stat-icon { width: 40px; height: 40px; min-width: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.stat-value { font-size: 18px; font-weight: 700; line-height: 1.2; color: rgba(var(--v-theme-on-surface), 0.9); }
.stat-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }

/* Табы — единый стиль проекта (из settings.vue) */
.settings-tabs {
  display: flex; gap: 4px; margin-bottom: 24px;
  padding: 4px; border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.settings-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 18px; border-radius: 8px; border: none;
  background: transparent;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
}
.settings-tab:hover { color: rgba(var(--v-theme-on-surface), 0.7); background: rgba(var(--v-theme-on-surface), 0.04); }
.settings-tab.active:hover { background: #047857; color: #fff; }
.settings-tab.active {
  background: #047857; color: #fff; font-weight: 600;
  box-shadow: 0 2px 6px rgba(4, 120, 87, 0.25);
}
.dbt-page.dark .settings-tabs { background: rgb(var(--v-theme-surface-deep)); border-color: rgb(var(--v-theme-border)); box-shadow: none; }
.dbt-tabcount {
  font-size: 11px; font-weight: 700; padding: 0 6px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.08); line-height: 18px; min-width: 20px; text-align: center;
}
.dbt-tabcount--on { background: rgba(255, 255, 255, 0.25); color: #fff; }
@media (max-width: 600px) {
  .settings-tabs { overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .settings-tabs::-webkit-scrollbar { display: none; }
  .settings-tab { flex-shrink: 0; white-space: nowrap; padding: 8px 14px; }
}

/* Карточка-контейнер — как секции проекта (12px, 1px бордер, без тени) */
.dbt-card {
  border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1); overflow: hidden;
}
/* Прилипающая пагинация (ServerPager) требует, чтобы карточка не обрезала
   содержимое — как .deals-card и .payments-card в соседних разделах. */
.dbt-card--list { overflow: visible; }

/* Кнопка тулбара — канонический .fb-btn (как на странице сделок) */
.fb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: #fff;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.12s;
}
.fb-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.2); color: rgba(var(--v-theme-on-surface), 0.8); }
.fb-btn--active { border-color: rgba(var(--v-theme-on-surface), 0.15); color: rgba(var(--v-theme-on-surface), 0.8); font-weight: 600; }
.dbt-page.dark .fb-btn { background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); }

/* Быстрый чип-фильтр */
.dbt-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 999px;
  border: 1px solid rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.06);
  font-size: 12.5px; font-weight: 600; color: #dc2626; cursor: pointer; transition: all 0.12s;
}
.dbt-chip:hover { background: rgba(239, 68, 68, 0.12); }
.dbt-chip.active { background: #ef4444; border-color: #ef4444; color: #fff; }
.dbt-chip-count { font-size: 11px; padding: 0 6px; border-radius: 9px; background: rgba(239, 68, 68, 0.15); }
.dbt-chip.active .dbt-chip-count { background: rgba(255, 255, 255, 0.25); }
.dbt-chip--neutral { border-color: rgba(var(--v-theme-on-surface), 0.16); background: transparent; color: rgba(var(--v-theme-on-surface), 0.65); }
.dbt-chip--neutral:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.dbt-chip--neutral.active { background: rgb(var(--v-theme-primary)); border-color: rgb(var(--v-theme-primary)); color: #fff; }

/* Панель выбора — как select-bar на странице сделок */
.dbt-selbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 16px; margin-bottom: 16px; border-radius: 12px;
  background: #fff; border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.dbt-page.dark .dbt-selbar { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
.dbt-selbar-left { display: flex; align-items: center; gap: 8px; }
.dbt-selbar-link {
  background: none;
  border: none;
  padding: 0;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.dbt-selbar-link:hover { opacity: 0.8; }
.dbt-selbar-count { font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.6); }
.dbt-selbar-right { display: flex; align-items: center; gap: 8px; }
.dbt-selbar-primary {
  display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 10px;
  border: none; background: #047857; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.dbt-selbar-primary:hover { background: #065f46; box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25); }
.dbt-selbar-cancel {
  display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s;
}
.dbt-selbar-cancel:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.dbt-slide-enter-active, .dbt-slide-leave-active { transition: all 0.2s ease; }
.dbt-slide-enter-from, .dbt-slide-leave-to { opacity: 0; transform: translateY(-8px); }
.dbt-row--sel { background: rgba(4, 120, 87, 0.06); }

/* Статус обещания (в колонке) */
.dbt-ps { display: inline-block; font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; margin-top: 2px; }
.ps--pending { background: rgba(245, 158, 11, 0.15); color: #b45309; }
.ps--kept { background: rgba(16, 185, 129, 0.15); color: #047857; }
.ps--broken { background: rgba(239, 68, 68, 0.15); color: #dc2626; }
.ps--superseded { background: rgba(148, 163, 184, 0.18); color: #64748b; }

/* Меню колонок */
.col-menu {
  background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px; padding: 8px; min-width: 220px; max-height: 380px; overflow-y: auto;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
}
.col-menu-title { font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: rgba(var(--v-theme-on-surface), 0.45); padding: 6px 10px 8px; }
.col-menu-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85); }
.col-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.col-menu-item input { width: 16px; height: 16px; accent-color: rgb(var(--v-theme-primary)); cursor: pointer; }

/* Поиск */
.dbt-search {
  display: flex; align-items: center; gap: 8px; padding: 8px 14px;
  border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  min-width: 260px; color: rgba(var(--v-theme-on-surface), 0.6);
}
.dbt-search input { flex: 1; border: none; background: none; outline: none; color: inherit; font-size: 14px; }

/* Таблица */
.dbt-table :deep(td) { font-size: 14px; }
.dbt-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important; white-space: nowrap;
}
.th-index, .td-index { width: 24px; min-width: 24px; padding-left: 2px; padding-right: 2px; text-align: center; font-variant-numeric: tabular-nums; }
.th-inner { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.th-sortable { cursor: pointer; user-select: none; }
.th-sortable .th-sort-ico { opacity: 0.35; transition: opacity 0.15s; }
.th-sortable:hover .th-sort-ico { opacity: 0.7; }
.th-sorted { color: rgb(var(--v-theme-primary)); }
.th-sorted .th-sort-ico { opacity: 1; color: rgb(var(--v-theme-primary)); }
.dbt-table th.text-end .th-inner { flex-direction: row-reverse; }

.dbt-deal-num { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.7); }
.dbt-phone { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.dbt-product { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; display: inline-block; vertical-align: bottom; }
.dbt-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.dbt-days { color: #ef4444; font-weight: 600; }
.dbt-staff { font-size: 13px; }
.dbt-unassigned { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.4); }
.dbt-dealstatus { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 6px; white-space: nowrap; background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.7); }
.dbt-dealstatus--completed { background: rgba(16, 185, 129, 0.15); color: #047857; }
.dbt-dealstatus--active { background: rgba(59, 130, 246, 0.14); color: #2563eb; }
.dbt-dealstatus--disputed { background: rgba(245, 158, 11, 0.15); color: #b45309; }
.dbt-dealstatus--cancelled { background: rgba(239, 68, 68, 0.14); color: #dc2626; }

/* Кнопка «Обещал оплатить» в строке */
.dbt-rowaction {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 8px; border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.1); color: #d98b09; cursor: pointer; transition: all 0.12s;
}
.dbt-rowaction:hover { background: #f59e0b; color: #fff; border-color: #f59e0b; }

/* Аналитика — пресеты периода (кнопки с диапазоном «от — до») */
.dbt-an-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
@media (max-width: 760px) { .dbt-an-presets { grid-template-columns: 1fr 1fr; } }
.dbt-an-preset { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgb(var(--v-theme-surface)); cursor: pointer; transition: all 0.15s; text-align: left; }
.dbt-an-preset:hover { border-color: rgba(var(--v-theme-on-surface), 0.25); }
.dbt-an-preset.active { border-color: #047857; background: rgba(4, 120, 87, 0.06); }
.dbt-an-preset-lbl { font-size: 13.5px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.dbt-an-preset.active .dbt-an-preset-lbl { color: #047857; }
.dbt-an-preset-range { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); font-variant-numeric: tabular-nums; }

/* Свой период + сотрудник + применить — стиль фильтров журнала кассы */
.dbt-an-custom { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 14px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
.dbt-an-clabel { font-size: 12px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.5); margin-right: 2px; }
.dbt-an-datebox { position: relative; display: inline-flex; align-items: center; cursor: pointer; }
.dbt-an-cal-ico { position: absolute; left: 9px; color: rgba(var(--v-theme-on-surface), 0.45); pointer-events: none; z-index: 1; }
.dbt-an-dateinput {
  height: 34px; width: 158px; padding: 0 10px 0 30px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.85);
  font-size: 13px; font-family: inherit; outline: none; cursor: pointer; transition: border-color 0.15s;
  color-scheme: light dark;
}
.dbt-an-dateinput:hover { border-color: rgba(var(--v-theme-on-surface), 0.22); }
.dbt-an-dateinput:focus { border-color: #047857; }
/* Прячем нативную иконку-индикатор — у нас своя слева, клик открывает showPicker */
.dbt-an-dateinput::-webkit-calendar-picker-indicator { opacity: 0; cursor: pointer; }
.dbt-an-dash { color: rgba(var(--v-theme-on-surface), 0.4); font-weight: 600; }

.dbt-an-staffwrap { position: relative; display: inline-flex; align-items: center; }
.dbt-an-staff-ico { position: absolute; left: 9px; color: rgba(var(--v-theme-on-surface), 0.4); pointer-events: none; }
.dbt-an-staff-caret { position: absolute; right: 8px; color: rgba(var(--v-theme-on-surface), 0.4); pointer-events: none; }
.dbt-an-staffsel {
  height: 34px; padding: 0 28px 0 30px; border-radius: 8px; min-width: 200px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.85);
  font-size: 13px; font-family: inherit; outline: none; cursor: pointer;
  appearance: none; -webkit-appearance: none; -moz-appearance: none; transition: border-color 0.15s;
}
.dbt-an-staffsel:hover { border-color: rgba(var(--v-theme-on-surface), 0.22); }
.dbt-an-staffsel:focus { border-color: #047857; }
@media (max-width: 640px) {
  .dbt-an-dateinput { flex: 1; width: auto; min-width: 0; }
  .dbt-an-staffwrap { flex: 1 1 100%; }
  .dbt-an-staffsel { width: 100%; }
  .dbt-an-custom .ml-auto { flex: 1 1 100%; margin-left: 0 !important; }
}
.dbt-an-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 900px) { .dbt-an-kpis { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .dbt-an-kpis { grid-template-columns: 1fr; } }
.dbt-an-kpi { display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-surface), 1); }
.dbt-an-kpi-ico { width: 40px; height: 40px; min-width: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.dbt-an-kpi-body { min-width: 0; }
.dbt-an-kpi-val { font-size: 19px; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dbt-an-kpi-lbl { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px; }
.dbt-an-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .dbt-an-2col { grid-template-columns: 1fr; } }
.dbt-an-h { font-size: 15px; font-weight: 700; margin-bottom: 14px; }
.dbt-aging-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.dbt-aging-lbl { width: 90px; font-size: 13px; flex-shrink: 0; }
.dbt-aging-bar-wrap { flex: 1; height: 10px; border-radius: 6px; background: rgba(var(--v-theme-on-surface), 0.06); overflow: hidden; }
.dbt-aging-bar { height: 100%; border-radius: 6px; min-width: 2px; transition: width 0.3s; }
.dbt-aging-val { font-size: 13px; font-weight: 600; white-space: nowrap; text-align: right; min-width: 120px; }
.dbt-an-promises { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.dbt-an-pr { display: flex; flex-direction: column; gap: 2px; padding: 14px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.04); }
.dbt-an-pr-val { font-size: 22px; font-weight: 800; }
.dbt-an-pr span:last-child { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); }

/* Настройки */
.dbt-set-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 24px; }
.dbt-set-ico { width: 44px; height: 44px; min-width: 44px; border-radius: 12px; background: rgba(4, 120, 87, 0.1); color: #047857; display: flex; align-items: center; justify-content: center; }
.dbt-set-title { font-size: 17px; font-weight: 800; }
.dbt-set-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 3px; }
.dbt-set-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 640px) { .dbt-set-grid { grid-template-columns: 1fr; } }
.dbt-set-field { padding: 16px; border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-on-surface), 0.02); }
.dbt-set-field-head { display: flex; align-items: center; gap: 8px; }
.dbt-set-field-title { font-size: 14px; font-weight: 700; }
.dbt-set-field-hint { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); margin: 6px 0 12px; line-height: 1.4; }
.dbt-saved { display: inline-flex; align-items: center; gap: 5px; color: #10b981; font-size: 13px; font-weight: 600; }

@media (max-width: 600px) {
  .dbt-search { min-width: 0; width: 100%; }
}
</style>
