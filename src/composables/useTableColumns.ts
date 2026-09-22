/**
 * Настраиваемые колонки таблицы: какие показывать, в каком порядке, готовые
 * и свои наборы.
 *
 * Один и тот же механизм нужен каждому большому списку — в сделках, должниках
 * и клиентах колонок по два десятка, и у каждого партнёра свой привычный
 * набор. Раньше он копировался в страницу целиком: триста строк на раздел, и
 * любая правка расходилась по копиям.
 *
 * Хранится в браузере: это личная привычка конкретного человека, а не
 * настройка компании.
 */
import { computed, ref, watch, type Ref } from 'vue'

export interface TableColumn<G extends string = string> {
  key: string
  label: string
  align: 'start' | 'end' | 'center'
  sortable: boolean
  tdClass?: string
  tdStyle?: string
  /** Раздел в меню выбора: плоский список из двух десятков колонок неудобен. */
  group: G
}

export interface ColumnPreset {
  key: string
  label: string
  columns: string[]
}

export interface SavedPreset {
  id: string
  name: string
  columns: string[]
  order: string[]
}

export interface UseTableColumnsOptions<G extends string> {
  /** Приставка ключей хранения, например `clients`. */
  storageKey: string
  columns: TableColumn<G>[]
  /** Что показано у того, кто ещё ничего не настраивал. */
  defaultVisible: string[]
  /** Разделы меню в нужном порядке. */
  groups: { key: G; label: string }[]
  /** Готовые наборы под частые задачи. */
  presets?: ColumnPreset[]
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* приватный режим — настройка просто не переживёт перезагрузку */
  }
}

