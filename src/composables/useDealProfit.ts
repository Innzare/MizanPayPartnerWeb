import { computed, ref, type Ref } from 'vue'
import { api } from '@/api/client'
import { formatCurrencyShort } from '@/utils/formatters'
import type { Deal, Payment } from '@/types'

/**
 * Прибыль по сделке и доли со-инвесторов.
 *
 * Вынесено со страницы сделки как есть, без единой правки в расчётах: это
 * самое запутанное место страницы (три режима участия, комиссия партнёра,
 * распределение по вкладу), и «заодно улучшать» его нельзя — цифры увидят
 * живые партнёры. Нужно двум вкладкам сразу — «Обзор» и «Со-инвесторы».
 */
// ── Co-Investors (Phase 4: read-only list of THIS deal's participants) ──
export interface CoInvestorInfo {
  id: string
  name: string
  phone: string | null
  profitPercent: number | null
  capital: number
  cashBoxId?: string
  // Phase 4 per-deal fields (present in the /co-investors/deal/:id response).
  managementFeePct?: number
  managementFeePctOverride?: number | null
  currentCapital?: number
  profitPercentOverride?: number | null
  // Fixed % that actually applies to THIS deal (override ?? default). null =
  // the CI takes a weight-based share.
  effectivePercent?: number | null
  // Phase 5: cost-fee — partner takes rate% of purchase, investor gets the rest.
  costFeeMode?: boolean
  costFeeDefaultRatePct?: number | null
  costFeeRatePct?: number | null
  }

export interface DealCoInvestorsResponse {
  cashBoxId: string | null
  partnerParticipatesByCapital: boolean
  partnerCapital?: number
  participants: CoInvestorInfo[]
  available: CoInvestorInfo[]
}

/**
 * @param dealId идентификатор из адреса страницы. Именно он, а не `deal.id`:
 *        сделка приходит из стора асинхронно, и на прямом заходе её ещё нет —
 *        запрос ушёл бы с «undefined», доли инвесторов не загрузились бы, а
 *        партнёр увидел бы всю прибыль своей.
 */
