/**
 * Виды денежных операций — общий справочник.
 *
 * Им пользуются и меню на «Балансе», и сама форма: список должен быть один,
 * иначе в меню появится пункт, которого форма не знает.
 *
 * Формулировки — про то, что человек делает, а не про то, как это называется
 * в учёте: «снять на себя» понятнее, чем «снятие капитала». Подсказка у
 * каждого вида не украшение: «снять на себя» и «расход по бизнесу» по
 * названию похожи, а по последствиям для прибыли — нет.
 */

export type OperationKind =
  | 'DEPOSIT'
  | 'WITHDRAW_OWNER'
  | 'EXPENSE'
  | 'INCOME'
  | 'TRANSFER'
  | 'BORROW'
  | 'LEND'
  | 'PENDING_OUT'
  | 'PENDING_IN'

export interface OperationKindInfo {
  kind: OperationKind
  title: string
  hint: string
  icon: string
  /** Куда двигаются деньги: пришли, ушли или сменили место. */
  direction: 'in' | 'out' | 'move'
  permission: string
}

/**
 * Где вид операции предлагается.
 *
 * `account` — обычная работа со счетами: внести, снять, перевести. Живёт на
 * «Балансе» и в меню каждого счёта.
 * `temporary` — всё остальное: взял на свои нужды, дал в долг, оплатил бензин,
 * выдал под отчёт. Такие операции набегают десятками за месяц, поэтому у них
 * свой раздел с итогом («Бухгалтерия → Временные»).
 */
export const ACCOUNT_KINDS: OperationKind[] = ['DEPOSIT', 'WITHDRAW_OWNER', 'TRANSFER']
export const TEMPORARY_KINDS: OperationKind[] = [
  'INCOME',
  'BORROW',
  'PENDING_IN',
  'EXPENSE',
  'LEND',
  'PENDING_OUT',
]

export const OPERATION_KINDS: OperationKindInfo[] = [
  {
    kind: 'DEPOSIT',
    title: 'Внести деньги',
    hint: 'Свои деньги на счёт — капитал вырастет',
    icon: 'mdi-cash-plus',
    direction: 'in',
    permission: 'finance.capital',
  },
  {
    kind: 'WITHDRAW_OWNER',
    title: 'Снять на себя',
    hint: 'Личные нужды — капитал уменьшится',
    icon: 'mdi-account-arrow-right-outline',
    direction: 'out',
    permission: 'finance.capital',
  },
  {
    kind: 'EXPENSE',
    title: 'Расход по бизнесу',
    hint: 'Аренда, зарплата, бензин',
    icon: 'mdi-cart-arrow-down',
    direction: 'out',
    permission: 'finance.manage',
  },
  {
    kind: 'INCOME',
    title: 'Прочий доход',
    hint: 'Деньги, не связанные со сделками',
    icon: 'mdi-cash-refund',
    direction: 'in',
    permission: 'finance.manage',
  },
  {
    kind: 'TRANSFER',
    title: 'Перевод между счетами',
    hint: 'Место хранения меняется, капитал — нет',
    icon: 'mdi-swap-horizontal',
    direction: 'move',
    permission: 'accounting.transfer',
  },
  // Заёмные деньги: лежат на счетах и работают, но бизнесу не принадлежат.
  {
    kind: 'BORROW',
    title: 'Взять в долг',
    hint: 'Чужие деньги в работе — в прибыли не участвуют',
    icon: 'mdi-handshake-outline',
    direction: 'in',
    permission: 'finance.capital',
  },
  {
    kind: 'LEND',
    title: 'Дать в долг',
    hint: 'Одолжили из кассы — вернут позже',
    icon: 'mdi-hand-coin-outline',
    direction: 'out',
    permission: 'finance.capital',
  },
  // Буфер неопределённости: деньги двигались, а чем это было — выяснится
  // позже. Лучше записать сразу и разобрать потом, чем не записать вовсе.
  {
    kind: 'PENDING_OUT',
    title: 'Выдал, назначение позже',
    hint: 'Под отчёт сотруднику — разберём, когда вернётся',
    icon: 'mdi-help-circle-outline',
    direction: 'out',
    permission: 'accounting.pending.create',
  },
  {
    kind: 'PENDING_IN',
    title: 'Пришло, отправитель неизвестен',
    hint: 'Разберём, когда станет понятно, чей платёж',
    icon: 'mdi-help-circle-outline',
    direction: 'in',
    permission: 'accounting.pending.create',
  },
]
