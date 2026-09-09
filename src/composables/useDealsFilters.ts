/**
 * Фильтры списка сделок: состояние, разбор адреса и подписи для плашек.
 *
 * Всё в одном месте, потому что один и тот же набор фильтров нужен четырём
 * вещам сразу: панели настройки, плашкам включённых условий, адресу страницы
 * (чтобы выборкой можно было поделиться ссылкой) и запросу к серверу.
 *
 * Ключи здесь совпадают с именами параметров сервера — так меньше мест, где
 * можно ошибиться, и адрес страницы читается человеком.
 */
import { computed, ref } from 'vue'
import { formatCurrency } from '@/utils/formatters'

/** По какой дате считается период. */
export const DATE_FIELDS = [
  { value: 'createdAt', label: 'Дата создания' },
  { value: 'dealDate', label: 'Дата договора' },
  { value: 'scheduleEndAt', label: 'Дата последнего платежа' },
  { value: 'completedAt', label: 'Дата завершения' },
] as const

export const DEAL_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Активна' },
  { value: 'COMPLETED', label: 'Завершена' },
  { value: 'DISPUTED', label: 'Спор' },
  { value: 'CANCELLED', label: 'Отменена' },
] as const

/** Особенности договора, которые сервис определяет сам. */
export const DEAL_FLAG_OPTIONS = [
  { value: 'overdue', label: 'Просрочен' },
  { value: 'paidEarly', label: 'Погашен досрочно' },
  { value: 'forgiven', label: 'Есть списание' },
  { value: 'discounted', label: 'Есть скидка' },
] as const

export const PAY_STATE_OPTIONS = [
  { value: 'none', label: 'Оплат не было' },
  { value: 'partial', label: 'Оплачен частично' },
  { value: 'paid', label: 'Оплачен полностью' },
  { value: 'hasOverdue', label: 'Есть просроченные' },
] as const

/** Быстрые периоды. Считаются от сегодняшнего дня. */
export const DATE_PRESETS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
] as const

