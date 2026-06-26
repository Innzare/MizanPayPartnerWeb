<script lang="ts" setup>
import { calculateBasic } from '@/utils/calculator'
import { formatCurrency, formatPercent, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import type { BasicCalculatorInputs, CalculatorResult } from '@/types'
import { useIsDark } from '@/composables/useIsDark'

const { isDark } = useIsDark()
const inputs = ref<BasicCalculatorInputs>({
  purchasePrice: 100000,
  markupType: 'percent',
  markupValue: 15,
  termMonths: 6,
  downPayment: 10000,
  paymentType: 'equal',
})

const result = computed<CalculatorResult>(() => calculateBasic(inputs.value))

const markupOptions = [10, 15, 20, 25, 30]
const termOptions = [3, 6, 9, 12, 18, 24]

const remainingAmount = computed(() => result.value.totalPrice - inputs.value.downPayment)
const downPaymentPercent = computed(() =>
  inputs.value.purchasePrice > 0
    ? ((inputs.value.downPayment / result.value.totalPrice) * 100).toFixed(0)
    : '0'
)

// Down-payment dual mode (rubles / percent), same UX as the markup field.
// `inputs.downPayment` stays the ₽ value calculateBasic reads. In percent mode
// it's the exact typed amount (`manualDp`) if present, otherwise derived from
// `dpPercent` and the live total price. `manualDp` mirrors the markup field's
// `manualTotalPrice` override: without it, percent rounding makes the displayed
// ₽ drift from what was typed (10 000 → 11 500) and the maska input snaps back.
const downPaymentType = ref<'fixed' | 'percent'>('fixed')
const dpPercent = ref(10)
const manualDp = ref<number | null>(null)
// Set when the partner tries to enter more than the total price. The value
// itself is clamped to the max, but we keep this flag so the error stays
// visible until they enter a valid amount.
const dpExceeded = ref(false)

// Re-derive the ₽ amount from the percent (when in percent mode) whenever the
// percent or total price changes. The exact-typed override takes precedence.
watch([dpPercent, manualDp, () => result.value.totalPrice, downPaymentType], () => {
  if (downPaymentType.value !== 'percent') return
  const total = result.value.totalPrice || 0
  if (manualDp.value !== null) {
    inputs.value.downPayment = total > 0 ? Math.min(manualDp.value, total) : manualDp.value
    return
  }
  let pct = dpPercent.value || 0
  if (pct < 0) pct = 0
  if (pct > 100) pct = 100
  inputs.value.downPayment = Math.round(total * pct / 100)
})

// Editing markup/total re-derives the amount from the percent and clears the
// stale over-limit warning (the new total may now accommodate the amount).
watch(() => result.value.totalPrice, () => { manualDp.value = null; dpExceeded.value = false })

function switchDownPaymentType(type: 'fixed' | 'percent') {
  if (downPaymentType.value === type) return
  const total = result.value.totalPrice || 0
  dpExceeded.value = false
  if (type === 'percent') {
    dpPercent.value = total > 0
      ? Math.min(100, Math.round(inputs.value.downPayment / total * 100 * 100) / 100)
      : 0
    manualDp.value = inputs.value.downPayment // keep the exact ₽ across the toggle
  }
  downPaymentType.value = type
}

const dpPercentModel = computed({
  get: () => dpPercent.value,
  set: (v: number | null) => {
    let pct = Number(v) || 0
    if (pct < 0) pct = 0
    dpExceeded.value = pct > 100 // attempted more than 100% of the total
    if (pct > 100) pct = 100
    dpPercent.value = pct
    manualDp.value = null // percent now drives the amount
  },
})

// ₽ field in percent mode — editing it stores the exact value (no rounding
// drift) and back-computes the percent for display. Over-total input is
// clamped to the total and flagged so the error shows.
const dpRublesModel = computed({
  get: () => inputs.value.downPayment,
  set: (rub: number) => {
    const total = result.value.totalPrice || 0
    let v = rub || 0
    if (v < 0) v = 0
    dpExceeded.value = total > 0 && v > total
    if (total > 0 && v > total) v = total
    manualDp.value = v
    dpPercent.value = total > 0 ? Math.round((v / total) * 100 * 100) / 100 : 0
  },
})

// Fixed-mode ₽ input — clamped to [0, totalPrice]; over-total is flagged.
function setDownPaymentFixed(value: number) {
  const total = result.value.totalPrice || 0
  let v = value > 0 ? value : 0
  dpExceeded.value = total > 0 && v > total
  if (total > 0 && v > total) v = total
  inputs.value.downPayment = v
}

const downPaymentError = computed(() => {
  const total = result.value.totalPrice || 0
  if (total <= 0) return ''
  if (dpExceeded.value || inputs.value.downPayment > total) {
    return `Взнос не может превышать итоговую цену (${formatCurrency(total)})`
  }
  return ''
})

// Total price ↔ markup sync
const totalPriceInput = computed(() => result.value.totalPrice || '')

function onTotalPriceInput(value: number) {
  if (!value || inputs.value.purchasePrice <= 0) return
  const markupAmount = value - inputs.value.purchasePrice
  if (markupAmount < 0) return
  if (inputs.value.markupType === 'percent') {
    inputs.value.markupValue = Math.round((markupAmount / inputs.value.purchasePrice) * 100 * 100) / 100
  } else {
    inputs.value.markupValue = markupAmount
  }
}

function switchMarkupType(type: 'percent' | 'fixed') {
  if (inputs.value.markupType === type) return
  const purchase = inputs.value.purchasePrice
  if (type === 'fixed') {
    inputs.value.markupValue = purchase > 0 ? Math.round(purchase * inputs.value.markupValue / 100) : 0
  } else {
    inputs.value.markupValue = purchase > 0 ? Math.round((inputs.value.markupValue / purchase) * 100) : 0
  }
  inputs.value.markupType = type
}

function reset() {
  inputs.value = {
    purchasePrice: 100000,
    markupType: 'percent',
    markupValue: 15,
    termMonths: 6,
    downPayment: 10000,
    paymentType: 'equal',
  }
  downPaymentType.value = 'fixed'
  dpPercent.value = 10
  manualDp.value = null
  dpExceeded.value = false
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Page header -->
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-icon-wrap">
          <v-icon icon="mdi-calculator-variant-outline" size="22" />
        </div>
        <div>
          <div class="page-title">Калькулятор</div>
          <div class="page-subtitle">Рассчитайте условия рассрочки</div>
        </div>
      </div>
      <button class="btn-text" @click="reset">
        <v-icon icon="mdi-refresh" size="16" />
        Сбросить
      </button>
    </div>

    <v-row>
      <!-- Inputs -->
      <v-col cols="12" lg="7">
        <v-card rounded="lg" elevation="0" border class="pa-5 mb-4">
          <div class="section-header">
            <div class="section-header-left">
              <v-icon icon="mdi-tune-variant" size="18" />
              <span>Параметры сделки</span>
            </div>
          </div>

          <!-- Purchase price -->
          <div class="form-field mb-4">
            <label class="field-label">Закупочная цена <span class="required">*</span></label>
            <div class="input-with-suffix">
              <input
                :value="inputs.purchasePrice || ''"
                v-maska="CURRENCY_MASK"
                @maska="(e: any) => inputs.purchasePrice = parseMasked(e)"
                type="text"
                inputmode="numeric"
                class="field-input"
                placeholder="100 000"
              />
              <span class="input-suffix">₽</span>
            </div>
          </div>

          <!-- Markup -->
          <div class="form-field mb-4">
            <div class="field-label-row">
              <label class="field-label">Наценка</label>
              <div class="markup-type-toggle">
                <button
                  class="toggle-btn"
                  :class="{ active: inputs.markupType === 'percent' }"
                  @click="switchMarkupType('percent')"
                >%</button>
                <button
                  class="toggle-btn"
                  :class="{ active: inputs.markupType === 'fixed' }"
                  @click="switchMarkupType('fixed')"
                >₽</button>
              </div>
            </div>
            <div v-if="inputs.markupType === 'percent'" class="chip-options mb-2">
              <button
                v-for="opt in markupOptions"
                :key="opt"
                class="chip-option"
                :class="{ active: inputs.markupValue === opt }"
                @click="inputs.markupValue = opt"
              >{{ opt }}%</button>
            </div>
            <div class="input-with-suffix">
              <input
                v-model.number="inputs.markupValue"
                type="number"
                class="field-input"
                :placeholder="inputs.markupType === 'percent' ? '15' : '15000'"
                min="0"
              />
              <span class="input-suffix">{{ inputs.markupType === 'percent' ? '%' : '₽' }}</span>
            </div>
          </div>

          <!-- Total price (only in fixed/₽ mode) -->
          <div v-if="inputs.markupType === 'fixed'" class="form-field mb-4">
            <label class="field-label">Итоговая цена</label>
            <div class="input-with-suffix">
              <input
                :value="totalPriceInput"
                v-maska="CURRENCY_MASK"
                @maska="(e: any) => onTotalPriceInput(parseMasked(e))"
                type="text"
                inputmode="numeric"
                class="field-input"
                placeholder="115 000"
              />
              <span class="input-suffix">₽</span>
            </div>
            <div class="field-hint-styled">
              <v-icon icon="mdi-information-outline" size="14" />
              Наценка рассчитается автоматически
            </div>
          </div>

          <!-- Down payment -->
          <div class="form-field mb-4">
            <div class="field-label-row">
              <label class="field-label">Первоначальный взнос</label>
              <div class="markup-type-toggle">
                <button
                  class="toggle-btn"
                  :class="{ active: downPaymentType === 'percent' }"
                  @click="switchDownPaymentType('percent')"
                >%</button>
                <button
                  class="toggle-btn"
                  :class="{ active: downPaymentType === 'fixed' }"
                  @click="switchDownPaymentType('fixed')"
                >₽</button>
              </div>
            </div>

            <!-- Fixed (₽) mode -->
            <template v-if="downPaymentType === 'fixed'">
              <div class="input-with-suffix" :class="{ 'input-with-suffix--error': downPaymentError }">
                <input
                  :value="inputs.downPayment || ''"
                  v-maska="CURRENCY_MASK"
                  @maska="(e: any) => setDownPaymentFixed(parseMasked(e))"
                  type="text"
                  inputmode="numeric"
                  class="field-input"
                  placeholder="10 000"
                />
                <span class="input-suffix">₽</span>
              </div>
              <div v-if="inputs.downPayment > 0 && !downPaymentError" class="field-hint">
                {{ downPaymentPercent }}% от итоговой цены
              </div>
            </template>

            <!-- Percent (%) mode: percent input + auto-computed ₽ amount -->
            <template v-else>
              <div class="chip-options mb-2">
                <button
                  v-for="opt in [10, 20, 30, 50]" :key="opt"
                  class="chip-option"
                  :class="{ active: dpPercent === opt }"
                  @click="dpPercentModel = opt"
                >{{ opt }}%</button>
              </div>
              <div class="input-with-suffix" :class="{ 'input-with-suffix--error': downPaymentError }">
                <input
                  v-model.number="dpPercentModel"
                  type="number"
                  class="field-input"
                  placeholder="10"
                  min="0"
                  max="100"
                />
                <span class="input-suffix">%</span>
              </div>
              <label class="field-label mt-3 d-block">Сумма взноса</label>
              <div class="input-with-suffix">
                <input
                  :value="dpRublesModel || ''"
                  v-maska="CURRENCY_MASK"
                  @maska="(e: any) => dpRublesModel = parseMasked(e)"
                  type="text"
                  inputmode="numeric"
                  class="field-input"
                  placeholder="0"
                />
                <span class="input-suffix">₽</span>
              </div>
              <div class="field-hint">
                Рассчитано от итоговой цены {{ formatCurrency(result.totalPrice) }}
              </div>
            </template>

            <div v-if="downPaymentError" class="field-error-text">{{ downPaymentError }}</div>
          </div>

          <!-- Term -->
          <div class="form-field mb-4">
            <label class="field-label">Срок рассрочки</label>
            <div class="chip-options mb-2">
              <button
                v-for="opt in termOptions"
                :key="opt"
                class="chip-option"
                :class="{ active: inputs.termMonths === opt }"
                @click="inputs.termMonths = opt"
              >{{ opt }} мес</button>
            </div>
            <div class="input-with-suffix">
              <input
                v-model.number="inputs.termMonths"
                type="number"
                class="field-input"
                placeholder="6"
                min="1"
              />
              <span class="input-suffix">мес</span>
            </div>
          </div>

          <!-- Payment type (fixed: equal) -->
        </v-card>
      </v-col>

      <!-- Results -->
      <v-col cols="12" lg="5">
        <div class="results-card">
          <!-- Monthly payment hero -->
          <div class="result-hero">
            <div class="result-hero-label">Ежемесячный платёж</div>
            <div class="result-hero-value">{{ formatCurrency(result.monthlyPayment) }}</div>
            <div class="result-hero-sub">{{ inputs.termMonths }} месяцев</div>
          </div>

          <div class="result-divider" />

          <!-- Key metrics -->
          <div class="result-rows">
            <div class="result-row">
              <span class="result-row-label">Закупочная цена</span>
              <span class="result-row-value">{{ formatCurrency(inputs.purchasePrice) }}</span>
            </div>
            <div class="result-row">
              <span class="result-row-label">Наценка</span>
              <span class="result-row-value">{{ formatCurrency(result.markup) }} <span class="result-row-dim">({{ formatPercent(result.markupPercent) }})</span></span>
            </div>
            <div class="result-row result-row--highlight">
              <span class="result-row-label">Итоговая цена</span>
              <span class="result-row-value result-row-value--bold">{{ formatCurrency(result.totalPrice) }}</span>
            </div>
            <div class="result-row">
              <span class="result-row-label">Первоначальный взнос</span>
              <span class="result-row-value">{{ formatCurrency(inputs.downPayment) }}</span>
            </div>
            <div class="result-row">
              <span class="result-row-label">Остаток к выплате</span>
              <span class="result-row-value">{{ formatCurrency(remainingAmount) }}</span>
            </div>
          </div>

          <div class="result-divider" />

          <!-- Profit -->
          <div class="result-profit-section">
            <div class="result-profit-row">
              <div class="result-profit-item">
                <div class="result-profit-label">Прибыль</div>
                <div class="result-profit-value result-profit-value--green">{{ formatCurrency(result.profit) }}</div>
              </div>
              <div class="result-profit-item">
                <div class="result-profit-label">ROI</div>
                <div class="result-profit-value">{{ formatPercent(result.roi) }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Info -->
        <div class="info-banner mt-4">
          <v-icon icon="mdi-information-outline" size="18" />
          <span>Расчёт приблизительный. Итоговые условия могут отличаться в зависимости от договорённости сторон.</span>
        </div>
      </v-col>
    </v-row>
  </div>
</template>

<style scoped>
/* Page header */
.page-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20px;
}
.page-header-left { display: flex; align-items: center; gap: 14px; }
.page-icon-wrap {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
}
.page-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.page-subtitle {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Section header */
.section-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20px; padding-bottom: 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.section-header-left {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* Buttons */
.btn-text {
  display: inline-flex; align-items: center; gap: 4px;
  border: none; background: none; padding: 6px 10px; border-radius: 8px;
  font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: all 0.15s;
}
.btn-text:hover { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.7); }

/* Form */
.form-field { display: flex; flex-direction: column; gap: 6px; }
.field-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.field-label-row {
  display: flex; align-items: center; justify-content: space-between;
}
.required { color: #ef4444; }
.field-input {
  width: 100%; height: 44px; padding: 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.03);
  outline: none; transition: all 0.15s;
}
.field-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.3); }
.field-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}
.field-hint {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.input-with-suffix--error .field-input {
  border-color: rgba(239, 68, 68, 0.4) !important;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08) !important;
}
.field-error-text {
  margin-top: 6px;
  font-size: 12px; font-weight: 500;
  color: #ef4444;
}
.field-hint-styled {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; padding: 8px 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
  font-size: 12px; font-weight: 500;
}

