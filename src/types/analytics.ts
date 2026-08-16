/**
 * Агрегаты главной страницы и «Обзора» аналитики — то, что раньше считалось в
 * браузере поверх всего портфеля сделок и всех платежей партнёра.
 */

/** Итоги по сделкам за период. Форма зеркалит PeriodTotals на сервере. */
export interface AnalyticsDealTotals {
  dealsCount: number
  /** Общая сумма сделок: сколько должны заплатить клиенты. */
  contractTotal: number
  /** Потрачено на закупку — живые деньги из кассы. */
  purchaseTotal: number
  /** Вся наценка по этим сделкам. */
  marginTotal: number
  /** Уже вернулось: взносы + оплаченные платежи. */
  returned: number
  /** Осталось получить с клиентов. */
  remaining: number
  /** Остаток только по активным сделкам — его показывает главная. */
  remainingActive?: number
  /** Доход с вернувшихся денег — ДО вычета доли со-инвесторов. */
  grossEarned: number
  /** Доход с ещё не полученной части — ДО вычета доли со-инвесторов. */
  grossLeft: number
  ciProfitFact: number
  ciProfitProjected: number
  /** Заработано сейчас — прибыль партнёра за вычетом доли со-инвесторов. */
  earnedNet: number
  profitLeft: number
  projectedNetTotal: number
  avgMarkupPct: number | null
}

/** Разрез денег: получено, ожидается, просрочено. Взносы включены. */
export interface AnalyticsPaymentTotals {
  paidCount: number
  paidSum: number
  pendingCount: number
  pendingSum: number
  overdueCount: number
  overdueSum: number
}

export interface AnalyticsSummary {
  deals: AnalyticsDealTotals
  payments: AnalyticsPaymentTotals
  clients: { total: number; withActiveDeals: number }
}

/** Строка помесячного разреза: факт, прогноз и доля со-инвесторов. */
export interface AnalyticsMonthlyRow {
  /** 'YYYY-MM'. */
  month: string
  /** Фактически пришло в этом месяце (по дате оплаты). */
  received: number
  paidCount: number
  /** Валовый доход с пришедших денег. */
  grossEarned: number
  /** Доля со-инвесторов, уже начисленная. */
  ciEarned: number
  /** Ожидается по плановому сроку. */
  pendingAmount: number
  pendingCount: number
  /** Валовый доход с ожидаемых денег. */
  expectedGross: number
  /** Прогноз доли со-инвесторов с ожидаемых денег. */
  ciExpected: number
  /** Платежей, оплаченных раньше своего месяца. */
  earlyOffMonth: number
  /** Платежей, оплаченных позже своего месяца. */
  lateOffMonth: number
}

/** Строка расшифровки показателя — сделка, стоящая за цифрой. */
export interface AnalyticsBreakdownDeal {
  id: string
  dealNumber: number
  productName: string
  status: string
  dealDate: string | null
  clientName: string
  cost: number
  totalPrice: number
  margin: number
  /** Чистый доход партнёра по этой сделке — прибыль с полученных денег
   *  за вычетом начисленного со-инвесторам. Считает сервер. */
  earnedNet: number
  remaining: number
  received: number
  downPayment: number
  numberOfPayments: number
  overdueAmount: number
  maxOverdueDays: number
}

/**
 * Ответ расшифровки. `count` и `total` считаются по ВСЕЙ выборке, а не по
 * странице: партнёр видит честную сумму, даже когда в списке только часть.
 */
export interface AnalyticsBreakdown {
  items: AnalyticsBreakdownDeal[]
  count: number
  total: number
  limit: number
  offset: number
}

/** Показатель, расшифровку которого запрашиваем. */
export type BreakdownMetric =
  | 'invested'
  | 'revenue'
  | 'profit'
  | 'remaining'
  | 'received'
  | 'earned'
  | 'roi'
  | 'monthly'
  | 'overdue'
/** Строка разбора дохода: одна сделка за выбранный период. */
export interface MonthDealRow {
  dealId: string
  productName: string
  clientName: string
  markupPercent: number
  status: string
  /** Пришло за период. */
  paidReceived: number
  /** Ожидается за период. */
  pendingReceived: number
  /** Доход с пришедшего — до вычета доли со-инвесторов. */
  paidGross: number
  /** Доход с ожидаемого — до вычета доли со-инвесторов. */
  pendingGross: number
  /** Доля со-инвесторов, уже начисленная. */
  ciPaid: number
  /** Прогноз доли со-инвесторов с ожидаемого. */
  ciPending: number
  paidCount: number
  pendingCount: number
}

export interface MonthDealsResponse {
  items: MonthDealRow[]
  totals: {
    dealsCount: number
    paidReceived: number
    pendingReceived: number
    paidGross: number
    pendingGross: number
    ciPaid: number
    ciPending: number
  }
  /** Показаны не все сделки периода — итоги при этом полные. */
  truncated: boolean
}
