<script setup lang="ts">
import { inlineOrToast } from '@/api/showError'
import { ref, computed, watch } from 'vue'
import { useSuppliersStore, type SupplierDebt } from '@/stores/suppliers'
import { formatCurrency, formatDateShort } from '@/utils/formatters'
import FormModal from '@/components/FormModal.vue'
import DateField from '@/components/DateField.vue'
import AccountSelect from '@/components/AccountSelect.vue'
import { useAccountingStore } from '@/stores/accounting'

const props = defineProps<{
  modelValue: boolean
  supplierId: string
  supplierName: string
  debts: SupplierDebt[]
  presetDebtId?: string | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved'): void
}>()

const store = useSuppliersStore()
const accounting = useAccountingStore()
const saving = ref(false)
const error = ref('')
const note = ref('')
const date = ref('')

// Per-debt allocation rows (array — avoids index-access uncertainty).
interface AllocRow { debt: SupplierDebt; on: boolean; amount: number }
const allocRows = ref<AllocRow[]>([])
let idemKey = ''

/**
 * Деньги выплаты уходят из кассы сделки. Одна выплата — одна касса: если
 * долги у поставщика в нескольких кассах, сначала выбирают кассу.
 */
const boxKey = (d: SupplierDebt) => d.cashBoxId ?? ''
const openDebts = computed(() => props.debts.filter((d) => d.status === 'OPEN' && d.remaining > 0))
const boxes = computed(() => {
  const m = new Map<string, { id: string; name: string; remaining: number }>()
  for (const d of openDebts.value) {
    const k = boxKey(d)
    const b = m.get(k) ?? { id: k, name: d.cashBoxName ?? 'Без кассы', remaining: 0 }
    b.remaining += d.remaining
    m.set(k, b)
  }
  return [...m.values()]
})
const boxId = ref('')
const accountId = ref<string | null>(null)

/** Счета кассы выплаты — включённые. */
const accounts = computed(() => accounting.accounts.filter((a) => !a.disabledAt && a.cashBoxId === boxId.value))

const totalAmount = computed(() => allocRows.value.reduce((s, r) => s + (r.on ? r.amount || 0 : 0), 0))

function fillRows() {
  allocRows.value = openDebts.value
    .filter((d) => boxKey(d) === boxId.value)
    .map((d) => ({ debt: d, on: props.presetDebtId ? d.id === props.presetDebtId : true, amount: d.remaining }))
  accountId.value = accounts.value[0]?.id ?? null
}

watch(() => props.modelValue, async (open) => {
  if (open) {
    error.value = ''
    note.value = ''
    date.value = ''
    idemKey = crypto.randomUUID()
    const preset = props.presetDebtId ? openDebts.value.find((d) => d.id === props.presetDebtId) : null
    boxId.value = preset ? boxKey(preset) : boxes.value[0]?.id ?? ''
    if (!accounting.accounts.length) await accounting.fetchAccounts().catch(() => {})
    fillRows()
  }
})

watch(boxId, () => { if (props.modelValue) fillRows() })

function fmtDate(ts: number) { return formatDateShort(new Date(ts).toISOString()) }

