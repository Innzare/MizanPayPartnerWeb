<script lang="ts" setup>
import { calculateBasic } from '@/utils/calculator'
import { formatCurrency, formatPercent } from '@/utils/formatters'
import type { BasicCalculatorInputs, CalculatorResult } from '@/types'

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

function reset() {
  inputs.value = {
    purchasePrice: 100000,
    markupType: 'percent',
    markupValue: 15,
    termMonths: 6,
    downPayment: 10000,
    paymentType: 'equal',
  }
}
</script>

<template>
  <div class="at-page">
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
                v-model.number="inputs.purchasePrice"
                type="number"
                class="field-input"
                placeholder="100 000"
                min="0"
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
                  @click="inputs.markupType = 'percent'"
                >%</button>
                <button
                  class="toggle-btn"
                  :class="{ active: inputs.markupType === 'fixed' }"
                  @click="inputs.markupType = 'fixed'"
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

          <!-- Down payment -->
          <div class="form-field mb-4">
            <label class="field-label">Первоначальный взнос</label>
            <div class="input-with-suffix">
              <input
                v-model.number="inputs.downPayment"
                type="number"
                class="field-input"
                placeholder="10 000"
                min="0"
              />
              <span class="input-suffix">₽</span>
            </div>
            <div v-if="inputs.downPayment > 0" class="field-hint">
              {{ downPaymentPercent }}% от итоговой цены
            </div>
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

          <!-- Payment type -->
          <div class="form-field">
            <label class="field-label">Тип платежей</label>
            <div class="payment-type-options">
              <button
                class="payment-type-btn"
                :class="{ active: inputs.paymentType === 'equal' }"
                @click="inputs.paymentType = 'equal'"
              >
                <v-icon icon="mdi-equal" size="18" />
                <div>
                  <div class="payment-type-title">Равные</div>
                  <div class="payment-type-desc">Одинаковая сумма каждый месяц</div>
                </div>
              </button>
              <button
                class="payment-type-btn"
                :class="{ active: inputs.paymentType === 'decreasing' }"
                @click="inputs.paymentType = 'decreasing'"
              >
                <v-icon icon="mdi-trending-down" size="18" />
                <div>
                  <div class="payment-type-title">Убывающие</div>
                  <div class="payment-type-desc">Уменьшаются к концу срока</div>
                </div>
              </button>
            </div>
          </div>
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
:global(.dark) .field-input {
  background: #252538; border-color: #2e2e42; color: #e4e4e7;
}
:global(.dark) .field-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
:global(.dark) .toggle-btn.active {
  background: #252538; color: #e4e4e7;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
:global(.dark) .chip-option { background: #252538; }
:global(.dark) .chip-option.active {
  background: rgba(4, 120, 87, 0.15); color: #34d399;
}
:global(.dark) .payment-type-btn {
  background: #1e1e2e; border-color: #2e2e42;
}
:global(.dark) .payment-type-btn.active {
  background: rgba(4, 120, 87, 0.08); border-color: rgba(4, 120, 87, 0.25);
}
:global(.dark) .results-card {
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.1) 0%, rgba(4, 120, 87, 0.03) 100%);
  border-color: rgba(4, 120, 87, 0.2);
}
:global(.dark) .result-row--highlight { background: rgba(0,0,0,0.15); }
:global(.dark) .result-profit-item { background: rgba(0,0,0,0.15); }
:global(.dark) .result-divider { background: rgba(255,255,255,0.06); }
:global(.dark) .markup-type-toggle { background: #1e1e2e; }

@media (max-width: 500px) {
  .payment-type-options { grid-template-columns: 1fr; }
}
</style>
