/**
 * Текст сделки для рабочей группы — без окна: скопировать по сохранённому
 * формату кабинета и отметить «отправлено». Формат правится в «Настройках».
 *
 * Сделку для текста берём целиком с сервера: в строке списка нет поручителей,
 * дат рождения и графика, а формат может на них ссылаться.
 */
import { api } from '@/api/client'
import { copyText, renderGroupShare } from '@/utils/dealSummaryText'
import type { Deal } from '@/types'

/** Формат кабинета (null — стандартный). Грузится один раз за сессию. */
let templateLoad: Promise<string | null> | null = null

function loadTemplate(): Promise<string | null> {
  if (!templateLoad) {
    templateLoad = api
      .get<{ template: string | null }>('/deals/group-share/template')
      .then((r) => r.template)
      .catch((e) => {
        templateLoad = null // не кэшируем ошибку — следующая попытка спросит снова
        throw e
      })
  }
  return templateLoad
}

/** Формат сохранили в настройках — следующее копирование возьмёт новый. */
export function setGroupShareTemplateCache(template: string | null) {
  templateLoad = Promise.resolve(template)
}

/**
 * Скопировать текст сделки.
 *
 * Safari разрешает запись в буфер только в момент нажатия, а текст ещё нужно
 * загрузить. Поэтому в буфер передаём «обещание текста» (ClipboardItem с
 * Promise) — запись засчитывается нажатию, а содержимое догружается. Где так
 * нельзя, ждём текст и копируем обычным способом.
 */
export async function copyDealGroupText(dealId: string): Promise<void> {
  const text = Promise.all([api.get<Deal>(`/deals/${dealId}`), loadTemplate()]).then(([deal, tpl]) =>
    renderGroupShare(tpl, deal),
  )
  if (window.isSecureContext && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) }),
      ])
      return
    } catch {
      // Браузер не принял обещание — пробуем обычное копирование ниже.
    }
  }
  await copyText(await text)
}

/** Поставить или снять отметку «отправлено в группу». */
export function setDealGroupSent(dealId: string, sent: boolean) {
  return api.patch<{ id: string; groupSentAt: string | null }>(`/deals/${dealId}/group-sent`, { sent })
}
