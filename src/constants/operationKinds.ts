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
  | 'WITHDRAW_PROFIT'
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
 * `account` — быстрый вход с «Баланса» и из меню счёта: вложить, снять,
 * перевести.
 * Пополнения и расходы — раздел «Бухгалтерия → Пополнения и расходы», где
 * ведутся все ручные движения денег. Виды различаются не названием, а тем,
 * что меняют:
 * - капитал — вложение или снятие своих денег навсегда;
 * - прибыль — снятие заработанного, вложенное не трогается;
 * - прочий доход и расход по бизнесу — деньги кассы, без возврата;
 * - временное — деньги вернутся, ни капитал, ни прибыль не меняются;
 * - неразобранное — чем это было, решат позже.
 */
export const ACCOUNT_KINDS: OperationKind[] = ['DEPOSIT', 'WITHDRAW_PROFIT', 'WITHDRAW_OWNER', 'TRANSFER']
export const INCOME_KINDS: OperationKind[] = ['DEPOSIT', 'INCOME', 'BORROW', 'PENDING_IN']
export const EXPENSE_KINDS: OperationKind[] = ['EXPENSE', 'WITHDRAW_PROFIT', 'WITHDRAW_OWNER', 'LEND', 'PENDING_OUT']

export const OPERATION_KINDS: OperationKindInfo[] = [
  {
    kind: 'DEPOSIT',
    title: 'Вложение капитала',
    hint: 'Свои деньги в оборот насовсем — капитал вырастет',
    icon: 'mdi-cash-plus',
    direction: 'in',
    permission: 'finance.capital',
  },
  {
    kind: 'WITHDRAW_OWNER',
    title: 'Снятие капитала',
    hint: 'Забрали вложенное — капитал уменьшится. Заработанное снимают «Снятием прибыли»',
    icon: 'mdi-account-arrow-right-outline',
    direction: 'out',
    permission: 'finance.capital',
  },
  // Самый частый вопрос партнёров — «как забрать заработанное». Отдельный вид,
  // а не режим снятия капитала: снимается только прибыль, вложенное не трогается.
  {
    kind: 'WITHDRAW_PROFIT',
    title: 'Снятие прибыли',
    hint: 'Забрали заработанное — вложенный капитал не тронут',
    icon: 'mdi-cash-check',
    direction: 'out',
    permission: 'finance.capital',
  },
  {
    kind: 'EXPENSE',
    title: 'Расход по бизнесу',
    hint: 'Аренда, зарплата, бензин — деньги ушли из кассы',
    icon: 'mdi-cart-arrow-down',
    direction: 'out',
    permission: 'finance.transactions',
  },
  {
    kind: 'INCOME',
    title: 'Прочий доход',
    hint: 'Деньги не по сделкам — пришли в кассу',
    icon: 'mdi-cash-refund',
    direction: 'in',
    permission: 'finance.transactions',
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
    title: 'Временное пополнение',
    hint: 'Положили деньги на время (свои или занятые) — вернём, в прибыли не участвуют',
    icon: 'mdi-handshake-outline',
    direction: 'in',
    permission: 'finance.capital',
  },
  {
    kind: 'LEND',
    title: 'Временное снятие',
    hint: 'Взяли из кассы на время или дали в долг — вернут',
    icon: 'mdi-hand-coin-outline',
    direction: 'out',
    permission: 'finance.capital',
  },
  // Буфер неопределённости: деньги двигались, а чем это было — выяснится
  // позже. Лучше записать сразу и разобрать потом, чем не записать вовсе.
  {
    kind: 'PENDING_OUT',
    title: 'Выдали под отчёт',
    hint: 'Под отчёт сотруднику — разберём, когда вернётся',
    icon: 'mdi-help-circle-outline',
    direction: 'out',
    permission: 'accounting.pending.create',
  },
  {
    kind: 'PENDING_IN',
    title: 'Неизвестный приход',
    hint: 'Разберём, когда станет понятно, чей платёж',
    icon: 'mdi-help-circle-outline',
    direction: 'in',
    permission: 'accounting.pending.create',
  },
]
