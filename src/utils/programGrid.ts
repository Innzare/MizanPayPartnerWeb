/**
 * Условия программы рассрочки в виде, понятном человеку.
 *
 * На сервере условия хранятся списком полос: «от 100 000 до 300 000, 6
 * платежей, 20%». Так их и заполняли — строка за строкой, руками выставляя
 * границы. На трёх сроках и трёх ценовых ступенях это девять строк, в которых
 * легко оставить дыру («товар за 250 000 не подходит ни под одно условие») или
 * пересечение.
 *
 * Здесь те же данные разложены на две простые вещи:
 *   • сроки — сколько платежей бывает по этой программе;
 *   • ступени по стоимости — необязательные, если условия от цены не зависят.
 * Наценка живёт в клетке «срок × ступень». Дыр и пересечений в такой сетке не
 * бывает по построению: границы считаются из ступеней, а не вводятся отдельно.
 *
 * Обратное преобразование (`gridToRules`) даёт ровно тот формат, который
 * сервер принимал и раньше, поэтому ни модель, ни расчёты сделок не меняются.
 */
import type { ProgramRule } from '@/utils/programMath'

export interface ProgramGrid {
  /** Сроки (число платежей), по возрастанию. */
  terms: number[]
  /**
   * Границы ступеней по стоимости товара: [100000, 300000] означает три
   * ступени — до 100 000, 100 000–300 000 и от 300 000. Пусто — условия от
   * стоимости не зависят.
   */
  steps: number[]
  /** Наценка в процентах: `markup[срок][номер ступени]`. */
  markup: Record<number, number[]>
  /** Минимальный первый взнос, процентов. Один на всю программу. */
  minDownPaymentPercent: number
}

/** Подписи ступеней для заголовков таблицы: «до 100 000», «от 300 000». */
export function stepLabels(steps: number[]): string[] {
  const money = (v: number) => Math.round(v).toLocaleString('ru-RU')
  if (!steps.length) return ['Любая стоимость']
  const out: string[] = [`до ${money(steps[0]!)} ₽`]
  for (let i = 1; i < steps.length; i++) out.push(`${money(steps[i - 1]!)} — ${money(steps[i]!)} ₽`)
  out.push(`от ${money(steps[steps.length - 1]!)} ₽`)
  return out
}

/** Границы ступени по её номеру: нижняя включительно, верхняя — нет. */
export function stepRange(steps: number[], index: number): { from: number | null; to: number | null } {
  if (!steps.length) return { from: null, to: null }
  return {
    from: index === 0 ? null : (steps[index - 1] ?? null),
    to: index >= steps.length ? null : (steps[index] ?? null),
  }
}

/** Сколько ступеней даёт набор границ: границ N → ступеней N + 1. */
export function stepCount(steps: number[]): number {
  return steps.length + 1
}

/** Сетка → полосы для сервера. Клетка с пустой наценкой не превращается в условие. */
export function gridToRules(grid: ProgramGrid): ProgramRule[] {
  const rules: ProgramRule[] = []
  for (const term of [...grid.terms].sort((a, b) => a - b)) {
    const row = grid.markup[term] ?? []
    for (let i = 0; i < stepCount(grid.steps); i++) {
      const percent = row[i]
      if (percent == null || !Number.isFinite(percent)) continue
      const { from, to } = stepRange(grid.steps, i)
      rules.push({
        amountFrom: from,
        amountTo: to,
        termPayments: term,
        markupPercent: percent,
        minDownPaymentPercent: grid.minDownPaymentPercent || 0,
      })
    }
  }
  return rules
}

/**
 * Полосы → сетка. `null`, если условия так не раскладываются.
 *
 * Программы, заведённые в прежнем редакторе, могут быть какими угодно: разные
 * взносы в соседних клетках, границы, не совпадающие между сроками, дыры.
 * Такие мы не «чиним» молча — возвращаем `null`, и форма честно предлагает
 * подробный режим, где видна каждая полоса.
 */
export function rulesToGrid(rules: ProgramRule[]): ProgramGrid | null {
  if (!rules.length) return null

  // Взнос в сетке один на программу: разные по клеткам сюда не помещаются.
  const downs = new Set(rules.map((r) => r.minDownPaymentPercent ?? 0))
  if (downs.size > 1) return null

  const terms = [...new Set(rules.map((r) => r.termPayments))].sort((a, b) => a - b)

  // Границы ступеней собираем из всех полос: у каждой должны быть одни и те же.
  const bounds = new Set<number>()
  for (const r of rules) {
    if (r.amountFrom != null) bounds.add(Math.round(r.amountFrom))
    if (r.amountTo != null) bounds.add(Math.round(r.amountTo))
  }
  const steps = [...bounds].sort((a, b) => a - b)

  const markup: Record<number, number[]> = {}
  for (const term of terms) {
    const row: number[] = []
    for (let i = 0; i < stepCount(steps); i++) {
      const { from, to } = stepRange(steps, i)
      const rule = rules.find(
        (r) =>
          r.termPayments === term &&
          (r.amountFrom ?? null) === from &&
          (r.amountTo ?? null) === to,
      )
      if (!rule) return null // дыра в сетке — раскладка не получилась
      row.push(rule.markupPercent)
    }
    markup[term] = row
  }

  return {
    terms,
    steps,
    markup,
    minDownPaymentPercent: [...downs][0] ?? 0,
  }
}

/** Пустая сетка для новой программы: один срок и одна наценка — уже рабочая. */
export function emptyGrid(): ProgramGrid {
  return { terms: [6], steps: [], markup: { 6: [20] }, minDownPaymentPercent: 0 }
}
