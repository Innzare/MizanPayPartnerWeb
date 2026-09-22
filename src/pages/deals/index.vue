<script setup lang="ts">
import SearchInput from '@/components/SearchInput.vue'
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { formatCurrency, formatDate, formatDateShort, formatPercent, formatPhone, timeAgo } from '@/utils/formatters'
import { todayIso } from '@/utils/dateInput'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { type Deal, type DealFolder, type Payment, userName, clientProfileName } from '@/types'
import { useRoute, useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { PER_PAGE_OPTIONS, normalizePageSize, useListSort, usePageSize } from '@/composables/useListPrefs'
import { useVirtualRows } from '@/composables/useVirtualRows'
import { useFolders } from '@/composables/useFolders'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import ClientLink from '@/components/ClientLink.vue'
import { useSections } from '@/composables/useSections'
import { api } from '@/api/client'
import ServerPager from '@/components/ServerPager.vue'
import QuickPayDialog from '@/components/QuickPayDialog.vue'
import DealScheduleTable from '@/components/DealScheduleTable.vue'
import DealPreviewDialog from '@/components/DealPreviewDialog.vue'
import * as money from '@/utils/paymentMath'
import { useAutoLoad } from '@/composables/useAutoLoad'
import { useDealsFilters } from '@/composables/useDealsFilters'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useSuppliersStore } from '@/stores/suppliers'
import DealsFilterPanel from '@/components/DealsFilterPanel.vue'
import ReschedulePaymentDialog from '@/components/ReschedulePaymentDialog.vue'

const router = useRouter()
const route = useRoute()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const dealsStore = useDealsStore()
const authStore = useAuthStore()
/** Подсказку про адрес показываем только тем, кто по нему реально ищет. */
const canSearchAddress = computed(() => authStore.can('clients.view'))
const sections = useSections()
const paymentsStore = usePaymentsStore()
const { folders, fetchFolders, createFolder, updateFolder, deleteFolder, moveDeal, moveBatch } = useFolders()

// Folders
/**
 * Касса, ответственный и папка живут в общем наборе фильтров — как и все
 * прочие условия выборки. Здесь короткие ссылки на них, чтобы остальной код
 * страницы не менялся.
 */
const activeFolder = computed({
  get: () => filters.state.value.folderId || null,
  set: (v: string | null) => { filters.state.value.folderId = v ?? '' },
}) // null = все папки

// Co-investor filter — null = all deals (regardless of CI link)
const activeCashBoxId = computed({
  get: () => filters.state.value.cashBoxId || null,
  set: (v: string | null) => { filters.state.value.cashBoxId = v ?? '' },
})
const cashBoxesStore = useCashBoxesStore()
const { items: cashBoxes } = storeToRefs(cashBoxesStore)
cashBoxesStore.fetchAll()
const activeCashBoxObj = computed(() =>
  activeCashBoxId.value ? cashBoxes.value.find((b) => b.id === activeCashBoxId.value) ?? null : null,
)

// Staff assignee filter — partner-only. null = all deals.
interface StaffOption { id: string; firstName: string; lastName: string; isActive: boolean }
const staffList = ref<StaffOption[]>([])
const activeStaff = computed({
  get: () => filters.state.value.staffId || null,
  set: (v: string | null) => { filters.state.value.staffId = v ?? '' },
})
async function loadStaffList() {
  if (!authStore.isOwner) return
  try {
    const list = await api.get<StaffOption[]>('/auth/investor/staff')
    staffList.value = list.filter((s) => s.isActive)
  } catch { /* ignore */ }
}
loadStaffList()
const activeStaffObj = computed(() =>
  activeStaff.value ? staffList.value.find((s) => s.id === activeStaff.value) ?? null : null,
)
const showFolderDialog = ref(false)
const editingFolder = ref<DealFolder | null>(null)
const folderForm = ref({ name: '', color: '#6366f1', icon: 'mdi-folder' })
const folderSaving = ref(false)
const showMoveMenu = ref(false)

const FOLDER_COLORS = ['#6366f1', '#3b82f6', '#0ea5e9', '#10b981', '#047857', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b']

function openCreateFolder() {
  editingFolder.value = null
  folderForm.value = { name: '', color: '#6366f1', icon: 'mdi-folder' }
  showFolderDialog.value = true
}

function openEditFolder(folder: DealFolder) {
  editingFolder.value = folder
  folderForm.value = { name: folder.name, color: folder.color, icon: folder.icon }
  showFolderDialog.value = true
}

async function saveFolder() {
  if (!folderForm.value.name.trim()) return toast.error('Укажите название')
  folderSaving.value = true
  try {
    if (editingFolder.value) {
      await updateFolder(editingFolder.value.id, folderForm.value)
      toast.success('Папка обновлена')
    } else {
      await createFolder(folderForm.value)
      toast.success('Папка создана')
    }
    showFolderDialog.value = false
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  } finally { folderSaving.value = false }
}

async function handleDeleteFolder(folder: DealFolder) {
  if (!confirm(`Удалить папку «${folder.name}»? Сделки не удалятся.`)) return
  try {
    await deleteFolder(folder.id)
    if (activeFolder.value === folder.id) activeFolder.value = null
    toast.success('Папка удалена')
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
}

async function moveSelectedToFolder(folderId: string | null) {
  const ids = Array.from(selectedIds.value)
  if (!ids.length) return
  try {
    await moveBatch(ids, folderId)
    await Promise.all([refreshList(), fetchFolders()])
    selectedIds.value = new Set()
    showMoveMenu.value = false
    toast.success(`${ids.length} сделок перемещено`)
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
}

async function handleMoveSingle(dealId: string, folderId: string | null) {
  try {
    await moveDeal(dealId, folderId)
    await Promise.all([refreshList(), fetchFolders()])
    toast.success(folderId ? 'Сделка перемещена' : 'Сделка убрана из папки')
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
}

const pageLoading = ref(true)

onMounted(async () => {
  // Вернулись из сделки той же выборкой — показываем сохранённый список и
  // возвращаем прокрутку, не дожидаясь сервера.
  const restored = dealsStore.restoreListSnapshot(listKey.value)
  if (restored) {
    highlightedDealId.value = restored.openedId
    void nextTick(() => {
      window.scrollTo({ top: restored.scrollY })
      // Подсветка гаснет сама: она нужна, чтобы взгляд нашёл строку, и
      // мешала бы, если бы осталась насовсем.
      setTimeout(() => { highlightedDealId.value = null }, 2500)
    })
  }

  try {
    // Полный портфель и все платежи здесь больше не грузятся — в этом и был
    // главный вес страницы. Корзина нужна для счётчика на вкладке, папки —
    // для фильтра.
    await Promise.all([
      restored ? Promise.resolve() : refreshList(),
      restored ? dealsStore.fetchDealCounts(serverFilters.value) : Promise.resolve(),
      // Только счётчик для вкладки: само содержимое корзины грузится, когда
      // на неё переходят. Раньше каждый вход в раздел тянул её целиком.
      dealsStore.fetchTrashCount(),
      fetchFolders(),
    ])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки сделок')
  } finally {
    pageLoading.value = false
  }
})

const tab = ref(0)
// Reactive mobile detection — used to (a) force grid view on phones where
// the 9-column table can't fit, and (b) make dialogs fullscreen.
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
const viewMode = ref<'grid' | 'table'>(isMobile.value ? 'grid' : 'table')
function updateMobile() {
  const m = window.innerWidth < 768
  if (m !== isMobile.value) {
    isMobile.value = m
    // Going to mobile — force grid (table is unreadable). Going to desktop
    // — leave whatever the user had (don't override their preference).
    if (m && viewMode.value === 'table') viewMode.value = 'grid'
  }
}
onMounted(() => window.addEventListener('resize', updateMobile))
onUnmounted(() => window.removeEventListener('resize', updateMobile))

// ─── Тень у закреплённой колонки действий ─────────────────────────────────
// Без неё непонятно, что таблица вообще прокручивается вбок: кнопки просто
// стоят у края. Тень показываем только когда справа осталось что прокручивать,
// и убираем, когда докрутили до конца, — иначе она врёт про скрытое.
const tableWrapRef = ref<HTMLElement | null>(null)
const hasHiddenColumns = ref(false)

function updateScrollShadow() {
  const el = tableWrapRef.value
  if (!el) {
    hasHiddenColumns.value = false
    return
  }
  // Единица допуска — на дробные пиксели при масштабировании браузера.
  hasHiddenColumns.value = el.scrollWidth - el.clientWidth - el.scrollLeft > 1
}

/** Обёртку прокрутки рисует Vuetify, своего ref-а ей не поставить. */
function bindTableScroll() {
  const el = document.querySelector('.deals-table .v-table__wrapper') as HTMLElement | null
  // Тот же элемент — обработчик уже висит, но пересчитать надо: колонки могли
  // включить или выключить, и ширина таблицы изменилась.
  if (el && el === tableWrapRef.value) {
    updateScrollShadow()
    return
  }
  tableWrapRef.value?.removeEventListener('scroll', updateScrollShadow)
  tableWrapRef.value = el
  el?.addEventListener('scroll', updateScrollShadow, { passive: true })
  updateScrollShadow()
}

onMounted(() => {
  void nextTick(bindTableScroll)
  window.addEventListener('resize', updateScrollShadow)
})
onUnmounted(() => {
  tableWrapRef.value?.removeEventListener('scroll', updateScrollShadow)
  window.removeEventListener('resize', updateScrollShadow)
})

const search = ref('')
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const deleting = ref(false)

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
    // В режиме «выбраны все» снятая галочка — исключение: сделка останется,
    // остальные (включая невидимые страницы) удалятся.
    if (selectAllMatching.value) excludedIds.value.add(id)
  } else {
    selectedIds.value.add(id)
    if (selectAllMatching.value) excludedIds.value.delete(id)
  }
  selectedIds.value = new Set(selectedIds.value) // trigger reactivity
  excludedIds.value = new Set(excludedIds.value)
}

// Выделяет строки ТЕКУЩЕЙ страницы: вся выборка может быть в тысячи сделок,
// и массовые действия по ней — отдельная задача, а не молчаливое «выделить всё».
function selectAll() {
  selectAllMatching.value = false
  excludedIds.value = new Set()
  if (selectedIds.value.size === displayedDeals.value.length) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(displayedDeals.value.map(d => d.id))
  }
}

function cancelSelect() {
  selectMode.value = false
  selectedIds.value = new Set()
  selectAllMatching.value = false
  excludedIds.value = new Set()
}

async function deleteSelected() {
  if (!selectionCount.value) return

  // При удалении всей выборки число берём у сервера тем же запросом, которым
  // потом удаляем: показать одно, а удалить другое невозможно. На экране
  // может быть 50 строк, а под фильтр подходить тысячи.
  let count = selectionCount.value
  if (selectAllMatching.value) {
    try {
      count = await countWholeSelection()
    } catch (e: any) {
      toast.error(e.message || 'Не удалось посчитать выборку')
      return
    }
  }
  if (!count) {
    toast.error('Под выборку ничего не подходит')
    return
  }
  if (!confirm(`Переместить ${count.toLocaleString('ru-RU')} сделок в корзину?`)) return

  deleting.value = true
  try {
    if (selectAllMatching.value) {
      await deleteWholeSelection()
    } else {
      const result = await api.post<{ deleted: number; total: number }>('/deals/delete-batch', {
        ids: Array.from(selectedIds.value),
      })
      toast.success(`${result.deleted} сделок перемещено в корзину`)
    }
    await Promise.all([refreshList(), dealsStore.fetchTrashCount(), isTrashTab.value ? dealsStore.refreshTrash() : Promise.resolve()])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }

  cancelSelect()
  deleting.value = false
}

/**
 * Удаление всей выборки. Сервер отбирает сделки теми же фильтрами, что и
 * список, и удаляет пачками — одним запросом на 15 000 сделок дело кончилось
 * бы таймаутом: каждая тянет за собой пересборку журнала и долгов.
 *
 * Обрыв (закрыли вкладку, пропала сеть) не страшен: удалённое уже в корзине,
 * повторный запуск доберёт остаток.
 */
/**
 * Условия выборки плоским объектом — в том виде, в каком их принимает сервер.
 *
 * Сервер проверяет тело строго: незнакомый параметр — отказ. Это защита от
 * того, чтобы «удалить по фильтру» когда-нибудь удалило больше показанного,
 * поэтому вкладывать сюда объекты нельзя.
 */
function filterPayload(): Record<string, unknown> {
  const f = serverFilters.value
  // Касса, ответственный и папка лежат в `extra` вместе с остальными
  // условиями: они часть общего набора фильтров.
  return {
    status: f.status,
    q: f.q,
    ...f.extra,
  }
}

/** Сколько сделок попадёт под удаление — спрашиваем тем же запросом. */
async function countWholeSelection(): Promise<number> {
  const res = await api.post<{ deleted: number; remaining: number }>('/deals/delete-by-filter', {
    ...filterPayload(),
    excludeIds: Array.from(excludedIds.value),
    dryRun: true,
  })
  return res.remaining
}

async function deleteWholeSelection() {
  bulkProgress.value = { done: 0, total: selectionCount.value }
  let guard = 0
  for (;;) {
    const res = await api.post<{ deleted: number; remaining: number }>('/deals/delete-by-filter', {
      ...filterPayload(),
      excludeIds: Array.from(excludedIds.value),
      batchSize: 200,
    })
    bulkProgress.value = {
      done: bulkProgress.value.done + res.deleted,
      total: Math.max(bulkProgress.value.total, bulkProgress.value.done + res.deleted + res.remaining),
    }
    if (res.remaining <= 0) break
    // Ничего не удалилось, а остаток есть — дальше цикл был бы вечным
    // (например, вся выборка закрыта тарифом).
    if (res.deleted === 0) break
    if (++guard > 500) break // страховка от бесконечного цикла
  }
  const done = bulkProgress.value.done
  bulkProgress.value = null
  toast.success(`${done.toLocaleString('ru-RU')} сделок перемещено в корзину`)
}

// Прогресс массового удаления: на 15 000 сделок это десятки запросов, и без
// счётчика партнёр не отличил бы работу от зависания.
const bulkProgress = ref<{ done: number; total: number } | null>(null)

async function restoreSelected() {
  if (!selectedIds.value.size) return
  deleting.value = true
  try {
    await dealsStore.restoreBatch(Array.from(selectedIds.value))
    toast.success(`${selectedIds.value.size} сделок восстановлено`)
    // И список, и корзина серверные — обе стороны надо перечитать, иначе на
    // месте восстановленных строк останется дырка, а страницы съедут.
    await Promise.all([refreshList(), dealsStore.refreshTrash()])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка восстановления')
  }
  cancelSelect()
  deleting.value = false
}

async function emptyTrash() {
  if (!confirm('Удалить все сделки из корзины навсегда? Это действие необратимо.')) return
  deleting.value = true
  try {
    await dealsStore.emptyTrash()
    toast.success('Корзина очищена')
    page.value = 1
  } catch (e: any) {
    toast.error(e.message || 'Ошибка очистки')
  }
  deleting.value = false
}

async function restoreOne(id: string) {
  try {
    await dealsStore.restoreDeal(id)
    toast.success('Сделка восстановлена')
    await Promise.all([refreshList(), dealsStore.refreshTrash()])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка восстановления')
  }
}

async function permanentDeleteOne(id: string) {
  if (!confirm('Удалить сделку навсегда? Это действие необратимо.')) return
  try {
    await dealsStore.permanentDelete(id)
    toast.success('Сделка удалена навсегда')
    await dealsStore.refreshTrash()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
}

async function permanentDeleteSelected() {
  if (!selectedIds.value.size) return
  if (!confirm(`Удалить ${selectedIds.value.size} сделок навсегда? Это действие необратимо.`)) return
  deleting.value = true
  try {
    for (const id of selectedIds.value) {
      await dealsStore.permanentDelete(id)
    }
    toast.success(`Удалено навсегда`)
    await dealsStore.refreshTrash()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
  cancelSelect()
  deleting.value = false
}
const selectedDeal = ref<Deal | null>(null)
const showDialog = ref(false)
// Единое состояние сортировки: колонка + направление. Заголовки таблицы и
// select «Сортировка» пишут в него; сетка тоже его использует.
type SortDir = 'asc' | 'desc'
// Сортировка помнится между заходами — вместе с набором и порядком колонок.
const { col: sortCol, dir: sortDir } = useListSort<string>('deals:table-sort', 'createdAt')
// Совместимость со старым select «Сортировка» (маппинг на sortCol/sortDir).
const sortBy = computed<string>({
  get() {
    if (sortCol.value === 'createdAt' && sortDir.value === 'desc') return 'newest'
    if (sortCol.value === 'total' && sortDir.value === 'desc') return 'amount_desc'
    if (sortCol.value === 'total' && sortDir.value === 'asc') return 'amount_asc'
    if (sortCol.value === 'progress' && sortDir.value === 'desc') return 'progress'
    return ''
  },
  set(v) {
    if (v === 'newest') { sortCol.value = 'createdAt'; sortDir.value = 'desc' }
    else if (v === 'amount_desc') { sortCol.value = 'total'; sortDir.value = 'desc' }
    else if (v === 'amount_asc') { sortCol.value = 'total'; sortDir.value = 'asc' }
    else if (v === 'progress') { sortCol.value = 'progress'; sortDir.value = 'desc' }
  },
})

const tabFilters = [
  { label: 'Активные', key: 'active' },
  { label: 'Завершённые', key: 'completed' },
  { label: 'Все', key: 'all' },
]

// Trash is now a top-level toggle (separate button above the card) rather
// than a tab, because it has its own page logic — no folder/cashbox/staff
// filters, different bulk actions, separate count. tab.value === 3 keeps
// the existing watcher behaviour.
const TRASH_TAB_INDEX = 3
function toggleTrash() {
  tab.value = isTrashTab.value ? 0 : TRASH_TAB_INDEX
}

const sortOptions = [
  { title: 'Новые', value: 'newest' },
  { title: 'Сумма ↓', value: 'amount_desc' },
  { title: 'Сумма ↑', value: 'amount_asc' },
  { title: 'По прогрессу', value: 'progress' },
]

// ── Управляемые колонки таблицы ──
/**
 * Колонка таблицы. `tdClass`/`tdStyle` описывают ячейку здесь, а не в разметке:
 * ячейки рисуются циклом по текущему порядку колонок, и «прибить» оформление
 * к месту в шаблоне больше нельзя.
 */
interface DealColumn {
  key: string
  label: string
  align: 'start' | 'end' | 'center'
  sortable: boolean
  tdClass?: string
  tdStyle?: string
  /** Раздел в меню выбора: при трёх десятках колонок плоский список неудобен. */
  group: ColumnGroup
  /**
   * Дополнительные данные, без которых колонку не заполнить. Сервер считает
   * их только для включённых колонок — иначе список тормозил бы у всех.
   */
  extra?: 'clientDetails' | 'guarantors' | 'supplier' | 'overdue' | 'paidTotal'
}

type ColumnGroup = 'deal' | 'client' | 'money' | 'payments' | 'guarantors'

const COLUMN_GROUPS: { key: ColumnGroup; label: string }[] = [
  { key: 'deal', label: 'Договор' },
  { key: 'client', label: 'Клиент' },
  { key: 'money', label: 'Деньги' },
  { key: 'payments', label: 'Платежи' },
  { key: 'guarantors', label: 'Поручители' },
]
const ALL_COLUMNS: DealColumn[] = [
  // ── Договор ──
  { key: 'dealNumber', label: '№', align: 'start', sortable: true, group: 'deal', tdClass: 'text-start text-no-wrap' },
  { key: 'product', label: 'Товар', align: 'start', sortable: true, group: 'deal' },
  { key: 'status', label: 'Статус', align: 'start', sortable: true, group: 'deal' },
  { key: 'createdAt', label: 'Дата создания', align: 'end', sortable: true, group: 'deal', tdClass: 'text-end text-medium-emphasis text-no-wrap' },
  { key: 'dealDate', label: 'Дата договора', align: 'end', sortable: true, group: 'deal', tdClass: 'text-end text-medium-emphasis text-no-wrap' },
  { key: 'term', label: 'Срок рассрочки', align: 'center', sortable: true, group: 'deal', tdClass: 'text-center text-no-wrap' },
  { key: 'staff', label: 'Сотрудник', align: 'start', sortable: false, group: 'deal', tdClass: 'text-no-wrap' },
  { key: 'supplier', label: 'Поставщик', align: 'start', sortable: false, group: 'deal', extra: 'supplier', tdClass: 'text-no-wrap' },
  { key: 'comment', label: 'Комментарий', align: 'start', sortable: false, group: 'deal', tdStyle: 'min-width: 220px;' },

  // ── Клиент ──
  { key: 'client', label: 'Клиент', align: 'start', sortable: true, group: 'client', tdStyle: 'min-width: 300px;' },
  { key: 'clientBirthDate', label: 'Дата рождения', align: 'end', sortable: false, group: 'client', extra: 'clientDetails', tdClass: 'text-end text-no-wrap' },
  { key: 'clientAddress', label: 'Адрес проживания', align: 'start', sortable: false, group: 'client', extra: 'clientDetails', tdStyle: 'min-width: 220px;' },
  { key: 'clientRegAddress', label: 'Адрес регистрации', align: 'start', sortable: false, group: 'client', extra: 'clientDetails', tdStyle: 'min-width: 220px;' },

  // ── Деньги ──
  { key: 'total', label: 'Итого', align: 'end', sortable: true, group: 'money', tdClass: 'text-end font-weight-bold text-no-wrap' },
  { key: 'purchasePrice', label: 'Стоимость товара', align: 'end', sortable: false, group: 'money', tdClass: 'text-end text-no-wrap' },
  { key: 'markup', label: 'Наценка', align: 'end', sortable: true, group: 'money', tdClass: 'text-end text-no-wrap' },
  { key: 'downPayment', label: 'Первонач. взнос', align: 'end', sortable: true, group: 'money', tdClass: 'text-end text-no-wrap' },
  { key: 'remaining', label: 'Остаток долга', align: 'end', sortable: true, group: 'money', tdClass: 'text-end text-no-wrap text-medium-emphasis' },
  { key: 'monthly', label: 'Ежемесячно', align: 'end', sortable: true, group: 'money', tdClass: 'text-end text-no-wrap' },
  { key: 'paidTotal', label: 'Оплачено всего', align: 'end', sortable: false, group: 'money', extra: 'paidTotal', tdClass: 'text-end text-no-wrap' },
  { key: 'overdueAmount', label: 'Сумма просрочки', align: 'end', sortable: false, group: 'money', extra: 'overdue', tdClass: 'text-end text-no-wrap' },
  { key: 'discount', label: 'Скидка', align: 'end', sortable: false, group: 'money', tdClass: 'text-end text-no-wrap' },

  // ── Платежи ──
  { key: 'progress', label: 'Прогресс', align: 'center', sortable: true, group: 'payments', tdClass: 'text-center', tdStyle: 'min-width: 140px;' },
  { key: 'lastPayment', label: 'Дата окончания', align: 'end', sortable: true, group: 'payments', tdClass: 'text-end text-medium-emphasis text-no-wrap' },
  { key: 'paymentsTotal', label: 'Всего платежей', align: 'center', sortable: false, group: 'payments', tdClass: 'text-center text-no-wrap' },
  { key: 'paymentsLeft', label: 'Осталось платежей', align: 'center', sortable: false, group: 'payments', tdClass: 'text-center text-no-wrap' },
  { key: 'payDay', label: 'День оплаты', align: 'center', sortable: false, group: 'payments', tdClass: 'text-center text-no-wrap' },
  { key: 'payStatus', label: 'Состояние оплат', align: 'start', sortable: false, group: 'payments', extra: 'overdue', tdClass: 'text-no-wrap' },

  // ── Поручители ──
  { key: 'guarantors', label: 'Поручители', align: 'start', sortable: false, group: 'guarantors', extra: 'guarantors', tdStyle: 'min-width: 240px;' },
  { key: 'guarantorAddresses', label: 'Адреса поручителей', align: 'start', sortable: false, group: 'guarantors', extra: 'guarantors', tdStyle: 'min-width: 220px;' },
]

const DEFAULT_VISIBLE = ['dealNumber', 'product', 'client', 'total', 'markup', 'remaining', 'progress', 'status', 'createdAt']
const COLS_STORAGE_KEY = 'deals:table-columns'
function loadVisibleCols(): Record<string, boolean> {
  const base: Record<string, boolean> = {}
  ALL_COLUMNS.forEach((c) => { base[c.key] = DEFAULT_VISIBLE.includes(c.key) })
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_STORAGE_KEY) || 'null')
    if (saved && typeof saved === 'object') {
      ALL_COLUMNS.forEach((c) => { if (typeof saved[c.key] === 'boolean') base[c.key] = saved[c.key] })
    }
  } catch { /* ignore */ }
  return base
}
const visibleCols = ref<Record<string, boolean>>(loadVisibleCols())
watch(visibleCols, (v) => { try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(v)) } catch { /* ignore */ } }, { deep: true })

