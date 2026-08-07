/**
 * Единый расчёт «сколько дохода в этом платеже».
 *
 * Раньше формула была скопирована в analytics.vue и считалась заново в каждом
 * месте, где нужна прибыль. Копии разъезжались — и один раз это уже привело к
 * занижению дохода: считали через markupPercent, а у части сделок процент
 * записан от ЦЕНЫ ПРОДАЖИ, а не от закупки.
 *
 * Точное зеркало SQL_MARGIN / SQL_SHARE из reports/reports.sql.ts на бэкенде.
 * Маржа берётся только в РУБЛЯХ:
 *   - есть wholesalePrice → totalPrice − wholesalePrice (розничная наценка
 *     вместе с рассрочкой);
 *   - иначе → deal.markup.
 * Доля дохода в каждом рубле платежа = маржа / цена продажи, не больше 1.
 *
 * Запасного пути через markupPercent здесь НЕТ намеренно. Он был, и на трёх
 * битых сделках (markup = 0 при markupPercent > 0) давал доход, которого
 * бэкенд не видит — цифра на главной расходилась с отчётами. Такие сделки
 * лечатся в данных, а не подпоркой в формуле.
 */

export interface ProfitDeal {
  totalPrice: number
  markup?: number
  wholesalePrice?: number | null
}

/** Доля дохода в каждом рубле платежа, ≤ 1. */
export function dealProfitShare(deal?: ProfitDeal | null): number {
  if (!deal || !deal.totalPrice || deal.totalPrice <= 0) return 0

  const hasWholesale = deal.wholesalePrice != null && deal.wholesalePrice > 0
  const margin = hasWholesale
    ? Math.max(0, deal.totalPrice - deal.wholesalePrice!)
    : deal.markup ?? 0

  return Math.min(margin / deal.totalPrice, 1)
}

/** Сколько дохода приносит платёж на указанную сумму. */
export function paymentProfit(amount: number, deal?: ProfitDeal | null): number {
  return amount * dealProfitShare(deal)
}
