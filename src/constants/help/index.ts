import type { HelpBlock, HelpChapter } from '@/types/help'

import { chStart } from './01-start'
import { chDeals } from './02-deals'
import { chPayments } from './03-payments'
import { chCashboxes } from './04-cashboxes'
import { chCoInvestors } from './05-coinvestors'
import { chAnalytics } from './06-analytics'
import { chClients } from './07-clients'
import { chDebtors } from './08-debtors'
import { chSuppliers } from './09-suppliers'
import { chStaff } from './10-staff'
import { chWhatsApp } from './11-whatsapp'
import { chTools } from './12-tools'
import { chPlans } from './13-plans'
import { chFaq } from './14-faq'

/**
 * Содержание справки. Порядок глав здесь = порядок на странице и в оглавлении.
 *
 * Импортируется ТОЛЬКО со страницы /help — иначе весь текст справки уедет
 * в основной бандл приложения.
 */
export const HELP_CHAPTERS: HelpChapter[] = [
  chStart,
  chDeals,
  chPayments,
  chCashboxes,
  chCoInvestors,
  chAnalytics,
  chClients,
  chDebtors,
  chSuppliers,
  chStaff,
  chWhatsApp,
  chTools,
  chPlans,
  chFaq,
]

/** Текст блока без разметки — для поиска и коротких выдержек. */
export function helpPlainText(b: HelpBlock): string {
  switch (b.kind) {
    case 'p':
      return b.text
    case 'list':
      return b.items.join(' ')
    case 'steps':
      return b.items.map((s) => s.title + ' ' + (s.text || '')).join(' ')
    case 'callout':
      return (b.title || '') + ' ' + b.text
    case 'table':
      return b.headers.join(' ') + ' ' + b.rows.flat().join(' ')
    case 'faq':
      return b.items.map((f) => f.q + ' ' + f.a).join(' ')
    case 'links':
      return b.items.map((l) => l.label + ' ' + (l.desc || '')).join(' ')
    default:
      return ''
  }
}

// Якорь — это адрес раздела. Совпадение id молча сломало бы и переходы,
// и подсветку при прокрутке, поэтому ловим сразу при разработке.
if (import.meta.env.DEV) {
  const seen = new Set<string>()
  for (const ch of HELP_CHAPTERS) {
    for (const id of [ch.id, ...ch.sections.map((s) => s.id)]) {
      if (seen.has(id)) console.error(`[help] Повторяющийся id раздела: "${id}"`)
      seen.add(id)
    }
  }
}
