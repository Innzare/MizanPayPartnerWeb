/**
 * Проверка разбора даты: матрица «что ввели → что получилось».
 * Запуск: npx tsx scripts/check-date-input.ts
 */
import { parseDateInput, formatDateInput, shiftIso, isoToDate, dateToIso, todayIso, maskDateText } from '../src/utils/dateInput'

const TODAY = new Date(2026, 7, 23) // 23 августа 2026
const Y = TODAY.getFullYear()

const cases: Array<[string, string | null]> = [
  ['20.08.2026', '2026-08-20'],
  ['20082026', '2026-08-20'],
  ['20/08/2026', '2026-08-20'],
  ['20-08-2026', '2026-08-20'],
  ['20.08.26', '2026-08-20'],
  ['200826', '2026-08-20'],
  ['5.3.87', '1987-03-05'],
  ['20.08', `${Y}-08-20`],
  ['2008', `${Y}-08-20`],
  ['20', `${Y}-08-20`],
  ['5', `${Y}-08-05`],
  ['5.1', `${Y}-01-05`],
  ['1.1.26', '2026-01-01'],
  ['31.02.2026', null],
  ['31.04.2026', null],
  ['29.02.2024', '2024-02-29'],
  ['29.02.2026', null],
  ['00', null],
  ['32', null],
  ['0.0.0', null],
  ['512', null],
  ['abc', null],
  ['20.08.20260', null],
  ['', null],
  ['   ', null],
  ['13.13.2026', null],
]

let bad = 0
for (const [input, expected] of cases) {
  const got = parseDateInput(input, TODAY)
  const ok = got === expected
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'ПЛОХО'} ${JSON.stringify(input).padEnd(14)} → ${String(got).padEnd(12)} ${ok ? '' : `(ждали ${expected})`}`)
}

console.log('\n── Подстановка точек при вводе ──')
const masks: Array<[string, string]> = [
  ['2', '2'],
  ['20', '20'],
  ['200', '20.0'],
  ['2008', '20.08'],
  ['20082', '20.08.2'],
  ['20082026', '20.08.2026'],
  ['200820267', '20.08.2026'],
  ['20.', '20.'],
  ['5.3.87', '5.3.87'],
  ['5.3.1987', '5.3.1987'],
  ['20.08.2026', '20.08.2026'],
  ['20abc08', '20.08'],
  ['ггг', ''],
  ['20..08', '20.08'],
  ['', ''],
]
for (const [input, expected] of masks) {
  const got = maskDateText(input)
  const ok = got === expected
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'ПЛОХО'} ${JSON.stringify(input).padEnd(14)} → ${JSON.stringify(got).padEnd(14)} ${ok ? '' : `(ждали ${JSON.stringify(expected)})`}`)
}

console.log('\n── Обратный показ ──')
for (const iso of ['2026-08-20', '1987-03-05', '2026-01-01']) {
  const shown = formatDateInput(iso)
  const back = parseDateInput(shown, TODAY)
  const ok = back === iso
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'ПЛОХО'} ${iso} → «${shown}» → ${back}`)
}

console.log('\n── Сдвиги ──')
const shifts: Array<[string, any, string]> = [
  ['2026-08-20', { days: 1 }, '2026-08-21'],
  ['2026-08-31', { days: 1 }, '2026-09-01'],
  ['2026-01-31', { months: 1 }, '2026-02-28'],
  ['2024-01-31', { months: 1 }, '2024-02-29'],
  ['2026-08-20', { years: -1 }, '2025-08-20'],
  ['2026-08-20', { days: 7 }, '2026-08-27'],
]
for (const [iso, delta, expected] of shifts) {
  const got = shiftIso(iso, delta, TODAY)
  const ok = got === expected
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'ПЛОХО'} ${iso} ${JSON.stringify(delta).padEnd(14)} → ${got} ${ok ? '' : `(ждали ${expected})`}`)
}

console.log('\n── Часовой пояс: вечер не должен сдвигать дату ──')
const evening = new Date(2026, 7, 20, 23, 45)
const tzOk = todayIso(evening) === '2026-08-20' && dateToIso(isoToDate('2026-08-20')!) === '2026-08-20'
if (!tzOk) bad++
console.log(`${tzOk ? 'OK  ' : 'ПЛОХО'} 20 августа 23:45 → ${todayIso(evening)}`)

console.log(`\n${bad === 0 ? 'ВСЁ СОШЛОСЬ' : `ОШИБОК: ${bad}`}\n`)
process.exit(bad ? 1 : 0)
