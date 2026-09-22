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
  /**
   * Границы ступеней по первоначальному взносу, проценты от цены договора:
   * [30] означает две ступени — взнос до 30% и от 30%. Пусто — условия от
   * взноса не зависят, и так выглядят все тарифы, заведённые раньше.
   */
  downSteps: number[]
  /** Наценка в процентах: `markup[срок][ступень стоимости][ступень взноса]`. */
  markup: Record<number, number[][]>
  /** Минимальный первый взнос, процентов. Один на всю программу. */
  minDownPaymentPercent: number
}

/** Подписи ступеней взноса: «до 30%», «30 — 50%», «от 50%». */
export function downStepLabels(steps: number[]): string[] {
  if (!steps.length) return ['Любой взнос']
  const out: string[] = [`взнос до ${steps[0]}%`]
  for (let i = 1; i < steps.length; i++) out.push(`${steps[i - 1]}% — ${steps[i]}%`)
  out.push(`от ${steps[steps.length - 1]}%`)
  return out
}

/** Границы ступени взноса по её номеру: нижняя включительно, верхняя — нет. */
export function downStepRange(
  steps: number[],
  index: number,
): { from: number | null; to: number | null } {
  if (!steps.length) return { from: null, to: null }
  return {
    from: index === 0 ? null : (steps[index - 1] ?? null),
    to: index >= steps.length ? null : (steps[index] ?? null),
  }
}

/** Сколько ступеней взноса даёт набор границ. */
export function downStepCount(steps: number[]): number {
  return steps.length + 1
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
    const rows = grid.markup[term] ?? []
    for (let ai = 0; ai < stepCount(grid.steps); ai++) {
      const cells = rows[ai] ?? []
      for (let di = 0; di < downStepCount(grid.downSteps); di++) {
        const percent = cells[di]
        if (percent == null || !Number.isFinite(percent)) continue
        const amount = stepRange(grid.steps, ai)
        const down = downStepRange(grid.downSteps, di)
        rules.push({
          amountFrom: amount.from,
          amountTo: amount.to,
          termPayments: term,
          markupPercent: percent,
          minDownPaymentPercent: grid.minDownPaymentPercent || 0,
          downFromPercent: down.from,
          downToPercent: down.to,
        })
      }
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

  const downBounds = new Set<number>()
  for (const r of rules) {
    if (r.downFromPercent != null) downBounds.add(r.downFromPercent)
    if (r.downToPercent != null) downBounds.add(r.downToPercent)
  }
  const downSteps = [...downBounds].sort((a, b) => a - b)

  const markup: Record<number, number[][]> = {}
  for (const term of terms) {
    const rows: number[][] = []
    for (let ai = 0; ai < stepCount(steps); ai++) {
      const amount = stepRange(steps, ai)
      const cells: number[] = []
      for (let di = 0; di < downStepCount(downSteps); di++) {
        const down = downStepRange(downSteps, di)
        const rule = rules.find(
          (r) =>
            r.termPayments === term &&
            (r.amountFrom ?? null) === amount.from &&
            (r.amountTo ?? null) === amount.to &&
            (r.downFromPercent ?? null) === down.from &&
            (r.downToPercent ?? null) === down.to,
        )
        if (!rule) return null // дыра в сетке — раскладка не получилась
        cells.push(rule.markupPercent)
      }
      rows.push(cells)
    }
    markup[term] = rows
  }

  return {
    terms,
    steps,
    downSteps,
    markup,
    minDownPaymentPercent: [...downs][0] ?? 0,
  }
}

/**
 * Сетка для нового тарифа.
 *
 * Сроки — привычный ряд 3/6/9/12: это то, что партнёры предлагают чаще всего,
 * и начинать с одного срока значило заставлять доклацывать остальные. Лишний
 * снимается одним нажатием, чего о недостающем не скажешь.
 */
const NEW_TERMS: [term: number, markupPercent: number][] = [
  [3, 15],
  [6, 20],
  [9, 25],
  [12, 30],
]

export function emptyGrid(): ProgramGrid {
  const markup: Record<number, number[][]> = {}
  // Наценка растёт вместе со сроком — так рассрочка и работает; равные проценты
  // на 3 и 12 платежей партнёру всё равно пришлось бы переписывать.
  for (const [term, percent] of NEW_TERMS) markup[term] = [[percent]]
  return {
    terms: NEW_TERMS.map(([term]) => term),
    steps: [],
    downSteps: [],
    markup,
    minDownPaymentPercent: 0,
  }
}
