import type { MarkupFrom } from '@/types'

/**
 * Наценка сделки в мастере — от закупки или от остатка после взноса.
 *
 * Та же формула, что на сервере (MizanPayBackend src/deals/markup-from.util.ts),
 * плюс случай, которого у сервера нет: взнос, заданный процентом от ЦЕНЫ.
 * Тогда взнос зависит от наценки, а наценка от взноса; круг разрывается
 * точной формулой: цена = закупка + (закупка − p·цена)·m
 *   ⇒ цена = закупка·(1+m)/(1+m·p).
 */
export function markupFromPercent(input: {
  purchase: number
  percent: number
  base: MarkupFrom
  /** Взнос в рублях — если известен (фиксированный или набранный вручную). */
  downRubles?: number | null
  /** Взнос процентом от цены — если рубли не заданы. */
  downPercentOfPrice?: number | null
}): number {
  const purchase = input.purchase || 0
  const m = (input.percent || 0) / 100
  if (input.base !== 'AFTER_DOWN_PAYMENT') return Math.round(purchase * m)
  if (input.downRubles == null && input.downPercentOfPrice != null) {
    const p = Math.min(Math.max(input.downPercentOfPrice / 100, 0), 1)
    return Math.max(0, Math.round(purchase * (1 + m) / (1 + m * p)) - purchase)
  }
  return Math.round(Math.max(purchase - (input.downRubles || 0), 0) * m)
}
