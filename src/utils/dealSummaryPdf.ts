// @ts-ignore
import pdfMake from 'pdfmake/build/pdfmake'
// @ts-ignore
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { Deal, Payment, User } from '@/types'
import { formatDate } from './formatters'

pdfMake.vfs = pdfFonts

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Активная',
  COMPLETED: 'Завершена',
  DISPUTED: 'Спор',
  CANCELLED: 'Отменена',
}

const PAYMENT_STATUS: Record<string, string> = {
  PENDING: 'Ожидает',
  PAID: 'Оплачен',
  OVERDUE: 'Просрочен',
}

const INTERVAL_LABELS: Record<string, string> = {
  MONTHLY: 'Ежемесячно',
  BIWEEKLY: 'Раз в 2 недели',
  WEEKLY: 'Еженедельно',
}

function curr(amount: number): string {
  return Math.round(amount).toLocaleString('ru-RU') + ' ₽'
}

function fullName(user: Partial<User> | undefined): string {
  if (!user) return '—'
  return [user.lastName, user.firstName, user.patronymic].filter(Boolean).join(' ') || '—'
}

function clientName(deal: Deal): string {
  if (deal.clientProfile) {
    return [deal.clientProfile.lastName, deal.clientProfile.firstName, deal.clientProfile.patronymic]
      .filter(Boolean).join(' ')
  }
  if (deal.client) return fullName(deal.client)
  return deal.externalClientName || '—'
}

function clientPhone(deal: Deal): string {
  return deal.clientProfile?.phone || deal.client?.phone || deal.externalClientPhone || '—'
}

