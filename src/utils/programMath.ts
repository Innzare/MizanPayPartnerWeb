/**
 * Расчёты программы рассрочки — зеркало серверных.
 *
 * Форма должна считать мгновенно, пока человек печатает, поэтому те же формулы
 * живут и здесь. Истина при этом всегда серверная: перед сохранением сделка
 * сверяется с программой на бэкенде, и расхождение будет отклонено, а не
 * молча принято.
 */

export type MarkupBase = 'OF_COST' | 'OF_TOTAL'
export type ProgramRounding = 'NONE' | 'TO_100' | 'TO_500' | 'TO_1000'

export interface ProgramRule {
  id?: string
  amountFrom: number | null
  amountTo: number | null
  termPayments: number
  markupPercent: number
  minDownPaymentPercent: number
}

export const ROUNDING_STEP: Record<ProgramRounding, number> = {
  NONE: 0,
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

/** Нижняя граница включительно, верхняя — нет: границу забирает верхняя полоса. */
export function ruleCoversAmount(rule: ProgramRule, purchasePrice: number): boolean {
  const from = rule.amountFrom ?? 0
  if (purchasePrice < from) return false
  if (rule.amountTo != null && purchasePrice >= rule.amountTo) return false
  return true
}

export function matchRule(rules: ProgramRule[], purchasePrice: number, termPayments: number): ProgramRule | null {
  return rules.find((r) => r.termPayments === termPayments && ruleCoversAmount(r, purchasePrice)) ?? null
}

export function availableTerms(rules: ProgramRule[], purchasePrice: number): number[] {
  const terms = rules.filter((r) => ruleCoversAmount(r, purchasePrice)).map((r) => r.termPayments)
  return [...new Set(terms)].sort((a, b) => a - b)
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
  for (const [term, list] of byTerm) {
    const sorted = [...list].sort((a, b) => (a.amountFrom ?? 0) - (b.amountFrom ?? 0))
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const next = sorted[i]!
      if (prev.amountTo == null || prev.amountTo > (next.amountFrom ?? 0)) {
        problems.push(
          `На сроке ${term} условия пересекаются: «${money(prev.amountFrom)} — ${money(prev.amountTo)}» ` +
            `и «${money(next.amountFrom)} — ${money(next.amountTo)}»`,
        )
      }
    }
  }
  return problems
}
