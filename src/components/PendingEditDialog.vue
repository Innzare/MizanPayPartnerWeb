<script setup lang="ts">
/**
 * Исправить деньги без назначения (неизвестный приход, выдачу под отчёт),
 * пока их не разобрали. Удаление — отдельной кнопкой в строке таблицы. Прежнее движение по счёту гасится
 * встречной записью и пишется новое — история счёта сохраняется.
 *
 * Разобранную не правят: её деньги уже стали расходом, доходом или вернулись —
 * правится та операция.
 */
import { computed, ref, watch } from 'vue'
import AccountSelect from '@/components/AccountSelect.vue'
import DateField from '@/components/DateField.vue'
import { useAccountingStore, type PendingOpView } from '@/stores/accounting'
import { useOperationDate } from '@/composables/useOperationDate'
import { useToast } from '@/composables/useToast'
import { dateToIso, todayIso } from '@/utils/dateInput'
import { CURRENCY_MASK, parseMasked, maskedMoney } from '@/utils/formatters'

const props = defineProps<{ op: PendingOpView | null }>()
const emit = defineEmits<{ (e: 'update:op', v: PendingOpView | null): void; (e: 'changed'): void }>()

const store = useAccountingStore()
const toast = useToast()
const opDate = useOperationDate()

const amount = ref<number | null>(null)
const accountId = ref<string | null>(null)
const date = ref('')
const initialDate = ref('')
const personName = ref('')
const opTitle = ref('')
const note = ref('')
const saving = ref(false)

watch(
  () => props.op,
  async (op) => {
    if (!op) return
    if (!store.accounts.length) await store.fetchAccounts().catch(() => {})
    amount.value = op.amount
    accountId.value = op.account.id
    date.value = dateToIso(new Date(op.date))
    initialDate.value = date.value
    personName.value = op.personName ?? ''
    opTitle.value = op.title ?? ''
    note.value = op.note ?? ''
  },
)

/** Счёт меняется только внутри кассы операции: перенос в другую кассу — это перевод. */
const accounts = computed(() => {
  const box = store.accounts.find((a) => a.id === props.op?.account.id)?.cashBoxId ?? null
  return store.accounts.filter((a) => (!a.disabledAt || a.id === props.op?.account.id) && (!box || a.cashBoxId === box))
})
const canSave = computed(() => !!props.op && (amount.value ?? 0) > 0 && !!accountId.value && !saving.value)

function close() {
  emit('update:op', null)
}

async function save() {
  const op = props.op
  if (!op || !canSave.value) return
  const dateChanged = !!date.value && date.value !== initialDate.value
  const ask = dateChanged ? opDate.confirmMessage(date.value) : null
  if (ask && !window.confirm(ask)) return
  saving.value = true
  try {
    await store.updatePending(op.id, {
      amount: amount.value!,
      accountId: accountId.value!,
      ...(dateChanged ? { date: date.value } : {}),
      personName: personName.value.trim() || null,
      title: opTitle.value.trim() || null,
      note: note.value.trim() || null,
    })
    toast.success('Изменения сохранены')
    close()
    emit('changed')
  } catch (e: any) {
    toast.error(e, 'Не удалось сохранить')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog :model-value="!!op" max-width="440" @update:model-value="close">
    <v-card v-if="op" rounded="lg" class="pe-dialog">
      <div class="pe-title">{{ op.direction === 'IN' ? 'Поступление без назначения' : 'Выдача без назначения' }}</div>
      <div class="pe-sub">Пока операция не разобрана, её можно исправить.</div>

      <div class="pe-field">
        <label class="pe-label">Название</label>
        <input v-clear v-model="opTitle" class="pe-input" maxlength="120" placeholder="Например: аванс мастеру" />
      </div>

      <div class="pe-field">
        <label class="pe-label">Сумма</label>
        <div class="pe-suffix-wrap">
          <input v-clear
            :value="maskedMoney(amount)"
            v-maska="CURRENCY_MASK"
            type="text"
            inputmode="numeric"
            class="pe-input pe-input--num"
            @maska="(e: any) => amount = parseMasked(e)"
          />
          <span class="pe-suffix">₽</span>
        </div>
      </div>

      <div class="pe-field">
        <label class="pe-label">{{ op.direction === 'IN' ? 'На какой счёт' : 'С какого счёта' }}</label>
        <AccountSelect v-model="accountId" :items="accounts" />
      </div>

      <div class="pe-field">
        <label class="pe-label">Дата</label>
        <DateField v-model="date" :min="opDate.minDate.value" :max="opDate.maxDate.value || todayIso()" plain />
      </div>

      <div class="pe-field">
        <label class="pe-label">{{ op.direction === 'IN' ? 'От кого' : 'За кем числятся деньги' }}</label>
        <input v-clear v-model="personName" class="pe-input" />
      </div>

      <div class="pe-field">
        <label class="pe-label">Комментарий</label>
        <textarea v-clear v-model="note" class="pe-input pe-textarea" rows="2" />
      </div>

      <div class="pe-actions">
        <button class="pe-cancel" @click="close">Отмена</button>
        <button class="pe-confirm" :disabled="!canSave" @click="save">{{ saving ? 'Сохраняю…' : 'Сохранить' }}</button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.pe-dialog { padding: 22px 24px 18px; }
.pe-title { font-size: 17px; font-weight: 700; }
.pe-sub { font-size: 12.5px; line-height: 1.5; margin-top: 5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.pe-field { margin-top: 14px; }
.pe-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: rgba(var(--v-theme-on-surface), 0.6); }
.pe-suffix-wrap { position: relative; }
.pe-input {
  width: 100%; height: 42px; padding: 0 14px; border-radius: 10px; outline: none;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9);
}
/* Комментарий — многострочный, как везде в кабинете. */
.pe-textarea { display: block; height: auto; min-height: 64px; padding: 10px 14px; line-height: 1.45; resize: vertical; font-family: inherit; }
.pe-input--num { padding-right: 34px; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.pe-input:focus { border-color: #4f46e5; }
.pe-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%); pointer-events: none;
  font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.35);
}
.pe-actions { display: flex; gap: 10px; margin-top: 18px; }
.pe-cancel, .pe-confirm { flex: 1; padding: 11px 16px; border-radius: 10px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; }
.pe-cancel { background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500; }
.pe-confirm { background: #4f46e5; color: #fff; }
.pe-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
