<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { api } from '@/api/client'
import { useSuppliersStore, type SupplierRow, type SupplierDebt } from '@/stores/suppliers'
import { useRouteSheetsStore, type RouteSheetInput } from '@/stores/routeSheets'
import { formatCurrency } from '@/utils/formatters'
import FormModal from '@/components/FormModal.vue'

const props = defineProps<{ modelValue: boolean; editId?: string | null }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'created', id: string): void
  (e: 'saved'): void
}>()

const isEdit = computed(() => !!props.editId)
const linesLocked = ref(false) // есть оплаченные строки — маршрут менять нельзя

const suppliersStore = useSuppliersStore()
const store = useRouteSheetsStore()

interface StaffOption { id: string; firstName: string; lastName: string; isActive: boolean }
interface LineDebt { debtId: string; dealNumber: number; productName: string; remaining: number; on: boolean; amount: number; locked: boolean; routeSheetNumber: number | null }
interface LineDraft { supplierId: string; supplierName: string; supplierCity: string | null; debts: LineDebt[]; comment: string; loading: boolean }

const saving = ref(false)
const error = ref('')
const date = ref('')
const note = ref('')
const assignedStaffId = ref<string | null>(null)
const staff = ref<StaffOption[]>([])
const suppliersWithDebt = ref<SupplierRow[]>([])
const lines = ref<LineDraft[]>([])
const addingSupplierId = ref<string | null>(null)

const staffItems = computed(() => [
  { title: 'Без ответственного', value: null as any },
  ...staff.value.map((s) => ({ title: `${s.lastName} ${s.firstName}`, value: s.id })),
])
const availableSuppliers = computed(() =>
  suppliersWithDebt.value.filter((s) => !lines.value.some((l) => l.supplierId === s.id)),
)
const supplierItems = computed(() =>
  availableSuppliers.value.map((s) => {
    const free = Math.max(0, s.openDebtsCount - s.plannedDebtsCount)
    const base = `${s.name}${s.city ? ' · ' + s.city : ''}`
    return {
      value: s.id,
      // Свободных долгов нет — все уже в путевых листах.
      title: free === 0 ? `${base} — уже в путевом листе` : `${base} — ${formatCurrency(s.debtTotal)}`,
      disabled: free === 0,
    }
  }),
)

const totalPlanned = computed(() =>
  lines.value.reduce((sum, l) => sum + l.debts.filter((d) => d.on).reduce((s, d) => s + (d.amount || 0), 0), 0),
)
// При редактировании с оплаченными строками правим только метаданные.
const canSave = computed(() => (isEdit.value && linesLocked.value) ? true : totalPlanned.value > 0)

function toDateInput(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
}

async function loadBase() {
  // Отказ по сотрудникам не должен мешать открыть диалог: без ответственного
  // путевой лист всё равно составляется.
  const [st] = await Promise.all([
    api.get<StaffOption[]>('/auth/investor/staff').catch(() => [] as StaffOption[]),
    suppliersStore.fetchList({ hasDebt: true, sort: 'name' }),
  ])
  staff.value = st.filter((s) => s.isActive)
  suppliersWithDebt.value = [...suppliersStore.rows]
}

function resetFields() {
  error.value = ''
  date.value = ''
  note.value = ''
  assignedStaffId.value = null
  lines.value = []
  addingSupplierId.value = null
  linesLocked.value = false
}

async function loadForEdit(editId: string) {
  const detail = await store.getOne(editId)
  date.value = toDateInput(detail.date)
  assignedStaffId.value = detail.assignedStaffId
  note.value = detail.note ?? ''
  linesLocked.value = detail.lines.some((l) => l.status === 'PAID')
  for (const dl of detail.lines) {
    lines.value.push({ supplierId: dl.supplierId, supplierName: dl.supplierName, supplierCity: dl.supplierCity, debts: [], comment: dl.comment ?? '', loading: true })
    const line = lines.value[lines.value.length - 1]
    try {
      const open: SupplierDebt[] = await suppliersStore.fetchDebts(dl.supplierId, 'OPEN', props.editId ?? undefined)
      const planned = new Map(dl.debts.map((d) => [d.debtId, d.amountPlanned]))
      line.debts = open.map((d) => ({
        debtId: d.id, dealNumber: d.dealNumber, productName: d.productName, remaining: d.remaining,
        on: planned.has(d.id), amount: planned.get(d.id) ?? d.remaining,
        locked: d.inRouteSheet, routeSheetNumber: d.routeSheetNumber,
      }))
    } finally {
      line.loading = false
    }
  }
}

watch(() => props.modelValue, async (open) => {
  if (open) {
    resetFields()
    await loadBase()
    if (props.editId) await loadForEdit(props.editId)
  }
})

