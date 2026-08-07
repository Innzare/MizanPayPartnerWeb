<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDebtorsStore, type DebtorRow, type CollectionActivity, type DealPayment } from '@/stores/debtors'
import { formatCurrency, formatDateShort } from '@/utils/formatters'

const props = defineProps<{ modelValue: boolean; row: DebtorRow | null; editActivity?: CollectionActivity | null }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved', activity: CollectionActivity): void
}>()
const isEdit = computed(() => !!props.editActivity)
function localIso(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const store = useDebtorsStore()
const date = ref('')
const amount = ref<number | null>(null)
const note = ref('')
const saving = ref(false)
const error = ref('')
const todayIso = new Date().toISOString().slice(0, 10)

// Просроченные платежи сделки — можно выбрать, какие именно обещают оплатить.
const overduePays = ref<DealPayment[]>([])
const selectedNums = ref<number[]>([])
function fmtDate(ts: number) { return formatDateShort(new Date(ts).toISOString()) }

function togglePay(n: number) {
  const i = selectedNums.value.indexOf(n)
  if (i >= 0) selectedNums.value.splice(i, 1)
  else selectedNums.value.push(n)
  syncAmount()
}
// Сумма обещания = сумма выбранных платежей (пусто → вся просрочка).
function syncAmount() {
  const sel = overduePays.value.filter((p) => selectedNums.value.includes(p.number))
  if (sel.length) amount.value = sel.reduce((s, p) => s + p.amount, 0)
  else amount.value = props.row?.overdueAmount ?? null
}

watch(() => props.modelValue, async (open) => {
  if (open) {
    const ed = props.editActivity
    date.value = ed?.promisedDate ? localIso(ed.promisedDate) : (props.row?.promisedDate ? localIso(props.row.promisedDate) : '')
    amount.value = ed?.promisedAmount ?? props.row?.overdueAmount ?? null
    note.value = ed?.text ?? ''
    error.value = ''
    overduePays.value = []
    selectedNums.value = []
    if (props.row) {
      try {
        const all = await store.fetchDealPayments(props.row.dealId)
        overduePays.value = all.filter((p) => p.status === 'OVERDUE')
        if (ed && ed.promisedPaymentNumbers && ed.promisedPaymentNumbers.length) {
          // Редактирование: восстановить ранее выбранные платежи.
          selectedNums.value = overduePays.value.filter((p) => ed.promisedPaymentNumbers.includes(p.number)).map((p) => p.number)
        } else {
          // Новое обещание (или старое без выбора) — по умолчанию все просроченные.
          selectedNums.value = overduePays.value.map((p) => p.number)
        }
        if (!ed) syncAmount()
      } catch { /* контекст необязателен */ }
    }
  }
})

async function save() {
  if (!props.row || !date.value) return
  saving.value = true
  error.value = ''
  try {
    const payload = {
      promisedDate: date.value,
      promisedAmount: amount.value != null && amount.value > 0 ? amount.value : undefined,
      note: note.value.trim() || undefined,
      paymentNumbers: selectedNums.value.length ? [...selectedNums.value].sort((a, b) => a - b) : undefined,
    }
    const act = props.editActivity
      ? await store.editPromise(props.editActivity.id, payload)
      : await store.addPromise(props.row.dealId, payload)
    emit('saved', act)
    emit('update:modelValue', false)
  } catch (e: any) {
    error.value = e?.message || 'Не удалось сохранить обещание'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="440" @update:model-value="emit('update:modelValue', $event)">
    <v-card rounded="lg">
      <v-card-title class="d-flex align-center ga-2 pt-4">
        <v-icon icon="mdi-hand-coin-outline" color="warning" /> {{ isEdit ? 'Редактировать обещание' : 'Обещание оплаты' }}
      </v-card-title>
      <v-card-text>
        <!-- Контекст: по какой сделке и что просрочено -->
        <div v-if="row" class="pd-context">
          <div class="pd-ctx-head">
            <div class="pd-ctx-client">{{ row.clientName }}</div>
            <div class="pd-ctx-deal">Сделка #{{ row.dealNumber }} · {{ row.productName }}</div>
          </div>
          <div class="pd-ctx-overdue">
            <span>Просрочка</span>
            <b>{{ formatCurrency(row.overdueAmount) }}</b>
            <span class="pd-ctx-count">{{ row.overdueCount }} платеж(ей)</span>
          </div>
          <!-- Выбор конкретных просроченных платежей -->
          <div v-if="overduePays.length" class="pd-pays">
            <div class="pd-pays-hint">Отметьте, какие платежи клиент обещал оплатить:</div>
            <button
              v-for="p in overduePays"
              :key="p.id"
              type="button"
              class="pd-pay"
              :class="{ 'pd-pay--on': selectedNums.includes(p.number) }"
              @click="togglePay(p.number)"
            >
              <v-icon :icon="selectedNums.includes(p.number) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'" size="18" :color="selectedNums.includes(p.number) ? 'primary' : ''" />
              <span class="pd-pay-n">Платёж №{{ p.number }}</span>
              <span class="pd-pay-date">{{ fmtDate(p.dueDate) }}</span>
              <span class="pd-pay-amt">{{ formatCurrency(p.amount) }}</span>
            </button>
          </div>
        </div>

        <label class="pd-label">Дата обещания</label>
        <v-text-field v-model="date" type="date" :min="todayIso" variant="outlined" density="comfortable" rounded="lg" hide-details class="mb-4" />
        <label class="pd-label">Сумма (необязательно)</label>
        <v-text-field v-model.number="amount" type="number" min="0" suffix="₽" variant="outlined" density="comfortable" rounded="lg" hide-details class="mb-4" />
        <label class="pd-label">Заметка (необязательно)</label>
        <v-textarea v-model="note" rows="2" variant="outlined" density="comfortable" rounded="lg" hide-details placeholder="Например: обещал после зарплаты 10 числа" />
        <div v-if="error" class="text-error text-body-2 mt-2">{{ error }}</div>
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">Отмена</v-btn>
        <v-btn color="primary" variant="flat" rounded="lg" :loading="saving" :disabled="!date" @click="save">Сохранить</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.pd-label { font-size: 13px; font-weight: 600; display: block; margin-bottom: 6px; }

/* Контекст сделки/платежей */
.pd-context { padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.1); background: rgba(var(--v-theme-on-surface), 0.02); margin-bottom: 18px; }
.pd-ctx-client { font-size: 14px; font-weight: 700; }
.pd-ctx-deal { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 1px; }
.pd-ctx-overdue { display: flex; align-items: baseline; gap: 8px; margin-top: 8px; font-size: 13px; }
.pd-ctx-overdue b { color: #ef4444; font-size: 15px; }
.pd-ctx-count { color: rgba(var(--v-theme-on-surface), 0.5); font-size: 12px; }
.pd-pays { margin-top: 10px; border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.12); padding-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.pd-pays-hint { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); margin-bottom: 2px; }
.pd-pay { display: flex; align-items: center; gap: 8px; font-size: 12.5px; width: 100%; text-align: left; padding: 6px 8px; border-radius: 8px; border: 1px solid transparent; background: transparent; cursor: pointer; transition: all 0.12s; color: inherit; }
.pd-pay:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.pd-pay--on { background: rgba(4, 120, 87, 0.06); border-color: rgba(4, 120, 87, 0.25); }
.pd-pay-n { font-weight: 600; }
.pd-pay-date { color: rgba(var(--v-theme-on-surface), 0.5); }
.pd-pay-amt { margin-left: auto; font-weight: 700; color: #dc2626; }
</style>
