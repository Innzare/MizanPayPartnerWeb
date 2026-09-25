import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

/**
 * Счета партнёра: где физически лежат деньги.
 *
 * Касса отвечает на вопрос «чьи деньги», счёт — «где они». Деньги одной кассы
 * могут лежать на нескольких счетах и наоборот, поэтому это отдельный список,
 * а не поле кассы.
 */

export type AccountType = 'CASH' | 'BANK_CARD' | 'PAYMENT_POINT'

export interface AccountBank {
  id: string
  name: string
  shortName: string
  color: string
}

export interface AccountLimits {
  perOpMax: number | null
  w1Days: number
  w1SumMax: number | null
  w1CountMax: number | null
  w2Days: number
  w2SumMax: number | null
  w2CountMax: number | null
  warnPct: number
}

export interface AccountView {
  id: string
  name: string
  type: AccountType
  code: string
  bank: AccountBank | null
  /** null — либо не заполнено, либо нет права видеть реквизиты. */
  transferPhone: string | null
  holderName: string | null
  color: string
  icon: string
  order: number
  responsibleStaffId: string | null
  isDefaultForCash: boolean
  isDefaultForBank: boolean
  /** null — у сотрудника нет права видеть суммы. */
  balance: number | null
  limits: AccountLimits
  disabledAt: string | null
  disabledReason: string | null
  disabledUntil: string | null
  pickup: {
    contactName: string | null
    contactPhone: string | null
    address: string | null
    threshold: number | null
    maxDays: number | null
  } | null
  tags: Array<{ id: string; name: string; color: string }>
  /** Чьи деньги лежат на счёте. Счёт всегда принадлежит одной кассе. */
  cashBoxId: string
}

/** Насколько выбран один лимит счёта. */
export interface LimitGauge {
  window: 1 | 2
  kind: 'sum' | 'count'
  days: number
  used: number
  limit: number
  left: number
  pct: number
  full: boolean
  warn: boolean
}

export interface AccountLimitView {
  id: string
  name: string
  code: string
  type: string
  color: string
  balance: number
  disabled: boolean
  limits: { gauges: LimitGauge[]; full: boolean; warn: boolean; worst: LimitGauge | null }
}

/** Шаг цепочки «доступные деньги»: сумма со знаком. */
export interface AvailableStep {
  key: string
  sign: '+' | '-' | '='
  amount: number
}

export interface AvailableMoney {
  inflow: AvailableStep[]
  cashInBox: number
  locked: AvailableStep[]
  available: number
  notes: {
    inProgress: number
    supplierDebt: number
    clientsOwe: number
    lentOut: number
    unallocated: number
  }
  /** На счетах записано больше, чем есть в кассе — цифра неточна. */
  warnings: Array<'accountsExceedCash'>
}

/** Пункт приёма, из которого пора забрать деньги. */
export interface PickupView {
  id: string
  name: string
  code: string
  contactName: string | null
  balance: number
  threshold: number | null
  maxDays: number | null
  daysSinceLastPickup: number | null
  due: boolean
  reason: 'amount' | 'days' | null
}

/** Временная операция: деньги двигались, назначение неизвестно. */
export interface PendingOpView {
  id: string
  direction: 'IN' | 'OUT'
  amount: number
  date: string
  note: string | null
  personName: string | null
  status: 'PENDING' | 'RESOLVED'
  account: { id: string; name: string; code: string; color: string; bank?: AccountBank | null }
}

/** Обязательство: взяли в долг или дали в долг. */
export interface LiabilityView {
  id: string
  direction: 'BORROWED' | 'LENT'
  personName: string
  principal: number
  repaid: number
  left: number
  dueDate: string | null
  note: string | null
  status: 'ACTIVE' | 'CLOSED'
  overdue: boolean
}

