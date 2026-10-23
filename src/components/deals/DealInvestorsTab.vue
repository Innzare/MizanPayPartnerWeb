<script setup lang="ts">
/**
 * Со-инвесторы сделки.
 *
 * Список только для чтения: участие вытекает из кассы — каждый инвестор кассы
 * делит прибыль этой сделки. Чтобы изменить состав, партнёр меняет кассу
 * сделки или переводит инвестора в другую кассу.
 *
 * Перенесено со страницы сделки без изменений. Расчёт долей — общий модуль
 * useDealProfit, тот же, что питает «Обзор».
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSections } from '@/composables/useSections'
import { useIsMobile } from '@/composables/useIsMobile'
import { formatCurrency, formatCurrencyShort, formatDateShortYear, formatPercent } from '@/utils/formatters'
import type { Deal } from '@/types'
import type { useDealProfit } from '@/composables/useDealProfit'

const props = defineProps<{ deal: Deal; profit: ReturnType<typeof useDealProfit> }>()

const router = useRouter()
// Телефон: подпись способа деления короче — иначе процент обрезался.
const { isMobile } = useIsMobile()
const sections = useSections()

const deal = computed(() => props.deal)
const {
  dealCoInvestors,
  dealPartnerParticipates,
  dealPartnerCapital,
  dealProfitBreakdown,
  ciDealShare,
  ciModeLabel,
  ciFormula,
  costFeeInvestorAmount,
} = props.profit
</script>

<template>
  <!-- Состав участников вытекает из кассы: каждый инвестор кассы делит прибыль
       этой сделки. Чтобы изменить состав, партнёр меняет кассу сделки или
       переводит инвестора в другую кассу — отсюда список только для чтения.
       Оформление то же, что у вкладки «Прибыль»: это одна и та же тема денег
       партнёра, и разнобой между вкладками только сбивал бы. -->
  <v-card
    v-if="!deal.deletedAt && sections.visible('coInvestors')"
    rounded="lg"
    elevation="0"
    border
    class="pa-6"
  >
    <div class="iv-head">
      <div>
        <div class="iv-title">Инвесторы</div>
        <div class="iv-sub">
          <template v-if="dealCoInvestors.length">
            Делят прибыль этой сделки. Состав задаётся кассой сделки
          </template>
          <template v-else>В кассе этой сделки инвесторов нет</template>
        </div>
      </div>
      <div v-if="dealCoInvestors.length && dealProfitBreakdown" class="iv-total">
        <div class="iv-total-label">Инвесторам всего</div>
        <div class="iv-total-value">{{ formatCurrency(dealProfitBreakdown.ciAmount) }}</div>
      </div>
    </div>

    <div v-if="dealCoInvestors.length" class="iv-rows">
      <!-- По строке можно перейти в карточку инвестора: оттуда виден весь его
           капитал и участие в других сделках. -->
      <div
        v-for="ci in dealCoInvestors"
        :key="ci.id"
        class="iv-row"
        role="button"
        tabindex="0"
        @click="router.push(`/co-investors/person/${ci.id}`)"
        @keyup.enter="router.push(`/co-investors/person/${ci.id}`)"
      >
        <div class="iv-person">
          <div class="iv-avatar">
            {{ ci.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2) }}
          </div>
          <div class="iv-person-text">
            <div class="iv-name">{{ ci.name }}</div>
            <div v-if="ci.phone" class="iv-phone">{{ ci.phone }}</div>
            <!-- Подключён позже создания сделки («во всех сделках кассы»):
                 оплаты до этой даты делятся без него. -->
            <div v-if="ci.activeFrom" class="iv-phone">Участвует с {{ formatDateShortYear(ci.activeFrom) }}</div>
          </div>
        </div>

        <!-- Способ деления словами: «40% от прибыли» понятнее названия режима -->
        <div class="iv-mode">
          <template v-if="ci.costFeeMode || ci.costFeeRatePct != null">
            Комиссия партнёра от закупки
            <span class="iv-mode-hint">инвестору — остаток прибыли</span>
          </template>
          <template
            v-else-if="(ci.effectivePercent ?? ci.profitPercent) != null && (ci.effectivePercent ?? ci.profitPercent)! > 0"
          >
            {{ ci.effectivePercent ?? ci.profitPercent }}% от прибыли
            <span v-if="ci.profitPercentOverride != null" class="iv-mode-hint">
              особый процент для этой сделки
            </span>
          </template>
          <template v-else>
            По размеру вклада
            <span
              v-if="(ci.managementFeePctOverride ?? ci.managementFeePct ?? 0) > 0"
              class="iv-mode-hint"
            >
              {{ isMobile ? 'комиссия' : 'комиссия партнёра' }} {{ ci.managementFeePctOverride ?? ci.managementFeePct }}%<template
                v-if="ci.managementFeePctOverride != null"
              > (для этой сделки)</template>
            </span>
          </template>
        </div>

        <div class="iv-amount">
          <div class="iv-amount-value">
            {{
              formatCurrency(
                ci.costFeeMode || ci.costFeeRatePct != null
                  ? costFeeInvestorAmount(ci)
                  : ciDealShare(ci),
              )
            }}
          </div>
          <!-- При комиссионной схеме инвестор получает ещё и свою закупку
               обратно — иначе цифра «на руки» непонятна. -->
          <div v-if="ci.costFeeMode || ci.costFeeRatePct != null" class="iv-payout">
            на руки {{ formatCurrency(deal.purchasePrice + ciDealShare(ci)) }} с возвратом закупки
          </div>
        </div>

        <v-icon icon="mdi-chevron-right" size="20" class="iv-go" />
      </div>

      <div v-if="dealProfitBreakdown" class="iv-partner">
        <span class="iv-partner-label">Остаётся вам</span>
        <span class="iv-partner-value">{{ formatCurrency(dealProfitBreakdown.totalPartner) }}</span>
      </div>
    </div>

    <div v-else class="iv-empty">
      <v-icon icon="mdi-account-group-outline" size="34" class="mb-2" />
      <div class="iv-empty-title">В кассе этой сделки инвесторов нет</div>
      <div class="iv-empty-hint">
        Прибыль полностью ваша. Чтобы добавить инвестора, откройте раздел «Инвесторы»
      </div>
    </div>
  </v-card>
</template>

<style scoped>
/* Обычная белая карточка: зелёная подложка делала блок нарядным, но числа на
   ней читались хуже, а вкладка «Прибыль» рядом уже занимает этот приём. */
