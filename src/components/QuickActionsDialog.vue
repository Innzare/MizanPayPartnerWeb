<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="(v) => emit('update:modelValue', v)"
    max-width="560"
  >
    <v-card rounded="lg" class="quick-actions-card pa-6">
      <button class="dialog-close-sm" @click="emit('update:modelValue', false)">
        <v-icon icon="mdi-close" size="18" />
      </button>

      <!-- Mode toggle -->
      <div class="mode-toggle mb-5">
        <button
          class="mode-toggle-btn"
          :class="{ active: mode === 'sale' }"
          @click="mode = 'sale'"
        >
          <v-icon icon="mdi-cart-plus" size="16" />
          Новая продажа
        </button>
        <button
          class="mode-toggle-btn"
          :class="{ active: mode === 'payment' }"
          @click="mode = 'payment'"
        >
          <v-icon icon="mdi-cash-check" size="16" />
          Принять платёж
        </button>
      </div>

      <!-- ─── SALE MODE ─── -->
      <template v-if="mode === 'sale'">
        <div class="text-h6 font-weight-bold mb-1">Быстрая продажа</div>
        <div class="text-caption text-medium-emphasis mb-5">Создайте продажу за минуту</div>

        <!-- Client -->
        <div class="mb-4">
          <label class="field-label">Клиент</label>
          <ClientPicker
            v-model="sale.clientProfileId"
            label=""
            required
            @profile="onClientSelected"
          />
        </div>

        <!-- Product -->
        <div class="mb-4">
          <label class="field-label">Товар</label>
          <input
            v-model="sale.productName"
            type="text"
            placeholder="Например, iPhone 15 Pro 256"
            class="field-input"
          />
        </div>

        <!-- Pricing row 1 -->
        <div class="d-flex ga-3 mb-3">
          <div class="flex-grow-1">
            <label class="field-label">Закупка</label>
            <div class="input-with-suffix">
              <input
                v-model="sale.purchasePrice"
                v-maska="CURRENCY_MASK"
                type="text"
                inputmode="numeric"
                placeholder="0"
                class="field-input"
              />
              <span class="input-suffix">₽</span>
            </div>
          </div>
          <div class="flex-grow-1">
            <label class="field-label">Наценка</label>
            <div class="input-with-suffix">
              <input
                v-model.number="sale.markupPercent"
                type="number"
                placeholder="15"
                class="field-input"
              />
              <span class="input-suffix">%</span>
            </div>
          </div>
        </div>

        <!-- Pricing row 2 -->
        <div class="d-flex ga-3 mb-4">
          <div class="flex-grow-1">
            <label class="field-label">Срок</label>
            <div class="input-with-suffix">
              <input
                v-model.number="sale.numberOfPayments"
                type="number"
                placeholder="6"
                class="field-input"
              />
              <span class="input-suffix">мес</span>
            </div>
          </div>
          <div class="flex-grow-1">
            <label class="field-label">Первонач. взнос</label>
            <div class="input-with-suffix">
              <input
                v-model="sale.downPayment"
                v-maska="CURRENCY_MASK"
                type="text"
                inputmode="numeric"
                placeholder="0"
                class="field-input"
              />
              <span class="input-suffix">₽</span>
            </div>
          </div>
        </div>

        <!-- Live preview -->
        <div v-if="salePreview.totalPrice > 0" class="reschedule-info mb-5">
          <div class="d-flex justify-space-between mb-2">
            <span class="text-caption text-medium-emphasis">Итоговая цена</span>
            <span class="font-weight-bold">{{ formatCurrency(salePreview.totalPrice) }}</span>
          </div>
          <div class="d-flex justify-space-between mb-2">
            <span class="text-caption text-medium-emphasis">Доход с продажи</span>
            <span class="font-weight-bold" style="color: #047857;">+{{ formatCurrency(salePreview.markup) }}</span>
          </div>
          <div v-if="salePreview.monthly > 0" class="d-flex justify-space-between">
            <span class="text-caption text-medium-emphasis">{{ salePreview.numberOfPayments }} платежей по</span>
            <span class="font-weight-bold">{{ formatCurrency(salePreview.monthly) }}/мес</span>
          </div>
        </div>

        <div class="d-flex ga-3">
          <button class="btn-secondary flex-grow-1" @click="resetSale">Сбросить</button>
          <button
            class="btn-secondary flex-grow-1"
            :disabled="!canCreateSale || creating"
            @click="onCreateSale(true)"
          >
            Создать и ещё
          </button>
          <button
            class="btn-primary flex-grow-1"
            :disabled="!canCreateSale || creating"
            @click="onCreateSale(false)"
          >
            <v-progress-circular v-if="creating" indeterminate size="14" width="2" color="white" />
            <span v-else>Создать продажу</span>
          </button>
        </div>
      </template>

      <!-- ─── PAYMENT MODE ─── -->
      <template v-else>
        <div class="text-h6 font-weight-bold mb-1">Принять платёж</div>
        <div class="text-caption text-medium-emphasis mb-5">Найдите сделку — отметьте оплату в один клик</div>

        <div class="mb-4">
          <div class="search-input-wrap">
            <v-icon icon="mdi-magnify" size="18" class="search-input-icon" />
            <input
              ref="searchInputRef"
              v-model="search"
              type="text"
              placeholder="Имя, телефон, товар или #номер..."
              class="search-input"
            />
            <button v-if="search" class="search-input-clear" @click="search = ''">
              <v-icon icon="mdi-close-circle" size="16" />
            </button>
          </div>
        </div>

        <!-- Loader -->
        <div v-if="searching" class="search-loader">
          <v-progress-circular indeterminate size="20" width="2" color="primary" />
          <span>Ищем сделки...</span>
        </div>

        <!-- Empty: not found -->
        <div v-else-if="results.length === 0 && search.length > 0" class="search-empty">
          <v-icon icon="mdi-magnify-close" size="36" class="search-empty-icon" />
          <div class="search-empty-title">Ничего не найдено</div>
          <div class="search-empty-hint">Попробуйте другое имя, телефон или название товара</div>
        </div>

        <!-- Empty: initial -->
        <div v-else-if="results.length === 0" class="search-empty">
          <v-icon icon="mdi-cash-multiple" size="36" class="search-empty-icon search-empty-icon--accent" />
          <div class="search-empty-title">Найдите сделку</div>
          <div class="search-empty-hint">Введите имя, телефон или товар — покажем ближайший платёж</div>
        </div>

        <!-- Results -->
        <div v-else class="search-results">
          <div
            v-for="r in results"
            :key="r.id"
            class="search-result"
            :class="{ active: expandedId === r.id, overdue: r.nextPayment?.status === 'OVERDUE' }"
          >
            <div class="search-result-main" @click="toggleExpanded(r.id)">
              <div class="search-result-num">#{{ r.dealNumber }}</div>
              <div class="search-result-info">
                <div class="search-result-name">{{ r.clientName || 'Без имени' }}</div>
                <div class="search-result-meta">
                  <span class="search-result-product">{{ r.productName }}</span>
                  <template v-if="r.clientPhone">
                    <span class="search-result-dot">·</span>
                    <span>{{ formatPhone(r.clientPhone) }}</span>
                  </template>
                </div>
              </div>
              <div class="search-result-right">
                <template v-if="r.nextPayment">
                  <div class="search-result-amount">{{ formatCurrency(r.nextPayment.amount) }}</div>
                  <div class="search-result-status" :class="`status-${r.nextPayment.status.toLowerCase()}`">
                    {{ r.nextPayment.status === 'OVERDUE' ? 'Просрочен' : 'Ожидается' }}
                  </div>
                </template>
                <template v-else>
                  <div class="search-result-done">Все оплачены</div>
                </template>
              </div>
              <button
                class="search-result-open"
                title="Открыть сделку"
                @click.stop="openDeal(r.id)"
              >
                <v-icon icon="mdi-arrow-top-right" size="16" />
              </button>
            </div>

            <!-- Expanded mark-paid form -->
            <div v-if="expandedId === r.id && r.nextPayment" class="search-result-form">
              <div class="reschedule-info mb-4">
                <div class="d-flex justify-space-between mb-1">
                  <span class="text-caption text-medium-emphasis">Платёж #{{ r.nextPayment.number }} из {{ r.numberOfPayments }}</span>
                  <span class="font-weight-bold">{{ formatCurrency(r.nextPayment.amount) }}</span>
                </div>
                <div class="d-flex justify-space-between">
                  <span class="text-caption text-medium-emphasis">Плановая дата</span>
                  <span>{{ formatDate(r.nextPayment.dueDate) }}</span>
                </div>
              </div>

              <div class="d-flex ga-3 mb-3">
                <div class="flex-grow-1">
                  <label class="field-label">Сумма поступления</label>
                  <div class="input-with-suffix">
                    <input
                      v-model="payForm.amount"
                      v-maska="CURRENCY_MASK"
                      type="text"
                      inputmode="numeric"
                      class="field-input"
                    />
                    <span class="input-suffix">₽</span>
                  </div>
                </div>
                <div class="flex-grow-1">
                  <label class="field-label">Дата оплаты</label>
                  <input v-model="payForm.date" type="date" class="field-input" />
                </div>
              </div>

              <div class="d-flex ga-3">
                <button class="btn-secondary" @click="openDeal(r.id)">
                  <v-icon icon="mdi-arrow-top-right" size="14" />
                  Открыть сделку
                </button>
                <button class="btn-secondary flex-grow-1" @click="expandedId = null">Отмена</button>
                <button
                  class="btn-primary flex-grow-1"
                  :disabled="markingPaid"
                  @click="onMarkPaid(r)"
                >
                  <v-progress-circular v-if="markingPaid" indeterminate size="14" width="2" color="white" />
                  <span v-else>Подтвердить оплату</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useDealsStore } from '@/stores/deals'
