<script setup lang="ts">
/**
 * Движение по долгу: возврат («Вернуть» / «Принять возврат»), ещё выдача
 * («Взять ещё» / «Дать ещё») или правка уже записанного.
 *
 * Счёт — только из кассы долга: деньги долга живут в одной кассе, и возврат
 * с чужого счёта развёл бы кассу и её счета (сервер такое отклоняет).
 * Вернуть больше остатка нельзя, а выдачу нельзя уменьшить ниже уже
 * возвращённого — те же правила проверяет сервер.
 */
import { computed, ref, watch } from 'vue'
import AccountSelect from '@/components/AccountSelect.vue'
import DateField from '@/components/DateField.vue'
import { useAccountingStore, type LiabilityCard, type LiabilityMovementView } from '@/stores/accounting'
import { useOperationDate } from '@/composables/useOperationDate'
import { useToast } from '@/composables/useToast'
import { dateToIso, todayIso } from '@/utils/dateInput'
import { CURRENCY_MASK, parseMasked, maskedMoney, formatCurrency } from '@/utils/formatters'

export type LiabilityMovementMode = 'repay' | 'issue' | 'edit'

const props = defineProps<{
  modelValue: boolean
  card: LiabilityCard | null
  mode: LiabilityMovementMode
  /** Правка: какое движение. */
  movement?: LiabilityMovementView | null
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'done'): void }>()

const store = useAccountingStore()
const toast = useToast()
const opDate = useOperationDate()

const amount = ref<number | null>(null)
const accountId = ref<string | null>(null)
const date = ref('')
/** Дата записи при открытии: неизменённую не шлём — окно дат сотрудника её не касается. */
const initialDate = ref('')
const note = ref('')
const saving = ref(false)

const borrowed = computed(() => props.card?.direction === 'BORROWED')
/** Что записываем: выдачу или возврат. */
const kind = computed<'ISSUE' | 'REPAY'>(() =>
  // Перенос в основные (CONVERT) этим окном не правится — сюда не попадает.
  props.mode === 'edit' ? (props.movement?.kind === 'ISSUE' ? 'ISSUE' : 'REPAY') : props.mode === 'issue' ? 'ISSUE' : 'REPAY',
)

const title = computed(() => {
  if (props.mode === 'edit') return kind.value === 'ISSUE' ? 'Изменить выдачу' : 'Изменить возврат'
  if (props.mode === 'issue') return borrowed.value ? 'Взять ещё' : 'Дать ещё'
  return borrowed.value ? 'Вернуть деньги' : 'Принять возврат'
})

watch(
  () => props.modelValue,
  async (open) => {
    if (!open || !props.card) return
    if (!store.accounts.length) await store.fetchAccounts().catch(() => {})
    const m = props.mode === 'edit' ? props.movement : null
    amount.value = m ? m.amount : props.mode === 'repay' ? props.card.left : null
    accountId.value = m ? m.account?.id ?? null : lastAccount()
    date.value = m ? dateToIso(new Date(m.date)) : ''
    initialDate.value = date.value
    note.value = m?.note ?? ''
  },
)

/**
 * Счёт по умолчанию — тот, с которым работали по этому долгу последним, иначе
 * первый счёт кассы долга: «определить автоматически» ищет только банковский
 * счёт и у кассы с одной наличной может оставить деньги «не разнесёнными».
 */
function lastAccount(): string | null {
  const ms = props.card?.movements ?? []
  for (let i = ms.length - 1; i >= 0; i--) {
    const id = ms[i]!.account?.id
    if (id && accounts.value.some((a) => a.id === id && !a.disabledAt)) return id
  }
  return accounts.value.find((a) => !a.disabledAt)?.id ?? null
}

/**
 * Счета кассы долга. У давних долгов касса не записана — тогда все. Текущий
 * счёт правимой строки виден всегда, даже из другой кассы: давние возвраты
 * писались в основную кассу, и пустой выбор только запутал бы.
 */
const accounts = computed(() => {
  const box = props.card?.cashBox?.id
  const current = props.movement?.account?.id
  return store.accounts.filter(
    (a) => a.id === current || (!a.disabledAt && (!box || a.cashBoxId === box)),
  )
})
/** Выбранный счёт — из другой кассы (давняя запись). Сохранить можно, только сменив его. */
const foreignAccount = computed(() => {
  const box = props.card?.cashBox?.id
  const acc = store.accounts.find((a) => a.id === accountId.value)
  return !!box && !!acc && acc.cashBoxId !== box
})

/** Границы суммы — как на сервере. */
const limit = computed<{ max: number | null; min: number }>(() => {
  const c = props.card
  if (!c) return { max: null, min: 0 }
  const old = props.mode === 'edit' ? props.movement?.amount ?? 0 : 0
  if (kind.value === 'REPAY') return { max: c.left + old, min: 0 }
  // Выдача: «выдано» не может стать меньше уже возвращённого.
  return { max: null, min: Math.max(0, c.repaid - (c.principal - old)) }
})
const amountError = computed(() => {
  const v = amount.value ?? 0
  if (limit.value.max !== null && v > limit.value.max) {
    return `Больше остатка (${formatCurrency(limit.value.max)}) вернуть нельзя`
  }
  if (v > 0 && v < limit.value.min) {
    return `Уже вернули ${formatCurrency(props.card!.repaid)} — выдача не может быть меньше ${formatCurrency(limit.value.min)}`
  }
  return ''
})
const canSave = computed(
  () => !!props.card && (amount.value ?? 0) > 0 && !amountError.value && !foreignAccount.value && !saving.value,
)

