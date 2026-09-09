/**
 * Фильтры раздела «Должники».
 *
 * Как в сделках и платежах: один набор кормит панель, плашки, адрес страницы
 * и запрос к серверу. Состав свой — здесь фильтруют по просрочке: на сколько
 * дней и на какую сумму.
 */
import { computed, ref } from 'vue'
import { formatCurrency } from '@/utils/formatters'

export interface DebtorsFilterState {
  overdueFrom: number | null
  overdueTo: number | null
  daysFrom: number | null
  daysTo: number | null
  remainingFrom: number | null
  remainingTo: number | null
  cities: string[]
  product: string
  clientKey: string
}

function emptyState(): DebtorsFilterState {
  return {
    overdueFrom: null,
    overdueTo: null,
    daysFrom: null,
    daysTo: null,
    remainingFrom: null,
    remainingTo: null,
    cities: [],
    product: '',
    clientKey: '',
  }
}

const NUMERIC_KEYS = [
  'overdueFrom', 'overdueTo', 'daysFrom', 'daysTo', 'remainingFrom', 'remainingTo',
] as const
const TEXT_KEYS = ['product', 'clientKey'] as const

export function useDebtorsFilters(options?: { labels?: () => { client?: string } }) {
  const state = ref<DebtorsFilterState>(emptyState())

  const query = computed<Record<string, string | number>>(() => {
    const s = state.value
    const out: Record<string, string | number> = {}
    for (const k of NUMERIC_KEYS) if (s[k] != null) out[k] = s[k] as number
    for (const k of TEXT_KEYS) if (String(s[k]).trim()) out[k] = String(s[k]).trim()
    if (s.cities.length) out.cities = s.cities.join(',')
    return out
  })

  const activeCount = computed(() => {
    const s = state.value
    let n = 0
    if (s.overdueFrom != null || s.overdueTo != null) n++
    if (s.daysFrom != null || s.daysTo != null) n++
    if (s.remainingFrom != null || s.remainingTo != null) n++
    if (s.cities.length) n++
    if (s.product.trim()) n++
    if (s.clientKey) n++
    return n
  })

  const hasAny = computed(() => activeCount.value > 0)

  const chips = computed(() => {
    const s = state.value
    const l = options?.labels?.() ?? {}
    const out: Array<{ key: string; label: string; clear: () => void }> = []

    const money = (from: number | null, to: number | null) =>
      from != null && to != null
        ? `${formatCurrency(from)} — ${formatCurrency(to)}`
        : from != null ? `от ${formatCurrency(from)}` : `до ${formatCurrency(to as number)}`

    if (s.overdueFrom != null || s.overdueTo != null) {
      out.push({
        key: 'overdue',
        label: `Просрочка: ${money(s.overdueFrom, s.overdueTo)}`,
        clear: () => { s.overdueFrom = null; s.overdueTo = null },
      })
    }
    if (s.daysFrom != null || s.daysTo != null) {
      const text = s.daysFrom != null && s.daysTo != null
        ? `${s.daysFrom} — ${s.daysTo} дн.`
        : s.daysFrom != null ? `от ${s.daysFrom} дн.` : `до ${s.daysTo} дн.`
      out.push({
        key: 'days',
        label: `Дней просрочки: ${text}`,
        clear: () => { s.daysFrom = null; s.daysTo = null },
      })
    }
    if (s.remainingFrom != null || s.remainingTo != null) {
      out.push({
        key: 'remaining',
        label: `Остаток: ${money(s.remainingFrom, s.remainingTo)}`,
        clear: () => { s.remainingFrom = null; s.remainingTo = null },
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
    return out
  })

  function reset() {
    state.value = emptyState()
  }

  function fromQuery(q: Record<string, unknown>) {
    const next = emptyState()
    const str = (v: unknown): string => {
      const x = Array.isArray(v) ? v[0] : v
      return typeof x === 'string' ? x : ''
    }
    for (const k of NUMERIC_KEYS) {
      const raw = str(q[k])
      const n = Number(raw)
      if (raw !== '' && Number.isFinite(n)) next[k] = n
    }
    for (const k of TEXT_KEYS) next[k] = str(q[k])
    const cities = str(q.cities)
    if (cities) next.cities = cities.split(',').filter(Boolean)
    state.value = next
  }

  function toQuery(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(query.value)) out[k] = String(v)
    return out
  }

  // ── Сохранённые наборы ──
  const PRESETS_KEY = 'debtors:filter-presets'
  const saved = ref<Array<{ id: string; name: string; query: Record<string, string> }>>(loadPresets())

  function loadPresets() {
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
    state, query, chips, activeCount, hasAny, reset, fromQuery, toQuery,
    saved, savePreset, applyPresetSaved, removePreset,
  }
}
