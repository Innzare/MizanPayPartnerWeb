/**
 * Печать квитанции по своему бланку из конструктора.
 *
 * Стандартная квитанция рисуется кодом (`receiptPdf.ts`) — она одинаковая у
 * всех и меняться не должна. А собранный в конструкторе бланк печатается так
 * же, как договор: подставляем переменные в разметку и рендерим ту же самую
 * страницу.
 */
import type { Deal, Payment, User } from '@/types'
import { renderHtmlToPdf } from './templatePdfExport'
import { formatDate } from './formatters'

function curr(amount: number): string {
  return Math.round(amount || 0).toLocaleString('ru-RU') + ' ₽'
}

function fullName(obj: any): string {
  return [obj?.lastName, obj?.firstName, obj?.patronymic].filter(Boolean).join(' ') || '—'
}

/** Реквизиты бланка: то, что партнёр указал в настройках квитанции. */
export interface ReceiptBrand {
  companyName?: string
  phone?: string
  address?: string
  requisites?: string
  inn?: string
}

/**
 * Подстановка данных платежа в разметку бланка.
 *
 * Экранирования здесь нет намеренно: разметку пишет сам партнёр в своём
 * кабинете, а подставляются его же данные — те же правила, что у договора.
 */
export function replaceReceiptVariables(
  html: string,
  deal: Deal,
  payment: Payment,
  payments: Payment[],
  investor: Partial<User>,
  brand: ReceiptBrand = {},
): string {
  const cp: any = deal.clientProfile
  const client = cp ?? deal.client ?? {
    firstName: deal.externalClientName || '',
    lastName: '',
    phone: deal.externalClientPhone || '',
  }

  const live = payments.filter((p) => p.status !== 'CLOSED_EARLY')
  const paidSum = live
    .filter((p) => p.status === 'PAID')
    .reduce((s, p) => s + (p.amount || 0), 0) + (deal.downPayment || 0)
  // Прощённое при досрочном закрытии не оплачено, но и не долг: остаток по
  // договору после этой оплаты — тот, что записан в платеже (0), иначе бланк
  // показывал бы прощённую сумму, а стандартная квитанция — ноль.
  const byPayments = Math.max(0, (deal.totalPrice || 0) - paidSum)
  const remaining = typeof payment.remainingAfter === 'number'
    ? Math.min(byPayments, Math.max(0, payment.remainingAfter))
    : byPayments

  // Следующий по графику — тот, за который ещё не платили.
  const next = live
    .filter((p) => p.status !== 'PAID' && p.number > payment.number)
    .sort((a, b) => a.number - b.number)[0]

  const table = `<table style="width:100%;border-collapse:collapse">
    <thead><tr style="background:#f5f5f5">
      <th style="padding:5px 8px;text-align:center;font-size:0.85em">№</th>
      <th style="padding:5px 8px;text-align:center;font-size:0.85em">Дата</th>
      <th style="padding:5px 8px;text-align:right;font-size:0.85em">Сумма</th>
      <th style="padding:5px 8px;text-align:center;font-size:0.85em">Статус</th>
    </tr></thead>
    <tbody>${live
      .map(
        (p) => `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">${p.number}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">${formatDate(p.dueDate)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${curr(p.amount)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">${p.status === 'PAID' ? 'оплачен' : '—'}</td>
    </tr>`,
      )
      .join('')}</tbody>
  </table>`

  const values: Record<string, string> = {
    '{{продавец}}':
      brand.companyName ||
      (investor as any)?.companyName ||
      fullName(investor),
    '{{телефон_продавца}}': brand.phone || (investor as any)?.phone || '—',
    '{{адрес_продавца}}': brand.address || '',
    '{{реквизиты}}': (brand.requisites || '').replace(/\n/g, '<br>'),
    '{{инн}}': brand.inn || '',

    '{{покупатель}}': fullName(client),
    '{{телефон_покупателя}}': client?.phone || '—',

    '{{номер_платежа}}': String(payment.number ?? '—'),
    '{{всего_платежей}}': String(live.length || deal.numberOfPayments || '—'),
    '{{сумма_платежа}}': curr(payment.amount),
    '{{дата_оплаты}}': formatDate(payment.paidAt || new Date().toISOString()),
    '{{дата_платежа_по_графику}}': formatDate(payment.dueDate),
    '{{способ_оплаты}}': (payment as any)?.account?.name || '',

    '{{номер_договора}}': String(deal.dealNumber ?? '—'),
    '{{дата_договора}}': formatDate(deal.dealDate || deal.createdAt),
    '{{товар}}': deal.productName || '—',
    '{{цена}}': curr(deal.totalPrice),
    '{{оплачено_всего}}': curr(paidSum),
    '{{остаток}}': curr(remaining),
    '{{следующий_платёж}}': next
      ? `${formatDate(next.dueDate)} · ${curr(next.amount)}`
      : 'договор закрыт',
    '{{график_платежей}}': table,
  }

  let out = html
  for (const [key, value] of Object.entries(values)) {
    out = out.split(key).join(value)
  }
  return out
}

/** Собрать и открыть (или вернуть) PDF квитанции по своему бланку. */
export function exportReceiptTemplatePdf(
  html: string,
  deal: Deal,
  payment: Payment,
  payments: Payment[],
  investor: Partial<User>,
  brand: ReceiptBrand = {},
  margins?: { top: number; bottom: number; left: number; right: number },
  opts: { returnBlob?: boolean } = {},
): Promise<Blob | void> {
  const finalHtml = replaceReceiptVariables(html, deal, payment, payments, investor, brand)
  // Поля по умолчанию у квитанции уже: это половина листа, а не договор.
  return renderHtmlToPdf(finalHtml, margins || { top: 12, bottom: 12, left: 14, right: 14 }, opts)
}
