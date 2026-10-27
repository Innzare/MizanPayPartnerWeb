<script setup lang="ts">
/**
 * «Чем это оказалось?» — разбор денег без назначения. Деньги второй раз не
 * двигаются: они уже на счёте, решается, чем они были.
 *
 * Выдача: расход по бизнесу или деньги вернули.
 * Поступление (решение владельца 25.10.2026, «Прочего дохода» больше нет):
 * - оплата по сделке — находим сделку и принимаем платёж этими деньгами
 *   (обычное окно оплаты, счёт и дата — из поступления);
 * - нам вернули долг — возврат по долгу, который мы давали;
 * - перевели по ошибке — мы вернули отправителю с выбранного счёта.
 * Сумма не совпадает (часть — оплата, часть — долг) — сначала «Разделить».
 *
 * Открывается из строки таблицы «Временных операций».
 */
import { computed, ref, watch } from 'vue'
import AccountSelect from '@/components/AccountSelect.vue'
import DateField from '@/components/DateField.vue'
import SelectField from '@/components/SelectField.vue'
import DealSearchPicker, { type DealSearchResult } from '@/components/DealSearchPicker.vue'
import QuickPayDialog from '@/components/QuickPayDialog.vue'
import { useAccountingStore, type PendingOpView, type LiabilityView } from '@/stores/accounting'
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useOperationDate } from '@/composables/useOperationDate'
import { dateToIso, todayIso } from '@/utils/dateInput'
import { CURRENCY_MASK, parseMasked, maskedMoney, formatCurrency, formatDate } from '@/utils/formatters'
import * as money from '@/utils/paymentMath'
import type { Deal, Payment } from '@/types'

const props = defineProps<{ op: PendingOpView | null }>()
const emit = defineEmits<{ (e: 'update:op', v: PendingOpView | null): void; (e: 'changed'): void }>()

const store = useAccountingStore()
const deals = useDealsStore()
const payments = usePaymentsStore()
const auth = useAuthStore()
const toast = useToast()
const opDate = useOperationDate()

type Kind = 'EXPENSE' | 'RETURNED' | 'DEAL' | 'LENT_REPAY' | 'MISTAKEN_RETURNED'
const target = computed(() => props.op)
const incoming = computed(() => props.op?.direction === 'IN')
const kind = ref<Kind>('EXPENSE')
const note = ref('')
const busy = ref(false)

function close() {
  emit('update:op', null)
}

// ── Варианты ──
const canPay = computed(() => auth.can('payments.markPaid'))
const canRepay = computed(() => auth.can('finance.capital'))

const options = computed<Array<{ value: Kind; title: string; hint: string }>>(() => {
  if (!target.value) return []
  if (!incoming.value) {
    return [
      { value: 'EXPENSE', title: 'Расход по бизнесу', hint: 'Аренда, зарплата, закупка мелочи — деньги потрачены.' },
      { value: 'RETURNED', title: 'Деньги вернули', hint: 'Не потратили — принесли обратно на счёт.' },
    ]
  }
  const list: Array<{ value: Kind; title: string; hint: string }> = []
  if (canPay.value) {
    list.push({
      value: 'DEAL',
      title: 'Оплата по сделке',
      hint: 'Клиент перевёл платёж по рассрочке. Найдите сделку — платёж будет принят этими деньгами: счёт и дата — из поступления, а поступление станет «оплата по сделке №…».',
    })
  }
  if (canRepay.value) {
    list.push({
      value: 'LENT_REPAY',
      title: 'Нам вернули долг',
      hint: 'Раньше мы давали деньги в долг (временное снятие), и их вернули. Остаток долга уменьшится; в прибыли эти деньги не участвуют — это возврат своих.',
    })
  }
  list.push({
    value: 'MISTAKEN_RETURNED',
    title: 'Перевели по ошибке — мы вернули',
    hint: 'Деньги чужие, их вернули отправителю. Укажите, с какого счёта этой кассы вернули: с него спишется та же сумма, итог по бизнесу — ноль.',
  })
  return list
})

watch(
  () => props.op,
  async (op) => {
    if (!op) return
    kind.value = op.direction === 'OUT' ? 'EXPENSE' : options.value[0]?.value ?? 'MISTAKEN_RETURNED'
    note.value = op.note ?? ''
    deal.value = null
    dealPayment.value = null
    dealPick.value = null
    liabilityId.value = null
    returnAccountId.value = op.account.id
    returnDate.value = ''
    splitOpen.value = false
    splitAmount.value = null
    if (!store.accounts.length) await store.fetchAccounts().catch(() => {})
    if (op.direction === 'IN' && canRepay.value) void loadDebts()
  },
)

