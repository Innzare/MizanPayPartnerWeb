<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDate } from '@/utils/formatters'

interface PaymentRow {
  paymentId: string
  number: number
  amount: number
  dueDate: string
  status: 'PENDING' | 'OVERDUE'
  dealId: string
  dealNumber: number | null
  productName: string
  clientName: string
  clientPhone: string | null
  canSend: boolean
}

interface PreviewResponse {
  daysBeforeDue: number
  payments: PaymentRow[]
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const toast = useToast()

const daysBeforeDue = ref(3)
const loading = ref(false)
const sending = ref(false)
const payments = ref<PaymentRow[]>([])
const excluded = ref<Set<string>>(new Set())
const search = ref('')

// On dialog open: reset, then preview with current daysBeforeDue.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      excluded.value = new Set()
      search.value = ''
      loadPreview()
    }
  },
)

async function loadPreview() {
  loading.value = true
  try {
    const res = await api.post<PreviewResponse>('/whatsapp/remind-preview', {
      daysBeforeDue: daysBeforeDue.value,
    })
    payments.value = res.payments
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить список')
    payments.value = []
  } finally {
    loading.value = false
  }
}

const visiblePayments = computed(() => {
  if (!search.value.trim()) return payments.value
  const s = search.value.trim().toLowerCase()
  return payments.value.filter(
    (p) =>
      p.productName.toLowerCase().includes(s) ||
      p.clientName.toLowerCase().includes(s) ||
      (p.clientPhone ?? '').toLowerCase().includes(s),
  )
})

const sendablePayments = computed(() => payments.value.filter((p) => p.canSend))
const selectedPayments = computed(() =>
  sendablePayments.value.filter((p) => !excluded.value.has(p.paymentId)),
)
const selectedAmount = computed(() => selectedPayments.value.reduce((s, p) => s + p.amount, 0))
const noPhoneCount = computed(() => payments.value.filter((p) => !p.canSend).length)

function toggle(pid: string) {
  const next = new Set(excluded.value)
  if (next.has(pid)) next.delete(pid)
  else next.add(pid)
  excluded.value = next
}

function selectAllVisible() {
  const next = new Set(excluded.value)
  for (const p of visiblePayments.value) {
    if (p.canSend) next.delete(p.paymentId)
  }
  excluded.value = next
}

function clearAllVisible() {
  const next = new Set(excluded.value)
  for (const p of visiblePayments.value) {
    if (p.canSend) next.add(p.paymentId)
  }
  excluded.value = next
}

const isAllVisibleSelected = computed(() => {
  const sendable = visiblePayments.value.filter((p) => p.canSend)
  if (sendable.length === 0) return false
  return sendable.every((p) => !excluded.value.has(p.paymentId))
})

async function send() {
  const ids = selectedPayments.value.map((p) => p.paymentId)
  if (!ids.length) {
    toast.error('Выберите хотя бы один платёж')
    return
  }
  if (!confirm(`Отправить ${ids.length} напоминаний? Действие необратимо.`)) return

  sending.value = true
  try {
    const res = await api.post<{ sent: number; failed: number; total: number }>(
      '/whatsapp/remind-all',
      { paymentIds: ids },
    )
    toast.success(`Отправлено ${res.sent} из ${res.total}`)
    if (res.failed > 0) toast.error(`${res.failed} не удалось отправить`)
    emit('update:modelValue', false)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка отправки')
  } finally {
    sending.value = false
  }
}

