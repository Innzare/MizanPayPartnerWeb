<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDebtorsStore, type DebtorRow, type PromiseStatus, type DebtorAnalytics } from '@/stores/debtors'
import { useAuthStore } from '@/stores/auth'
import ClientLink from '@/components/ClientLink.vue'
import DateField from '@/components/DateField.vue'
import { useSections } from '@/composables/useSections'
import { useIsDark } from '@/composables/useIsDark'
import { useIsMobile } from '@/composables/useIsMobile'
import { formatCurrency, formatDateShort, pluralizeRu } from '@/utils/formatters'
import ServerPager from '@/components/ServerPager.vue'
import { useAutoLoad } from '@/composables/useAutoLoad'
import { PER_PAGE_OPTIONS, useListSort, usePageSize } from '@/composables/useListPrefs'
import { useVirtualRows } from '@/composables/useVirtualRows'
import { useDebtorsFilters } from '@/composables/useDebtorsFilters'
import { useCapital } from '@/composables/useCapital'
import DebtorsFilterPanel from '@/components/DebtorsFilterPanel.vue'
import { api } from '@/api/client'
import DebtorDetailModal from '@/components/DebtorDetailModal.vue'
import MetricDetailDialog from '@/components/MetricDetailDialog.vue'
import type { MetricDetailItem } from '@/components/MetricDetailDialog.vue'
import { useToast } from '@/composables/useToast'
import { pluralDays } from '@/utils/paymentAttribution'
import PromiseDialog from '@/components/PromiseDialog.vue'

const store = useDebtorsStore()
const auth = useAuthStore()
/** Подсказку про адрес показываем только тем, кто по нему реально ищет. */
const canSearchAddress = computed(() => auth.can('clients.view'))
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

/** Открыть саму сделку — из строки должника это самый частый следующий шаг. */
function openDealPage(row: DebtorRow, e?: Event) {
  e?.stopPropagation()
  router.push(`/deals/${row.dealId}`)
}

// ── Тень у закреплённой колонки действий (как на странице сделок) ──
// Показываем её, только когда справа реально осталось что прокручивать.
const tableWrapRef = ref<HTMLElement | null>(null)
const hasHiddenColumns = ref(false)

function updateScrollShadow() {
  const el = tableWrapRef.value
  if (!el) {
    hasHiddenColumns.value = false
    return
  }
  hasHiddenColumns.value = el.scrollWidth - el.clientWidth - el.scrollLeft > 1
}

function bindTableScroll() {
  const el = document.querySelector('.dbt-table .v-table__wrapper') as HTMLElement | null
  if (el && el === tableWrapRef.value) {
    updateScrollShadow()
    return
  }
  tableWrapRef.value?.removeEventListener('scroll', updateScrollShadow)
  tableWrapRef.value = el
  el?.addEventListener('scroll', updateScrollShadow, { passive: true })
  updateScrollShadow()
}

// ── Настраиваемые колонки таблицы ──
/**
 * Колонка таблицы. Оформление ячейки описано здесь, а не в разметке: ячейки
 * рисуются циклом по текущему порядку колонок, и «прибить» классы к месту в
 * шаблоне больше нельзя.
 */
interface Col {
  key: string
  label: string
  align: 'start' | 'end' | 'center'
  sortable: boolean
  tdClass?: string
  tdStyle?: string
  /** Раздел в меню выбора: плоский список из двух десятков колонок неудобен. */
  group: ColGroup
}

type ColGroup = 'debtor' | 'overdue' | 'payments' | 'work'

const COLUMN_GROUPS: { key: ColGroup; label: string }[] = [
  { key: 'debtor', label: 'Должник' },
  { key: 'overdue', label: 'Просрочка' },
  { key: 'payments', label: 'Платежи' },
  { key: 'work', label: 'Работа с должником' },
]

const ALL_COLUMNS: Col[] = [
  // ── Должник ──
  { key: 'dealNumber', label: '№', align: 'start', sortable: true, group: 'debtor', tdClass: 'text-start text-no-wrap' },
  { key: 'client', label: 'Клиент', align: 'start', sortable: true, group: 'debtor', tdStyle: 'min-width: 220px;' },
  { key: 'clientPhone', label: 'Телефон', align: 'start', sortable: false, group: 'debtor', tdClass: 'text-no-wrap' },
  { key: 'product', label: 'Товар', align: 'start', sortable: true, group: 'debtor' },
  { key: 'status', label: 'Статус договора', align: 'start', sortable: true, group: 'debtor', tdClass: 'text-start text-no-wrap' },
  { key: 'total', label: 'Сумма договора', align: 'end', sortable: true, group: 'debtor', tdClass: 'text-end text-no-wrap' },

  // ── Просрочка ──
  { key: 'overdueAmount', label: 'Сумма просрочки', align: 'end', sortable: true, group: 'overdue', tdClass: 'text-end text-no-wrap font-weight-bold' },
  { key: 'overdueCount', label: 'Просрочек', align: 'center', sortable: true, group: 'overdue', tdClass: 'text-center text-no-wrap' },
  { key: 'overdueDays', label: 'Дней просрочки', align: 'end', sortable: true, group: 'overdue', tdClass: 'text-end text-no-wrap' },
  { key: 'remaining', label: 'Остаток долга', align: 'end', sortable: true, group: 'overdue', tdClass: 'text-end text-no-wrap text-medium-emphasis' },

  // ── Платежи ──
  { key: 'nextPayment', label: 'Следующий платёж', align: 'end', sortable: true, group: 'payments', tdClass: 'text-end text-no-wrap' },
  { key: 'paymentsProgress', label: 'Платежей оплачено', align: 'center', sortable: false, group: 'payments', tdClass: 'text-center text-no-wrap' },
  { key: 'progress', label: 'Прогресс', align: 'center', sortable: true, group: 'payments', tdClass: 'text-center', tdStyle: 'min-width: 130px;' },

  // ── Работа с должником ──
  { key: 'assignedStaff', label: 'Ответственный', align: 'start', sortable: true, group: 'work', tdClass: 'text-start text-no-wrap' },
  { key: 'promised', label: 'Обещал оплатить', align: 'end', sortable: true, group: 'work', tdClass: 'text-end text-no-wrap' },
  { key: 'promisedAmount', label: 'Обещанная сумма', align: 'end', sortable: false, group: 'work', tdClass: 'text-end text-no-wrap' },
  { key: 'lastActivity', label: 'Последний контакт', align: 'start', sortable: true, group: 'work', tdClass: 'text-start text-no-wrap' },
  { key: 'lastActivityText', label: 'Что было в контакте', align: 'start', sortable: false, group: 'work', tdStyle: 'min-width: 220px;' },
]

const DEFAULT_VISIBLE = ['dealNumber', 'client', 'overdueAmount', 'overdueCount', 'overdueDays', 'nextPayment', 'promised', 'assignedStaff']
const COLS_STORAGE_KEY = 'debtors:table-columns'