// ── Порядок колонок ──
// Партнёры смотрят на таблицу по-разному: одному важнее остаток долга, другому
// статус. Порядок настраивается перетаскиванием и живёт рядом с набором колонок.
const COLS_ORDER_KEY = 'deals:table-column-order'
const DEFAULT_ORDER = ALL_COLUMNS.map((c) => c.key)

function loadColumnOrder(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_ORDER_KEY) || 'null')
    if (Array.isArray(saved)) {
      const known = saved.filter((k: unknown): k is string => typeof k === 'string' && DEFAULT_ORDER.includes(k))
      // Колонки, появившиеся уже после сохранения порядка, встают на своё место
      // из умолчания, а не сваливаются в конец списка.
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
watch(columnOrder, (v) => { try { localStorage.setItem(COLS_ORDER_KEY, JSON.stringify(v)) } catch { /* ignore */ } }, { deep: true })

/** Все колонки в пользовательском порядке — для меню настройки. */
const orderedColumns = computed(
  () => columnOrder.value.map((k) => ALL_COLUMNS.find((c) => c.key === k)).filter(Boolean) as DealColumn[],
)
/** Те же, но только включённые — по ним рисуется таблица. */
const shownColumns = computed(() => orderedColumns.value.filter((c) => visibleCols.value[c.key]))

/**
 * Какие дополнительные данные нужны серверу для включённых колонок.
 *
 * Адреса, поручители и суммы просрочки считаются отдельными запросами. Если
 * просить их всегда, список замедлится у всех — включая тех, кто эти колонки
 * не включал.
 */
const neededExtras = computed(() => {
  const set = new Set<string>()
  for (const c of shownColumns.value) if (c.extra) set.add(c.extra)
  return [...set].join(',')
})
function toggleColumn(key: string) { visibleCols.value[key] = !visibleCols.value[key] }

// ── Поиск и наборы колонок ──
// При трёх десятках колонок список приходится проматывать, а нужную ищут
// глазами. Поиск и готовые наборы закрывают оба случая.
const colSearch = ref('')

/** Колонки для меню: в пользовательском порядке, отфильтрованные поиском. */
const menuColumns = computed(() => {
  const q = colSearch.value.trim().toLowerCase()
  const list = orderedColumns.value
  return q ? list.filter((c) => c.label.toLowerCase().includes(q)) : list
})

/** Колонки меню, разложенные по разделам. Пустые разделы не показываем. */
const menuGroups = computed(() =>
  COLUMN_GROUPS.map((g) => ({
    ...g,
    columns: menuColumns.value.filter((c) => c.group === g.key),
  })).filter((g) => g.columns.length),
)

/** Готовые наборы под частые задачи. */
const COLUMN_PRESETS: { key: string; label: string; columns: string[] }[] = [
  {
    key: 'min',
    label: 'Минимум',
    columns: ['dealNumber', 'client', 'total', 'remaining', 'status'],
  },
  {
    key: 'calls',
    label: 'Для обзвона',
    columns: ['dealNumber', 'client', 'overdueAmount', 'payStatus', 'comment'],
  },
  {
    key: 'money',
    label: 'Для бухгалтерии',
    columns: [
      'dealNumber', 'client', 'purchasePrice', 'total', 'markup', 'downPayment',
      'paidTotal', 'remaining', 'discount', 'monthly',
    ],
  },
  { key: 'full', label: 'Полный', columns: ALL_COLUMNS.map((c) => c.key) },
]

// ── Свои наборы колонок ──
// Готовых четырёх не хватает: у каждого партнёра свой привычный набор.
// Хранятся в браузере — это личная привычка, а не настройка компании.
const COL_PRESETS_KEY = 'deals:column-presets'
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
  // Незнакомые ключи из старого набора отбрасываем, пропавшие — дописываем:
  // состав колонок со временем меняется, набор не должен ломать таблицу.
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

function toggleSort(key: string) {
  // Отпустили колонку после перетаскивания — это не клик по сортировке.
  if (dragColKey.value || justDraggedCol) return
  if (sortCol.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortCol.value = key
    // текст — по возрастанию, числа/даты — по убыванию по умолчанию
    sortDir.value = (key === 'product' || key === 'client' || key === 'status') ? 'asc' : 'desc'
  }
}

// ── Вычисляемые значения строки ──
const INTERVAL_UNIT: Record<string, string> = { WEEKLY: 'нед', BIWEEKLY: '×2 нед', MONTHLY: 'мес' }
// Платежи всех сделок в памяти больше не лежат, поэтому «ежемесячно» считаем
// формулой — той же, по которой сортирует сервер, так что цифра и порядок
// строк теперь согласованы. Разница видна только у сделок с перераспределённым
// графиком: там раньше показывался первый платёж графика.
function dealMonthly(deal: Deal): number {
  const financed = deal.totalPrice - (deal.downPayment ?? 0)
  return deal.numberOfPayments > 0 ? Math.round(financed / deal.numberOfPayments) : 0
}
/** Конец графика: сервер присылает готовое значение для строк страницы. */
function dealLastPaymentTs(deal: Deal): number | null {
  if (deal.scheduleEndAt) return new Date(deal.scheduleEndAt).getTime()
  // Фолбэк для корзины (грузится старым эндпоинтом, без вычисленного поля):
  // firstPaymentDate + (n−1) интервалов.
  if (!deal.firstPaymentDate || !deal.numberOfPayments) return null
  const d = new Date(deal.firstPaymentDate)
  const n = deal.numberOfPayments - 1
  if (deal.paymentInterval === 'WEEKLY') d.setDate(d.getDate() + n * 7)
  else if (deal.paymentInterval === 'BIWEEKLY') d.setDate(d.getDate() + n * 14)
  else d.setMonth(d.getMonth() + n)
  return d.getTime()
}
function dealLastPaymentLabel(deal: Deal): string {
  const t = dealLastPaymentTs(deal)
  return t ? formatDateShort(new Date(t).toISOString()) : '—'
}
function dealTermLabel(deal: Deal): string {
  return `${deal.numberOfPayments} ${INTERVAL_UNIT[deal.paymentInterval] ?? 'мес'}`
}

// ══════════════════════════════════════════════════════════════════
// Серверный список
//
// Раньше страница поднимала в память браузера ВСЕ сделки партнёра и все его
// платежи, а фильтры/поиск/сортировку считала поверх этих массивов. У партнёра
// с тысячами сделок это и было причиной тормозов. Теперь сервер отдаёт одну
// страницу, счётчики и итоги считает сам.
//
// Корзина осталась на клиенте: она мала, и её путь ниже не тронут.
// ══════════════════════════════════════════════════════════════════

const page = ref(1)
const perPage = usePageSize('deals:page-size')

/** Ключи колонок → ключи сортировки сервера (DEALS_SORT_KEYS). */
const SERVER_SORT_KEYS: Record<string, string> = {
  product: 'productName',
  client: 'clientName',
  total: 'totalPrice',
  remaining: 'remainingAmount',
  lastPayment: 'scheduleEndAt',
}
const serverSortKey = computed(() => SERVER_SORT_KEYS[sortCol.value] ?? sortCol.value)

// Поиск с задержкой: без неё каждый символ уходил бы отдельным запросом.
// VueUse в проекте нет — таймер вручную.
const debouncedSearch = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { debouncedSearch.value = v }, 350)
})

