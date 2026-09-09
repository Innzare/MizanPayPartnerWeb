/**
 * Фильтры списка платежей: состояние, разбор адреса и подписи для плашек.
 *
 * Устроено так же, как в сделках (`useDealsFilters`): один набор кормит
 * панель, плашки, адрес страницы и запрос к серверу. Состав условий свой —
 * в платежах фильтруют по сроку и факту оплаты, а не по датам договора.
 */
import { computed, ref } from 'vue'
import { formatCurrency } from '@/utils/formatters'

/** Статусы платежа. Работают вместе со вкладкой, сужая её выборку. */
export const PAYMENT_STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Ожидает' },
  { value: 'OVERDUE', label: 'Просрочен' },
  { value: 'PAID', label: 'Оплачен' },
  { value: 'CLOSED_EARLY', label: 'Закрыт досрочно' },
] as const

export const PAYMENT_DATE_PRESETS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
] as const

export interface PaymentsFilterState {
  /** Период по плановому сроку. */
  dueFrom: string
  dueTo: string
  /** Период по фактической оплате. */
  paidFrom: string
  paidTo: string
  statuses: string[]
  amountFrom: number | null
  amountTo: number | null
  cities: string[]
  product: string
  clientKey: string
  supplierId: string
  coInvestorId: string
  /**
   * Где и кто: касса, ответственный сотрудник, папка сделок.
   *
   * Раньше эти три жили отдельными кнопками в панели над таблицей, хотя по
   * смыслу ничем не отличаются от прочих условий выборки. В общем наборе они
   * попадают в счётчик, в плашки, в «сбросить всё» и в сохранённые наборы.
   */
  cashBoxId: string
  staffId: string
  folderId: string
}

function emptyState(): PaymentsFilterState {
  return {
    dueFrom: '',
    dueTo: '',
    paidFrom: '',
    paidTo: '',
    statuses: [],
    amountFrom: null,
    amountTo: null,
    cities: [],
    product: '',
    clientKey: '',
    supplierId: '',
    coInvestorId: '',
    cashBoxId: '',
    staffId: '',
    folderId: '',
  }
}

const ARRAY_KEYS = ['statuses', 'cities'] as const
const NUMERIC_KEYS = ['amountFrom', 'amountTo'] as const
const TEXT_KEYS = [
  'dueFrom', 'dueTo', 'paidFrom', 'paidTo', 'product', 'clientKey', 'supplierId', 'coInvestorId',
  'cashBoxId', 'staffId', 'folderId',
] as const