async function addSupplier() {
  const id = addingSupplierId.value
  if (!id) return
  const sup = suppliersWithDebt.value.find((s) => s.id === id)
  if (!sup) return
  addingSupplierId.value = null
  lines.value.push({ supplierId: id, supplierName: sup.name, supplierCity: sup.city, debts: [], comment: '', loading: true })
  // Мутируем через реактивный элемент массива (не по сырой ссылке), иначе
  // totalPlanned/список долгов не обновятся и кнопка останется disabled.
  const line = lines.value[lines.value.length - 1]
  try {
    const debts: SupplierDebt[] = await suppliersStore.fetchDebts(id, 'OPEN', props.editId ?? undefined)
    line.debts = debts.map((d) => ({
      debtId: d.id, dealNumber: d.dealNumber, productName: d.productName, remaining: d.remaining,
      on: !d.inRouteSheet, amount: d.remaining, locked: d.inRouteSheet, routeSheetNumber: d.routeSheetNumber,
    }))
  } finally {
    line.loading = false
  }
}

function removeLine(idx: number) { lines.value.splice(idx, 1) }
function linePlanned(l: LineDraft) { return l.debts.filter((d) => d.on).reduce((s, d) => s + (d.amount || 0), 0) }

async function save() {
  const payloadLines = lines.value
    .map((l) => ({
      supplierId: l.supplierId,
      comment: l.comment.trim() || undefined,
      debts: l.debts.filter((d) => d.on && d.amount > 0).map((d) => ({ debtId: d.debtId, amount: Math.round(d.amount) })),
    }))
    .filter((l) => l.debts.length > 0)

  // При редактировании с оплаченными строками маршрут не трогаем (метаданные only).
  const editLinesLocked = isEdit.value && linesLocked.value
  if (!editLinesLocked && !payloadLines.length) {
    error.value = 'Добавьте хотя бы одного поставщика с выбранным долгом'
    return
  }

  saving.value = true
  error.value = ''
  try {
    if (props.editId) {
      await store.update(props.editId, {
        date: date.value || undefined,
        assignedStaffId: assignedStaffId.value,
        note: note.value.trim(),
        ...(editLinesLocked ? {} : { lines: payloadLines }),
      })
      emit('saved')
    } else {
      const payload: RouteSheetInput = {
        date: date.value || undefined,
        assignedStaffId: assignedStaffId.value || undefined,
        note: note.value.trim() || undefined,
        lines: payloadLines,
      }
      const created = await store.create(payload)
      emit('created', created.id)
    }
    emit('update:modelValue', false)
  } catch (e: any) {
    error.value = e?.message || 'Не удалось сохранить путевой лист'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <FormModal
    :model-value="modelValue"
    :title="isEdit ? 'Редактировать путевой лист' : 'Новый путевой лист'"
    subtitle="Маршрут сотрудника по погашению долгов поставщикам"
    icon="mdi-clipboard-list-outline"
    :max-width="640"
    @update:model-value="emit('update:modelValue', $event)"
  >
        <div class="form-row-2">
          <div class="form-field">
            <label class="field-label">Ответственный сотрудник</label>
            <select v-model="assignedStaffId" class="field-input field-select">
              <option v-for="it in staffItems" :key="String(it.value)" :value="it.value">{{ it.title }}</option>
            </select>
          </div>
          <div class="form-field">
            <label class="field-label">Дата</label>
            <input v-model="date" type="date" class="field-input" />
          </div>
        </div>

        <div v-if="linesLocked" class="rs-locked">
          <v-icon icon="mdi-lock-outline" size="16" /> В листе есть оплаченные строки — маршрут (поставщики и сделки) изменить нельзя. Доступны только дата, ответственный и описание.
        </div>

        <template v-else>
          <div class="form-field">
            <label class="field-label">Поставщики к объезду</label>
            <div class="d-flex ga-2">
              <select
                v-model="addingSupplierId"
                :disabled="!availableSuppliers.length"
                class="field-input field-select" style="flex: 1;"
              >
                <option :value="null" disabled>{{ availableSuppliers.length ? 'Выберите поставщика с долгом' : 'Больше нет поставщиков с долгом' }}</option>
                <option v-for="it in supplierItems" :key="it.value" :value="it.value" :disabled="it.disabled">{{ it.title }}</option>
              </select>
              <v-btn color="primary" variant="tonal" rounded="lg" :disabled="!addingSupplierId" @click="addSupplier">Добавить</v-btn>
            </div>
          </div>

          <div v-if="!lines.length" class="rs-empty">Добавьте поставщиков, к которым нужно заехать и погасить долги</div>

          <div v-for="(l, idx) in lines" :key="l.supplierId" class="rs-line">
            <div class="rs-line-head">
              <div>
                <div class="rs-line-name">{{ l.supplierName }}<span v-if="l.supplierCity" class="rs-line-city"> · {{ l.supplierCity }}</span></div>
                <div class="rs-line-sum">План: {{ formatCurrency(linePlanned(l)) }}</div>
              </div>
              <button class="rs-line-del" @click="removeLine(idx)"><v-icon icon="mdi-close" size="18" /></button>
            </div>
            <div v-if="l.loading" class="py-2"><v-progress-circular indeterminate size="20" color="primary" /></div>
            <div v-else-if="l.debts.length" class="rs-debts">
              <label v-for="d in l.debts" :key="d.debtId" class="rs-debt" :class="{ on: d.on && !d.locked, locked: d.locked }">
                <input type="checkbox" v-model="d.on" :disabled="d.locked" />
                <span class="rs-debt-info">
                  #{{ d.dealNumber }} · {{ d.productName }}<span class="rs-debt-rem"> (остаток {{ formatCurrency(d.remaining) }})</span>
                  <span v-if="d.locked" class="rs-debt-lock">уже в листе №{{ d.routeSheetNumber }}</span>
                </span>
                <input v-if="d.on && !d.locked" type="number" min="0" :max="d.remaining" v-model.number="d.amount" class="rs-debt-amt" @click.prevent.stop />
              </label>
            </div>
            <div v-else class="rs-debt-empty">У поставщика нет открытых долгов</div>
            <input v-model="l.comment" type="text" placeholder="Комментарий для сотрудника…" class="rs-line-comment" />
          </div>
        </template>

        <div class="form-field mt-3">
          <label class="field-label">Общая заметка</label>
          <textarea v-model="note" class="field-input field-textarea" rows="2" placeholder="Куда ехать, что уточнить…"></textarea>
        </div>

        <div v-if="error" class="text-error text-body-2">{{ error }}</div>

    <template #footer>
      <div class="rs-total" style="margin-right: auto;">Итого план: <b>{{ formatCurrency(totalPlanned) }}</b></div>
      <v-btn variant="text" @click="emit('update:modelValue', false)">Отмена</v-btn>
      <v-btn color="primary" variant="flat" rounded="lg" :loading="saving" :disabled="!canSave" @click="save">{{ isEdit ? 'Сохранить' : 'Создать' }}</v-btn>
    </template>
  </FormModal>
</template>

<style scoped>
.rs-label { display: block; font-size: 12px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px; }
.flex-1 { flex: 1; min-width: 0; }
.rs-empty { text-align: center; padding: 20px; border: 1px dashed rgba(var(--v-theme-on-surface), 0.15); border-radius: 12px; color: rgba(var(--v-theme-on-surface), 0.5); font-size: 13px; }
.rs-locked { display: flex; align-items: flex-start; gap: 8px; padding: 12px 14px; border-radius: 10px; background: rgba(245,158,11,0.1); color: #b45309; font-size: 12.5px; line-height: 1.45; margin-bottom: 4px; }
.rs-debt-empty { padding: 6px 8px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.45); }
.rs-line { border: 1px solid rgba(var(--v-theme-on-surface), 0.1); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
.rs-line-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.rs-line-name { font-size: 14px; font-weight: 700; }
.rs-line-city { color: rgba(var(--v-theme-on-surface), 0.5); font-weight: 400; }
.rs-line-sum { font-size: 12.5px; color: #047857; font-weight: 600; }
.rs-line-del { border: none; background: none; cursor: pointer; color: rgba(var(--v-theme-on-surface), 0.5); padding: 4px; border-radius: 6px; }
.rs-line-del:hover { background: rgba(239,68,68,0.1); color: #ef4444; }
.rs-debts { display: flex; flex-direction: column; gap: 4px; }
.rs-debt { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; }
.rs-debt.on { background: rgba(4,120,87,0.05); }
.rs-debt.locked { opacity: 0.7; cursor: not-allowed; }
.rs-debt.locked input[type="checkbox"] { cursor: not-allowed; }
.rs-debt-info { flex: 1; min-width: 0; font-size: 13px; }
.rs-debt-rem { color: rgba(var(--v-theme-on-surface), 0.5); }
.rs-debt-lock { display: inline-block; margin-left: 6px; font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: rgba(245,158,11,0.15); color: #b45309; }
.rs-debt-amt { width: 96px; height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid rgba(var(--v-theme-on-surface), 0.16); background: rgb(var(--v-theme-surface)); color: inherit; font-size: 13px; text-align: right; outline: none; }
.rs-line-comment { width: 100%; margin-top: 8px; height: 34px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: transparent; color: inherit; font-size: 13px; outline: none; }
.rs-total { font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.7); }
.rs-total b { color: #047857; font-size: 15px; }
</style>
