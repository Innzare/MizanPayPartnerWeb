/**
 * Расчёты программы рассрочки — зеркало серверных.
 *
 * Форма должна считать мгновенно, пока человек печатает, поэтому те же формулы
 * живут и здесь. Истина при этом всегда серверная: перед сохранением сделка
 * сверяется с программой на бэкенде, и расхождение будет отклонено, а не
 * молча принято.
 */

export type MarkupBase = 'OF_COST' | 'OF_TOTAL'
export type ProgramRounding = 'NONE' | 'TO_50' | 'TO_100' | 'TO_500' | 'TO_1000'
export type ProgramDownMode = 'STEPS' | 'CURVE'
export type ProgramRoundingTarget = 'LAST_PAYMENT' | 'TOTAL'

export interface ProgramRule {
  id?: string
  amountFrom: number | null
  amountTo: number | null
  termPayments: number
  markupPercent: number
  minDownPaymentPercent: number
  /** Ступень по доле первоначального взноса в цене договора, проценты. */
  downFromPercent?: number | null
  downToPercent?: number | null
}

export const ROUNDING_STEP: Record<ProgramRounding, number> = {
  NONE: 0,
  TO_50: 50,
  TO_100: 100,
  TO_500: 500,
  TO_1000: 1000,
}

/** Итоговая цена договора. База наценки берётся из программы, не угадывается. */
export function totalFor(purchasePrice: number, markupPercent: number, base: MarkupBase): number {
  if (!(purchasePrice > 0)) return 0
  if (base === 'OF_TOTAL') {
    if (markupPercent >= 100) return 0
    return Math.round(purchasePrice / (1 - markupPercent / 100))
  }
  return Math.round(purchasePrice * (1 + markupPercent / 100))
}

export function minDownPaymentFor(total: number, percent: number): number {
  if (!(percent > 0)) return 0
  return Math.round((total * percent) / 100)
}

/** Опорная точка кривой: при таком взносе — такая наценка. */
export interface CurvePoint {
  at: number
  markupPercent: number
}

/**
 * Наценка на кривой — зеркало серверной формулы.
 * Между точками линейно, за крайними плоско: скачков на границах нет.
 */
export function interpolateMarkup(points: CurvePoint[], downPercent: number): number {
  if (!points.length) return 0
  const sorted = [...points].sort((a, b) => a.at - b.at)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  if (downPercent <= first.at) return first.markupPercent
  if (downPercent >= last.at) return last.markupPercent

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const next = sorted[i]!
    if (downPercent <= next.at) {
      const span = next.at - prev.at
      if (span <= 0) return next.markupPercent
      const t = (downPercent - prev.at) / span
      return prev.markupPercent + (next.markupPercent - prev.markupPercent) * t
    }
  }
  return last.markupPercent
}

/** Цена с оглядкой на минимальную наценку в рублях. */
export function totalWithMinMarkup(
  purchasePrice: number,
  total: number,
  minMarkupAmount?: number | null,
): number {
  if (!minMarkupAmount || minMarkupAmount <= 0) return total
  if (!(purchasePrice > 0)) return total
  const floor = Math.round(purchasePrice + minMarkupAmount)
  return total < floor ? floor : total
}

/** Цена договора, подогнанная под равные платежи (режим округления «в цену»). */
export function totalForEqualPayments(
  total: number,
  downPayment: number,
  numberOfPayments: number,
  rounding: ProgramRounding,
): number {
  const step = ROUNDING_STEP[rounding] ?? 0
  if (!step || numberOfPayments <= 0) return total
  const debt = total - downPayment
  if (debt <= 0) return total
  const regular = Math.max(step, Math.round(debt / numberOfPayments / step) * step)
  return Math.round(downPayment + regular * numberOfPayments)
}

/** Нижняя граница включительно, верхняя — нет: границу забирает верхняя полоса. */
export function ruleCoversAmount(rule: ProgramRule, purchasePrice: number): boolean {
  const from = rule.amountFrom ?? 0
  if (purchasePrice < from) return false
  if (rule.amountTo != null && purchasePrice >= rule.amountTo) return false
  return true
}

/**
 * Накрывает ли правило такую долю взноса. Границы как у стоимости: нижняя
 * включительно, верхняя — нет. Допуск в сотую процента — из-за округления цены
 * до рубля: взнос ровно в 30% после округления бывает 29.9997%.
 */
