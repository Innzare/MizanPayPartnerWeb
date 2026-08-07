// @ts-ignore
import pdfMake from 'pdfmake/build/pdfmake'
// @ts-ignore
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { ReportsSummary, ReportsDealsTable, PeriodRange } from '@/types/reports'

pdfMake.vfs = pdfFonts

const curr = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const dateStr = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

const STATUS: Record<string, string> = {
  ACTIVE: 'Активна',
  COMPLETED: 'Завершена',
  OVERDUE: 'Просрочена',
  DISPUTED: 'Спорная',
}

/** Строка «показатель → значение» для секций отчёта. */
function metricRow(label: string, value: string, bold = false) {
  return [
    { text: label, fontSize: 10, color: bold ? '#111827' : '#374151', bold, margin: [0, 3, 0, 3] },
    {
      text: value,
      fontSize: bold ? 11 : 10,
      bold: true,
      alignment: 'right',
      color: bold ? '#111827' : '#374151',
      margin: [0, 3, 0, 3],
    },
  ]
}

function sectionTitle(text: string) {
  return {
    text: text.toUpperCase(),
    fontSize: 8,
    bold: true,
    color: '#6b7280',
    characterSpacing: 0.6,
    margin: [0, 14, 0, 4],
  }
}

/**
 * PDF-отчёт за период: обложка, итоги по секциям и таблица сделок.
 *
 * Собирается на клиенте из уже загруженных данных — сервер не трогаем.
 * Таблица сделок печатается в альбомной ориентации: колонок много, в книжной
 * они бы схлопнулись в нечитаемую кашу.
 */