import { useToast } from '@/composables/useToast'
import { CURRENCY_MASK, parseMasked, formatPhone, formatCurrency, formatDate } from '@/utils/formatters'
import ClientPicker from './ClientPicker.vue'
import type { ClientProfile } from '@/types'

const props = defineProps<{
  modelValue: boolean
  initialMode?: 'sale' | 'payment'
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
}>()

const router = useRouter()
const dealsStore = useDealsStore()
const { show: showToast } = useToast()

function openDeal(id: string) {
  emit('update:modelValue', false)
  router.push(`/deals/${id}`)
}

const mode = ref<'sale' | 'payment'>(props.initialMode ?? 'sale')
const searchInputRef = ref<HTMLInputElement | null>(null)

watch(() => props.modelValue, (open) => {
  if (open) {
    mode.value = props.initialMode ?? 'sale'
    resetSale()
    search.value = ''
    results.value = []
    expandedId.value = null
    if (mode.value === 'payment') nextTick(() => searchInputRef.value?.focus())
  }
})

watch(() => props.initialMode, (m) => {
  if (m && props.modelValue) mode.value = m
})

watch(mode, (m) => {
  try { localStorage.setItem('quickActionsLastMode', m) } catch {}
  if (m === 'payment') nextTick(() => searchInputRef.value?.focus())
})

