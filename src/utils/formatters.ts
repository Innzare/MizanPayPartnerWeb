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

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateShort(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `+7 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9)}`;
  }
  return phone;
}

// ── Maska masks ──

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

export function timeAgo(dateString: string): string {
  const now = Date.now();
  const diff = now - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return 'Только что';
  if (minutes < 60) return `${minutes} мин назад`;
  if (hours < 24) return `${hours} ч назад`;
  if (days === 1) return 'Вчера';
  if (days < 7) return `${days} дн назад`;
  return new Date(dateString).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