const TAB_STATUS: Record<number, 'ACTIVE' | 'COMPLETED' | undefined> = {
  0: 'ACTIVE',
  1: 'COMPLETED',
  2: undefined, // «Все»
}

// ── Расширенные фильтры ──────────────────────────────────────────────
// Панель с периодом, признаками, диапазонами и участниками. Её состояние —
// часть выборки наравне с вкладкой и поиском: список, счётчики в шапке и
// массовое удаление читают один и тот же объект.
const filtersOpen = ref(false)
// Справочники нужны только для подписей на плашках фильтров — сами списки
// грузит панель, когда её открывают.
const suppliersStore = useSuppliersStore()
const { coInvestors } = useCoInvestors()
const filters = useDealsFilters({
  // Подписи для плашек: id в фильтре, а на экране нужно имя.
  labels: () => ({
    // Списки могут быть ещё не загружены — тогда на плашке будет прочерк,
    // а не падение страницы.
    suppliers: Object.fromEntries(
      (Array.isArray(suppliersStore.rows) ? suppliersStore.rows : []).map((s: any) => [s.id, s.name]),
    ),
    coInvestors: Object.fromEntries(
      (Array.isArray(coInvestors.value) ? coInvestors.value : []).map((c: any) => [c.id, c.name]),
    ),
    client: selectedClientLabel.value,
    cashBoxes: Object.fromEntries(cashBoxes.value.map((b: any) => [b.id, b.name])),
    staff: Object.fromEntries(
      staffList.value.map((p: any) => [p.id, `${p.firstName} ${p.lastName}`.trim()]),
    ),
    folders: Object.fromEntries(folders.value.map((f: any) => [f.id, f.name])),
  }),
})

/** Имя клиента для плашки фильтра — подтягиваем по выбранному профилю. */
const selectedClientLabel = ref('')
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

const serverFilters = computed(() => ({
  status: TAB_STATUS[tab.value],
  // Касса, ответственный и папка приходят внутри `extra`: они часть общего
  // набора фильтров.
  q: debouncedSearch.value,
  extra: { ...filters.query.value, ...(neededExtras.value ? { extras: neededExtras.value } : {}) },
}))

const serverParams = computed(() => ({
  ...serverFilters.value,
  sort: serverSortKey.value,
  dir: sortDir.value,
  limit: perPage.value,
  offset: (page.value - 1) * perPage.value,
}))

/** Перечитать текущую страницу и счётчики (после действий над сделками). */
async function refreshList() {
  if (isTrashTab.value) return
  await Promise.all([
    dealsStore.fetchDealsPage(serverParams.value),
    dealsStore.fetchDealCounts(serverFilters.value),
  ])
}

// ── Состояние страницы в адресе ──────────────────────────────────────
// Возврат с карточки сделки раньше сбрасывал всё на первую страницу вкладки
// «Активные». С серверной пагинацией это стало заметнее (партнёр мог уйти с
// 7-й страницы), поэтому состояние живёт в адресе — заодно ссылку на выборку
// можно переслать. Вид (таблица/сетка) и набор колонок остаются в localStorage.

function initFromQuery() {
  const q = route.query
  const str = (v: unknown): string | null => {
    const s = Array.isArray(v) ? v[0] : v
    return typeof s === 'string' && s.trim() ? s : null
  }
  const int = (v: unknown, def: number): number => {
    const n = parseInt(str(v) ?? '', 10)
    return Number.isFinite(n) && n > 0 ? n : def
  }

  const t = int(q.tab, 0)
  tab.value = t >= 0 && t <= 3 ? t : 0
  // Размера в адресе может не быть — тогда остаётся выбор партнёра из
  // прошлого захода, а не молчаливая полусотня.
  const per = int(q.per, 0)
  if (per > 0) perPage.value = normalizePageSize(per)
  page.value = int(q.page, 1)
  // Расширенные фильтры тоже живут в адресе: выборкой можно поделиться
  // ссылкой, и она переживает перезагрузку страницы.
  filters.fromQuery(q as Record<string, unknown>)

  const qs = str(q.q)
  if (qs) {
    search.value = qs
    // Сразу и в debounced: иначе первый запрос ушёл бы без поиска.
    debouncedSearch.value = qs
  }

  // Валидируем по списку колонок, а не по SORT_ACCESSOR: тот объявлен ниже по
  // файлу, и обращение к нему отсюда упало бы в браузере (const в мёртвой зоне).
  const sc = str(q.sort)
  if (sc && ALL_COLUMNS.some((c) => c.key === sc)) sortCol.value = sc
  sortDir.value = str(q.dir) === 'asc' ? 'asc' : 'desc'

  // Ссылки, сохранённые до переноса этих фильтров в общий набор, приходят со
  // старыми короткими именами — принимаем и их.
  if (!activeFolder.value && str(q.folder)) activeFolder.value = str(q.folder)
  if (!activeCashBoxId.value && str(q.box)) activeCashBoxId.value = str(q.box)
  if (!activeStaff.value && str(q.staff)) activeStaff.value = str(q.staff)
}

// Вызов ДО подписок ниже: watch не должен принять восстановление состояния за
// действие партнёра и сбросить страницу на первую.
initFromQuery()

watch(
  () => [tab.value, page.value, perPage.value, debouncedSearch.value, sortCol.value, sortDir.value,
         activeFolder.value, activeCashBoxId.value, activeStaff.value, filters.query.value],
  () => {
    const q: Record<string, string> = {}
    if (tab.value) q.tab = String(tab.value)
    if (page.value > 1) q.page = String(page.value)
    // Размер пишем всегда: «полсотни по умолчанию» больше нет, а ссылка
    // должна открывать ровно тот же вид, что видит отправитель.
    q.per = String(perPage.value)
    if (debouncedSearch.value.trim()) q.q = debouncedSearch.value.trim()
    if (sortCol.value !== 'createdAt') q.sort = sortCol.value
    if (sortDir.value !== 'desc') q.dir = sortDir.value
    Object.assign(q, filters.toQuery())
    // replace, а не push: перебор фильтров не должен забивать историю браузера.
    router.replace({ query: q }).catch(() => {})
  },
)

// Смена фильтра, поиска, сортировки или вкладки — всегда с первой страницы:
// иначе на 3-й странице после сужения выборки был бы пустой экран.
// В режиме автоподгрузки это ещё и сброс накопленных порций: склеивать
// результаты разных выборок нельзя.
watch(
  () => [serverFilters.value, serverSortKey.value, sortDir.value, perPage.value],
  () => {
    page.value = 1
    autoLoad.reset()
  },
  { deep: true },
)

// Страница и счётчики перезапрашиваются РАЗДЕЛЬНО. Счётчики зависят только от
// фильтров, поэтому переход по страницам — один лёгкий запрос вместо двух:
// раньше каждый клик по пагинации тянул ещё и шесть агрегатов, которые не
// могли измениться.
watch(
  serverParams,
  () => {
    // Корзина ходит на свой эндпоинт, но зависит от тех же страницы и поиска.
    if (isTrashTab.value) loadTrashPage()
    else dealsStore.fetchDealsPage(serverParams.value)
  },
  { deep: true },
)

watch(
  serverFilters,
  () => { if (!isTrashTab.value) dealsStore.fetchDealCounts(serverFilters.value) },
  { deep: true },
)

const SORT_ACCESSOR: Record<string, (d: Deal) => number | string> = {
  dealNumber: (d) => d.dealNumber,
  product: (d) => (d.productName ?? '').toLowerCase(),
  client: (d) => dealClientName(d).toLowerCase(),
  total: (d) => d.totalPrice,
  markup: (d) => d.markup,
  remaining: (d) => d.remainingAmount,
  monthly: (d) => dealMonthly(d),
  downPayment: (d) => d.downPayment ?? 0,
  term: (d) => d.numberOfPayments,
  progress: (d) => getDealProgress(d),
  status: (d) => d.status,
  createdAt: (d) => new Date(d.createdAt).getTime(),
  dealDate: (d) => new Date(d.dealDate ?? d.createdAt).getTime(),
  lastPayment: (d) => dealLastPaymentTs(d) ?? 0,
}

const isTrashTab = computed(() => tab.value === 3)

/**
 * Колонки корзины → поля сделки, по которым умеет сортировать база. Ключей
 * меньше, чем в списке: производных значений (ежемесячный платёж, последняя
 * оплата) в самой сделке нет, и считать их по всей корзине ради сортировки
 * страницы незачем.
 */
const TRASH_SORT_KEYS: Record<string, string> = {
  dealNumber: 'dealNumber',
  product: 'productName',
  total: 'totalPrice',
  markup: 'markup',
  remaining: 'remainingAmount',
  downPayment: 'downPayment',
  dealDate: 'dealDate',
}

/** Загрузить страницу корзины теми же условиями, что видит партнёр. */
function loadTrashPage() {
  dealsStore.fetchTrash({
    q: debouncedSearch.value,
    sort: TRASH_SORT_KEYS[sortCol.value],
    dir: sortDir.value,
    limit: perPage.value,
    offset: (page.value - 1) * perPage.value,
  })
}

watch(tab, (v) => {
  if (v === 3) {
    page.value = 1
    loadTrashPage()
  }
})

/**
 * Виртуализация таблицы: в разметке живут только видимые строки.
 *
 * Строка сделки — это три десятка узлов и несколько компонентов Vuetify.
 * Порция в тысячу строк давала 62 тысячи узлов и почти секунду на отрисовку,
 * а дальше окно отвечало с задержкой на наведение и клик.
 */
const tableViewport = ref<HTMLElement | null>(null)

const displayedDeals = computed(() => {
  // И обычные вкладки, и корзина: сервер уже отфильтровал, отсортировал и
  // нарезал страницу. Раньше корзина фильтровалась в браузере — она грузилась
  // целиком, а после массового удаления там могут быть тысячи сделок.
  return isTrashTab.value ? dealsStore.trash : dealsStore.list
})

// Таблица появляется и перерисовывается: при смене вида, набора колонок и
// содержимого обёртку прокрутки надо находить заново, иначе тень «залипнет».
watch([viewMode, visibleCols, columnOrder, displayedDeals], () => {
  void nextTick(bindTableScroll)
}, { deep: true })

/** Всего строк в выборке — для пагинатора и подписи «показано X из N». */
const totalRows = computed(() =>
  isTrashTab.value ? dealsStore.trashTotal : dealsStore.listTotal,
)
/**
 * Идёт ли запрос списка. Пока он идёт, строки гаснут под оверлеем, а элементы
 * управления блокируются: без этого партнёр успевал накликать три перехода
 * подряд и видел результат последнего ответа, а не последнего клика.
 * Корзина теперь тоже серверная и постраничная — индикация нужна и там.
 */
const listBusy = computed(() =>
  isTrashTab.value ? dealsStore.trashLoading : dealsStore.listLoading,
)

// ── Автоподгрузка ────────────────────────────────────────────────────
// Включена — список растёт порциями по мере прокрутки, номера страниц
// прячутся. Выключена — всё как раньше, постранично.
//
// Порции складываются в тот же список, что и обычная страница: страница
// показывает `dealsStore.list` в обоих режимах, разница только в том,
// заменяется он или дописывается.
const loadedCount = computed(() => displayedDeals.value.length)
const hasMore = computed(() => loadedCount.value < totalRows.value)