function close() {
  emit('update:modelValue', false)
}

async function save() {
  const c = props.card
  if (!c || !canSave.value) return
  const dateChanged = !!date.value && date.value !== initialDate.value
  const ask = dateChanged ? opDate.confirmMessage(date.value) : null
  if (ask && !window.confirm(ask)) return
  saving.value = true
  try {
    const payload = {
      amount: amount.value!,
      accountId: accountId.value,
      ...(dateChanged ? { date: date.value } : {}),
      note: note.value.trim() || undefined,
    }
    if (props.mode === 'edit' && props.movement) {
      await store.updateLiabilityMovement(c.id, props.movement.id, { ...payload, note: note.value.trim() || null })
      toast.success('Изменения сохранены')
    } else if (props.mode === 'issue') {
      await store.issueMoreLiability(c.id, payload)
      toast.success(borrowed.value ? 'Записано: взяли ещё' : 'Записано: дали ещё')
    } else {
      await store.repayLiability(c.id, payload)
      toast.success('Возврат записан')
    }
    close()
    emit('done')
  } catch (e: any) {
    toast.error(e, 'Не удалось сохранить')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="440" @update:model-value="close">
    <v-card v-if="card" rounded="lg" class="lm-dialog">
      <div class="lm-title">{{ title }}</div>
      <div class="lm-sub">
        {{ card.personName }}
        <template v-if="card.cashBox"> · {{ card.cashBox.name }}</template>
        · осталось {{ formatCurrency(card.left) }}
      </div>

      <div class="lm-field">
        <label class="lm-label">Сумма</label>
        <div class="lm-suffix-wrap">
          <input v-clear
            :value="maskedMoney(amount)"
            v-maska="CURRENCY_MASK"
            type="text"
            inputmode="numeric"
            class="lm-input"
            :class="{ 'lm-input--bad': !!amountError }"
            @maska="(e: any) => amount = parseMasked(e)"
          />
          <span class="lm-suffix">₽</span>
        </div>
        <div v-if="amountError" class="lm-error">{{ amountError }}</div>
        <button
          v-else-if="mode === 'repay' && card.left > 0 && amount !== card.left"
          type="button"
          class="lm-link"
          @click="amount = card.left"
        >
          Весь остаток — {{ formatCurrency(card.left) }}
        </button>
      </div>

      <div class="lm-field">
        <label class="lm-label">
          {{ (kind === 'REPAY') === borrowed ? 'С какого счёта' : 'На какой счёт' }}
        </label>
        <AccountSelect
          v-model="accountId"
          :items="accounts"
          :empty-label="mode === 'edit' && movement?.account ? null : 'Определить автоматически'"
        />
        <div v-if="foreignAccount && card.cashBox" class="lm-error">
          Этот счёт из другой кассы — так записывали раньше. Выберите счёт кассы «{{ card.cashBox.name }}», чтобы сохранить.
        </div>
        <div v-else-if="card.cashBox" class="lm-hint">Только счета кассы «{{ card.cashBox.name }}» — в ней записан долг.</div>
      </div>

      <div class="lm-field">
        <label class="lm-label">Дата</label>
        <DateField v-model="date" :min="opDate.minDate.value" :max="opDate.maxDate.value || todayIso()" plain />
        <div v-if="!date" class="lm-hint">Пусто — сегодня.</div>
      </div>

      <div class="lm-field">
        <label class="lm-label">Комментарий</label>
        <textarea v-clear v-model="note" class="lm-input lm-input--text lm-textarea" rows="2" placeholder="Например: наличными при встрече" />
      </div>

      <div class="lm-actions">
        <button class="lm-cancel" @click="close">Отмена</button>
        <button class="lm-confirm" :disabled="!canSave" @click="save">
          {{ saving ? 'Записываю…' : mode === 'edit' ? 'Сохранить' : 'Записать' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.lm-dialog { padding: 22px 24px 18px; }
.lm-title { font-size: 17px; font-weight: 700; }
.lm-sub { font-size: 12.5px; line-height: 1.5; margin-top: 5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.lm-field { margin-top: 14px; }
.lm-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: rgba(var(--v-theme-on-surface), 0.6); }
.lm-suffix-wrap { position: relative; }
.lm-input {
  width: 100%; padding: 10px 34px 10px 14px; border-radius: 10px; outline: none;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; color: rgba(var(--v-theme-on-surface), 0.9);
}
.lm-input--text { padding-right: 14px; font-size: 14px; font-weight: 400; }
/* Комментарий — многострочный, как везде в кабинете. */
.lm-textarea { display: block; height: auto; min-height: 64px; padding: 10px 14px; line-height: 1.45; resize: vertical; font-family: inherit; }
.lm-input:focus { border-color: #047857; }
.lm-input--bad, .lm-input--bad:focus { border-color: #dc2626; }
.lm-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%); pointer-events: none;
  font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.35);
}
.lm-error { font-size: 12px; color: #dc2626; margin-top: 5px; }
.lm-hint { font-size: 12px; line-height: 1.4; margin-top: 4px; color: rgba(var(--v-theme-on-surface), 0.5); }
.lm-link {
  margin-top: 5px; padding: 0; border: none; background: none; cursor: pointer;
  font-size: 12.5px; font-weight: 600; color: #047857;
}
.lm-actions { display: flex; gap: 10px; margin-top: 18px; }
.lm-cancel, .lm-confirm { flex: 1; padding: 11px 16px; border-radius: 10px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; }
.lm-cancel { background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500; }
.lm-confirm { background: #047857; color: #fff; }
.lm-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
