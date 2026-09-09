/**
 * Телефон в вебе: та же логика, что на сервере.
 *
 * Хранимое значение — E.164: «+» и только цифры. Российские номера так
 * хранились и раньше, поэтому существующие записи не меняются.
 *
 * Зеркало серверного `src/common/phone.util.ts` — правила обязаны совпадать,
 * иначе форма примет номер, который сервер отвергнет (или наоборот).
 */
import { PHONE_COUNTRIES, type PhoneCountry } from '@/constants/phone-countries'

export type { PhoneCountry }
export { PHONE_COUNTRIES }

/** Страна по умолчанию — подавляющее большинство клиентов российские. */
export const DEFAULT_COUNTRY_ISO = 'RU'

const BY_ISO = new Map(PHONE_COUNTRIES.map((c) => [c.iso, c]))
/** Коды от длинного к короткому: «+375» должен победить «+37». */
const DIALS_DESC = [...new Set(PHONE_COUNTRIES.map((c) => c.dial.replace('+', '')))].sort(
  (a, b) => b.length - a.length,
)

export function countryByIso(iso: string): PhoneCountry {
  return BY_ISO.get(iso) ?? BY_ISO.get(DEFAULT_COUNTRY_ISO)!
}

/** Только цифры. */
export function phoneDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '')
}

/**
 * Какой стране принадлежит номер.
 *
 * У России и Казахстана общий код +7, различаем по следующей цифре: «+77…» —
 * Казахстан. Это влияет только на флаг в поле, на сам номер — нет.
 */
export function detectCountry(e164: string): PhoneCountry {
  const digits = phoneDigits(e164)
  if (!digits) return countryByIso(DEFAULT_COUNTRY_ISO)
  if (digits.startsWith('7')) {
    return countryByIso(digits.startsWith('77') ? 'KZ' : 'RU')
  }
  for (const dial of DIALS_DESC) {
    if (digits.startsWith(dial)) {
      const country = PHONE_COUNTRIES.find((c) => c.dial.replace('+', '') === dial)
      if (country) return country
    }
  }
  return countryByIso(DEFAULT_COUNTRY_ISO)
}

/** Национальная часть номера — то, что человек видит в поле после кода. */
export function nationalPart(e164: string, country: PhoneCountry): string {
  const digits = phoneDigits(e164)
  const dial = country.dial.replace('+', '')
  return digits.startsWith(dial) ? digits.slice(dial.length) : digits
}

/** Национальная часть + страна → значение для хранения. */
export function toE164(national: string, country: PhoneCountry): string {
  const digits = phoneDigits(national)
  if (!digits) return ''
  return country.dial + digits
}

/**
 * Достаточно ли цифр, чтобы считать номер введённым.
 *
 * Длину берём из справочника, но с допуском в одну цифру: планы нумерации
 * меняются, и упереться в устаревшую маску хуже, чем принять номер.
 */
export function isCompletePhone(e164: string): boolean {
  const digits = phoneDigits(e164)
  if (digits.length < 8) return false
  const country = detectCountry(e164)
  const national = nationalPart(e164, country)
  // Российский и казахский номер — ровно десять цифр после кода. Здесь
  // допусков нет: сервер тоже строг, и поле не должно принимать то, что он
  // отвергнет с ошибкой.
  if (country.dial === '+7') return national.length === 10
  if (!country.lengths.length) return national.length >= 6
  return country.lengths.some((len) => Math.abs(len - national.length) <= 1)
}

/** Показ номера по маске страны: «+7 (928) 123-45-67». */
export function formatE164(e164: string): string {
  const digits = phoneDigits(e164)
  if (!digits) return ''
  const country = detectCountry(e164)
  const national = nationalPart(e164, country)
  let out = ''
  let i = 0
  for (const ch of country.mask) {
    if (i >= national.length) break
    if (ch === '#') {
      out += national[i]
      i++
    } else {
      out += ch
    }
  }
  // Цифры, не поместившиеся в маску, дописываем как есть — номер важнее
  // красоты, терять хвост нельзя.
  if (i < national.length) out += national.slice(i)
  return `${country.dial} ${out}`.trim()
}

/**
 * Разбор произвольной записи номера в «страна + национальная часть».
 *
 * Работает и для того, что уже лежит в базе: у со-инвесторов телефоны
 * сохранены как «+7 (963) 984-44-42», у партнёров — голыми десятью цифрами.
 * Без этого разбора «9639844442» опознавалось бы как код Сирии (+963), и в
 * поле подставлялся бы чужой флаг, а при сохранении портился номер.
 */
export function parsePhoneLoose(raw: string): { country: PhoneCountry; national: string } | null {
  const trimmed = (raw || '').trim()
  const digits = phoneDigits(trimmed)
  if (!digits) return null

  // Записи без плюса читаем по российским правилам — как это делает сервер.
  if (!trimmed.startsWith('+')) {
    if (digits.length === 10) return { country: countryByIso('RU'), national: digits }
    if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
      return { country: countryByIso('RU'), national: digits.slice(1) }
    }
    return null
  }

  if (digits.length < 8) return null
  // «+8XXXXXXXXXX» — кода страны «+8» не существует, это привычная восьмёрка.
  if (digits.length === 11 && digits.startsWith('8')) {
    return { country: countryByIso('RU'), national: digits.slice(1) }
  }
  const country = detectCountry('+' + digits)
  return { country, national: nationalPart('+' + digits, country) }
}

/** Прежнее имя — оставлено, чтобы не плодить правки на местах вызова. */
export const parsePastedPhone = parsePhoneLoose
