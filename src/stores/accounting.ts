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
  /** Банк заблокировал карту: деньги есть, но пользоваться ими нельзя. */
  bankBlockedAt?: string | null
  bankBlockedReason?: string | null
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

/**
 * Счёт в минусе — расходов по нему записано больше, чем пришло.
 *
 * Операции в минус разрешены, как и у кассы: запрет мешал записать то, что
 * уже случилось. Но такой счёт подсвечиваем везде, где он виден, чтобы минус
 * не прятался до сверки. Остаток скрыт правами — признака нет.
 */
export function isAccountNegative(a: Pick<AccountView, 'balance'> | null | undefined): boolean {
  return a?.balance != null && Math.round(a.balance) < 0
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
  /** Группа строки «откуда деньги»: инвесторы, вы, сделки… adjust — поправки учёта. */
  group?: 'investors' | 'partner' | 'deals' | 'ops' | 'temporary' | 'adjust' | 'other'
  /** Из чего сложилась строка. */
  detail?: AvailableStep[]
}

export interface AvailableMoney {
  inflow: AvailableStep[]
  /** Всего пришло, всего ушло и разница — сколько должно быть по учёту. */
  flow?: { in: number; out: number; journal: number }
  /** В кассе = на счетах + не разнесено. */
  reconciliation?: { cashInBox: number; accountsTotal: number; unallocated: number }
  cashInBox: number
  locked: AvailableStep[]
  available: number
  /** Сколько останется после расчёта с поставщиками — явной строкой, не вычетом. */
  afterSuppliers?: number
  /** Взгляд от счетов: на счетах − долг поставщикам − заблокировано банком. */
  accounts?: {
    total: number
    bankBlocked: number
    bankBlockedCount: number
    supplierDebt: number
    free: number
  }
  notes: {
    inProgress: number
    supplierDebt: number
    clientsOwe: number
    lentOut: number
    unallocated: number
    owedToCoInvestors?: number
    borrowed?: number
    pendingCapitalReturns?: number
  }
  /** На счетах записано больше, чем есть в кассе — цифра неточна. */
  warnings: Array<'accountsExceedCash'>
}

/** Деньги кассы и их раскладка по счетам: журнал = счета + не разнесено. */
export interface UnallocatedMoney {
  available: number
  allocated: number
  unallocated: number
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
  /** Название — чтобы легче ориентироваться. */
  title?: string | null
  status: 'PENDING' | 'RESOLVED'
  account: { id: string; name: string; code: string; color: string; bank?: AccountBank | null; cashBoxId?: string | null }
}

/** Обязательство: взяли в долг или дали в долг. */
export interface LiabilityView {
  id: string
  direction: 'BORROWED' | 'LENT'
  personName: string
  /** Название — чтобы легче ориентироваться. */
  title?: string | null
  principal: number
  repaid: number
  left: number
  dueDate: string | null
  note: string | null
  status: 'ACTIVE' | 'CLOSED'
  overdue: boolean
  /** Когда записали долг — дата строки, если он взят до выбранного периода. */
  createdAt?: string
  /** Касса долга: довыдачи и возвраты — только со счетов этой кассы. */
  cashBoxId?: string | null
  cashBoxName?: string | null
  /** Сколько раз выдавали по долгу: больше одного — «взяли ещё». */
  issueCount?: number
  /** Из погашенного — перенесено в основные (у «дали в долг»). */
  converted?: number
}

/** Выдача или возврат по долгу — строка истории в карточке. */
/** Чем стала перенесённая в основные часть долга «дали». */
export type LiabilityConvertKind = 'EXPENSE' | 'OTHER_EXPENSE' | 'WITHDRAW_PROFIT' | 'WITHDRAW_OWNER'

export interface LiabilityMovementView {
  id: string
  /** ISSUE — выдача, REPAY — возврат, CONVERT — перенесено в основные. */
  kind: 'ISSUE' | 'REPAY' | 'CONVERT'
  /** 1 — первая выдача, 2+ — «ещё»; у возвратов null. */
  issueNo: number | null
  amount: number
  date: string
  note: string | null
  account: { id: string; name: string; code: string; color: string; bank?: AccountBank | null } | null
  /** Кто записал — сотрудник; null — сам партнёр. */
  actorName: string | null
  /** Месяц кассы закрыт: править и удалять нельзя. */
  locked: boolean
  /** Перенос в основные: вид и операция, которой он стал. */
  convertKind?: LiabilityConvertKind | null
  transactionId?: string | null
  capitalEntryId?: string | null
}

