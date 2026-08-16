import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api/client'
import type { Deal, DealCounts, Page } from '@/types'

interface DealAnalytics {
  totalDeals: number
  activeDeals: number
  completedDeals: number
  revenue: number
  avgRating: number
}

/** Параметры страницы списка сделок — ровно то, что понимает сервер. */
export interface DealsPageParams {
  status?: 'ACTIVE' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED'
  folderId?: string | null
  cashBoxId?: string | null
  assignedStaffId?: string | null
  q?: string
  /** Ключ сортировки из DEALS_SORT_KEYS сервера; неизвестный → createdAt. */
  sort?: string
  dir?: 'asc' | 'desc'
  limit: number
  offset: number
}

/** Собирает query-строку, пропуская пустые параметры. */
function dealsQuery(p: Partial<DealsPageParams>): string {
  const qs = new URLSearchParams({ role: 'investor' })
  if (p.status) qs.set('status', p.status)
  if (p.folderId) qs.set('folderId', p.folderId)
  if (p.cashBoxId) qs.set('cashBoxId', p.cashBoxId)
  if (p.assignedStaffId) qs.set('assignedStaffId', p.assignedStaffId)
  if (p.q?.trim()) qs.set('q', p.q.trim())
  if (p.sort) qs.set('sort', p.sort)
  if (p.dir) qs.set('dir', p.dir)
  if (p.limit != null) qs.set('limit', String(p.limit))
  if (p.offset) qs.set('offset', String(p.offset))
  return qs.toString()
}