// ─── Sale ─────────────────────────────────────────────
const sale = reactive({
  clientProfileId: null as string | null,
  selectedClient: null as ClientProfile | null,
  productName: '',
  purchasePrice: '',
  markupPercent: 15,
  numberOfPayments: 6,
  downPayment: '',
})
const creating = ref(false)

function resetSale() {
  sale.clientProfileId = null
  sale.selectedClient = null
  sale.productName = ''
  sale.purchasePrice = ''
  sale.markupPercent = 15
  sale.numberOfPayments = 6
  sale.downPayment = ''
}

function onClientSelected(profile: ClientProfile | null) {
  sale.selectedClient = profile
}

const salePreview = computed(() => {
  const purchase = parseMasked(sale.purchasePrice)
  const downPayment = parseMasked(sale.downPayment)
  const markupPercent = sale.markupPercent || 0
  const markup = Math.round(purchase * (markupPercent / 100))
  const totalPrice = purchase + markup
  const remaining = Math.max(totalPrice - downPayment, 0)
  const numberOfPayments = sale.numberOfPayments || 1
  const monthly = numberOfPayments > 0 ? Math.round(remaining / numberOfPayments) : 0
  return { purchase, markup, totalPrice, monthly, numberOfPayments }
})

const canCreateSale = computed(() => {
  return (
    !!sale.clientProfileId &&
    sale.productName.trim().length > 0 &&
    salePreview.value.purchase > 0 &&
    sale.numberOfPayments > 0
  )
})

