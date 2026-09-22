<script setup lang="ts">
/**
 * Окно предпросмотра сделки.
 *
 * Открывается из списка сделок и со страницы платежей. Раньше это были две
 * почти одинаковые разметки в двух файлах: одна успела получить новый график
 * и приём оплаты, вторая осталась со старым простым списком — то есть по
 * одной и той же сделке в двух местах показывали разное.
 *
 * Денежных действий здесь нет: приём оплаты и переход на страницу сделки
 * уходят наверх событиями, а окна для них живут на самих страницах.
 */
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import ClientLink from '@/components/ClientLink.vue'
import DealScheduleTable from '@/components/DealScheduleTable.vue'
import PaymentDetailsDialog from '@/components/PaymentDetailsDialog.vue'
import { DEAL_STATUS_CONFIG } from '@/constants/statuses'
import { formatCurrency, formatDate, formatPercent, formatPhone } from '@/utils/formatters'
import * as money from '@/utils/paymentMath'
import { userName, clientProfileName, type Deal, type Payment } from '@/types'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    deal: Deal | null
    /** График сделки — грузит владелец окна, здесь только показываем. */
    payments: Payment[]
    loading?: boolean
    fullscreen?: boolean
  }>(),
  { loading: false, fullscreen: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** Принять оплату по этой строке графика. */
  (e: 'pay', payment: Payment): void
  /** Перейти на полную страницу сделки. */
  (e: 'open', deal: Deal): void
}>()

const authStore = useAuthStore()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const clientName = computed(() => {
  const d = props.deal
  if (!d) return '—'
  if (d.client) return userName(d.client)
  if (d.clientProfile) return clientProfileName(d.clientProfile)
  return d.externalClientName || '—'
})

const clientPhone = computed<string | null>(() => {
  const d = props.deal
  if (!d) return null
  // Тот же порядок, что на сервере: профиль → пользователь → внешний телефон.
  const raw = d.clientProfile?.phone || d.client?.phone || d.externalClientPhone
  return raw ? formatPhone(raw) : null
})

const paidTotal = computed(() =>
  props.payments.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amount, 0),
)

const progress = computed(() => {
  const d = props.deal
  if (!d?.numberOfPayments) return 0
  return Math.min(100, (d.paidPayments / d.numberOfPayments) * 100)
})

/** Строка, с которой начнётся оплата: самая ранняя открытая, сначала недоплаты. */
const payTarget = computed(() => money.paymentToPay(props.payments) ?? null)
const canMarkPaid = computed(() => authStore.can('payments.markPaid'))

// Карточка платежа по клику на строку графика.
const detailsDialog = ref(false)
const detailsId = ref<string | null>(null)
const detailsPayment = computed(
  () => props.payments.find((p) => p.id === detailsId.value) ?? null,
)
function openDetails(p: Payment) {
  detailsId.value = p.id
  detailsDialog.value = true
}