function loadVisibleCols(): Record<string, boolean> {
  const base: Record<string, boolean> = {}
  for (const c of ALL_COLUMNS) base[c.key] = DEFAULT_VISIBLE.includes(c.key)
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_STORAGE_KEY) || 'null')
    if (saved && typeof saved === 'object') {
      // Только известные ключи: набор колонок со временем меняется, и мусор из
      // старой версии не должен ломать таблицу.
      for (const c of ALL_COLUMNS) if (typeof saved[c.key] === 'boolean') base[c.key] = saved[c.key]
    }
  } catch { /* ignore */ }
  return base
}
const visibleCols = ref<Record<string, boolean>>(loadVisibleCols())
watch(visibleCols, (v) => {
  try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(v)) } catch { /* ignore */ }
}, { deep: true })

// ── Порядок колонок ──
// Одному важнее дни просрочки, другому — обещания. Порядок настраивается
// перетаскиванием и хранится рядом с набором колонок.
const COLS_ORDER_KEY = 'debtors:table-column-order'
const DEFAULT_ORDER = ALL_COLUMNS.map((c) => c.key)

function loadColumnOrder(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_ORDER_KEY) || 'null')
    if (Array.isArray(saved)) {
      const known = saved.filter((k: unknown): k is string => typeof k === 'string' && DEFAULT_ORDER.includes(k))
      // Колонки, появившиеся после сохранения порядка, встают на своё место из
      // умолчания, а не сваливаются в конец.
      DEFAULT_ORDER.forEach((key) => {
        if (known.includes(key)) return
        const at = DEFAULT_ORDER.indexOf(key)
        const prev = DEFAULT_ORDER.slice(0, at).reverse().find((k) => known.includes(k))
        known.splice(prev ? known.indexOf(prev) + 1 : 0, 0, key)
      })
      return known
    }
  } catch { /* ignore */ }
  return [...DEFAULT_ORDER]
}
const columnOrder = ref<string[]>(loadColumnOrder())
watch(columnOrder, (v) => {
  try { localStorage.setItem(COLS_ORDER_KEY, JSON.stringify(v)) } catch { /* ignore */ }
}, { deep: true })

/** Все колонки в пользовательском порядке — для меню настройки. */
const orderedColumns = computed(
  () => columnOrder.value.map((k) => ALL_COLUMNS.find((c) => c.key === k)).filter(Boolean) as Col[],
)
/** Те же, но только включённые — по ним рисуется таблица. */
const shownColumns = computed(() => orderedColumns.value.filter((c) => visibleCols.value[c.key]))
function toggleColumn(key: string) { visibleCols.value[key] = !visibleCols.value[key] }

// ── Поиск и наборы колонок ──
const colSearch = ref('')

/** Колонки для меню: в пользовательском порядке, отфильтрованные поиском. */
const menuColumns = computed(() => {
  const q = colSearch.value.trim().toLowerCase()
  const list = orderedColumns.value
  return q ? list.filter((c) => c.label.toLowerCase().includes(q)) : list
})

/** Колонки меню по разделам. Пустые разделы не показываем. */
const menuGroups = computed(() =>
  COLUMN_GROUPS.map((g) => ({
    ...g,
    columns: menuColumns.value.filter((c) => c.group === g.key),
  })).filter((g) => g.columns.length),
)

/** Готовые наборы под частые задачи. */
const COLUMN_PRESETS: { key: string; label: string; columns: string[] }[] = [
  { key: 'min', label: 'Минимум', columns: ['dealNumber', 'client', 'overdueAmount', 'overdueDays'] },
  {
    key: 'calls',
    label: 'Для обзвона',
    columns: ['dealNumber', 'client', 'clientPhone', 'overdueAmount', 'overdueDays', 'promised', 'lastActivityText'],
  },
  {
    key: 'money',
    label: 'Деньги',
    columns: ['dealNumber', 'client', 'total', 'remaining', 'overdueAmount', 'nextPayment', 'progress'],
  },
  {
    key: 'work',
    label: 'Работа с должником',
    columns: ['dealNumber', 'client', 'assignedStaff', 'promised', 'promisedAmount', 'lastActivity', 'lastActivityText'],
  },
  { key: 'full', label: 'Полный', columns: ALL_COLUMNS.map((c) => c.key) },
]

// ── Свои наборы колонок ──
// Готовых не хватает: у каждого партнёра свой привычный набор. Хранятся в
// браузере — это личная привычка, а не настройка компании.
const COL_PRESETS_KEY = 'debtors:column-presets'
const savedColPresets = ref<Array<{ id: string; name: string; columns: string[]; order: string[] }>>(
  loadColPresets(),
)
const colPresetName = ref('')

function loadColPresets(): Array<{ id: string; name: string; columns: string[]; order: string[] }> {
  try {
    const raw = JSON.parse(localStorage.getItem(COL_PRESETS_KEY) || 'null')
    if (!raw || !Array.isArray(raw.items)) return []
    return raw.items.filter((x: any) => x && typeof x.name === 'string' && Array.isArray(x.columns))
  } catch {
    return []
  }
}

function persistColPresets() {
  try {
    localStorage.setItem(COL_PRESETS_KEY, JSON.stringify({ v: 1, items: savedColPresets.value }))
  } catch { /* ignore */ }
}

function saveColPreset() {
  const name = colPresetName.value.trim()
  if (!name) return
  const columns = shownColumns.value.map((c) => c.key)
  const order = columnOrder.value.slice()
  const existing = savedColPresets.value.find((p) => p.name.toLowerCase() === name.toLowerCase())
  if (existing) Object.assign(existing, { columns, order })
  else savedColPresets.value.push({ id: `c${Date.now()}`, name, columns, order })
  persistColPresets()
  colPresetName.value = ''
}

function applySavedColPreset(p: { columns: string[]; order: string[] }) {
  const next: Record<string, boolean> = {}
  ALL_COLUMNS.forEach((c) => { next[c.key] = p.columns.includes(c.key) })
  visibleCols.value = next
  // Незнакомые ключи из старого набора отбрасываем, пропавшие — дописываем.
  const known = p.order.filter((k) => DEFAULT_ORDER.includes(k))
  columnOrder.value = [...known, ...DEFAULT_ORDER.filter((k) => !known.includes(k))]
}

function removeColPreset(p: { id: string; name: string }) {
  if (!confirm(`Удалить набор колонок «${p.name}»?`)) return
  savedColPresets.value = savedColPresets.value.filter((x) => x.id !== p.id)
  persistColPresets()
}

function applyColumnPreset(preset: { columns: string[] }) {
  const next: Record<string, boolean> = {}
  ALL_COLUMNS.forEach((c) => { next[c.key] = preset.columns.includes(c.key) })
  visibleCols.value = next
  // Порядок ставим как в наборе, остальные — следом: иначе «Для обзвона»
  // показал бы нужные колонки в случайных местах таблицы.
  const rest = DEFAULT_ORDER.filter((k) => !preset.columns.includes(k))
  columnOrder.value = [...preset.columns.filter((k) => DEFAULT_ORDER.includes(k)), ...rest]
}