function ymd(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function fmtDate(v: string): string {
  if (!v) return ''
  const [y, m, d] = v.split('-')
  return `${d}.${m}.${y}`
}

export function usePaymentsFilters(options?: {
  labels?: () => {
    suppliers?: Record<string, string>
    coInvestors?: Record<string, string>
    client?: string
    cashBoxes?: Record<string, string>
    staff?: Record<string, string>
    folders?: Record<string, string>
  }
}) {
  const state = ref<PaymentsFilterState>(emptyState())

  /** Параметры для сервера — только заполненные. */
  const query = computed<Record<string, string | number>>(() => {
    const s = state.value
    const out: Record<string, string | number> = {}
    for (const k of ARRAY_KEYS) if (s[k].length) out[k] = s[k].join(',')
    for (const k of NUMERIC_KEYS) if (s[k] != null) out[k] = s[k] as number
    for (const k of TEXT_KEYS) if (String(s[k]).trim()) out[k] = String(s[k]).trim()
    // Сервер зовёт этот фильтр «ответственный за сделку»: имя параметра
    // общее со списком сделок, менять его на стороне сервера незачем.
    if (out.staffId) {
      out.assignedStaffId = out.staffId
      delete out.staffId
    }
    return out
  })

  const activeCount = computed(() => {
    const s = state.value
    let n = 0
    for (const k of ARRAY_KEYS) if (s[k].length) n++
    for (const k of NUMERIC_KEYS) if (s[k] != null) n++
    if (s.dueFrom || s.dueTo) n++
    if (s.paidFrom || s.paidTo) n++
    if (s.product.trim()) n++
    if (s.clientKey) n++
    if (s.supplierId) n++
    if (s.coInvestorId) n++
    if (s.cashBoxId) n++
    if (s.staffId) n++
    if (s.folderId) n++
    return n
  })

  const hasAny = computed(() => activeCount.value > 0)

  const chips = computed(() => {
    const s = state.value
    const l = options?.labels?.() ?? {}
    const out: Array<{ key: string; label: string; clear: () => void }> = []

    const range = (from: string, to: string) =>
      from && to ? `${fmtDate(from)} — ${fmtDate(to)}` : from ? `с ${fmtDate(from)}` : `по ${fmtDate(to)}`

    if (s.dueFrom || s.dueTo) {
      out.push({
        key: 'due',
        label: `Срок: ${range(s.dueFrom, s.dueTo)}`,
        clear: () => { s.dueFrom = ''; s.dueTo = '' },
      })
    }
    if (s.paidFrom || s.paidTo) {
      out.push({
        key: 'paid',
        label: `Оплачен: ${range(s.paidFrom, s.paidTo)}`,
        clear: () => { s.paidFrom = ''; s.paidTo = '' },
      })
    }
    if (s.statuses.length) {
      const labels = s.statuses.map(
        (v) => PAYMENT_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v,
      )
      out.push({ key: 'statuses', label: `Статус: ${labels.join(', ')}`, clear: () => { s.statuses = [] } })
    }
    if (s.amountFrom != null || s.amountTo != null) {
      const text = s.amountFrom != null && s.amountTo != null
        ? `${formatCurrency(s.amountFrom)} — ${formatCurrency(s.amountTo)}`
        : s.amountFrom != null ? `от ${formatCurrency(s.amountFrom)}` : `до ${formatCurrency(s.amountTo as number)}`
      out.push({
        key: 'amount',
        label: `Сумма: ${text}`,
        clear: () => { s.amountFrom = null; s.amountTo = null },
      })
    }
    if (s.cities.length) {
      out.push({ key: 'cities', label: `Город: ${s.cities.join(', ')}`, clear: () => { s.cities = [] } })
    }
    if (s.product.trim()) {
      out.push({ key: 'product', label: `Товар: ${s.product.trim()}`, clear: () => { s.product = '' } })
    }
    if (s.clientKey) {
      out.push({ key: 'client', label: `Клиент: ${l.client ?? '—'}`, clear: () => { s.clientKey = '' } })
    }
    if (s.supplierId) {
      out.push({
        key: 'supplier',
        label: `Поставщик: ${l.suppliers?.[s.supplierId] ?? '—'}`,
        clear: () => { s.supplierId = '' },
      })
    }
    if (s.coInvestorId) {
      out.push({
        key: 'coInvestor',
        label: `Инвестор: ${l.coInvestors?.[s.coInvestorId] ?? '—'}`,
        clear: () => { s.coInvestorId = '' },
      })
    }
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
    return out
  })

  function reset() {
    state.value = emptyState()
  }

  /** Быстрый период. `field` выбирает, к какой дате он применяется. */
  function applyPreset(key: string, field: 'due' | 'paid' = 'due') {
    const now = new Date()
    const from = new Date()
    if (key === 'week') from.setDate(now.getDate() - 7)
    else if (key === 'month') from.setMonth(now.getMonth() - 1)
    else if (key === 'quarter') from.setMonth(now.getMonth() - 3)
    else if (key === 'year') from.setFullYear(now.getFullYear() - 1)
    if (field === 'due') {
      state.value.dueFrom = ymd(from)
      state.value.dueTo = ymd(now)
    } else {
      state.value.paidFrom = ymd(from)
      state.value.paidTo = ymd(now)
    }
  }

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
      const raw = str(q[k])
      const n = Number(raw)
      if (raw !== '' && Number.isFinite(n)) next[k] = n
    }
    for (const k of TEXT_KEYS) next[k] = str(q[k])
    // В адресе страницы и в сохранённых наборах ответственный лежит под
    // серверным именем — читаем оба написания.
    if (!next.staffId) next.staffId = str(q.assignedStaffId)
    state.value = next
  }

  function toQuery(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(query.value)) out[k] = String(v)
    return out
  }

  // ── Сохранённые наборы ──
  const PRESETS_KEY = 'payments:filter-presets'
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

  function persist() {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify({ v: 1, items: saved.value }))
    } catch { /* ignore */ }
  }

  function savePreset(name: string) {
    const clean = name.trim()
    if (!clean) return
    const q = toQuery()
    const existing = saved.value.find((p) => p.name.toLowerCase() === clean.toLowerCase())
    if (existing) existing.query = q
    else saved.value.push({ id: `p${Date.now()}`, name: clean, query: q })
    persist()
  }

  function applyPresetSaved(id: string) {
    const p = saved.value.find((x) => x.id === id)
    if (p) fromQuery(p.query)
  }

  function removePreset(id: string) {
    saved.value = saved.value.filter((x) => x.id !== id)
    persist()
  }

  return {
    state, query, chips, activeCount, hasAny, reset, applyPreset, fromQuery, toQuery,
    saved, savePreset, applyPresetSaved, removePreset,
  }
}
