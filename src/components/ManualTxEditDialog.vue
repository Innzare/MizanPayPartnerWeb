<script setup lang="ts">
/**
 * Правка и удаление дохода или расхода по бизнесу.
 *
 * Раньше это делалось только в карточке кассы. Ручные операции теперь живут в
 * «Бухгалтерии → Пополнения и расходы», и править их нужно там же, где их видно.
 * Запись та же самая (`/finance/transactions`) — касса и раздел показывают
 * одну операцию, а не копии.
 */
import { computed, ref, watch } from 'vue'
import SelectField from '@/components/SelectField.vue'
import DateField from '@/components/DateField.vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useOperationDate } from '@/composables/useOperationDate'
import { CURRENCY_MASK, parseMasked, formatCurrency } from '@/utils/formatters'

export interface ManualTx {
  id: string
  type: 'INCOME' | 'EXPENSE'
  amount: number
  description: string | null
  categoryId: string | null
  cashBoxId: string | null
  date: string
  /** Расход уменьшает прибыль месяца, которую делят с инвесторами (схема v2). */
  affectsInvestors?: boolean
  /** Расход «из капитала» / доход «в капитал» — меняет капитал партнёра в делении. */
  fromCapital?: boolean
}

const props = defineProps<{
  modelValue: boolean
  tx: ManualTx | null
  /** Можно ли удалить: право «Добавлять / удалять доходы и расходы». */
  canDelete?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'done'): void
}>()

const toast = useToast()
const opDate = useOperationDate()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

interface Category { id: string; name: string; type: 'INCOME' | 'EXPENSE'; color?: string | null }
const categories = ref<Category[]>([])
const amount = ref<number | null>(null)
const description = ref('')
const affectsInvestors = ref(false)
const fromCapital = ref(false)
const categoryId = ref<string | null>(null)
const date = ref('')
const saving = ref(false)
const confirmDelete = ref(false)

const isIncome = computed(() => props.tx?.type === 'INCOME')
const categoryOptions = computed(() =>
  categories.value
    .filter((c) => c.type === props.tx?.type)
    .map((c) => ({ value: c.id, label: c.name, color: c.color ?? undefined })),
)

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (!isOpen || !props.tx) return
    amount.value = props.tx.amount
    description.value = props.tx.description ?? ''
    affectsInvestors.value = !!props.tx.affectsInvestors
    fromCapital.value = !!props.tx.fromCapital
    categoryId.value = props.tx.categoryId
    date.value = props.tx.date ? props.tx.date.slice(0, 10) : ''
    confirmDelete.value = false
    try {
      categories.value = await api.get<Category[]>('/finance/categories')
    } catch {
      categories.value = []
    }
  },
)