export function ruleCoversDown(rule: ProgramRule, downPercent: number): boolean {
  const from = rule.downFromPercent
  const to = rule.downToPercent
  if (from == null && to == null) return true
  const EPS = 0.01
  if (from != null && downPercent < from - EPS) return false
  if (to != null && downPercent >= to - EPS) return false
  return true
}

/** Есть ли в наборе хоть одно условие со ступенью по взносу. */
export function hasDownSteps(rules: ProgramRule[]): boolean {
  return rules.some((r) => r.downFromPercent != null || r.downToPercent != null)
}

export function matchRule(
  rules: ProgramRule[],
  purchasePrice: number,
  termPayments: number,
  downPercent = 0,
): ProgramRule | null {
  return (
    rules.find(
      (r) =>
        r.termPayments === termPayments &&
        ruleCoversAmount(r, purchasePrice) &&
        ruleCoversDown(r, downPercent),
    ) ?? null
  )
}

/**
 * Условия для сделки с известной суммой взноса — зеркало серверного подбора.
 *
 * Доля взноса считается от цены договора, а цена зависит от наценки искомой
 * ступени. Круг разрывается перебором: подходит ступень, в которую взнос
 * попадает по её собственной цене. Несколько согласованных — берём с большей
 * нижней границей (в пользу клиента); ни одной — считаем долю от базовой цены.
 */
export function pickRuleForDown(
  rules: ProgramRule[],
  purchasePrice: number,
  termPayments: number,
  downPayment: number,
  markupBase: MarkupBase,
): ProgramRule | null {
  const candidates = rules.filter(
    (r) => r.termPayments === termPayments && ruleCoversAmount(r, purchasePrice),
  )
  if (!candidates.length) return null
  if (!hasDownSteps(candidates)) return candidates[0]!

  const consistent = candidates.filter((rule) => {
    const total = totalFor(purchasePrice, rule.markupPercent, markupBase)
    const percent = total > 0 ? (downPayment / total) * 100 : 0
    return ruleCoversDown(rule, percent)
  })
  if (consistent.length) {
    return consistent.reduce((best, r) =>
      (r.downFromPercent ?? 0) > (best.downFromPercent ?? 0) ? r : best,
    )
  }

  const base = candidates.reduce((low, r) =>
    (r.downFromPercent ?? 0) < (low.downFromPercent ?? 0) ? r : low,
  )
  const baseTotal = totalFor(purchasePrice, base.markupPercent, markupBase)
  const basePercent = baseTotal > 0 ? (downPayment / baseTotal) * 100 : 0
  return candidates.find((r) => ruleCoversDown(r, basePercent)) ?? base
}

export function availableTerms(rules: ProgramRule[], purchasePrice: number): number[] {
  const terms = rules.filter((r) => ruleCoversAmount(r, purchasePrice)).map((r) => r.termPayments)
  return [...new Set(terms)].sort((a, b) => a - b)
}

/**
 * Наценка по КРИВОЙ зависимости от взноса — зеркало серверного расчёта.
 *
 * Условия срока здесь не полосы, а опорные точки; между ними наценка считается
 * плавно. Доля взноса зависит от цены, цена — от наценки, поэтому значение
 * уточняется итерацией, пока не перестанет меняться.
 */
export function curveMarkupForDown(
  rules: ProgramRule[],
  purchasePrice: number,
  termPayments: number,
  downPayment: number,
  markupBase: MarkupBase,
): { rule: ProgramRule; markupPercent: number } | null {
  const candidates = rules.filter(
    (r) => r.termPayments === termPayments && ruleCoversAmount(r, purchasePrice),
  )
  if (!candidates.length) return null

  const points = candidates.map((r) => ({
    at: r.downFromPercent ?? 0,
    markupPercent: r.markupPercent,
  }))

  let percent = points[0]!.markupPercent
  let share = 0
  for (let i = 0; i < 12; i++) {
    const total = totalFor(purchasePrice, percent, markupBase)
    share = total > 0 ? (downPayment / total) * 100 : 0
    const next = interpolateMarkup(points, share)
    const settled = Math.abs(next - percent) < 0.001
    percent = next
    if (settled) break
  }

  // Опорная строка — ближайшая точка снизу: её процент партнёр видит в тарифе.
  const sorted = [...candidates].sort(
    (a, b) => (a.downFromPercent ?? 0) - (b.downFromPercent ?? 0),
  )
  const rule = [...sorted].reverse().find((r) => (r.downFromPercent ?? 0) <= share) ?? sorted[0]!
  return { rule, markupPercent: percent }
}

