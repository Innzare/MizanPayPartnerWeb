import type { ClientProfile, Deal, Payment } from '@/types'

/**
 * Текст сделки для рабочей группы партнёра — по формату с подстановками.
 *
 * Стандартный формат задан партнёром, ничего лишнего:
 *
 *   Клиент: Шахбиева Мединат Адымовна 23.05.1969
 *   Поручитель: Шахбиев Хизир Адымович 30.12.1970
 *   Срок: 6 месяцев, по 15900 в месяц
 *   Дата окончания: 27 Апреля 2027г
 *   Платеж: 15900
 *
 * Партнёр может поменять формат: переменные в фигурных скобках — как в
 * шаблонах сообщений ({клиент}, {товар}…). Правила сборки:
 *  - строка с переменными поручителя повторяется для каждого поручителя
 *    (нет поручителей — строки нет);
 *  - строка, где все переменные пустые, не пишется;
 *  - неизвестная переменная остаётся как есть — опечатку видно в тексте.
 */

/** «05.03.1990». Дата рождения хранится днём, без часового пояса. */
function birthDay(value?: string | null): string {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

function fullName(p?: Partial<ClientProfile> | null): string {
  return p ? [p.lastName, p.firstName, p.patronymic].map((x) => (x ?? '').trim()).filter(Boolean).join(' ') : ''
}

/** Плановый платёж: сумма, которая чаще всего стоит в графике (округление и правки учтены). */
function regularPayment(deal: Deal): number | null {
  const rows = (deal.payments ?? []).filter((p: Payment) => !p.shortfallOfPaymentId)
  if (rows.length) {
    const counts = new Map<number, number>()
    for (const p of rows) {
      const amount = Math.round(p.scheduledAmount ?? p.amount)
      if (amount > 0) counts.set(amount, (counts.get(amount) ?? 0) + 1)
    }
    const best = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    if (best) return best[0]
  }
  const left = (deal.totalPrice ?? 0) - (deal.downPayment ?? 0) - (deal.discount ?? 0)
  return deal.numberOfPayments > 0 && left > 0 ? Math.round(left / deal.numberOfPayments) : null
}

function dueDates(deal: Deal): string[] {
  return (deal.payments ?? []).map((p) => p.dueDate).filter(Boolean).sort() as string[]
}

function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10, h = n % 100
  if (d === 1 && h !== 11) return one
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few
  return many
}

/** «6 месяцев» / «12 недель» / «10 платежей». */
function termText(deal: Deal): string {
  const n = deal.numberOfPayments
  if (!n) return ''
  if (deal.paymentInterval === 'WEEKLY') return `${n} ${plural(n, 'неделя', 'недели', 'недель')}`
  if (deal.paymentInterval === 'BIWEEKLY') return `${n} ${plural(n, 'платёж', 'платежа', 'платежей')}`
  return `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`
}

const PERIOD: Record<string, string> = { WEEKLY: 'в неделю', BIWEEKLY: 'раз в 2 недели', MONTHLY: 'в месяц' }

