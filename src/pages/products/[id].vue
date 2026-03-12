<script lang="ts" setup>
import { useProductsStore } from '@/stores/products'
import { useDealsStore } from '@/stores/deals'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { getCategoryLabel, CATEGORIES } from '@/constants/categories'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()
const productsStore = useProductsStore()
const dealsStore = useDealsStore()

const product = computed(() => productsStore.getProduct(route.params.id as string))

const categoryIcon = computed(() =>
  CATEGORIES.find(c => c.id === product.value?.category)?.icon || 'mdi-tag'
)

// Deals related to this product (match by product title)
const relatedDeals = computed(() => {
  if (!product.value) return []
  return dealsStore.investorDeals.filter(d =>
    d.productName.toLowerCase().includes(product.value!.title.toLowerCase()) ||
    product.value!.title.toLowerCase().includes(d.productName.toLowerCase())
  )
})

const dealStats = computed(() => {
  const deals = relatedDeals.value
  const active = deals.filter(d => d.status === 'active' || d.status === 'in_progress').length
  const completed = deals.filter(d => d.status === 'completed').length
  const revenue = deals.reduce((s, d) => s + d.markup, 0)
  return { total: deals.length, active, completed, revenue }
})

// Example installment preview
const installmentPreview = computed(() => {
  if (!product.value) return []
  const p = product.value
  const terms = [p.minTermMonths, Math.round((p.minTermMonths + p.maxTermMonths) / 2), p.maxTermMonths]
  return terms.map(months => {
    const downPayment = p.price * p.minDownPaymentPercent / 100
    const remaining = p.price - downPayment
    const monthlyPayment = Math.round(remaining / months)
    return { months, downPayment, monthlyPayment, total: p.price }
  })
})

// Edit dialog
const editDialog = ref(false)
const editForm = ref({
  title: '',
  description: '',
  price: 0,
  city: '',
  minTermMonths: 0,
  maxTermMonths: 0,
  minDownPaymentPercent: 0,
})

function openEdit() {
  if (!product.value) return
  editForm.value = {
    title: product.value.title,
    description: product.value.description || '',
    price: product.value.price,
    city: product.value.city,
    minTermMonths: product.value.minTermMonths,
    maxTermMonths: product.value.maxTermMonths,
    minDownPaymentPercent: product.value.minDownPaymentPercent,
  }
  editDialog.value = true
}

function saveEdit() {
  if (!product.value) return
  productsStore.updateProduct(product.value.id, editForm.value)
  editDialog.value = false
}

function deleteProduct() {
  if (!product.value) return
  // In real app — API call, for now just go back
  router.push('/products')
}
</script>