const autoLoad = useAutoLoad({
  storageKey: 'deals:auto-load',
  hasMore,
  busy: listBusy,
  loadMore: () => loadNextChunk(),
})

/** Догрузить следующую порцию, не теряя уже показанные строки. */
async function loadNextChunk() {
  if (!hasMore.value || listBusy.value) return
  const nextOffset = loadedCount.value
  if (isTrashTab.value) {
    await dealsStore.fetchTrash(
      {
        q: debouncedSearch.value,
        sort: TRASH_SORT_KEYS[sortCol.value],
        dir: sortDir.value,
        limit: perPage.value,
        offset: nextOffset,
      },
      true,
    )
  } else {
    await dealsStore.fetchDealsPage({ ...serverParams.value, offset: nextOffset }, true)
  }
}

/** Ссылка на метку конца списка — её отслеживает автоподгрузка. */
const autoLoadSentinel = autoLoad.sentinel

// ── Возврат на то же место ───────────────────────────────────────────
// Пролистали триста сделок, открыли одну, вернулись — список и позиция те же.
// Без этого автоподгрузка делает работу хуже, а не лучше: каждый возврат
// начинался бы с первой порции.
//
// Снимок годится только для той же выборки: ключ включает фильтры, сортировку
// и режим. Сменили что-нибудь — грузим заново.
const listKey = computed(() =>
  JSON.stringify([serverFilters.value, serverSortKey.value, sortDir.value, perPage.value, tab.value]),
)

/** Сделка, на которую уходили: подсвечиваем её при возврате. */
const highlightedDealId = ref<string | null>(null)

function rememberList(openedId: string | null) {
  // Корзину не запоминаем: она короткая и живёт своей загрузкой.
  if (isTrashTab.value) return
  dealsStore.saveListSnapshot({
    key: listKey.value,
    scrollY: window.scrollY,
    openedId,
  })
}

// Переключение режима всегда возвращает к началу выборки. Иначе, включив
// автоподгрузку на 3-й странице, партнёр увидел бы «Показано 50 из 1240» при
// строках со 101-й — счётчик врал бы, а прокрутка вверх упиралась в пустоту.
watch(
  () => autoLoad.enabled.value,
  () => {
    autoLoad.reset()
    if (page.value !== 1) page.value = 1
    else if (isTrashTab.value) loadTrashPage()
    else dealsStore.fetchDealsPage(serverParams.value)
  },
)

/** KPI считаются вместе со счётчиками: пока они в пути, показываем скелетон,
 *  а не старые цифры от предыдущей вкладки. */
const statsBusy = computed(() => !isTrashTab.value && dealsStore.countsLoading)

// Виртуализация таблицы: в разметке живут только видимые строки.
const virtual = useVirtualRows(displayedDeals, { viewport: tableViewport, estimatedRowHeight: 56 })
const markerRow = virtual.markerRow

/** Колонок в строке — сколько занимать распоркам. */
const columnCount = computed(
  () => shownColumns.value.length + 1 + (selectMode.value ? 1 : 0) + (isTrashTab.value || !selectMode.value ? 1 : 0),
)

/** Сквозной номер строки: на 2-й странице по 50 счёт идёт с 51. */
function rowNumber(idx: number): number {
  return (page.value - 1) * perPage.value + idx + 1
}

// ── Выделение всей выборки ────────────────────────────────────────────
// Галочки работают в пределах страницы, но у партнёра выборка может быть в
// тысячи сделок, и очистить её постранично невозможно. Поэтому есть второй
// режим: «выбрать все N» — тогда действие уходит на сервер фильтрами, а не
// списком идентификаторов. Снятые вручную галочки становятся исключениями.
const selectAllMatching = ref(false)
const excludedIds = ref<Set<string>>(new Set())

/** Сколько сделок реально затронет действие. */
const selectionCount = computed(() =>
  selectAllMatching.value
    ? Math.max(0, totalRows.value - excludedIds.value.size)
    : selectedIds.value.size,
)

function enableSelectAllMatching() {
  selectAllMatching.value = true
  excludedIds.value = new Set()
  selectedIds.value = new Set(displayedDeals.value.map((d) => d.id))
}

function clearSelectAllMatching() {
  selectAllMatching.value = false
  excludedIds.value = new Set()
  selectedIds.value = new Set()
}

// Сброс режима при смене выборки: «все 14 815» после смены фильтра означали бы
// уже другие сделки — партнёр удалил бы не то, что видел.
watch(serverFilters, () => { if (selectAllMatching.value) clearSelectAllMatching() }, { deep: true })

// Итоги по ТЕКУЩЕЙ выборке — считает сервер теми же фильтрами, что и страницу.
// Раньше суммировались все сделки в памяти; теперь цифры ещё и учитывают
// поиск с фильтрами, то есть совпадают с тем, что видно в таблице.
const tabStats = computed(() => {
  if (isTrashTab.value) {
    const deals = displayedDeals.value
    return {
      count: deals.length,
      totalVolume: deals.reduce((s, d) => s + d.totalPrice, 0),
      totalProfit: deals.reduce((s, d) => s + d.markup, 0),
      totalRemaining: deals.reduce((s, d) => s + d.remainingAmount, 0),
    }
  }
  const t = dealsStore.counts?.totals
  return {
    count: t?.count ?? 0,
    totalVolume: t?.volume ?? 0,
    totalProfit: t?.profit ?? 0,
    totalRemaining: t?.remaining ?? 0,
  }
})

/**
 * Счётчики вкладок с сервера. Считаются по ТЕКУЩИМ фильтрам (папка, касса,
 * сотрудник, поиск), поэтому совпадают с содержимым таблицы — раньше они были
 * глобальными и расходились с тем, что видел партнёр.
 */
function tabCount(i: number): number {
  const by = dealsStore.counts?.byStatus
  if (!by) return 0
  if (i === 0) return by.ACTIVE ?? 0
  if (i === 1) return by.COMPLETED ?? 0
  return Object.values(by).reduce((s, n) => s + n, 0)
}

const allFoldersCount = computed(() => {
  const by = dealsStore.counts?.byFolder
  return by ? Object.values(by).reduce((s, n) => s + n, 0) : 0
})

function folderCount(f: DealFolder): number {
  return dealsStore.counts?.byFolder?.[f.id] ?? 0
}

function getDealProgress(deal: Deal) {
  return deal.numberOfPayments > 0 ? (deal.paidPayments / deal.numberOfPayments) * 100 : 0
}

function dealClientName(deal: Deal) {
  if (deal.client) return userName(deal.client)
  if (deal.clientProfile) return clientProfileName(deal.clientProfile)
  return deal.externalClientName || '—'
}

function dealClientPhone(deal: Deal): string | null {
  // Mirror backend priority: ClientProfile → User → external phone.
  const raw = deal.clientProfile?.phone || deal.client?.phone || deal.externalClientPhone
  return raw ? formatPhone(raw) : null
}

// Тарифная блокировка: на FREE открыты только последние N сделок (флаг
// `locked` приходит с бэкенда — он же учитывает истёкшую подписку). Клик по
// залоченной — апселл вместо открытия.
const showLockDialog = ref(false)
const lockedDealsCount = computed(() => dealsStore.counts?.locked ?? 0)
function goToSubscription() {
  showLockDialog.value = false
  router.push('/settings?tab=subscription')
}

function openDeal(deal: Deal) {
  if (deal.locked) { showLockDialog.value = true; return }
  selectedDeal.value = deal
  showDialog.value = true
  // График подтягиваем на открытие: все платежи партнёра в памяти больше не
  // лежат. Стор кэширует по сделке, повторное открытие запроса не шлёт.
  dealPaymentsLoading.value = true
  paymentsStore.fetchPaymentsForDeal(deal.id).finally(() => {
    dealPaymentsLoading.value = false
  })
}

function goToDeal(deal: Deal) {
  if (deal.locked) { showLockDialog.value = true; return }
  rememberList(deal.id)
  router.push(`/deals/${deal.id}`)
}

const dealPaymentsLoading = ref(false)

const selectedDealPayments = computed(() => {
  if (!selectedDeal.value) return []
  return paymentsStore.getPaymentsForDeal(selectedDeal.value.id)
})

const selectedDealPaidTotal = computed(() =>
  selectedDealPayments.value.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0)
)

// Отметка оплаты прямо из превью сделки — тот же общий компонент, что на
// странице платежей (перерасчёт графика, фактическая дата, квитанция,
// скриншот). Раньше из превью можно было только уйти на полную страницу
// сделки, чтобы поставить одну галочку.

/**
 * Принять оплату по сделке из превью.
 *
 * Месяц не выбирается: клиент гасит договор, строку берём самую раннюю
 * открытую (сначала недоплаты) — график сделки здесь уже загружен.
 */
/** Приём оплаты из окна предпросмотра: событие оттуда не приходит. */
function onPreviewPay(payment: Payment) {
  handleMarkPaid(new Event('click'), payment)
}

function handleMarkPaid(e: Event, payment: Payment) {
  e.stopPropagation()
  quickPayDeal.value = selectedDeal.value ?? null
  quickPayTarget.value = money.paymentToPay(selectedDealPayments.value) ?? payment
  quickPayDialog.value = true
}

/**
 * Строка, с которой начнётся оплата: самая ранняя открытая, сначала недоплаты.
 *
 * Кнопку «Оплатить» показываем только у неё: платят договор, а не выбранный
 * месяц, и кнопка у каждой строки обещала бы обратное — ровно от этого ушли в
 * графике на странице сделки.
 */
const payTargetPayment = computed(() => money.paymentToPay(selectedDealPayments.value) ?? null)


// ─── Кнопки действий прямо в строке таблицы ───────────────────────────────
// Раньше, чтобы отметить оплату, надо было нажать строку, дождаться окна
// предпросмотра, найти в нём кнопку и нажать её. При полусотне отметок в день
// эти два лишних клика складываются в часы.

/** Число месяца, в которое клиент платит по графику. */
function payDayLabel(deal: Deal): string {
  const src = deal.nextPayment?.dueDate || deal.firstPaymentDate
  if (!src) return '—'
  const d = new Date(src)
  return Number.isNaN(d.getTime()) ? '—' : String(d.getDate())
}

/** Право отмечать оплату — без него кнопки в строке не показываем. */
const canMarkPaid = computed(() => authStore.can('payments.markPaid'))

// Оплата из строки идёт через своё окно: платёж уже выбран, весь график виден
// сразу, и там же досрочное погашение с прощением остатка. Окно предпросмотра
// сделки продолжает работать через общий QuickPayDialog.
const quickPayDialog = ref(false)
const quickPayTarget = ref<Payment | null>(null)
const quickPayDeal = ref<Deal | null>(null)

/** Просрочен ли ближайший платёж. Считаем по сроку, а не по статусу: */
/* статус проставляет фоновая задача раз в час и может отставать. */
function isNextOverdue(deal: Deal): boolean {
  const due = deal.nextPayment?.dueDate
  if (!due) return false
  return due.slice(0, 10) < todayIso()
}

/** Сколько дней просрочки — для подсказки на кнопке. */
function overdueDays(deal: Deal): number {
  const due = deal.nextPayment?.dueDate
  if (!due) return 0
  const diff = Date.now() - new Date(due.slice(0, 10)).getTime()
  return Math.max(Math.floor(diff / 86_400_000), 0)
}

/** Подпись кнопки: при просрочке зовём к действию, иначе просто сумма и срок. */
/** Сумма и срок ближайшего платежа — в подсказке: в строке они дублируют
 *  колонки графика и растягивают закреплённую колонку действий. */
function payButtonTitle(deal: Deal): string {
  const np = deal.nextPayment
  if (!np) return 'Отметить оплату'
  const amount = formatCurrency(np.amount)
  if (isNextOverdue(deal)) return `${amount} · просрочен на ${overdueDays(deal)} дн.`
  return `${amount} · до ${formatDateShort(np.dueDate)}`
}

/**
 * Оплата прямо из строки: окно открывается сразу, потому что данные о платеже
 * пришли вместе со списком. График подгрузится внутри окна сам.
 */
function payFromRow(e: Event, deal: Deal) {
  e.stopPropagation()
  if (!deal.nextPayment) return
  quickPayDeal.value = deal
  quickPayTarget.value = {
    id: deal.nextPayment.id,
    amount: deal.nextPayment.amount,
    dueDate: deal.nextPayment.dueDate,
    number: deal.nextPayment.number,
    status: deal.nextPayment.status,
    dealId: deal.id,
  } as Payment
  quickPayDialog.value = true
}

/**
 * Написать клиенту — во встроенном разделе, а не во внешнем WhatsApp.
 *
 * Внешняя ссылка уводила из сервиса: переписка терялась, история не
 * сохранялась, а на компьютере ещё и открывалась веб-версия с отдельным
 * входом. Так же работает кнопка в должниках.
 */
function openWhatsApp(e: Event, deal: Deal) {
  e.stopPropagation()
  const phone = (dealClientPhone(deal) || '').replace(/\D/g, '')
  if (phone) router.push(`/broadcasts?chat=${phone}`)
}

/** То же для поручителя: у него свой номер, не клиентский. */
function openWhatsAppPhone(e: Event, phone: string | null) {
  e.stopPropagation()
  const digits = (phone || '').replace(/\D/g, '')
  if (digits) router.push(`/broadcasts?chat=${digits}`)
}

/** Перенести срок ближайшего платежа, не открывая сделку. */
function rescheduleFromRow(e: Event, deal: Deal) {
  e.stopPropagation()
  if (!deal.nextPayment) return
  rescheduleTarget.value = {
    id: deal.nextPayment.id,
    amount: deal.nextPayment.amount,
    dueDate: deal.nextPayment.dueDate,
    number: deal.nextPayment.number,
    status: deal.nextPayment.status,
    dealId: deal.id,
  } as Payment
  rescheduleDialog.value = true
}

/** Оплатили из строки — обновляем и строку, и превью, если оно открыто. */
async function onQuickPayDone(dealId: string) {
  quickPayTarget.value = null
  await refreshSelectedDeal(dealId)
}

// Окно закрыли, не отметив, — сбрасываем цель. Иначе следующая оплата
// получила бы данные предыдущей: чужой остаток, чужую квитанцию.
watch(quickPayDialog, (open) => {
  if (!open) {
    quickPayDeal.value = null
    quickPayTarget.value = null
  }
})

// Перенос даты — тот же общий компонент, что на страницах платежей и сделки:
// в превью не хватало только его, галочка оплаты уже была.
const rescheduleDialog = ref(false)
const rescheduleTarget = ref<Payment | null>(null)