/** Скриншот оплаты: своего окна увеличения у предпросмотра нет. */
function openProof(url: string) {
  window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <!-- 900px: график в ужатом виде (без «Остатка после») помещается целиком,
       а окно не растягивается на весь экран. -->
  <v-dialog v-model="open" max-width="900" scrollable :fullscreen="fullscreen">
    <v-card v-if="deal" rounded="lg">
      <div class="dialog-hero">
        <button class="dialog-close" @click="open = false">
          <v-icon icon="mdi-close" size="18" />
        </button>
        <div class="dialog-hero-photo" :class="{ 'dialog-hero-photo--empty': !deal.productPhotos?.length }">
          <img v-if="deal.productPhotos?.[0]" :src="deal.productPhotos[0]" alt="" />
          <div v-else class="dialog-hero-photo-placeholder">
            <v-icon icon="mdi-image-off-outline" size="28" />
            <span>Нет фото</span>
          </div>
        </div>
        <div class="dialog-hero-content">
          <div class="dialog-status" :style="{ color: DEAL_STATUS_CONFIG[deal.status]?.color }">
            <span class="dialog-status-dot" :style="{ background: DEAL_STATUS_CONFIG[deal.status]?.color }" />
            {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
          </div>
          <div class="dialog-title">{{ deal.productName }}</div>
          <div class="dialog-hero-meta">
            <v-icon icon="mdi-account" size="14" />
            <ClientLink :profile-id="deal.clientProfileId" :name="clientName" />
            <template v-if="clientPhone">
              <span class="mx-1">·</span>
              <v-icon icon="mdi-phone-outline" size="13" />
              {{ clientPhone }}
            </template>
            <span class="mx-1">·</span>
            Создано {{ formatDate(deal.createdAt) }}
          </div>
        </div>
      </div>

      <v-card-text class="pa-5">
        <div class="dialog-finance-grid mb-5">
          <div class="dialog-finance-item">
            <div class="dialog-finance-label">Закупочная</div>
            <div class="dialog-finance-value">{{ formatCurrency(deal.purchasePrice) }}</div>
          </div>
          <div class="dialog-finance-item">
            <div class="dialog-finance-label">Итого</div>
            <div class="dialog-finance-value font-weight-bold">{{ formatCurrency(deal.totalPrice) }}</div>
          </div>
          <div class="dialog-finance-item">
            <div class="dialog-finance-label">Наценка</div>
            <div class="dialog-finance-value" style="color: #047857;">
              +{{ formatCurrency(deal.markup) }} ({{ formatPercent(deal.markupPercent) }})
            </div>
          </div>
          <div class="dialog-finance-item">
            <div class="dialog-finance-label">Оплачено</div>
            <div class="dialog-finance-value" style="color: #047857;">{{ formatCurrency(paidTotal) }}</div>
          </div>
          <div class="dialog-finance-item">
            <div class="dialog-finance-label">Остаток</div>
            <div class="dialog-finance-value" style="color: #f59e0b;">{{ formatCurrency(deal.remainingAmount) }}</div>
          </div>
        </div>

        <div class="mb-5">
          <div class="d-flex justify-space-between align-center mb-2">
            <span class="text-body-2 font-weight-medium">Прогресс платежей</span>
            <span class="text-caption text-medium-emphasis">
              {{ deal.paidPayments }} из {{ deal.numberOfPayments }}
            </span>
          </div>
          <v-progress-linear :model-value="progress" color="primary" rounded height="8" />
        </div>

        <!-- Приём оплаты — основное действие окна, переход на страницу сделки
             рядом вспомогательным. -->
        <div class="dialog-actions-row mb-5">
          <button
            v-if="canMarkPaid && !deal.locked && payTarget"
            class="detail-link-btn detail-link-btn--pay"
            @click="emit('pay', payTarget)"
          >
            <v-icon icon="mdi-cash-check" size="16" />
            Принять оплату
          </button>
          <button class="detail-link-btn" @click="open = false; emit('open', deal)">
            <v-icon icon="mdi-open-in-new" size="16" />
            Открыть полную страницу сделки
          </button>
        </div>

        <div v-if="payments.length">
          <div class="text-body-2 font-weight-bold mb-3">График платежей</div>
          <div v-if="loading && !payments.length" class="d-flex justify-center py-4">
            <v-progress-circular indeterminate size="22" width="2" color="primary" />
          </div>
          <!-- Тот же график, что на странице сделки, только ужатый: клик по
               строке открывает карточку платежа. -->
          <DealScheduleTable
            v-else
            :payments="payments"
            compact
            @proof="openProof"
            @select="openDetails"
          />
        </div>
        <div v-else-if="loading" class="d-flex justify-center py-4">
          <v-progress-circular indeterminate size="22" width="2" color="primary" />
        </div>
      </v-card-text>
    </v-card>

    <PaymentDetailsDialog v-model="detailsDialog" :payment="detailsPayment" :deal="deal" />
  </v-dialog>
</template>

<style scoped>
.dialog-hero {
  position: relative;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  /* На зелёной подложке ссылка-имя должна быть белой, иначе сливается. */
  --client-link-color: #fff;
  --client-link-underline: rgba(255, 255, 255, 0.6);
  display: flex; gap: 16px; align-items: stretch;
  padding: 20px 24px;
  min-height: 160px;
}
.dialog-close {
  position: absolute; top: 12px; right: 12px; z-index: 3;
  width: 30px; height: 30px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
  backdrop-filter: blur(8px);
}
.dialog-close:hover { background: rgba(255, 255, 255, 0.3); }
.dialog-hero-photo {
  flex-shrink: 0;
  width: 120px; height: 120px;
  border-radius: 12px; overflow: hidden;
  align-self: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.dialog-hero-photo img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.dialog-hero-photo--empty {
  display: flex; align-items: center; justify-content: center;
}
.dialog-hero-photo-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  color: rgba(255, 255, 255, 0.55); font-size: 10px;
}
.dialog-hero-content {
  flex: 1; min-width: 0; color: #fff;
  display: flex; flex-direction: column; justify-content: flex-start;
  padding-right: 44px; /* место под крестик */
}
.dialog-status {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  font-size: 11px; font-weight: 600;
  padding: 4px 10px; border-radius: 999px;
  background: #fff; margin-bottom: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.dialog-status-dot { width: 6px; height: 6px; border-radius: 50%; }
.dialog-title {
  font-size: 20px; font-weight: 700; color: #fff; line-height: 1.25;
  margin-bottom: 6px; word-break: break-word;
}
.dialog-hero-meta {
  font-size: 12px; opacity: 0.85;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  margin-top: auto;
}

.dialog-finance-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 600px) { .dialog-finance-grid { grid-template-columns: repeat(2, 1fr); } }
.dialog-finance-item {
  padding: 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.dialog-finance-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 2px;
}
.dialog-finance-value {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.dialog-actions-row { display: flex; gap: 8px; flex-wrap: wrap; }
.dialog-actions-row .detail-link-btn { flex: 1 1 200px; margin-bottom: 0; }
.detail-link-btn {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 10px 16px; border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.04);
  color: rgb(var(--v-theme-primary));
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  justify-content: center;
}
.detail-link-btn:hover {
  background: rgba(var(--v-theme-primary), 0.1);
  border-color: rgba(var(--v-theme-primary), 0.5);
}
/* Приём оплаты — основное действие: сплошная фирменная заливка. Идёт строго
   после базового правила: специфичность одинаковая, выигрывает тот, кто ниже. */
.detail-link-btn--pay {
  border: 1px solid rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: #fff;
  font-weight: 600;
}
.detail-link-btn--pay:hover {
  background: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary));
  filter: brightness(1.12);
}
</style>