/** Касса счёта поступления — долг и возврат ищем в ней. */
const opCashBoxId = computed(() => store.accounts.find((a) => a.id === props.op?.account.id)?.cashBoxId ?? null)

// ── Оплата по сделке ──
const dealPick = ref<DealSearchResult | null>(null)
const deal = ref<Deal | null>(null)
const dealPayment = ref<Payment | null>(null)
const dealLoading = ref(false)
const showPay = ref(false)

async function pickDeal(r: DealSearchResult) {
  dealPick.value = r
  dealLoading.value = true
  try {
    const [d] = await Promise.all([deals.fetchDeal(r.id), payments.fetchPaymentsForDeal(r.id)])
    deal.value = d
    dealPayment.value = money.paymentToPay(payments.getPaymentsForDeal(r.id))
  } catch (e: any) {
    toast.error(e, 'Не удалось открыть сделку')
  } finally {
    dealLoading.value = false
  }
}

function onPaid() {
  showPay.value = false
  close()
  emit('changed')
}

// ── Нам вернули долг ──
const debts = ref<LiabilityView[]>([])
const liabilityId = ref<string | null>(null)
async function loadDebts() {
  try {
    const res = await store.fetchLiabilities('ACTIVE')
    debts.value = (res.items ?? []).filter((l) => l.direction === 'LENT' && l.left > 0)
  } catch {
    debts.value = []
  }
}
/** Долги кассы этого счёта (и давние без кассы); остаток не меньше суммы. */
const debtsHere = computed(() =>
  debts.value.filter((l) => !l.cashBoxId || !opCashBoxId.value || l.cashBoxId === opCashBoxId.value),
)
const debtOptions = computed(() =>
  debtsHere.value
    .filter((l) => l.left >= Math.round(props.op?.amount ?? 0))
    .map((l) => ({
      value: l.id,
      label: `${l.personName} · осталось ${formatCurrency(l.left)} из ${formatCurrency(l.principal)}`,
      hint: l.dueDate ? `до ${formatDate(l.dueDate)}` : undefined,
    })),
)
const smallerDebts = computed(() => debtsHere.value.filter((l) => l.left < Math.round(props.op?.amount ?? 0)).length)

// ── Перевели по ошибке ──
const returnAccountId = ref<string | null>(null)
const returnDate = ref('')
/** Только счета кассы, куда пришли деньги: из другой кассы вернуть нельзя. */
const returnAccounts = computed(() =>
  store.accounts.filter((a) => !a.disabledAt && (!opCashBoxId.value || a.cashBoxId === opCashBoxId.value)),
)
const minReturnDate = computed(() => (props.op ? dateToIso(new Date(props.op.date)) : null))

// ── Разделить ──
const splitOpen = ref(false)
const splitAmount = ref<number | null>(null)
const splitValid = computed(() => !!props.op && !!splitAmount.value && splitAmount.value > 0 && splitAmount.value < Math.round(props.op.amount))
async function doSplit() {
  if (!props.op || !splitValid.value) return
  busy.value = true
  try {
    await store.splitPending(props.op.id, splitAmount.value!)
    toast.success(`Разделено: ${formatCurrency(splitAmount.value!)} + ${formatCurrency(Math.round(props.op.amount) - splitAmount.value!)}`)
    close()
    emit('changed')
  } catch (e: any) {
    toast.error(e, 'Не удалось разделить')
  } finally {
    busy.value = false
  }
}

// ── Разобрать ──
const canConfirm = computed(() => {
  if (busy.value || !target.value) return false
  if (kind.value === 'LENT_REPAY') return !!liabilityId.value
  if (kind.value === 'MISTAKEN_RETURNED') return !!returnAccountId.value
  return kind.value === 'EXPENSE' || kind.value === 'RETURNED'
})

