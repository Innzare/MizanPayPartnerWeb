<script lang="ts" setup>
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { formatCurrency } from '@/utils/formatters'
import { generateEqualSchedule, generateDecreasingSchedule } from '@/utils/schedule-generator'
import { CATEGORIES } from '@/constants/categories'
import { CITIES } from '@/constants/cities'
import { MOCK_CLIENTS } from '@/constants/mock/users'
import { useRouter } from 'vue-router'
import type { PaymentType } from '@/types'
import { useIsDark } from '@/composables/useIsDark'

const { isDark } = useIsDark()
const dealsStore = useDealsStore()
const paymentsStore = usePaymentsStore()
const router = useRouter()

const step = ref(1)
const steps = [
  { num: 1, title: 'Товар', icon: 'mdi-package-variant-closed' },
  { num: 2, title: 'Условия', icon: 'mdi-calculator-variant' },
  { num: 3, title: 'Клиент', icon: 'mdi-account' },
  { num: 4, title: 'Обзор', icon: 'mdi-check-decagram' },
]

// Step 1: Product
const productName = ref('')
const productDescription = ref('')
const category = ref('')
const city = ref('')

// Step 2: Terms
const purchasePrice = ref<number | null>(null)
const markupPercent = ref(15)
const termMonths = ref(6)
const paymentType = ref<PaymentType>('EQUAL')

const markupOptions = [10, 15, 20, 25]
const termOptions = [3, 4, 6, 9, 12, 18, 24]

// Computed deal preview
const markup = computed(() => (purchasePrice.value || 0) * markupPercent.value / 100)
const totalPrice = computed(() => (purchasePrice.value || 0) + markup.value)
const monthlyPayment = computed(() => termMonths.value > 0 ? totalPrice.value / termMonths.value : 0)

// Step 3: Client
const selectedClientId = ref('')
const clientSearch = ref('')

const selectedClient = computed(() =>
  MOCK_CLIENTS.find(c => c.id === selectedClientId.value)
)

const filteredClients = computed(() => {
  if (!clientSearch.value) return MOCK_CLIENTS
  const s = clientSearch.value.toLowerCase()
  return MOCK_CLIENTS.filter(c =>
    `${c.firstName} ${c.lastName}`.toLowerCase().includes(s) ||
    c.city.toLowerCase().includes(s)
  )
})

// Validation
const step1Valid = computed(() => !!productName.value && !!category.value && !!city.value)
const step2Valid = computed(() => (purchasePrice.value ?? 0) > 0 && termMonths.value > 0)
const step3Valid = computed(() => !!selectedClientId.value)

function nextStep() {
  if (step.value < 4) step.value++
}

function prevStep() {
  if (step.value > 1) step.value--
}

function canProceed() {
  if (step.value === 1) return step1Valid.value
  if (step.value === 2) return step2Valid.value
  if (step.value === 3) return step3Valid.value
  return true
}

async function submitDeal() {
  // TODO: Direct deal creation is no longer supported — deals are created through request offers.
  // This page should be replaced with a redirect to the requests page.
  try {
    const deal = await dealsStore.createDeal({
      clientId: selectedClientId.value,
      productName: productName.value,
      productPhotos: ['https://picsum.photos/id/200/400/400'],
      purchasePrice: purchasePrice.value || 0,
      markup: Math.round(markup.value),
      markupPercent: markupPercent.value,
      totalPrice: Math.round(totalPrice.value),
      numberOfPayments: termMonths.value,
      paymentInterval: 'MONTHLY',
      paymentType: paymentType.value,
      firstPaymentDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    })

    const generator = paymentType.value === 'EQUAL' ? generateEqualSchedule : generateDecreasingSchedule
    const schedule = generator(deal.id, Math.round(totalPrice.value), termMonths.value, deal.firstPaymentDate)
    paymentsStore.addPayments(deal.id, schedule)

    router.push('/deals')
  } catch {
    // error is set in the store
  }
}

function getCategoryIcon(catId: string) {
  return CATEGORIES.find(c => c.id === catId)?.icon || 'mdi-tag'
}