async function onCreateSale(keepOpen: boolean) {
  if (!canCreateSale.value) return
  creating.value = true
  try {
    await dealsStore.createDirectDeal({
      clientProfileId: sale.clientProfileId!,
      productName: sale.productName.trim(),
      purchasePrice: salePreview.value.purchase,
      markupPercent: sale.markupPercent,
      numberOfPayments: sale.numberOfPayments,
      downPayment: parseMasked(sale.downPayment) || undefined,
    })
    showToast('Продажа создана', 'success')
    if (keepOpen) {
      resetSale()
    } else {
      emit('update:modelValue', false)
    }
  } catch (e: any) {
    showToast(e.message || 'Не удалось создать продажу', 'error')
  } finally {
    creating.value = false
  }
}

// ─── Payment ──────────────────────────────────────────
interface QuickSearchResult {
  id: string
  dealNumber: number
  productName: string
  clientName: string
  clientPhone: string
  totalPrice: number
  remainingAmount: number
  paidPayments: number
  numberOfPayments: number
  nextPayment: {
    id: string
    number: number
    amount: number
    dueDate: string
    status: 'PENDING' | 'OVERDUE'
  } | null
}

const search = ref('')
const results = ref<QuickSearchResult[]>([])
const searching = ref(false)
const expandedId = ref<string | null>(null)
const markingPaid = ref(false)
const payForm = reactive({ amount: '', date: '' })

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  if (q.trim().length === 0) {
    results.value = []
    return
  }
  searchTimer = setTimeout(() => doSearch(q.trim()), 250)
})

async function doSearch(q: string) {
  searching.value = true
  try {
    results.value = await api.get<QuickSearchResult[]>(`/deals/quick-search?q=${encodeURIComponent(q)}`)
  } catch {
    results.value = []
  } finally {
    searching.value = false
  }
}

function toggleExpanded(id: string) {
  if (expandedId.value === id) { expandedId.value = null; return }
  const r = results.value.find((x) => x.id === id)
  expandedId.value = id
  if (r?.nextPayment) {
    payForm.amount = String(r.nextPayment.amount)
    payForm.date = new Date().toISOString().slice(0, 10)
  }
}

async function onMarkPaid(r: QuickSearchResult) {
  if (!r.nextPayment) return
  markingPaid.value = true
  try {
    const amount = parseMasked(payForm.amount) || r.nextPayment.amount
    const paidAt = payForm.date ? new Date(payForm.date).toISOString() : undefined
    await api.patch(`/payments/${r.nextPayment.id}/paid`, { amount, paidAt, method: 'TRANSFER' })
    showToast(`Платёж ${r.nextPayment.number}/${r.numberOfPayments} принят`, 'success')
    expandedId.value = null
    if (search.value.trim()) await doSearch(search.value.trim())
  } catch (e: any) {
    showToast(e.message || 'Не удалось отметить платёж', 'error')
  } finally {
    markingPaid.value = false
  }
}
</script>

<style scoped>
/* ─── Dialog close button ─────────────────────────────── */
.dialog-close-sm {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
  z-index: 1;
}
.dialog-close-sm:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