/** Карточка долга: сам долг, его касса и вся история. */
export interface LiabilityCard {
  id: string
  direction: 'BORROWED' | 'LENT'
  personName: string
  title?: string | null
  note: string | null
  dueDate: string | null
  status: 'ACTIVE' | 'CLOSED'
  createdAt: string
  closedAt: string | null
  cashBox: { id: string; name: string } | null
  principal: number
  /** Погашено: возвраты деньгами + перенесённое в основные. */
  repaid: number
  /** Из погашенного — перенесено в основные. */
  converted?: number
  /** Вернули деньгами. */
  repaidCash?: number
  left: number
  overdue: boolean
  movements: LiabilityMovementView[]
}

/** Раздел «Пополнения и расходы»: все ручные движения денег. */
/** Смысловая группа операции раздела «Пополнения и расходы». */
export type FlowGroup = 'capital' | 'regular' | 'temporary' | 'pending' | 'transfer'

/** Операция «Пополнений и расходов», которой стала часть долга «дали». */
export interface ConvertedFrom { liabilityId: string; movementId: string; personName: string }

/** Что можно сделать с операцией из ленты раздела. */
export type FlowRef =
  | {
      type: 'transaction'; id: string; categoryId: string | null; cashBoxId: string | null
      /** Флаги операции (окно правки сохраняет их как есть). Нет — старый сервер. */
      affectsInvestors?: boolean; fromCapital?: boolean
      /** Вид расхода: «по бизнесу» или «иной». */
      expenseKind?: 'BUSINESS' | 'OTHER'
      /** Расход перенесён из временного снятия — правится и удаляется в карточке долга. */
      convertedFrom?: ConvertedFrom
    }
  | { type: 'capital'; id: string; cashBoxId: string; convertedFrom?: ConvertedFrom }
  | {
      type: 'pending'
      id: string
      /** Чем стала разобранная: сделка или долг — клик ведёт туда. */
      link?: { kind: 'deal'; dealId: string } | { kind: 'liability'; liabilityId: string }
      /** Разбор можно отменить (только «перевели по ошибке — вернули»). */
      undoable?: boolean
    }
  | { type: 'liability'; id: string; movementId?: string; movementKind?: 'ISSUE' | 'REPAY' | 'CONVERT' }
  | { type: 'transfer'; id: string }

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
      /** Капитал · основное (доход/расход) · временное · неразобранное. */
      group: FlowGroup
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
    title?: string | null
    accountName: string | null
    /** Счёт целиком — окна разбора и правки открываются прямо из ленты. */
    account: PendingOpView['account'] | null
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
    group: FlowGroup
    cashBoxName: string | null
    /** Долг не вернули или операцию не разнесли. */
    openItem: boolean
    /** Разобранная неразобранная: чем оказалась. В итог не входит. */
    resolvedAs: string | null
    /** Справочная строка (перенос в основные) — в итоги не входит. */
    neutral?: boolean
    /** Название временной операции (долга или денег без назначения). */
    name?: string | null
    ref: FlowRef
    /** Снятие, в котором были и прибыль, и капитал: две строки, одна операция. */
    split: { total: number; profit: number; capital: number } | null
  }>
}

/** Прибыль к снятию по одной кассе — для «Снять прибыль». */
export interface CashBoxProfit {
  cashBoxId: string
  name: string
  /** Заработано и ещё не снято — после расходов по бизнесу. */
  withdrawableProfit: number
  /** Деньги в кассе по журналу. */
  availableCapital: number
  /** «Доступно сейчас» — та же цифра, что на «Балансе». */
  available: number
  investedCapital: number
  /** Уже причитается со-инвесторам — снимать эти деньги не стоит. */
  pendingCIPayout: number
  /** Сколько можно забрать себе: доступно − прибыль инвесторов к выплате − займы. */
  availableForWithdraw?: number
  /** Меньшее из прибыли и того, что можно забрать себе. */
  canWithdrawNow: number
  /** Прибыли ещё нет в деньгах — она в товаре. */
  inGoods: number
  /** Деньги есть, но заняты (пункты приёма, долг инвесторам…). */
  lockedAmount: number
  /** Чем заняты — ключи шагов «Доступно сейчас» с «Баланса». */
  locked: Array<{ key: string; amount: number }>
  dealProfit: number
  businessExpenses: number
  withdrawnProfit: number
}

export interface ProfitSummary {
  cashBoxes: CashBoxProfit[]
  total: Omit<CashBoxProfit, 'cashBoxId' | 'name'>
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