async function save() {
  const allocations = allocRows.value
    .filter((r) => r.on && (r.amount || 0) > 0)
    .map((r) => ({ debtId: r.debt.id, amount: Math.round(r.amount) }))
  if (!allocations.length) { error.value = 'Выберите хотя бы один долг'; return }
  const amount = allocations.reduce((s, a) => s + a.amount, 0)

  saving.value = true
  error.value = ''
  try {
    await store.createPayout(props.supplierId, {
      amount,
      date: date.value || undefined,
      note: note.value.trim() || undefined,
      allocations,
      idemKey,
      cashBoxId: boxId.value || undefined,
      accountId: accountId.value || undefined,
    })
    emit('saved')
    emit('update:modelValue', false)
  } catch (e: any) {
    error.value = inlineOrToast(e, 'Не удалось провести выплату')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <FormModal
    :model-value="modelValue"
    title="Выплата поставщику"
    :subtitle="supplierName"
    icon="mdi-cash-check"
    :max-width="540"
    @update:model-value="emit('update:modelValue', $event)"
  >
        <div v-if="boxes.length > 1" class="form-field">
          <label class="field-label">Касса</label>
          <div class="pd-boxes">
            <button
              v-for="b in boxes"
              :key="b.id"
              type="button"
              class="pd-box"
              :class="{ 'pd-box--on': b.id === boxId }"
              @click="boxId = b.id"
            >
              <span class="pd-box-name">{{ b.name }}</span>
              <span class="pd-box-sum">долг {{ formatCurrency(b.remaining) }}</span>
            </button>
          </div>
        </div>

        <p class="text-body-2 text-medium-emphasis mb-3">Отметьте долги, которые оплачиваете.</p>

        <div v-if="!allocRows.length" class="text-center pa-6 text-medium-emphasis">Открытых долгов нет</div>

        <div v-else class="pd-list">
          <div v-for="r in allocRows" :key="r.debt.id" class="pd-item" :class="{ on: r.on }">
            <button type="button" class="pd-check" @click="r.on = !r.on">
              <v-icon :icon="r.on ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'" size="20" :color="r.on ? 'primary' : ''" />
            </button>
            <div class="pd-info">
              <div class="pd-deal">Сделка #{{ r.debt.dealNumber }} · {{ r.debt.productName }}</div>
              <div class="pd-sub">{{ fmtDate(r.debt.dealDate) }} · остаток {{ formatCurrency(r.debt.remaining) }}</div>
            </div>
            <div class="pd-amt">
              <input v-clear
                v-if="r.on"
                v-model.number="r.amount"
                type="number" min="0" :max="r.debt.remaining"
                class="pd-amt-input"
              />
              <span v-else class="text-medium-emphasis">—</span>
            </div>
          </div>
        </div>

        <div v-if="allocRows.length" class="pd-total">
          <span>К выплате</span>
          <b>{{ formatCurrency(totalAmount) }}</b>
        </div>

        <div class="form-field mt-3">
          <label class="field-label">С какого счёта отдали</label>
          <AccountSelect v-model="accountId" :items="accounts" placeholder="Подберём сами" empty-label="Подобрать автоматически" />
          <div class="pd-hint">Деньги уйдут из кассы и с этого счёта — долг уменьшится.</div>
        </div>

        <div class="form-field">
          <label class="field-label">Дата выплаты (необязательно)</label>
          <DateField v-model="date" plain />
        </div>

        <div class="form-field">
          <label class="field-label">Заметка</label>
          <textarea v-clear v-model="note" class="field-input field-textarea" rows="2" placeholder="Наличными / переводом…"></textarea>
        </div>

        <div v-if="error" class="text-error text-body-2">{{ error }}</div>

    <template #footer>
      <v-btn variant="text" @click="emit('update:modelValue', false)">Отмена</v-btn>
      <v-btn color="primary" variant="flat" rounded="lg" :loading="saving" :disabled="!totalAmount" @click="save">
        Выплатить {{ totalAmount ? formatCurrency(totalAmount) : '' }}
      </v-btn>
    </template>
  </FormModal>
</template>

<style scoped>
.pd-label { display: block; font-size: 12px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px; }
.pd-list { display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow-y: auto; }
.pd-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.1); }
.pd-item.on { border-color: rgba(4,120,87,0.3); background: rgba(4,120,87,0.05); }
.pd-check { border: none; background: none; cursor: pointer; padding: 0; }
.pd-info { flex: 1; min-width: 0; }
.pd-deal { font-size: 13.5px; font-weight: 600; }
.pd-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.pd-amt-input { width: 100px; height: 34px; padding: 0 8px; border-radius: 8px; border: 1px solid rgba(var(--v-theme-on-surface), 0.16); background: rgb(var(--v-theme-surface)); color: inherit; font-size: 13.5px; text-align: right; outline: none; }
.pd-amt-input:focus { border-color: #047857; }
.pd-total { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.04); font-size: 14px; }
.pd-total b { font-size: 16px; color: #047857; }
.pd-boxes { display: flex; flex-wrap: wrap; gap: 6px; }
.pd-box {
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 7px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgb(var(--v-theme-surface)); color: inherit; text-align: left;
}
.pd-box--on { border-color: #047857; background: rgba(4, 120, 87, 0.06); }
.pd-box-name { font-size: 13.5px; font-weight: 600; }
.pd-box-sum { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); }
.pd-hint { font-size: 12px; margin-top: 4px; color: rgba(var(--v-theme-on-surface), 0.5); }
</style>
