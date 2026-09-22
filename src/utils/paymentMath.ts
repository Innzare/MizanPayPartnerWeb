/**
 * Денежные расчёты вокруг отметки платежа — единственная реализация на весь веб.
 *
 * Оплату принимает одно окно — `QuickPayDialog`, но зовут его из разных мест:
 * из списка сделок, из списка платежей, из превью и со страницы сделки.
 * Остаток по договору, отбор открытых строк, перерасчёт графика и тело запроса
 * обязаны совпадать до рубля везде, поэтому формулы живут здесь, а не внутри
 * компонента.
 *
 * Здесь только чистые функции: ни ref-ов, ни обращений к сторам.
 *
 * Авторитет во всех расчётах — сервер. Эти функции нужны, чтобы показать
 * партнёру, что произойдёт, ДО подтверждения.
 */
import { redistribute, validateManual, type RedistributeMode } from '@/utils/redistribute'
import { dueYearMonth, monthPrepositional, monthAccusative } from '@/utils/paymentAttribution'
import type { Deal, Payment } from '@/types'

/** Открытые строки графика — те, что участвуют в перерасчёте. */
const OPEN_STATUSES = ['PENDING', 'OVERDUE']
/** Закрытые строки — оплаченные и списанные досрочным закрытием. */
const SETTLED_STATUSES = ['PAID', 'CLOSED_EARLY']

/** Сколько всего должен клиент по договору: цена минус первоначальный взнос. */
export function contractBalance(deal: Pick<Deal, 'totalPrice' | 'downPayment'>): number {
  return deal.totalPrice - (deal.downPayment || 0)
}

/** Сумма уже закрытых строк, кроме указанной. */
export function sumSettled(schedule: Payment[], excludeId?: string): number {
  return schedule
    .filter((p) => p.id !== excludeId && SETTLED_STATUSES.includes(p.status))
    .reduce((s, p) => s + p.amount, 0)
}

/**
 * Строка — остаток недоплаты, оставленный долгом за конкретный месяц.
 *
 * В перерасчёт графика такие строки не входят: «Равномерно» не должно
 * превращать 2 000 ₽ долга в общую долю. Зеркало серверного правила.
 */
export function isShortfallRow(p: Pick<Payment, 'shortfallOfPaymentId'>): boolean {
  return !!p.shortfallOfPaymentId
}

/**
 * Какую строку графика оплачиваем по этой сделке.
 *
 * Клиент гасит договор, а не конкретный месяц: берём самую раннюю открытую
 * строку. При равном сроке первой идёт недоплата — она относится к уже
 * прошедшему месяцу, и закрывать её нужно раньше, чем платить вперёд.
 */
export function paymentToPay(schedule: Payment[]): Payment | null {
  const open = schedule.filter((p) => OPEN_STATUSES.includes(p.status))
  if (!open.length) return null
  return open.slice().sort((a, b) => {
    const byDate = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    if (byDate !== 0) return byDate
    const byDebt = Number(isShortfallRow(b)) - Number(isShortfallRow(a))
    if (byDebt !== 0) return byDebt
    return a.number - b.number
  })[0]!
}

/** Открытые строки кроме целевой, по возрастанию — участники распределения. */
export function openRows(
  schedule: Payment[],
  excludeId?: string,
): Array<{ id: string; number: number; amount: number }> {
  return schedule
    .filter((p) => p.id !== excludeId && OPEN_STATUSES.includes(p.status) && !isShortfallRow(p))
    .sort((a, b) => a.number - b.number)
    .map((p) => ({ id: p.id, number: p.number, amount: Math.round(p.amount) }))
}

/** Открытые долги-недоплаты по возрастанию номера, кроме указанной строки. */
export function openDebtRows(
  schedule: Payment[],
  excludeId?: string,
): Array<{ id: string; number: number; amount: number }> {
  return schedule
    .filter((p) => p.id !== excludeId && OPEN_STATUSES.includes(p.status) && isShortfallRow(p))
    .sort((a, b) => a.number - b.number)
    .map((p) => ({ id: p.id, number: p.number, amount: Math.round(p.amount) }))
}

/**
 * Куда уходит переплата, когда у клиента висят недоплаты за прошлые месяцы:
 * сначала закрываются самые ранние. Зеркало серверного правила — окно обязано
 * показывать ровно то, что произойдёт.
 */