/* ─── Field labels & inputs ───────────────────────────── */
.field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.field-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none; resize: vertical;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: border-color 0.15s;
  font-family: inherit;
  box-sizing: border-box;
}
.field-input:focus { border-color: #047857; }
.field-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.4); }
.input-with-suffix { position: relative; }
.input-with-suffix .field-input { padding-right: 36px; }
.input-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}

/* ─── Info card (preview / payment info) ──────────────── */
.reschedule-info {
  padding: 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

/* ─── Buttons ─────────────────────────────────────────── */
.btn-primary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font-family: inherit;
}
.btn-primary:hover:not(:disabled) { background: #065f46; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font-family: inherit;
}
.btn-secondary:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.1); }
.btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

/* ─── Mode toggle ────────────────────────────────────── */
.mode-toggle {
  display: flex;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
  margin-right: 44px; /* leave room for close button */
}
.mode-toggle-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 14px;
  border-radius: 8px;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  transition: all 0.15s;
}
.mode-toggle-btn:hover:not(.active) {
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.mode-toggle-btn.active {
  background: rgb(var(--v-theme-surface));
  color: #047857;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

/* ─── Search input ───────────────────────────────────── */
.search-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.search-input-icon {
  position: absolute;
  left: 14px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 12px 14px 12px 42px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px;
  outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: border-color 0.15s, background 0.15s;
}
.search-input:focus {
  border-color: #047857;
  background: rgb(var(--v-theme-surface));
}
.search-input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.search-input-clear {
  position: absolute;
  right: 12px;
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.4);
  display: flex;
  align-items: center;
  padding: 4px;
}
.search-input-clear:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* ─── Empty state ────────────────────────────────────── */
.search-loader {
  display: flex; align-items: center; justify-content: center;
  gap: 10px;
  padding: 32px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 13px;
}
.search-empty {
  text-align: center;
  padding: 32px 16px;
}
.search-empty-icon {
  color: rgba(var(--v-theme-on-surface), 0.3);
  margin-bottom: 12px;
}
.search-empty-icon--accent {
  color: #047857;
}
.search-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
  margin-bottom: 4px;
}
.search-empty-hint {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  max-width: 300px;
  margin: 0 auto;
  line-height: 1.5;
}

/* ─── Card scroll (whole dialog scrolls when too tall) ─── */
.quick-actions-card {
  max-height: 90vh;
  overflow-y: auto;
}

/* ─── Results list ───────────────────────────────────── */
.search-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.search-result {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.02);
  transition: border-color 0.15s, background 0.15s;
}
.search-result:hover:not(.active) {
  border-color: rgba(4, 120, 87, 0.4);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.search-result.active {
  border-color: #047857;
  background: rgb(var(--v-theme-surface));
}
.search-result.overdue:not(.active):hover {
  border-color: rgba(239, 68, 68, 0.4);
}

.search-result-main {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
}
.search-result-num {
  font-size: 12px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.06);
  padding: 4px 8px;
  border-radius: 6px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.search-result.overdue .search-result-num { background: rgba(239, 68, 68, 0.10); color: rgb(239, 68, 68); }

.search-result-info {
  flex: 1;
  min-width: 0;
}
.search-result-name {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.95);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-result-meta {
  display: flex;
  gap: 6px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-top: 2px;
}
.search-result-product {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}
.search-result-dot { opacity: 0.5; }
.search-result-right {
  text-align: right;
  flex-shrink: 0;
}
.search-result-amount {
  font-size: 14px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.search-result-status {
  font-size: 11px;
  font-weight: 500;
  margin-top: 2px;
}
.status-pending { color: #047857; }
.status-overdue { color: #ef4444; }
.search-result-done {
  font-size: 12px;
  color: #047857;
  font-weight: 600;
}

.search-result-open {
  width: 32px; height: 32px;
  border-radius: 8px;
  border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.55);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}
.search-result-open:hover {
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
}

.search-result-form {
  padding: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.01);
}
</style>