/** Раздел «Временные операции»: всё, что не обычная работа со счетами. */
export interface TemporarySummary {
  /** Незакрытое на сегодня — не зависит от выбранного периода. */
  open: {
    weOwe: number
    owedToUs: number
    weOweCount: number
    owedToUsCount: number
    overdueCount: number
    /** Операции, которым ещё не назначили место. */
    pendingCount: number
    pendingAmount: number
  }
  period: {
    groups: Array<{
      key: string
      title: string
      flow: 'in' | 'out'
      count: number
      amount: number
    }>
    inAmount: number
    outAmount: number
    /** На сколько операции раздела изменили деньги на счетах за период. */
    net: number
    count: number
  }
  people: LiabilityView[]
  pending: Array<{
    id: string
    direction: 'IN' | 'OUT'
    amount: number
    date: string
    note: string | null
    personName: string | null
    accountName: string | null
  }>
  history: Array<{
    id: string
    date: string
    kind: string
    title: string
    flow: 'in' | 'out'
    amount: number
    who: string
    note: string | null
    /** Долг не вернули или операцию не разнесли. */
    openItem: boolean
  }>
}

/** Строка ленты операций по счёту. */
export interface AccountEntryView {
  id: string
  kind: string
  amount: number
  date: string
  note: string | null
  paymentId: string | null
  dealId: string | null
  transferId: string | null
  reconciliationId: string | null
  deal: { id: string; dealNumber: number | string; productName: string } | null
  /** Счёт операции — приходит в общей ленте, где счета разные. */
  account?: {
    id: string
    name: string
    code: string
    color: string
    type: string
    bank?: AccountBank | null
  } | null
}

export interface TransferView {
  id: string
  amount: number
  date: string
  note: string | null
  fromAccount: { id: string; name: string; code: string }
  toAccount: { id: string; name: string; code: string }
}

export interface ReconciliationView {
  id: string
  expectedAmount: number
  actualAmount: number
  delta: number
  date: string
  note: string | null
  account: { id: string; name: string; code: string }
}

export interface PointRow {
  id: string
  name: string
  code: string
  color: string
  address: string | null
  contactName: string | null
  contactPhone: string | null
  disabled: boolean
  balance: number
  lastPickupAt: string | null
  daysSincePickup: number | null
  pickupDue: boolean
  pickupReason: 'amount' | 'days' | null
  inRunNumber: number | null
  income30d: number
  payments30d: number
  operators: string[]
}

export interface PointEntryRow {
  id: string
  kind: string
  amount: number
  date: string
  note: string | null
  paymentId: string | null
  dealId: string | null
  dealNumber: number | null
  productName: string | null
  clientId: string | null
  clientName: string | null
  acceptedBy: string | null
}

export interface PointPickupRow {
  id: string
  /** Рейс, в котором забирали: из карточки пункта в него можно перейти. */
  runId: string
  runNumber: number
  date: string
  status: string
  collectorName: string
  expectedAmount: number
  handedAmount: number | null
  receivedAmount: number | null
  receivedAt: string | null
  discrepancyNote: string | null
}

export interface PointDetail {
  account: {
    id: string
    name: string
    code: string
    color: string
    address: string | null
    contactName: string | null
    contactPhone: string | null
    balance: number
    disabled: boolean
    pickupThreshold: number | null
    pickupMaxDays: number | null
  }
  period: { from: string; to: string }
  totals: { income: number; incomeCount: number; outgo: number }
  entries: PointEntryRow[]
  pickups: PointPickupRow[]
}

export interface WhereMoney {
  total: number
  groups: Array<{
    key: string
    title: string
    total: number
    accounts: Array<{
      id: string
      name: string
      code: string
      type: string
      color: string
      bank?: AccountBank | null
      balance: number
      holder: string | null
      disabled: boolean
    }>
  }>
}

export type CollectionRunStatus = 'PLANNED' | 'IN_PROGRESS' | 'DELIVERED' | 'CANCELLED'
export type CollectionStopStatus = 'PENDING' | 'HANDED' | 'RECEIVED' | 'SKIPPED'

export interface CollectionRunListItem {
  id: string
  number: number
  date: string
  status: CollectionRunStatus
  collectorName: string
  stopsTotal: number
  stopsDone: number
  expectedTotal: number
  receivedTotal: number
  declaredAmount: number | null
  officeReceivedAmount: number | null
  deliveredAt: string | null
}

