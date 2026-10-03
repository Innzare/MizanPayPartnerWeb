import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { Deal, Payment, User } from '@/types'
import { formatDate } from './formatters'
import { dealGuarantors } from './dealGuarantors'

function curr(amount: number): string {
  return Math.round(amount).toLocaleString('ru-RU') + ' ₽'
}

function fullName(obj: any): string {
  const parts = [obj?.lastName, obj?.firstName, obj?.patronymic].filter(Boolean)
  return parts.join(' ') || '_______________'
}

function pad(n: number): string { return String(n).padStart(2, '0') }

function buildPaymentTable(payments: Payment[]): string {
  const rows = payments.map(p => {
    const d = new Date(p.dueDate)
    return `<tr>
      <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: center;">${p.number}</td>
      <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: center;">${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}</td>
      <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: right;">${curr(p.amount)}</td>
    </tr>`
  }).join('')

  return `<table style="width: 100%; border-collapse: collapse; margin: 8px 0;">
    <thead>
      <tr style="background: #f5f5f5;">
        <th style="padding: 6px 8px; text-align: center; font-size: 0.85em;">№</th>
        <th style="padding: 6px 8px; text-align: center; font-size: 0.85em;">Дата</th>
        <th style="padding: 6px 8px; text-align: right; font-size: 0.85em;">Сумма</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
}

export function replaceVariables(html: string, deal: Deal, payments: Payment[], investor: Partial<User>): string {
  const cp = deal.clientProfile
  const client: any = cp
    ? { firstName: cp.firstName, lastName: cp.lastName, patronymic: cp.patronymic, phone: cp.phone, passportSeries: cp.passportSeries, passportNumber: cp.passportNumber, passportIssuedAt: cp.passportIssuedAt, birthDate: (cp as any).birthDate, registrationAddress: (cp as any).registrationAddress, city: (cp as any).city }
    : deal.client || { firstName: deal.externalClientName || '', lastName: '', phone: deal.externalClientPhone || '' }

  // Все поручители сделки (по порядку). Основной (первый) остаётся в одиночных
  // плейсхолдерах для совместимости со старыми шаблонами; полный список
  // выводится через {{поручители}} / {{телефоны_поручителей}} / {{поручители_блок}}.
  const guarantors = dealGuarantors(deal)
  const guarantor = guarantors[0]

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // HTML-блок «Поручители»: ФИО, телефон, паспорт и адрес каждого. Пусто, если
  // поручителей нет, — плейсхолдер разворачивается в пустую строку.
  const guarantorsBlock = guarantors.length
    ? guarantors.map((g, i) => {
        const passport = [g.passportSeries, g.passportNumber].filter(Boolean).join(' ')
        const addr = g.registrationAddress || (g as any).residentialAddress || ''
        const lines = [
          `<strong>Поручитель ${i + 1}:</strong> ${escapeHtml(fullName(g))}`,
          g.phone ? `Тел.: ${escapeHtml(g.phone)}` : '',
          passport ? `Паспорт: ${escapeHtml(passport)}` : '',
          addr ? `Адрес: ${escapeHtml(addr)}` : '',
        ].filter(Boolean)
        return `<p style="margin: 0 0 6px;">${lines.join('<br/>')}</p>`
      }).join('')
    : ''

  const vars: Record<string, string> = {
    '{{продавец}}': fullName(investor),
    '{{телефон_продавца}}': investor.phone || '___________',
    '{{дата_рождения_продавца}}': (investor as any).birthDate ? formatDate(String((investor as any).birthDate)) : '__.__.____',
    '{{покупатель}}': fullName(client),
    '{{телефон_покупателя}}': client.phone || '___________',
    '{{дата_рождения_покупателя}}': client.birthDate ? formatDate(client.birthDate) : '__.__.____',
    '{{паспорт_серия}}': client.passportSeries || '________',
    '{{паспорт_номер}}': client.passportNumber || '____________',
    '{{паспорт_дата}}': client.passportIssuedAt ? formatDate(client.passportIssuedAt) : '__________',
    '{{адрес}}': client.registrationAddress || client.city || investor.city || '________________________________',
    '{{поручитель}}': guarantor ? fullName(guarantor) : '_______________',
    '{{телефон_поручителя}}': guarantor?.phone || '___________',
    // Все поручители: ФИО через запятую / телефоны через запятую / полный блок.
    '{{поручители}}': guarantors.length ? guarantors.map(fullName).join(', ') : '_______________',
    '{{телефоны_поручителей}}': guarantors.length ? guarantors.map((g) => g.phone || '___________').join(', ') : '___________',
    '{{поручители_блок}}': guarantorsBlock,
    '{{товар}}': deal.productName,
    '{{цена}}': curr(deal.totalPrice),
    '{{закупочная_цена}}': curr(deal.purchasePrice),
    '{{наценка}}': curr(deal.markup),
    '{{наценка_процент}}': String(deal.markupPercent),
    '{{взнос}}': deal.downPayment ? curr(deal.downPayment) : 'без взноса',
    '{{остаток}}': curr(deal.totalPrice - (deal.downPayment || 0)),
    '{{срок}}': String(deal.numberOfPayments),
    '{{номер_договора}}': deal.id.slice(0, 8).toUpperCase(),
    '{{дата_договора}}': formatDate(deal.dealDate || deal.createdAt),
    '{{график_платежей}}': buildPaymentTable(payments),
  }

  let result = html

  // Clean HTML tags around/inside {{ }} that TipTap inserts
  result = result.replace(/\{(<[^>]*>)*\{/g, '{{')
  result = result.replace(/\}(<[^>]*>)*\}/g, '}}')
  result = result.replace(/\{\{([^}]*?(<[^>]*>)[^}]*?)\}\}/g, (match) => {
    return match.replace(/<[^>]*>/g, '')
  })

  // Replace variables
  result = result.replace(/\{\{([^}]+)\}\}/g, (_match, name) => {
    const key = `{{${name.trim()}}}`
    return vars[key] !== undefined ? vars[key] : _match
  })

  return result
}

// A4 dimensions in pt: 595.28 x 841.89
/**
 * Где можно перевернуть страницу — в пикселях разметки от верха контейнера.
 *
 * PDF собирается из одной длинной картинки, нарезанной на листы. Раньше лист
 * обрывался ровно по высоте страницы — посреди строки таблицы или посреди
 * абзаца, и половина строки уезжала на следующую страницу. Теперь разрыв
 * ставится по верхнему краю ближайшего блока: строки таблицы, абзаца, пункта
 * списка, заголовка, картинки.
 *
 * Два исключения:
 *  - блоки внутри ячейки таблицы — их край лежит посреди строки, разрыв там
 *    снова разрезал бы строку пополам;
 *  - блок сразу после заголовка — иначе заголовок остался бы последней
 *    строкой страницы, оторванным от своего текста (разрыв уйдёт выше, перед
 *    самим заголовком).
 */
function pageBreakCandidates(container: HTMLElement): number[] {
  const top0 = container.getBoundingClientRect().top
  const out = new Set<number>()
  const blocks = container.querySelectorAll<HTMLElement>(
    'p, li, tr, h1, h2, h3, h4, h5, h6, img, hr, blockquote, table, div[data-bordered]',
  )
  blocks.forEach((el) => {
    if (el.tagName !== 'TR' && el.closest('td, th')) return
    const prev = el.previousElementSibling
    if (prev && /^H[1-6]$/.test(prev.tagName)) return
    const y = Math.round(el.getBoundingClientRect().top - top0)
    if (y > 0) out.add(y)
  })
  return [...out].sort((a, b) => a - b)
}

const A4_WIDTH_PT = 595.28
const A4_HEIGHT_PT = 841.89
const PX_PER_MM = 3.78
const SCALE = 2

export async function exportTemplatePdf(
  html: string,
  deal: Deal,
  payments: Payment[],
  investor: Partial<User>,
  margins?: { top: number; bottom: number; left: number; right: number },
  opts: { returnBlob?: boolean } = {},
): Promise<Blob | void> {
  const m = margins || { top: 20, bottom: 20, left: 25, right: 15 }
  const finalHtml = replaceVariables(html, deal, payments, investor)

  // Calculate content area in px
  const marginTopPx = Math.round(m.top * PX_PER_MM)
  const marginBottomPx = Math.round(m.bottom * PX_PER_MM)
  const marginLeftPx = Math.round(m.left * PX_PER_MM)
  const marginRightPx = Math.round(m.right * PX_PER_MM)
  const pageWidthPx = Math.round(210 * PX_PER_MM) // A4 = 210mm
  const contentWidthPx = pageWidthPx - marginLeftPx - marginRightPx

  // Create hidden container
  const container = document.createElement('div')
  container.style.cssText = `position: fixed; left: -9999px; top: 0; width: ${contentWidthPx}px; padding: 0; background: white; font-family: 'Times New Roman', Times, serif; font-size: 13px; line-height: 1.5; color: #000;`

  const style = document.createElement('style')
  style.textContent = `
    * { box-sizing: border-box; }
    h1 { font-size: 20px; margin: 0 0 10px; }
    h2 { font-size: 16px; margin: 10px 0 6px; }
    h3 { font-size: 14px; margin: 10px 0 4px; }
    p { margin: 0 0 6px; }
    p:empty::after { content: "\\00a0"; }
    hr { border: none; border-top: 1px solid #999; margin: 10px 0; }
    table { border-collapse: collapse; width: 100%; }
    td, th { vertical-align: top; }
    ul, ol { margin: 4px 0; padding-left: 20px; }
    li { margin-bottom: 2px; }
    /* Размеры/отступы/оформление картинки приходят inline-стилями из
       конструктора — здесь только страховка, чтобы ничего не вылезло за поля. */
    img { max-width: 100%; }
    /* Картинка с обтеканием — float: без clearfix контейнер схлопнется и
       html2canvas обрежет её по нижнему краю. */
    .tpl-root::after { content: ''; display: block; clear: both; }
    div[data-bordered] { border: 1px solid #000; padding: 10px 14px; margin: 8px 0; }
    mark { background: #fef08a; padding: 1px 2px; }
  `
  container.appendChild(style)

  const content = document.createElement('div')
  content.className = 'tpl-root'
  content.innerHTML = finalHtml
  container.appendChild(content)
  document.body.appendChild(container)

  try {
    // Места разрыва снимаем с живой разметки, пока контейнер в документе.
    const breaksCss = pageBreakCandidates(container)
    const containerHeightCss = container.getBoundingClientRect().height

    const canvas = await html2canvas(container, {
      scale: SCALE,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: contentWidthPx,
    })
    // Пиксели разметки → пиксели картинки.
    const cssToCanvas = containerHeightCss > 0 ? canvas.height / containerHeightCss : SCALE
    const breaks = breaksCss.map((y) => Math.floor(y * cssToCanvas))

    const pdf = new jsPDF('p', 'pt', 'a4')

    // Content area on PDF page (in pt)
    const marginTopPt = m.top * 2.835
    const marginLeftPt = m.left * 2.835
    const contentWidthPt = A4_WIDTH_PT - (m.left + m.right) * 2.835
    const contentHeightPt = A4_HEIGHT_PT - (m.top + m.bottom) * 2.835

    // Scale canvas to fit content area
    const imgWidthPt = contentWidthPt
    const imgHeightPt = (canvas.height / canvas.width) * imgWidthPt

    // How much of the image fits on one page (in image pixels)
    const pageContentHeightPx = (contentHeightPt / imgWidthPt) * canvas.width

    let yOffset = 0
    let pageNum = 0

    while (yOffset < canvas.height) {
      if (pageNum > 0) pdf.addPage()

      // Конец листа — по ближайшему месту разрыва не ниже края страницы. Если
      // в нижней половине листа такого места нет (огромная картинка или
      // таблица в одну строку), режем по краю, как раньше: пустая полстраницы
      // хуже обрезанного края.
      const limit = yOffset + pageContentHeightPx
      let cut = limit
      if (limit < canvas.height) {
        const minCut = yOffset + pageContentHeightPx * 0.5
        for (let i = breaks.length - 1; i >= 0; i--) {
          const b = breaks[i]!
          if (b <= limit && b > minCut) { cut = b; break }
          if (b <= minCut) break
        }
      }
      const sliceHeight = Math.min(cut, canvas.height) - yOffset

      // Create canvas slice for this page
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = Math.ceil(sliceHeight)
      const ctx = pageCanvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      ctx.drawImage(canvas, 0, yOffset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight)

      const sliceHeightPt = (sliceHeight / canvas.width) * imgWidthPt
      const imgData = pageCanvas.toDataURL('image/jpeg', 0.95)
      pdf.addImage(imgData, 'JPEG', marginLeftPt, marginTopPt, imgWidthPt, sliceHeightPt)

      yOffset = cut
      pageNum++
    }

    if (opts.returnBlob) {
      return pdf.output('blob') as Blob
    }
    const blobUrl = pdf.output('bloburl')
    window.open(blobUrl as unknown as string, '_blank')
  } finally {
    document.body.removeChild(container)
  }
}
