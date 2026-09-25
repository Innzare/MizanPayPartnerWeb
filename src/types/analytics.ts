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

/** Ключи корзин возраста — те же для просрочки и для оплат заранее. */
export type TimelinessBucketKey = 'd1_7' | 'd8_30' | 'd31_60' | 'd61_90' | 'd91_180' | 'd180p'

/** Одна корзина возраста: сколько платежей, на сколько денег, сколько сделок и людей. */
export interface TimelinessBucket {
  key: TimelinessBucketKey
  count: number
  amount: number
  deals: number
  clients: number
}

/**
 * Одна сторона своевременности — просрочка или оплаты заранее.
 * Сделки и клиенты уникальны: один человек с двумя долгами — это один клиент.
 */
export interface TimelinessSide {
  count: number
  amount: number
  deals: number
  clients: number
  avgDays: number
  maxDays: number
  buckets: TimelinessBucket[]
}

export interface AnalyticsTimeliness {
  overdue: TimelinessSide
  early: TimelinessSide
}

/** Один платёж за цифрой своевременности. */
export interface TimelinessDetailRow {
  paymentId: string
  dealId: string
  dealNumber: number
  paymentNumber: number
  productName: string
  clientName: string
  amount: number
  /** Дней просрочки — либо на сколько дней платёж опередил срок. */
  days: number
  dueDate: string
  paidAt: string | null
}

/**
 * Расшифровка: платежи страницами, итоги — по всей выборке, а не по странице.
 */
export interface TimelinessDetails {
  items: TimelinessDetailRow[]
  count: number
  total: number
  deals: number
  clients: number
  limit: number
  offset: number
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
/**
 * Строка разбора дохода — ОДИН ПЛАТЁЖ за выбранный период.
 *
 * Окно отвечает на вопрос «из каких поступлений сложилась сумма месяца»,
 * поэтому список идёт по платежам, а не по сделкам.
 */
export interface MonthPaymentRow {
  /** null у первоначального взноса: своей строки в графике у него нет. */
  paymentId: string | null
  paymentNumber: number
  dealId: string
  productName: string
  clientName: string
  /** Первоначальный взнос — «платёж №0» в день сделки. */
  isDown: boolean
  amount: number
  /** PAID / PENDING / OVERDUE. */
  status: string
  /** Дата, по которой платёж отнесён к периоду: оплата — по факту, план — по сроку. */
  date: string
  /** Доход с этого платежа — до вычета доли со-инвесторов. */
  gross: number
  /** Доля со-инвесторов: факт по оплаченному, прогноз по ожидаемому. */
  ci: number
  /** Ваш чистый доход с этого платежа. */
  net: number
}

export interface MonthDealsResponse {
  items: MonthPaymentRow[]
  totals: {
    dealsCount: number
    /** Строк платежей за период — то же число, что стоит у месяца в годовом обзоре. */
    paymentsCount: number
    paidReceived: number
    pendingReceived: number
    paidGross: number
    pendingGross: number
    ciPaid: number
    ciPending: number
  }
  /** Сколько сделок в каждом фильтре за период — для бейджиков вкладок. */
  filterCounts: { all: number; paid: number; pending: number }
  /** Всего строк в текущем фильтре — по нему считается пагинация. */
  count: number
  limit: number
  offset: number
}

/**
 * Продажи за месяц — сколько договоров оформлено и на какие суммы.
 * Месяц считается по дате сделки, а не по оплатам.
 */
export interface AnalyticsMonthlySalesRow {
  /** 'YYYY-MM' */
  month: string
  dealsCount: number
  /** Разные клиенты, оформившие договор в этом месяце. */
  clientsCount: number
  /** Сумма договоров целиком — вместе с наценкой. */
  totalPrice: number
  /** Первые взносы по этим договорам. */
  downPayment: number
  /** Сумма рассрочки — что клиенты выплатят по графику после взноса. */
  financed: number
  /** Закупка. null — нет права видеть закупочную цену и наценку. */
  purchasePrice: number | null
  /** Наценка. null — нет права видеть закупочную цену и наценку. */
  markup: number | null
}
