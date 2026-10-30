/**
 * Строки для колонок с телефонами в «Сделках» и «Должниках» — в одном виде
 * для компонента PhoneLines: номер и подпись под ним (чей номер).
 */
import type { ExtraPhone, GuarantorExtraPhones, GuarantorListItem } from '@/types'

export type PhoneLine = { phone: string; caption?: string | null }

/** Один основной номер. */
export function phoneItems(phone: string | null | undefined): PhoneLine[] {
  return phone ? [{ phone }] : []
}

/** Дополнительные номера: подпись — чей номер («жена», «работа»). */
export function extraPhoneItems(list: ExtraPhone[] | null | undefined): PhoneLine[] {
  return (list ?? []).map((p) => ({ phone: p.phone, caption: p.label }))
}

/** Основные номера поручителей: подпись — имя, иначе не понять, чей номер. */
export function guarantorPhoneItems(list: GuarantorListItem[] | null | undefined): PhoneLine[] {
  return (list ?? []).filter((g) => g.phone).map((g) => ({ phone: g.phone!, caption: g.name }))
}

/** Дополнительные номера поручителей: имя, а если номер подписан — и чей он. */
export function guarantorExtraPhoneItems(list: GuarantorExtraPhones[] | null | undefined): PhoneLine[] {
  return (list ?? []).flatMap((g) =>
    g.phones.map((p) => ({ phone: p.phone, caption: p.label ? `${g.name} · ${p.label}` : g.name })),
  )
}