.iv-head {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.iv-title {
  font-size: 19px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.iv-sub {
  font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.iv-total {
  margin-left: auto;
  text-align: right;
}
.iv-total-label {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.iv-total-value {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.iv-rows {
  display: flex;
  flex-direction: column;
}
.iv-row {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 14px 10px;
  margin: 0 -10px;
  flex-wrap: wrap;
  cursor: pointer;
  transition: background 0.15s;
}
.iv-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.iv-row:hover .iv-go {
  color: rgb(var(--v-theme-primary));
}
.iv-row + .iv-row {
  box-shadow: inset 0 1px 0 rgba(var(--v-theme-on-surface), 0.07);
}
.iv-person {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 210px;
  flex: 1;
}
.iv-avatar {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 12px;
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
}
.iv-person-text {
  min-width: 0;
}
.iv-name {
  font-size: 16px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.iv-phone {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.iv-mode {
  flex: 1.2;
  min-width: 200px;
  font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.iv-mode-hint {
  display: block;
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 1px;
}
.iv-amount {
  margin-left: auto;
  text-align: right;
  min-width: 150px;
}
.iv-amount-value {
  font-size: 16px;
  font-weight: 800;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.iv-payout {
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.iv-go {
  color: rgba(var(--v-theme-on-surface), 0.25);
  transition: color 0.15s;
}
/* Что остаётся партнёру — итог всего списка, поэтому отделён и крупнее. */
.iv-partner {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 2px solid rgba(var(--v-theme-on-surface), 0.12);
}
.iv-partner-label {
  font-size: 15px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.iv-partner-value {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #047857;
}
.iv-empty {
  text-align: center;
  padding: 28px 0 8px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.iv-empty-title {
  font-size: 16px;
  font-weight: 600;
}
.iv-empty-hint {
  font-size: 13.5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 4px;
}

/* ══ Телефон ══
   Инвестор — одна плотная строка: значок, имя и под ним способ деления,
   справа сумма. Раньше способ и сумма падали на отдельные строки, и каждый
   инвестор занимал полэкрана. */
@media (max-width: 767px) {
  .v-card.pa-6 { padding: 14px 0 12px !important; }
  .iv-head { flex-wrap: nowrap; gap: 12px; margin-bottom: 8px; padding: 0 16px; }
  .iv-title { font-size: 17px; }
  .iv-sub { font-size: 12.5px; line-height: 1.35; }
  .iv-total-label { font-size: 11.5px; white-space: nowrap; }
  .iv-total-value { font-size: 17px; white-space: nowrap; }

  .iv-rows { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
  .iv-row {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto 16px;
    grid-template-areas:
      "av name amt go"
      "av mode amt go";
    column-gap: 10px; row-gap: 1px;
    align-items: center;
    margin: 0; padding: 9px 16px;
  }
  .iv-row:active { background: rgba(var(--v-theme-on-surface), 0.04); }
  .iv-person { display: contents; }
  .iv-avatar { grid-area: av; width: 32px; height: 32px; min-width: 32px; border-radius: 10px; font-size: 12px; }
  .iv-person-text { grid-area: name; min-width: 0; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
  .iv-name { font-size: 14.5px; font-weight: 600; }
  .iv-phone { font-size: 11.5px; }
  .iv-mode {
    grid-area: mode; min-width: 0; flex: none;
    font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .iv-mode-hint { display: inline; font-size: 12px; margin: 0; }
  .iv-mode-hint::before { content: ' · '; }
  .iv-amount { grid-area: amt; min-width: 0; margin-left: 0; }
  .iv-amount-value { font-size: 14.5px; font-weight: 700; }
  .iv-payout { font-size: 11px; max-width: 120px; line-height: 1.25; }
  .iv-go { grid-area: go; }
  .iv-partner { margin-top: 0; padding: 12px 16px 0; border-top-width: 1px; }
  .iv-partner-label { font-size: 14px; }
  .iv-partner-value { font-size: 18px; }
  .iv-empty { padding: 20px 16px 8px; }
}
</style>