export function generateReportPdf(opts: {
  period: PeriodRange
  summary: ReportsSummary
  deals: ReportsDealsTable
  partnerName: string
  cashBoxName?: string | null
  statusLabel?: string | null
}) {
  const { period, summary, deals, partnerName, cashBoxName, statusLabel } = opts
  const c = summary.current
  const hasCi = c.ciProfitFact > 0 || c.ciProfitProjected > 0

  // ── Итоги: те же секции, что на экране ──
  const totalsBody: any[] = []
  const pushSection = (title: string, rows: [string, string, boolean?][]) => {
    totalsBody.push([{ text: '', colSpan: 2, border: [false, false, false, false] }, {}])
    totalsBody.push([
      { ...sectionTitle(title), colSpan: 2, border: [false, false, false, true], borderColor: ['', '', '', '#e5e7eb'] },
      {},
    ])
    for (const [l, v, b] of rows) totalsBody.push(metricRow(l, v, b))
  }

  pushSection(`Сделки · ${c.dealsCount}`, [
    ['Сумма всех сделок', curr(c.contractTotal)],
    ['Вложено в товар', curr(c.purchaseTotal)],
    ['Наценка по сделкам', curr(c.marginTotal)],
  ])
  pushSection('Деньги от клиентов', [
    ['Уже вернулось', curr(c.returned)],
    ['Осталось получить', curr(c.remaining)],
  ])

  if (hasCi) {
    pushSection('Доход по сделкам — до раздела с инвесторами', [
      ['Доход получен', curr(c.grossEarned)],
      ['Доход впереди', curr(c.grossLeft)],
      ['Всего дохода по сделкам', curr(c.grossEarned + c.grossLeft), true],
    ])
    pushSection('Доля инвесторов', [
      ['Уже начислено', curr(c.ciProfitFact)],
      ['Начислится впереди', curr(c.ciProfitProjected)],
      ['Всего инвесторам', curr(c.ciProfitFact + c.ciProfitProjected), true],
    ])
    pushSection('Ваш доход — после вычета доли инвесторов', [
      ['Ваш чистый доход', curr(c.earnedNet)],
      ['Ваш доход впереди', curr(c.profitLeft)],
      ['Всего ваш доход', curr(c.projectedNetTotal), true],
    ])
  } else {
    pushSection('Ваш доход', [
      ['Заработано', curr(c.earnedNet)],
      ['Ожидается дохода', curr(c.profitLeft)],
      ['Всего дохода по сделкам', curr(c.projectedNetTotal), true],
    ])
  }

  // ── Таблица сделок ──
  const head = ['Сделка', 'Клиент', 'Дата', 'Закупка', 'Цена', 'Пришло', 'Остаток', 'Платежи', 'Заработано', 'Будет всего', 'Статус']
  const dealRows = deals.rows.map((r) => [
    { text: r.productName, fontSize: 8 },
    { text: r.clientName, fontSize: 8 },
    { text: dateStr(r.dealDate), fontSize: 8, alignment: 'center' },
    { text: curr(r.cost), fontSize: 8, alignment: 'right' },
    { text: curr(r.totalPrice), fontSize: 8, alignment: 'right' },
    { text: curr(r.received), fontSize: 8, alignment: 'right' },
    { text: curr(r.remaining), fontSize: 8, alignment: 'right' },
    { text: `${r.paidCount}/${r.totalCount}`, fontSize: 8, alignment: 'center' },
    { text: curr(Math.max(0, r.netProfitReceived)), fontSize: 8, alignment: 'right', color: '#047857' },
    { text: curr(r.projectedNetProfitTotal), fontSize: 8, alignment: 'right', color: '#0369a1' },
    { text: STATUS[r.status] || r.status, fontSize: 8 },
  ])

  const t = deals.totals
  const totalsRow = [
    { text: `ИТОГО · ${t.count}`, fontSize: 8, bold: true },
    { text: '', fontSize: 8 },
    { text: '', fontSize: 8 },
    { text: curr(t.cost), fontSize: 8, bold: true, alignment: 'right' },
    { text: curr(t.totalPrice), fontSize: 8, bold: true, alignment: 'right' },
    { text: curr(t.received), fontSize: 8, bold: true, alignment: 'right' },
    { text: curr(t.remaining), fontSize: 8, bold: true, alignment: 'right' },
    { text: '', fontSize: 8 },
    { text: curr(Math.max(0, t.netProfit)), fontSize: 8, bold: true, alignment: 'right', color: '#047857' },
    { text: curr(t.projectedNetProfitTotal), fontSize: 8, bold: true, alignment: 'right', color: '#0369a1' },
    { text: '', fontSize: 8 },
  ]

  const scope = [
    cashBoxName ? `Касса: ${cashBoxName}` : 'Все кассы',
    statusLabel ? `Сделки: ${statusLabel}` : null,
  ].filter(Boolean).join('  ·  ')

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [36, 40, 36, 44],
    info: { title: `Отчёт — ${period.label}` },
    content: [
      // Обложка
      { text: 'Отчёт по сделкам', fontSize: 20, bold: true, color: '#111827' },
      { text: period.label, fontSize: 13, color: '#374151', margin: [0, 4, 0, 0] },
      { text: scope, fontSize: 9, color: '#6b7280', margin: [0, 6, 0, 0] },
      { text: partnerName, fontSize: 10, color: '#374151', margin: [0, 12, 0, 0] },
      {
        text: `Сформирован ${new Date().toLocaleDateString('ru-RU', {
          day: 'numeric', month: 'long', year: 'numeric',
        })}`,
        fontSize: 9, color: '#9ca3af', margin: [0, 2, 0, 0],
      },

      // Итоги
      {
        margin: [0, 16, 0, 0],
        table: { widths: ['*', 'auto'], body: totalsBody },
        layout: {
          hLineWidth: (i: number, node: any) => (node.table.body[i - 1]?.[0]?.border?.[3] ? 0.7 : 0),
          vLineWidth: () => 0,
          hLineColor: () => '#e5e7eb',
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
      },

      // Таблица сделок — в альбомной ориентации
      {
        text: 'Все сделки за период',
        fontSize: 13,
        bold: true,
        color: '#111827',
        pageBreak: 'before',
        pageOrientation: 'landscape',
        margin: [0, 0, 0, 8],
      },
      {
        table: {
          headerRows: 1, // шапка повторяется при переносе на новую страницу
          widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
          body: [
            head.map((h) => ({
              text: h, fontSize: 8, bold: true, color: '#6b7280',
              fillColor: '#f9fafb', margin: [0, 3, 0, 3],
            })),
            totalsRow.map((cell) => ({ ...cell, fillColor: '#ecfdf5' })),
            ...dealRows,
          ],
        },
        layout: {
          hLineWidth: (i: number) => (i <= 2 ? 0.8 : 0.4),
          vLineWidth: () => 0,
          hLineColor: (i: number) => (i <= 2 ? '#a7f3d0' : '#f0f0f0'),
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
    ],
    footer: (page: number, total: number) => ({
      columns: [
        { text: 'MizanPay', fontSize: 8, color: '#9ca3af', margin: [36, 0, 0, 0] },
        { text: `${page} / ${total}`, fontSize: 8, color: '#9ca3af', alignment: 'right', margin: [0, 0, 36, 0] },
      ],
      margin: [0, 12, 0, 0],
    }),
    defaultStyle: { font: 'Roboto' },
  }

  // Открываем в новой вкладке, а не скачиваем: пользователь сначала смотрит
  // отчёт и сам решает, сохранять его или печатать. Имя файла подставится из
  // info.title при сохранении из просмотрщика.
  pdfMake.createPdf(docDefinition).open()
}