const MONTHS_GEN = ['Января', 'Февраля', 'Марта', 'Апреля', 'Мая', 'Июня', 'Июля', 'Августа', 'Сентября', 'Октября', 'Ноября', 'Декабря']
/** «27 Апреля 2027г». */
function longDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}г`
}
/** «05.05.2026». */
function shortDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}
const num = (v?: number | null) => (v != null && v > 0 ? String(Math.round(v)) : '')

/** Переменные формата — для кнопок в окне. Порядок — как на экране. */
export const GROUP_SHARE_VARIABLES: ReadonlyArray<{ key: string; label: string; hint?: string }> = [
  { key: '{клиент}', label: 'Клиент', hint: 'ФИО клиента' },
  { key: '{клиент_др}', label: 'Дата рождения', hint: 'Дата рождения клиента' },
  { key: '{телефон}', label: 'Телефон', hint: 'Телефон клиента' },
  { key: '{адрес}', label: 'Адрес', hint: 'Адрес проживания клиента' },
  { key: '{поручитель}', label: 'Поручитель', hint: 'ФИО поручителя — строка повторится для каждого' },
  { key: '{поручитель_др}', label: 'Дата рождения поручителя' },
  { key: '{поручитель_телефон}', label: 'Телефон поручителя' },
  { key: '{товар}', label: 'Товар' },
  { key: '{номер_договора}', label: '№ договора' },
  { key: '{дата_договора}', label: 'Дата договора' },
  { key: '{стоимость}', label: 'Стоимость', hint: 'Итоговая стоимость по договору' },
  { key: '{первый_взнос}', label: 'Первый взнос' },
  { key: '{остаток}', label: 'Остаток долга' },
  { key: '{срок}', label: 'Срок', hint: '«6 месяцев»' },
  { key: '{платёж}', label: 'Платёж', hint: 'Сумма регулярного платежа' },
  { key: '{период}', label: 'Период', hint: '«в месяц» / «в неделю»' },
  { key: '{дата_первого_платежа}', label: 'Первый платёж', hint: 'Дата первого платежа по графику' },
  { key: '{дата_окончания}', label: 'Дата окончания', hint: 'Дата последнего платежа по графику' },
  { key: '{сотрудник}', label: 'Ответственный' },
]

/** Стандартный формат — тот, что попросил партнёр. */
export const DEFAULT_GROUP_TEMPLATE = [
  'Клиент: {клиент} {клиент_др}',
  'Поручитель: {поручитель} {поручитель_др}',
  'Срок: {срок}, по {платёж} {период}',
  'Дата окончания: {дата_окончания}',
  'Платеж: {платёж}',
].join('\n')

const GUARANTOR_KEYS = ['{поручитель}', '{поручитель_др}', '{поручитель_телефон}']

/** Значения переменных по сделке (поручители — отдельным списком). */
function valuesOf(deal: Deal): { common: Record<string, string>; guarantors: Array<Record<string, string>> } {
  const due = dueDates(deal)
  const clientName = fullName(deal.clientProfile)
    || (deal.externalClientName ?? '').trim()
    || [deal.client?.lastName, deal.client?.firstName].filter(Boolean).join(' ')
  const cp = deal.clientProfile as (Partial<ClientProfile> & { residentialAddress?: string; registrationAddress?: string }) | null | undefined
  const payment = regularPayment(deal)
  const common: Record<string, string> = {
    '{клиент}': clientName,
    '{клиент_др}': birthDay(cp?.birthDate ?? deal.clientBirthDate),
    '{телефон}': (cp?.phone ?? deal.externalClientPhone ?? '').trim(),
    '{адрес}': (cp?.residentialAddress || cp?.registrationAddress || '').trim(),
    '{товар}': (deal.productName ?? '').trim(),
    '{номер_договора}': deal.dealNumber != null ? String(deal.dealNumber) : '',
    '{дата_договора}': shortDate(deal.dealDate),
    '{стоимость}': num(deal.totalPrice),
    '{первый_взнос}': num(deal.downPayment),
    '{остаток}': num(deal.remainingAmount),
    '{срок}': termText(deal),
    '{платёж}': payment ? String(payment) : '',
    '{период}': deal.numberOfPayments ? (PERIOD[deal.paymentInterval] ?? 'в месяц') : '',
    '{дата_первого_платежа}': longDate(due[0]),
    '{дата_окончания}': longDate(due[due.length - 1] ?? deal.scheduleEndAt ?? null),
    '{сотрудник}': deal.assignedStaff ? `${deal.assignedStaff.firstName} ${deal.assignedStaff.lastName}`.trim() : '',
  }
  // Поручители — по порядку; старые сделки хранят одного в guarantorProfile.
  let people = (deal.guarantors ?? []).slice().sort((a, b) => a.order - b.order).map((g) => g.clientProfile)
  if (!people.length && deal.guarantorProfile) people = [deal.guarantorProfile]
  const guarantors = people
    .map((p) => ({
      '{поручитель}': fullName(p),
      '{поручитель_др}': birthDay(p?.birthDate),
      '{поручитель_телефон}': (p?.phone ?? '').trim(),
    }))
    .filter((g) => g['{поручитель}'])
  return { common, guarantors }
}

const VAR_RE = /\{[^{}\n]+\}/g

/** Одна строка формата: подставить, а если все её переменные пустые — убрать. */
function renderLine(line: string, values: Record<string, string>): string | null {
  const vars = line.match(VAR_RE) ?? []
  const known = vars.filter((v) => v in values)
  if (known.length && known.every((v) => !values[v])) return null
  const out = line.replace(VAR_RE, (v) => (v in values ? values[v]! : v))
  // Пустая переменная не должна оставлять «()» и висящую запятую/тире в конце.
  return out
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*[,;—–-][ \t]*$/, '')
    .replace(/[ \t]+$/, '')
}

/** Текст по формату партнёра (пусто — стандартный). */
export function renderGroupShare(template: string | null | undefined, deal: Deal): string {
  const { common, guarantors } = valuesOf(deal)
  const out: string[] = []
  for (const line of (template?.trim() ? template : DEFAULT_GROUP_TEMPLATE).split('\n')) {
    if (GUARANTOR_KEYS.some((k) => line.includes(k))) {
      // Строка поручителя — по разу на каждого.
      for (const g of guarantors) {
        const r = renderLine(line, { ...common, ...g })
        if (r != null) out.push(r)
      }
      continue
    }
    const r = renderLine(line, common)
    if (r != null) out.push(r)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Текст по стандартному формату. */
export function buildDealSummaryText(deal: Deal): string {
  return renderGroupShare(DEFAULT_GROUP_TEMPLATE, deal)
}

/** В буфер обмена — и там, где clipboard API нет (http, старые браузеры). */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(area)
  if (!ok) throw new Error('copy failed')
}