async function confirm() {
  const op = target.value
  if (!op || !canConfirm.value) return
  busy.value = true
  try {
    const n = note.value.trim() || undefined
    if (kind.value === 'LENT_REPAY') await store.resolvePending(op.id, { type: 'LENT_REPAY', liabilityId: liabilityId.value!, note: n })
    else if (kind.value === 'MISTAKEN_RETURNED') {
      await store.resolvePending(op.id, { type: 'MISTAKEN_RETURNED', accountId: returnAccountId.value!, date: returnDate.value || undefined, note: n })
    } else if (kind.value === 'EXPENSE') await store.resolvePending(op.id, { type: 'EXPENSE', note: n })
    else await store.resolvePending(op.id, { type: 'RETURNED', note: n })
    toast.success('Операция разобрана')
    close()
    emit('changed')
  } catch (e: any) {
    toast.error(e, 'Не удалось разобрать операцию')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <!-- Разбор: деньги не двигаются второй раз, решается только, чем они были -->
  <v-dialog :model-value="!!target" max-width="520" scrollable @update:model-value="close">
    <v-card v-if="target" rounded="lg" class="po-dialog">
      <div class="po-head">
        <div class="po-dialog-title">Чем это оказалось?</div>
        <div class="po-dialog-sub">
          {{ incoming ? 'Поступление' : 'Выдача' }} {{ formatCurrency(target.amount) }} ·
          {{ formatDate(target.date) }} · {{ target.account.name }}<template v-if="target.personName"> · {{ target.personName }}</template>.
          Деньги уже на счёте — сейчас решается, чем они были.
        </div>
      </div>

      <div class="po-body">
        <div class="po-options">
          <button
            v-for="o in options"
            :key="o.value"
            type="button"
            class="po-option"
            :class="{ 'po-option--on': kind === o.value }"
            @click="kind = o.value"
          >
            <span class="po-option-title">{{ o.title }}</span>
            <span class="po-option-hint">{{ o.hint }}</span>
          </button>
        </div>

        <!-- Оплата по сделке: найти сделку → принять платёж этими деньгами -->
        <div v-if="kind === 'DEAL'" class="po-section">
          <DealSearchPicker :amount-hint="target.amount" :selected-id="dealPick?.id ?? null" @pick="pickDeal" />
          <div v-if="dealLoading" class="po-note">Открываю сделку…</div>
          <div v-else-if="dealPick && !dealPayment" class="po-warn">По сделке №{{ dealPick.dealNumber }} нет открытых платежей.</div>
          <div v-else-if="dealPick && dealPayment" class="po-note">
            Сделка №{{ dealPick.dealNumber }} · {{ dealPick.clientName }} · ближайший платёж {{ dealPayment.number }}
            на {{ formatCurrency(dealPayment.amount) }}. В окне оплаты счёт и дата уже будут из поступления, сумма —
            {{ formatCurrency(target.amount) }}; переплата закроет следующие платежи, недоплату можно оставить долгом.
          </div>
        </div>

        <!-- Нам вернули долг -->
        <div v-else-if="kind === 'LENT_REPAY'" class="po-section">
          <label class="po-label">Чей долг вернули</label>
          <SelectField
            v-model="liabilityId"
            :options="debtOptions"
            :placeholder="debtOptions.length ? 'Выберите долг' : 'Подходящих долгов нет'"
            :disabled="!debtOptions.length"
          />
          <div v-if="!debtsHere.length" class="po-note">В кассе этого счёта нет открытых долгов «дали в долг».</div>
          <div v-else-if="smallerDebts" class="po-note">
            Долги с остатком меньше {{ formatCurrency(target.amount) }} не показаны: вернули больше остатка —
            разделите поступление ниже.
          </div>
        </div>

        <!-- Перевели по ошибке — вернули -->
        <div v-else-if="kind === 'MISTAKEN_RETURNED'" class="po-section">
          <label class="po-label">С какого счёта вернули</label>
          <AccountSelect v-model="returnAccountId" :items="returnAccounts" />
          <label class="po-label mt-3">Когда вернули</label>
          <DateField v-model="returnDate" :min="minReturnDate" :max="opDate.maxDate.value || todayIso()" plain />
          <div v-if="!returnDate" class="po-note">Пусто — сегодня.</div>
        </div>

        <div v-if="kind !== 'DEAL'" class="po-field">
          <label class="po-label">Комментарий</label>
          <textarea v-clear v-model="note" class="po-input po-textarea" rows="2" :placeholder="incoming ? 'Например: Ахмед вернул часть долга' : 'Например: закупка расходников'" />
        </div>

        <!-- Разделить: часть — одно, часть — другое -->
        <div class="po-split">
          <button v-if="!splitOpen" type="button" class="po-link" @click="splitOpen = true">
            Сумма не совпадает? Разделить {{ incoming ? 'поступление' : 'выдачу' }} на две части
          </button>
          <div v-else class="po-split-box">
            <label class="po-label">Первая часть</label>
            <div class="po-split-row">
              <div class="po-suffix-wrap">
                <input v-clear
                  :value="maskedMoney(splitAmount)"
                  v-maska="CURRENCY_MASK"
                  type="text"
                  inputmode="numeric"
                  class="po-input po-input--num"
                  @maska="(e: any) => splitAmount = parseMasked(e)"
                />
                <span class="po-suffix">₽</span>
              </div>
              <button class="po-confirm po-confirm--sm" :disabled="busy || !splitValid" @click="doSplit">Разделить</button>
            </div>
            <div class="po-note">
              <template v-if="splitValid">Будет две операции: {{ formatCurrency(splitAmount!) }} и {{ formatCurrency(Math.round(target.amount) - splitAmount!) }} — каждую разберёте отдельно.</template>
              <template v-else>От 1 до {{ formatCurrency(Math.round(target.amount) - 1) }}.</template>
            </div>
          </div>
        </div>

        <div v-if="incoming" class="po-note po-note--muted">
          Это что-то другое — вложение своих денег или занятые на время? Удалите операцию кнопкой в строке таблицы и
          внесите её нужным видом.
        </div>
      </div>

      <div class="po-actions">
        <button class="po-cancel" @click="close">Отмена</button>
        <button v-if="kind === 'DEAL'" class="po-confirm" :disabled="!dealPayment || !deal" @click="showPay = true">
          Принять оплату…
        </button>
        <button v-else class="po-confirm" :disabled="!canConfirm" @click="confirm">
          {{ busy ? 'Записываю…' : kind === 'LENT_REPAY' || kind === 'MISTAKEN_RETURNED' ? 'Записать возврат' : 'Разобрать' }}
        </button>
      </div>
    </v-card>

    <QuickPayDialog v-model="showPay" :payment="dealPayment" :deal="deal" :pending-op="target" @paid="onPaid" />
  </v-dialog>
</template>

<style scoped>
.po-dialog { display: flex; flex-direction: column; max-height: 90vh; }
.po-head { padding: 22px 24px 0; }
.po-body { padding: 0 24px; overflow-y: auto; }
.po-dialog-title { font-size: 17px; font-weight: 700; }
.po-dialog-sub { font-size: 12.5px; line-height: 1.5; margin-top: 5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.po-options { display: flex; flex-direction: column; gap: 6px; margin-top: 16px; }
.po-option {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 13px; border-radius: 10px; text-align: left;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.75); cursor: pointer; transition: all 0.12s;
}
.po-option--on { border-color: #4f46e5; background: rgba(99, 102, 241, 0.07); color: #4f46e5; }
.po-option-title { font-size: 13.5px; font-weight: 600; }
.po-option-hint { font-size: 12px; line-height: 1.45; opacity: 0.8; }
.po-section { margin-top: 14px; }
.po-field { margin-top: 14px; }
.po-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: rgba(var(--v-theme-on-surface), 0.6); }
.po-input {
  width: 100%; height: 40px; padding: 0 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 14px; outline: none; color: rgba(var(--v-theme-on-surface), 0.85);
}
/* Комментарий — многострочный, как везде в кабинете. */
.po-textarea { display: block; height: auto; min-height: 64px; padding: 10px 14px; line-height: 1.45; resize: vertical; font-family: inherit; }
.po-input--num { padding-right: 34px; font-weight: 600; font-variant-numeric: tabular-nums; }
.po-input:focus { border-color: #4f46e5; }
.po-suffix-wrap { position: relative; flex: 1; }
.po-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%); pointer-events: none;
  font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.35);
}
.po-note { font-size: 12.5px; line-height: 1.45; margin-top: 6px; color: rgba(var(--v-theme-on-surface), 0.6); }
.po-note--muted { margin: 14px 0 4px; color: rgba(var(--v-theme-on-surface), 0.45); }
.po-warn { font-size: 12.5px; line-height: 1.45; margin-top: 6px; color: #b45309; font-weight: 600; }
.po-split { margin-top: 14px; }
.po-link { padding: 0; border: none; background: none; cursor: pointer; font-size: 13px; font-weight: 600; color: #4f46e5; }
.po-split-box { padding: 12px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.03); }
.po-split-row { display: flex; gap: 8px; }

.po-actions { display: flex; gap: 10px; padding: 16px 24px 18px; }
.po-cancel, .po-confirm {
  flex: 1; padding: 11px 16px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.po-confirm--sm { flex: none; padding: 0 16px; height: 40px; }
.po-cancel {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500;
}
.po-confirm { background: #4f46e5; color: #fff; }
.po-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