async function onRescheduled(dealId: string) {
  rescheduleTarget.value = null
  await refreshSelectedDeal(dealId)
}

/** Освежить карточку в превью и строку в списке после правки графика. */
async function refreshSelectedDeal(dealId: string) {
  const [fresh] = await Promise.all([dealsStore.fetchDeal(dealId), refreshList()])
  if (fresh && selectedDeal.value?.id === dealId) selectedDeal.value = fresh
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Page loader -->
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
    <!-- Summary Cards (KPI) — скрываются у ролей без права deals.kpi -->
    <div v-if="authStore.can('deals.kpi')" class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-briefcase" size="20" />
        </div>
        <div>
          <div v-if="statsBusy" class="stat-skel stat-skel--sm" />
          <div v-else class="stat-value">{{ tabStats.count }}</div>
          <div class="stat-label">Сделок</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
          <v-icon icon="mdi-cash-multiple" size="20" />
        </div>
        <div>
          <div v-if="statsBusy" class="stat-skel stat-skel--md" />
          <div v-else class="stat-value">{{ formatCurrency(tabStats.totalVolume) }}</div>
          <div class="stat-label">Общий объём</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
          <v-icon icon="mdi-trending-up" size="20" />
        </div>
        <div>
          <div v-if="statsBusy" class="stat-skel stat-skel--md" />
          <div v-else class="stat-value">{{ formatCurrency(tabStats.totalProfit) }}</div>
          <div class="stat-label">Прибыль</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
          <v-icon icon="mdi-clock-outline" size="20" />
        </div>
        <div>
          <div v-if="statsBusy" class="stat-skel stat-skel--md" />
          <div v-else class="stat-value">{{ formatCurrency(tabStats.totalRemaining) }}</div>
          <div class="stat-label">Остаток к получению</div>
        </div>
      </div>
    </div>

    <!-- Top toolbar row: trash on the left, filter chips on the right. -->
    <div class="d-flex justify-space-between align-center ga-2 mb-3 flex-wrap">
      <div class="d-flex align-center ga-2">
      <!-- Управление колонками таблицы — слева от «Корзины» -->
      <v-menu v-if="!isMobile && viewMode === 'table'" :close-on-content-click="false" location="bottom start">
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

          <!-- Готовые наборы под частые задачи: обзвон должников, бухгалтерия. -->
          <div class="col-menu-presets">
            <button
              v-for="p in COLUMN_PRESETS"
              :key="p.key"
              type="button"
              class="col-menu-preset"
              @click="applyColumnPreset(p)"
            >{{ p.label }}</button>
          </div>

          <!-- Свои наборы: сохранённый состав и порядок колонок под именем. -->
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

          <div class="col-menu-hint">Потяните за <v-icon icon="mdi-drag-horizontal-variant" size="13" />, чтобы поменять порядок</div>

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

      <!-- Trash toggle — always visible so the partner can enter/leave the
           bin from anywhere. Acts as a chip-button styled like the filters
           on the right; active when the bin is currently open. -->
      <button class="fb-btn" :class="{ 'fb-btn--active': isTrashTab }" @click="toggleTrash">
        <v-icon :icon="isTrashTab ? 'mdi-arrow-left' : 'mdi-trash-can-outline'" size="16" />
        <span v-if="isTrashTab">Назад</span>
        <span v-else>Корзина</span>
        <span v-if="!isTrashTab && dealsStore.trashCount" class="fb-btn-count">
          {{ dealsStore.trashCount }}
        </span>
      </button>
      </div>

      <!-- Filter chips (hidden in trash view — those filters don't apply
           to soft-deleted deals). -->
      <div v-if="!isTrashTab" class="d-flex justify-end ga-2 flex-wrap">
      <!-- Расширенные фильтры: период, признаки, суммы, участники. Их много,
           поэтому живут в отдельной панели, а включённые видны плашками. -->
      <button class="fb-btn" :class="{ 'fb-btn--active': filters.hasAny.value }" @click="filtersOpen = true">
        <v-icon icon="mdi-filter-variant" size="16" />
        Фильтры
        <span v-if="filters.activeCount.value" class="fb-btn-count">{{ filters.activeCount.value }}</span>
      </button>

      <!-- Касса, ответственный и папка переехали в панель фильтров: это такие
           же условия выборки, как остальные, и держать их отдельными кнопками
           значило разложить фильтры по двум местам. -->
      </div>
    </div>

    <!-- Плашки включённых фильтров. При десятке условий невидимый фильтр
         превращается в «сделка пропала», поэтому каждое видно отдельно и
         снимается одним нажатием. -->
    <div v-if="!isTrashTab && filters.chips.value.length" class="active-filters">
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

    <!-- Main card -->
    <v-card rounded="lg" elevation="0" border class="deals-card">
      <div class="pa-4">
        <!-- Tabs + toolbar -->
        <div class="d-flex flex-wrap ga-2 align-center mb-4">
          <div v-if="!isTrashTab" class="d-flex ga-2">
            <button
              v-for="(f, i) in tabFilters"
              :key="f.key"
              class="tab-btn"
              :class="{ active: tab === i }"
              :disabled="listBusy && tab !== i"
              @click="tab = i"
            >
              {{ f.label }}
              <span class="tab-count">{{ tabCount(i) }}</span>
            </button>
          </div>
          <!-- Trash header replaces the status tabs while the bin is open. -->
          <div v-else class="d-flex align-center ga-2">
            <v-icon icon="mdi-trash-can-outline" size="18" style="opacity: 0.5;" />
            <span class="text-subtitle-2 font-weight-bold">Корзина</span>
            <span class="tab-count">{{ dealsStore.trashCount }}</span>
          </div>

          <v-spacer class="d-none d-md-block" />

          <!-- Move to folder (batch) -->
          <v-menu v-if="selectedIds.size > 0" v-model="showMoveMenu" location="bottom">
            <template #activator="{ props: menuProps }">
              <button v-bind="menuProps" class="folder-move-btn">
                <v-icon icon="mdi-folder-arrow-right" size="16" />
                В папку
              </button>
            </template>
            <v-card rounded="lg" elevation="3" min-width="200" class="pa-1">
              <button class="folder-menu-item" @click="moveSelectedToFolder(null)">
                <v-icon icon="mdi-folder-remove-outline" size="16" color="grey" />
                Без папки
              </button>
              <div v-if="folders.length" style="height: 1px; background: rgba(var(--v-theme-on-surface), 0.06); margin: 4px 8px;" />
              <button v-for="f in folders" :key="f.id" class="folder-menu-item" @click="moveSelectedToFolder(f.id)">
                <span class="folder-chip-dot" :style="{ background: f.color }" />
                {{ f.name }}
              </button>
            </v-card>
          </v-menu>

          <div class="d-flex flex-wrap ga-2 align-center">
            <SearchInput v-model="search" :placeholder="`Поиск по товару, клиенту, ${canSearchAddress ? 'адресу, ' : ''}номеру...`" style="max-width: 620px; min-width: 380px; flex: 1 1 380px;" />

            <!-- В табличном виде сортируют заголовки колонок; select — для сетки -->
            <v-select
              v-if="viewMode === 'grid'"
              v-model="sortBy"
              :items="sortOptions"
              item-title="title"
              item-value="value"
              variant="solo-filled"
              flat
              density="compact"
              hide-details
              prepend-inner-icon="mdi-sort"
              class="filter-select"
              style="max-width: 180px; min-width: 140px"
            />

            <div v-if="!isMobile" class="view-toggle">
              <button class="view-toggle-btn" :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">
                <v-icon icon="mdi-table" size="18" />
              </button>
              <button class="view-toggle-btn" :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">
                <v-icon icon="mdi-view-grid-outline" size="18" />
              </button>
            </div>

            <button v-if="!selectMode" class="view-toggle-btn" @click="selectMode = true" title="Выбрать">
              <v-icon icon="mdi-checkbox-multiple-outline" size="18" />
            </button>
          </div>
        </div>

        <!-- Selection bar -->
        <Transition name="slide-down">
          <div v-if="selectMode" class="select-bar">
            <div class="select-bar-left">
              <v-checkbox-btn
                :model-value="selectedIds.size === displayedDeals.length && displayedDeals.length > 0"
                :indeterminate="selectedIds.size > 0 && selectedIds.size < displayedDeals.length"
                density="compact"
                hide-details
                @update:model-value="selectAll"
              />
              <span class="select-bar-count">
                <template v-if="selectAllMatching">
                  Выбраны все {{ selectionCount.toLocaleString('ru-RU') }}
                  <template v-if="excludedIds.size">
                    (исключено {{ excludedIds.size }})
                  </template>
                </template>
                <template v-else-if="selectedIds.size > 0">
                  Выбрано {{ selectedIds.size }} из {{ displayedDeals.length }}
                </template>
                <template v-else>Выберите сделки</template>
              </span>

              <!-- Выделение работает по странице, но выборка может быть в
                   тысячи сделок — постранично её не очистить. -->
              <button
                v-if="!isTrashTab && !selectAllMatching && selectedIds.size === displayedDeals.length
                      && displayedDeals.length > 0 && totalRows > displayedDeals.length"
                class="select-bar-all"
                @click="enableSelectAllMatching"
              >
                Выбрать все {{ totalRows.toLocaleString('ru-RU') }}
              </button>
              <button
                v-else-if="selectAllMatching"
                class="select-bar-all"
                @click="clearSelectAllMatching"
              >
                Снять выделение
              </button>
            </div>
            <div class="select-bar-right">
              <template v-if="isTrashTab">
                <button
                  v-if="selectedIds.size > 0"
                  class="select-bar-restore"
                  :disabled="deleting"
                  @click="restoreSelected"
                >
                  <v-icon icon="mdi-restore" size="18" />
                  <span>Восстановить ({{ selectedIds.size }})</span>
                </button>
                <button
                  v-if="selectedIds.size > 0"
                  class="select-bar-delete"
                  :disabled="deleting"
                  @click="permanentDeleteSelected"
                >
                  <v-icon icon="mdi-delete-forever" size="18" />
                  <span>Удалить навсегда</span>
                </button>
              </template>
              <button
                v-else-if="selectionCount > 0"
                class="select-bar-delete"
                :disabled="deleting"
                @click="deleteSelected"
              >
                <v-progress-circular v-if="deleting" indeterminate size="16" width="2" color="white" />
                <v-icon v-else icon="mdi-delete-outline" size="18" />
                <span>
                  {{ deleting
                    ? (bulkProgress
                        ? `Удаление ${bulkProgress.done.toLocaleString('ru-RU')} из ${bulkProgress.total.toLocaleString('ru-RU')}…`
                        : 'Удаление…')
                    : `В корзину (${selectionCount.toLocaleString('ru-RU')})` }}
                </span>
              </button>
              <button class="select-bar-cancel" @click="cancelSelect">
                <v-icon icon="mdi-close" size="18" />
                <span>Отмена</span>
              </button>
            </div>
          </div>
        </Transition>

        <!-- Trash actions bar -->
        <div v-if="isTrashTab && displayedDeals.length" class="trash-bar">
          <div class="trash-bar-left">
            <div class="trash-bar-icon">
              <v-icon icon="mdi-delete-clock-outline" size="18" />
            </div>
            <div class="trash-bar-text">
              <div class="trash-bar-title">{{ dealsStore.trashTotal }} {{ dealsStore.trashTotal === 1 ? 'сделка' : dealsStore.trashTotal < 5 ? 'сделки' : 'сделок' }} в корзине</div>
              <div class="trash-bar-sub">Автоматически удалятся навсегда через 30 дней</div>
            </div>
          </div>
          <button
            class="trash-bar-btn"
            :disabled="deleting"
            @click="emptyTrash"
          >
            <v-progress-circular v-if="deleting" indeterminate size="14" width="2" />
            <v-icon v-else icon="mdi-delete-sweep-outline" size="17" />
            <span>Очистить корзину</span>
          </button>
        </div>

        <!-- Тарифная блокировка: на FREE доступны только последние сделки -->
        <div v-if="lockedDealsCount > 0 && !isTrashTab" class="deal-lock-banner">
          <div class="deal-lock-banner-icon"><v-icon icon="mdi-lock-alert-outline" size="20" /></div>
          <div class="deal-lock-banner-text">
            <div class="deal-lock-banner-title">Доступны только последние 3 сделки</div>
            <div class="deal-lock-banner-sub">
              Ещё {{ lockedDealsCount }} {{ lockedDealsCount === 1 ? 'сделка недоступна' : lockedDealsCount < 5 ? 'сделки недоступны' : 'сделок недоступно' }}
              на бесплатном тарифе. Обновите тариф, чтобы открыть все.
            </div>
          </div>
          <button class="deal-lock-banner-btn" @click="goToSubscription">Повысить тариф</button>
        </div>

        <!-- Список с индикацией загрузки: строки остаются на месте и гаснут,
             а не исчезают — иначе при каждом переходе таблица «прыгала». -->
        <div class="dl-list-wrap" :class="{ 'dl-list-wrap--busy': listBusy }">
          <div v-if="listBusy" class="dl-list-overlay">
            <v-progress-circular indeterminate size="30" width="3" color="primary" />
          </div>

        <!-- GRID VIEW -->
        <v-row v-if="viewMode === 'grid' && displayedDeals.length">
          <v-col v-for="deal in displayedDeals" :key="deal.id" cols="12" sm="6" lg="4" xl="3">
            <div class="deal-card" :class="{ 'deal-card--locked': deal.locked }" @click="openDeal(deal)">
              <div class="deal-card-photo">
                <v-img v-if="deal.productPhotos?.[0]" :src="deal.productPhotos[0]" height="140" cover />
                <div v-else class="deal-card-placeholder" style="height: 140px;">
                  <v-icon icon="mdi-package-variant-closed" size="36" />
                </div>
                <div
                  class="deal-card-status"
                  :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])"
                >
                  {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                </div>
                <div v-if="deal.locked" class="deal-lock-badge">
                  <v-icon icon="mdi-lock-outline" size="13" />
                  Недоступно на тарифе
                </div>
              </div>

              <div class="deal-card-body">
                <div class="deal-card-title">
                  <span class="deal-card-num">#{{ deal.dealNumber }}</span>
                  {{ deal.productName }}
                </div>
                <div class="deal-card-client">
                  <v-icon icon="mdi-account" size="14" />
                  <ClientLink :profile-id="deal.clientProfileId" :name="dealClientName(deal)" />
                  <span v-if="!deal.client && deal.clientProfile && !deal.clientProfile.userId" class="external-badge">Внешний</span>
                </div>
                <div v-if="dealClientPhone(deal)" class="deal-card-phone">
                  <v-icon icon="mdi-phone-outline" size="12" />
                  {{ dealClientPhone(deal) }}
                </div>

                <div class="deal-card-prices">
                  <div class="deal-card-total">{{ formatCurrency(deal.totalPrice) }}</div>
                  <div class="deal-card-markup">+{{ formatCurrency(deal.markup) }} ({{ formatPercent(deal.markupPercent) }})</div>
                </div>

                <div class="deal-card-progress-row">
                  <v-progress-linear
                    :model-value="getDealProgress(deal)"
                    color="primary"
                    rounded
                    height="4"
                    class="flex-grow-1"
                  />
                  <span class="deal-card-progress-text">{{ deal.paidPayments }}/{{ deal.numberOfPayments }}</span>
                </div>
              </div>
            </div>
          </v-col>
        </v-row>

        <!-- TABLE VIEW -->
        <!-- Обёртка нужна виртуализации: по её положению на экране считается,
             какие строки сейчас видны. -->
        <div v-if="viewMode === 'table' && displayedDeals.length" ref="tableViewport">
        <v-table
          density="default"
          hover
          class="deals-table"
          :class="{ 'table--scrolled': hasHiddenColumns }"
        >
          <thead>
            <tr>
              <th v-if="selectMode" style="width: 40px;">
                <v-checkbox-btn
                  :model-value="selectedIds.size === displayedDeals.length && displayedDeals.length > 0"
                  :indeterminate="selectedIds.size > 0 && selectedIds.size < displayedDeals.length"
                  density="compact"
                  hide-details
                  @update:model-value="selectAll"
                />
              </th>
              <th class="th-index"></th>
              <!-- Заголовок можно перетащить мышью — так порядок колонок
                   меняется прямо в таблице, не открывая меню. -->
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
              <th v-if="isTrashTab" class="text-end col-actions">Действия</th>
              <th v-else-if="!selectMode" class="text-end col-actions">Действия</th>
            </tr>
          </thead>
          <tbody>
            <!-- Верхняя распорка: место строк выше экрана и точка отсчёта
                 списка — по ней считается, сколько прокручено до таблицы. -->
            <tr ref="markerRow" class="virtual-pad" aria-hidden="true">
              <!-- Высоту задаёт вложенный блок, а не сама ячейка: заданную
                   высоту строки браузер в таблице не соблюдает — он
                   перераспределяет её между строками, и на тысячах строк
                   список разъезжался с прокруткой на сотни пикселей. -->
              <td :colspan="columnCount"><div :style="{ height: virtual.padTop.value + 'px' }" /></td>
            </tr>

            <tr
              v-for="(deal, idx) in virtual.visibleRows.value"
              :key="deal.id"
              :ref="virtual.rowRef(virtual.offset.value + idx)"
              data-virtual-row
              class="cursor-pointer"
              :class="{ 'deal-row--locked': deal.locked, 'deal-row--returned': deal.id === highlightedDealId }"
              @click="selectMode ? toggleSelect(deal.id) : openDeal(deal)"
            >
              <td v-if="selectMode" @click.stop>
                <v-checkbox-btn
                  :model-value="selectedIds.has(deal.id)"
                  density="compact"
                  hide-details
                  @update:model-value="toggleSelect(deal.id)"
                />
              </td>
              <!-- № п/п (перечисление, не номер договора) -->
              <td class="td-index text-medium-emphasis">{{ rowNumber(virtual.offset.value + idx) }}</td>

              <!-- Ячейки рисуются по текущему порядку колонок: партнёр
                   переставляет их сам, поэтому «зашить» последовательность в
                   разметку нельзя. -->
              <td
                v-for="c in shownColumns"
                :key="c.key"
                :class="c.tdClass"
                :style="c.tdStyle"
              >
                <template v-if="c.key === 'dealNumber'">
                  <span class="table-deal-num">#{{ deal.dealNumber }}</span>
                </template>

                <template v-else-if="c.key === 'product'">
                  <div class="d-flex align-center ga-2 py-3">
                    <span class="font-weight-medium table-product-name">{{ deal.productName }}</span>
                    <span v-if="deal.locked" class="deal-lock-tag">
                      <v-icon icon="mdi-lock-outline" size="12" />
                      Недоступно на тарифе
                    </span>
                    <span v-if="deal.folder" class="deal-folder-badge" :style="{ background: deal.folder.color + '18', color: deal.folder.color }">
                      <span class="folder-chip-dot" :style="{ background: deal.folder.color }" />
                      {{ deal.folder.name }}
                    </span>
                  </div>
                </template>

                <template v-else-if="c.key === 'client'">
                  <div>
                    <div class="text-no-wrap">
                      <ClientLink :profile-id="deal.clientProfileId" :name="dealClientName(deal)" :disabled="selectMode" />
                    </div>
                    <!-- Телефон под именем, и сразу переход в переписку:
                         отдельная колонка под телефон не нужна. -->
                    <div v-if="dealClientPhone(deal)" class="client-phone-row text-no-wrap">
                      {{ dealClientPhone(deal) }}
                      <button
                        v-if="sections.visible('whatsapp')"
                        class="td-phone-wa"
                        title="Написать в WhatsApp"
                        @click.stop="openWhatsApp($event, deal)"
                      >
                        <v-icon icon="mdi-whatsapp" size="13" />
                      </button>
                    </div>
                  </div>
                </template>

                <template v-else-if="c.key === 'total'">{{ formatCurrency(deal.totalPrice) }}</template>
                <template v-else-if="c.key === 'markup'">
                  <span class="td-markup">+{{ formatCurrency(deal.markup) }}</span>
                </template>
                <template v-else-if="c.key === 'remaining'">{{ formatCurrency(deal.remainingAmount) }}</template>
                <template v-else-if="c.key === 'monthly'">{{ formatCurrency(dealMonthly(deal)) }}</template>
                <template v-else-if="c.key === 'downPayment'">{{ deal.downPayment ? formatCurrency(deal.downPayment) : '—' }}</template>
                <template v-else-if="c.key === 'term'">{{ dealTermLabel(deal) }}</template>

                <template v-else-if="c.key === 'progress'">
                  <div class="d-flex align-center ga-2">
                    <v-progress-linear
                      :model-value="getDealProgress(deal)"
                      color="primary"
                      rounded
                      height="4"
                      style="width: 80px;"
                    />
                    <span class="text-caption text-medium-emphasis">{{ deal.paidPayments }}/{{ deal.numberOfPayments }}</span>
                  </div>
                </template>

                <template v-else-if="c.key === 'status'">
                  <div
                    class="deal-status-chip"
                    :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])"
                  >
                    {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                  </div>
                </template>

                <template v-else-if="c.key === 'createdAt'">{{ timeAgo(deal.createdAt) }}</template>
                <template v-else-if="c.key === 'dealDate'">{{ deal.dealDate ? formatDateShort(deal.dealDate) : '—' }}</template>
                <template v-else-if="c.key === 'lastPayment'">{{ dealLastPaymentLabel(deal) }}</template>

                <!-- ── Договор ── -->
                <template v-else-if="c.key === 'staff'">
                  <span v-if="deal.assignedStaff" class="text-no-wrap">
                    {{ deal.assignedStaff.firstName }} {{ deal.assignedStaff.lastName }}
                  </span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>
                <template v-else-if="c.key === 'supplier'">
                  <span v-if="deal.supplierName">{{ deal.supplierName }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>
                <template v-else-if="c.key === 'comment'">
                  <span v-if="deal.comment" class="td-comment" :title="deal.comment">{{ deal.comment }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <!-- ── Клиент ── -->
                <template v-else-if="c.key === 'clientBirthDate'">
                  {{ deal.clientBirthDate ? formatDateShort(deal.clientBirthDate) : '—' }}
                </template>
                <template v-else-if="c.key === 'clientAddress'">
                  <span v-if="deal.clientAddress" :title="deal.clientAddress">{{ deal.clientAddress }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>
                <template v-else-if="c.key === 'clientRegAddress'">
                  <span v-if="deal.clientRegAddress" :title="deal.clientRegAddress">{{ deal.clientRegAddress }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <!-- ── Деньги ── -->
                <template v-else-if="c.key === 'purchasePrice'">{{ formatCurrency(deal.purchasePrice) }}</template>
                <template v-else-if="c.key === 'paidTotal'">
                  {{ deal.paidTotal != null ? formatCurrency(deal.paidTotal) : '—' }}
                </template>
                <template v-else-if="c.key === 'overdueAmount'">
                  <span v-if="deal.overdueAmount" class="td-overdue">{{ formatCurrency(deal.overdueAmount) }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>
                <template v-else-if="c.key === 'discount'">
                  <span v-if="deal.discount">{{ formatCurrency(deal.discount) }}</span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>

                <!-- ── Платежи ── -->
                <template v-else-if="c.key === 'paymentsTotal'">{{ deal.numberOfPayments }}</template>
                <template v-else-if="c.key === 'paymentsLeft'">
                  {{ Math.max(deal.numberOfPayments - deal.paidPayments, 0) }}
                </template>
                <template v-else-if="c.key === 'payDay'">{{ payDayLabel(deal) }}</template>
                <template v-else-if="c.key === 'payStatus'">
                  <span v-if="deal.overdueCount" class="td-overdue">
                    Просрочено {{ deal.overdueCount }}
                  </span>
                  <span v-else-if="deal.remainingAmount <= 0" class="text-medium-emphasis">Погашен</span>
                  <span v-else>По графику</span>
                </template>

                <!-- ── Поручители ── -->
                <template v-else-if="c.key === 'guarantors'">
                  <!-- Как у клиента: имя, под ним телефон и переход в чат. -->
                  <div v-if="deal.guarantorsList?.length">
                    <div v-for="(g, gi) in deal.guarantorsList" :key="gi" class="td-guarantor">
                      <div class="text-no-wrap">{{ g.name }}</div>
                      <div v-if="g.phone" class="client-phone-row text-no-wrap">
                        {{ g.phone }}
                        <button
                          v-if="sections.visible('whatsapp')"
                          class="td-phone-wa"
                          title="Написать в WhatsApp"
                          @click.stop="openWhatsAppPhone($event, g.phone)"
                        >
                          <v-icon icon="mdi-whatsapp" size="13" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>
                <template v-else-if="c.key === 'guarantorAddresses'">
                  <span v-if="deal.guarantorsList?.some((g) => g.address)">
                    {{ deal.guarantorsList.map((g) => g.address).filter(Boolean).join(', ') }}
                  </span>
                  <span v-else class="text-medium-emphasis">—</span>
                </template>
              </td>

              <td v-if="isTrashTab" class="text-end text-no-wrap col-actions" @click.stop>
                <div class="row-actions">
                  <button class="row-action-btn row-action-btn--restore" title="Восстановить" @click="restoreOne(deal.id)">
                    <v-icon icon="mdi-restore" size="17" />
                  </button>
                  <button class="row-action-btn row-action-btn--delete" title="Удалить навсегда" @click="permanentDeleteOne(deal.id)">
                    <v-icon icon="mdi-delete-forever-outline" size="17" />
                  </button>
                </div>
              </td>

              <!-- Действия по сделке прямо в строке. Колонка закреплена справа:
                   колонок можно включить много, и при прокрутке вбок кнопки
                   иначе уезжали бы за край. В режиме выбора строк их не
                   показываем — там клик по строке ставит галочку. -->
              <td v-else-if="!selectMode" class="text-end text-no-wrap col-actions" @click.stop>
                <div class="row-actions">
                  <button
                    v-if="canMarkPaid && !deal.locked && deal.nextPayment && deal.status === 'ACTIVE'"
                    class="pay-btn"
                    :class="{ 'pay-btn--overdue': isNextOverdue(deal) }"
                    :title="payButtonTitle(deal)"
                    @click="payFromRow($event, deal)"
                  >
                    Оплатить
                  </button>
                  <!-- Бывает, что все строки графика закрыты, а долг остался:
                       клиент недоплачивал, и сервис сознательно не закрывает
                       такую сделку. Писать «Оплачено» здесь нельзя. -->
                  <span
                    v-else-if="canMarkPaid && !deal.locked"
                    class="pay-btn pay-btn--done"
                    :title="deal.remainingAmount > 0 ? 'Строк графика не осталось, но долг не закрыт' : 'Все платежи закрыты'"
                  >{{ deal.remainingAmount > 0 ? `Остаток ${formatCurrency(deal.remainingAmount)}` : 'Оплачено' }}</span>

                  <button class="row-action-btn" title="Открыть сделку" @click="goToDeal(deal)">
                    <v-icon icon="mdi-open-in-new" size="16" />
                  </button>

                  <v-menu location="bottom end">
                    <template #activator="{ props: more }">
                      <button class="row-action-btn" title="Ещё" v-bind="more">
                        <v-icon icon="mdi-dots-horizontal" size="18" />
                      </button>
                    </template>
                    <v-card rounded="lg" elevation="8" class="row-more-menu">
                      <button
                        v-if="dealClientPhone(deal)"
                        class="row-more-item"
                        @click="openWhatsApp($event, deal)"
                      >
                        <v-icon icon="mdi-whatsapp" size="17" />
                        Написать в WhatsApp
                      </button>
                      <button
                        v-if="deal.nextPayment && !deal.locked && authStore.can('payments.reschedule')"
                        class="row-more-item"
                        @click="rescheduleFromRow($event, deal)"
                      >
                        <v-icon icon="mdi-calendar-arrow-right" size="17" />
                        Перенести срок платежа
                      </button>
                      <button class="row-more-item" @click="goToDeal(deal)">
                        <v-icon icon="mdi-file-document-outline" size="17" />
                        Договор и документы
                      </button>
                    </v-card>
                  </v-menu>
                </div>
              </td>
            </tr>

            <!-- Нижняя распорка: держит высоту неотрисованного хвоста. -->
            <tr class="virtual-pad" aria-hidden="true">
              <td :colspan="columnCount"><div :style="{ height: virtual.padBottom.value + 'px' }" /></td>
            </tr>
          </tbody>
        </v-table>
        </div>

        <!-- Empty state -->
        <div v-if="!displayedDeals.length" class="text-center pa-12">
          <v-icon :icon="isTrashTab ? 'mdi-delete-empty' : 'mdi-briefcase-search-outline'" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">
            {{ isTrashTab ? 'Корзина пуста' : 'Нет сделок' }}
          </p>
          <p class="text-body-2 text-medium-emphasis">
            {{ isTrashTab ? 'Удалённые сделки будут отображаться здесь' : search ? 'Попробуйте изменить параметры поиска' : 'Создайте первую сделку' }}
          </p>
          <v-btn
            v-if="!search && !isTrashTab"
            variant="tonal"
            color="primary"
            class="mt-4 mz-btn-text"
            prepend-icon="mdi-plus"
            @click="router.push('/create-deal')"
          >
            Новая сделка
          </v-btn>
        </div>

        </div>

        <!-- Пагинация серверного списка — общий компонент разделов. -->
        <!-- Метка конца списка: попала в поле зрения — грузим следующую
             порцию. Стоит до панели, чтобы срабатывать чуть раньше края. -->
        <div v-if="autoLoad.enabled.value" ref="autoLoadSentinel" class="auto-load-sentinel" />

        <ServerPager
          v-if="totalRows > 0"
          :page="page"
          :total="totalRows"
          :per-page="perPage"
          :busy="listBusy"
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
    </v-card>

    <!-- Предпросмотр сделки — общий компонент со страницей платежей: там
         была почти такая же разметка, только со старым графиком. -->
    <DealPreviewDialog
      v-model="showDialog"
      :deal="selectedDeal"
      :payments="selectedDealPayments"
      :loading="dealPaymentsLoading"
      :fullscreen="isMobile"
      @pay="onPreviewPay"
      @open="goToDeal"
    />
    </template>

    <!-- Folder dialog -->
    <v-dialog v-model="showFolderDialog" max-width="420" :fullscreen="isMobile">
      <v-card rounded="xl" class="fd-dialog">
        <div class="fd-header">
          <div class="fd-header-icon" :style="{ background: folderForm.color + '18', color: folderForm.color }">
            <v-icon icon="mdi-folder" size="22" />
          </div>
          <div>
            <div class="fd-title">{{ editingFolder ? 'Редактировать папку' : 'Новая папка' }}</div>
            <div class="fd-subtitle">Группируйте сделки для удобства</div>
          </div>
          <button class="fd-close" @click="showFolderDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="fd-body">
          <div class="fd-field">
            <label class="fd-label">Название</label>
            <input v-model="folderForm.name" class="fd-input" placeholder="Например: Телефоны" autofocus />
          </div>

          <div class="fd-field">
            <label class="fd-label">Цвет</label>
            <div class="fd-colors">
              <button
                v-for="c in FOLDER_COLORS" :key="c"
                class="fd-color"
                :class="{ active: folderForm.color === c }"
                :style="{ background: c }"
                @click="folderForm.color = c"
              >
                <v-icon v-if="folderForm.color === c" icon="mdi-check" size="14" color="white" />
              </button>
            </div>
          </div>

          <!-- Preview -->
          <div class="fd-preview">
            <span class="fd-preview-label">Предпросмотр:</span>
            <span class="fd-preview-chip" :style="{ background: folderForm.color + '18', color: folderForm.color }">
              <span class="fd-preview-dot" :style="{ background: folderForm.color }" />
              {{ folderForm.name || 'Название папки' }}
            </span>
          </div>
        </div>

        <div class="fd-footer">
          <button v-if="editingFolder" class="fd-delete" @click="handleDeleteFolder(editingFolder!); showFolderDialog = false">
            <v-icon icon="mdi-delete-outline" size="16" />
            Удалить
          </button>
          <v-spacer />
          <button class="fd-cancel" @click="showFolderDialog = false">Отмена</button>
          <button class="fd-save" :disabled="folderSaving || !folderForm.name.trim()" @click="saveFolder">
            <v-progress-circular v-if="folderSaving" indeterminate size="14" width="2" color="white" />
            <v-icon v-else icon="mdi-check" size="16" />
            {{ editingFolder ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Диалог тарифной блокировки сделки -->
    <v-dialog v-model="showLockDialog" max-width="420" :fullscreen="false">
      <v-card rounded="lg" class="pa-6 text-center">
        <div class="deal-lock-dialog-icon"><v-icon icon="mdi-lock-outline" size="30" /></div>
        <div class="text-h6 font-weight-bold mt-3">Сделка недоступна</div>
        <div class="text-body-2 text-medium-emphasis mt-2">
          На бесплатном тарифе доступны только последние 3 сделки. Обновите тариф, чтобы открывать и редактировать все свои сделки.
        </div>
        <div class="d-flex ga-2 mt-5">
          <button class="dlg-btn dlg-btn--ghost" @click="showLockDialog = false">Закрыть</button>
          <button class="dlg-btn dlg-btn--primary" @click="goToSubscription">Повысить тариф</button>
        </div>
      </v-card>
    </v-dialog>

    <!-- Отметка оплаты — общий компонент: тот же функционал, что на страницах
         платежей и сделки (перерасчёт графика, фактическая дата, квитанция,
         скриншот). График уже загружен превью — передаём его, чтобы компонент
         не запрашивал его повторно. -->
    <!-- Отметка оплаты из окна предпросмотра сделки — общий компонент. -->
    <!-- Панель расширенных фильтров -->
    <DealsFilterPanel
      v-model="filtersOpen"
      :state="filters.state.value"
      :active-count="filters.activeCount.value"
      :presets="filters.saved.value"
      :cash-boxes="cashBoxes"
      :staff="authStore.isOwner && sections.visible('staff') ? staffList : []"
      :folders="folders"
      @preset="filters.applyPreset($event)"
      @reset="filters.reset()"
      @save-preset="filters.savePreset($event)"
      @apply-preset="filters.applyPresetSaved($event)"
      @remove-preset="filters.removePreset($event)"
    />

    <!-- Оплата из строки таблицы: сделка берётся из самой строки, окно
         предпросмотра в этом случае не открывалось. -->
    <QuickPayDialog
      v-model="quickPayDialog"
      :payment="quickPayTarget"
      :deal="quickPayDeal"
      :fullscreen="isMobile"
      @paid="onQuickPayDone"
    />

    <!-- Перенос даты — общий компонент. Сделку не передаём: в превью и так
         видно, о каком договоре речь. -->
    <ReschedulePaymentDialog
      v-model="rescheduleDialog"
      :payment="rescheduleTarget"
      :fullscreen="isMobile"
      @rescheduled="onRescheduled"
    />
  </div>
</template>

<style scoped>

/* Распорки виртуализации: занимают место неотрисованных строк и не должны
   выглядеть как строка — ни рамки, ни подсветки при наведении. */
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
  transition: all 0.12s;
}
.af-chip:hover { background: rgba(var(--v-theme-primary), 0.14); }
.af-clear {
  font-size: 12.5px; padding: 5px 8px; border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.5); cursor: pointer;
}
.af-clear:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.75);
}

/* Невидимая метка в конце списка — только якорь для автоподгрузки. */
.auto-load-sentinel { height: 1px; }

/* Строка, из которой вернулись: подсветка гаснет через пару секунд — она
   нужна, чтобы взгляд нашёл нужное место в длинном списке. */
.deal-row--returned td {
  background: rgba(var(--v-theme-primary), 0.1);
  transition: background 1.2s ease;
}

/* Подсветку строки при наведении Vuetify рисует накладкой внутри ячейки,
   поэтому она работает и на закреплённой колонке — свой фон для hover не
   нужен, иначе он бы её перекрывал. */
.row-more-menu { padding: 6px; min-width: 220px; }
.row-more-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 9px 10px;
  border: none; border-radius: 8px;
  background: transparent; color: rgb(var(--v-theme-on-surface));
  font-size: 13.5px; text-align: left; cursor: pointer;
}
.row-more-item:hover { background: rgba(var(--v-theme-on-surface), 0.06); }

/* Stats row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
/* На мобиле 2×2 — компактнее, не растягивает экран в 4 строки. */
@media (max-width: 600px) { .stats-row { grid-template-columns: repeat(2, 1fr); gap: 8px; } }

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
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

/* Tab buttons */
.tab-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 20px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}

.tab-btn:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

.tab-btn.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}

.tab-count {
  font-size: 11px; font-weight: 600;
  padding: 0 6px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  line-height: 18px; min-width: 20px; text-align: center;
}

.tab-btn.active .tab-count {
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
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

:deep(.filter-select .v-field) {
  border-radius: 10px; height: 40px; min-height: 40px !important;
  background: #f4f4f5 !important; border: 1px solid #e4e4e7;
  box-shadow: none !important; padding: 0 8px 0 12px;
  font-size: 14px; transition: all 0.15s ease;
}
:deep(.filter-select .v-field .v-field__input) {
  padding: 0 0 0 4px; min-height: unset !important;
  height: 40px; display: flex; align-items: center; font-size: 14px;
}
:deep(.filter-select .v-field .v-field__prepend-inner),
:deep(.filter-select .v-field .v-field__append-inner) {
  padding-top: 0 !important; align-self: center;
}
:deep(.filter-select .v-field .v-field__prepend-inner .v-icon),
:deep(.filter-select .v-field .v-field__append-inner .v-icon) { color: #9ca3af; }
:deep(.filter-select .v-field--focused) {
  border-color: #047857 !important; background: #fff !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent) !important;
}

/* View toggle */
.view-toggle {
  display: flex; border-radius: 10px; overflow: hidden;
  border: 1px solid #e4e4e7; background: #f4f4f5;
}
.view-toggle-btn {
  width: 40px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.45); transition: all 0.15s;
}
.view-toggle-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.view-toggle-btn.active {
  background: #fff; color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* Grid cards */
/* Списки карточек бывают на тысячу элементов, а высота у них плавающая —
   виртуализация здесь не подходит. Браузер сам пропускает отрисовку того,
   что за экраном: карточка сделки в режиме сетки рисуется, когда до неё доходит прокрутка. */
.deal-card {
  content-visibility: auto;
  contain-intrinsic-size: auto 320px;
}

.deal-card {
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden; cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  background: rgba(var(--v-theme-surface), 1);
}
.deal-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.deal-card-photo { position: relative; }

/* Переход к выделению всей выборки — не кнопка-действие, а ссылка рядом со
   счётчиком: она уточняет масштаб, а не запускает операцию. */
.select-bar-all {
  margin-left: 10px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: background-color 0.15s;
}
.select-bar-all:hover { background: rgba(var(--v-theme-primary), 0.16); }

/* ── Скелетон KPI ──
   Пока считаются счётчики, показываем плашку вместо цифры: иначе партнёр
   успевал прочитать значения предыдущей вкладки как значения новой. */
.stat-skel {
  height: 22px;
  border-radius: 6px;
  margin-bottom: 4px;
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.06) 25%,
    rgba(0, 0, 0, 0.11) 37%,
    rgba(0, 0, 0, 0.06) 63%
  );
  background-size: 400% 100%;
  animation: stat-skel-shimmer 1.4s ease infinite;
}
.stat-skel--sm { width: 56px; }
.stat-skel--md { width: 108px; }

.dark .stat-skel {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.07) 25%,
    rgba(255, 255, 255, 0.13) 37%,
    rgba(255, 255, 255, 0.07) 63%
  );
  background-size: 400% 100%;
}