export function useDealProfit(
  deal: Ref<Deal | undefined>,
  payments: Ref<Payment[]>,
  dealId: Ref<string>,
) {
  // `dealCoInvestors` now holds the CIs of this deal's cashbox — they all
  // participate by virtue of cashbox membership, there's no per-deal link.
  const dealCoInvestors = ref<CoInvestorInfo[]>([])
  // Pool inputs for computing a weight (по вкладу) investor's exact share.
  const dealPartnerParticipates = ref(true)
  const dealPartnerCapital = ref(0)
  const coInvestorLoading = ref(false)

  // Cost-fee комиссия партнёра с этой сделки = min(ставка% × закупка, база).
  // База по умолчанию — splitBase (наценка или полная маржа при FULL_MARGIN),
  // чтобы совпадать с бэком, который считает от profitBase.
  function costFeeBaseAmount(): number {
    return dealProfitBreakdown.value?.splitBase ?? deal.value?.markup ?? 0
  }
  function costFeePartnerFee(ci: CoInvestorInfo, base = costFeeBaseAmount()): number {
    const d = deal.value
    if (!d) return 0
    const rate = ci.costFeeRatePct ?? ci.costFeeDefaultRatePct ?? 0
    return Math.min(Math.round((rate / 100) * (d.purchasePrice || 0)), base)
  }
  // Cost-fee: сумма инвестору с этой сделки = база − комиссия партнёра.
  function costFeeInvestorAmount(ci: CoInvestorInfo, base = costFeeBaseAmount()): number {
    return Math.max(0, base - costFeePartnerFee(ci, base))
  }
  // Доля ЛЮБОГО со-инвестора в этой сделке (фикс / по вкладу / cost-fee) —
  // из единой карты, посчитанной в dealProfitBreakdown как в движке.
  function ciDealShare(ci: CoInvestorInfo): number {
    return dealProfitBreakdown.value?.shares[ci.id] ?? 0
  }
  // Основание доли инвестора в этой сделке (способ деления).
  function ciModeLabel(ci: CoInvestorInfo): string {
    if (ci.costFeeMode || ci.costFeeRatePct != null) return 'Комиссия от закупки'
    const eff = ci.effectivePercent ?? ci.profitPercent
    if (eff != null && eff > 0) return `Фикс ${eff}%${ci.profitPercentOverride != null ? ' (в сделке)' : ''}`
    const fee = ci.managementFeePctOverride ?? ci.managementFeePct ?? 0
    return `По вкладу${fee > 0 ? ` · комиссия ${fee}%${ci.managementFeePctOverride != null ? ' (в сделке)' : ''}` : ''}`
  }
  // Числовая формула, откуда взялась сумма инвестора (как в разделе «Чистая
  // прибыль» кассы): «30% от 15К», «≈14% от 15К по вкладу», «15К − 5К (доля партнёра)».
  function ciFormula(ci: CoInvestorInfo): string {
    const base = dealProfitBreakdown.value?.splitBase ?? 0
    if (base <= 0) return ''
    if (ci.costFeeMode || ci.costFeeRatePct != null) {
      return `${formatCurrencyShort(base)} − ${formatCurrencyShort(costFeePartnerFee(ci, base))} (доля партнёра)`
    }
    const eff = ci.effectivePercent ?? ci.profitPercent
    if (eff != null && eff > 0) return `${eff}% от ${formatCurrencyShort(base)}`
    const pct = Math.round((ciDealShare(ci) / base) * 100)
    return `≈${pct}% от ${formatCurrencyShort(base)} по вкладу`
  }

  async function loadCoInvestors() {
    try {
      // Phase 4: endpoint returns an object; participants = THIS deal's linked CIs.
      const res = await api.get<DealCoInvestorsResponse>(`/co-investors/deal/${dealId.value}`)
      dealCoInvestors.value = Array.isArray(res?.participants) ? res.participants : []
      dealPartnerParticipates.value = res?.partnerParticipatesByCapital ?? true
      dealPartnerCapital.value = res?.partnerCapital ?? 0
    } catch { dealCoInvestors.value = [] }
  }
  // Financial calculations
  const paidTotal = computed(() =>
    payments.value.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0)
  )
  const totalPaid = computed(() => paidTotal.value + (deal.value?.downPayment || 0))
  /**
   * Breakdown of partner's profit on this specific deal:
   *
   *   - retailMargin = purchasePrice − wholesalePrice (when wholesalePrice
   *     set; else 0). Always belongs to partner unless FULL_MARGIN mode
   *     is enabled, in which case it goes into the split pool.
   *   - installmentMargin = totalPrice − purchasePrice (= deal.markup).
   *     Always shared with co-investors per their profitPercent.
   *   - splitBase = what's actually divided with CI based on profitSplitBase.
   *   - ciAmount = sum of (splitBase × profitPercent / 100) across all
   *     PER_DEAL CIs linked to this deal. POOL CIs are not included
   *     here — their share comes from a separate flow that depends on
   *     pool weights, which the deal page doesn't have data for.
   *
   * `realizedPartner` scales totalPartner by the fraction of totalPrice
   * actually received so far (paid payments + downPayment). Mirrors the
   * server-side accrual ratio so partner sees a number that matches
   * what they'd see in /finance after every payment is marked paid.
   */
  const dealProfitBreakdown = computed(() => {
    if (!deal.value) return null
    const d = deal.value
    const wholesale = d.wholesalePrice ?? 0
    const useWholesale = wholesale > 0
    const retailMargin = useWholesale ? Math.max(0, d.purchasePrice - wholesale) : 0
    const installmentMargin = d.markup
    const isFullMargin = d.profitSplitBase === 'FULL_MARGIN' && useWholesale

    // What gets split with PER_DEAL co-investors
    const splitBase = isFullMargin ? retailMargin + installmentMargin : installmentMargin

    // Sum of percent across PER_DEAL CIs (POOL handled separately, not
    // displayed in this card — the partner has /co-investors for that).
    // Cost-fee investors have no percent (both effectivePercent & profitPercent
    // are null): their share is a fixed amount (наценка − комиссия партнёра),
    // computed separately and added to the CI pool below.
    const isCostFee = (ci: CoInvestorInfo) => ci.costFeeMode || ci.costFeeRatePct != null
    const percentCIs = dealCoInvestors.value.filter((ci) => !isCostFee(ci))
    const costFeeCIs = dealCoInvestors.value.filter(isCostFee)

    // Per-CI share amount (id → ₽) so both the total and the per-investor cards
    // read the SAME numbers. Mirrors the engine: fixed % first, then the by-capital
    // pool splits the remainder (minus each weight CI's management fee).
    const shares: Record<string, number> = {}

    // 1) Fixed-% CIs take their percent of the split base.
    const fixedCIs = percentCIs.filter((ci) => (ci.effectivePercent ?? ci.profitPercent ?? 0) > 0)
    const ciTotalPercent = fixedCIs.reduce((s, ci) => s + (ci.effectivePercent ?? ci.profitPercent ?? 0), 0)
    const ciPercentAmount = Math.round((splitBase * ciTotalPercent) / 100)
    for (const ci of fixedCIs) shares[ci.id] = Math.round((splitBase * (ci.effectivePercent ?? ci.profitPercent ?? 0)) / 100)

    // 2) Cost-fee CIs (fixed «наценка − комиссия партнёра» amount).
    // Pass splitBase explicitly — costFeeBaseAmount() reads dealProfitBreakdown,
    // which is exactly the computed we're inside (would recurse).
    const ciCostFeeAmount = costFeeCIs.reduce((s, ci) => {
      const amt = costFeeInvestorAmount(ci, splitBase)
      shares[ci.id] = amt
      return s + amt
    }, 0)

    // 3) By-capital («по вкладу») CIs split whatever the fixed CIs left, weighted
    // by their capital vs the pool (Σ their capital + partner's capital if the
    // partner participates by capital), minus each CI's per-deal management fee.
    const weightCIs = percentCIs.filter(
      (ci) => (ci.effectivePercent ?? ci.profitPercent) == null && (ci.currentCapital ?? 0) > 0,
    )
    let ciWeightAmount = 0
    if (weightCIs.length) {
      const remaining = Math.max(0, splitBase - ciPercentAmount)
      const pool = weightCIs.reduce((s, ci) => s + (ci.currentCapital ?? 0), 0)
        + (dealPartnerParticipates.value ? dealPartnerCapital.value : 0)
      if (remaining > 0 && pool > 0) {
        for (const ci of weightCIs) {
          const fee = ci.managementFeePctOverride ?? ci.managementFeePct ?? 0
          const amt = Math.round(remaining * ((ci.currentCapital ?? 0) / pool) * (1 - fee / 100))
          shares[ci.id] = amt
          ciWeightAmount += amt
        }
      }
    }

    const ciAmount = ciPercentAmount + ciCostFeeAmount + ciWeightAmount
    const hasCiShare = ciAmount > 0

    const partnerFromSplit = splitBase - ciAmount
    const partnerRetailDirect = isFullMargin ? 0 : retailMargin
    const totalPartner = partnerRetailDirect + partnerFromSplit

    // Realized fraction — how much of the deal's totalPrice has come in
    // (downPayment + paid payments). 1.0 = fully completed.
    const ratio = d.totalPrice > 0 ? totalPaid.value / d.totalPrice : 0
    const realizedPartner = Math.round(totalPartner * Math.min(1, Math.max(0, ratio)))

    return {
      useWholesale,
      isFullMargin,
      retailMargin,
      installmentMargin,
      splitBase,
      ciTotalPercent,
      ciAmount,
      ciPercentAmount,
      ciCostFeeAmount,
      ciWeightAmount,
      shares,
      hasWeight: weightCIs.length > 0,
      hasCiShare,
      partnerRetailDirect,
      partnerFromSplit,
      totalPartner,
      realizedPartner,
      progressPercent: Math.round(Math.min(1, Math.max(0, ratio)) * 100),
    }
  })

  return {
    dealCoInvestors,
    dealPartnerParticipates,
    dealPartnerCapital,
    loadCoInvestors,
    paidTotal,
    totalPaid,
    dealProfitBreakdown,
    ciDealShare,
    ciModeLabel,
    ciFormula,
    costFeeBaseAmount,
    costFeePartnerFee,
    costFeeInvestorAmount,
  }
}
