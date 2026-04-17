// @ts-ignore
import pdfMake from 'pdfmake/build/pdfmake'
// @ts-ignore
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { Deal, Payment, User } from '@/types'
import { formatDate } from './formatters'

pdfMake.vfs = pdfFonts

const INTERVAL_LABELS: Record<string, string> = {
  MONTHLY: 'ежемесячно',
  BIWEEKLY: 'раз в две недели',
  WEEKLY: 'еженедельно',
}

function curr(amount: number): string {
  return Math.round(amount).toLocaleString('ru-RU') + ' руб.'
}

function fullName(user: Partial<User>): string {
  const parts = [user.lastName, user.firstName, user.patronymic].filter(Boolean)
  return parts.join(' ') || 'Не указано'
}

export function generateContract(deal: Deal, payments: Payment[], investor: Partial<User>) {
  // Resolve client data: prefer clientProfile, fallback to legacy client, then external
  const cp = deal.clientProfile
  const client = cp
    ? { firstName: cp.firstName, lastName: cp.lastName, patronymic: cp.patronymic, phone: cp.phone, email: (cp as any).email }
    : deal.client
      ? deal.client
      : { firstName: deal.externalClientName || '', lastName: '', phone: deal.externalClientPhone || '' }
  const contractNumber = deal.id.slice(0, 8).toUpperCase()
  const today = formatDate(new Date().toISOString())

  const paymentRows = payments.map((p) => [
    { text: String(p.number), alignment: 'center' as const },
    { text: formatDate(p.dueDate), alignment: 'center' as const },
    { text: curr(p.amount), alignment: 'right' as const },
    { text: curr(p.remainingAfter), alignment: 'right' as const },
  ])

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [50, 50, 50, 50],
    defaultStyle: {
      fontSize: 11,
      lineHeight: 1.4,
    },
    content: [
      // Header
      {
        text: 'ДОГОВОР МУРАБАХА',
        style: 'header',
        alignment: 'center',
        margin: [0, 0, 0, 4],
      },
      {
        text: `№ ${contractNumber}`,
        alignment: 'center',
        fontSize: 13,
        color: '#555',
        margin: [0, 0, 0, 20],
      },
      {
        columns: [
          { text: `г. ${investor.city || client.city || '___________'}`, width: '*' },
          { text: today, alignment: 'right', width: 'auto' },
        ],
        margin: [0, 0, 0, 20],
      },

      // Parties
      {
        text: '1. СТОРОНЫ ДОГОВОРА',
        style: 'sectionTitle',
      },
      {
        text: [
          { text: 'Продавец (Инвестор): ', bold: true },
          `${fullName(investor)}, телефон: ${investor.phone || 'не указан'}`,
          investor.email ? `, email: ${investor.email}` : '',
          ', именуемый далее «Продавец», с одной стороны, и',
        ],
        margin: [0, 0, 0, 8],
      },
      {
        text: [
          { text: 'Покупатель (Клиент): ', bold: true },
          `${fullName(client)}, телефон: ${client.phone || 'не указан'}`,
          client.email ? `, email: ${client.email}` : '',
          ', именуемый далее «Покупатель», с другой стороны,',
        ],
        margin: [0, 0, 0, 8],
      },
      {
        text: 'совместно именуемые «Стороны», заключили настоящий Договор о нижеследующем:',
        margin: [0, 0, 0, 16],
      },

      // Subject
      {
        text: '2. ПРЕДМЕТ ДОГОВОРА',
        style: 'sectionTitle',
      },
      {
        text: `2.1. Продавец обязуется передать в собственность Покупателю товар: ${deal.productName} (далее — «Товар»), а Покупатель обязуется принять Товар и уплатить за него цену в порядке и на условиях, предусмотренных настоящим Договором.`,
        margin: [0, 0, 0, 8],
      },
      {
        text: '2.2. Настоящий Договор является договором купли-продажи с рассрочкой платежа (мурабаха) и заключён в соответствии с принципами исламского финансирования.',
        margin: [0, 0, 0, 16],
      },

      // Financial terms
      {
        text: '3. ЦЕНА И ПОРЯДОК РАСЧЁТОВ',
        style: 'sectionTitle',
      },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            [
              { text: 'Закупочная цена товара (себестоимость)', border: [false, false, false, true] },
              { text: curr(deal.purchasePrice), bold: true, alignment: 'right', border: [false, false, false, true] },
            ],
            [
              { text: `Наценка продавца (${deal.markupPercent}%)`, border: [false, false, false, true] },
              { text: curr(deal.markup), alignment: 'right', border: [false, false, false, true] },
            ],
            [
              { text: 'Итоговая цена (цена продажи)', border: [false, false, false, false], bold: true },
              { text: curr(deal.totalPrice), bold: true, alignment: 'right', border: [false, false, false, false], fontSize: 12 },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          hLineColor: () => '#ddd',
          vLineWidth: () => 0,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        margin: [0, 0, 0, 12],
      },
      {
        text: `3.1. Итоговая сумма в размере ${curr(deal.totalPrice)} выплачивается равными платежами ${INTERVAL_LABELS[deal.paymentInterval] || 'ежемесячно'} в количестве ${deal.numberOfPayments} платежей согласно Графику платежей (Приложение №1).`,
        margin: [0, 0, 0, 8],
      },
      {
        text: '3.3. Наценка Продавца является фиксированной и не подлежит изменению в течение срока действия Договора. Начисление процентов (рибы) не допускается.',
        margin: [0, 0, 0, 16],
      },

      // Obligations
      {
        text: '4. ОБЯЗАННОСТИ СТОРОН',
        style: 'sectionTitle',
      },
      {
        text: '4.1. Продавец обязуется:',
        bold: true,
        margin: [0, 0, 0, 4],
      },
      {
        ul: [
          'Приобрести Товар за собственные средства и обеспечить его надлежащее качество;',
          'Передать Товар Покупателю в согласованный срок;',
          'Предоставить документы, подтверждающие покупку Товара.',
        ],
        margin: [0, 0, 0, 12],
      },
      {
        text: '4.2. Покупатель обязуется:',
        bold: true,
        margin: [0, 0, 0, 4],
      },
      {
        ul: [
          'Принять Товар и подписать акт приёма-передачи;',
          'Своевременно вносить платежи согласно Графику;',
          'Уведомить Продавца о невозможности внесения платежа не менее чем за 3 дня до даты платежа.',
        ],
        margin: [0, 0, 0, 16],
      },

      // Dispute resolution
      {
        text: '5. ОТВЕТСТВЕННОСТЬ И РАЗРЕШЕНИЕ СПОРОВ',
        style: 'sectionTitle',
      },
      {
        text: '5.1. В случае просрочки платежа Покупатель обязуется уведомить Продавца и согласовать новый срок оплаты. Штрафные проценты не начисляются (в соответствии с принципами исламского финансирования).',
        margin: [0, 0, 0, 8],
      },
      {
        text: '5.2. Споры решаются путём переговоров. При недостижении согласия — в порядке, установленном действующим законодательством РФ.',
        margin: [0, 0, 0, 16],
      },

      // Final
      {
        text: '6. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ',
        style: 'sectionTitle',
      },
      {
        text: '6.1. Договор вступает в силу с момента его подписания обеими Сторонами и действует до полного исполнения обязательств.',
        margin: [0, 0, 0, 8],
      },
      {
        text: '6.2. Договор составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному для каждой из Сторон.',
        margin: [0, 0, 0, 24],
      },

      // Signatures
      {
        text: '7. ПОДПИСИ СТОРОН',
        style: 'sectionTitle',
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Продавец:', bold: true, margin: [0, 0, 0, 8] },
              { text: fullName(investor), margin: [0, 0, 0, 4] },
              { text: `Тел.: ${investor.phone || '___________'}`, margin: [0, 0, 0, 20] },
              { text: '_________________________', color: '#999' },
              { text: '(подпись)', fontSize: 9, color: '#999', margin: [0, 2, 0, 0] },
            ],
          },
          {
            width: '*',
            stack: [
              { text: 'Покупатель:', bold: true, margin: [0, 0, 0, 8] },
              { text: fullName(client), margin: [0, 0, 0, 4] },
              { text: `Тел.: ${client.phone || '___________'}`, margin: [0, 0, 0, 20] },
              { text: '_________________________', color: '#999' },
              { text: '(подпись)', fontSize: 9, color: '#999', margin: [0, 2, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 30],
      },

      // Payment schedule (Appendix)
      { text: '', pageBreak: 'before' },
      {
        text: 'ПРИЛОЖЕНИЕ №1',
        alignment: 'center',
        fontSize: 12,
        color: '#555',
        margin: [0, 0, 0, 4],
      },
      {
        text: `ГРАФИК ПЛАТЕЖЕЙ К ДОГОВОРУ № ${contractNumber}`,
        alignment: 'center',
        bold: true,
        fontSize: 13,
        margin: [0, 0, 0, 20],
      },
      {
        table: {
          headerRows: 1,
          widths: [40, '*', 'auto', 'auto'],
          body: [
            [
              { text: '№', bold: true, alignment: 'center', fillColor: '#f5f5f5' },
              { text: 'Дата платежа', bold: true, alignment: 'center', fillColor: '#f5f5f5' },
              { text: 'Сумма', bold: true, alignment: 'right', fillColor: '#f5f5f5' },
              { text: 'Остаток после', bold: true, alignment: 'right', fillColor: '#f5f5f5' },
            ],
            ...paymentRows,
          ],
        },
        layout: {
          hLineWidth: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.5,
          hLineColor: (i: number) => i <= 1 ? '#999' : '#ddd',
          vLineWidth: () => 0.5,
          vLineColor: () => '#ddd',
          paddingTop: () => 6,
          paddingBottom: () => 6,
          paddingLeft: () => 8,
          paddingRight: () => 8,
        },
        margin: [0, 0, 0, 24],
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Продавец: _________________________', margin: [0, 0, 0, 4] },
              { text: fullName(investor), fontSize: 10, color: '#555' },
            ],
          },
          {
            width: '*',
            stack: [
              { text: 'Покупатель: _________________________', margin: [0, 0, 0, 4] },
              { text: fullName(client), fontSize: 10, color: '#555' },
            ],
          },
        ],
      },
    ],
    styles: {
      header: {
        fontSize: 18,
        bold: true,
      },
      sectionTitle: {
        fontSize: 12,
        bold: true,
        margin: [0, 0, 0, 10] as [number, number, number, number],
        color: '#333',
      },
    },
  }

  pdfMake.createPdf(docDefinition).open()
}