@keyframes stat-skel-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

@media (prefers-reduced-motion: reduce) {
  .stat-skel { animation: none; }
}

/* ── Индикация загрузки списка ── */
.dl-list-wrap { position: relative; }

/* Строки не исчезают, а гаснут: таблица не «прыгает» при каждом переходе. */
.dl-list-wrap--busy > :not(.dl-list-overlay) {
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.dl-list-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  /* Кружок у верхнего края: на длинной странице по центру он оказался бы
     за пределами экрана. */
  padding-top: 64px;
  pointer-events: none;
}

/* Заблокированная вкладка во время запроса — приглушённая, но не «мёртвая». */
.tab-btn:disabled { opacity: 0.5; cursor: default; }

/* Прилипающая пагинация (ServerPager) требует, чтобы предки не обрезали
   содержимое — у v-card overflow: hidden по умолчанию. */
.deals-card { overflow: visible; }

/* ── Управляемые/сортируемые колонки таблицы ── */
.th-index, .td-index {
  width: 24px; min-width: 24px; padding-left: 2px; padding-right: 2px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.deals-table thead th { white-space: nowrap; }
.th-inner { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.th-sortable { cursor: pointer; user-select: none; }
.th-sortable .th-sort-ico { opacity: 0.35; transition: opacity 0.15s; }
.th-sortable:hover .th-sort-ico { opacity: 0.7; }
.th-sorted { color: rgb(var(--v-theme-primary)); }
.th-sorted .th-sort-ico { opacity: 1; color: rgb(var(--v-theme-primary)); }
.deals-table th.text-end .th-inner { flex-direction: row-reverse; }

/* Меню выбора колонок */
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
/* Цвет наценки — раньше стоял прямо на ячейке, теперь ячейка общая на все колонки. */
.td-markup { color: #047857; }
.td-overdue { color: #dc2626; font-weight: 600; }
/* Комментарий бывает длинным: показываем одну строку, целиком — в подсказке. */
.td-comment {
  display: block; max-width: 260px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Поручители идут списком: между ними воздух, иначе имена слипаются. */
.td-guarantor + .td-guarantor { margin-top: 6px; }
.td-phone-wa {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
  color: #16a34a; background: rgba(37, 211, 102, 0.1);
  cursor: pointer;
}
.td-phone-wa:hover { background: rgba(37, 211, 102, 0.2); }

/* ── Тарифная блокировка сделок ── */
.deal-card--locked { opacity: 0.72; }
.deal-card--locked:hover { transform: none; box-shadow: none; }
.deal-lock-badge {
  position: absolute; top: 8px; left: 8px;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 7px;
  font-size: 11px; font-weight: 700;
  background: rgba(245, 158, 11, 0.92); color: #fff;
}
.deal-row--locked { opacity: 0.6; }
.deal-lock-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 7px; border-radius: 6px; white-space: nowrap;
  font-size: 11px; font-weight: 700;
  background: rgba(245, 158, 11, 0.14); color: #b45309;
}
.deal-lock-banner {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; margin-bottom: 14px; border-radius: 12px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.32);
}
.deal-lock-banner-icon {
  width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(245, 158, 11, 0.18); color: #b45309;
}
.deal-lock-banner-text { flex: 1; min-width: 0; }
.deal-lock-banner-title { font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.deal-lock-banner-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; }
.deal-lock-banner-btn {
  flex-shrink: 0; padding: 8px 16px; border-radius: 9px;
  font-size: 13px; font-weight: 600; color: #fff;
  background: #f59e0b; cursor: pointer; transition: background 0.15s;
}
.deal-lock-banner-btn:hover { background: #d97706; }
.deal-lock-dialog-icon {
  width: 60px; height: 60px; border-radius: 16px; margin: 0 auto;
  display: flex; align-items: center; justify-content: center;
  background: rgba(245, 158, 11, 0.14); color: #b45309;
}
.dlg-btn {
  flex: 1; padding: 10px 16px; border-radius: 10px;
  font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.dlg-btn--ghost {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.dlg-btn--ghost:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.dlg-btn--primary { background: rgb(var(--v-theme-primary)); color: #fff; }
.dlg-btn--primary:hover { opacity: 0.9; }
@media (max-width: 599px) {
  .deal-lock-banner { flex-wrap: wrap; }
  .deal-lock-banner-btn { width: 100%; }
}
.external-badge {
  display: inline-flex; padding: 2px 6px; border-radius: 5px;
  background: rgba(99, 102, 241, 0.1); color: #6366f1;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  margin-left: 4px; vertical-align: middle;
}
.deal-card-placeholder {
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.15);
}
.deal-card-status {
  position: absolute; top: 10px; right: 10px;
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px;
}

.deal-card-body { padding: 16px; }
.deal-card-num,
.table-deal-num {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.06);
  padding: 3px 8px;
  border-radius: 6px;
  margin-right: 6px;
  font-variant-numeric: tabular-nums;
  vertical-align: 1px;
}
.deal-card-title {
  font-size: 15px; font-weight: 600; line-height: 1.3; margin-bottom: 4px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.deal-card-client {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; gap: 4px;
}
.deal-card-phone {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  display: flex; align-items: center; gap: 4px;
  margin-top: 2px; margin-bottom: 12px;
}
.client-phone-row {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.deal-card-prices { margin-bottom: 12px; }
.deal-card-total {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.deal-card-markup {
  font-size: 13px; color: #047857; font-weight: 500;
}
.deal-card-progress-row {
  display: flex; align-items: center; gap: 8px;
}
.deal-card-progress-text {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
}

/* Table */
/* Selection bar */
.select-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.select-bar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-bar-count {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.select-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-bar-delete {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  background: #ef4444;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.select-bar-delete:hover { background: #dc2626; }
.select-bar-delete:disabled { opacity: 0.6; cursor: not-allowed; }

.select-bar-restore {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  background: #047857;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.select-bar-restore:hover { background: #065f46; }
.select-bar-restore:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── Trash bar ── */
.trash-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.04) 0%, rgba(239, 68, 68, 0.01) 100%);
  border: 1px solid rgba(239, 68, 68, 0.14);
}

.trash-bar-left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.trash-bar-icon {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
}

.trash-bar-text { min-width: 0; line-height: 1.3; }

.trash-bar-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.trash-bar-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}

.trash-bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  border: 1px solid rgba(239, 68, 68, 0.25);
  background: rgba(var(--v-theme-surface), 1);
  color: #ef4444;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.trash-bar-btn:hover:not(:disabled) {
  background: #ef4444;
  color: #fff;
  border-color: #ef4444;
}

.trash-bar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dark .trash-bar {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(239, 68, 68, 0.02) 100%);
  border-color: rgba(239, 68, 68, 0.2);
}

.dark .trash-bar-btn {
  background: rgb(var(--v-theme-surface));
}

.select-bar-cancel {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.select-bar-cancel:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* Slide transition */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Dark mode */
.dark .select-bar {
  background: rgb(var(--v-theme-surface));
  border-color: rgb(var(--v-theme-border));
}

.deals-table :deep(td) { font-size: 14px; }
.deals-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}
.table-product-name {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
}
.deal-status-chip {
  display: inline-block; font-size: 11px; font-weight: 600;
  padding: 4px 10px; border-radius: 6px; white-space: nowrap;
}

/* Dialog */
.dialog-hero {
  position: relative;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  /* На зелёной подложке ссылка-имя должна быть белой, иначе сливается. */
  --client-link-color: #fff;
  --client-link-underline: rgba(255, 255, 255, 0.6);
  display: flex; gap: 16px; align-items: stretch;
  padding: 20px 24px;
  min-height: 160px;
}
.dialog-close {
  position: absolute; top: 12px; right: 12px; z-index: 3;
  width: 30px; height: 30px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
  backdrop-filter: blur(8px);
}
.dialog-close:hover { background: rgba(255, 255, 255, 0.3); }
.dialog-edit {
  position: absolute; top: 12px; right: 52px; z-index: 3;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 11px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.2);
  color: #fff; font-size: 12px; font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.15s;
}
.dialog-edit:hover { background: rgba(255, 255, 255, 0.3); }
.dialog-hero-photo {
  flex-shrink: 0;
  width: 120px; height: 120px;
  border-radius: 12px; overflow: hidden;
  align-self: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.dialog-hero-photo img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.dialog-hero-photo--empty {
  display: flex; align-items: center; justify-content: center;
}
.dialog-hero-photo-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  color: rgba(255, 255, 255, 0.55); font-size: 10px;
}
.dialog-hero-content {
  flex: 1; min-width: 0; color: #fff;
  display: flex; flex-direction: column; justify-content: flex-start;
  padding-right: 44px; /* room for close button */
}
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
.dialog-hero-meta {
  font-size: 12px; opacity: 0.85;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  margin-top: auto;
}

.dialog-avatar {
  width: 36px; height: 36px; min-width: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 14px;
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

/* Колонка действий: ширина держится и у оплаченных строк, где кнопок нет.
   Под текстовую кнопку «Оплатить» рядом с переносом даты нужно больше места,
   чем под две иконки. */
.action-btn {
  width: 30px; height: 30px; border-radius: 8px; border: none;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.action-btn--success { background: rgba(4, 120, 87, 0.1); color: #047857; }
.action-btn--success:hover { background: rgba(4, 120, 87, 0.2); }
.action-btn--warning { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
.action-btn--warning:hover { background: rgba(245, 158, 11, 0.2); }

/* Две кнопки в ряд: приём оплаты — основное действие, переход на страницу —
   вспомогательное. */
.dialog-actions-row { display: flex; gap: 8px; flex-wrap: wrap; }
.dialog-actions-row .detail-link-btn { flex: 1 1 200px; margin-bottom: 0; }
/* Detail link */
.detail-link-btn {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 10px 16px; border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.04);
  color: rgb(var(--v-theme-primary));
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  justify-content: center;
}
.detail-link-btn:hover {
  background: rgba(var(--v-theme-primary), 0.1);
  border-color: rgba(var(--v-theme-primary), 0.5);
}

/* Приём оплаты — основное действие окна: сплошная фирменная заливка, чтобы
   не путался со ссылкой на страницу сделки. Идёт СТРОГО после базового
   правила: специфичность у них одинаковая, выигрывает тот, кто ниже. */
.detail-link-btn--pay {
  border: 1px solid rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: #fff;
  font-weight: 600;
}
.detail-link-btn--pay:hover {
  background: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary));
  filter: brightness(1.12);
}

/* Dark mode */
.dark .stat-card {
  background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border));
}
.dark .deal-card {
  background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border));
}
.dark .filter-input {
  background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); color: rgba(var(--v-theme-on-surface), 0.92);
}
.dark .filter-input:focus {
  border-color: #047857; background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark :deep(.filter-select .v-field) {
  background: rgb(var(--v-theme-surface-elevated)) !important; border-color: rgb(var(--v-theme-border)); color: rgba(var(--v-theme-on-surface), 0.92);
}
.dark :deep(.filter-select .v-field--focused) {
  border-color: #047857 !important; background: rgb(var(--v-theme-surface)) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent) !important;
}
.dark .view-toggle { background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); }
.dark .view-toggle-btn.active { background: rgb(var(--v-theme-border)); box-shadow: none; }
.dark .filter-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.5); }
.dark :deep(.filter-select .v-field .v-field__prepend-inner),
.dark :deep(.filter-select .v-field .v-field__append-inner) { color: rgba(var(--v-theme-on-surface), 0.5); }
.dark .dialog-finance-item { background: rgba(255, 255, 255, 0.04); }

