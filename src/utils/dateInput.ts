/**
 * Разбор и формат даты для поля ввода.
 *
 * Единица хранения во всём приложении — строка `YYYY-MM-DD` (календарная дата
 * без времени и часового пояса), пусто — `''`. Ровно так работало нативное
 * `<input type="date">`, и менять этот контракт нельзя: строка уходит в
 * платежи, графики и отчёты.
 *
 * Здесь намеренно НЕ используется `toISOString()`: он переводит дату в UTC, и
 * вечером по Москве 20 августа превращается в 19-е. Все преобразования идут
 * через локальные `getFullYear/getMonth/getDate`.
 */

/** Строка `YYYY-MM-DD` → `Date` в локальном времени (полночь). */
export function isoToDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  // Отсекаем «31 февраля»: JS молча перекатывает такую дату на март.
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    return null
  }
  return date
}

/** `Date` → строка `YYYY-MM-DD` по локальному календарю. */
export function dateToIso(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** Сегодняшняя дата строкой. Считается локально, а не по UTC. */
export function todayIso(now: Date = new Date()): string {
  return dateToIso(now)
}

/** Показ в поле: `2026-08-20` → `20.08.2026`. Пусто остаётся пустым. */
export function formatDateInput(iso: string): string {
  const date = isoToDate(iso)
  if (!date) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()}`
}

/**
 * Двузначный год: 00–69 — двухтысячные, 70–99 — прошлый век.
 * Порог выбран под даты рождения: «5.3.87» — это 1987 год, а не 2087.
 */
function expandYear(yy: number): number {
  return yy <= 69 ? 2000 + yy : 1900 + yy
}

/**
 * Разбор того, что напечатал человек.
 *
 * Принимаем всё разумное:
 *   `20.08.2026`, `20/08/2026`, `20-08-2026`, `20082026` — полная дата;
 *   `20.08.26`, `200826` — двузначный год;
 *   `20.08`, `2008` — текущий год;
 *   `20` — текущие месяц и год.
 *
 * Возвращаем `YYYY-MM-DD` либо `null`, если разобрать нечего или дата
 * несуществующая. Ничего не «доугадываем»: `31.02` — это null, а не 3 марта.
 */
export function parseDateInput(raw: string, today: Date = new Date()): string | null {
  const value = (raw || '').trim()
  if (!value) return null

  // Разделителем считаем любой из привычных; всё остальное — мусор.
  if (/[^\d.,/\s-]/.test(value)) return null

  const parts = value.split(/[.,/\s-]+/).filter(Boolean)
  // «1.2.3.4» — не дата: молча взять первые три части значило бы подставить
  // человеку не то, что он набрал.
  if (parts.length > 3) return null
  let day: number, month: number, year: number

  if (parts.length >= 2) {
    day = Number(parts[0] ?? '')
    month = Number(parts[1] ?? '')
    const rawYear: string | undefined = parts[2]
    if (rawYear === undefined || rawYear === '') year = today.getFullYear()
    else if (rawYear.length <= 2) year = expandYear(Number(rawYear))
    else if (rawYear.length === 4) year = Number(rawYear)
    else return null
  } else {
    // Сплошные цифры: длина подсказывает, что именно ввели.
    const digits = parts[0] ?? ''
    if (!/^\d+$/.test(digits)) return null
    if (digits.length <= 2) {
      day = Number(digits)
      month = today.getMonth() + 1
      year = today.getFullYear()
    } else if (digits.length === 3) {
      // «512» — 5 января? 51 декабря? Двусмысленно, не гадаем.
      return null
    } else if (digits.length === 4) {
      day = Number(digits.slice(0, 2))
      month = Number(digits.slice(2, 4))
      year = today.getFullYear()
    } else if (digits.length === 6) {
      day = Number(digits.slice(0, 2))
      month = Number(digits.slice(2, 4))
      year = expandYear(Number(digits.slice(4, 6)))
    } else if (digits.length === 8) {
      day = Number(digits.slice(0, 2))
      month = Number(digits.slice(2, 4))
      year = Number(digits.slice(4, 8))
    } else {
      return null
    }
  }

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  if (year < 1900 || year > 2200) return null

  const p = (n: number) => String(n).padStart(2, '0')
  const iso = `${year}-${p(month)}-${p(day)}`
  // Проверка существования даты — «31.02.2026» отсеется здесь.
  return isoToDate(iso) ? iso : null
}

/**
 * Подстановка точек по ходу ввода и отсев лишних символов.
 *
 * Буквы и знаки в поле даты не нужны — их просто не пропускаем. Точки человек
 * может ставить сам («5.3.87»), а может не ставить вовсе («20082026») — во
 * втором случае расставляем их за него, как только становится ясно, что цифры
 * уже не поместятся в текущую часть.
 *
 * Незавершённый ввод не «дочиняем»: набрано «20» — так и остаётся «20», без
 * навязчивой точки в хвосте.
 */
export function maskDateText(raw: string): string {
  const cleaned = (raw || '').replace(/[^\d.]/g, '')
  if (!cleaned) return ''

  const keepTrailingDot = cleaned.endsWith('.')
  const chunks = cleaned.split('.').filter((c, i) => c !== '' || i === 0)

  let day = chunks[0] ?? ''
  let month = chunks[1]
  let year = chunks[2]

  // Точек человек не ставил — разрезаем сплошные цифры сами.
  if (month === undefined && day.length > 2) {
    month = day.slice(2)
    day = day.slice(0, 2)
  }
  if (year === undefined && month !== undefined && month.length > 2) {
    year = month.slice(2)
    month = month.slice(0, 2)
  }

  day = day.slice(0, 2)
  if (month !== undefined) month = month.slice(0, 2)
  if (year !== undefined) year = year.slice(0, 4)

  const parts = [day]
  if (month !== undefined) parts.push(month)
  if (year !== undefined) parts.push(year)

  let out = parts.join('.')
  // «20.» — человек только что поставил точку сам, не отбираем её.
  if (keepTrailingDot && !out.endsWith('.') && parts.length < 3) out += '.'
  return out
}

/** Сдвиг даты для стрелок и быстрых кнопок. Пустая дата отсчитывается от сегодня. */
export function shiftIso(
  iso: string,
  delta: { days?: number; months?: number; years?: number },
  today: Date = new Date(),
): string {
  const base = isoToDate(iso) ?? new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  if (delta.years) date.setFullYear(date.getFullYear() + delta.years)
  if (delta.months) {
    const targetDay = date.getDate()
    date.setDate(1)
    date.setMonth(date.getMonth() + delta.months)
    // «31 января + месяц» — это конец февраля, а не 3 марта.
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(targetDay, lastDay))
  }
  if (delta.days) date.setDate(date.getDate() + delta.days)
  return dateToIso(date)
}

/** Дата словами — для подсказки под полем и для скринридера. */
export function describeIso(iso: string): string {
  const date = isoToDate(iso)
  if (!date) return ''
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  })
}

/** Не выходит ли дата за границы `min`/`max` (обе — строки `YYYY-MM-DD`). */
export function isWithin(iso: string, min?: string | null, max?: string | null): boolean {
  if (!iso) return true
  if (min && iso < min) return false
  if (max && iso > max) return false
  return true
}