export const useDealsStore = defineStore('deals', () => {
  const deals = ref<Deal[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // ══════════════════════════════════════════════════════════════════
  // Постраничный список (страница «Сделки»)
  //
  // `deals` выше — НЕ портфель: это кэш точечно загруженных сделок (страница
  // сделки, лента событий). Полной загрузки портфеля в кабинете больше нет.
  // ══════════════════════════════════════════════════════════════════

  const list = ref<Deal[]>([])
  const listTotal = ref(0)
  const listLoading = ref(false)
  const counts = ref<DealCounts | null>(null)
  const countsLoading = ref(false)

  // Защита от гонок: быстрый набор в поиске порождает несколько запросов, и
  // ответ на устаревший может прийти последним, затерев свежий результат.
  let pageReq = 0
  let countsReq = 0

  async function fetchDealsPage(params: DealsPageParams) {
    const req = ++pageReq
    listLoading.value = true
    try {
      const res = await api.get<Page<Deal>>(`/deals?${dealsQuery(params)}`)
      if (req !== pageReq) return // пришёл ответ на отменённый запрос
      list.value = res.items
      listTotal.value = res.total
    } catch (e: any) {
      if (req !== pageReq) return
      error.value = e.message || 'Ошибка загрузки сделок'
      console.error('Failed to fetch deals page:', e)
    } finally {
      if (req === pageReq) listLoading.value = false
    }
  }

  async function fetchDealCounts(params: Omit<DealsPageParams, 'sort' | 'dir' | 'limit' | 'offset'>) {
    const req = ++countsReq
    countsLoading.value = true
    try {
      const res = await api.get<DealCounts>(`/deals/counts?${dealsQuery(params)}`)
      if (req !== countsReq) return
      counts.value = res
    } catch (e: any) {
      if (req !== countsReq) return
      console.error('Failed to fetch deal counts:', e)
    } finally {
      if (req === countsReq) countsLoading.value = false
    }
  }

  /**
   * Отразить изменённую сделку в текущей странице. Мутации ниже правят только
   * `deals`; без этого правка с карточки сделки не была бы видна в таблице до
   * перезагрузки страницы.
   */
  function patchInList(updated: Deal) {
    const i = list.value.findIndex((d) => d.id === updated.id)
    // Сохраняем поля, которых нет в ответе мутации: страница списка приходит
    // со slim-select сервера и несёт вычисленный scheduleEndAt.
    if (i >= 0) list.value[i] = { ...list.value[i], ...updated }
  }

  function getDeal(id: string): Deal | undefined {
    return deals.value.find((d) => d.id === id)
  }

  async function fetchDeal(id: string): Promise<Deal | null> {
    try {
      const deal = await api.get<Deal>(`/deals/${id}`)
      const index = deals.value.findIndex((d) => d.id === id)
      if (index >= 0) {
        deals.value[index] = deal
      } else {
        deals.value.push(deal)
      }
      patchInList(deal)
      return deal
    } catch (e: any) {
      // Тарифная блокировка — пробрасываем, чтобы страница сделки показала
      // экран «недоступно» (а не молча отрендерилась из кэша списка).
      if (e?.code === 'DEAL_LOCKED') throw e
      console.error('Failed to fetch deal:', e)
      return null
    }
  }

  async function updateDealStatus(
    id: string,
    status: Deal['status'],
    closeMode?: 'paid_early' | 'forgive' | 'force',
  ) {
    try {
      const updated = await api.patch<Deal>(`/deals/${id}/status`, {
        status,
        ...(closeMode ? { closeMode } : {}),
      })
      const index = deals.value.findIndex((d) => d.id === id)
      if (index >= 0) {
        deals.value[index] = updated
      }
      patchInList(updated)
    } catch (e: any) {
      console.error('Failed to update deal status:', e)
      throw e
    }
  }

  async function updateDeal(id: string, data: {
    productName?: string
    externalClientName?: string
    externalClientPhone?: string
    purchasePrice?: number
    totalPrice?: number
    markupPercent?: number
    downPayment?: number
    dealDate?: string
    firstPaymentDate?: string
    numberOfPayments?: number
    // Pass null to clear (backend accepts null explicitly via DTO).
    wholesalePrice?: number | null
    profitSplitBase?: 'MARKUP_ONLY' | 'FULL_MARGIN'
  }) {
    const updated = await api.patch<Deal>(`/deals/${id}`, data)
    const index = deals.value.findIndex((d) => d.id === id)
    if (index >= 0) deals.value[index] = updated
    patchInList(updated)
    return updated
  }

  async function fetchAnalytics(): Promise<DealAnalytics | null> {
    try {
      return await api.get<DealAnalytics>('/deals/analytics')
    } catch (e: any) {
      console.error('Failed to fetch analytics:', e)
      return null
    }
  }

  async function createDirectDeal(data: {
    clientId?: string
    externalClientName?: string
    externalClientPhone?: string
    clientProfileId?: string
    guarantorProfileId?: string
    // До 5 поручителей (порядок = приоритет, первый = основной). Legacy
    // guarantorProfileId по-прежнему принимается — не слать оба одновременно.
    guarantorProfileIds?: string[]
    productName: string
    productPhotos?: string[]
    contractPhotos?: string[]
    productUrl?: string
    purchasePrice: number
    markupPercent: number
    totalPrice?: number
    downPayment?: number
    numberOfPayments: number
    paymentInterval?: string
    paymentType?: string
    dealDate?: string
    firstPaymentDate?: string
    wholesalePrice?: number
    profitSplitBase?: 'MARKUP_ONLY' | 'FULL_MARGIN'
    cashBoxId?: string
    // Партнёр-поставщик товара + оплачен ли он (false → создаётся долг).
    supplierId?: string
    paidToSupplier?: boolean
    supplierRequestId?: string
    // Phase 4: explicit co-investor participation, applied atomically at
    // creation (so the down-payment accrual already respects it). Omit to
    // default to every CI of the deal's cashbox.
    participants?: Array<{ coInvestorId: string; profitPercentOverride?: number | null; managementFeePctOverride?: number | null; costFeeRatePct?: number | null }>
  }) {
    isLoading.value = true
    error.value = null
    try {
      const deal = await api.post<Deal>('/deals/direct', data)
      deals.value.unshift(deal)
      return deal
    } catch (e: any) {
      error.value = e.message || 'Не удалось создать сделку'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  // ==================== TRASH ====================

  // Строки ТЕКУЩЕЙ страницы корзины, а не всё её содержимое: после массового
  // удаления там могут лежать тысячи сделок.
  const trash = ref<Deal[]>([])
  const trashTotal = ref(0)
  const trashCount = ref(0)
  const trashLoading = ref(false)

  // Защита от гонки: быстрый набор в поиске порождает несколько запросов.
  let trashReq = 0
  let lastTrashParams: {
    q?: string; sort?: string; dir?: 'asc' | 'desc'; limit: number; offset: number
  } | null = null

  async function fetchTrash(params?: {
    q?: string; sort?: string; dir?: 'asc' | 'desc'; limit?: number; offset?: number
  }) {
    const p = {
      q: params?.q ?? '', sort: params?.sort, dir: params?.dir,
      limit: params?.limit ?? 50, offset: params?.offset ?? 0,
    }
    lastTrashParams = p
    const req = ++trashReq
    trashLoading.value = true
    try {
      const qs = new URLSearchParams()
      if (p.q.trim()) qs.set('q', p.q.trim())
      if (p.sort) qs.set('sort', p.sort)
      if (p.dir) qs.set('dir', p.dir)
      qs.set('limit', String(p.limit))
      if (p.offset) qs.set('offset', String(p.offset))
      const res = await api.get<Page<Deal>>(`/deals/trash/list?${qs}`)
      if (req !== trashReq) return
      trash.value = res.items
      trashTotal.value = res.total
      trashCount.value = res.total
    } catch (e: any) {
      console.error('Failed to fetch trash:', e)
    } finally {
      if (req === trashReq) trashLoading.value = false
    }
  }

  /** Только счётчик — для вкладки, без загрузки содержимого корзины. */
  async function fetchTrashCount() {
    try {
      const res = await api.get<{ count: number }>('/deals/trash/count')
      trashCount.value = res.count
    } catch {
      /* счётчик не критичен */
    }
  }

  /** Перезагрузить текущую страницу корзины (после восстановления/удаления). */
  function refreshTrash(): Promise<void> {
    return fetchTrash(lastTrashParams ?? undefined)
  }

  async function restoreDeal(id: string) {
    await api.patch(`/deals/trash/${id}/restore`)
    trash.value = trash.value.filter((d) => d.id !== id)
    trashTotal.value = Math.max(0, trashTotal.value - 1)
    trashCount.value = Math.max(0, trashCount.value - 1)
  }

  async function restoreBatch(ids: string[]) {
    await api.post('/deals/trash/restore-batch', { ids })
    trash.value = trash.value.filter((d) => !ids.includes(d.id))
    trashTotal.value = Math.max(0, trashTotal.value - ids.length)
    trashCount.value = Math.max(0, trashCount.value - ids.length)
  }

  async function permanentDelete(id: string) {
    await api.delete(`/deals/trash/${id}/permanent`)
    trash.value = trash.value.filter((d) => d.id !== id)
    trashTotal.value = Math.max(0, trashTotal.value - 1)
    trashCount.value = Math.max(0, trashCount.value - 1)
  }

  async function emptyTrash() {
    await api.delete('/deals/trash/empty')
    trash.value = []
    trashTotal.value = 0
    trashCount.value = 0
  }

  // Сменить клиента сделки. Отдельный эндпоинт: UpdateDealDto клиента не
  // принимает, и поле молча отсекалось валидацией — из формы редактирования
  // клиент не сохранялся вообще.
  async function updateClient(dealId: string, clientProfileId: string) {
    const updated = await api.patch<Deal>(`/deals/${dealId}/client`, { clientProfileId })
    const idx = deals.value.findIndex(d => d.id === dealId)
    if (idx !== -1) deals.value[idx] = updated
    patchInList(updated)
    return updated
  }

  // Заменить весь набор поручителей сделки (до 5). Порядок = приоритет,
  // первый = основной. Пустой массив очищает поручителей.
  async function updateGuarantors(dealId: string, guarantorProfileIds: string[]) {
    const updated = await api.patch<Deal>(`/deals/${dealId}/guarantor`, { guarantorProfileIds })
    const idx = deals.value.findIndex(d => d.id === dealId)
    if (idx !== -1) deals.value[idx] = updated
    patchInList(updated)
    return updated
  }

  return {
    deals, isLoading, error,
    getDeal, fetchDeal, updateDealStatus, updateDeal, fetchAnalytics, createDirectDeal,
    list, listTotal, listLoading, counts, countsLoading, fetchDealsPage, fetchDealCounts, patchInList,
    trash, trashTotal, trashCount, trashLoading,
    fetchTrash, fetchTrashCount, refreshTrash,
    restoreDeal, restoreBatch, permanentDelete, emptyTrash,
    updateGuarantors, updateClient,
  }
})