export function generateDealSummary(deal: Deal, payments: Payment[], investor: Partial<User>) {
  const paidPayments = payments.filter(p => p.status === 'PAID')
  const overduePayments = payments.filter(p => p.status === 'OVERDUE')
  const pendingPayments = payments.filter(p => p.status === 'PENDING')
  const totalPaid = paidPayments.reduce((s, p) => s + p.amount, 0)
  const totalOverdue = overduePayments.reduce((s, p) => s + p.amount, 0)
  const progress = deal.totalPrice > 0 ? Math.round(((deal.totalPrice - deal.remainingAmount) / deal.totalPrice) * 100) : 0

  const guarantor = deal.guarantorProfile
    ? [deal.guarantorProfile.lastName, deal.guarantorProfile.firstName].filter(Boolean).join(' ')
    : null

  const paymentRows = payments.map(p => [
    { text: String(p.number), alignment: 'center' as const, fontSize: 9 },
    { text: formatDate(p.dueDate), alignment: 'center' as const, fontSize: 9 },
    { text: curr(p.amount), alignment: 'right' as const, fontSize: 9 },
    { text: p.paidAt ? formatDate(p.paidAt) : '—', alignment: 'center' as const, fontSize: 9, color: p.paidAt ? '#047857' : '#999' },
    {
      text: PAYMENT_STATUS[p.status] || p.status,
      alignment: 'center' as const,
      fontSize: 9,
      color: p.status === 'PAID' ? '#047857' : p.status === 'OVERDUE' ? '#dc2626' : '#666',
    },
    { text: curr(p.remainingAfter), alignment: 'right' as const, fontSize: 9 },
  ])

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { fontSize: 10, lineHeight: 1.3 },
    content: [
      // ── Header ──
      {
        columns: [
          {
            stack: [
              { text: 'СВОДКА ПО СДЕЛКЕ', fontSize: 16, bold: true, color: '#1a1a1a' },
              { text: `Сформировано: ${formatDate(new Date().toISOString())}`, fontSize: 9, color: '#888', margin: [0, 4, 0, 0] },
            ],
          },
          {
            stack: [
              {
                text: STATUS_LABELS[deal.status] || deal.status,
                alignment: 'right' as const,
                fontSize: 11,
                bold: true,
                color: deal.status === 'ACTIVE' ? '#047857' : deal.status === 'COMPLETED' ? '#3b82f6' : '#dc2626',
              },
              { text: `ID: ${deal.id.slice(0, 8).toUpperCase()}`, alignment: 'right' as const, fontSize: 9, color: '#888', margin: [0, 4, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 20],
      },

      // ── Divider ──
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#e5e7eb' }], margin: [0, 0, 0, 16] },

      // ── Product ──
      {
        columns: [
          { width: 100, text: 'Товар', color: '#888', fontSize: 9 },
          { text: deal.productName, bold: true, fontSize: 12 },
        ],
        margin: [0, 0, 0, 12],
      },

      // ── Parties ──
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'ПРОДАВЕЦ', fontSize: 8, color: '#888', bold: true, margin: [0, 0, 0, 4] },
              { text: fullName(investor), bold: true },
              { text: investor.phone || '', fontSize: 9, color: '#555' },
              investor.email ? { text: investor.email, fontSize: 9, color: '#555' } : {},
            ],
          },
          {
            width: '50%',
            stack: [
              { text: 'ПОКУПАТЕЛЬ', fontSize: 8, color: '#888', bold: true, margin: [0, 0, 0, 4] },
              { text: clientName(deal), bold: true },
              { text: clientPhone(deal), fontSize: 9, color: '#555' },
              ...(guarantor ? [
                { text: '', margin: [0, 6, 0, 0] },
                { text: 'ПОРУЧИТЕЛЬ', fontSize: 8, color: '#888', bold: true, margin: [0, 0, 0, 4] },
                { text: guarantor, fontSize: 10 },
                { text: deal.guarantorProfile?.phone || '', fontSize: 9, color: '#555' },
              ] : []),
            ],
          },
        ],
        margin: [0, 0, 0, 20],
      },

      // ── Financial summary ──
      { text: 'ФИНАНСОВЫЕ УСЛОВИЯ', fontSize: 10, bold: true, color: '#1a1a1a', margin: [0, 0, 0, 10] },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            [
              { text: 'Себестоимость (закупочная цена)', border: [false, false, false, true], color: '#555' },
              { text: curr(deal.purchasePrice), alignment: 'right', border: [false, false, false, true], bold: true },
            ],
            [
              { text: `Наценка (${Number(deal.markupPercent).toFixed(1).replace(/\.0$/, '')}%)`, border: [false, false, false, true], color: '#555' },
              { text: curr(deal.markup), alignment: 'right', border: [false, false, false, true] },
            ],
            [
              { text: 'Цена продажи', border: [false, false, false, true], color: '#555' },
              { text: curr(deal.totalPrice), alignment: 'right', border: [false, false, false, true], bold: true, fontSize: 12 },
            ],
            [
              { text: 'Первоначальный взнос', border: [false, false, false, true], color: '#555' },
              { text: curr(deal.downPayment || 0), alignment: 'right', border: [false, false, false, true] },
            ],
            [
              { text: 'Остаток к оплате', border: [false, false, false, false], color: '#555' },
              { text: curr(deal.remainingAmount), alignment: 'right', border: [false, false, false, false], bold: true, color: deal.remainingAmount > 0 ? '#dc2626' : '#047857' },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          hLineColor: () => '#e5e7eb',
          vLineWidth: () => 0,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        margin: [0, 0, 0, 20],
      },

      // ── Payment progress ──
      { text: 'ПРОГРЕСС ОПЛАТЫ', fontSize: 10, bold: true, color: '#1a1a1a', margin: [0, 0, 0, 10] },
      {
        table: {
          widths: ['*', '*', '*', '*'],
          body: [
            [
              { text: 'Оплачено', fontSize: 8, color: '#888', border: [false, false, false, false] },
              { text: 'Просрочено', fontSize: 8, color: '#888', border: [false, false, false, false] },
              { text: 'Ожидает', fontSize: 8, color: '#888', border: [false, false, false, false] },
              { text: 'Прогресс', fontSize: 8, color: '#888', border: [false, false, false, false] },
            ],
            [
              { text: `${curr(totalPaid)} (${paidPayments.length})`, bold: true, color: '#047857', border: [false, false, false, false] },
              { text: `${curr(totalOverdue)} (${overduePayments.length})`, bold: true, color: overduePayments.length > 0 ? '#dc2626' : '#555', border: [false, false, false, false] },
              { text: `${curr(pendingPayments.reduce((s, p) => s + p.amount, 0))} (${pendingPayments.length})`, bold: true, color: '#555', border: [false, false, false, false] },
              { text: `${progress}%`, bold: true, fontSize: 14, color: '#047857', border: [false, false, false, false] },
            ],
          ],
        },
        layout: { paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 0, paddingRight: () => 8 },
        margin: [0, 0, 0, 8],
      },
      {
        columns: [
          { text: `Интервал: ${INTERVAL_LABELS[deal.paymentInterval] || deal.paymentInterval}`, fontSize: 9, color: '#888' },
          { text: `Дата сделки: ${formatDate(deal.createdAt)}`, fontSize: 9, color: '#888', alignment: 'right' },
        ],
        margin: [0, 0, 0, 20],
      },

      // ── Payment schedule ──
      { text: 'ГРАФИК ПЛАТЕЖЕЙ', fontSize: 10, bold: true, color: '#1a1a1a', margin: [0, 0, 0, 10] },
      {
        table: {
          headerRows: 1,
          widths: [30, '*', 'auto', 'auto', 60, 'auto'],
          body: [
            [
              { text: '№', bold: true, alignment: 'center', fillColor: '#f9fafb', fontSize: 9 },
              { text: 'Дата', bold: true, alignment: 'center', fillColor: '#f9fafb', fontSize: 9 },
              { text: 'Сумма', bold: true, alignment: 'right', fillColor: '#f9fafb', fontSize: 9 },
              { text: 'Оплачено', bold: true, alignment: 'center', fillColor: '#f9fafb', fontSize: 9 },
              { text: 'Статус', bold: true, alignment: 'center', fillColor: '#f9fafb', fontSize: 9 },
              { text: 'Остаток', bold: true, alignment: 'right', fillColor: '#f9fafb', fontSize: 9 },
            ],
            ...paymentRows,
          ],
        },
        layout: {
          hLineWidth: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length) ? 0.8 : 0.3,
          hLineColor: (i: number) => i <= 1 ? '#d1d5db' : '#e5e7eb',
          vLineWidth: () => 0,
          paddingTop: () => 5,
          paddingBottom: () => 5,
          paddingLeft: () => 6,
          paddingRight: () => 6,
        },
        margin: [0, 0, 0, 20],
      },

      // ── Footer ──
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }], margin: [0, 0, 0, 10] },
      {
        columns: [
          { text: 'MizanPay — платформа исламской рассрочки', fontSize: 8, color: '#aaa' },
          { text: `Документ сформирован автоматически`, fontSize: 8, color: '#aaa', alignment: 'right' },
        ],
      },
    ],
  }

  const name = clientName(deal).replace(/\s+/g, '_')
  pdfMake.createPdf(docDefinition).open()
}
