/**
 * Фильтры раздела «Клиенты».
 *
 * Как в остальных списках: один набор кормит панель, плашки, адрес страницы и
 * запрос. Состав свой — здесь отбирают по состоянию договоров человека:
 * есть ли просрочка, остались ли действующие.
 */
import { computed, ref } from 'vue'

export interface ClientsFilterState {
  cities: string[]
  hasOverdue: boolean
  hasActive: boolean
  noActive: boolean
  withProfile: boolean
  product: string
}

function emptyState(): ClientsFilterState {
  return {
    cities: [],
    hasOverdue: false,
    hasActive: false,
    noActive: false,
    withProfile: false,
    product: '',
  }
}

const BOOL_KEYS = ['hasOverdue', 'hasActive', 'noActive', 'withProfile'] as const

const BOOL_LABELS: Record<string, string> = {
  hasOverdue: 'С просрочкой',
  hasActive: 'С действующими договорами',
  noActive: 'Без действующих договоров',
  withProfile: 'Только из реестра',
}

export function useClientsFilters() {
  const state = ref<ClientsFilterState>(emptyState())

  const query = computed<Record<string, string>>(() => {
    const s = state.value
    const out: Record<string, string> = {}
    if (s.cities.length) out.cities = s.cities.join(',')
    for (const k of BOOL_KEYS) if (s[k]) out[k] = '1'
    if (s.product.trim()) out.product = s.product.trim()
    return out
  })

  const activeCount = computed(() => {
    const s = state.value
    let n = 0
    if (s.cities.length) n++
    for (const k of BOOL_KEYS) if (s[k]) n++
    if (s.product.trim()) n++
    return n
  })

  const hasAny = computed(() => activeCount.value > 0)

  const chips = computed(() => {
    const s = state.value
    const out: Array<{ key: string; label: string; clear: () => void }> = []
    if (s.cities.length) {
      out.push({ key: 'cities', label: `Город: ${s.cities.join(', ')}`, clear: () => { s.cities = [] } })
    }
    for (const k of BOOL_KEYS) {
      if (s[k]) out.push({ key: k, label: BOOL_LABELS[k] ?? k, clear: () => { s[k] = false } })
    }
    if (s.product.trim()) {
      out.push({ key: 'product', label: `Товар: ${s.product.trim()}`, clear: () => { s.product = '' } })
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
    const cities = str(q.cities)
    if (cities) next.cities = cities.split(',').filter(Boolean)
    for (const k of BOOL_KEYS) next[k] = str(q[k]) === '1'
    next.product = str(q.product)
    state.value = next
  }

  function toQuery(): Record<string, string> {
    return { ...query.value }
  }

  // ── Сохранённые наборы ──
  const PRESETS_KEY = 'clients:filter-presets'
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
