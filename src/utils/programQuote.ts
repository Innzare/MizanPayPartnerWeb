/**
 * Расчёт по тарифу «как будет в сделке» — одним вызовом.
 *
 * Те же шаги в том же порядке, что в форме сделки (`create-deal.vue`:
 * `programRule` → `programMarkupPercent` → `programTotalPrice` → `paymentShape`)
 * и на сервере: подбор условия по взносу → процент → минимальная наценка →
 * подгонка под равные платежи → разложение долга по графику.
 *
 * Собрано отдельной функцией, потому что считать это нужно не только при
 * оформлении: в настройках партнёр проверяет тариф на живых суммах и должен
 * увидеть ровно ту цифру, которую завтра увидит клиент.
 */
import {
  curveMarkupForDown,
  minDownPaymentFor,
  pickRuleForDown,
  scheduleShape,
  totalFor,
  totalForEqualPayments,
  totalWithMinMarkup,
  type MarkupBase,
  type ProgramDownMode,
  type ProgramRounding,
  type ProgramRoundingTarget,
  type ProgramRule,
} from './programMath'

/** Что из тарифа участвует в расчёте. */
export interface QuoteProgram {
  markupBase: MarkupBase
  rounding: ProgramRounding
  downMode?: ProgramDownMode
  roundingTarget?: ProgramRoundingTarget
  minMarkupAmount?: number | null
  rules: ProgramRule[]
}

export interface ProgramQuote {
  /** Условие тарифа, по которому всё посчитано. */
  rule: ProgramRule
  /** Фактическая наценка: на кривой она лежит между опорными точками. */
  markupPercent: number
  /** Цена договора. */
  total: number
  /** Первый взнос, который уйдёт в сделку. */
  downPayment: number
  /** Доля взноса в цене договора, проценты. */
  downPercent: number
  /** Минимум по условию тарифа. */
  minDownPayment: number
  /** Взнос подняли до минимума тарифа — партнёр ввёл меньше. */
  downPaymentRaised: boolean
  /** Регулярный платёж графика. */
  regular: number
  /** Последний платёж: в него уходит расхождение от округления. */
  last: number
  lastDiffers: boolean
  /** Переплата клиента в рублях и процентах от цены товара. */
  overpay: number
  overpayPercent: number
}

/**
 * Условия сделки по тарифу. `null` — таких условий в тарифе нет (не та
 * стоимость или срок), продавец такую сделку оформить не сможет.
 *
 * Взнос задаётся в рублях: доля считается от цены договора, а та сама зависит
 * от взноса — рубли разрывают этот круг, как и в форме сделки.
 */
export function quoteProgram(
  program: QuoteProgram,
  purchasePrice: number,
  termPayments: number,
  downPayment: number,
): ProgramQuote | null {
  const price = Math.max(0, Math.round(purchasePrice || 0))
  const typedDown = Math.max(0, Math.round(downPayment || 0))
  if (!(price > 0) || !(termPayments > 0)) return null
  return quoteFor(program, price, termPayments, typedDown, false)
}

function quoteFor(
  program: QuoteProgram,
  price: number,
  termPayments: number,
  typedDown: number,
  raised: boolean,
): ProgramQuote | null {
  let rule: ProgramRule | null
  let markupPercent: number

  if (program.downMode === 'CURVE') {
    const got = curveMarkupForDown(program.rules, price, termPayments, typedDown, program.markupBase)
    if (!got) return null
    rule = got.rule
    markupPercent = got.markupPercent
  } else {
    rule = pickRuleForDown(program.rules, price, termPayments, typedDown, program.markupBase)
    if (!rule) return null
    markupPercent = rule.markupPercent
  }

  // Порядок тот же, что на сервере: процент → минимальная наценка → подгонка
  // под равные платежи, если тариф округляет «в цену».
  let total = totalWithMinMarkup(
    price,
    totalFor(price, markupPercent, program.markupBase),
    program.minMarkupAmount,
  )
  if (program.roundingTarget === 'TOTAL') {
    total = totalForEqualPayments(total, typedDown, termPayments, program.rounding)
  }
  if (!(total > 0)) return null

  /**
   * Взнос ниже минимума тарифа продавец внести не сможет — считаем по минимуму
   * и говорим об этом. Поднятый взнос может попасть в другую ступень, поэтому
   * пересчитываем ещё раз; второго подъёма не будет — минимум уже соблюдён.
   */
  const minDown = Math.min(total, minDownPaymentFor(total, rule.minDownPaymentPercent))
  if (!raised && typedDown < minDown) {
    return quoteFor(program, price, termPayments, minDown, true)
  }

  const down = Math.min(total, typedDown)
  const shape = scheduleShape(total - down, termPayments, program.rounding)
  const overpay = total - price

  return {
    rule,
    markupPercent,
    total,
    downPayment: down,
    downPercent: total > 0 ? (down / total) * 100 : 0,
    minDownPayment: minDown,
    downPaymentRaised: raised,
    regular: shape.regular || shape.last,
    last: shape.last,
    lastDiffers: termPayments > 1 && shape.regular > 0 && shape.last !== shape.regular,
    overpay,
    overpayPercent: price > 0 ? Math.round((overpay / price) * 100) : 0,
  }
}