function getCategoryLabel(catId: string) {
  return CATEGORIES.find(c => c.id === catId)?.label || catId
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Custom stepper header -->
    <div class="stepper-header">
      <div
        v-for="(s, i) in steps"
        :key="s.num"
        class="stepper-step"
        :class="{
          'stepper-step--active': step === s.num,
          'stepper-step--done': step > s.num,
          'stepper-step--upcoming': step < s.num,
        }"
        @click="s.num < step ? step = s.num : undefined"
      >
        <div class="stepper-dot">
          <v-icon v-if="step > s.num" icon="mdi-check" size="16" />
          <v-icon v-else :icon="s.icon" size="16" />
        </div>
        <span class="stepper-label">{{ s.title }}</span>
        <div v-if="i < steps.length - 1" class="stepper-line" :class="{ done: step > s.num }" />
      </div>
    </div>

    <!-- Step 1: Product -->
    <div v-if="step === 1" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap">
          <v-icon icon="mdi-package-variant-closed" size="22" />
        </div>
        <div>
          <div class="step-title">Информация о товаре</div>
          <div class="step-subtitle">Укажите основные данные о товаре для сделки</div>
        </div>
      </div>

      <v-card rounded="lg" elevation="0" border class="pa-5">
        <div class="form-grid">
          <div class="form-field full-width">
            <label class="field-label">Название товара <span class="required">*</span></label>
            <input
              v-model="productName"
              type="text"
              class="field-input"
              placeholder="Например: iPhone 15 Pro Max 256GB"
            />
          </div>

          <div class="form-field full-width">
            <label class="field-label">Описание</label>
            <textarea
              v-model="productDescription"
              class="field-input field-textarea"
              placeholder="Краткое описание товара..."
              rows="3"
            />
          </div>

          <div class="form-field">
            <label class="field-label">Категория <span class="required">*</span></label>
            <div class="category-grid">
              <button
                v-for="cat in CATEGORIES"
                :key="cat.id"
                class="category-option"
                :class="{ active: category === cat.id }"
                @click="category = cat.id"
              >
                <v-icon :icon="cat.icon" size="20" />
                <span>{{ cat.label }}</span>
              </button>
            </div>
          </div>

          <div class="form-field">
            <label class="field-label">Город <span class="required">*</span></label>
            <select v-model="city" class="field-input field-select">
              <option value="" disabled>Выберите город</option>
              <option v-for="c in CITIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
        </div>
      </v-card>
    </div>

    <!-- Step 2: Terms -->
    <div v-if="step === 2" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap">
          <v-icon icon="mdi-calculator-variant" size="22" />
        </div>
        <div>
          <div class="step-title">Условия мурабахи</div>
          <div class="step-subtitle">Настройте финансовые параметры сделки</div>
        </div>
      </div>

      <v-row>
        <v-col cols="12" lg="7">
          <v-card rounded="lg" elevation="0" border class="pa-5">
            <div class="form-grid">
              <div class="form-field full-width">
                <label class="field-label">Закупочная цена <span class="required">*</span></label>
                <div class="input-with-suffix">
                  <input
                    v-model.number="purchasePrice"
                    type="number"
                    class="field-input"
                    placeholder="0"
                  />
                  <span class="input-suffix">₽</span>
                </div>
              </div>

              <div class="form-field full-width">
                <label class="field-label">Наценка</label>
                <div class="chip-group">
                  <button
                    v-for="opt in markupOptions"
                    :key="opt"
                    class="chip-option"
                    :class="{ active: markupPercent === opt }"
                    @click="markupPercent = opt"
                  >
                    {{ opt }}%
                  </button>
                </div>
              </div>

              <div class="form-field full-width">
                <label class="field-label">Срок рассрочки</label>
                <div class="chip-group">
                  <button
                    v-for="opt in termOptions"
                    :key="opt"
                    class="chip-option"
                    :class="{ active: termMonths === opt }"
                    @click="termMonths = opt"
                  >
                    {{ opt }} мес
                  </button>
                </div>
              </div>

              <div class="form-field full-width">
                <label class="field-label">Тип платежей</label>
                <div class="chip-group">
                  <button
                    class="chip-option chip-option--wide"
                    :class="{ active: paymentType === 'EQUAL' }"
                    @click="paymentType = 'EQUAL'"
                  >
                    <v-icon icon="mdi-equal" size="16" />
                    Равные
                  </button>
                  <button
                    class="chip-option chip-option--wide"
                    :class="{ active: paymentType === 'decreasing' }"
                    @click="paymentType = 'DECREASING'"
                  >
                    <v-icon icon="mdi-trending-down" size="16" />
                    Убывающие
                  </button>
                </div>
              </div>
            </div>
          </v-card>
        </v-col>

        <!-- Live preview -->
        <v-col cols="12" lg="5">
          <div class="preview-card">
            <div class="preview-header">
              <v-icon icon="mdi-calculator" size="18" />
              <span>Расчёт сделки</span>
            </div>

            <div class="preview-row">
              <span>Закупочная цена</span>
              <span class="preview-value">{{ formatCurrency(purchasePrice || 0) }}</span>
            </div>
            <div class="preview-row">
              <span>Наценка {{ markupPercent }}%</span>
              <span class="preview-value" style="color: #047857;">+{{ formatCurrency(markup) }}</span>
            </div>
            <div class="preview-divider" />
            <div class="preview-row preview-row--total">
              <span>Итоговая цена</span>
              <span>{{ formatCurrency(totalPrice) }}</span>
            </div>
            <div class="preview-divider" />
            <div class="preview-row preview-row--highlight">
              <span>Ежемесячный платёж</span>
              <span>{{ formatCurrency(monthlyPayment) }}</span>
            </div>
            <div class="preview-footer">
              <span>{{ termMonths }} платежей · {{ paymentType === 'EQUAL' ? 'Равные' : 'Убывающие' }}</span>
            </div>
          </div>
        </v-col>
      </v-row>
    </div>

    <!-- Step 3: Client -->
    <div v-if="step === 3" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap">
          <v-icon icon="mdi-account" size="22" />
        </div>
        <div>
          <div class="step-title">Выбор клиента</div>
          <div class="step-subtitle">Выберите клиента для оформления сделки</div>
        </div>
      </div>

      <v-card rounded="lg" elevation="0" border class="pa-5">
        <div class="filter-input-wrap mb-4">
          <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
          <input
            v-model="clientSearch"
            type="text"
            class="filter-input"
            placeholder="Поиск по имени или городу..."
          />
        </div>

        <div class="client-grid">
          <div
            v-for="client in filteredClients"
            :key="client.id"
            class="client-card"
            :class="{ active: selectedClientId === client.id }"
            @click="selectedClientId = client.id"
          >
            <div class="client-avatar" :style="{ background: selectedClientId === client.id ? '#047857' : 'rgba(var(--v-theme-on-surface), 0.08)' }">
              {{ client.firstName.charAt(0) }}{{ client.lastName.charAt(0) }}
            </div>
            <div class="client-info">
              <div class="client-name">{{ client.firstName }} {{ client.lastName }}</div>
              <div class="client-meta">
                <span><v-icon icon="mdi-map-marker" size="12" /> {{ client.city }}</span>
                <span><v-icon icon="mdi-star" size="12" /> {{ client.rating }}</span>
              </div>
            </div>
            <div v-if="selectedClientId === client.id" class="client-check">
              <v-icon icon="mdi-check-circle" size="22" color="primary" />
            </div>
          </div>
        </div>

        <div v-if="!filteredClients.length" class="text-center pa-8">
          <v-icon icon="mdi-account-search" size="40" color="grey-lighten-1" class="mb-2" />
          <div class="text-body-2 text-medium-emphasis">Клиенты не найдены</div>
        </div>

        <div class="info-banner mt-4">
          <v-icon icon="mdi-information-outline" size="18" />
          <span>Клиент получит уведомление и договор мурабахи для подписания.</span>
        </div>
      </v-card>
    </div>

    <!-- Step 4: Review -->
    <div v-if="step === 4" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-check-decagram" size="22" />
        </div>
        <div>
          <div class="step-title">Обзор сделки</div>
          <div class="step-subtitle">Проверьте данные перед созданием</div>
        </div>
      </div>

      <div class="review-grid">
        <!-- Product -->
        <v-card rounded="lg" elevation="0" border class="pa-5">
          <div class="review-section-header">
            <v-icon icon="mdi-package-variant-closed" size="18" />
            <span>Товар</span>
          </div>
          <div class="review-rows">
            <div class="review-row">
              <span class="review-label">Название</span>
              <span class="review-value">{{ productName }}</span>
            </div>
            <div class="review-row">
              <span class="review-label">Категория</span>
              <span class="review-value">
                <v-icon :icon="getCategoryIcon(category)" size="14" class="mr-1" />
                {{ getCategoryLabel(category) }}
              </span>
            </div>
            <div class="review-row">
              <span class="review-label">Город</span>
              <span class="review-value">{{ city }}</span>
            </div>
            <div v-if="productDescription" class="review-row">
              <span class="review-label">Описание</span>
              <span class="review-value">{{ productDescription }}</span>
            </div>
          </div>
        </v-card>

        <!-- Terms -->
        <v-card rounded="lg" elevation="0" border class="pa-5">
          <div class="review-section-header">
            <v-icon icon="mdi-calculator-variant" size="18" />
            <span>Условия</span>
          </div>
          <div class="review-rows">
            <div class="review-row">
              <span class="review-label">Закупочная цена</span>
              <span class="review-value">{{ formatCurrency(purchasePrice || 0) }}</span>
            </div>
            <div class="review-row">
              <span class="review-label">Наценка</span>
              <span class="review-value" style="color: #047857;">+{{ formatCurrency(markup) }} ({{ markupPercent }}%)</span>
            </div>
            <div class="review-row review-row--bold">
              <span class="review-label">Итоговая цена</span>
              <span class="review-value">{{ formatCurrency(totalPrice) }}</span>
            </div>
            <div class="review-row review-row--bold">
              <span class="review-label">Ежемесячный платёж</span>
              <span class="review-value" style="color: #047857;">{{ formatCurrency(monthlyPayment) }}</span>
            </div>
            <div class="review-row">
              <span class="review-label">Срок / Тип</span>
              <span class="review-value">{{ termMonths }} мес · {{ paymentType === 'EQUAL' ? 'Равные' : 'Убывающие' }}</span>
            </div>
          </div>
        </v-card>

        <!-- Client -->
        <v-card rounded="lg" elevation="0" border class="pa-5">
          <div class="review-section-header">
            <v-icon icon="mdi-account" size="18" />
            <span>Клиент</span>
          </div>
          <div v-if="selectedClient" class="review-client">
            <div class="client-avatar" style="background: #047857;">
              {{ selectedClient.firstName.charAt(0) }}{{ selectedClient.lastName.charAt(0) }}
            </div>
            <div>
              <div class="font-weight-medium">{{ selectedClient.firstName }} {{ selectedClient.lastName }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ selectedClient.city }} · Рейтинг {{ selectedClient.rating }}
              </div>
            </div>
          </div>
        </v-card>
      </div>

      <div class="info-banner info-banner--success mt-4">
        <v-icon icon="mdi-file-document-check-outline" size="18" />
        <span>Договор будет сформирован автоматически и отправлен клиенту для подписания.</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="step-actions">
      <button v-if="step > 1" class="btn-secondary" @click="prevStep">
        <v-icon icon="mdi-arrow-left" size="18" />
        Назад
      </button>
      <div v-else />
      <button v-if="step < 4" class="btn-primary" :disabled="!canProceed()" @click="nextStep">
        Далее
        <v-icon icon="mdi-arrow-right" size="18" />
      </button>
      <button v-else class="btn-primary btn-primary--success" @click="submitDeal">
        <v-icon icon="mdi-check" size="18" />
        Создать сделку
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Stepper header */
.stepper-header {
  display: flex; align-items: center;
  padding: 16px 0; margin-bottom: 24px;
  gap: 0;
}
.stepper-step {
  display: flex; align-items: center; gap: 8px;
  position: relative; flex-shrink: 0;
  cursor: default;
}
.stepper-step--done { cursor: pointer; }
.stepper-dot {
  width: 36px; height: 36px; min-width: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.35);
  transition: all 0.2s;
}
.stepper-step--active .stepper-dot {
  background: #047857; color: #fff;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}
.stepper-step--done .stepper-dot {
  background: rgba(4, 120, 87, 0.12); color: #047857;
}
.stepper-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  white-space: nowrap;
}
.stepper-step--active .stepper-label {
  color: rgba(var(--v-theme-on-surface), 0.85); font-weight: 600;
}
.stepper-step--done .stepper-label { color: #047857; }
.stepper-line {
  width: 32px; min-width: 24px; height: 2px; flex-shrink: 1; flex-grow: 1;
  background: rgba(var(--v-theme-on-surface), 0.1);
  margin: 0 8px; border-radius: 1px;
  transition: background 0.2s;
}
.stepper-line.done { background: rgba(4, 120, 87, 0.3); }

@media (max-width: 700px) {
  .stepper-label { display: none; }
  .stepper-line { width: 16px; min-width: 12px; margin: 0 4px; }
  .stepper-header { justify-content: center; }
}

/* Step content */
.step-content { margin-bottom: 20px; }
.step-title-row {
  display: flex; align-items: center; gap: 14px; margin-bottom: 20px;
}
.step-icon-wrap {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
}
.step-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.step-subtitle {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Form */
.form-grid {
  display: flex; flex-direction: column; gap: 20px;
}
.form-field { display: flex; flex-direction: column; gap: 6px; }
.field-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
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
.field-textarea { height: auto; padding: 12px 14px; resize: vertical; }
.field-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M3 5l3 3 3-3'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 36px;
}

.input-with-suffix { position: relative; }
.input-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}
.input-with-suffix .field-input { padding-right: 36px; }

