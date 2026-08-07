// @ts-ignore
import pdfMake from 'pdfmake/build/pdfmake'
// @ts-ignore
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { RouteSheetDetail } from '@/stores/routeSheets'
import { formatDate } from './formatters'

pdfMake.vfs = pdfFonts

function curr(amount: number): string {
  return Math.round(amount).toLocaleString('ru-RU') + ' ₽'
}

const STATUS_LABELS: Record<string, string> = {
  ISSUED: 'Выдан',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
}
const LINE_LABELS: Record<string, string> = {
  PENDING: 'Ожидает',
  PAID: 'Оплачено',
  SKIPPED: 'Пропущено',
}

/**
 * Путевой лист для сотрудника: список поставщиков к объезду, суммы к выплате,
 * колонка для подписи/отметки. Оффлайн-документ, печатается и берётся в поездку.
 */
export function generateRouteSheetPdf(
  sheet: RouteSheetDetail,
  investorName: string,
  opts: { returnBlob?: boolean } = {},
): Promise<Blob> | void {
  const rows = sheet.lines.map((l, i) => {
    const debtLines = l.debts
      .map((d) => `#${d.dealNumber} ${d.productName} — ${curr(d.amountPlanned)}${d.debtTotal !== d.amountPlanned ? ` из ${curr(d.debtTotal)}` : ''}`)
      .join('\n') || '—'
    return [
      { text: String(i + 1), alignment: 'center', fontSize: 9, margin: [0, 4, 0, 4] },
      {
        stack: [
          { text: l.supplierName, bold: true, fontSize: 10 },
          { text: [l.supplierCity, l.supplierAddress].filter(Boolean).join(', ') || '—', fontSize: 8, color: '#666' },
          ...(l.supplierPhone ? [{ text: l.supplierPhone, fontSize: 8, color: '#666' }] : []),
        ],
        margin: [0, 4, 0, 4],
      },
      { text: debtLines, fontSize: 8, color: '#444', margin: [0, 4, 0, 4] },
      {
        stack: [
          { text: curr(l.amountPlanned), alignment: 'right', bold: true, fontSize: 10 },
          ...(l.debtTotal !== l.amountPlanned ? [{ text: `из ${curr(l.debtTotal)} долга`, alignment: 'right', fontSize: 7.5, color: '#888' }] : []),
        ],
        margin: [0, 4, 0, 4],
      },
      { text: l.comment || '', fontSize: 8, color: '#666', margin: [0, 4, 0, 4] },
      { text: '', margin: [0, 4, 0, 4] }, // колонка для отметки/подписи от руки
    ]
  })

  const totalPlanned = sheet.lines.reduce((s, l) => s + l.amountPlanned, 0)
  const totalDebt = sheet.lines.reduce((s, l) => s + l.debtTotal, 0)

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    content: [
      {
        columns: [
          { text: `ПУТЕВОЙ ЛИСТ №${sheet.number}`, fontSize: 16, bold: true, color: '#1a1a1a' },
          { text: STATUS_LABELS[sheet.status] || sheet.status, fontSize: 10, color: '#888', alignment: 'right', margin: [0, 4, 0, 0] },
        ],
        margin: [0, 0, 0, 6],
      },
      {
        columns: [
          { text: `Дата: ${formatDate(new Date(sheet.date).toISOString())}`, fontSize: 9, color: '#666' },
          { text: `Ответственный: ${sheet.assignedStaffName || '—'}`, fontSize: 9, color: '#666', alignment: 'right' },
        ],
        margin: [0, 0, 0, 4],
      },
      { text: investorName, fontSize: 9, color: '#888', margin: [0, 0, 0, 16] },

      ...(sheet.note
        ? [{ text: sheet.note, fontSize: 9, italics: true, color: '#555', margin: [0, 0, 0, 12] }]
        : []),

      {
        table: {
          headerRows: 1,
          widths: [18, '*', 100, 62, 70, 60],
          body: [
            [
              { text: '№', bold: true, alignment: 'center', fillColor: '#f9fafb', fontSize: 8 },
              { text: 'Поставщик / адрес', bold: true, fillColor: '#f9fafb', fontSize: 8 },
              { text: 'Долги', bold: true, fillColor: '#f9fafb', fontSize: 8 },
              { text: 'К выплате', bold: true, alignment: 'right', fillColor: '#f9fafb', fontSize: 8 },
              { text: 'Комментарий', bold: true, fillColor: '#f9fafb', fontSize: 8 },
              { text: 'Отметка', bold: true, alignment: 'center', fillColor: '#f9fafb', fontSize: 8 },
            ],
            ...rows,
          ],
        },
        layout: {
          hLineWidth: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.3),
          hLineColor: (i: number) => (i <= 1 ? '#d1d5db' : '#e5e7eb'),
          vLineWidth: () => 0.3,
          vLineColor: () => '#e5e7eb',
          paddingLeft: () => 6,
          paddingRight: () => 6,
        },
        margin: [0, 0, 0, 14],
      },

      {
        columns: [
          { text: `Всего поставщиков: ${sheet.lines.length}`, fontSize: 10, color: '#555' },
          {
            stack: [
              { text: `Итого к выплате: ${curr(totalPlanned)}`, fontSize: 12, bold: true, color: '#047857', alignment: 'right' },
              ...(totalDebt !== totalPlanned ? [{ text: `Полный долг: ${curr(totalDebt)}`, fontSize: 9, color: '#888', alignment: 'right', margin: [0, 2, 0, 0] }] : []),
            ],
          },
        ],
        margin: [0, 0, 0, 30],
      },

      {
        columns: [
          { text: 'Выдал: ______________________', fontSize: 9, color: '#666' },
          { text: 'Получил: ______________________', fontSize: 9, color: '#666', alignment: 'right' },
        ],
        margin: [0, 0, 0, 20],
      },

      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }], margin: [0, 0, 0, 10] },
      {
        columns: [
          { text: 'MizanPay — платформа исламской рассрочки', fontSize: 8, color: '#aaa' },
          { text: 'Документ сформирован автоматически', fontSize: 8, color: '#aaa', alignment: 'right' },
        ],
      },
    ],
  }

  void LINE_LABELS
  if (opts.returnBlob) {
    return new Promise<Blob>((resolve) => pdfMake.createPdf(docDefinition).getBlob(resolve))
  }
  pdfMake.createPdf(docDefinition).open()
}
