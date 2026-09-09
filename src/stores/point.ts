import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

/**
 * Кабинет пункта приёма.
 *
 * Отдельный стор, а не часть бухгалтерии: оператор — внешний человек, и его
 * экраны не должны тянуть за собой партнёрские данные даже случайно.
 */

export interface PointAccount {
  id: string
  name: string
  code: string
  balance: number
  address?: string | null
  disabledAt?: string | null
}

export interface PointContext {
  staffName: string
  companyName: string
  undoMinutes: number
  /** Владелец разрешил этому оператору закрывать договор со скидкой. */
  canForgive: boolean
  points: PointAccount[]
}

export interface PointSearchResult {
  dealId: string
  dealNumber: number
  productName: string
  clientName: string
  phoneTail: string | null
  remainingAmount: number
  nextPayment: {
    paymentId: string
    number: number
    amount: number
    dueDate: string
    overdue: boolean
  } | null
}

export interface PointEntry {
  id: string
  kind: string
  amount: number
  date: string
  note: string | null
  paymentId: string | null
  dealId: string | null
  dealNumber?: number | null
  productName?: string | null
  canUndo?: boolean
  undoUntil?: string | null
}

export interface PointHandover {
  stopId: string
  status: 'PENDING' | 'HANDED'
  runNumber: number
  runDate: string
  collectorName: string
  expectedAmount: number
  handedAmount: number | null
  handedAt: string | null
}

export const usePointStore = defineStore('point', () => {
  const context = ref<PointContext | null>(null)
  const activePointId = ref<string | null>(localStorage.getItem('point:active'))
  const loading = ref(false)

  async function loadContext() {
    loading.value = true
    try {
      context.value = await api.get<PointContext>('/point/context')
      const ids = context.value.points.map((p) => p.id)
      // Выбранный пункт мог закрыться или перестать быть назначенным.
      if (!activePointId.value || !ids.includes(activePointId.value)) {
        setActivePoint(ids[0] ?? null)
      }
    } finally {
      loading.value = false
    }
  }

  function setActivePoint(id: string | null) {
    activePointId.value = id
    if (id) localStorage.setItem('point:active', id)
    else localStorage.removeItem('point:active')
  }

  async function search(q: string) {
    return api.get<PointSearchResult[]>(`/point/search?q=${encodeURIComponent(q)}`)
  }

  async function pay(payload: {
    paymentId: string
    accountId: string
    amount?: number
    forgiveRest?: boolean
  }) {
    const res = await api.post('/point/pay', payload)
    await loadContext() // остаток пункта изменился
    return res
  }

  async function undo(paymentId: string) {
    const res = await api.post(`/point/undo/${paymentId}`, {})
    await loadContext()
    return res
  }

  async function cash(accountId: string, cursor?: string) {
    const q = new URLSearchParams({ accountId, ...(cursor ? { cursor } : {}) })
    return api.get<{ account: PointAccount; items: PointEntry[]; nextCursor: string | null }>(
      `/point/cash?${q.toString()}`,
    )
  }

  async function history(accountId: string, cursor?: string) {
    const q = new URLSearchParams({ accountId, ...(cursor ? { cursor } : {}) })
    return api.get<{ items: PointEntry[]; nextCursor: string | null }>(`/point/history?${q.toString()}`)
  }

  /** Что просят передать инкассатору. null — рейса в пункт сейчас нет. */
  async function handover(accountId: string) {
    return api.get<PointHandover | null>(`/point/handover?accountId=${encodeURIComponent(accountId)}`)
  }

  async function hand(payload: { accountId: string; stopId: string; amount: number }) {
    return api.post('/point/handover', payload)
  }

  return {
    context,
    activePointId,
    loading,
    loadContext,
    setActivePoint,
    search,
    pay,
    undo,
    cash,
    history,
    handover,
    hand,
  }
})
