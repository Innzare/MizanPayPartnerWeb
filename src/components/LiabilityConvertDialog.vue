<script setup lang="ts">
/**
 * «Перенести в основные» — часть долга «дали» партнёр не получает обратно, а
 * забирает себе: расходом по бизнесу, иным расходом, снятием прибыли или
 * снятием капитала (запрос владельца 26.10.2026).
 *
 * Деньги на счетах не меняются: они ушли ещё при выдаче долга. Долг
 * уменьшается на сумму, а в «Пополнениях и расходах» появляется операция
 * выбранного вида с пометкой «Перенесено из временного снятия». Остаток
 * долга принимают обычным возвратом.
 */
import { computed, ref, watch } from 'vue'
import AccountSelect from '@/components/AccountSelect.vue'
import DateField from '@/components/DateField.vue'
import SelectField from '@/components/SelectField.vue'
import { api } from '@/api/client'
import { useAccountingStore, type LiabilityCard, type LiabilityConvertKind } from '@/stores/accounting'
import { useAuthStore } from '@/stores/auth'
import { useSections } from '@/composables/useSections'
import { useOperationDate } from '@/composables/useOperationDate'
import { useToast } from '@/composables/useToast'
import { todayIso } from '@/utils/dateInput'
import { CURRENCY_MASK, parseMasked, maskedMoney, formatCurrency } from '@/utils/formatters'

const props = defineProps<{ modelValue: boolean; card: LiabilityCard | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'done'): void }>()

const store = useAccountingStore()
const auth = useAuthStore()
const sections = useSections()
const opDate = useOperationDate()
const toast = useToast()

const KINDS: Array<{ value: LiabilityConvertKind; title: string; hint: string; permission: string }> = [
  { value: 'EXPENSE', title: 'Расход по бизнесу', hint: 'Потратили на бизнес', permission: 'finance.transactions' },
  { value: 'OTHER_EXPENSE', title: 'Иной расход', hint: 'Потратили на свои цели', permission: 'finance.transactions' },
  { value: 'WITHDRAW_PROFIT', title: 'Снятие прибыли', hint: 'Забрали заработанное', permission: 'finance.capital' },
  { value: 'WITHDRAW_OWNER', title: 'Снятие капитала', hint: 'Забрали вложенное', permission: 'finance.capital' },
]
const kinds = computed(() => KINDS.filter((k) => auth.can(k.permission)))

const amount = ref<number | null>(null)
const kind = ref<LiabilityConvertKind>('EXPENSE')
const accountId = ref<string | null>(null)
const date = ref('')
const note = ref('')
const categoryId = ref<string | null>(null)
const affectsInvestors = ref(false)
const fromCapital = ref(false)
const effectiveFrom = ref('')
const saving = ref(false)

const isExpense = computed(() => kind.value === 'EXPENSE' || kind.value === 'OTHER_EXPENSE')
const showInvestorFlags = computed(() => sections.visible('coInvestors'))

// ── Статьи расхода ──
interface Category { id: string; name: string; type: 'INCOME' | 'EXPENSE'; color?: string | null }
const categories = ref<Category[]>([])
const categoryOptions = computed(() =>
  categories.value.filter((c) => c.type === 'EXPENSE').map((c) => ({ value: c.id, label: c.name, color: c.color ?? undefined })),
)

