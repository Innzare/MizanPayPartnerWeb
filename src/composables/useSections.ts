import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useSubscription } from '@/composables/useSubscription'
import type { PlanFeatures } from '@/types'

/**
 * Единая точка ответа на вопрос «показывать ли раздел».
 *
 * До этого в приложении было ТРИ независимых механизма видимости, которые
 * друг о друге не знали: тариф (PLAN_FEATURES), права сотрудника (роли и
 * accessOverrides) и жёстко отключённые роуты. Настройка «скрыть раздел»
 * стала бы четвёртым — и каждое место в коде обросло бы условием из четырёх
 * частей, в котором рано или поздно забыли бы одну.
 *
 * Поэтому решение принимается здесь, а страницы спрашивают одно из двух:
 *   visible(k) — показывать ли следы раздела (кнопки, фильтры, колонки);
 *   isHidden(k) — скрыл ли владелец раздел (нужно только навигации, чтобы
 *                 отличить «скрыт совсем» от «залочен тарифом с короной»).
 *
 * Порядок строгий:
 *   1. владелец скрыл  → элемента нет вообще, без короны и апселла;
 *   2. тариф не даёт   → элемент виден, но с короной и переходом в тарифы;
 *   3. права сотрудника → поверх первых двух, как и раньше.
 */
export type SectionKey = keyof PlanFeatures | 'help'

/** Разделы, которые владелец может скрыть. Зеркало HIDEABLE_SECTIONS на сервере. */
export const HIDEABLE_SECTIONS: {
  key: SectionKey
  label: string
  /** Что именно исчезнет — пишем честно, чтобы человек понимал последствия. */
  effect: string
  icon: string
}[] = [
  {
    key: 'analytics',
    label: 'Аналитика и отчёты',
    effect: 'Раздел с графиками, годовым обзором и отчётами. Цифры на главной останутся.',
    icon: 'mdi-chart-line',
  },
  {
    key: 'coInvestors',
    label: 'Со-инвесторы',
    effect: 'Раздел, блок «Участники прибыли» в сделке и доля инвесторов в отчётах.',
    icon: 'mdi-account-group-outline',
  },
  {
    key: 'debtors',
    label: 'Должники',
    effect: 'Раздел работы с просрочкой, обещания оплаты и назначение ответственных по долгам.',
    icon: 'mdi-account-alert-outline',
  },
  {
    key: 'suppliers',
    label: 'Партнёры-поставщики',
    effect: 'Раздел, выбор поставщика и галка «Оплачено поставщику» при создании сделки.',
    icon: 'mdi-handshake-outline',
  },
  {
    key: 'whatsapp',
    label: 'Чаты и рассылки',
    effect: 'Раздел, кнопки «Напомнить» и отправка документов клиенту в WhatsApp.',
    icon: 'mdi-whatsapp',
  },
  {
    key: 'staff',
    label: 'Сотрудники',
    effect: 'Раздел, фильтры «Ответственный» и назначение сотрудника на сделку.',
    icon: 'mdi-account-key',
  },
  {
    key: 'registry',
    label: 'Реестр клиентов',
    effect: 'Общая база клиентов, публикация профиля, чёрный список и отзывы.',
    icon: 'mdi-shield-account',
  },
  {
    key: 'import',
    label: 'Импорт из Excel',
    effect: 'Перенос сделок из таблицы и пункт «Импорт» в меню создания.',
    icon: 'mdi-file-upload-outline',
  },
  {
    key: 'help',
    label: 'Справка',
    effect: 'Раздел с обучением по работе в MizanPay.',
    icon: 'mdi-help-circle-outline',
  },
]

export function useSections() {
  const auth = useAuthStore()
  const subscription = useSubscription()

  const hidden = computed<string[]>(() => (auth.user as any)?.hiddenSections ?? [])

  /** Владелец скрыл раздел для всего аккаунта. */
  function isHidden(key: SectionKey): boolean {
    return hidden.value.includes(key)
  }

  /**
   * Показывать ли следы раздела внутри других страниц.
   *
   * Здесь скрытие и тарифный лок означают одно и то же — «не рисовать».
   * Разница между ними важна только в меню, где лок показывает корону.
   */
  function visible(key: SectionKey): boolean {
    if (isHidden(key)) return false
    if (key === 'help') return true
    return subscription.canAccess(key as keyof PlanFeatures)
  }

  return { hidden, isHidden, visible }
}
