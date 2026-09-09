<script setup lang="ts">
/**
 * Форма одной денежной операции. Вид приходит из меню, поэтому окно сразу
 * показывает нужные поля: у внесения и у займа они разные.
 *
 * Записи по-прежнему делают те же сервисы, что работали на прежних экранах, —
 * цифры считаются тем же кодом.
 *
 * Назначение операции выбирается до окна, и это принципиально: «снял и
 * положил в сейф» и «снял и потратил на себя» выглядят одинаково, но первое
 * капитал не меняет, а второе уменьшает.
 */
import { computed, ref, watch } from 'vue'
import AccountSelect from '@/components/AccountSelect.vue'
import SelectField from '@/components/SelectField.vue'
import { useAccountingStore, type AccountView } from '@/stores/accounting'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { CURRENCY_MASK, parseMasked, formatCurrency } from '@/utils/formatters'
import { OPERATION_KINDS, type OperationKind } from '@/constants/operationKinds'

const props = defineProps<{
  modelValue: boolean
  /**
   * Какая операция. Приходит из меню — форма сразу открывается нужной, без
   * промежуточного шага «выберите вид»: человек уже выбрал его в меню.
   */
  kind: OperationKind
  /** Счёт, с которого открыли форму. */
  accountId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'done'): void
}>()

const store = useAccountingStore()
const cashboxes = useCashBoxesStore()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const kind = computed(() => props.kind)
const amount = ref<number | null>(null)
const accountId = ref<string | null>(null)
const toAccountId = ref<string | null>(null)
const cashBoxId = ref<string | null>(null)
const categoryId = ref<string | null>(null)
const note = ref('')
const personName = ref('')
const saving = ref(false)

const current = computed(() => OPERATION_KINDS.find((k) => k.kind === kind.value) ?? null)
/** Перевод — единственный вид с двумя счетами. */
const needsTarget = computed(() => kind.value === 'TRANSFER')

const usable = computed(() => store.accounts.filter((a) => !a.disabledAt))

/**
 * Счета выбранной кассы: деньги кассы лежат на её счетах, и предлагать чужие
 * нельзя — иначе сумма кассы разойдётся с суммой её счетов.
 *
 * У перевода касса не спрашивается: там как раз перекладывают деньги между
 * сейфами, и оба конца могут принадлежать разным кассам.
 */
const cashBoxOptions = computed(() =>
  cashboxes.items
    .filter((b) => !b.archivedAt)
    .map((b) => ({ value: b.id, label: b.name, hint: b.isDefault ? 'основная' : undefined, color: b.color })),
)

const forCashBox = computed(() =>
  needsTarget.value || !cashBoxId.value
    ? usable.value
    : usable.value.filter((a) => a.cashBoxId === cashBoxId.value),
)
const from = computed<AccountView | null>(() => usable.value.find((a) => a.id === accountId.value) ?? null)

/** Уводить счёт в минус нельзя: на практике это опечатка в сумме. */
const notEnough = computed(
  () =>
    current.value?.direction !== 'in' &&
    from.value?.balance != null &&
    (amount.value ?? 0) > from.value.balance,
)

const needsCategory = computed(() => kind.value === 'EXPENSE' || kind.value === 'INCOME')
const isPending = computed(() => kind.value === 'PENDING_IN' || kind.value === 'PENDING_OUT')
const isLoan = computed(() => kind.value === 'BORROW' || kind.value === 'LEND')

