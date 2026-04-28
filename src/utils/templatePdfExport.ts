import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { Deal, Payment, User } from '@/types'
import { formatDate } from './formatters'

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

  const guarantor = deal.guarantorProfile

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
    img { max-width: 100%; height: auto; }
    div[data-bordered] { border: 1px solid #000; padding: 10px 14px; margin: 8px 0; }
    mark { background: #fef08a; padding: 1px 2px; }
  `
  container.appendChild(style)

  const content = document.createElement('div')
  content.innerHTML = finalHtml
  container.appendChild(content)
  document.body.appendChild(container)

  try {
    const canvas = await html2canvas(container, {
      scale: SCALE,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: contentWidthPx,
    })

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

      const sliceHeight = Math.min(pageContentHeightPx, canvas.height - yOffset)

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

      yOffset += pageContentHeightPx
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
