import type { Deal, Payment } from '@/types'

/**
 * Квитанция из окна отметки оплаты — до того, как платёж проведён.
 *
 * Окно предлагает скачать или отправить квитанцию сразу, ещё до нажатия
 * «Отметить». Раньше в неё уходил платёж как он есть в графике: клиент
 * принёс 15 000 вместо плановых 14 880 — а в квитанции 14 880, дата «сегодня»
 * вместо выбранной, «оплачено ранее» без учёта текущего платежа и плановый
 * остаток. Клиенту отдавали документ не о той сумме, которую он заплатил.
 *
 * Здесь собираются копии платежа и сделки «как после этой оплаты» — по тому,
 * что партнёр ввёл в окне. Сам генератор квитанции не меняется: для уже
 * проведённых платежей его формулы верны, и квитанция по ним та же.
 *
 * Проверка формул квитанции на копиях:
 *   «Оплачено ранее»      = цена − остаток_после − сумма = цена − остаток_до;
 *   «Остаток после оплаты» = остаток_до − сумма.
 */
export function receiptAsPaid(
  deal: Deal,
  payment: Payment,
  entered: { amount?: number | null; paidAt?: string | null },
): { deal: Deal; payment: Payment } {
  const amount = entered.amount && entered.amount > 0 ? Math.round(entered.amount) : payment.amount
  // Остаток сделки — без отсечения нуля: по нему считается «оплачено ранее»
  // (цена − остаток − сумма), и при переплате отсечённый ноль занизил бы его
  // на сумму переплаты. «Остаток после оплаты» в квитанции — не меньше нуля.
  const dealLeft = Math.round((deal.remainingAmount ?? 0) - amount)
  const remainingAfter = Math.max(dealLeft, 0)
  // Полдень выбранного дня — как при самой отметке: сдвиг часового пояса не
  // должен перенести дату в квитанции на соседний день.
  const paidAt = entered.paidAt
    ? new Date(`${entered.paidAt}T12:00:00`).toISOString()
    : new Date().toISOString()
  const paid: Payment = { ...payment, amount, paidAt, status: 'PAID', remainingAfter }
  return {
    payment: paid,
    deal: {
      ...deal,
      remainingAmount: dealLeft,
      // Бланк партнёра может выводить и весь график — в нём тоже эта оплата.
      payments: deal.payments?.map((p) => (p.id === payment.id ? paid : p)),
    },
  }
}
