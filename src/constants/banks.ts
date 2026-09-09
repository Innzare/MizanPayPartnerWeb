/**
 * Справочник банков для счетов.
 *
 * Нужен, чтобы карту заводили выбором из списка, а не вводили название
 * руками: «Сбер», «сбербанк», «Sber» — это один банк, и без справочника
 * разбивка баланса по банкам развалилась бы на десяток вариантов написания.
 *
 * Логотипы не храним файлами: цвет и одна-две буквы узнаются не хуже, а
 * картинки пришлось бы обновлять при каждом ребрендинге и следить за правами
 * на их использование.
 *
 * Список открытый: банка нет в справочнике — партнёр вписывает своё название,
 * оно сохранится как есть.
 */

export interface BankRef {
  /** Ключ для хранения. Не меняется при переименовании банка. */
  key: string
  /** Как показываем в списках. */
  name: string
  /** Фирменный цвет — фон значка. */
  color: string
  /** Буквы на значке. */
  short: string
  /** Подсказка для кода счёта: «Сбер» → «С1». */
  codeHint: string
}

export const BANKS: BankRef[] = [
  { key: 'sber', name: 'Сбербанк', color: '#21a038', short: 'Сб', codeHint: 'С' },
  { key: 'tbank', name: 'Т-Банк', color: '#ffdd2d', short: 'Т', codeHint: 'Т' },
  { key: 'vtb', name: 'ВТБ', color: '#0a2896', short: 'ВТ', codeHint: 'В' },
  { key: 'alfa', name: 'Альфа-Банк', color: '#ef3124', short: 'А', codeHint: 'А' },
  { key: 'ozon', name: 'Ozon Банк', color: '#005bff', short: 'Oz', codeHint: 'O' },
  { key: 'yandex', name: 'Яндекс Банк', color: '#fc3f1d', short: 'Я', codeHint: 'Я' },
  { key: 'raiff', name: 'Райффайзен', color: '#fee600', short: 'Рф', codeHint: 'Р' },
  { key: 'gazprom', name: 'Газпромбанк', color: '#1f3c88', short: 'ГП', codeHint: 'Г' },
  { key: 'rshb', name: 'Россельхозбанк', color: '#0a562b', short: 'РС', codeHint: 'РС' },
  { key: 'otkritie', name: 'Открытие', color: '#00bef0', short: 'Отк', codeHint: 'О' },
  { key: 'psb', name: 'Промсвязьбанк', color: '#f26522', short: 'ПС', codeHint: 'П' },
  { key: 'sovcom', name: 'Совкомбанк', color: '#1b3a6b', short: 'Св', codeHint: 'Св' },
  { key: 'mkb', name: 'МКБ', color: '#e4002b', short: 'МК', codeHint: 'М' },
  { key: 'uralsib', name: 'Уралсиб', color: '#5b2d8e', short: 'Ур', codeHint: 'У' },
  { key: 'rnkb', name: 'РНКБ', color: '#e2231a', short: 'РН', codeHint: 'РН' },
  { key: 'dombank', name: 'Дом.РФ', color: '#00b1a9', short: 'Дм', codeHint: 'Д' },
  { key: 'zenit', name: 'Зенит', color: '#c8102e', short: 'Зн', codeHint: 'З' },
  { key: 'akbars', name: 'Ак Барс', color: '#00954f', short: 'АБ', codeHint: 'АБ' },
  { key: 'other', name: 'Другой банк', color: '#64748b', short: '?', codeHint: 'Б' },
]

const BY_KEY = new Map(BANKS.map((b) => [b.key, b]))

export function findBank(key?: string | null): BankRef | null {
  return key ? (BY_KEY.get(key) ?? null) : null
}

/**
 * Название банка для показа: известный — из справочника, свой — как ввели.
 */
export function bankLabel(key?: string | null, custom?: string | null): string {
  return findBank(key)?.name ?? (custom?.trim() || 'Без банка')
}
