// @ts-ignore
import pdfMake from 'pdfmake/build/pdfmake'
import { exportReceiptTemplatePdf } from './receiptTemplatePdf'
// @ts-ignore
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { Deal, Payment, User } from '@/types'
import { formatDate } from './formatters'

pdfMake.vfs = pdfFonts

function curr(amount: number | null | undefined): string {
  // Пустое значение печатаем прочерком, а не «NaN руб.»: квитанцию отдают
  // клиенту, и такая строка выглядит как поломка сервиса.
  if (amount == null || !Number.isFinite(amount)) return '—'
  return Math.round(amount).toLocaleString('ru-RU') + ' руб.'
}

function fullName(obj: any): string {
  const parts = [obj?.lastName, obj?.firstName, obj?.patronymic].filter(Boolean)
  return parts.join(' ') || 'Не указано'
}

/**
 * Бланк квитанции — то, как партнёр настроил свой документ.
 *
 * Не передан — печатается стандартный вид, ровно как до появления настройки.
 */
export interface ReceiptTemplate {
  companyName?: string
  phone?: string
  address?: string
  site?: string
  requisites?: string
  inn?: string
  blocks?: string[]
  footerText?: string
  showSignature?: boolean
  accentColor?: string
  fontSize?: number
  /**
   * Свой бланк, собранный в конструкторе.
   *
   * Пусто — печатается стандартная квитанция (её вид у всех партнёров один и
   * меняться не должен). Заполнено — печатаем разметку партнёра тем же путём,
   * что и договор.
   */
  html?: string | null
  htmlMargins?: { top: number; bottom: number; left: number; right: number } | null
}

/** Стандартный бланк: им пользуются все, кто ничего не настраивал. */
const DEFAULT_TEMPLATE: Required<Pick<ReceiptTemplate, 'blocks' | 'showSignature' | 'accentColor' | 'fontSize'>> = {
  blocks: ['contract', 'payment', 'summary'],
  showSignature: true,
  accentColor: '#047857',
  fontSize: 10,
}

export function generateReceipt(
  deal: Deal,
  payment: Payment,
  investor: Partial<User>,
  opts: { returnBlob?: boolean; template?: ReceiptTemplate | null } = {},
): Promise<Blob> | void {
  const tpl = { ...DEFAULT_TEMPLATE, ...(opts.template ?? {}) }

  // Партнёр собрал свой бланк — печатаем его. Стандартный остаётся у всех
  // остальных ровно таким, каким был.
  const customHtml = opts.template?.html
  if (customHtml && String(customHtml).trim()) {
    return exportReceiptTemplatePdf(
      String(customHtml),
      deal,
      payment,
      (deal.payments as Payment[]) ?? [payment],
      investor,
      {
        companyName: opts.template?.companyName,
        phone: opts.template?.phone,
        address: opts.template?.address,
        requisites: opts.template?.requisites,
        inn: opts.template?.inn,
      },
      opts.template?.htmlMargins ?? undefined,
      { returnBlob: opts.returnBlob },
    ) as Promise<Blob> | void
  }
  const has = (block: string) => tpl.blocks.includes(block)
  const accent = tpl.accentColor || DEFAULT_TEMPLATE.accentColor
  /**
   * Партнёр без настроенного бланка обязан получить в точности прежний
   * документ — вплоть до цвета заголовка. Любое «улучшение» здесь означает,
   * что у сотен партнёров молча изменился документ, который они отдают людям.
   */
  const custom = !!opts.template
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
    defaultStyle: { fontSize: tpl.fontSize, lineHeight: 1.3 },
    content: [
      // Шапка партнёра: название, телефон, адрес — то, по чему клиент найдёт,
      // куда идти с вопросами. Печатается, только если партнёр её заполнил.
      ...(tpl.companyName || tpl.phone || tpl.address || tpl.site
        ? [
            {
              columns: [
                {
                  width: '*',
                  stack: [
                    ...(tpl.companyName
                      ? [{ text: tpl.companyName, bold: true, fontSize: tpl.fontSize + 2, color: accent }]
                      : []),
                    ...(tpl.inn ? [{ text: `ИНН ${tpl.inn}`, fontSize: tpl.fontSize - 2, color: '#777' }] : []),
                  ],
                },
                {
                  // Доля, а не 'auto': длинная строка без пробелов при 'auto'
                  // не переносится и уезжает за край листа.
                  width: '40%',
                  alignment: 'right',
                  stack: [
                    ...(tpl.phone ? [{ text: tpl.phone, fontSize: tpl.fontSize - 1 }] : []),
                    ...(tpl.address
                      ? [{ text: tpl.address, fontSize: tpl.fontSize - 2, color: '#777' }]
                      : []),
                    ...(tpl.site ? [{ text: tpl.site, fontSize: tpl.fontSize - 2, color: '#777' }] : []),
                  ],
                },
              ],
              margin: [0, 0, 0, 6],
            },
            {
              canvas: [
                { type: 'line', x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 0.7, lineColor: accent },
              ],
              margin: [0, 0, 0, 14],
            },
          ]
        : []),

      // Header
      {
        text: 'КВИТАНЦИЯ ОБ ОПЛАТЕ',
        alignment: 'center',
        fontSize: tpl.fontSize + 6,
        bold: true,
        ...(custom ? { color: accent } : {}),
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

      // Данные договора: кто, что и по какому договору. Блок необязательный —
      // при оплате в мессенджере клиенту важнее сумма и остаток.
      ...(has('contract') ? [
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
      ] : []),

      // Данные платежа: какой по счёту, срок и сумма.
      ...(has('payment') ? [
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
              { text: curr(payment.amount), alignment: 'right', bold: true, fontSize: tpl.fontSize + 2, color: accent, border: [false, false, false, false] },
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
      ] : []),

      // Сводка по договору — блок необязательный: партнёру бывает нужнее
      // короткая квитанция без итогов по всей сделке.
      ...(has('summary') ? [
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
      ] : []),

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

      // Реквизиты для перевода — то, о чём клиенты спрашивают чаще всего.
      ...(has('requisites') && tpl.requisites
        ? [
            {
              table: {
                widths: ['*'],
                body: [
                  [
                    {
                      stack: [
                        { text: 'РЕКВИЗИТЫ ДЛЯ ОПЛАТЫ', fontSize: tpl.fontSize - 2, color: accent, bold: true, margin: [0, 0, 0, 4] },
                        { text: tpl.requisites, fontSize: tpl.fontSize - 1 },
                      ],
                      border: [false, false, false, false],
                      fillColor: '#f7f7f7',
                      margin: [8, 6, 8, 6],
                    },
                  ],
                ],
              },
              layout: 'noBorders',
              margin: [0, 0, 0, 16],
            },
          ]
        : []),

      // Подписи. Партнёр может их отключить: квитанцию часто просто отдают в
      // руки или отправляют в мессенджер, и пустые линии там ни к чему.
      ...(tpl.showSignature
        ? [
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
          ]
        : []),

      // Своя строка внизу: благодарность, режим работы, что угодно.
      ...(tpl.footerText
        ? [
            {
              text: tpl.footerText,
              fontSize: tpl.fontSize - 2,
              color: '#777',
              alignment: 'center',
              margin: [0, 18, 0, 0],
            },
          ]
        : []),
    ],
  }

  if (opts.returnBlob) {
    return new Promise<Blob>((resolve) => pdfMake.createPdf(docDefinition).getBlob(resolve))
  }
  pdfMake.createPdf(docDefinition).open()
}