const canSave = computed(() => {
  if (!kind.value || (amount.value ?? 0) <= 0 || notEnough.value) return false
  // Без имени второй стороны долг через месяц не восстановить по памяти.
  if (isLoan.value && !personName.value.trim()) return false
  if (needsTarget.value) return !!accountId.value && !!toAccountId.value && accountId.value !== toAccountId.value
  return true
})

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (!isOpen) return
    amount.value = null
    accountId.value = props.accountId ?? null
    toAccountId.value = null
    categoryId.value = null
    note.value = ''
    personName.value = ''
    if (!store.accounts.length) await store.fetchAccounts().catch(() => {})
    if (!cashboxes.items.length) await cashboxes.fetchAll().catch(() => {})
    cashBoxId.value = cashboxes.items.find((b) => b.isDefault)?.id ?? cashboxes.items[0]?.id ?? null
  },
)

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    // Деньги без назначения идут в буфер: движение по счёту создаётся сразу,
    // а классификация появится при разборе.
    if (isPending.value) {
      if (!accountId.value) {
        toast.error('Выберите счёт: деньги двигались с конкретного места')
        saving.value = false
        return
      }
      await store.createPending({
        direction: kind.value === 'PENDING_IN' ? 'IN' : 'OUT',
        amount: amount.value!,
        accountId: accountId.value,
        note: note.value.trim() || undefined,
        personName: personName.value.trim() || undefined,
      })
      toast.success('Записано — разберёте позже')
      open.value = false
      emit('done')
      return
    }

    // Долги: деньги двигаются, но собственный капитал не растёт.
    if (isLoan.value) {
      await store.createLiability({
        direction: kind.value === 'BORROW' ? 'BORROWED' : 'LENT',
        personName: personName.value.trim(),
        amount: amount.value!,
        accountId: accountId.value,
        note: note.value.trim() || undefined,
      })
      toast.success(kind.value === 'BORROW' ? 'Долг записан' : 'Записано: дали в долг')
      open.value = false
      emit('done')
      return
    }

    await store.createOperation({
      kind: kind.value as 'DEPOSIT' | 'WITHDRAW_OWNER' | 'EXPENSE' | 'INCOME' | 'TRANSFER',
      amount: amount.value!,
      accountId: accountId.value,
      toAccountId: needsTarget.value ? toAccountId.value : null,
      cashBoxId: needsTarget.value ? null : cashBoxId.value,
      categoryId: needsCategory.value ? categoryId.value : null,
      note: note.value.trim() || undefined,
    })
    toast.success('Операция проведена')
    open.value = false
    emit('done')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось провести операцию')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="500" scrollable>
    <v-card rounded="lg" class="op-card">
      <div class="op-head">
        <div class="op-title">{{ current?.title ?? 'Операция' }}</div>
        <div class="op-sub">{{ current?.hint }}</div>
      </div>

      <div class="op-body">
        <template v-if="current">
          <div class="op-field">
            <label class="op-label">Сумма</label>
            <div class="op-suffix-wrap">
              <input
                :value="amount || ''"
                v-maska="CURRENCY_MASK"
                type="text"
                inputmode="numeric"
                class="op-input"
                :class="{ 'op-input--bad': notEnough }"
                @maska="(e: any) => amount = parseMasked(e)"
              />
              <span class="op-suffix">₽</span>
            </div>
            <div v-if="notEnough" class="op-error">
              На счёте только {{ formatCurrency(from!.balance!) }}
            </div>
          </div>

          <!-- Касса стоит выше счёта: она отвечает, чьи это деньги, и от неё
               зависит, из каких счетов вообще можно выбирать. -->
          <div v-if="!needsTarget && cashBoxOptions.length > 1" class="op-field">
            <label class="op-label">Чьи деньги</label>
            <SelectField v-model="cashBoxId" :options="cashBoxOptions" />
          </div>

          <div class="op-field">
            <label class="op-label">{{ needsTarget ? 'Откуда' : current?.direction === 'in' ? 'На какой счёт' : 'С какого счёта' }}</label>
            <AccountSelect
              v-model="accountId"
              :items="forCashBox"
              :exclude-id="needsTarget ? toAccountId : null"
              empty-label="Определить автоматически"
            />
          </div>

          <div v-if="needsTarget" class="op-field">
            <label class="op-label">Куда</label>
            <AccountSelect
              v-model="toAccountId"
              :items="usable"
              :exclude-id="accountId"
            />
          </div>

          <div v-if="kind === 'PENDING_OUT' || isLoan" class="op-field">
            <label class="op-label">
              {{ isLoan ? (kind === 'BORROW' ? 'У кого взяли' : 'Кому дали') : 'За кем числятся деньги' }}
            </label>
            <input v-model="personName" class="op-input" placeholder="Например: Ахмед (брат)" />
            <div class="op-hint">Через месяц по памяти это уже не восстановить</div>
          </div>

          <div class="op-field">
            <label class="op-label">Комментарий</label>
            <input v-model="note" class="op-input" placeholder="Например: аренда за август" />
          </div>

          <!-- Что произойдёт с капиталом. Пишем прямо: это то самое место,
               где ошибка в назначении искажает прибыль. -->
          <div class="op-effect" :class="`op-effect--${current?.direction}`">
            <v-icon
              :icon="current?.direction === 'move' ? 'mdi-information-outline' : current?.direction === 'in' ? 'mdi-trending-up' : 'mdi-trending-down'"
              size="16"
            />
            <span v-if="kind === 'TRANSFER'">Капитал не изменится — меняется только место хранения</span>
            <span v-else-if="kind === 'DEPOSIT'">Капитал вырастет на сумму операции</span>
            <span v-else-if="kind === 'WITHDRAW_OWNER'">Капитал уменьшится: деньги ушли из бизнеса</span>
            <span v-else-if="kind === 'EXPENSE'">Расход уменьшит доступные деньги и прибыль</span>
            <span v-else-if="kind === 'BORROW'">
              Деньги появятся на счёте, но собственный капитал не вырастет —
              они чужие и в прибыли не участвуют
            </span>
            <span v-else-if="kind === 'LEND'">
              Деньги уйдут со счёта, но это не расход — их вернут
            </span>
            <span v-else-if="isPending">
              Остаток счёта изменится сразу, а на прибыль это пока не влияет —
              до разбора неизвестно, чем операция была
            </span>
            <span v-else>Доход увеличит доступные деньги</span>
          </div>
        </template>
      </div>

      <div class="op-actions">
        <button class="op-cancel" @click="open = false">Отмена</button>
        <button class="op-confirm" :disabled="!canSave || saving" @click="save">
          {{ saving ? 'Провожу…' : 'Провести' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.op-card { display: flex; flex-direction: column; max-height: 88vh; }
.op-head {
  padding: 20px 24px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.op-title { font-size: 17px; font-weight: 700; }
.op-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 3px; }
.op-body { padding: 16px 24px 8px; overflow-y: auto; flex: 1; }
.op-actions {
  display: flex; gap: 10px; padding: 14px 24px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.op-field { margin-top: 14px; }
.op-label {
  display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.op-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none; color: rgba(var(--v-theme-on-surface), 0.85);
}
.op-input:focus { border-color: #047857; }
.op-input--bad { border-color: #dc2626; }
.op-error { font-size: 12px; color: #dc2626; margin-top: 5px; }
.op-hint {
  font-size: 11.5px; line-height: 1.4; margin-top: 5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.op-suffix-wrap { position: relative; }
.op-suffix-wrap .op-input { padding-right: 34px; }
.op-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600; pointer-events: none;
  color: rgba(var(--v-theme-on-surface), 0.35);
}

.op-effect {
  display: flex; align-items: center; gap: 8px;
  margin-top: 16px; padding: 10px 13px; border-radius: 10px;
  font-size: 12.5px; line-height: 1.4;
}
.op-effect--in { background: rgba(16, 185, 129, 0.1); color: #047857; }
.op-effect--out { background: rgba(245, 158, 11, 0.12); color: #b45309; }
.op-effect--move { background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.6); }

.op-cancel, .op-confirm {
  flex: 1; padding: 11px 16px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.op-cancel {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500;
}
.op-confirm { background: #047857; color: #fff; }
.op-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
