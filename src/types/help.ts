/**
 * Модель данных раздела «Справка».
 *
 * Контент — это ДАННЫЕ, а не набор .vue-страниц. Так бесплатно получаются
 * оглавление, поиск, переходы «предыдущая/следующая глава» и scroll spy:
 * всё строится из одного массива. Двадцать глав отдельными компонентами
 * означали бы двадцать копий одной вёрстки и невозможность собрать индекс.
 */
import type { PlanFeatures } from '@/types'

export type HelpCalloutVariant = 'tip' | 'warning' | 'danger' | 'info' | 'plan'

/**
 * Блок контента. Набор намеренно маленький: если чего-то не хватает —
 * добавляем новый вид, а не усложняем разметку внутри текста.
 *
 * В поле `text` работает минимальная разметка (см. HelpRichText.vue):
 *   **жирный**            — выделение
 *   [[/deals|Сделки]]     — ссылка на раздел приложения
 *   `Ctrl+K`              — клавиша
 */
export type HelpBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; ordered?: boolean; items: string[] }
  | { kind: 'steps'; items: { title: string; text?: string }[] }
  | { kind: 'callout'; variant: HelpCalloutVariant; title?: string; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][]; caption?: string }
  | { kind: 'faq'; items: { q: string; a: string }[] }
  | { kind: 'links'; items: { to: string; label: string; desc?: string; icon?: string }[] }
  | { kind: 'divider' }

export interface HelpSection {
  /** Уникален по всей справке — это якорь в адресе: /help#deal-create */
  id: string
  title: string
  blocks: HelpBlock[]
  /** Синонимы для поиска: пользователь ищет «рассрочка», а в тексте «сделка». */
  keywords?: string[]
}

export interface HelpChapter {
  id: string
  title: string
  icon: string
  summary?: string
  sections: HelpSection[]
  /** Глава про возможность, доступную не на всех тарифах. */
  requiredFeature?: keyof PlanFeatures
  /** Скрыть от сотрудников — им этот раздел всё равно закрыт. */
  ownerOnly?: boolean
}

/** Плоский список секций — для навигации, поиска и подсветки при скролле. */
export interface HelpFlatSection {
  chapterId: string
  chapterTitle: string
  sectionId: string
  sectionTitle: string
}