<template>
  <div class="at-page" v-if="product">
    <!-- Back + Actions -->
    <div class="d-flex align-center justify-space-between mb-5">
      <button class="back-btn" @click="router.push('/products')">
        <v-icon icon="mdi-arrow-left" size="18" />
        Каталог
      </button>
      <div class="d-flex ga-2">
        <button class="action-outlined-btn" @click="openEdit">
          <v-icon icon="mdi-pencil-outline" size="16" />
          Редактировать
        </button>
        <button
          class="action-outlined-btn"
          :class="product.isAvailable ? 'action-outlined-btn--warning' : 'action-outlined-btn--success'"
          @click="productsStore.toggleAvailability(product.id)"
        >
          <v-icon :icon="product.isAvailable ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" size="16" />
          {{ product.isAvailable ? 'Скрыть' : 'Опубликовать' }}
        </button>
      </div>
    </div>

    <v-row>
      <!-- Left: Image + Details -->
      <v-col cols="12" lg="8">
        <!-- Hero -->
        <v-card rounded="lg" elevation="0" border class="mb-4 overflow-hidden">
          <div class="detail-hero">
            <v-img :src="product.photos[0]" height="320" cover />
            <div class="detail-hero-overlay" />
            <div class="detail-hero-content">
              <div class="d-flex ga-2 mb-2">
                <div
                  class="detail-badge"
                  :class="product.isAvailable ? 'detail-badge--success' : 'detail-badge--warning'"
                >
                  <v-icon :icon="product.isAvailable ? 'mdi-check-circle' : 'mdi-eye-off'" size="14" />
                  {{ product.isAvailable ? 'Активен' : 'Скрыт' }}
                </div>
                <div class="detail-badge detail-badge--info">
                  <v-icon :icon="categoryIcon" size="14" />
                  {{ getCategoryLabel(product.category) }}
                </div>
              </div>
              <div class="detail-hero-title">{{ product.title }}</div>
              <div class="detail-hero-price">{{ formatCurrency(product.price) }}</div>
            </div>
          </div>
        </v-card>

        <!-- Description -->
        <v-card v-if="product.description" rounded="lg" elevation="0" border class="mb-4">
          <div class="pa-4">
            <div class="section-title mb-3">Описание</div>
            <div class="detail-description">{{ product.description }}</div>
          </div>
        </v-card>

        <!-- Installment Calculator Preview -->
        <v-card rounded="lg" elevation="0" border class="mb-4">
          <div class="pa-4">
            <div class="section-title mb-3">Варианты рассрочки</div>
            <div class="installment-grid">
              <div
                v-for="(preview, idx) in installmentPreview"
                :key="idx"
                class="installment-card"
                :class="{ 'installment-card--featured': idx === 1 }"
              >
                <div class="installment-term">{{ preview.months }} мес</div>
                <div class="installment-monthly">{{ formatCurrency(preview.monthlyPayment) }}<span>/мес</span></div>
                <div class="installment-details">
                  <div class="installment-detail">
                    <span>Первый взнос</span>
                    <span class="font-weight-medium">{{ formatCurrency(preview.downPayment) }}</span>
                  </div>
                  <div class="installment-detail">
                    <span>Итого</span>
                    <span class="font-weight-medium">{{ formatCurrency(preview.total) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </v-card>

        <!-- Related deals -->
        <v-card v-if="relatedDeals.length" rounded="lg" elevation="0" border>
          <div class="pa-4">
            <div class="d-flex align-center justify-space-between mb-3">
              <div class="section-title">Сделки по товару</div>
              <span class="text-caption text-medium-emphasis">{{ relatedDeals.length }} сделок</span>
            </div>
            <div class="deals-list">
              <div
                v-for="deal in relatedDeals"
                :key="deal.id"
                class="deal-item"
                @click="router.push(`/deals/${deal.id}`)"
              >
                <div class="d-flex align-center ga-3">
                  <div class="deal-avatar" :style="{ background: DEAL_STATUS_CONFIG[deal.status]?.color || '#6b7280' }">
                    {{ deal.clientName.charAt(0) }}
                  </div>
                  <div class="flex-grow-1 min-width-0">
                    <div class="deal-client">{{ deal.clientName }}</div>
                    <div class="deal-info">
                      {{ deal.paidPayments }}/{{ deal.numberOfPayments }} платежей
                    </div>
                  </div>
                  <div class="text-end">
                    <div class="deal-amount">{{ formatCurrency(deal.totalPrice) }}</div>
                    <div
                      class="deal-status"
                      :style="{ background: DEAL_STATUS_CONFIG[deal.status]?.bgLight, color: DEAL_STATUS_CONFIG[deal.status]?.color }"
                    >
                      {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                    </div>
                  </div>
                </div>
                <v-progress-linear
                  :model-value="deal.numberOfPayments > 0 ? (deal.paidPayments / deal.numberOfPayments) * 100 : 0"
                  color="primary"
                  rounded
                  height="4"
                  class="mt-3"
                />
              </div>
            </div>
          </div>
        </v-card>
      </v-col>

      <!-- Right: Info sidebar -->
      <v-col cols="12" lg="4">
        <!-- Product info -->
        <v-card rounded="lg" elevation="0" border class="mb-4 position-sticky" style="top: 80px;">
          <div class="pa-4">
            <div class="section-title mb-3">Информация</div>

            <div class="info-list">
              <div class="info-row">
                <span class="info-label">
                  <v-icon icon="mdi-tag-outline" size="16" />
                  Категория
                </span>
                <span class="info-value">{{ getCategoryLabel(product.category) }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">
                  <v-icon icon="mdi-map-marker-outline" size="16" />
                  Город
                </span>
                <span class="info-value">{{ product.city }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">
                  <v-icon icon="mdi-calendar-range" size="16" />
                  Срок рассрочки
                </span>
                <span class="info-value">{{ product.minTermMonths }}–{{ product.maxTermMonths }} мес</span>
              </div>
              <div class="info-row">
                <span class="info-label">
                  <v-icon icon="mdi-percent" size="16" />
                  Мин. первый взнос
                </span>
                <span class="info-value">{{ product.minDownPaymentPercent }}%</span>
              </div>
              <div class="info-row">
                <span class="info-label">
                  <v-icon icon="mdi-calendar-check" size="16" />
                  Добавлен
                </span>
                <span class="info-value">{{ formatDate(product.createdAt) }}</span>
              </div>
            </div>

            <!-- Deal stats mini -->
            <div v-if="relatedDeals.length" class="deal-stats-mini mt-4">
              <div class="deal-stats-mini-title">Статистика продаж</div>
              <div class="deal-stats-grid">
                <div class="deal-stat-item">
                  <div class="deal-stat-val">{{ dealStats.total }}</div>
                  <div class="deal-stat-lbl">Сделок</div>
                </div>
                <div class="deal-stat-item">
                  <div class="deal-stat-val" style="color: #047857;">{{ dealStats.active }}</div>
                  <div class="deal-stat-lbl">Активных</div>
                </div>
                <div class="deal-stat-item">
                  <div class="deal-stat-val" style="color: #3b82f6;">{{ dealStats.completed }}</div>
                  <div class="deal-stat-lbl">Завершённых</div>
                </div>
                <div class="deal-stat-item">
                  <div class="deal-stat-val" style="color: #047857;">{{ formatCurrency(dealStats.revenue) }}</div>
                  <div class="deal-stat-lbl">Доход</div>
                </div>
              </div>
            </div>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Edit Dialog -->
    <v-dialog v-model="editDialog" max-width="540">
      <v-card rounded="lg">
        <div class="pa-5">
          <div class="d-flex align-center justify-space-between mb-4">
            <div class="text-h6 font-weight-bold">Редактировать товар</div>
            <button class="dialog-close-sm" @click="editDialog = false">
              <v-icon icon="mdi-close" size="18" />
            </button>
          </div>

          <div class="mb-3">
            <label class="field-label">Название</label>
            <input v-model="editForm.title" class="field-input" />
          </div>

          <div class="mb-3">
            <label class="field-label">Описание</label>
            <textarea v-model="editForm.description" class="field-input field-textarea" rows="3" />
          </div>

          <div class="d-flex ga-3 mb-3">
            <div class="flex-grow-1">
              <label class="field-label">Цена</label>
              <input v-model.number="editForm.price" type="number" class="field-input" />
            </div>
            <div class="flex-grow-1">
              <label class="field-label">Город</label>
              <input v-model="editForm.city" class="field-input" />
            </div>
          </div>

          <div class="d-flex ga-3 mb-3">
            <div class="flex-grow-1">
              <label class="field-label">Срок от (мес)</label>
              <input v-model.number="editForm.minTermMonths" type="number" class="field-input" />
            </div>
            <div class="flex-grow-1">
              <label class="field-label">Срок до (мес)</label>
              <input v-model.number="editForm.maxTermMonths" type="number" class="field-input" />
            </div>
            <div class="flex-grow-1">
              <label class="field-label">Взнос (%)</label>
              <input v-model.number="editForm.minDownPaymentPercent" type="number" class="field-input" />
            </div>
          </div>

          <div class="d-flex ga-2 mt-5">
            <button class="btn-secondary flex-grow-1" @click="editDialog = false">Отмена</button>
            <button class="btn-primary flex-grow-1" @click="saveEdit">
              <v-icon icon="mdi-check" size="16" />
              Сохранить
            </button>
          </div>
        </div>
      </v-card>
    </v-dialog>
  </div>

  <!-- Not found -->
  <div v-else class="at-page text-center pa-12">
    <v-icon icon="mdi-alert-circle-outline" size="56" color="grey-lighten-1" class="mb-3" />
    <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">Товар не найден</p>
    <button class="btn-primary mt-4" @click="router.push('/products')">
      <v-icon icon="mdi-arrow-left" size="16" />
      Вернуться в каталог
    </button>
  </div>
</template>

<style scoped>
/* Back button */
.back-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.back-btn:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

/* Action buttons */
.action-outlined-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.action-outlined-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: rgba(var(--v-theme-on-surface), 0.2);
}
.action-outlined-btn--warning {
  color: #f59e0b; border-color: rgba(245, 158, 11, 0.3);
}
.action-outlined-btn--warning:hover {
  background: rgba(245, 158, 11, 0.06);
}
.action-outlined-btn--success {
  color: #047857; border-color: rgba(4, 120, 87, 0.3);
}
.action-outlined-btn--success:hover {
  background: rgba(4, 120, 87, 0.06);
}

/* Hero */
.detail-hero {
  position: relative; overflow: hidden;
}
.detail-hero-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%);
}
.detail-hero-content {
  position: absolute; bottom: 20px; left: 24px; right: 24px; z-index: 2;
}
.detail-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px; border-radius: 6px;
  font-size: 12px; font-weight: 600;
  backdrop-filter: blur(8px);
}
.detail-badge--success { background: rgba(4, 120, 87, 0.85); color: #fff; }
.detail-badge--warning { background: rgba(245, 158, 11, 0.85); color: #fff; }
.detail-badge--info { background: rgba(255, 255, 255, 0.15); color: #fff; }

.detail-hero-title {
  font-size: 26px; font-weight: 800; color: #fff;
  line-height: 1.2; margin-bottom: 4px;
}
.detail-hero-price {
  font-size: 22px; font-weight: 700; color: #4ade80;
}

/* Section title */
.section-title {
  font-size: 15px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Description */
.detail-description {
  font-size: 14px; line-height: 1.7;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* Installment grid */
.installment-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 600px) { .installment-grid { grid-template-columns: 1fr; } }

.installment-card {
  padding: 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.02);
  transition: all 0.15s;
}
.installment-card--featured {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.04);
}
.installment-term {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-bottom: 8px;
}
.installment-card--featured .installment-term {
  color: rgb(var(--v-theme-primary));
}
.installment-monthly {
  font-size: 22px; font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.9);
  margin-bottom: 12px;
}
.installment-monthly span {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.installment-details {
  display: flex; flex-direction: column; gap: 6px;
}
.installment-detail {
  display: flex; justify-content: space-between;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Info sidebar */
.info-list {
  display: flex; flex-direction: column; gap: 2px;
}
.info-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.info-row:last-child { border-bottom: none; }
.info-label {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.info-value {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Deal stats mini */
.deal-stats-mini {
  padding: 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.deal-stats-mini-title {
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.03em;
}
.deal-stats-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;
}
.deal-stat-item { text-align: center; }
.deal-stat-val {
  font-size: 16px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.deal-stat-lbl {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Deals list */
.deals-list {
  display: flex; flex-direction: column; gap: 8px;
}
.deal-item {
  padding: 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  cursor: pointer; transition: all 0.15s;
}
.deal-item:hover {
  background: rgba(var(--v-theme-primary), 0.04);
  border-color: rgba(var(--v-theme-primary), 0.15);
}
.deal-avatar {
  width: 36px; height: 36px; min-width: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 14px;
}
.deal-client {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.deal-info {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.deal-amount {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 4px;
}
.deal-status {
  display: inline-block; font-size: 10px; font-weight: 600;
  padding: 2px 8px; border-radius: 5px;
}

/* Dialog */
.dialog-close-sm {
  width: 28px; height: 28px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.dialog-close-sm:hover {
  background: rgba(var(--v-theme-on-surface), 0.12);
}

.field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.field-input {
  width: 100%; height: 42px; padding: 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.03);
  outline: none; transition: all 0.15s;
}
.field-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}
.field-textarea {
  height: auto; padding: 10px 14px; resize: vertical;
}

.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 42px; padding: 0 20px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.btn-primary:hover { background: #065f46; }

.btn-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 42px; padding: 0 20px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.btn-secondary:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* Dark mode */
:global(.dark) .installment-card { background: #1e1e2e; border-color: #2e2e42; }
:global(.dark) .installment-card--featured { background: rgba(4, 120, 87, 0.08); border-color: rgba(4, 120, 87, 0.2); }
:global(.dark) .deal-item { background: rgba(255,255,255,0.02); border-color: #2e2e42; }
:global(.dark) .deal-stats-mini { background: rgba(255,255,255,0.03); }
:global(.dark) .field-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
:global(.dark) .field-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}

@media (max-width: 960px) {
  .detail-hero-title { font-size: 20px; }
  .detail-hero-price { font-size: 18px; }
  .detail-hero-content { bottom: 16px; left: 16px; right: 16px; }
}
</style>
