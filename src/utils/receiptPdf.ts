// @ts-ignore
import pdfMake from 'pdfmake/build/pdfmake'
// @ts-ignore
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { Deal, Payment, User } from '@/types'
import { formatDate } from './formatters'

pdfMake.vfs = pdfFonts

function curr(amount: number): string {
  return Math.round(amount).toLocaleString('ru-RU') + ' руб.'
}

function fullName(obj: any): string {
  const parts = [obj?.lastName, obj?.firstName, obj?.patronymic].filter(Boolean)
  return parts.join(' ') || 'Не указано'
}

export function generateReceipt(
  deal: Deal,
  payment: Payment,
  investor: Partial<User>,
  opts: { returnBlob?: boolean } = {},
): Promise<Blob> | void {
  const cp = deal.clientProfile
  const client = cp
    ? { firstName: cp.firstName, lastName: cp.lastName, patronymic: cp.patronymic, phone: cp.phone }
    : deal.client
      ? deal.client
      : { firstName: deal.externalClientName || '', lastName: '', phone: deal.externalClientPhone || '' }

  const receiptNumber = `${deal.id.slice(0, 6).toUpperCase()}-${payment.number}`
  const today = formatDate(new Date().toISOString())

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [50, 40, 50, 40],
    defaultStyle: { fontSize: 10, lineHeight: 1.3 },
    content: [
      // Header
      {
        text: 'КВИТАНЦИЯ ОБ ОПЛАТЕ',
        alignment: 'center',
        fontSize: 16,
        bold: true,
        margin: [0, 0, 0, 2],
      },
      {
        text: `№ ${receiptNumber}`,
        alignment: 'center',
        fontSize: 11,
        color: '#555',
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          { text: `г. ${investor.city || (client as any).city || '___________'}`, width: '*' },
          { text: today, alignment: 'right', width: 'auto' },
        ],
        margin: [0, 0, 0, 16],
      },

      // Main info table
      {
        table: {
          widths: ['auto', '*'],
          body: [
            [
              { text: 'Продавец (Инвестор)', color: '#777', border: [false, false, false, true] },
              { text: fullName(investor), bold: true, border: [false, false, false, true] },
            ],
            [
              { text: 'Покупатель (Клиент)', color: '#777', border: [false, false, false, true] },
              { text: fullName(client), bold: true, border: [false, false, false, true] },
            ],
            [
              { text: 'Телефон клиента', color: '#777', border: [false, false, false, true] },
              { text: (client as any).phone || 'не указан', border: [false, false, false, true] },
            ],
            [
              { text: 'Товар', color: '#777', border: [false, false, false, true] },
              { text: deal.productName, bold: true, border: [false, false, false, true] },
            ],
            [
              { text: 'Договор', color: '#777', border: [false, false, false, true] },
              { text: `№ ${deal.id.slice(0, 8).toUpperCase()} от ${formatDate(deal.dealDate || deal.createdAt)}`, border: [false, false, false, true] },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          hLineColor: () => '#e5e5e5',
          vLineWidth: () => 0,
          paddingTop: () => 5,
          paddingBottom: () => 5,
          paddingLeft: () => 0,
          paddingRight: () => 12,
        },
        margin: [0, 0, 0, 16],
      },

      // Payment details
      {
        text: 'ДАННЫЕ ПЛАТЕЖА',
        fontSize: 11,
        bold: true,
        color: '#333',
        margin: [0, 0, 0, 8],
      },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            [
              { text: 'Номер платежа', border: [false, false, false, true] },
              { text: `${payment.number} из ${deal.numberOfPayments}`, alignment: 'right', border: [false, false, false, true] },
            ],
            [
              { text: 'Дата платежа (по графику)', border: [false, false, false, true] },
              { text: formatDate(payment.dueDate), alignment: 'right', border: [false, false, false, true] },
            ],
            [
              { text: 'Дата фактической оплаты', border: [false, false, false, true] },
              { text: payment.paidAt ? formatDate(payment.paidAt) : today, alignment: 'right', border: [false, false, false, true] },
            ],
            [
              { text: 'Сумма платежа', border: [false, false, false, false], bold: true, fontSize: 13 },
              { text: curr(payment.amount), alignment: 'right', bold: true, fontSize: 12, color: '#047857', border: [false, false, false, false] },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          hLineColor: () => '#e5e5e5',
          vLineWidth: () => 0,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
        margin: [0, 0, 0, 16],
      },

      // Deal summary
      {
        text: 'СВОДКА ПО ДОГОВОРУ',
        fontSize: 11,
        bold: true,
        color: '#333',
        margin: [0, 0, 0, 8],
      },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            [
              { text: 'Итоговая цена товара', border: [false, false, false, true] },
              { text: curr(deal.totalPrice), alignment: 'right', border: [false, false, false, true] },
            ],
            [
              { text: 'Оплачено ранее', border: [false, false, false, true] },
              { text: curr(deal.totalPrice - deal.remainingAmount - payment.amount), alignment: 'right', border: [false, false, false, true] },
            ],
            [
              { text: 'Текущий платёж', border: [false, false, false, true] },
              { text: curr(payment.amount), alignment: 'right', bold: true, border: [false, false, false, true] },
            ],
            [
              { text: 'Остаток после оплаты', border: [false, false, false, false], bold: true },
              { text: curr(payment.remainingAfter), alignment: 'right', bold: true, border: [false, false, false, false] },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          hLineColor: () => '#e5e5e5',
          vLineWidth: () => 0,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
        margin: [0, 0, 0, 20],
      },

      // Confirmation text
      {
        text: `Настоящим подтверждается получение оплаты в размере ${curr(payment.amount)} по Договору мурабаха № ${deal.id.slice(0, 8).toUpperCase()}.`,
        margin: [0, 0, 0, 6],
      },
      {
        text: 'Квитанция составлена в двух экземплярах — по одному для каждой стороны.',
        color: '#777',
        fontSize: 9,
        margin: [0, 0, 0, 24],
      },

      // Signatures
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Продавец:', bold: true, margin: [0, 0, 0, 6] },
              { text: fullName(investor), fontSize: 9, margin: [0, 0, 0, 12] },
              { text: '_________________________', color: '#999' },
              { text: '(подпись)', fontSize: 8, color: '#999', margin: [0, 2, 0, 0] },
            ],
          },
          {
            width: '*',
            stack: [
              { text: 'Покупатель:', bold: true, margin: [0, 0, 0, 6] },
              { text: fullName(client), fontSize: 9, margin: [0, 0, 0, 12] },
              { text: '_________________________', color: '#999' },
              { text: '(подпись)', fontSize: 8, color: '#999', margin: [0, 2, 0, 0] },
            ],
          },
        ],
      },
    ],
  }

  if (opts.returnBlob) {
    return new Promise<Blob>((resolve) => pdfMake.createPdf(docDefinition).getBlob(resolve))
  }
  pdfMake.createPdf(docDefinition).open()
}