async function save() {
  if (!props.tx || !amount.value || amount.value <= 0) return
  saving.value = true
  try {
    await api.patch(`/finance/transactions/${props.tx.id}`, {
      type: props.tx.type,
      amount: amount.value,
      description: description.value.trim() || undefined,
      categoryId: categoryId.value || undefined,
      date: date.value || undefined,
      ...(props.tx.cashBoxId ? { cashBoxId: props.tx.cashBoxId } : {}),
      // Флаги шлём, только если окно их знает: иначе правка суммы сбросила бы их.
      ...(!isIncome.value && props.tx.affectsInvestors !== undefined ? { affectsInvestors: affectsInvestors.value } : {}),
      ...(props.tx.fromCapital !== undefined ? { fromCapital: fromCapital.value } : {}),
    })
    toast.success('Операция обновлена')
    open.value = false
    emit('done')
  } catch (e: any) {
    toast.error(e, 'Не удалось сохранить')
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!props.tx) return
  saving.value = true
  try {
    await api.delete(`/finance/transactions/${props.tx.id}`)
    toast.success('Операция удалена')
    open.value = false
    emit('done')
  } catch (e: any) {
    toast.error(e, 'Не удалось удалить')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="460" scrollable>
    <v-card rounded="lg" class="mt-card">
      <div class="mt-head">
        <div class="mt-title">{{ isIncome ? 'Прочий доход' : 'Расход по бизнесу' }}</div>
        <div class="mt-sub">Изменения сразу отразятся в деньгах кассы</div>
      </div>

      <div class="mt-body">
        <template v-if="!confirmDelete">
          <div class="mt-field">
            <label class="mt-label">Сумма</label>
            <div class="mt-suffix-wrap">
              <input
                :value="amount || ''"
                v-maska="CURRENCY_MASK"
                type="text"
                inputmode="numeric"
                class="mt-input"
                @maska="(e: any) => amount = parseMasked(e)"
              />
              <span class="mt-suffix">₽</span>
            </div>
          </div>
          <div class="mt-field">
            <label class="mt-label">Статья</label>
            <SelectField v-model="categoryId" :options="categoryOptions" empty-label="Без статьи" placeholder="Без статьи" />
          </div>
          <div class="mt-field">
            <label class="mt-label">Дата</label>
            <DateField v-model="date" :min="opDate.minDate.value" :max="opDate.maxDate.value" plain />
          </div>
          <div class="mt-field">
            <label class="mt-label">Комментарий</label>
            <input v-model="description" class="mt-input" placeholder="Например: аренда за август" />
          </div>
          <div v-if="tx?.fromCapital !== undefined" class="mt-field">
            <label class="mt-label">{{ isIncome ? 'Куда идёт доход' : 'Откуда расход' }}</label>
            <div class="mt-seg">
              <button type="button" class="mt-seg-btn" :class="{ 'mt-seg-btn--on': !fromCapital }" @click="fromCapital = false">
                {{ isIncome ? 'В прибыль' : 'Из прибыли' }}
              </button>
              <button type="button" class="mt-seg-btn" :class="{ 'mt-seg-btn--on': fromCapital }" @click="fromCapital = true">
                {{ isIncome ? 'В капитал' : 'Из капитала' }}
              </button>
            </div>
            <div class="mt-hint">
              {{ fromCapital ? 'Меняет ваш капитал в делении прибыли с инвесторами с даты операции.' : 'Ваш капитал в делении с инвесторами не меняется.' }}
            </div>
          </div>
          <label v-if="!isIncome && tx?.affectsInvestors !== undefined" class="mt-check">
            <input v-model="affectsInvestors" type="checkbox" />
            <span>
              <b>Затрагивает инвесторов</b> — уменьшает прибыль месяца до деления с инвесторами.
              Месяц пересчитается.
            </span>
          </label>
        </template>
        <div v-else class="mt-confirm">
          Удалить {{ isIncome ? 'доход' : 'расход' }} на {{ formatCurrency(tx?.amount ?? 0) }}?
          Деньги кассы пересчитаются, вернуть операцию будет нельзя.
        </div>
      </div>

      <div class="mt-actions">
        <template v-if="!confirmDelete">
          <button v-if="canDelete" class="mt-del" :disabled="saving" @click="confirmDelete = true">Удалить</button>
          <button class="mt-cancel" @click="open = false">Отмена</button>
          <button class="mt-confirm-btn" :disabled="saving || !amount" @click="save">Сохранить</button>
        </template>
        <template v-else>
          <button class="mt-cancel" @click="confirmDelete = false">Назад</button>
          <button class="mt-danger" :disabled="saving" @click="remove">Удалить</button>
        </template>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.mt-card { display: flex; flex-direction: column; max-height: 88vh; }
.mt-head { padding: 20px 24px 14px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
.mt-title { font-size: 17px; font-weight: 700; }
.mt-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 3px; }
.mt-body { padding: 4px 24px 12px; overflow-y: auto; flex: 1; }
.mt-field { margin-top: 14px; }
.mt-check {
  display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; cursor: pointer;
  font-size: 13px; line-height: 1.45; color: rgba(var(--v-theme-on-surface), 0.75);
}
.mt-check input { margin-top: 3px; }
.mt-seg { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.05); }
.mt-seg-btn {
  flex: 1; padding: 8px 10px; border-radius: 8px; border: none; cursor: pointer;
  font-size: 13.5px; font-weight: 500; background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6); transition: background 0.15s, color 0.15s;
}
.mt-seg-btn--on { background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.92); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
.mt-hint { font-size: 12px; line-height: 1.4; margin-top: 4px; color: rgba(var(--v-theme-on-surface), 0.55); }
.mt-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: rgba(var(--v-theme-on-surface), 0.6); }
.mt-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none; color: rgba(var(--v-theme-on-surface), 0.85);
}
.mt-input:focus { border-color: #047857; }
.mt-suffix-wrap { position: relative; }
.mt-suffix-wrap .mt-input { padding-right: 34px; }
.mt-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600; pointer-events: none; color: rgba(var(--v-theme-on-surface), 0.35);
}
.mt-confirm { margin-top: 16px; font-size: 14px; line-height: 1.5; }
.mt-actions {
  display: flex; gap: 10px; padding: 14px 24px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.mt-cancel, .mt-confirm-btn, .mt-danger, .mt-del {
  padding: 11px 16px; border-radius: 10px; border: none; font-size: 14px; font-weight: 600; cursor: pointer;
}
.mt-cancel { flex: 1; background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500; }
.mt-confirm-btn { flex: 1; background: #047857; color: #fff; }
.mt-danger { flex: 1; background: #dc2626; color: #fff; }
.mt-del { background: none; color: #dc2626; padding-left: 4px; padding-right: 4px; }
.mt-confirm-btn:disabled, .mt-danger:disabled, .mt-del:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