function ymd(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export interface DealsFilterState {
  dateField: string
  dateFrom: string
  dateTo: string
  statuses: string[]
  flags: string[]
  payStates: string[]
  cities: string[]
  totalFrom: number | null
  totalTo: number | null
  remainingFrom: number | null
  remainingTo: number | null
  monthlyFrom: number | null
  monthlyTo: number | null
  termFrom: number | null
  termTo: number | null
  overdueFrom: number | null
  overdueTo: number | null
  supplierId: string
  noSupplier: boolean
  coInvestorId: string
  noCoInvestor: boolean
  product: string
  clientKey: string
  /**
   * Где и кто: касса, ответственный сотрудник, папка.
   *
   * Раньше эти три жили отдельными кнопками над таблицей, хотя по смыслу
   * ничем не отличаются от прочих условий выборки. В общем наборе они попадают
   * в счётчик, в плашки, в «сбросить всё» и в сохранённые наборы.
   */
  cashBoxId: string
  staffId: string
  folderId: string
}

function emptyState(): DealsFilterState {
  return {
    dateField: 'createdAt',
    dateFrom: '',
    dateTo: '',
    statuses: [],
    flags: [],
    payStates: [],
    cities: [],
    totalFrom: null,
    totalTo: null,
    remainingFrom: null,
    remainingTo: null,
    monthlyFrom: null,
    monthlyTo: null,
    termFrom: null,
    termTo: null,
    overdueFrom: null,
    overdueTo: null,
    supplierId: '',
    noSupplier: false,
    coInvestorId: '',
    noCoInvestor: false,
    product: '',
    clientKey: '',
    cashBoxId: '',
    staffId: '',
    folderId: '',
  }
}

/** Ключи, уходящие на сервер. Порядок — как в адресе страницы. */
const NUMERIC_KEYS = [
  'totalFrom', 'totalTo', 'remainingFrom', 'remainingTo',
  'monthlyFrom', 'monthlyTo', 'termFrom', 'termTo',
  'overdueFrom', 'overdueTo',
] as const
const ARRAY_KEYS = ['statuses', 'flags', 'payStates', 'cities'] as const
const TEXT_KEYS = [
  'dateFrom', 'dateTo', 'supplierId', 'coInvestorId', 'product', 'clientKey',
  'cashBoxId', 'staffId', 'folderId',
] as const
const BOOL_KEYS = ['noSupplier', 'noCoInvestor'] as const

export function useDealsFilters(options?: {
  /** Подписи для плашек: id → название. Заполняет страница. */
  labels?: () => {
    suppliers?: Record<string, string>
    coInvestors?: Record<string, string>
    client?: string
    cashBoxes?: Record<string, string>
    staff?: Record<string, string>
    folders?: Record<string, string>
  }
}) {
  const state = ref<DealsFilterState>(emptyState())

  /** Параметры для сервера — только заполненные. */
  const query = computed<Record<string, string | number>>(() => {
    const s = state.value
    const out: Record<string, string | number> = {}
    for (const k of ARRAY_KEYS) if (s[k].length) out[k] = s[k].join(',')
    for (const k of NUMERIC_KEYS) if (s[k] != null) out[k] = s[k] as number
    for (const k of TEXT_KEYS) if (String(s[k]).trim()) out[k] = String(s[k]).trim()
    // Сервер зовёт этот фильтр «ответственный за сделку».
    if (out.staffId) {
      out.assignedStaffId = out.staffId
      delete out.staffId
    }
    for (const k of BOOL_KEYS) if (s[k]) out[k] = '1'
    // Поле даты отправляем только вместе с периодом: само по себе оно ничего
    // не фильтрует, а в адресе выглядело бы включённым фильтром.
    if ((s.dateFrom || s.dateTo) && s.dateField !== 'createdAt') out.dateField = s.dateField
    return out
  })

  /** Сколько условий включено — для бейджа на кнопке «Фильтры». */
  const activeCount = computed(() => {
    const s = state.value
    let n = 0
    for (const k of ARRAY_KEYS) if (s[k].length) n++
    for (const k of NUMERIC_KEYS) if (s[k] != null) n++
    for (const k of TEXT_KEYS) if (k !== 'dateFrom' && k !== 'dateTo' && String(s[k]).trim()) n++
    for (const k of BOOL_KEYS) if (s[k]) n++
    if (s.dateFrom || s.dateTo) n++
    return n
  })

  const hasAny = computed(() => activeCount.value > 0)

  // ── Плашки включённых фильтров ──
  // При восьми условиях невидимый включённый фильтр превращается в «сделка
  // пропала», поэтому каждое условие показывается отдельной плашкой.
  const chips = computed(() => {
    const s = state.value
    const l = options?.labels?.() ?? {}
    const out: Array<{ key: string; label: string; clear: () => void }> = []

    if (s.dateFrom || s.dateTo) {
      const field = DATE_FIELDS.find((f) => f.value === s.dateField)?.label ?? 'Период'
      const range = s.dateFrom && s.dateTo
        ? `${fmtDate(s.dateFrom)} — ${fmtDate(s.dateTo)}`
        : s.dateFrom ? `с ${fmtDate(s.dateFrom)}` : `по ${fmtDate(s.dateTo)}`
      out.push({
        key: 'period',
        label: `${field}: ${range}`,
        clear: () => { s.dateFrom = ''; s.dateTo = '' },
      })
    }

    pushList(out, s.statuses, DEAL_STATUS_OPTIONS, 'Статус', () => { s.statuses = [] })
    pushList(out, s.flags, DEAL_FLAG_OPTIONS, 'Признак', () => { s.flags = [] })
    pushList(out, s.payStates, PAY_STATE_OPTIONS, 'Оплаты', () => { s.payStates = [] })

    if (s.cities.length) {
      out.push({
        key: 'cities',
        label: `Город: ${s.cities.join(', ')}`,
        clear: () => { s.cities = [] },
      })
    }

    pushRange(out, 'Сумма', s.totalFrom, s.totalTo, 'money', () => { s.totalFrom = null; s.totalTo = null })
    pushRange(out, 'Остаток', s.remainingFrom, s.remainingTo, 'money', () => { s.remainingFrom = null; s.remainingTo = null })
    pushRange(out, 'Ежемесячно', s.monthlyFrom, s.monthlyTo, 'money', () => { s.monthlyFrom = null; s.monthlyTo = null })
    pushRange(out, 'Срок', s.termFrom, s.termTo, 'months', () => { s.termFrom = null; s.termTo = null })
    pushRange(out, 'Просрочка', s.overdueFrom, s.overdueTo, 'money', () => { s.overdueFrom = null; s.overdueTo = null })

    if (s.supplierId) {
      out.push({
        key: 'supplier',
        label: `Поставщик: ${l.suppliers?.[s.supplierId] ?? '—'}`,
        clear: () => { s.supplierId = '' },
      })
    }
    if (s.noSupplier) out.push({ key: 'noSupplier', label: 'Без поставщика', clear: () => { s.noSupplier = false } })
    if (s.coInvestorId) {
      out.push({
        key: 'coInvestor',
        label: `Инвестор: ${l.coInvestors?.[s.coInvestorId] ?? '—'}`,
        clear: () => { s.coInvestorId = '' },
      })
    }
    if (s.noCoInvestor) out.push({ key: 'noCoInvestor', label: 'Без инвесторов', clear: () => { s.noCoInvestor = false } })
    if (s.cashBoxId) {
      out.push({
        key: 'cashBox',
        label: `Касса: ${l.cashBoxes?.[s.cashBoxId] ?? '—'}`,
        clear: () => { s.cashBoxId = '' },
      })
    }
    if (s.staffId) {
      out.push({
        key: 'staff',
        label: `Сотрудник: ${l.staff?.[s.staffId] ?? '—'}`,
        clear: () => { s.staffId = '' },
      })
    }
    if (s.folderId) {
      out.push({
        key: 'folder',
        label: `Папка: ${l.folders?.[s.folderId] ?? '—'}`,
        clear: () => { s.folderId = '' },
      })
    }
    if (s.product.trim()) {
      out.push({ key: 'product', label: `Товар: ${s.product.trim()}`, clear: () => { s.product = '' } })
    }
    if (s.clientKey) {
      out.push({ key: 'client', label: `Клиент: ${l.client ?? '—'}`, clear: () => { s.clientKey = '' } })
    }
    return out
  })

  function reset() {
    state.value = emptyState()
  }

  // ── Сохранённые наборы ──
  // «Просроченные по Ахмеду», «Поставщик X за квартал» — один клик вместо
  // шести. Хранятся в браузере: набор — личная привычка конкретного человека,
  // а не настройка партнёра.
  const PRESETS_KEY = 'deals:filter-presets'
  const saved = ref<Array<{ id: string; name: string; query: Record<string, string> }>>(loadPresets())

  function loadPresets(): Array<{ id: string; name: string; query: Record<string, string> }> {
    try {
      const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) || 'null')
      if (!raw || !Array.isArray(raw.items)) return []
      return raw.items.filter((x: any) => x && typeof x.name === 'string' && x.query)
    } catch {
      return []
    }
  }

  function persistPresets() {
    try {
      // Версия — чтобы будущая смена формата не применила старый набор
      // к другим фильтрам.
      localStorage.setItem(PRESETS_KEY, JSON.stringify({ v: 1, items: saved.value }))
    } catch { /* ignore */ }
  }

  function savePreset(name: string) {
    const clean = name.trim()
    if (!clean) return
    const query = toQuery()
    const existing = saved.value.find((p) => p.name.toLowerCase() === clean.toLowerCase())
    if (existing) existing.query = query
    else saved.value.push({ id: `p${Date.now()}`, name: clean, query })
    persistPresets()
  }

  function applyPresetSaved(id: string) {
    const p = saved.value.find((x) => x.id === id)
    if (p) fromQuery(p.query)
  }

  function removePreset(id: string) {
    saved.value = saved.value.filter((x) => x.id !== id)
    persistPresets()
  }

  /** Быстрый период: от сегодня назад. */
  function applyPreset(key: string) {
    const now = new Date()
    const from = new Date()
    if (key === 'today') { /* от сегодня */ }
    else if (key === 'week') from.setDate(now.getDate() - 7)
    else if (key === 'month') from.setMonth(now.getMonth() - 1)
    else if (key === 'quarter') from.setMonth(now.getMonth() - 3)
    else if (key === 'year') from.setFullYear(now.getFullYear() - 1)
    state.value.dateFrom = ymd(from)
    state.value.dateTo = ymd(now)
  }

  /** Разбор адреса страницы — чтобы пересланная ссылка открывала ту же выборку. */
  function fromQuery(q: Record<string, unknown>) {
    const next = emptyState()
    const str = (v: unknown): string => {
      const x = Array.isArray(v) ? v[0] : v
      return typeof x === 'string' ? x : ''
    }
    for (const k of ARRAY_KEYS) {
      const raw = str(q[k])
      if (raw) next[k] = raw.split(',').filter(Boolean)
    }
    for (const k of NUMERIC_KEYS) {
      const n = Number(str(q[k]))
      if (str(q[k]) !== '' && Number.isFinite(n)) next[k] = n
    }
    for (const k of TEXT_KEYS) next[k] = str(q[k])
    // В адресе и в сохранённых наборах ответственный лежит под серверным
    // именем — читаем оба написания.
    if (!next.staffId) next.staffId = str(q.assignedStaffId)
    for (const k of BOOL_KEYS) next[k] = str(q[k]) === '1'
    const df = str(q.dateField)
    if (DATE_FIELDS.some((f) => f.value === df)) next.dateField = df
    state.value = next
  }

  /** Обратно в адрес — те же ключи, что уходят на сервер. */
  function toQuery(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(query.value)) out[k] = String(v)
    return out
  }

  return {
    state, query, chips, activeCount, hasAny, reset, applyPreset, fromQuery, toQuery,
    saved, savePreset, applyPresetSaved, removePreset,
  }
}

function fmtDate(ymdStr: string): string {
  if (!ymdStr) return ''
  const [y, m, d] = ymdStr.split('-')
  return `${d}.${m}.${y}`
}

function pushList(
  out: Array<{ key: string; label: string; clear: () => void }>,
  values: string[],
  options: readonly { value: string; label: string }[],
  title: string,
  clear: () => void,
) {
  if (!values.length) return
  const labels = values.map((v) => options.find((o) => o.value === v)?.label ?? v)
  out.push({ key: title, label: `${title}: ${labels.join(', ')}`, clear })
}

function pushRange(
  out: Array<{ key: string; label: string; clear: () => void }>,
  title: string,
  from: number | null,
  to: number | null,
  kind: 'money' | 'months',
  clear: () => void,
) {
  if (from == null && to == null) return
  const fmt = (n: number) => (kind === 'money' ? formatCurrency(n) : `${n} мес.`)
  const text = from != null && to != null
    ? `${fmt(from)} — ${fmt(to)}`
    : from != null ? `от ${fmt(from)}` : `до ${fmt(to as number)}`
  out.push({ key: title, label: `${title}: ${text}`, clear })
}