.input-with-suffix { position: relative; }
.input-with-suffix .field-input { padding-right: 44px; }
.input-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}

/* Markup type toggle */
.markup-type-toggle {
  display: flex; gap: 2px; padding: 2px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.toggle-btn {
  padding: 4px 12px; border-radius: 5px; border: none;
  font-size: 12px; font-weight: 600;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.45);
  cursor: pointer; transition: all 0.15s;
}
.toggle-btn.active {
  background: #fff; color: rgba(var(--v-theme-on-surface), 0.8);
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
}

/* Chip options */
.chip-options { display: flex; gap: 6px; flex-wrap: wrap; }
.chip-option {
  padding: 6px 14px; border-radius: 8px; border: none;
  font-size: 13px; font-weight: 500;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer; transition: all 0.15s;
}
.chip-option:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.chip-option.active {
  background: rgba(4, 120, 87, 0.1); color: #047857;
  font-weight: 600;
}

/* Payment type */
.payment-type-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.payment-type-btn {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-on-surface), 0.02);
  cursor: pointer; transition: all 0.15s; text-align: left;
}
.payment-type-btn:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.18);
}
.payment-type-btn.active {
  border-color: rgba(4, 120, 87, 0.3);
  background: rgba(4, 120, 87, 0.04);
}
.payment-type-btn.active .v-icon { color: #047857; }
.payment-type-btn .v-icon {
  color: rgba(var(--v-theme-on-surface), 0.35);
  margin-top: 2px;
}
.payment-type-title {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.payment-type-desc {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 1px;
}

/* Results card */
.results-card {
  border-radius: 14px; overflow: hidden;
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.06) 0%, rgba(4, 120, 87, 0.02) 100%);
  border: 1px solid rgba(4, 120, 87, 0.12);
  position: sticky; top: 80px;
}