  /** Банк заблокировал карту — или снял блокировку. */
  async function setBankBlocked(id: string, blocked: boolean, reason?: string) {
    await api.patch(`/accounting/accounts/${id}/bank-block`, { blocked, reason })
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
  const unallocated = ref<UnallocatedMoney | null>(null)

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
    return api.get<UnallocatedMoney>(
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

  // Деньги без назначения: список и итог приходят с лентой «Временных»
  // (fetchTemporary) — целиком, без отдельного запроса с пределом строк.

  async function createPending(payload: {
    direction: 'IN' | 'OUT'
    amount: number
    accountId: string
    note?: string
    personName?: string
    title?: string
    date?: string
  }) {
    const res = await api.post('/accounting/pending', payload)
    void fetchAccounts().catch(() => {})
    return res
  }

  /** Исправить неразобранную: прежнее движение по счёту гасится, пишется новое. */
  async function updatePending(
    id: string,
    payload: { amount?: number; date?: string; accountId?: string; note?: string | null; personName?: string | null; title?: string | null },
  ) {
    const res = await api.patch(`/accounting/pending/${id}`, payload)
    void fetchAccounts().catch(() => {})
    return res
  }

  /** Разделить неразобранную на две части — каждую разбирают отдельно. */
  async function splitPending(id: string, amount: number) {
    return api.post(`/accounting/pending/${id}/split`, { amount })
  }

  /** Отменить разбор «перевели по ошибке — вернули»: поступление снова ждёт разбора. */
  async function unresolvePending(id: string) {
    const res = await api.post(`/accounting/pending/${id}/unresolve`, {})
    void fetchAccounts().catch(() => {})
    return res
  }

  /** Удалить неразобранную — деньги на счёте откатываются встречной записью. */
  async function deletePending(id: string) {
    const res = await api.delete(`/accounting/pending/${id}`)
    void fetchAccounts().catch(() => {})
    return res
  }

  /**
   * Сказать, чем операция оказалась. Деньги при этом не двигаются второй раз.
   * Выдача: расход или «деньги вернули». Поступление: возврат нашего долга или
   * ошибочный перевод; оплата по сделке — через окно оплаты платежа.
   */
  async function resolvePending(
    id: string,
    target:
      | { type: 'EXPENSE'; categoryId?: string | null; note?: string }
      | { type: 'RETURNED'; note?: string }
      | { type: 'LENT_REPAY'; liabilityId: string; note?: string }
      | { type: 'MISTAKEN_RETURNED'; accountId: string; date?: string; note?: string },
  ) {
    const res = await api.post(`/accounting/pending/${id}/resolve`, target)
    void fetchAccounts().catch(() => {})
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

  /** «Доступно сейчас»: по всем кассам или по одной — та же цифра, что на её карточке. */
  async function fetchAvailable(cashBoxId?: string | null) {
    const box = cashBoxId ? `?cashBoxId=${encodeURIComponent(cashBoxId)}` : ''
    available.value = await api.get<AvailableMoney>(`/finance/available${box}`)
    return available.value
  }

  /** Итог и лента раздела «Пополнения и расходы» за период, по всем кассам или одной. */
  async function fetchTemporary(from: string, to: string, cashBoxId?: string | null) {
    const box = cashBoxId ? `&cashBoxId=${encodeURIComponent(cashBoxId)}` : ''
    return api.get<TemporarySummary>(
      `/accounting/temporary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${box}`,
    )
  }

  /** Прибыль к снятию по кассам (или по одной). */
  async function fetchProfit(cashBoxId?: string | null) {
    const box = cashBoxId ? `?cashBoxId=${encodeURIComponent(cashBoxId)}` : ''
    return api.get<ProfitSummary>(`/accounting/profit${box}`)
  }

  async function createLiability(payload: {
    direction: 'BORROWED' | 'LENT'
    personName: string
    amount: number
    accountId?: string | null
    cashBoxId?: string | null
    date?: string
    dueDate?: string
    note?: string
    title?: string
  }) {
    const res = await api.post('/accounting/liabilities', payload)
    await Promise.all([fetchAccounts(), fetchLiabilities()])
    return res
  }

  /** Карточка долга со всей историей выдач и возвратов. */
  async function fetchLiability(id: string) {
    return api.get<LiabilityCard>(`/accounting/liabilities/${id}`)
  }

  type MovementPayload = { amount: number; accountId?: string | null; date?: string; note?: string }

  /** «Взяли ещё» / «Дали ещё» по тому же долгу. */
  async function issueMoreLiability(id: string, payload: MovementPayload & { dueDate?: string | null }) {
    const res = await api.post(`/accounting/liabilities/${id}/issue`, payload)
    void fetchAccounts().catch(() => {})
    return res
  }

  /**
   * «Перенести в основные»: часть долга «дали» становится расходом или
   * снятием партнёра. Деньги на счетах не меняются — ушли ещё при выдаче.
   */
  async function convertLiability(
    id: string,
    payload: {
      amount: number
      kind: LiabilityConvertKind
      accountId?: string | null
      date?: string
      note?: string
      categoryId?: string | null
      affectsInvestors?: boolean
      fromCapital?: boolean
      effectiveFrom?: string | null
    },
  ) {
    const res = await api.post(`/accounting/liabilities/${id}/convert`, payload)
    void fetchAccounts().catch(() => {})
    return res
  }

  async function repayLiability(id: string, payload: MovementPayload) {
    const res = await api.post(`/accounting/liabilities/${id}/repay`, payload)
    void fetchAccounts().catch(() => {})
    return res
  }

  /** С кем, срок, заметка — денег не двигает. */
  async function updateLiability(id: string, payload: { personName?: string; dueDate?: string | null; note?: string | null; title?: string | null }) {
    return api.patch(`/accounting/liabilities/${id}`, payload)
  }

  /** Исправить выдачу или возврат: сумма, счёт, дата, заметка. */
  async function updateLiabilityMovement(
    id: string,
    movementId: string,
    payload: { amount?: number; accountId?: string | null; date?: string; note?: string | null },
  ) {
    const res = await api.patch(`/accounting/liabilities/${id}/movements/${movementId}`, payload)
    void fetchAccounts().catch(() => {})
    return res
  }

  async function deleteLiabilityMovement(id: string, movementId: string) {
    const res = await api.delete<{ deletedLiability: boolean }>(`/accounting/liabilities/${id}/movements/${movementId}`)
    void fetchAccounts().catch(() => {})
    return res
  }

  /** Долг целиком — со всеми выдачами и возвратами. */
  async function deleteLiability(id: string) {
    const res = await api.delete(`/accounting/liabilities/${id}`)
    void fetchAccounts().catch(() => {})
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

  /**
   * Разнести «не разнесено по счетам» на счета одной кассы. Отдельная
   * операция, а не пересчёт: пересчёт в «не разнесено» не входит, и раньше
   * счёт рос, а «не разнесено» оставалось прежним.
   */
  async function allocate(payload: { items: Array<{ accountId: string; amount: number }>; note?: string }) {
    const res = await api.post('/accounting/allocate', payload)
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
    kind: 'DEPOSIT' | 'WITHDRAW_OWNER' | 'WITHDRAW_PROFIT' | 'EXPENSE' | 'OTHER_EXPENSE' | 'INCOME' | 'TRANSFER'
    amount: number
    accountId?: string | null
    toAccountId?: string | null
    cashBoxId?: string | null
    categoryId?: string | null
    date?: string
    note?: string
    idemKey?: string
    /** Капитал партнёра: с какого дня действует в долях, ГГГГ-ММ-ДД (пусто — сразу). */
    effectiveFrom?: string | null
    /** Расход уменьшает прибыль месяца, которую делят с инвесторами. */
    affectsInvestors?: boolean
    /** Расход «из капитала» / доход «в капитал» — меняет капитал партнёра в делении. */
    fromCapital?: boolean
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
    liabilities, liabilityTotals, available, fetchAvailable,
    fetchAccounts, fetchBanks, fetchTags, suggestCode,
    createAccount, updateAccount, toggleAccount, setBankBlocked,
    removeAccount,
    createTag, removeTag, checkBalances, recomputeBalances, fetchUnallocated, fetchCashBoxFree,
    fetchHistory, fetchFeed, transfer, reconcile, fetchTransfers, fetchReconciliations, createOperation, fetchProfit,
    allocate,
    fetchLimits, createPending, updatePending, deletePending, resolvePending, splitPending, unresolvePending,
    fetchLiabilities, fetchTemporary, createLiability, repayLiability,
    fetchLiability, issueMoreLiability, convertLiability, updateLiability, updateLiabilityMovement, deleteLiabilityMovement, deleteLiability,
    fetchTurnover, fetchCashFlowReport, fetchAging,
    fetchAuditChecks, fetchCriticalActions,
  }
})