export function coverDebtsWithOverpay(
  debts: Array<{ id: string; amount: number }>,
  overpay: number,
): { closedIds: string[]; reduced: Array<{ id: string; amount: number }>; covered: number } {
  let left = Math.max(Math.round(overpay), 0)
  const closedIds: string[] = []
  const reduced: Array<{ id: string; amount: number }> = []
  let covered = 0
  for (const debt of debts) {
    if (left <= 0) break
    const amount = Math.round(debt.amount)
    if (amount <= 0) continue
    const take = Math.min(amount, left)
    left -= take
    covered += take
    if (take === amount) closedIds.push(debt.id)
    else reduced.push({ id: debt.id, amount: amount - take })
  }
  return { closedIds, reduced, covered }
}

/**
 * Что станет с недоплатами после этой оплаты — зеркало сервера.
 *
 * Порядок тот же, что в `markPaid`: сначала переплатой закрываются недоплаты,
 * отмеченные партнёром; затем, если остатка по договору не хватает на
 * оставшиеся, они гасятся от самой ранней (так сервер закрывает долги при
 * досрочном погашении). `notCovered` — сумма, которая всё-таки останется
 * висеть: её и держат вне раскладки по будущим платежам.
 */
export function debtsAfterPayment(input: {
  /** Открытые недоплаты, кроме оплачиваемой строки, по порядку. */
  debts: Array<{ id: string; amount: number }>
  /** Отмеченные галочками — их закрывают деньгами этой оплаты. */
  picked: string[]
  /** Переплата сверх плановой суммы оплачиваемой строки. */
  overpay: number
  /** Остаток по договору после оплаты. */
  left: number
}): { closedIds: string[]; reduced: Array<{ id: string; amount: number }>; notCovered: number } {
  const byPick = coverDebtsWithOverpay(
    input.debts.filter((d) => input.picked.includes(d.id)),
    input.overpay,
  )
  const closedIds = [...byPick.closedIds]
  const reduced = [...byPick.reduced]

  // Оставшиеся недоплаты с учётом уже покрытых частей.
  const rest = input.debts
    .map((d) => {
      const cut = byPick.reduced.find((r) => r.id === d.id)
      return cut ? { id: d.id, amount: cut.amount } : { id: d.id, amount: Math.round(d.amount) }
    })
    .filter((d) => !byPick.closedIds.includes(d.id) && d.amount > 0)
  const restSum = rest.reduce((sum, d) => sum + d.amount, 0)
  const left = Math.max(Math.round(input.left), 0)

  // Денег хватило и на них — гасим от самой ранней, как делает сервер.
  if (left < restSum) {
    let toCover = restSum - left
    for (const debt of rest) {
      if (toCover <= 0) break
      const take = Math.min(debt.amount, toCover)
      toCover -= take
      if (take === debt.amount) {
        closedIds.push(debt.id)
      } else {
        const at = reduced.findIndex((r) => r.id === debt.id)
        const value = { id: debt.id, amount: debt.amount - take }
        if (at >= 0) reduced[at] = value
        else reduced.push(value)
      }
    }
    return { closedIds, reduced, notCovered: left }
  }

  return { closedIds, reduced, notCovered: restSum }
}

/** Сколько висит в открытых долгах-недоплатах, кроме указанной строки. */
export function openDebtSum(schedule: Payment[], excludeId?: string): number {
  return schedule
    .filter((p) => p.id !== excludeId && OPEN_STATUSES.includes(p.status) && isShortfallRow(p))
    .reduce((s, p) => s + Math.round(p.amount), 0)
}

/** Сколько открытых строк останется, долги включительно. */
function openCount(schedule: Payment[], excludeId?: string): number {
  return schedule.filter((p) => p.id !== excludeId && OPEN_STATUSES.includes(p.status)).length
}

/**
 * Остаток по договору после оплаты введённой суммы — то, что предстоит
 * разложить по оставшимся строкам.
 *
 * Зеркало `computeOutstanding` на сервере, включая вычет прощённого: иначе
 * превью показывало бы одни суммы, а сервер записал бы другие.
 */
export function outstandingAfter(
  deal: Pick<Deal, 'totalPrice' | 'downPayment'> & { discount?: number },
  schedule: Payment[],
  excludeId: string,
  entered: number,
): number {
  if (!entered) return 0
  const discount = Math.max(Math.round(deal.discount ?? 0), 0)
  return Math.max(
    Math.round(
      contractBalance(deal) - discount - sumSettled(schedule, excludeId) - Math.round(entered),
    ),
    0,
  )
}

