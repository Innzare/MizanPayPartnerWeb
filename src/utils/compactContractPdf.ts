// @ts-ignore
import pdfMake from 'pdfmake/build/pdfmake'
// @ts-ignore
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { Deal, Payment, User } from '@/types'

pdfMake.vfs = pdfFonts

function curr(amount: number): string {
  return Math.round(amount).toLocaleString('ru-RU') + 'р'
}

function fullName(obj: any): string {
  const parts = [obj?.lastName, obj?.firstName, obj?.patronymic].filter(Boolean)
  return parts.join('  ') || '_______________'
}

function pad(n: number): string { return String(n).padStart(2, '0') }

function line(label: string, value: string, underline = true): any {
  return {
    columns: [
      { text: label, width: 'auto', fontSize: 10 },
      underline
        ? { text: value || '________________', decoration: 'underline', fontSize: 10, margin: [4, 0, 0, 0] }
        : { text: value, fontSize: 10, margin: [4, 0, 0, 0] },
    ],
    margin: [0, 0, 0, 3],
  }
}

function blankField(width = 80): string {
  return '_'.repeat(Math.ceil(width / 6))
}

export function generateCompactContract(deal: Deal, payments: Payment[], investor: Partial<User>) {
  const cp = deal.clientProfile
  const client: any = cp
    ? { firstName: cp.firstName, lastName: cp.lastName, patronymic: cp.patronymic, phone: cp.phone, passportSeries: cp.passportSeries, passportNumber: cp.passportNumber, passportIssuedAt: cp.passportIssuedAt, registrationAddress: (cp as any).registrationAddress, city: (cp as any).city }
    : deal.client
      ? deal.client
      : { firstName: deal.externalClientName || '', lastName: '', phone: deal.externalClientPhone || '' }

  const guarantor: any = deal.guarantorProfile
    ? { firstName: deal.guarantorProfile.firstName, lastName: deal.guarantorProfile.lastName, patronymic: deal.guarantorProfile.patronymic, phone: deal.guarantorProfile.phone }
    : null

  const dealDate = new Date(deal.dealDate || deal.createdAt)
  const downPayment = deal.downPayment || 0
  const remaining = deal.totalPrice - downPayment

  // Investor birth date placeholder
  const investorBirth = `дата рож. ${blankField(20)}`

  // Client birth date placeholder
  const clientBirth = `дата рож. ${blankField(20)}`

  // Passport
  const passportSer = client.passportSeries || blankField(12)
  const passportNum = client.passportNumber || blankField(15)
  const passportDate = client.passportIssuedAt
    ? (() => { const d = new Date(client.passportIssuedAt); return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}` })()
    : blankField(15)

  // Address
  const address = client.registrationAddress || client.city || investor.city || blankField(40)

  // Schedule rows: "1. 5  05  2026г  4.900р"
  const scheduleLines: any[] = payments.map((p, i) => {
    const d = new Date(p.dueDate)
    return {
      text: `${i + 1}.  ${d.getDate()}  .  ${pad(d.getMonth() + 1)}  .  ${d.getFullYear()}г    ${curr(p.amount)}`,
      fontSize: 10,
      margin: [20, 0, 0, 2],
    }
  })

  // Add footer labels under last payment
  scheduleLines.push({
    text: '     число    месяц     год            сумма',
    fontSize: 8,
    color: '#888',
    margin: [20, 0, 0, 0],
  })

  const content: any[] = [
    // ─── HEADER ───
    // Продавец line
    {
      text: [
        { text: 'Продавец:  ', bold: true },
        { text: `${investor.lastName || blankField(15)}`, decoration: 'underline' },
        '    ',
        { text: `${investor.firstName || blankField(15)}`, decoration: 'underline' },
        '    ',
        { text: `${investor.patronymic || blankField(15)}`, decoration: 'underline' },
        '    ',
        investorBirth,
      ],
      fontSize: 10,
      margin: [0, 0, 0, 5],
    },

    // Покупатель line
    {
      text: [
        { text: 'Покупатель:  ', bold: true },
        { text: `${client.lastName || blankField(15)}`, decoration: 'underline' },
        '    ',
        { text: `${client.firstName || blankField(15)}`, decoration: 'underline' },
        '    ',
        { text: `${client.patronymic || blankField(15)}`, decoration: 'underline' },
        '    ',
        clientBirth,
      ],
      fontSize: 10,
      margin: [0, 0, 0, 5],
    },

    // Паспорт line
    {
      text: [
        { text: 'Паспорт: ', bold: true },
        'сер ',
        { text: passportSer, decoration: 'underline' },
        '    ',
        { text: passportNum, decoration: 'underline' },
        '       дата выдачи ',
        { text: passportDate, decoration: 'underline' },
      ],
      fontSize: 10,
      margin: [0, 0, 0, 5],
    },

    // Адрес line
    {
      text: [
        { text: 'Проживающий(ая): ', bold: true },
        { text: address, decoration: 'underline' },
      ],
      fontSize: 10,
      margin: [0, 0, 0, 12],
    },

    // ─── SEPARATOR ───
    { canvas: [{ type: 'line', x1: 170, y1: 0, x2: 345, y2: 0, lineWidth: 0.5 }], margin: [0, 0, 0, 6] },

    // Заключили договор на N месяцев
    {
      text: `Заключили договор на  ${deal.numberOfPayments}  месяцев`,
      alignment: 'center',
      fontSize: 11,
      margin: [0, 0, 0, 10],
    },

    // ─── LEGAL TEXT ───
    {
      text: 'По настоящему договору Покупатель обязуется принять и оплатить, а Продавец обязуется передать в собственность покупателю следующее:',
      fontSize: 9,
      margin: [0, 0, 0, 10],
    },

    // ─── PRODUCT NAME (BIG, CENTERED) ───
    {
      text: deal.productName.toUpperCase(),
      alignment: 'center',
      fontSize: 14,
      bold: true,
      margin: [0, 6, 0, 14],
    },

    // ─── PRICE TEXT ───
    {
      text: [
        `Цена товара в рассрочку `,
        { text: downPayment > 0 ? `С ПЕРВЫМ ВЗНОСОМ` : 'БЕЗ ПЕРВОГО ВЗНОСА', bold: true },
        ` на ${deal.numberOfPayments} месяцев определяется Продавцом и Покупателем и`,
      ],
      fontSize: 9,
      margin: [0, 0, 0, 2],
    },
    {
      text: [
        'составляет  ',
        { text: `${curr(deal.totalPrice)}`, decoration: 'underline', bold: true },
        '    первый взнос  ',
        { text: downPayment > 0 ? curr(downPayment) : '0', decoration: 'underline', bold: true },
        '    остаток суммы  ',
        { text: `${curr(remaining)}`, decoration: 'underline', bold: true },
      ],
      fontSize: 9,
      margin: [0, 0, 0, 10],
    },

    // ─── PAYMENT SCHEDULE ───
    ...scheduleLines,

    { text: '', margin: [0, 0, 0, 10] },

    // ─── WARNING BOX ───
    {
      table: {
        widths: ['*'],
        body: [[{
          text: 'В случае просрочки платежей указанных в п.1 настоящего договора, Продавец оставляет за собой право взыскания имущества Покупателя и Поручителя соответствующей в равной мере стоимости задолженности Покупателя и Поручителя и расходов связанных с осуществлением возврата долга.',
          fontSize: 8,
          margin: [4, 4, 4, 4],
        }]],
      },
      layout: {
        hLineWidth: () => 1,
        vLineWidth: () => 1,
        hLineColor: () => '#000',
        vLineColor: () => '#000',
      },
      margin: [0, 0, 0, 16],
    },

    // ─── SIGNATURES ───
    {
      columns: [
        // Left: Продавец
        {
          width: '45%',
          stack: [
            { text: [{ text: 'Продавец:', bold: true }], fontSize: 9, margin: [0, 0, 0, 6] },
            { text: fullName(investor), fontSize: 9, margin: [0, 0, 0, 4] },
            { text: `Тел: ${investor.phone || blankField(15)}`, fontSize: 9, margin: [0, 0, 0, 16] },
            { text: `Подпись: ${blankField(20)}`, fontSize: 9 },
          ],
        },
        // Right: Покупатель + Поручитель
        {
          width: '55%',
          stack: [
            { text: [{ text: 'Покупатель:', bold: true }], fontSize: 9, margin: [0, 0, 0, 6] },
            { text: `Тел: Покупателя: ${client.phone || blankField(12)}`, fontSize: 9, margin: [0, 0, 0, 4] },
            { text: `Тел: Поручителя: ${guarantor?.phone || blankField(12)}`, fontSize: 9, margin: [0, 0, 0, 4] },
            { text: `Тел: Родственник: ${blankField(12)}`, fontSize: 9, margin: [0, 0, 0, 12] },
            {
              columns: [
                { text: `Подпись: Покупателя: ${blankField(10)}`, fontSize: 9, width: 'auto' },
              ],
              margin: [0, 0, 0, 8],
            },
            { text: `Поручитель: ${guarantor ? fullName(guarantor) : blankField(20)}`, fontSize: 9, margin: [0, 0, 0, 4] },
            { text: `Подпись: Поручителя: ${blankField(10)}`, fontSize: 9 },
          ],
        },
      ],
    },
  ]

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 30, 40, 30],
    defaultStyle: { fontSize: 10, lineHeight: 1.2 },
    content,
  }

  pdfMake.createPdf(docDefinition).open()
}