.result-hero {
  padding: 28px 24px 20px; text-align: center;
}
.result-hero-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 4px;
}
.result-hero-value {
  font-size: 32px; font-weight: 800;
  color: #047857; line-height: 1.2;
}
.result-hero-sub {
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 4px;
}

.result-divider {
  height: 1px; margin: 0 24px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.result-rows { padding: 16px 24px; }
.result-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 7px 0;
}
.result-row--highlight {
  margin: 4px -8px; padding: 8px 8px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.result-row-label {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
}
.result-row-value {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.result-row-value--bold {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.result-row-dim {
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

.result-profit-section { padding: 16px 24px 20px; }
.result-profit-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.result-profit-item {
  padding: 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  text-align: center;
}
.result-profit-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 4px;
}
.result-profit-value {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.result-profit-value--green { color: #047857; }

/* Info banner */
.info-banner {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(59, 130, 246, 0.06);
  color: #3b82f6; font-size: 13px;
  border: 1px solid rgba(59, 130, 246, 0.12);
}

/* Dark mode */
.dark .field-input {
  background: #252538; border-color: #2e2e42; color: #e4e4e7;
}
.dark .field-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .toggle-btn.active {
  background: #252538; color: #e4e4e7;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.dark .chip-option { background: #252538; }
.dark .chip-option.active {
  background: rgba(4, 120, 87, 0.15); color: #34d399;
}
.dark .payment-type-btn {
  background: #1e1e2e; border-color: #2e2e42;
}
.dark .payment-type-btn.active {
  background: rgba(4, 120, 87, 0.08); border-color: rgba(4, 120, 87, 0.25);
}
.dark .results-card {
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.1) 0%, rgba(4, 120, 87, 0.03) 100%);
  border-color: rgba(4, 120, 87, 0.2);
}
.dark .result-row--highlight { background: rgba(0,0,0,0.15); }
.dark .result-profit-item { background: rgba(0,0,0,0.15); }
.dark .result-divider { background: rgba(255,255,255,0.06); }
.dark .markup-type-toggle { background: #1e1e2e; }
.dark .info-banner {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.2);
}

@media (max-width: 500px) {
  .payment-type-options { grid-template-columns: 1fr; }
}

/* ── Mobile ── */
@media (max-width: 768px) {
  .page-header { margin-bottom: 14px; }
  .page-icon-wrap { width: 38px; height: 38px; min-width: 38px; border-radius: 10px; }
  .page-title { font-size: 16px; }
  .page-subtitle { font-size: 12px; }

  .result-hero { padding: 18px 16px; }
  .result-hero-value { font-size: 26px; }
  .result-rows { padding: 12px 16px; }
  .result-profit-section { padding: 12px 16px 16px; }
  .result-profit-row { grid-template-columns: 1fr; gap: 8px; }
}
</style>