/**
 * Сколько раскладывать по обычным строкам графика: остаток по договору минус
 * открытые долги — у них своя сумма. Зеркало `applyRedistribution` на сервере.
 */
export function redistTargetAfter(
  deal: Pick<Deal, 'totalPrice' | 'downPayment'> & { discount?: number },
  schedule: Payment[],
  excludeId: string,
  entered: number,
): number {
  return Math.max(outstandingAfter(deal, schedule, excludeId, entered) - openDebtSum(schedule, excludeId), 0)
}

export interface EarlyCloseInfo {
  willClose: boolean
  count: number
  excess: number
}

/**
 * Оплата этой суммой закроет сделку досрочно — партнёр должен увидеть это ДО
 * подтверждения, а не после.
 */
export function earlyCloseInfo(
  deal: (Pick<Deal, 'totalPrice' | 'downPayment'> & { discount?: number }) | null,
  schedule: Payment[],
  target: Payment | null,
  entered: number | null,
): EarlyCloseInfo {
  if (!target || !deal || !entered || entered <= 0) return { willClose: false, count: 0, excess: 0 }
  // Прощённое клиент уже не должен — иначе окно не признало бы закрытие сделки,
  // хотя сервер её закроет.
  const balance = contractBalance(deal) - Math.max(Math.round(deal.discount ?? 0), 0)
  const totalAfter = sumSettled(schedule, target.id) + entered
  // Досрочное закрытие гасит и долги-недоплаты — считаем их вместе с прочими.
  const otherUnpaid = openCount(schedule, target.id)
  return {
    willClose: totalAfter >= balance && otherUnpaid > 0,
    count: otherUnpaid,
    excess: Math.max(totalAfter - balance, 0),
  }
}

export interface TailPaymentInfo {
  applicable: boolean
  deficit: number
  suggestedDate: string
}

/**
 * Недоплата по ПОСЛЕДНЕЙ открытой строке: график кончается раньше долга.
 * Предлагаем дописать платёж на остаток, чтобы не лезть в «Добавить платёж».
 */
export function tailPaymentInfo(
  deal:
    | (Pick<Deal, 'totalPrice' | 'downPayment' | 'paymentInterval'> & { discount?: number })
    | null,
  schedule: Payment[],
  target: Payment | null,
  entered: number | null,
): TailPaymentInfo {
  const none = { applicable: false, deficit: 0, suggestedDate: '' }
  if (!target || !deal || !entered || entered <= 0) return none
  if (openRows(schedule, target.id).length > 0) return none

  // Прощённое в недостачу не входит: дописывать строку на него нельзя. Как и
  // открытые долги-недоплаты: у них уже есть свои строки.
  const deficit = Math.round(
    contractBalance(deal) -
      Math.max(Math.round(deal.discount ?? 0), 0) -
      sumSettled(schedule, target.id) -
      openDebtSum(schedule, target.id) -
      entered,
  )
  if (deficit <= 0) return none

  const anchor = new Date(target.dueDate)
  const interval = deal.paymentInterval || 'MONTHLY'
  if (interval === 'WEEKLY') anchor.setDate(anchor.getDate() + 7)
  else if (interval === 'BIWEEKLY') anchor.setDate(anchor.getDate() + 14)
  else anchor.setMonth(anchor.getMonth() + 1)
  return { applicable: true, deficit, suggestedDate: toDateInput(anchor) }
}

export interface RedistPreview {
  rows: Array<{ id: string; amount: number }>
  closedIds: string[]
  error: string
}

/** Живое превью перерасчёта — обёртка над зеркалом серверной функции. */
export function redistPreview(
  rows: Array<{ id: string; number: number; amount: number }>,
  target: number,
  mode: RedistributeMode,
  manualMap: Record<string, number> = {},
): RedistPreview {
  if (!rows.length) return { rows: [], closedIds: [], error: '' }
  try {
    if (mode === 'MANUAL') {
      const manual = rows.map((r) => ({ paymentId: r.id, amount: Math.round(manualMap[r.id] ?? 0) }))
      const v = validateManual(rows, target, manual)
      if (!v.ok) return { rows: [], closedIds: [], error: v.reason }
      const res = redistribute({ rows, target, mode, manual })
      return { rows: res.rows, closedIds: res.closedIds, error: '' }
    }
    const res = redistribute({ rows, target, mode })
    return { rows: res.rows, closedIds: res.closedIds, error: '' }
  } catch (e: any) {
    return { rows: [], closedIds: [], error: e?.message || 'Ошибка расчёта' }
  }
}