/* Category grid */
.category-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px;
}
.category-option {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 12px 8px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 11px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.category-option:hover {
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
}
.category-option.active {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.3);
}

/* Chip group */
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
.chip-option {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 8px 16px; border-radius: 20px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.chip-option:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.chip-option.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}
.chip-option--wide { padding: 8px 20px; }

/* Preview card */
.preview-card {
  padding: 20px; border-radius: 14px;
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.06) 0%, rgba(4, 120, 87, 0.02) 100%);
  border: 1px solid rgba(4, 120, 87, 0.12);
  position: sticky; top: 80px;
}
.preview-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700;
  color: #047857; margin-bottom: 16px;
}
.preview-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 0; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.preview-value { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); }
.preview-row--total {
  font-weight: 700; font-size: 15px;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.preview-row--total span:last-child { color: #047857; }
.preview-row--highlight {
  font-weight: 700; font-size: 16px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  padding: 8px 0;
}
.preview-row--highlight span:last-child { color: #047857; }
.preview-divider {
  height: 1px; margin: 8px 0;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.preview-footer {
  text-align: center; margin-top: 12px; padding-top: 12px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.1);
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Client selection */
.filter-input-wrap { position: relative; }
.filter-input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #9ca3af; pointer-events: none;
}
.filter-input {
  width: 100%; height: 42px; padding: 0 16px 0 38px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  font-size: 14px; color: inherit;
  outline: none; transition: all 0.15s;
}
.filter-input::placeholder { color: #9ca3af; }
.filter-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}

.client-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;
}
.client-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px; border-radius: 12px;
  border: 2px solid transparent;
  background: rgba(var(--v-theme-on-surface), 0.03);
  cursor: pointer; transition: all 0.15s;
}
.client-card:hover {
  background: rgba(var(--v-theme-primary), 0.04);
  border-color: rgba(var(--v-theme-primary), 0.15);
}
.client-card.active {
  background: rgba(var(--v-theme-primary), 0.06);
  border-color: #047857;
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.1);
}
.client-avatar {
  width: 40px; height: 40px; min-width: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);
  transition: all 0.15s;
}
.client-card.active .client-avatar { color: #fff; }
.client-info { flex: 1; min-width: 0; }
.client-name {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.client-meta {
  display: flex; gap: 10px; margin-top: 2px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.client-meta span { display: flex; align-items: center; gap: 3px; }
.client-check { flex-shrink: 0; }

/* Review */
.review-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;
}
.review-section-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 16px; padding-bottom: 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.review-rows { display: flex; flex-direction: column; gap: 10px; }
.review-row {
  display: flex; justify-content: space-between; align-items: center;
}
.review-label {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.review-value {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  text-align: right;
}
.review-row--bold .review-label { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.65); }
.review-row--bold .review-value { font-size: 15px; }
.review-client {
  display: flex; align-items: center; gap: 14px;
}

/* Info banner */
.info-banner {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 14px 16px; border-radius: 10px;
  background: rgba(59, 130, 246, 0.06);
  color: #3b82f6; font-size: 13px;
  border: 1px solid rgba(59, 130, 246, 0.12);
}
.info-banner--success {
  background: rgba(4, 120, 87, 0.06);
  color: #047857;
  border-color: rgba(4, 120, 87, 0.12);
}

/* Actions */
.step-actions {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 8px;
}
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px; padding: 0 24px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.btn-primary:hover { background: #065f46; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary--success { background: #047857; }
.btn-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px; padding: 0 24px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.04); }

/* Dark mode */
.dark .field-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .field-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .filter-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .filter-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .preview-card { background: linear-gradient(135deg, rgba(4, 120, 87, 0.1) 0%, rgba(4, 120, 87, 0.04) 100%); border-color: rgba(4, 120, 87, 0.2); }
.dark .client-card { background: #1e1e2e; }
.dark .client-card.active { background: rgba(4, 120, 87, 0.08); }
.dark .category-option { background: #252538; }
</style>
