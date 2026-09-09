import { formatE164 } from './phone';
export function formatCurrency(amount: number): string {
  const rounded = Math.round(amount);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD';
}

export function formatCurrencyShort(amount: number): string {
  if (amount >= 1_000_000) {
    return (amount / 1_000_000).toFixed(1).replace('.0', '') + 'M \u20BD';
  }
  if (amount >= 1_000) {
    return (amount / 1_000).toFixed(1).replace('.0', '') + 'K \u20BD';
  }
  return formatCurrency(amount);
}

export function formatPercent(value: number): string {
  if (value === 0) return '0%';
  if (value < 0.01) return value.toFixed(4).replace(/0+$/, '') + '%';
  if (value < 1) return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + '%';
  return value.toFixed(1).replace('.0', '') + '%';
}

/**
 * Прочерк для незаполненных дат. Без него пустое значение превращалось в
 * «1 января 1970 г.» (так JS трактует null) или в «Invalid Date»: у сделок,
 * загруженных импортом, часть дат не заполнена — в файлах таких колонок нет.
 */
export const EMPTY_DATE = '—';

function parseDate(value?: string | number | Date | null): Date | null {
  // 0 — это не дата, а «пусто»: как строка-timestamp ноль дал бы 1970 год.
  if (value === null || value === undefined || value === '' || value === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(dateString?: string | number | Date | null): string {
  const date = parseDate(dateString);
  if (!date) return EMPTY_DATE;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateShort(dateString?: string | number | Date | null): string {
  const date = parseDate(dateString);
  if (!date) return EMPTY_DATE;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function formatPhone(phone: string): string {
  const raw = (phone || '').trim();
  const cleaned = raw.replace(/\D/g, '');
  // Российский номер показываем ровно как раньше — привычный вид не меняем.
  // Ведущая «8» считается российской только без плюса: «+84912345678» — это
  // Вьетнам, и выдавать его за московский номер нельзя.
  const isRu =
    cleaned.length === 11 && (cleaned.startsWith('7') || (!raw.startsWith('+') && cleaned.startsWith('8')));
  if (isRu) {
    return `+7 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9)}`;
  }
  // Иностранный — по маске его страны, иначе он читался бы сплошной цифрой.
  if (raw.startsWith('+')) return formatE164(raw);
  return phone;
}

// ── Maska masks ──

/** @deprecated Осталось для форм, которые ещё не перешли на PhoneField. */
export const PHONE_MASK = '+7 (###) ###-##-##'

export const CURRENCY_MASK = { number: { locale: 'ru-RU', fraction: 0, unsigned: true } }

export function parseMasked(e: any): number {
  return Number(e.detail?.unmasked) || 0
}

export function formatMonths(months: number): string {
  if (months === 1) return '1 месяц';
  if (months >= 2 && months <= 4) return `${months} месяца`;
  return `${months} месяцев`;
}

export function timeAgo(dateString?: string | number | Date | null): string {
  const date = parseDate(dateString);
  // Пусто, а не прочерк: подписи вида «Удалена {{ timeAgo(...) }}» иначе
  // читались бы как «Удалена —».
  if (!date) return '';
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return 'Только что';
  if (minutes < 60) return `${minutes} мин назад`;
  if (hours < 24) return `${hours} ч назад`;
  if (days === 1) return 'Вчера';
  if (days < 7) return `${days} дн назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/**
 * Русская форма слова по числу: «1 платёж», «2 платежа», «5 платежей».
 *
 * Жила внутри страницы сделки, а нужна везде, где рядом с числом стоит слово.
 */
export function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}