/** Равномерное превью — стартовые значения для режима «Вручную». */
export function equalSplitMap(
  rows: Array<{ id: string; number: number; amount: number }>,
  target: number,
): Record<string, number> {
  try {
    const eq = redistribute({ rows, target, mode: 'EQUAL' })
    const map: Record<string, number> = {}
    for (const r of eq.rows) map[r.id] = r.amount
    return map
  } catch {
    return {}
  }
}

export interface OffMonthInfo {
  kind: 'early' | 'late'
  paidLabel: string
  dueLabel: string
}

/** Выбранная дата оплаты в другом месяце, чем срок → доход учтётся по факту. */
export function offMonthInfo(target: Payment | null, paidAtYmd: string): OffMonthInfo | null {
  if (!target || !paidAtYmd) return null
  const due = dueYearMonth(target.dueDate)
  if (!due) return null
  const [y, m] = paidAtYmd.split('-').map(Number)
  if (!y || !m) return null
  const paidY = y
  const paidM = m - 1
  if (paidY === due.year && paidM === due.month) return null
  return {
    kind: paidY * 12 + paidM < due.year * 12 + due.month ? 'early' : 'late',
    // paidLabel идёт после «за» — винительный, dueLabel после «в» — предложный.
    paidLabel: monthAccusative(paidY, paidM, due.year),
    dueLabel: monthPrepositional(due.year, due.month, paidY),
  }
}