function resetColumns() {
  columnOrder.value = [...DEFAULT_ORDER]
  const base: Record<string, boolean> = {}
  ALL_COLUMNS.forEach((c) => { base[c.key] = DEFAULT_VISIBLE.includes(c.key) })
  visibleCols.value = base
}

// ── Перетаскивание колонок ──
// Тащить можно и строку в меню, и сам заголовок в таблице — состояние одно.
const dragColKey = ref<string | null>(null)

function moveColumn(fromKey: string, toKey: string) {
  if (fromKey === toKey) return
  const next = columnOrder.value.slice()
  const from = next.indexOf(fromKey)
  const to = next.indexOf(toKey)
  if (from < 0 || to < 0) return
  const [moved] = next.splice(from, 1)
  if (!moved) return
  next.splice(to, 0, moved)
  columnOrder.value = next
}

function onColDragStart(key: string, e: DragEvent) {
  dragColKey.value = key
  // Без данных Firefox не начинает перетаскивание вовсе.
  e.dataTransfer?.setData('text/plain', key)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
/** Переставляем прямо во время перетаскивания — видно, куда встанет колонка. */
function onColDragOver(key: string, e: DragEvent) {
  e.preventDefault()
  if (!dragColKey.value || dragColKey.value === key) return
  moveColumn(dragColKey.value, key)
}
// Отпустили колонку — сортировку не трогаем: у части браузеров следом за
// перетаскиванием прилетает обычный клик по заголовку.
let justDraggedCol = false
function onColDragEnd() {
  dragColKey.value = null
  justDraggedCol = true
  setTimeout(() => { justDraggedCol = false }, 0)
}

// ── Сортировка ──
// Сортировка запоминается наравне с колонками: партнёр настроил список под
// себя, ушёл в сделку и вернулся — порядок должен быть тем же.
const { col: sortCol, dir: sortDir } = useListSort<string>('debtors:table-sort', 'overdueDays')
/** Текстовые колонки логичнее сортировать по возрастанию — от «А». */
const TEXT_COLS = new Set(['client', 'product', 'assignedStaff'])

function toggleSort(key: string) {
  // Отпустили колонку после перетаскивания — это не клик по сортировке.
  if (dragColKey.value || justDraggedCol) return
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
/**
 * Выбранные условия по обещаниям. Несколько сразу: «обещал сегодня» и
 * «обещал завтра» складываются по «или» — человек ищет, кого обзванивать, а
 * не пересечение условий, которого не бывает. Пустой набор = все.
 */
const promiseFilters = ref<PromiseFilter[]>([])
/** Для сервера и старых мест, где ждут одну строку: `today,tomorrow`. */
const promiseParam = computed(() => promiseFilters.value.join(','))
const PROMISE_FILTERS: { key: PromiseFilter; label: string }[] = [
  { key: 'has', label: 'Есть обещание' },
  { key: 'today', label: 'Обещал сегодня' },
  { key: 'tomorrow', label: 'Обещал завтра' },
  { key: 'next7', label: 'Ближайшие 7 дней' },
  { key: 'overdue', label: 'Просроченные обещания' },
  { key: 'broken', label: 'Нарушенные обещания' },
  { key: 'none', label: 'Без обещания' },
]
const promiseFilterLabel = computed(() => {
  const n = promiseFilters.value.length
  if (!n) return 'Все'
  if (n === 1) return PROMISE_FILTERS.find((f) => f.key === promiseFilters.value[0])?.label || 'Все'
  // Два условия ещё читаются целиком; дальше в кнопке остаётся бейдж с
  // числом — перечисление превращало бы её в строку текста.
  return n === 2
    ? promiseFilters.value.map((k) => PROMISE_FILTERS.find((f) => f.key === k)?.label).join(', ')
    : 'несколько'
})
function hasPromiseFilter(key: PromiseFilter): boolean {
  return promiseFilters.value.includes(key)
}
function togglePromiseFilter(key: PromiseFilter) {
  promiseFilters.value = hasPromiseFilter(key)
    ? promiseFilters.value.filter((k) => k !== key)
    : [...promiseFilters.value, key]
}

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

const PAGE_SIZE_KEY = 'debtors:page-size'
const perPage = usePageSize(PAGE_SIZE_KEY)
const page = ref(1)

const displayedRows = computed(() => (isArchive.value ? store.archiveRows : store.rows))

// Виртуализация: в разметке живут только видимые строки — иначе тысяча
// должников по два десятка колонок кладёт страницу ещё до первого клика.
const tableViewport = ref<HTMLElement | null>(null)
const virtual = useVirtualRows(displayedRows, { viewport: tableViewport, estimatedRowHeight: 56 })
const markerRow = virtual.markerRow

/** Колонок в строке — сколько занимать распоркам. */
const columnCount = computed(() => shownColumns.value.length + 2 + (selectMode.value ? 1 : 0))
const totalRows = computed(() => (isArchive.value ? store.archiveTotal : store.total))
const listLoading = computed(() => (isArchive.value ? store.archiveLoading : store.loading))

/** Фильтр «Мои» разворачивается в конкретного сотрудника — сервер знает только id. */
const assigneeParam = computed(() => {
  const f = assigneeFilter.value
  if (f === 'all') return null
  if (f === 'mine') return myStaffId.value
  return f
})

// ── Расширенные фильтры ──
// Та же панель, что в сделках и платежах. Состав свой: здесь отбирают по
// глубине просрочки.
const filtersOpen = ref(false)
const selectedClientLabel = ref('')
const filters = useDebtorsFilters({ labels: () => ({ client: selectedClientLabel.value }) })

watch(
  () => filters.state.value.clientKey,
  async (key) => {
    if (!key.startsWith('cp:')) { selectedClientLabel.value = ''; return }
    try {
      const p = await api.get<any>(`/client-profiles/${key.slice(3)}`)
      selectedClientLabel.value = [p.lastName, p.firstName].filter(Boolean).join(' ') || 'клиент'
    } catch {
      selectedClientLabel.value = 'клиент'
    }
  },
)

function pageParams() {
  return {
    q: search.value,
    promise: promiseParam.value,
    assignee: assigneeParam.value,
    sort: sortCol.value,
    dir: sortDir.value,
    limit: perPage.value,
    offset: (page.value - 1) * perPage.value,
    extra: filters.query.value,
  }
}

// Смена условий возвращает на первую страницу: иначе можно оказаться на
// сороковой странице выборки, где всего две.
watch(
  () => filters.query.value,
  () => {
    if (page.value !== 1) page.value = 1
    else loadPage()
  },
  { deep: true },
)

function loadPage() {
  if (isArchive.value) store.fetchArchive(pageParams())
  else store.fetchDebtors(pageParams())
}

// ── Автоподгрузка ────────────────────────────────────────────────────
// Настройка своя у раздела: в сделках может быть включена, здесь — нет.
const loadedCount = computed(() => displayedRows.value.length)
const hasMore = computed(() => loadedCount.value < totalRows.value)

async function loadNextChunk() {
  if (!hasMore.value || listLoading.value) return
  const params = { ...pageParams(), offset: loadedCount.value }
  if (isArchive.value) await store.fetchArchive(params, true)
  else await store.fetchDebtors(params, true)
}

const autoLoad = useAutoLoad({
  storageKey: 'debtors:auto-load',
  hasMore,
  busy: listLoading,
  loadMore: loadNextChunk,
})
/** Метка конца списка — её отслеживает автоподгрузка. */
const autoLoadSentinel = autoLoad.sentinel

// Переключение режима всегда возвращает к началу выборки, иначе счётчик
// «показано N» врал бы про уже пролистанные страницы.
watch(
  () => autoLoad.enabled.value,
  () => {
    autoLoad.reset()
    if (page.value !== 1) page.value = 1
    else loadPage()
  },
)

/** После правки обещания меняются и строка списка, и счётчик нарушенных. */
function refreshAfterMutation() {
  loadPage()
  if (auth.can('debtors.kpi')) store.fetchKpi()
}

// Любая смена условий возвращает на первую страницу — иначе можно оказаться
// на 40-й странице выборки, где всего две.
// Таблица перерисовывается при смене набора колонок и содержимого — обёртку
// прокрутки надо находить заново, иначе тень «залипнет».
watch(
  () => [visibleCols.value, store.rows, store.archiveRows],
  () => { void nextTick(bindTableScroll) },
  { deep: true },
)

watch([search, promiseParam, assigneeFilter, sortCol, sortDir, perPage], () => {
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
/** Быстрый чип — тот же набор: нажатие добавляет или снимает условие. */
function toggleQuickFilter(f: PromiseFilter) { togglePromiseFilter(f) }

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
        ? { mode: isArchive.value ? 'archive' : 'active', q: search.value, promise: promiseParam.value, assignee: assigneeParam.value }
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
  // Капитал общий на всё приложение — тянем один раз за сессию.
  if (!capitalLoaded.value) void fetchCapital()
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

/**
 * Доля от вложенного в дело — та же мера, что в «Своевременности платежей» на
 * странице аналитики: база totalCapital (собственный капитал партнёра плюс
 * капитал со-инвесторов). Просрочка в рублях не показывает масштаб — процент
 * отвечает, какая часть вложенных денег зависла у должников.
 *
 * Аналитика должников не режется по кассам, поэтому база — общая по партнёру.
 * У того, кому финансы закрыты правами или тарифом, запрос молча отваливается
 * и процент не показывается вовсе.
 */
const { capital: capitalSummary, loaded: capitalLoaded, fetchCapital } = useCapital()
const investedBase = computed(() => Math.max(0, capitalSummary.value?.totalCapital ?? 0))

/** «12,4%», «45%» или «<0,1%». null — базы нет или считать нечего. */
function pctOfInvested(amount: number): string | null {
  if (investedBase.value <= 0 || amount <= 0) return null
  const pct = (amount / investedBase.value) * 100
  if (pct < 0.1) return '<0,1%'
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1).replace('.', ',')}%`
}

const investedHint = computed(() =>
  'Какую часть вложенных в дело денег составляет эта сумма. Вложено — '
  + `собственный капитал плюс капитал со-инвесторов: ${formatCurrency(investedBase.value)}. `
  + 'Считаем: сумма ÷ вложено × 100.',
)

const agingRows = computed(() => {
  const a = analytics.value?.aging
  if (!a) return []
  return [
    { key: 'd1_7', label: '1–7 дней', ...a.d1_7, color: '#f59e0b' },
    { key: 'd8_30', label: '8–30 дней', ...a.d8_30, color: '#f97316' },
    { key: 'd31_60', label: '31–60 дней', ...a.d31_60, color: '#ef4444' },
    { key: 'd61_90', label: '61–90 дней', ...a.d61_90, color: '#dc2626' },
    { key: 'd91_180', label: '91–180 дней', ...a.d91_180, color: '#b91c1c' },
    { key: 'd180p', label: '180+ дней', ...a.d180p, color: '#7f1d1d' },
  ]
})
const agingMax = computed(() => Math.max(1, ...agingRows.value.map((r) => r.amount)))

// ── Расшифровка полосы возраста: какие сделки за ней стоят ──
// Сделки, а не платежи: у должника бывает по пять просроченных месяцев, и в
// строке видно «5 платежей просрочено». Отбор — тот же, что у полосы (сервер),
// поэтому список сходится с цифрой.
interface AgingDetailRow {
  dealId: string
  dealNumber: number
  productName: string
  clientName: string
  payments: number
  amount: number
  days: number
}
const toast = useToast()
const AGING_PAGE = 100
const agingOpen = ref(false)
const agingTitle = ref('')
const agingColor = ref('')
const agingBucket = ref<string | null>(null)
const agingStaff = ref<string | null>(null)
const agingItems = ref<MetricDetailItem[]>([])
const agingTotal = ref(0)
const agingCount = ref(0)
const agingLoading = ref(false)
const agingHasMore = computed(() => agingItems.value.length < agingCount.value)

function agingItem(r: AgingDetailRow): MetricDetailItem {
  return {
    id: r.dealId,
    title: r.productName || 'Сделка',
    subtitle: r.clientName || '—',
    value: r.amount,
    parts: [
      { label: '', value: `${r.payments} ${pluralizeRu(r.payments, 'платёж просрочен', 'платежа просрочено', 'платежей просрочено')}` },
      { label: 'самая старая просрочка', value: `${r.days} ${pluralDays(r.days)}` },
      { label: 'договор', value: `№${r.dealNumber}` },
    ],
  }
}

async function fetchAgingPage(offset: number) {
  const qs = new URLSearchParams({ limit: String(AGING_PAGE), offset: String(offset) })
  if (agingBucket.value) qs.set('bucket', agingBucket.value)
  if (agingStaff.value) qs.set('staffId', agingStaff.value)
  return api.get<{ items: AgingDetailRow[]; count: number; total: number }>(`/debtors/analytics/aging-details?${qs}`)
}

/** Открыть сделки полосы. Пустую не открываем — показывать нечего. */
async function openAging(row: { key: string; label: string; count: number; color: string }) {
  if (!row.count) return
  agingBucket.value = row.key
  // Ответственный — тот, по которому посчитана аналитика на экране.
  agingStaff.value = anStaffId.value || null
  agingTitle.value = `Просрочка ${row.label}`
  agingColor.value = row.color
  agingItems.value = []
  agingTotal.value = 0
  agingCount.value = 0
  agingOpen.value = true
  agingLoading.value = true
  try {
    const res = await fetchAgingPage(0)
    agingItems.value = res.items.map(agingItem)
    agingCount.value = res.count
    agingTotal.value = res.total
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить сделки')
  } finally {
    agingLoading.value = false
  }
}

async function loadMoreAging() {
  if (agingLoading.value) return
  agingLoading.value = true
  try {
    const res = await fetchAgingPage(agingItems.value.length)
    agingItems.value = [...agingItems.value, ...res.items.map(agingItem)]
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить ещё')
  } finally {
    agingLoading.value = false
  }
}

interface DebtorKpiCard {
  label: string
  value: string
  icon: string
  color: string
  /** Доля от вложенного — только у денежных показателей. */
  pct?: string | null
}

const kpiCards = computed<DebtorKpiCard[]>(() => {
  const k = analytics.value?.kpi
  if (!k) return []
  return [
    { label: 'Должников', value: String(k.debtorsCount), icon: 'mdi-account-alert-outline', color: '#ef4444' },
    { label: 'Сумма просрочки', value: formatCurrency(k.overdueTotal), icon: 'mdi-cash-remove', color: '#f59e0b', pct: pctOfInvested(k.overdueTotal) },
    { label: 'Просроченных платежей', value: String(k.overdueCount), icon: 'mdi-calendar-alert', color: '#f97316' },
    { label: 'Средняя просрочка', value: `${k.avgOverdueDays} дн.`, icon: 'mdi-clock-alert-outline', color: '#8b5cf6' },
    { label: 'Остаток к получению', value: formatCurrency(k.remainingTotal), icon: 'mdi-wallet-outline', color: '#3b82f6', pct: pctOfInvested(k.remainingTotal) },
    { label: 'Взыскано за период', value: formatCurrency(k.collectedAmount), icon: 'mdi-cash-check', color: '#10b981', pct: pctOfInvested(k.collectedAmount) },
    { label: 'Назначено', value: String(k.assigned), icon: 'mdi-account-check-outline', color: '#047857' },
    { label: 'Не назначено', value: String(k.unassigned), icon: 'mdi-account-question-outline', color: '#64748b' },
  ]
})

watch(tab, (t) => {
  if (t === 'analytics' && !analytics.value) loadAnalytics()
})

onMounted(() => {
  loadPage()
  void nextTick(bindTableScroll)
  window.addEventListener('resize', updateScrollShadow)
  if (auth.can('debtors.kpi')) store.fetchKpi()
  if (canSettings.value) store.fetchSettings()
  if (canAssign.value) store.fetchStaff()
})

onUnmounted(() => {
  tableWrapRef.value?.removeEventListener('scroll', updateScrollShadow)
  window.removeEventListener('resize', updateScrollShadow)
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
    <div class="page-tabs">
      <button class="page-tab" :class="{ active: tab === 'list' }" @click="tab = 'list'">
        <v-icon icon="mdi-account-alert-outline" size="18" />
        <span>Должники</span>
        <span class="page-tab-count">{{ stats.count }}</span>
      </button>
      <button class="page-tab" :class="{ active: tab === 'archive' }" @click="tab = 'archive'">
        <v-icon icon="mdi-archive-outline" size="18" />
        <span>Архив</span>
        <span v-if="store.archiveTotal" class="page-tab-count">{{ store.archiveTotal }}</span>
      </button>
      <button class="page-tab" :class="{ active: tab === 'analytics' }" @click="tab = 'analytics'">
        <v-icon icon="mdi-chart-box-outline" size="18" />
        <span>Аналитика</span>
      </button>
      <button v-if="canSettings" class="page-tab" :class="{ active: tab === 'settings' }" @click="tab = 'settings'">
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
                <div class="col-menu-head">
                  <span class="col-menu-title">Колонки таблицы</span>
                  <button class="col-menu-reset" @click="resetColumns">Сбросить</button>
                </div>

                <!-- Готовые наборы под частые задачи: обзвон, деньги, работа. -->
                <div class="col-menu-presets">
                  <button
                    v-for="p in COLUMN_PRESETS"
                    :key="p.key"
                    type="button"
                    class="col-menu-preset"
                    @click="applyColumnPreset(p)"
                  >{{ p.label }}</button>
                </div>

                <!-- Свои наборы: сохранённый состав и порядок колонок. -->
                <div v-if="savedColPresets.length" class="col-menu-presets col-menu-presets--own">
                  <span v-for="p in savedColPresets" :key="p.id" class="col-menu-own">
                    <button type="button" class="col-menu-own-apply" @click="applySavedColPreset(p)">
                      {{ p.name }}
                    </button>
                    <button type="button" class="col-menu-own-del" title="Удалить набор" @click="removeColPreset(p)">
                      <v-icon icon="mdi-close" size="11" />
                    </button>
                  </span>
                </div>

                <div class="col-menu-save">
                  <input
                    v-model="colPresetName"
                    type="text"
                    placeholder="Сохранить набор как…"
                    @keyup.enter="saveColPreset"
                  />
                  <button :disabled="!colPresetName.trim()" @click="saveColPreset">Сохранить</button>
                </div>

                <div class="col-menu-search">
                  <v-icon icon="mdi-magnify" size="15" />
                  <input v-model="colSearch" type="text" placeholder="Найти колонку" />
                  <button v-if="colSearch" class="col-menu-search-clear" @click="colSearch = ''">
                    <v-icon icon="mdi-close" size="13" />
                  </button>
                </div>

                <div class="col-menu-hint">
                  Потяните за <v-icon icon="mdi-drag-horizontal-variant" size="13" />, чтобы поменять порядок
                </div>

                <div v-for="g in menuGroups" :key="g.key" class="col-menu-group">
                  <div class="col-menu-group-title">{{ g.label }}</div>
                  <div
                    v-for="c in g.columns"
                    :key="c.key"
                    class="col-menu-item"
                    :class="{ 'col-menu-item--dragging': dragColKey === c.key }"
                    draggable="true"
                    @dragstart="onColDragStart(c.key, $event)"
                    @dragover="onColDragOver(c.key, $event)"
                    @dragend="onColDragEnd"
                    @drop.prevent="onColDragEnd"
                  >
                    <v-icon icon="mdi-drag-horizontal-variant" size="16" class="col-menu-grip" />
                    <label class="col-menu-label">
                      <input type="checkbox" :checked="visibleCols[c.key]" @change="toggleColumn(c.key)" />
                      <span>{{ c.label }}</span>
                    </label>
                  </div>
                </div>

                <div v-if="!menuGroups.length" class="col-menu-empty">Ничего не найдено</div>
              </div>
            </v-menu>

            <!-- Фильтр по колонке «Обещал оплатить» -->
                          <!-- Расширенные фильтры: суммы, дни просрочки, товар, клиент. -->
              <button
                class="fb-btn"
                :class="{ 'fb-btn--active': filters.hasAny.value }"
                @click="filtersOpen = true"
              >
                <v-icon icon="mdi-filter-variant" size="16" />
                <span>Фильтры</span>
                <span v-if="filters.activeCount.value" class="fb-btn-count">{{ filters.activeCount.value }}</span>
              </button>

              <v-menu :close-on-content-click="false" location="bottom start">
              <template #activator="{ props: menuProps }">
                <button class="fb-btn" :class="{ 'fb-btn--active': promiseFilters.length > 0 }" v-bind="menuProps">
                  <v-icon icon="mdi-hand-coin-outline" size="16" />
                  <span>Обещание: {{ promiseFilterLabel }}</span>
                  <span v-if="promiseFilters.length > 2" class="fb-btn-count">{{ promiseFilters.length }}</span>
                </button>
              </template>
              <!-- Меню не закрывается по клику: отметок обычно ставят
                   несколько, и закрытие после первой заставляло бы открывать
                   его заново на каждое условие. -->
              <div class="col-menu" @click.stop>
                <div class="col-menu-head">
                  <span class="col-menu-title">Фильтр обещаний</span>
                  <button v-if="promiseFilters.length" class="col-menu-reset" @click="promiseFilters = []">
                    Сбросить
                  </button>
                </div>
                <label
                  v-for="f in PROMISE_FILTERS"
                  :key="f.key"
                  class="col-menu-item"
                  @click="togglePromiseFilter(f.key)"
                >
                  <v-icon
                    :icon="hasPromiseFilter(f.key) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"
                    size="16"
                    :color="hasPromiseFilter(f.key) ? 'primary' : ''"
                  />
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
            <button v-if="brokenCount" class="dbt-chip" :class="{ active: hasPromiseFilter('broken') }" @click="toggleQuickFilter('broken')">
              <v-icon icon="mdi-alert-circle-outline" size="15" /> Нарушенные обещания
              <span class="dbt-chip-count">{{ brokenCount }}</span>
            </button>
            <!-- Быстрый чип: мои (для сотрудника) -->
            <button v-if="myStaffId" class="dbt-chip dbt-chip--neutral" :class="{ active: assigneeFilter === 'mine' }" @click="assigneeFilter = assigneeFilter === 'mine' ? 'all' : 'mine'">
              <v-icon icon="mdi-account-check-outline" size="15" /> Мои
            </button>
          </div>

          <div class="d-flex align-center ga-2 flex-grow-1 justify-end">
            <div class="dbt-search">
              <v-icon icon="mdi-magnify" size="18" />
              <input v-model="search" type="text" :placeholder="`Поиск по клиенту, товару${canSearchAddress ? ', адресу' : ''}, номеру…`" />
              <button v-if="search" type="button" class="dbt-search-clear" title="Очистить" @click="search = ''">
                <v-icon icon="mdi-close" size="14" />
              </button>
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

        <!-- Обёртка для виртуализации: по её положению считается, какие
             строки сейчас видны. -->
        <div v-else-if="displayedRows.length" ref="tableViewport">
        <v-table
          density="default"
          hover
          class="dbt-table"
          :class="{ 'table--scrolled': hasHiddenColumns }"
        >
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
                draggable="true"
                :class="[
                  `text-${c.align === 'end' ? 'end' : c.align === 'center' ? 'center' : 'start'}`,
                  { 'th-sortable': c.sortable, 'th-sorted': sortCol === c.key, 'th-dragging': dragColKey === c.key },
                ]"
                @click="c.sortable && toggleSort(c.key)"
                @dragstart="onColDragStart(c.key, $event)"
                @dragover="onColDragOver(c.key, $event)"
                @dragend="onColDragEnd"
                @drop.prevent="onColDragEnd"
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
              <!-- Действия по должнику прямо в строке: колонка закреплена
                   справа, чтобы кнопки не уезжали при прокрутке вбок. -->
              <th v-if="!selectMode" class="text-end col-actions">Действия</th>
            </tr>
          </thead>
          <tbody>
            <!-- Верхняя распорка: место строк выше экрана и точка отсчёта списка. -->
            <tr ref="markerRow" class="virtual-pad" aria-hidden="true">
              <!-- Высоту задаёт вложенный блок, а не сама ячейка: заданную
                   высоту строки браузер в таблице не соблюдает — он
                   перераспределяет её между строками, и на тысячах строк
                   список разъезжался с прокруткой на сотни пикселей. -->
              <td :colspan="columnCount"><div :style="{ height: virtual.padTop.value + 'px' }" /></td>
            </tr>

            <tr v-for="(row, idx) in virtual.visibleRows.value" :key="row.dealId" :ref="virtual.rowRef(virtual.offset.value + idx)" data-virtual-row class="cursor-pointer" :class="{ 'dbt-row--sel': isRowSelected(row.dealId) }" @click="selectMode ? toggleSelect(row.dealId) : openRow(row)">
              <td v-if="selectMode" @click.stop>
                <v-checkbox-btn
                  :model-value="isRowSelected(row.dealId)"
                  density="compact"
                  hide-details
                  @update:model-value="toggleSelect(row.dealId)"
                />
              </td>
              <td class="td-index text-medium-emphasis">{{ (page - 1) * perPage + virtual.offset.value + idx + 1 }}</td>

              <!-- Ячейки рисуются циклом по текущему порядку колонок: партнёр
                   переставляет их перетаскиванием, и порядок в разметке уже
                   ничего не определяет. -->
              <td
                v-for="c in shownColumns"
                :key="c.key"
                :class="c.tdClass"
                :style="[c.tdStyle, c.key === 'overdueAmount' && row.overdueAmount ? 'color: #ef4444;' : '']"
              >
                <template v-if="c.key === 'dealNumber'">
                  <span class="dbt-deal-num">#{{ row.dealNumber }}</span>
                </template>

                <template v-else-if="c.key === 'client'">
                  <div class="text-no-wrap font-weight-medium">
                    <ClientLink :profile-id="row.clientProfileId" :name="row.clientName" :disabled="selectMode" />
                  </div>
                  <div v-if="row.clientPhone" class="dbt-phone text-no-wrap">{{ row.clientPhone }}</div>
                </template>

                <template v-else-if="c.key === 'clientPhone'">
                  <span v-if="row.clientPhone">{{ row.clientPhone }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <template v-else-if="c.key === 'product'">
                  <span class="dbt-product">{{ row.productName }}</span>
                </template>

                <template v-else-if="c.key === 'status'">
                  <span class="dbt-dealstatus" :class="'dbt-dealstatus--' + row.dealStatus.toLowerCase()">
                    {{ DEAL_STATUS_LABEL[row.dealStatus] || row.dealStatus }}
                  </span>
                  <div v-if="row.resolvedAt" class="dbt-sub">{{ fmtDate(row.resolvedAt) }}</div>
                </template>

                <template v-else-if="c.key === 'total'">{{ formatCurrency(row.totalPrice) }}</template>

                <template v-else-if="c.key === 'overdueAmount'">
                  <span v-if="row.overdueAmount">{{ formatCurrency(row.overdueAmount) }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <template v-else-if="c.key === 'overdueCount'">{{ row.overdueCount || '—' }}</template>

                <template v-else-if="c.key === 'overdueDays'">
                  <span v-if="row.overdueDays" class="dbt-days">{{ daysLabel(row.overdueDays) }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <template v-else-if="c.key === 'remaining'">{{ formatCurrency(row.remainingAmount) }}</template>

                <template v-else-if="c.key === 'nextPayment'">
                  <template v-if="row.nextDueDate">
                    <div>{{ fmtDate(row.nextDueDate) }}</div>
                    <div class="dbt-sub">{{ formatCurrency(row.nextDueAmount) }}</div>
                  </template>
                  <template v-else>—</template>
                </template>

                <template v-else-if="c.key === 'paymentsProgress'">
                  {{ row.paidPayments }} из {{ row.numberOfPayments }}
                </template>

                <template v-else-if="c.key === 'progress'">
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
                </template>

                <template v-else-if="c.key === 'assignedStaff'">
                  <span v-if="row.assignedStaffName" class="dbt-staff">{{ row.assignedStaffName }}</span>
                  <span v-else class="dbt-unassigned">Не назначен</span>
                </template>

                <template v-else-if="c.key === 'promised'">
                  <template v-if="row.promisedDate">
                    <div>{{ fmtDate(row.promisedDate) }}</div>
                    <span
                      v-if="row.promiseStatus && row.promiseStatus !== 'PENDING'"
                      class="dbt-ps"
                      :class="PROMISE_STATUS_META[row.promiseStatus].cls"
                    >
                      {{ PROMISE_STATUS_META[row.promiseStatus].label }}
                    </span>
                  </template>
                  <!-- Недоплату оставили долгом, а дату клиент не назвал -->
                  <span v-else-if="row.promiseStatus === 'PENDING'" class="dbt-nodate">обещал, без даты</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <template v-else-if="c.key === 'promisedAmount'">
                  <span v-if="row.promisedAmount">{{ formatCurrency(row.promisedAmount) }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <template v-else-if="c.key === 'lastActivity'">
                  <span v-if="row.lastActivityAt">{{ fmtDate(row.lastActivityAt) }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <template v-else-if="c.key === 'lastActivityText'">
                  <span v-if="row.lastActivityText" class="dbt-lastact">{{ row.lastActivityText }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>
              </td>

              <td v-if="!selectMode" class="text-end text-no-wrap col-actions" @click.stop>
                <div class="row-actions">
                  <button
                    v-if="canActivity && !isArchive"
                    class="row-action-btn row-action-btn--warning"
                    title="Обещал оплатить"
                    @click="openRowPromise(row, $event)"
                  >
                    <v-icon icon="mdi-hand-coin-outline" size="17" />
                  </button>
                  <button
                    v-if="sections.visible('whatsapp') && row.clientPhone"
                    class="row-action-btn row-action-btn--whatsapp"
                    title="Написать в WhatsApp"
                    @click="writeWhatsApp(row, $event)"
                  >
                    <v-icon icon="mdi-whatsapp" size="17" />
                  </button>
                  <button class="row-action-btn" title="Открыть сделку" @click="openDealPage(row, $event)">
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

        <!-- Метка конца списка для автоподгрузки. -->
        <div v-if="autoLoad.enabled.value" ref="autoLoadSentinel" class="auto-load-sentinel" />

        <ServerPager
          v-if="totalRows > 0"
          :page="page"
          :total="totalRows"
          :per-page="perPage"
          :busy="listLoading"
          :per-page-options="PER_PAGE_OPTIONS"
          :auto-load="autoLoad.enabled.value"
          :loaded="loadedCount"
          :has-more="hasMore"
          @update:page="page = $event"
          @update:per-page="perPage = $event"
          @update:auto-load="autoLoad.enabled.value = $event"
          @load-more="autoLoad.loadMoreManually()"
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
            <p class="dbt-set-sub">
              Сделка попадает в список, только когда выполнены <b>оба</b> условия одновременно.
              Долг по сделке виден всегда — пороги решают лишь, когда клиента обзванивать.
              Исключение: если график закончился (недоплачен последний платёж), сделка попадает
              в список при любой сумме — иначе её не закрыть.
            </p>
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
          <div class="dbt-an-datebox">
            <DateField v-model="anFrom" :max="anTo || undefined" plain @update:model-value="onDateEdit" />
          </div>
          <span class="dbt-an-dash">—</span>
          <div class="dbt-an-datebox">
            <DateField v-model="anTo" :min="anFrom || undefined" plain @update:model-value="onDateEdit" />
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
              <div class="dbt-an-kpi-val">
                {{ c.value }}<span v-if="c.pct" class="dbt-an-kpi-pct">&nbsp;/&nbsp;{{ c.pct }}</span>
              </div>
              <div class="dbt-an-kpi-lbl">
                {{ c.label }}
                <v-tooltip v-if="c.pct" :text="investedHint" location="top" max-width="320">
                  <template #activator="{ props }">
                    <v-icon v-bind="props" icon="mdi-information-outline" size="12" class="dbt-info" />
                  </template>
                </v-tooltip>
              </div>
            </div>
          </div>
        </div>

        <div class="dbt-an-2col mb-4">
          <!-- Aging -->
          <div class="dbt-card pa-5">
            <h3 class="dbt-an-h">
              Возраст просрочки
              <v-tooltip v-if="investedBase > 0" :text="investedHint" location="top" max-width="320">
                <template #activator="{ props }">
                  <v-icon v-bind="props" icon="mdi-information-outline" size="12" class="dbt-info" />
                </template>
              </v-tooltip>
            </h3>
            <div
              v-for="a in agingRows"
              :key="a.label"
              class="dbt-aging-row"
              :class="{ 'dbt-aging-row--click': a.count > 0 }"
              :title="a.count ? 'Показать сделки с такой просрочкой' : ''"
              @click="openAging(a)"
            >
              <div class="dbt-aging-lbl">{{ a.label }}</div>
              <div class="dbt-aging-bar-wrap">
                <div class="dbt-aging-bar" :style="{ width: (a.amount / agingMax * 100) + '%', background: a.color }" />
              </div>
              <div class="dbt-aging-val">
                {{ formatCurrency(a.amount) }}
                <span v-if="pctOfInvested(a.amount)" class="dbt-sub">· {{ pctOfInvested(a.amount) }}</span>
                <span class="dbt-sub">· {{ a.count }}</span>
              </div>
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
    <!-- Сделки за полосой «Возраст просрочки» -->
    <MetricDetailDialog
      v-model="agingOpen"
      :title="agingTitle"
      hint="Сделки, у которых самая старая просрочка в этих пределах. Нажмите на строку — откроется сделка."
      :total="agingTotal"
      :color="agingColor"
      :items="agingItems"
      :loading="agingLoading"
      :count="agingCount"
      :has-more="agingHasMore"
      unit="deals"
      @load-more="loadMoreAging"
    />

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

    <!-- Панель расширенных фильтров -->
    <DebtorsFilterPanel
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

/* Распорки виртуализации: держат место неотрисованных строк и сами строкой
   выглядеть не должны. */
/* Распорки виртуализации: держат место неотрисованных строк и сами строкой
   выглядеть не должны.
   `height: 0` обязателен: ячейкам таблицы Vuetify задаёт высоту строки, и
   пустая распорка занимала бы 52 лишних пикселя — под шапкой висела пустая
   полоса. Нужную высоту задаёт блок внутри ячейки.
   `transition: none` тоже обязателен: Vuetify анимирует высоту ячеек, и
   распорка меняла размер плавно — список продолжал ехать почти треть секунды
   после каждого сдвига окна. */
.virtual-pad td {
  height: 0 !important;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  overflow-anchor: none;
  transition: none !important;
}
.virtual-pad:hover td { background: transparent !important; }

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

/* Табы раздела — общий стиль, см. styles/page-tabs.css */

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
/* Меню колонок — тот же вид, что в списке сделок: разделы, поиск, наборы и
   перетаскивание. Разные экраны с одинаковой задачей не должны настраиваться
   по-разному. */
.col-menu {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px; padding: 8px; min-width: 220px;
  max-height: 380px; overflow-y: auto;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
}
.col-menu-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 10px 2px;
}
.col-menu-title {
  font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.col-menu-reset {
  font-size: 11.5px; color: rgb(var(--v-theme-primary));
  padding: 2px 6px; border-radius: 6px; cursor: pointer;
}
.col-menu-reset:hover { background: rgba(var(--v-theme-primary), 0.1); }
.col-menu-hint {
  display: flex; align-items: center; gap: 3px; flex-wrap: wrap;
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45);
  padding: 0 10px 8px;
}
.col-menu-presets {
  display: flex; gap: 5px; flex-wrap: wrap;
  padding: 0 10px 8px;
}
.col-menu-preset {
  padding: 4px 9px; border-radius: 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.12s;
}
.col-menu-preset:hover { border-color: rgba(var(--v-theme-primary), 0.5); color: rgb(var(--v-theme-primary)); }
.col-menu-presets--own { padding-top: 2px; }
.col-menu-own {
  display: inline-flex; align-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.07);
  border-radius: 7px; overflow: hidden;
}
.col-menu-own-apply {
  padding: 4px 6px 4px 9px; font-size: 11.5px; font-weight: 500;
  color: rgb(var(--v-theme-primary)); cursor: pointer;
}
.col-menu-own-del { padding: 4px 6px; color: rgba(var(--v-theme-primary), 0.6); cursor: pointer; }
.col-menu-own-del:hover { color: #dc2626; }
.col-menu-save {
  display: flex; gap: 6px; margin: 0 10px 8px;
}
.col-menu-save input {
  flex: 1; min-width: 0; padding: 5px 8px; border-radius: 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; outline: none;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.85);
}
.col-menu-save button {
  padding: 5px 10px; border-radius: 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
}
.col-menu-save button:disabled { opacity: 0.5; cursor: default; }
.col-menu-save button:not(:disabled):hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
  color: rgb(var(--v-theme-primary));
}
.col-menu-search {
  display: flex; align-items: center; gap: 6px;
  margin: 0 10px 8px; padding: 6px 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.col-menu-search input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.85);
}
.col-menu-search-clear { display: flex; cursor: pointer; }
/* Раздел колонок: при трёх десятках плоский список не читается. */
.col-menu-group + .col-menu-group { margin-top: 6px; }
.col-menu-group-title {
  font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
  color: rgba(var(--v-theme-on-surface), 0.35);
  padding: 6px 10px 4px;
}
.col-menu-empty {
  padding: 10px; font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.col-menu-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85);
}
.col-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
/* Строку, которую тащат, приглушаем — видно, что она «в руке». */
.col-menu-item--dragging { opacity: 0.45; background: rgba(var(--v-theme-primary), 0.08); }
.col-menu-grip {
  color: rgba(var(--v-theme-on-surface), 0.35);
  cursor: grab;
}
.col-menu-label {
  display: flex; align-items: center; gap: 10px; flex: 1; cursor: pointer;
}
.col-menu-item input { width: 16px; height: 16px; accent-color: rgb(var(--v-theme-primary)); cursor: pointer; }

/* Заголовок в момент перетаскивания. */
.th-dragging { opacity: 0.45; }

/* Поиск */
.dbt-search {
  display: flex; align-items: center; gap: 8px; padding: 8px 14px;
  border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  /* Минимум подобран под самую длинную подсказку («…товару, адресу, номеру…»),
     иначе текст обрезается на полуслове. */
  flex: 1 1 340px; min-width: 300px; max-width: 460px;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.6);
}
/* Крестик очистки: вернуть полный список одним нажатием, а не стирать
   запрос по букве. */
.dbt-search-clear {
  width: 22px; height: 22px; flex: none; border: none; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: pointer;
}
.dbt-search-clear:hover {
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.75);
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
/* Текст последнего контакта — длинный, поэтому в одну строку с обрезкой:
   иначе колонка растягивает всю таблицу. Полностью виден в карточке должника. */
.dbt-lastact {
  display: block; max-width: 260px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.dbt-phone { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.dbt-product { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; display: inline-block; vertical-align: bottom; }
.dbt-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.dbt-days { color: #ef4444; font-weight: 600; }
.dbt-staff { font-size: 13px; }
.dbt-unassigned { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.4); }
.dbt-nodate { font-size: 12.5px; color: #b45309; }
.dbt-dealstatus { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 6px; white-space: nowrap; background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.7); }
.dbt-dealstatus--completed { background: rgba(16, 185, 129, 0.15); color: #047857; }
.dbt-dealstatus--active { background: rgba(59, 130, 246, 0.14); color: #2563eb; }
.dbt-dealstatus--disputed { background: rgba(245, 158, 11, 0.15); color: #b45309; }
.dbt-dealstatus--cancelled { background: rgba(239, 68, 68, 0.14); color: #dc2626; }

/* Кнопка «Обещал оплатить» в строке */

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
.dbt-an-datebox { width: 158px; position: relative; display: inline-flex; align-items: center; cursor: pointer; }
/* Прячем нативную иконку-индикатор — у нас своя слева, клик открывает showPicker */
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
/* Доля от вложенного — приглушённее самой суммы: это её пояснение, а не
   второй равноправный показатель. */
.dbt-an-kpi-pct { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.45); }
.dbt-info {
  color: rgba(var(--v-theme-on-surface), 0.35);
  cursor: help; vertical-align: baseline; margin-left: 3px;
}
.dbt-an-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .dbt-an-2col { grid-template-columns: 1fr; } }
.dbt-an-h { font-size: 15px; font-weight: 700; margin-bottom: 14px; }
.dbt-aging-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.dbt-aging-row--click { cursor: pointer; border-radius: 8px; }
.dbt-aging-row--click:hover .dbt-aging-lbl { color: rgb(var(--v-theme-primary)); }
.dbt-aging-lbl { width: 90px; font-size: 13px; flex-shrink: 0; }
.dbt-aging-bar-wrap { flex: 1; height: 10px; border-radius: 6px; background: rgba(var(--v-theme-on-surface), 0.06); overflow: hidden; }
.dbt-aging-bar { height: 100%; border-radius: 6px; min-width: 2px; transition: width 0.3s; }
/* Шире прежнего: к сумме и счётчику добавилась доля от вложенного. */
.dbt-aging-val { font-size: 13px; font-weight: 600; white-space: nowrap; text-align: right; min-width: 176px; }
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