/* Folders */
.folder-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 12px; font-weight: 500;
  cursor: pointer; transition: all 0.12s; white-space: nowrap;
}
.folder-chip:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.folder-chip.active {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}
.folder-chip--add {
  padding: 5px 8px;
  color: rgba(var(--v-theme-on-surface), 0.3);
}
.folder-chip--add:hover { color: rgb(var(--v-theme-primary)); }
.folder-chip-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.folder-chip-count {
  font-size: 10px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.3);
  margin-left: 1px;
}

.folder-move-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 14px; border-radius: 8px; border: none;
  background: rgba(99, 102, 241, 0.1); color: #6366f1;
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.12s;
}
.folder-move-btn:hover { background: rgba(99, 102, 241, 0.18); }

.folder-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 12px; border-radius: 8px; border: none;
  background: none; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; text-align: left;
}
.folder-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }

/* Folder button & dropdown */
.fb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: #fff;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.12s;
}
.fb-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.2); color: rgba(var(--v-theme-on-surface), 0.8); }
.fb-btn--active {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
  background: #fff;
  color: rgba(var(--v-theme-on-surface), 0.8); font-weight: 600;
}

.fb-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.fb-btn-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.fb-dropdown { width: 240px; padding: 0; overflow: hidden; }
.fb-dropdown-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.fb-dropdown-add {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 4px 10px; border-radius: 6px; border: none;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  font-size: 11px; font-weight: 600; cursor: pointer;
}
.fb-dropdown-add:hover { background: rgba(var(--v-theme-primary), 0.15); }
.fb-dropdown-body { padding: 6px; }