// `<input type="date">` ждёт YYYY-MM-DD в местном поясе, а из API приходит ISO
// со временем — отсюда тонкий конвертер.
export function toDateInput(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Полдень выбранной даты: сдвиг часового пояса не должен перенести
 * сохранённую отметку на соседний день.
 */
export function buildPaidAtISO(ymd: string): string | undefined {
  return ymd ? new Date(`${ymd}T12:00:00`).toISOString() : undefined
}

/**
 * Что делать с недостающей частью платежа:
 *   REDISTRIBUTE — разложить по следующим строкам графика;
 *   FORGIVE      — простить (только досрочное погашение);
 *   DEBT         — оставить долгом за этот же месяц.
 */
export type ShortfallAction = 'REDISTRIBUTE' | 'FORGIVE' | 'DEBT'

export interface MarkPaidPayload {
  amount?: number
  proofScreenshot?: string
  /** Комментарий партнёра к платежу. */
  note?: string
  paidAt?: string
  redistributeMode?: RedistributeMode
  remainingSchedule?: Array<{ paymentId: string; amount: number }>
  payMode?: 'MONTH' | 'EARLY'
  shortfallAction?: ShortfallAction
  /** Долг: когда клиент обещал доплатить (YYYY-MM-DD). */
  shortfallPromisedDate?: string
  /** Долг: комментарий. */
  shortfallNote?: string
  /** Переплатой сначала закрыть недоплаты прошлых месяцев. */
  coverDebts?: boolean
  /** На какой счёт легли деньги. Пусто — сервер определит сам. */
  accountId?: string
  /** Смешанная оплата: сумма долей обязана совпасть с суммой платежа. */
  allocations?: Array<{ accountId: string; amount: number }>
}

/**
 * Тело запроса на отметку оплаты — самое опасное место для расхождения окон.
 *
 * Правила: сумма шлётся только если отличается от плановой; режим перерасчёта —
 * только когда он реально применяется; «Вручную» — полным списком сумм.
 * При прощении остатка перерасчёт не запускается вовсе.
 */
export function buildMarkPaidPayload(input: {
  target: Payment
  entered: number | null
  paidAtYmd: string
  proofScreenshot?: string
  /** Комментарий к платежу — пустой не отправляем. */
  note?: string
  mode: RedistributeMode
  manualMap?: Record<string, number>
  /** Открытые строки кроме целевой — те же, что показаны в превью. */
  rows: Array<{ id: string; number: number; amount: number }>
  /** Блок перерасчёта показан партнёру (сумма ≠ плановой и есть что делить). */
  applyRedistribute: boolean
  payMode?: 'MONTH' | 'EARLY'
  shortfallAction?: ShortfallAction
  /** Долг: дата обещания (YYYY-MM-DD), пусто — дату не назвали. */
  shortfallPromisedDate?: string
  /** Долг: комментарий. */
  shortfallNote?: string
  /** Переплатой сначала закрыть недоплаты прошлых месяцев. */
  coverDebts?: boolean
}): MarkPaidPayload {
  const { target, entered, mode, manualMap = {}, rows } = input
  const forgiving = input.shortfallAction === 'FORGIVE'
  const debt = input.shortfallAction === 'DEBT'
  // И прощение, и долг ничего не раскладывают по графику.
  const applyRedist = input.applyRedistribute && rows.length > 0 && !forgiving && !debt
  const note = input.shortfallNote?.trim()

  return {
    amount: entered && entered !== target.amount ? entered : undefined,
    proofScreenshot: input.proofScreenshot,
    note: input.note?.trim() || undefined,
    paidAt: buildPaidAtISO(input.paidAtYmd),
    redistributeMode: applyRedist ? mode : undefined,
    remainingSchedule:
      applyRedist && mode === 'MANUAL'
        ? rows.map((r) => ({ paymentId: r.id, amount: Math.round(manualMap[r.id] ?? 0) }))
        : undefined,
    payMode: input.payMode,
    shortfallAction: input.shortfallAction,
    shortfallPromisedDate: debt && input.shortfallPromisedDate ? input.shortfallPromisedDate : undefined,
    shortfallNote: debt && note ? note : undefined,
    coverDebts: input.coverDebts ? true : undefined,
  }
}

// ── Прощение остатка (только режим «Досрочно») ──────────────────────────────

export interface ForgiveInfo {
  /** Остаток по договору за вычетом уже прощённого — сколько реально должны. */
  outstandingNet: number
  /** Сколько будет прощено при введённой сумме. */
  forgiven: number
  /** Потолок прощения: заработок партнёра минус уже прощённое. */
  maxForgivable: number
  /** Прощение упирается в потолок — партнёр не может простить столько. */
  exceedsIncome: boolean
  /** Минимальная сумма к оплате, при которой прощение ещё допустимо. */
  minAllowedAmount: number
}

/**
 * Заработок партнёра по сделке — то единственное, что можно простить.
 *
 * Зеркало серверной `profitBaseFor`, но БЕЗ вычета уже прощённого: нужен
 * полный заработок, из которого потолок считается отдельно.
 */
export function grossProfitBase(
  deal: Pick<Deal, 'markup' | 'totalPrice' | 'wholesalePrice' | 'profitSplitBase'>,
): number {
  if (deal.profitSplitBase === 'FULL_MARGIN' && deal.wholesalePrice && deal.wholesalePrice > 0) {
    return Math.max(0, Math.round(deal.totalPrice - deal.wholesalePrice))
  }
  return Math.round(deal.markup)
}

/**
 * Сколько будет прощено при досрочном погашении введённой суммой.
 *
 * Железное правило владельца: прощается только заработок партнёра, закупка
 * возвращается всегда. Поэтому потолок — заработок минус уже прощённое.
 *
 * Считается НЕТТО: если по сделке уже есть скидка (например, пришла с
 * импортом), она из остатка вычитается — иначе прощённый долг вернулся бы в
 * расчёт и партнёр простил бы его второй раз.
 */
export function forgiveInfo(
  deal: (Pick<Deal, 'totalPrice' | 'downPayment' | 'markup' | 'wholesalePrice' | 'profitSplitBase'> & { discount?: number }) | null,
  schedule: Payment[],
  target: Payment | null,
  entered: number | null,
): ForgiveInfo {
  const none = { outstandingNet: 0, forgiven: 0, maxForgivable: 0, exceedsIncome: false, minAllowedAmount: 0 }
  if (!deal || !target) return none

  const discount = Math.max(Math.round(deal.discount ?? 0), 0)
  // Остаток до внесения денег — та же формула, что у сервера при entered = 0.
  const outstandingNet = Math.max(
    Math.round(contractBalance(deal) - discount - sumSettled(schedule, target.id)),
    0,
  )
  const forgiven = Math.max(Math.round(outstandingNet - Math.round(entered ?? 0)), 0)
  const maxForgivable = Math.max(grossProfitBase(deal) - discount, 0)

  return {
    outstandingNet,
    forgiven,
    maxForgivable,
    exceedsIncome: forgiven > maxForgivable,
    minAllowedAmount: Math.max(outstandingNet - maxForgivable, 0),
  }
}