// ── Прибыль к снятию кассы — предел «Снятия прибыли» ──
// Деньги не двигаются, поэтому «Доступно сейчас» не ограничивает — только
// заработанное и не снятое.
const profitLeft = ref<number | null>(null)
/** Вложено партнёром в кассу — вместе с прибылью предел «Снятия капитала». */
const investedLeft = ref<number | null>(null)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open || !props.card) return
    amount.value = null
    kind.value = kinds.value[0]?.value ?? 'EXPENSE'
    accountId.value = lastAccount()
    date.value = ''
    note.value = ''
    categoryId.value = null
    affectsInvestors.value = false
    fromCapital.value = false
    effectiveFrom.value = ''
    profitLeft.value = null
    investedLeft.value = null
    if (!store.accounts.length) await store.fetchAccounts().catch(() => {})
    if (!accountId.value) accountId.value = lastAccount()
    if (!categories.value.length) {
      try {
        categories.value = await api.get<Category[]>('/finance/categories')
      } catch {
        categories.value = []
      }
    }
    if (props.card.cashBox && auth.can('finance.capital')) {
      try {
        const res = await store.fetchProfit(props.card.cashBox.id)
        profitLeft.value = Math.max(0, Math.round(res.cashBoxes[0]?.withdrawableProfit ?? 0))
        investedLeft.value = Math.max(0, Math.round(res.cashBoxes[0]?.investedCapital ?? 0))
      } catch {
        profitLeft.value = null
        investedLeft.value = null
      }
    }
  },
)

/** Счета кассы долга — пара операций ложится на один её счёт. */
const accounts = computed(() => {
  const box = props.card?.cashBox?.id
  return store.accounts.filter((a) => !a.disabledAt && (!box || a.cashBoxId === box))
})
/** По умолчанию — счёт, с которого давали (последний в истории долга). */
function lastAccount(): string | null {
  const ms = props.card?.movements ?? []
  for (let i = ms.length - 1; i >= 0; i--) {
    const id = ms[i]!.account?.id
    if (id && accounts.value.some((a) => a.id === id)) return id
  }
  return accounts.value[0]?.id ?? null
}

const left = computed(() => props.card?.left ?? 0)
const amountError = computed(() => {
  const v = amount.value ?? 0
  if (v > left.value) return `Остаток долга — ${formatCurrency(left.value)}, больше перенести нельзя`
  if (kind.value === 'WITHDRAW_PROFIT' && profitLeft.value !== null && v > profitLeft.value) {
    return `Прибыли к снятию в кассе — ${formatCurrency(profitLeft.value)}. Остальное — «Снятие капитала» или расход`
  }
  // Своими деньгами снять можно вложенное плюс заработанное — остальное в
  // кассе принадлежит инвесторам.
  if (kind.value === 'WITHDRAW_OWNER' && investedLeft.value !== null && profitLeft.value !== null && v > investedLeft.value + profitLeft.value) {
    return `Вложено ${formatCurrency(investedLeft.value)}, прибыли ${formatCurrency(profitLeft.value)} — больше снять нельзя. Остальное оформите расходом`
  }
  return ''
})
const canSave = computed(() => !!props.card && (amount.value ?? 0) > 0 && !amountError.value && !!kind.value && !saving.value)
const kindTitle = computed(() => KINDS.find((k) => k.value === kind.value)?.title ?? '')

function close() {
  emit('update:modelValue', false)
}