export function useTableColumns<G extends string>(options: UseTableColumnsOptions<G>) {
  const { columns: ALL, defaultVisible, groups, presets = [] } = options
  const VISIBLE_KEY = `${options.storageKey}:table-columns`
  const ORDER_KEY = `${options.storageKey}:table-column-order`
  const SAVED_KEY = `${options.storageKey}:column-presets`

  const DEFAULT_ORDER = ALL.map((c) => c.key)

  // ── Что показано ──
  const visibleCols = ref<Record<string, boolean>>(loadVisible())
  watch(visibleCols, (v) => write(VISIBLE_KEY, v), { deep: true })

  function loadVisible(): Record<string, boolean> {
    const base: Record<string, boolean> = {}
    for (const c of ALL) base[c.key] = defaultVisible.includes(c.key)
    const saved = read<Record<string, boolean> | null>(VISIBLE_KEY, null)
    if (saved && typeof saved === 'object') {
      // Только известные ключи: набор колонок со временем меняется, и мусор
      // из старой версии не должен ломать таблицу.
      for (const c of ALL) if (typeof saved[c.key] === 'boolean') base[c.key] = saved[c.key]!
    }
    return base
  }

  // ── В каком порядке ──
  const columnOrder = ref<string[]>(loadOrder())
  watch(columnOrder, (v) => write(ORDER_KEY, v), { deep: true })

  function loadOrder(): string[] {
    const saved = read<string[] | null>(ORDER_KEY, null)
    if (!Array.isArray(saved)) return [...DEFAULT_ORDER]
    const known = saved.filter((k): k is string => typeof k === 'string' && DEFAULT_ORDER.includes(k))
    // Колонки, появившиеся после сохранения порядка, встают на своё место из
    // умолчания, а не сваливаются в конец.
    for (const key of DEFAULT_ORDER) {
      if (known.includes(key)) continue
      const at = DEFAULT_ORDER.indexOf(key)
      const prev = DEFAULT_ORDER.slice(0, at).reverse().find((k) => known.includes(k))
      known.splice(prev ? known.indexOf(prev) + 1 : 0, 0, key)
    }
    return known
  }

  /** Все колонки в пользовательском порядке — для меню настройки. */
  const orderedColumns = computed(
    () => columnOrder.value.map((k) => ALL.find((c) => c.key === k)).filter(Boolean) as TableColumn<G>[],
  )
  /** Те же, но только включённые — по ним рисуется таблица. */
  const shownColumns = computed(() => orderedColumns.value.filter((c) => visibleCols.value[c.key]))

  function toggleColumn(key: string) {
    visibleCols.value[key] = !visibleCols.value[key]
  }

  function isColVisible(key: string) {
    return !!visibleCols.value[key]
  }

  // ── Меню: поиск и разделы ──
  const colSearch = ref('')

  const menuColumns = computed(() => {
    const q = colSearch.value.trim().toLowerCase()
    const list = orderedColumns.value
    return q ? list.filter((c) => c.label.toLowerCase().includes(q)) : list
  })

  /** Колонки меню по разделам. Пустые разделы не показываем. */
  const menuGroups = computed(() =>
    groups
      .map((g) => ({ ...g, columns: menuColumns.value.filter((c) => c.group === g.key) }))
      .filter((g) => g.columns.length),
  )

  // ── Наборы ──
  const savedPresets = ref<SavedPreset[]>(loadSaved())
  const presetName = ref('')

  function loadSaved(): SavedPreset[] {
    const raw = read<{ items?: unknown } | null>(SAVED_KEY, null)
    if (!raw || !Array.isArray(raw.items)) return []
    return (raw.items as SavedPreset[]).filter(
      (x) => x && typeof x.name === 'string' && Array.isArray(x.columns),
    )
  }

  function persistSaved() {
    write(SAVED_KEY, { v: 1, items: savedPresets.value })
  }

  function applyColumns(columns: string[], order?: string[]) {
    const next: Record<string, boolean> = {}
    for (const c of ALL) next[c.key] = columns.includes(c.key)
    visibleCols.value = next
    // Порядок ставим как в наборе, остальные — следом: иначе набор показал бы
    // нужные колонки в случайных местах таблицы.
    const base = (order ?? columns).filter((k) => DEFAULT_ORDER.includes(k))
    columnOrder.value = [...base, ...DEFAULT_ORDER.filter((k) => !base.includes(k))]
  }

  function applyPreset(preset: ColumnPreset) {
    applyColumns(preset.columns)
  }

  function applySavedPreset(p: SavedPreset) {
    applyColumns(p.columns, p.order)
  }

  function savePreset() {
    const name = presetName.value.trim()
    if (!name) return
    const columns = shownColumns.value.map((c) => c.key)
    const order = columnOrder.value.slice()
    const existing = savedPresets.value.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (existing) Object.assign(existing, { columns, order })
    else savedPresets.value.push({ id: `c${Date.now()}`, name, columns, order })
    persistSaved()
    presetName.value = ''
  }

  function removePreset(p: SavedPreset) {
    if (!confirm(`Удалить набор колонок «${p.name}»?`)) return
    savedPresets.value = savedPresets.value.filter((x) => x.id !== p.id)
    persistSaved()
  }

  function resetColumns() {
    columnOrder.value = [...DEFAULT_ORDER]
    const base: Record<string, boolean> = {}
    for (const c of ALL) base[c.key] = defaultVisible.includes(c.key)
    visibleCols.value = base
  }

  // ── Перетаскивание ──
  // Тащить можно и строку в меню, и сам заголовок в таблице — состояние одно.
  const dragColKey = ref<string | null>(null)
  let justDragged = false

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

  function onColDragEnd() {
    dragColKey.value = null
    // У части браузеров следом за перетаскиванием прилетает обычный клик по
    // заголовку — сортировку по нему включать не нужно.
    justDragged = true
    setTimeout(() => { justDragged = false }, 0)
  }

  /** Был ли только что перетащен заголовок — чтобы не поймать ложный клик. */
  function wasDragged() {
    return justDragged
  }

  return {
    all: ALL,
    visibleCols,
    columnOrder,
    orderedColumns,
    shownColumns,
    toggleColumn,
    isColVisible,
    colSearch,
    menuGroups,
    presets,
    savedPresets,
    presetName,
    applyPreset,
    applySavedPreset,
    savePreset,
    removePreset,
    resetColumns,
    dragColKey: dragColKey as Ref<string | null>,
    onColDragStart,
    onColDragOver,
    onColDragEnd,
    wasDragged,
  }
}