/** Как разложится долг: регулярный платёж и последний, забирающий остаток. */
export function scheduleShape(
  amountToPay: number,
  numberOfPayments: number,
  rounding: ProgramRounding = 'NONE',
): { regular: number; last: number } {
  if (numberOfPayments <= 0) return { regular: 0, last: 0 };
  if (numberOfPayments === 1) return { regular: 0, last: Math.round(amountToPay) };

  const plain = Math.floor(amountToPay / numberOfPayments);
  const step = ROUNDING_STEP[rounding] ?? 0;
  const plainShape = {
    regular: plain,
    last: Math.round(amountToPay - plain * (numberOfPayments - 1)),
  };
  if (!step) return plainShape;

  /**
   * Из двух кратных шагу значений берём то, после которого последний платёж
   * ближе к остальным.
   *
   * Округлять просто «к ближайшему» мало: расхождение копится по всем
   * платежам, и на длинном сроке хвост разъезжается. Долг 121 500 ₽ на 12
   * платежей с шагом 1000 ₽ давал 10 000 ₽ ежемесячно и 11 500 ₽ последним —
   * клиент видит в конце другую сумму и считает это ошибкой. Выбор ближнего
   * кандидата такие хвосты укорачивает, а сумма графика остаётся ровно равной
   * долгу: расхождение по-прежнему целиком уходит в последний платёж.
   */
  const lower = Math.floor(plain / step) * step;
  const candidates = [lower, lower + step];
  let best: { regular: number; last: number } | null = null;
  let bestGap = Infinity;
  for (const regular of candidates) {
    if (regular <= 0) continue;
    const last = Math.round(amountToPay - regular * (numberOfPayments - 1));
    if (last <= 0) continue;
    const gap = Math.abs(last - regular);
    if (gap < bestGap) {
      bestGap = gap;
      best = { regular, last };
    }
  }
  // Шаг крупнее самого платежа — округлять нечего, считаем как без округления.
  return best ?? plainShape;
}

/** Пересечения полос — та же проверка, что на сервере, но до отправки формы. */
export function findRuleProblems(rules: ProgramRule[], markupBase: MarkupBase): string[] {
  const problems: string[] = []
  if (!rules.length) return ['Добавьте хотя бы одно условие: срок и наценку']

  const money = (v: number | null) => (v == null ? '∞' : Math.round(v).toLocaleString('ru-RU'))

  for (const r of rules) {
    if (!(r.termPayments >= 1)) problems.push('Срок должен быть не меньше одного платежа')
    if (!(r.markupPercent >= 0)) problems.push('Наценка не может быть отрицательной')
    if (markupBase === 'OF_TOTAL' && r.markupPercent >= 100) {
      problems.push('При наценке от итоговой цены процент должен быть меньше 100')
    }
    const dp = r.minDownPaymentPercent ?? 0
    if (dp < 0 || dp >= 100) problems.push('Минимальный взнос должен быть от 0 до 99%')
    if (r.amountFrom != null && r.amountTo != null && r.amountFrom >= r.amountTo) {
      problems.push(`Диапазон «${money(r.amountFrom)} — ${money(r.amountTo)}» пустой`)
    }
  }

  const byTerm = new Map<number, ProgramRule[]>()
  for (const r of rules) {
    const list = byTerm.get(r.termPayments) ?? []
    list.push(r)
    byTerm.set(r.termPayments, list)
  }

  /** Пересекаются ли полуинтервалы [aFrom, aTo) и [bFrom, bTo). */
  const overlaps = (aFrom: number, aTo: number | null, bFrom: number, bTo: number | null) =>
    (aTo == null || bFrom < aTo) && (bTo == null || aFrom < bTo)

  // Условие занимает прямоугольник «стоимость × взнос»: одна и та же стоимость
  // на разных ступенях взноса — не конфликт, а весь смысл ступеней.
  for (const [term, list] of byTerm) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!
        const b = list[j]!
        if (!overlaps(a.amountFrom ?? 0, a.amountTo, b.amountFrom ?? 0, b.amountTo)) continue
        if (
          !overlaps(
            a.downFromPercent ?? 0,
            a.downToPercent ?? null,
            b.downFromPercent ?? 0,
            b.downToPercent ?? null,
          )
        ) continue
        problems.push(
          `На сроке ${term} условия пересекаются: «${money(a.amountFrom)} — ${money(a.amountTo)}» ` +
            `и «${money(b.amountFrom)} — ${money(b.amountTo)}»`,
        )
      }
    }
  }
  return problems
}
