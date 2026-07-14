import type { ClientProfile, Deal } from '@/types'

// Единый источник списка поручителей для договоров и UI.
// Сначала берём новый упорядоченный `deal.guarantors` (order 0 = основной),
// а при его отсутствии — legacy-поле `deal.guarantorProfile` (один поручитель).
// Так генерация не ломается для старых сделок и сделок без поручителей.
export function dealGuarantors(deal: Pick<Deal, 'guarantors' | 'guarantorProfile'>): ClientProfile[] {
  if (deal.guarantors && deal.guarantors.length > 0) {
    return [...deal.guarantors]
      .sort((a, b) => a.order - b.order)
      .map((g) => g.clientProfile)
      .filter((p): p is ClientProfile => !!p)
  }
  return deal.guarantorProfile ? [deal.guarantorProfile] : []
}

// Основной поручитель (первый) — для одиночных плейсхолдеров/legacy-шаблонов.
export function primaryGuarantor(deal: Pick<Deal, 'guarantors' | 'guarantorProfile'>): ClientProfile | null {
  return dealGuarantors(deal)[0] ?? null
}
