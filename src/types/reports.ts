/** Типы раздела «Отчёты» — зеркало ответов бэкенда (src/reports). */

export interface PeriodTotals {
  dealsCount: number
  /** Общая сумма сделок: закупка + наценка */
  contractTotal: number
  /** Потрачено на закупку товара */
  purchaseTotal: number
  /** Вся наценка по этим сделкам */
  marginTotal: number
  /** Уже вернулось: взносы + оплаченные платежи */
  returned: number
  /** Осталось получить с клиентов */
  remaining: number
  /** Весь доход с вернувшихся денег — ДО вычета доли со-инвесторов */
  grossEarned: number
  /** Весь доход с остатка — ДО вычета доли со-инвесторов */
  grossLeft: number
  /** Доля со-инвесторов, уже начисленная */
  ciProfitFact: number
  /** Доля со-инвесторов с остатка (прогноз) */
  ciProfitProjected: number
  /** Заработано сейчас */
  earnedNet: number
  /** Ожидается дохода */
  profitLeft: number
  /** Будет заработано всего */
  projectedNetTotal: number
  avgMarkupPct: number | null
}

export interface ReportsSummary {
  current: PeriodTotals
  previous: PeriodTotals
  previousRange: { from: string; to: string }
  /** Сколько сделок каждого статуса в периоде (без учёта статус-фильтра) */
  statusCounts: Record<string, number>
  allCount: number
}

export interface ReportsMonthlyRow {
  month: string // 'YYYY-MM'
  issuedCount: number
  issuedCost: number
  moneyIn: number
  grossProfit: number
  netProfit: number
}

export interface ReportDealRow {
  id: string
  dealNumber: number
  productName: string
  clientName: string
  dealDate: string
  status: string
  cashBoxId: string | null
  cashBoxName: string | null
  /** Закупка (реальный расход) */
  cost: number
  totalPrice: number
  margin: number
  /** Какая доля каждого платежа — прибыль, % */
  marginSharePct: number
  downPayment: number
  /** Пришло по сделке всего: взнос + оплаченные платежи */
  received: number
  remaining: number
  grossProfitReceived: number
  ciProfitFact: number
  /** Ваша прибыль с уже пришедших денег */
  netProfitReceived: number
  /** Сколько будет заработано ВСЕГО, когда сделка закроется полностью */
  projectedNetProfitTotal: number
  /** Сколько ещё осталось заработать по этой сделке */
  profitLeft: number
  paidCount: number
  totalCount: number
  overdueAmount: number
  overdueCount: number
  maxOverdueDays: number
  coInvestorNames: string[]
}

export interface ReportsDealsTable {
  rows: ReportDealRow[]
  /** Отсутствует при листании (`totals=0`) — итоги тогда не пересчитываются. */
  total?: number
  limit?: number
  offset?: number
  totals: {
    count: number
    cost: number
    totalPrice: number
    margin: number
    /** Первый взнос — колонка «Итого» на вебе его показывает. */
    downPayment: number
    received: number
    remaining: number
    grossProfit: number
    ciProfit: number
    netProfit: number
    projectedNetProfitTotal: number
    profitLeft: number
    overdueAmount: number
  }
}

/** Пресеты периода отчёта. */
export type PeriodPreset = 'month' | 'quarter' | 'half' | 'year' | 'all' | 'custom'

export interface PeriodRange {
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
  preset: PeriodPreset
  label: string
}

/** Блок «Где деньги сейчас» — снимок на текущий момент. */
export interface ReportsSnapshot {
  freeCash: number
  inGoods: number
  owedToCoInvestors: number
  reallyMine: number
  byCashBox: Array<{
    cashBoxId: string
    name: string
    color: string
    icon: string
    freeCash: number
    inGoods: number
    owedToCoInvestors: number
  }>
}

/** Блок «Эффективность». */
export interface ReportsEfficiency {
  avgDeployed: number
  deployedSeries: Array<{ month: string; deployed: number }>
  moneyIn: number
  principalReturned: number
  netProfit: number
  turnoverAnnualized: number | null
  returnOnDeployedPct: number | null
  moneyWeightedReturnDays: number | null
  avgDealLifetimeDays: number | null
  periodDays: number
}

/** Блок «Риски». */
export interface ReportsRisks {
  overdueAmount: number
  overduePaymentsCount: number
  overdueDealsCount: number
  avgOverdueDays: number | null
  maxOverdueDays: number
  problemDealsSharePct: number | null
  buckets: Array<{ label: string; amount: number; count: number }>
  topDebtors: Array<{ name: string; amount: number; maxDays: number; dealsCount: number }>
}
