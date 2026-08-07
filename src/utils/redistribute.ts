/**
 * ЗЕРКАЛО бэкенда MizanPayBackend/src/payments/redistribute.util.ts.
 * ТОЛЬКО для превью в интерфейсе. Авторитет расчёта — бэк; при отправке на
 * сервер он всё пересчитает сам. При правке — править ОБА файла синхронно.
 *
 * Инвариант: Σ результата ВСЕГДА равна `target`, каждый элемент ≥ 0.
 * Расчёт ведётся от остатка (`target`), а не от дельты.
 * Все суммы — целые рубли (вызывающий округляет через Math.round).
 */

export type RedistributeMode = 'EQUAL' | 'NEXT' | 'LAST' | 'MANUAL'

export interface ScheduleRow {
  id: string
  number: number
  amount: number
}

export interface RedistributeInput {
  /** Открытые строки (PENDING/OVERDUE), ASC по number, БЕЗ только что оплаченной. */
  rows: ScheduleRow[]
  /** Остаток по договору к распределению, целое ≥ 0. */
  target: number
  mode: RedistributeMode
  /** Только для MANUAL. */
  manual?: Array<{ paymentId: string; amount: number }>
}

export interface RedistributeResult {
  rows: Array<{ id: string; amount: number }>
  closedIds: string[]
}

function distributeEqual(target: number, n: number): number[] {
  if (n <= 0) return []
  const per = Math.round(target / n)
  const last = target - per * (n - 1)
  if (per >= 0 && last >= 0) {
    const res = new Array(n).fill(per)
    res[n - 1] = last
    return res
  }
  const res: number[] = []
  let left = target
  for (let i = 0; i < n; i++) {
    const share = i === n - 1 ? left : Math.round(left / (n - i))
    const amt = Math.min(Math.max(share, 0), Math.max(left, 0))
    res.push(amt)
    left -= amt
  }
  return res
}

function cascadeForward(arr: number[]): void {
  for (let i = 0; i < arr.length - 1; i++) {
    if (arr[i] < 0) {
      arr[i + 1] += arr[i]
      arr[i] = 0
    }
  }
}

function cascadeBackward(arr: number[]): void {
  for (let i = arr.length - 1; i >= 1; i--) {
    if (arr[i] < 0) {
      arr[i - 1] += arr[i]
      arr[i] = 0
    }
  }
}

export function validateManual(
  rows: ScheduleRow[],
  target: number,
  manual: Array<{ paymentId: string; amount: number }>,
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(manual) || manual.length !== rows.length) {
    return { ok: false, reason: 'Список распределения не совпадает с оставшимися платежами графика' }
  }
  const rowIds = new Set(rows.map((r) => r.id))
  const seen = new Set<string>()
  let sum = 0
  for (const m of manual) {
    if (!rowIds.has(m.paymentId) || seen.has(m.paymentId)) {
      return { ok: false, reason: 'Список распределения не совпадает с оставшимися платежами графика' }
    }
    seen.add(m.paymentId)
    if (!Number.isFinite(m.amount) || !Number.isInteger(m.amount) || m.amount < 0) {
      return { ok: false, reason: 'Суммы распределения должны быть целыми и не отрицательными' }
    }
    sum += m.amount
  }
  if (sum !== target) {
    const diff = Math.abs(target - sum)
    return {
      ok: false,
      reason: `Распределено ${sum.toLocaleString('ru-RU')} ₽, а остаток по договору — ${target.toLocaleString('ru-RU')} ₽. Разница ${diff.toLocaleString('ru-RU')} ₽`,
    }
  }
  return { ok: true }
}

export function redistribute(input: RedistributeInput): RedistributeResult {
  const { rows, target, mode, manual } = input
  const n = rows.length
  if (n === 0) return { rows: [], closedIds: [] }

  const current = rows.map((r) => Math.round(r.amount))
  let amounts: number[]

  if (mode === 'MANUAL') {
    const v = validateManual(rows, target, manual ?? [])
    if (!v.ok) throw new Error(v.reason)
    const byId = new Map((manual ?? []).map((m) => [m.paymentId, Math.round(m.amount)]))
    amounts = rows.map((r) => byId.get(r.id) as number)
  } else if (mode === 'NEXT') {
    const delta = target - current.reduce((s, x) => s + x, 0)
    amounts = [...current]
    amounts[0] += delta
    cascadeForward(amounts)
  } else if (mode === 'LAST') {
    const delta = target - current.reduce((s, x) => s + x, 0)
    amounts = [...current]
    amounts[n - 1] += delta
    cascadeBackward(amounts)
  } else {
    amounts = distributeEqual(target, n)
  }

  const sum = amounts.reduce((s, x) => s + x, 0)
  const min = amounts.reduce((m, x) => Math.min(m, x), 0)
  if (sum !== target || min < 0) {
    throw new Error(`redistribute: инвариант нарушен (mode=${mode}, Σ=${sum}, target=${target}, min=${min})`)
  }

  return {
    rows: rows.map((r, i) => ({ id: r.id, amount: amounts[i] })),
    closedIds: rows.filter((_, i) => amounts[i] === 0).map((r) => r.id),
  }
}