export interface CollectionStopView {
  id: string
  status: CollectionStopStatus
  order: number
  account: { id: string; name: string; code: string; address: string | null; balance: number }
  expectedAmount: number
  handedAmount: number | null
  handedAt: string | null
  receivedAmount: number | null
  receivedAt: string | null
  discrepancyNote: string | null
}

export interface CollectionRunDetail {
  id: string
  number: number
  date: string
  status: CollectionRunStatus
  note: string | null
  collector: { id: string; name: string }
  collectorAccount: { id: string; name: string; balance: number }
  officeAccount: { id: string; name: string } | null
  declaredAmount: number | null
  declaredAt: string | null
  officeReceivedAmount: number | null
  officeDiscrepancyNote: string | null
  deliveredAt: string | null
  stops: CollectionStopView[]
}

export const useAccountingStore = defineStore('accounting', () => {
  const accounts = ref<AccountView[]>([])
  const banks = ref<AccountBank[]>([])
  const tags = ref<Array<{ id: string; name: string; color: string }>>([])
  const loading = ref(false)
  /** Расхождения самопроверки: хранимый остаток против суммы движений. */
  const balanceIssues = ref<Array<{ accountId: string; name: string; diff: number }>>([])

  async function fetchAccounts() {
    loading.value = true
    try {
      accounts.value = await api.get<AccountView[]>('/accounting/accounts')
    } finally {
      loading.value = false
    }
  }

  async function fetchBanks() {
    if (banks.value.length) return
    banks.value = await api.get<AccountBank[]>('/accounting/banks')
  }

  async function fetchTags() {
    tags.value = await api.get<Array<{ id: string; name: string; color: string }>>('/accounting/tags')
  }

  /** Подсказка кода: «Сбербанк» → «Сб», вторая карта того же банка → «Сб1». */
  async function suggestCode(bankId?: string | null, type?: AccountType): Promise<string> {
    const qs = new URLSearchParams()
    if (bankId) qs.set('bankId', bankId)
    if (type) qs.set('type', type)
    const res = await api.get<{ code: string }>(`/accounting/accounts/suggest-code?${qs}`)
    return res.code
  }

  async function createAccount(payload: Record<string, unknown>) {
    const created = await api.post<AccountView>('/accounting/accounts', payload)
    await fetchAccounts()
    return created
  }

  async function updateAccount(id: string, payload: Record<string, unknown>) {
    const updated = await api.patch<AccountView>(`/accounting/accounts/${id}`, payload)
    await fetchAccounts()
    return updated
  }

  async function toggleAccount(id: string, enabled: boolean, reason?: string, until?: string) {
    await api.patch(`/accounting/accounts/${id}/toggle`, { enabled, reason, until })
    await fetchAccounts()
  }

  /** Пересобрать остатки из движений — лечение расхождения самопроверки. */
  async function recomputeBalances(accountId?: string) {
    const res = await api.post<{ fixed: any[] }>('/accounting/accounts/recompute', { accountId })
    await fetchAccounts()
    await checkBalances()
    return res.fixed ?? []
  }

  async function removeAccount(id: string) {
    await api.delete(`/accounting/accounts/${id}`)
    await fetchAccounts()
  }

  async function createTag(name: string, color?: string) {
    await api.post('/accounting/tags', { name, color })
    await fetchTags()
  }

  async function removeTag(id: string) {
    await api.delete(`/accounting/tags/${id}`)
    await fetchTags()
  }

  /**
   * Деньги, про которые ещё не сказано, где они лежат.
   *
   * Приходит из кассового расчёта, а не из счетов: сумма счетов и этой строки
   * обязана сходиться с тем, что партнёр видит в кассах.
   */
  const unallocated = ref<{ available: number; allocated: number; unallocated: number } | null>(null)

  async function fetchUnallocated() {
    unallocated.value = await api.get('/finance/capital/unallocated')
    return unallocated.value
  }

  /**
   * Сколько денег кассы ещё не разложено по её счетам.
   *
   * Нужно при заведении счёта: положить на него больше, чем есть в кассе,
   * нельзя — сумма счетов кассы обязана сходиться с её деньгами.
   */
  async function fetchCashBoxFree(cashBoxId: string) {
    return api.get<{ available: number; allocated: number; unallocated: number }>(
      `/finance/capital/unallocated?cashBoxId=${encodeURIComponent(cashBoxId)}`,
    )
  }

  // ── Операции по счёту ──

  /**
   * Лента операций счёта. Страницы курсорные: лента не «съезжает», когда
   * во время листания добавляется новая операция.
   */
  async function fetchHistory(accountId: string, cursor?: string | null) {
    const qs = new URLSearchParams()
    if (cursor) qs.set('cursor', cursor)
    return api.get<{ items: AccountEntryView[]; nextCursor: string | null }>(
      `/accounting/accounts/${accountId}/history?${qs}`,
    )
  }

  /**
   * Общая лента операций по всем счетам.
   *
   * Итоги приходят по всей выборке, а не по видимым строкам: «сколько пришло
   * за месяц» должно считаться по фильтру целиком.
   */
  async function fetchFeed(params: Record<string, string | undefined>, cursor?: string | null) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
    if (cursor) qs.set('cursor', cursor)
    return api.get<{
      items: AccountEntryView[]
      nextCursor: string | null
      totals: { income: number; expense: number; net: number; count: number }
    }>(`/accounting/history?${qs}`)
  }

  /**
   * Заполнение лимитов и напоминания забрать деньги из пунктов приёма.
   *
   * Отдельным запросом: обороты считаются по движениям и нужны не на каждом
   * экране, а держать их в общем списке счетов — лишняя работа на каждой
   * загрузке страницы.
   */
  const limits = ref<AccountLimitView[]>([])
  const pickups = ref<PickupView[]>([])

  async function fetchLimits() {
    const res = await api.get<{ accounts: AccountLimitView[]; pickups: PickupView[] }>(
      '/accounting/limits',
    )
    limits.value = res.accounts ?? []
    pickups.value = res.pickups ?? []
    return res
  }

  /**
   * Буфер неопределённости: что висит неразобранным.
   *
   * Сумму показываем на «Балансе» постоянно — пока буфер не пуст, часть денег
   * не отнесена ни к чему, и без напоминания разбор откладывается навсегда.
   */
  const pendingOps = ref<PendingOpView[]>([])
  const pendingTotals = ref<{ count: number; amount: number }>({ count: 0, amount: 0 })

  async function fetchPending() {
    const res = await api.get<{ items: PendingOpView[]; pending: { count: number; amount: number } }>(
      '/accounting/pending',
    )
    pendingOps.value = res.items ?? []
    pendingTotals.value = res.pending ?? { count: 0, amount: 0 }
    return res
  }

  async function createPending(payload: {
    direction: 'IN' | 'OUT'
    amount: number
    accountId: string
    note?: string
    personName?: string
  }) {
    const res = await api.post('/accounting/pending', payload)
    await Promise.all([fetchAccounts(), fetchPending()])
    return res
  }

  /** Сказать, чем операция оказалась. Деньги при этом не двигаются второй раз. */
  async function resolvePending(
    id: string,
    target: { type: 'EXPENSE' | 'INCOME' | 'RETURNED'; categoryId?: string | null; note?: string },
  ) {
    const res = await api.post(`/accounting/pending/${id}/resolve`, target)
    await Promise.all([fetchAccounts(), fetchPending()])
    return res
  }

  /**
   * Обязательства: сколько должны мы и сколько должны нам.
   *
   * Заёмные деньги лежат на счетах и работают, но бизнесу не принадлежат —
   * поэтому показываются отдельно от собственного капитала.
   */
  const liabilities = ref<LiabilityView[]>([])
  const liabilityTotals = ref({ weOwe: 0, owedToUs: 0, overdueCount: 0 })

  async function fetchLiabilities(status?: 'ACTIVE' | 'CLOSED') {
    const qs = status ? `?status=${status}` : ''
    const res = await api.get<{ items: LiabilityView[]; totals: typeof liabilityTotals.value }>(
      `/accounting/liabilities${qs}`,
    )
    liabilities.value = res.items ?? []
    liabilityTotals.value = res.totals ?? { weOwe: 0, owedToUs: 0, overdueCount: 0 }
    return res
  }

  /**
   * Доступные деньги: сколько можно потратить сейчас и почему остальное
   * нельзя. Цепочкой шагов — считает сервер, чтобы цифра была одна и та же
   * везде и не расходилась с кассой.
   */
  const available = ref<AvailableMoney | null>(null)

  async function fetchAvailable() {
    available.value = await api.get<AvailableMoney>('/finance/available')
    return available.value
  }

  /** Итог и история возвратных денег за период — раздел «Временные операции». */
  async function fetchTemporary(from: string, to: string) {
    return api.get<TemporarySummary>(
      `/accounting/temporary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    )
  }

  async function createLiability(payload: {
    direction: 'BORROWED' | 'LENT'
    personName: string
    amount: number
    accountId?: string | null
    dueDate?: string
    note?: string
  }) {
    const res = await api.post('/accounting/liabilities', payload)
    await Promise.all([fetchAccounts(), fetchLiabilities()])
    return res
  }

  async function repayLiability(id: string, payload: { amount: number; accountId?: string | null }) {
    const res = await api.post(`/accounting/liabilities/${id}/repay`, payload)
    await Promise.all([fetchAccounts(), fetchLiabilities()])
    return res
  }

  // ── Бухгалтерские отчёты ──

  /** Обороты по счетам за период — для сверки с выпиской банка. */
  async function fetchTurnover(from?: string, to?: string) {
    const qs = new URLSearchParams()
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    return api.get<{
      rows: Array<{
        id: string; name: string; code: string; type: string; color: string
        bank?: AccountBank | null
        opening: number; income: number; expense: number; closing: number; count: number
      }>
      totals: { opening: number; income: number; expense: number; closing: number; count: number } | null
      consistent: boolean
    }>(`/accounting/reports/turnover?${qs}`)
  }

  /** Движение денег: откуда пришли и куда ушли. */
  async function fetchCashFlowReport(from?: string, to?: string) {
    const qs = new URLSearchParams()
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    return api.get<{
      opening: number
      income: Array<{ kind: string; label: string; amount: number; count: number }>
      expense: Array<{ kind: string; label: string; amount: number; count: number }>
      incomeTotal: number
      expenseTotal: number
      closing: number
    }>(`/accounting/reports/cash-flow?${qs}`)
  }

  /** Старение долга: насколько просрочены платежи. */
  async function fetchAging() {
    return api.get<{
      buckets: Array<{ key: string; label: string; count: number; amount: number }>
      total: number
      count: number
    }>('/accounting/reports/aging')
  }

  // ── Аудит ──

  /** Автопроверки учёта: сходится ли всё и что именно нашлось. */
  async function fetchAuditChecks() {
    return api.get<{
      checks: Array<{
        key: string
        title: string
        hint: string
        ok: boolean
        count: number
        items: Array<Record<string, any>>
        severity: 'high' | 'medium' | 'low'
      }>
      problems: number
    }>('/accounting/audit/checks')
  }

  /** Операции, которые стоит замечать сразу. */
  async function fetchCriticalActions(limit = 50) {
    return api.get<Array<{
      id: string
      type: string
      title: string
      description: string | null
      actorName: string
      actorType: string
      entityType: string | null
      entityId: string | null
      createdAt: string
    }>>(`/accounting/audit/critical?limit=${limit}`)
  }

  /** Перевод между своими счетами. Капитал не меняется. */
  async function transfer(payload: {
    fromAccountId: string
    toAccountId: string
    amount: number
    date?: string
    note?: string
  }) {
    const res = await api.post('/accounting/transfers', payload)
    await fetchAccounts()
    return res
  }

  /** Пересчитали деньги — записываем факт и расхождение. */
  async function reconcile(payload: {
    accountId: string
    actualAmount: number
    date?: string
    note?: string
  }) {
    const res = await api.post('/accounting/reconciliations', payload)
    await fetchAccounts()
    return res
  }

  async function fetchTransfers(accountId?: string) {
    const qs = accountId ? `?accountId=${accountId}` : ''
    return api.get<TransferView[]>(`/accounting/transfers${qs}`)
  }

  async function fetchReconciliations(accountId?: string) {
    const qs = accountId ? `?accountId=${accountId}` : ''
    return api.get<ReconciliationView[]>(`/accounting/reconciliations${qs}`)
  }

  /**
   * Провести операцию: внесли, сняли на себя, потратили, получили, перевели.
   *
   * Одна дверь для всех видов — записи по-прежнему делают те же сервисы, что
   * работают на прежних экранах.
   */
  async function createOperation(payload: {
    kind: 'DEPOSIT' | 'WITHDRAW_OWNER' | 'EXPENSE' | 'INCOME' | 'TRANSFER'
    amount: number
    accountId?: string | null
    toAccountId?: string | null
    cashBoxId?: string | null
    categoryId?: string | null
    date?: string
    note?: string
  }) {
    const res = await api.post('/accounting/operations', payload)
    await fetchAccounts()
    return res
  }

  /** Сходятся ли остатки счетов с движениями по ним. */
  async function checkBalances() {
    const res = await api.get<{ ok: boolean; issues: any[] }>('/accounting/accounts/check')
    balanceIssues.value = res.issues ?? []
    return res.ok
  }

  // ── Пункты приёма глазами партнёра ──

  async function fetchPoints() {
    return api.get<{ points: PointRow[]; operators: Array<{ id: string; name: string }> }>(
      '/accounting/points',
    )
  }

  async function fetchPointDetail(id: string, from?: string, to?: string) {
    const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })
    const qs = q.toString()
    return api.get<PointDetail>(`/accounting/points/${id}${qs ? `?${qs}` : ''}`)
  }

  async function fetchWhereMoney() {
    return api.get<WhereMoney>('/accounting/points/where-money')
  }

  // ── Инкассация: рейсы по пунктам приёма ──

  const runs = ref<CollectionRunListItem[]>([])

  async function fetchRuns(status?: string) {
    runs.value = await api.get<CollectionRunListItem[]>(
      `/accounting/collections${status ? `?status=${status}` : ''}`,
    )
    return runs.value
  }

  async function fetchRun(id: string) {
    return api.get<CollectionRunDetail>(`/accounting/collections/${id}`)
  }

  async function createRun(payload: {
    collectorStaffId: string
    collectorAccountId: string
    accountIds: string[]
    date?: string
    note?: string
  }) {
    return api.post<CollectionRunDetail>('/accounting/collections', payload)
  }

  async function receiveStop(runId: string, stopId: string, payload: { amount: number; discrepancyNote?: string }) {
    return api.post(`/accounting/collections/${runId}/stops/${stopId}/receive`, payload)
  }

  async function skipStop(runId: string, stopId: string, note?: string) {
    return api.post(`/accounting/collections/${runId}/stops/${stopId}/skip`, { note })
  }

  async function declareRun(runId: string, amount: number) {
    return api.post(`/accounting/collections/${runId}/declare`, { amount })
  }

  async function deliverRun(
    runId: string,
    payload: { amount: number; officeAccountId: string; discrepancyNote?: string },
  ) {
    return api.post(`/accounting/collections/${runId}/deliver`, payload)
  }

  async function cancelRun(runId: string) {
    return api.post(`/accounting/collections/${runId}/cancel`, {})
  }

  return {
    fetchPoints,
    fetchPointDetail,
    fetchWhereMoney,
    runs,
    fetchRuns,
    fetchRun,
    createRun,
    receiveStop,
    skipStop,
    declareRun,
    deliverRun,
    cancelRun,

    accounts, banks, tags, loading, balanceIssues, unallocated, limits, pickups,
    pendingOps, pendingTotals, liabilities, liabilityTotals, available, fetchAvailable,
    fetchAccounts, fetchBanks, fetchTags, suggestCode,
    createAccount, updateAccount, toggleAccount,
    removeAccount,
    createTag, removeTag, checkBalances, recomputeBalances, fetchUnallocated, fetchCashBoxFree,
    fetchHistory, fetchFeed, transfer, reconcile, fetchTransfers, fetchReconciliations, createOperation,
    fetchLimits, fetchPending, createPending, resolvePending,
    fetchLiabilities, fetchTemporary, createLiability, repayLiability,
    fetchTurnover, fetchCashFlowReport, fetchAging,
    fetchAuditChecks, fetchCriticalActions,
  }
})