function statusLabel(s: string) {
  return s === 'OVERDUE' ? 'Просрочен' : 'Скоро'
}
function statusColor(s: string) {
  return s === 'OVERDUE' ? '#ef4444' : '#f59e0b'
}
function maskPhone(p: string | null) {
  if (!p) return '—'
  // Light masking: +7 (XXX) XXX-XX-XX → keep readable but consistent
  const digits = p.replace(/\D/g, '')
  if (digits.length === 11) {
    return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
  }
  return p
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="(v) => emit('update:modelValue', v)"
    max-width="780"
    persistent
  >
    <v-card rounded="lg" class="srd-card">
      <!-- Header -->
      <div class="srd-header">
        <div class="srd-header-icon">
          <v-icon icon="mdi-whatsapp" size="22" />
        </div>
        <div class="srd-header-text">
          <div class="srd-title">Напоминания о платежах</div>
          <div class="srd-subtitle">Выберите кому и о каких платежах напомнить</div>
        </div>
        <button class="srd-close" @click="emit('update:modelValue', false)">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <!-- Filters -->
      <div class="srd-filters">
        <div class="srd-days">
          <label class="srd-days-label">Включить платежи на ближайшие</label>
          <div class="srd-days-control">
            <button
              class="srd-days-btn"
              v-for="d in [1, 3, 7, 14, 30]"
              :key="d"
              :class="{ active: daysBeforeDue === d }"
              @click="daysBeforeDue = d; loadPreview()"
            >
              {{ d }} {{ d === 1 ? 'день' : d <= 4 ? 'дня' : 'дней' }}
            </button>
          </div>
        </div>
        <div class="srd-search-wrap">
          <v-icon icon="mdi-magnify" size="16" class="srd-search-icon" />
          <input
            v-model="search"
            type="text"
            class="srd-search"
            placeholder="Поиск по товару, клиенту или телефону..."
          />
        </div>
      </div>

      <!-- Status strip -->
      <div class="srd-summary">
        <span class="srd-summary-item">
          <strong>{{ payments.length }}</strong>
          {{ payments.length === 1 ? 'платёж' : 'платежей' }} в окне
        </span>
        <span class="srd-summary-sep">·</span>
        <span class="srd-summary-item srd-summary-item--ok">
          <strong>{{ selectedPayments.length }}</strong> к отправке
          ({{ formatCurrency(selectedAmount) }})
        </span>
        <span v-if="noPhoneCount > 0" class="srd-summary-sep">·</span>
        <span v-if="noPhoneCount > 0" class="srd-summary-item srd-summary-item--warn">
          <v-icon icon="mdi-phone-off" size="13" />
          <strong>{{ noPhoneCount }}</strong> без телефона
        </span>
      </div>

      <!-- List -->
      <div class="srd-list-head" v-if="payments.length > 0">
        <label class="srd-check">
          <input
            type="checkbox"
            :checked="isAllVisibleSelected"
            @change="isAllVisibleSelected ? clearAllVisible() : selectAllVisible()"
          />
        </label>
        <span class="srd-list-head-label">Платёж</span>
        <span class="srd-list-head-spacer" />
        <span class="srd-list-head-amount">Сумма</span>
      </div>

      <div class="srd-list" :class="{ loading }">
        <div v-if="loading" class="srd-empty">
          <v-progress-circular indeterminate size="28" color="primary" />
        </div>
        <div v-else-if="!visiblePayments.length" class="srd-empty">
          <v-icon icon="mdi-cash-check" size="36" color="grey" />
          <div class="srd-empty-title">Нет платежей по фильтру</div>
          <div class="srd-empty-sub">Попробуйте изменить срок или поиск</div>
        </div>
        <div
          v-for="p in visiblePayments"
          :key="p.paymentId"
          class="srd-row"
          :class="{ 'srd-row--disabled': !p.canSend }"
          @click="p.canSend && toggle(p.paymentId)"
        >
          <label class="srd-check" @click.stop>
            <input
              type="checkbox"
              :checked="p.canSend && !excluded.has(p.paymentId)"
              :disabled="!p.canSend"
              @change="toggle(p.paymentId)"
            />
          </label>

          <div class="srd-row-main">
            <div class="srd-row-title">
              <span class="srd-row-deal">
                <span v-if="p.dealNumber" class="srd-row-dealnum">#{{ p.dealNumber }}</span>
                {{ p.productName }}
              </span>
              <span
                class="srd-row-status"
                :style="{ background: statusColor(p.status) + '18', color: statusColor(p.status) }"
              >
                {{ statusLabel(p.status) }}
              </span>
            </div>
            <div class="srd-row-meta">
              <v-icon icon="mdi-account-outline" size="12" />
              {{ p.clientName }}
              <span class="srd-row-meta-sep">·</span>
              <v-icon icon="mdi-phone-outline" size="12" />
              <span :class="{ 'srd-no-phone': !p.canSend }">
                {{ p.canSend ? maskPhone(p.clientPhone) : 'Нет телефона' }}
              </span>
              <span class="srd-row-meta-sep">·</span>
              Платёж #{{ p.number }} до {{ formatDate(p.dueDate) }}
            </div>
          </div>

          <div class="srd-row-amount">{{ formatCurrency(p.amount) }}</div>
        </div>
      </div>

      <!-- Footer -->
      <div class="srd-footer">
        <button class="srd-btn srd-btn--ghost" @click="emit('update:modelValue', false)" :disabled="sending">
          Отмена
        </button>
        <button
          class="srd-btn srd-btn--primary"
          :disabled="sending || selectedPayments.length === 0"
          @click="send"
        >
          <v-progress-circular v-if="sending" indeterminate size="14" width="2" color="white" />
          <v-icon v-else icon="mdi-whatsapp" size="16" />
          Отправить {{ selectedPayments.length }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.srd-card { overflow: hidden; }

/* Header */
.srd-header {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.srd-header-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(37, 211, 102, 0.10); color: #25d366;
}
.srd-header-text { flex: 1; min-width: 0; }
.srd-title { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.srd-subtitle { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 1px; }
.srd-close {
  width: 30px; height: 30px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.srd-close:hover { background: rgba(var(--v-theme-on-surface), 0.10); }

/* Filters */
.srd-filters {
  padding: 14px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.srd-days-label {
  display: block; font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-bottom: 6px;
}
.srd-days-control { display: flex; gap: 4px; flex-wrap: wrap; }
.srd-days-btn {
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.srd-days-btn:hover { border-color: rgba(99, 102, 241, 0.30); color: #6366f1; }
.srd-days-btn.active {
  border-color: #6366f1; background: rgba(99, 102, 241, 0.10); color: #6366f1; font-weight: 600;
}

.srd-search-wrap {
  position: relative; margin-top: 10px;
}
.srd-search-icon {
  position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.srd-search {
  width: 100%; padding: 8px 12px 8px 32px;
  border-radius: 8px; border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 13px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-family: inherit;
}
.srd-search:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);
}

/* Summary */
.srd-summary {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6);
  flex-wrap: wrap;
}
.srd-summary-item { display: inline-flex; align-items: center; gap: 4px; }
.srd-summary-item strong { font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.srd-summary-item--ok strong { color: #047857; }
.srd-summary-item--warn { color: #f59e0b; }
.srd-summary-item--warn strong { color: #f59e0b; }
.srd-summary-sep { opacity: 0.4; }

/* List header */
.srd-list-head {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45);
  text-transform: uppercase; letter-spacing: 0.4px;
}
.srd-list-head-label { font-weight: 700; }
.srd-list-head-spacer { flex: 1; }
.srd-list-head-amount { font-weight: 700; padding-right: 4px; }

/* List */
.srd-list { max-height: 50vh; overflow-y: auto; }
.srd-list.loading { min-height: 200px; }

.srd-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.04);
  cursor: pointer;
  transition: background 0.12s;
}
.srd-row:hover { background: rgba(99, 102, 241, 0.04); }
.srd-row--disabled { cursor: not-allowed; opacity: 0.55; }
.srd-row--disabled:hover { background: transparent; }

.srd-check {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  cursor: pointer;
}
.srd-check input { width: 16px; height: 16px; cursor: pointer; accent-color: #047857; }

.srd-row-main { flex: 1; min-width: 0; }
.srd-row-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.srd-row-deal { display: inline-flex; align-items: center; gap: 6px; }
.srd-row-dealnum {
  font-size: 11px; font-weight: 700; padding: 1px 6px;
  border-radius: 5px; background: rgba(99, 102, 241, 0.10); color: #6366f1;
}
.srd-row-status {
  font-size: 10px; font-weight: 700;
  padding: 2px 8px; border-radius: 5px;
}
.srd-row-meta {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 3px;
}
.srd-row-meta-sep { opacity: 0.4; margin: 0 3px; }
.srd-no-phone { color: #f59e0b; font-weight: 500; }
.srd-row-amount {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
}

/* Empty */
.srd-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 40px 16px; text-align: center;
  min-height: 180px;
}
.srd-empty-title { font-size: 14px; font-weight: 600; margin-top: 10px; color: rgba(var(--v-theme-on-surface), 0.7); }
.srd-empty-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }

/* Footer */
.srd-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.srd-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 18px; border-radius: 9px; border: none;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.srd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.srd-btn--ghost {
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
}
.srd-btn--ghost:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.05); }
.srd-btn--primary {
  background: #25d366; color: #fff;
}
.srd-btn--primary:hover:not(:disabled) { background: #1ebe5a; }
</style>