async function save() {
  const c = props.card
  if (!c || !canSave.value) return
  const ask = date.value ? opDate.confirmMessage(date.value) : null
  if (ask && !window.confirm(ask)) return
  saving.value = true
  try {
    await store.convertLiability(c.id, {
      amount: amount.value!,
      kind: kind.value,
      accountId: accountId.value,
      ...(date.value ? { date: date.value } : {}),
      note: note.value.trim() || undefined,
      ...(isExpense.value
        ? {
            categoryId: categoryId.value,
            ...(showInvestorFlags.value ? { affectsInvestors: affectsInvestors.value, fromCapital: fromCapital.value } : {}),
          }
        : {}),
      ...(kind.value === 'WITHDRAW_OWNER' && effectiveFrom.value ? { effectiveFrom: effectiveFrom.value } : {}),
    })
    toast.success(`Перенесено в основные: ${kindTitle.value.toLowerCase()} ${formatCurrency(amount.value!)}`)
    close()
    emit('done')
  } catch (e: any) {
    toast.error(e, 'Не удалось перенести')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="480" scrollable @update:model-value="close">
    <v-card v-if="card" rounded="lg" class="lv-dialog">
      <div class="lv-head">
        <div class="lv-title">Перенести в основные</div>
        <div class="lv-sub">
          {{ card.personName }}<template v-if="card.cashBox"> · {{ card.cashBox.name }}</template> · осталось
          {{ formatCurrency(card.left) }}
        </div>
      </div>

      <div class="lv-body">
        <div class="lv-field">
          <label class="lv-label">Чем стала эта часть долга</label>
          <div class="lv-kinds">
            <button
              v-for="k in kinds"
              :key="k.value"
              type="button"
              class="lv-kind"
              :class="{ 'lv-kind--on': kind === k.value }"
              @click="kind = k.value"
            >
              <span class="lv-kind-title">{{ k.title }}</span>
              <span class="lv-kind-hint">{{ k.hint }}</span>
            </button>
          </div>
        </div>

        <div class="lv-field">
          <label class="lv-label">Сумма</label>
          <div class="lv-suffix-wrap">
            <input v-clear
              :value="maskedMoney(amount)"
              v-maska="CURRENCY_MASK"
              type="text"
              inputmode="numeric"
              class="lv-input lv-input--num"
              :class="{ 'lv-input--bad': !!amountError }"
              @maska="(e: any) => amount = parseMasked(e)"
            />
            <span class="lv-suffix">₽</span>
          </div>
          <div v-if="amountError" class="lv-error">{{ amountError }}</div>
          <button v-else-if="card.left > 0 && amount !== card.left" type="button" class="lv-link" @click="amount = card.left">
            Весь остаток — {{ formatCurrency(card.left) }}
          </button>
          <div v-if="kind === 'WITHDRAW_PROFIT' && profitLeft !== null && !amountError" class="lv-hint">
            Прибыли к снятию в кассе — {{ formatCurrency(profitLeft) }}.
          </div>
          <div v-else-if="kind === 'WITHDRAW_OWNER' && investedLeft !== null && profitLeft !== null && !amountError" class="lv-hint">
            Своих денег в кассе — {{ formatCurrency(investedLeft + profitLeft) }} (вложено и прибыль).
          </div>
        </div>

        <!-- Расход: статья и флаги — как в обычной форме расхода. -->
        <template v-if="isExpense">
          <div class="lv-field">
            <label class="lv-label">Статья</label>
            <SelectField v-model="categoryId" :options="categoryOptions" empty-label="Без статьи" placeholder="Без статьи" />
          </div>
          <template v-if="showInvestorFlags">
            <div class="lv-field">
              <label class="lv-label">Откуда расход</label>
              <div class="lv-seg">
                <button type="button" class="lv-seg-btn" :class="{ 'lv-seg-btn--on': !fromCapital }" @click="fromCapital = false">Из прибыли</button>
                <button type="button" class="lv-seg-btn" :class="{ 'lv-seg-btn--on': fromCapital }" @click="fromCapital = true">Из капитала</button>
              </div>
            </div>
            <label class="lv-check">
              <input v-model="affectsInvestors" type="checkbox" />
              <span>Затрагивает инвесторов — уменьшит прибыль месяца до деления с ними</span>
            </label>
          </template>
        </template>

        <div v-if="kind === 'WITHDRAW_OWNER' && showInvestorFlags" class="lv-field">
          <label class="lv-label">Не участвует в долях с</label>
          <DateField v-model="effectiveFrom" plain />
          <div class="lv-hint">Пусто — с даты переноса.</div>
        </div>

        <div class="lv-field">
          <label class="lv-label">Счёт</label>
          <AccountSelect v-model="accountId" :items="accounts" />
          <div class="lv-hint">Только счета кассы долга. Остаток счёта не изменится.</div>
        </div>

        <div class="lv-field">
          <label class="lv-label">Дата</label>
          <DateField v-model="date" :min="opDate.minDate.value" :max="opDate.maxDate.value || todayIso()" plain />
          <div v-if="!date" class="lv-hint">Пусто — сегодня.</div>
        </div>

        <div class="lv-field">
          <label class="lv-label">Комментарий</label>
          <textarea v-clear v-model="note" class="lv-input lv-textarea" rows="2" placeholder="Например: на свои нужды" />
        </div>

        <div class="lv-note">
          Деньги на счетах не изменятся — они ушли, когда давали в долг. Долг уменьшится
          <template v-if="amount">на {{ formatCurrency(amount) }}</template>, а в «Пополнениях и расходах» появится
          «{{ kindTitle }}» с пометкой «перенесено из временного снятия».
        </div>
      </div>

      <div class="lv-actions">
        <button class="lv-cancel" @click="close">Отмена</button>
        <button class="lv-confirm" :disabled="!canSave" @click="save">{{ saving ? 'Переношу…' : 'Перенести' }}</button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.lv-dialog { display: flex; flex-direction: column; max-height: 90vh; }
.lv-head { padding: 22px 24px 0; }
.lv-body { padding: 0 24px; overflow-y: auto; }
.lv-title { font-size: 17px; font-weight: 700; }
.lv-sub { font-size: 12.5px; line-height: 1.5; margin-top: 5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.lv-field { margin-top: 14px; }
.lv-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: rgba(var(--v-theme-on-surface), 0.6); }
.lv-kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.lv-kind {
  display: flex; flex-direction: column; gap: 1px; padding: 9px 12px; border-radius: 10px; text-align: left; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); color: rgba(var(--v-theme-on-surface), 0.75);
}
.lv-kind--on { border-color: #047857; background: rgba(4, 120, 87, 0.07); color: #047857; }
.lv-kind-title { font-size: 13px; font-weight: 600; }
.lv-kind-hint { font-size: 11.5px; opacity: 0.75; }
.lv-suffix-wrap { position: relative; }
.lv-input {
  width: 100%; height: 42px; padding: 0 14px; border-radius: 10px; outline: none;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9);
}
.lv-input--num { padding-right: 34px; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.lv-input:focus { border-color: #047857; }
.lv-input--bad, .lv-input--bad:focus { border-color: #dc2626; }
/* Комментарий — многострочный, как везде в кабинете. */
.lv-textarea { display: block; height: auto; min-height: 64px; padding: 10px 14px; line-height: 1.45; resize: vertical; font-family: inherit; }
.lv-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%); pointer-events: none;
  font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.35);
}
.lv-error { font-size: 12px; color: #dc2626; margin-top: 5px; }
.lv-hint { font-size: 12px; line-height: 1.4; margin-top: 4px; color: rgba(var(--v-theme-on-surface), 0.5); }
.lv-link { margin-top: 5px; padding: 0; border: none; background: none; cursor: pointer; font-size: 12.5px; font-weight: 600; color: #047857; }
.lv-seg { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.05); }
.lv-seg-btn { flex: 1; padding: 7px 10px; border: none; border-radius: 8px; background: none; cursor: pointer; font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.55); }
.lv-seg-btn--on { background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.92); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
.lv-check { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; font-size: 12.5px; line-height: 1.45; color: rgba(var(--v-theme-on-surface), 0.7); cursor: pointer; }
.lv-check input { margin-top: 3px; }
.lv-note {
  margin: 16px 0 4px; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.5;
  background: rgba(var(--v-theme-on-surface), 0.035); color: rgba(var(--v-theme-on-surface), 0.6);
}
.lv-actions { display: flex; gap: 10px; padding: 16px 24px 18px; }
.lv-cancel, .lv-confirm { flex: 1; padding: 11px 16px; border-radius: 10px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; }
.lv-cancel { background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500; }
.lv-confirm { background: #047857; color: #fff; }
.lv-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