.fb-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border-radius: 8px; border: none; background: none;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.65);
  cursor: pointer; text-align: left; transition: background 0.1s;
}
.fb-item:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.fb-item--active {
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}
.fb-item-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.fb-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-item-count {
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.2);
  flex-shrink: 0;
}
.fb-item-edit {
  width: 20px; height: 20px; border-radius: 5px; border: none;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.15);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0; transition: all 0.12s; flex-shrink: 0;
}
.fb-item:hover .fb-item-edit { opacity: 1; }
.fb-item-edit:hover { background: rgba(var(--v-theme-on-surface), 0.1); color: rgba(var(--v-theme-on-surface), 0.6); }
.fb-divider { height: 1px; background: rgba(var(--v-theme-on-surface), 0.06); margin: 4px 6px; }
.fb-empty { padding: 12px; text-align: center; }

.dark .fb-dropdown-header { border-bottom-color: rgba(255,255,255,0.06); }
.dark .fb-btn { background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border)); }
.dark .fb-btn:hover { border-color: rgb(var(--v-theme-border)); }
.dark .fb-btn--active { background: rgba(var(--v-theme-primary), 0.1); border-color: rgba(var(--v-theme-primary), 0.2); }
.dark .fb-item:hover { background: rgba(255,255,255,0.04); }
.dark .fb-item--active { background: rgba(var(--v-theme-primary), 0.1); }

.folder-menu-item--active { background: rgba(var(--v-theme-primary), 0.06); }

.deal-folder-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 5px;
  font-size: 10px; font-weight: 600; margin-left: 6px;
}

/* Folder dialog */
.fd-dialog { padding: 0 !important; overflow: hidden; }
.fd-header {
  display: flex; align-items: center; gap: 12px;
  padding: 20px 24px 16px;
}
.fd-header-icon {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.fd-title { font-size: 17px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.fd-subtitle { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4); margin-top: 1px; }
.fd-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.4);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; margin-left: auto;
}
.fd-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.fd-body { padding: 0 24px 16px; }
.fd-field { margin-bottom: 16px; }
.fd-label {
  display: block; font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; color: rgba(var(--v-theme-on-surface), 0.35);
  margin-bottom: 8px;
}
.fd-input {
  width: 100%; height: 44px; padding: 0 14px;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.02); outline: none;
}
.fd-input:focus { border-color: #047857; box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.08); }
.fd-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.25); }
.fd-colors { display: flex; gap: 8px; flex-wrap: wrap; }
.fd-color {
  width: 32px; height: 32px; border-radius: 50%; border: 3px solid transparent;
  cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.fd-color:hover { transform: scale(1.15); }
.fd-color.active { border-color: rgba(var(--v-theme-on-surface), 0.15); transform: scale(1.1); }
.fd-preview {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.fd-preview-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.35); }
.fd-preview-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 12px; border-radius: 7px;
  font-size: 12px; font-weight: 600;
}
.fd-preview-dot { width: 8px; height: 8px; border-radius: 50%; }
.fd-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 24px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.fd-delete {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 7px 14px; border-radius: 8px; border: none;
  background: rgba(239, 68, 68, 0.08); color: #ef4444;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.fd-delete:hover { background: rgba(239, 68, 68, 0.15); }
.fd-cancel {
  padding: 8px 18px; border-radius: 9px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.fd-cancel:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.fd-save {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 20px; border-radius: 9px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.fd-save:hover { background: #065f46; }
.fd-save:disabled { opacity: 0.4; cursor: not-allowed; }

.dark .folder-chip { background: rgba(255,255,255,0.06); }
.dark .folder-chip.active { background: rgba(var(--v-theme-primary), 0.15); }
.dark .fd-input { background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border)); }
.dark .fd-preview { background: rgba(255,255,255,0.04); }
.dark .fd-footer { border-top-color: rgba(255,255,255,0.06); }
.dark .fd-color.active { border-color: rgba(255,255,255,0.2); }

/* ───── Mobile tweaks ───── */
@media (max-width: 767px) {
  /* Stat-карточки чуть компактнее чтобы 2×2 не растягивались. */
  .stat-card { padding: 12px; }
  .stat-value { font-size: 16px; }
  .stat-label { font-size: 11px; }
  .stat-icon { width: 32px; height: 32px; }

  /* Вкладки (Активные/Завершённые/Все/Корзина) — горизонтальный скролл. */
  .pa-4 > .d-flex.flex-wrap.ga-2.align-center > .d-flex.ga-2:first-child {
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    flex: 1 1 100%;
    min-width: 0;
    padding-bottom: 2px;
  }
  .pa-4 > .d-flex.flex-wrap.ga-2.align-center > .d-flex.ga-2:first-child::-webkit-scrollbar {
    display: none;
  }
  .tab-btn {
    flex-shrink: 0;
  }

  /* Search/sort/select-mode группа — на всю ширину. */
  .pa-4 > .d-flex.flex-wrap.ga-2.align-center > .d-flex.flex-wrap.ga-2.align-center {
    flex: 1 1 100%;
  }
  .filter-input-wrap {
    flex: 1 1 100%;
    max-width: 100% !important;
  }
  .filter-select {
    flex: 1 1 auto;
    max-width: none !important;
  }
}
</style>
