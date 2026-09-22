<script setup lang="ts">
/**
 * Скидка на остаток договора.
 *
 * Отличие от прощения при досрочном погашении: там договор закрывается, а
 * здесь клиент продолжает платить по графику — просто должен меньше. Ситуация
 * обычная: клиент попал в трудное положение, договорились скинуть часть.
 *
 * Прощается только заработок партнёра: закупка возвращается всегда, эти деньги
 * уже отданы поставщику. Потолок считает и показывает окно, но решает сервер —
 * он проверяет то же правило.
 */
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import PaymentSchedulePreview from '@/components/PaymentSchedulePreview.vue'
import { formatCurrency, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { redistribute, type RedistributeMode } from '@/utils/redistribute'
import * as money from '@/utils/paymentMath'
import type { Deal, Payment } from '@/types'

const props = defineProps<{
  modelValue: boolean
  deal: Deal | null
  /** Весь график сделки — по нему считается остаток и превью. */
  schedule: Payment[]
  fullscreen?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** Скидка применена — страница перечитывает сделку и график. */
  (e: 'applied'): void
}>()

const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const amount = ref<number | null>(null)
const mode = ref<RedistributeMode>('EQUAL')
const manualSchedule = ref<Record<string, number>>({})
const saving = ref(false)

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!isOpen) return
    amount.value = null
    mode.value = 'EQUAL'
    manualSchedule.value = {}
  },
)

/** Открытые строки — их и перестраиваем. */
const openRows = computed(() => money.openRows(props.schedule))

/** Уже прощённое по договору. */
const discountNow = computed(() => Math.max(Math.round(props.deal?.discount ?? 0), 0))

/** Сколько клиент должен сейчас (с учётом прежних скидок). */
const outstandingNow = computed(() => {
  if (!props.deal) return 0
  return Math.max(
    Math.round(money.contractBalance(props.deal) - discountNow.value - money.sumSettled(props.schedule)),
    0,
  )
})

/** Потолок: заработок по сделке минус уже прощённое. */
const maxDiscount = computed(() => {
  if (!props.deal) return 0
  return Math.max(money.grossProfitBase(props.deal) - discountNow.value, 0)
})

const entered = computed(() => Math.max(Math.round(amount.value ?? 0), 0))
const exceedsIncome = computed(() => entered.value > maxDiscount.value)
/** Скидка больше долга — прощать нечего сверх остатка. */
const exceedsDebt = computed(() => entered.value > outstandingNow.value)

/**
 * Сумму, которую нельзя применить, не показываем в графике: партнёр решил бы,
 * что всё в порядке, а подтвердить окно не даст.
 */
const valid = computed(() => entered.value > 0 && !exceedsIncome.value && !exceedsDebt.value)

/** Каким станет остаток после скидки. */
const outstandingAfter = computed(() =>
  valid.value ? Math.max(outstandingNow.value - entered.value, 0) : outstandingNow.value,
)

/**
 * Сколько ложится на обычные строки: долги-недоплаты держат свою сумму, и
 * скидка доходит до них, только когда обычных строк не хватило.
 */
const regularTarget = computed(() =>
  Math.max(outstandingAfter.value - money.openDebtSum(props.schedule), 0),
)

/** Живое превью: как перестроится график. */
const preview = computed(() =>
  money.redistPreview(openRows.value, regularTarget.value, mode.value, manualSchedule.value),
)

const manualSum = computed(() =>
  openRows.value.reduce((s, r) => s + Math.round(manualSchedule.value[r.id] ?? 0), 0),
)

const MODES: { key: RedistributeMode; label: string; hint: string }[] = [
  { key: 'EQUAL', label: 'Поровну', hint: 'Все оставшиеся платежи уменьшатся понемногу' },
  { key: 'NEXT', label: 'В ближайший', hint: 'Ближайший платёж станет меньше или закроется целиком' },
  { key: 'LAST', label: 'В последний', hint: 'Уменьшится последний платёж, срок может сократиться' },
  { key: 'MANUAL', label: 'Вручную', hint: 'Сами проставьте новые суммы — их сумма должна равняться остатку' },
]

function pickMode(m: RedistributeMode) {
  mode.value = m
  if (m === 'MANUAL') {
    try {
      const eq = redistribute({ rows: openRows.value, target: regularTarget.value, mode: 'EQUAL' })
      const map: Record<string, number> = {}
      for (const r of eq.rows) map[r.id] = r.amount
      manualSchedule.value = map
    } catch {
      manualSchedule.value = {}
    }
  }
}

const canSubmit = computed(
  () =>
    !saving.value &&
    entered.value > 0 &&
    !exceedsIncome.value &&
    !exceedsDebt.value &&
    openRows.value.length > 0 &&
    !(mode.value === 'MANUAL' && !!preview.value.error),
)

async function submit() {
  if (!props.deal || !canSubmit.value) return
  saving.value = true
  try {
    await api.post(`/deals/${props.deal.id}/discount`, {
      amount: entered.value,
      mode: mode.value,
      manual:
        mode.value === 'MANUAL'
          ? openRows.value.map((r) => ({
              paymentId: r.id,
              amount: Math.round(manualSchedule.value[r.id] ?? 0),
            }))
          : undefined,
    })
    toast.success(`Скидка ${formatCurrency(entered.value)} применена`)
    open.value = false
    emit('applied')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось применить скидку')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" :max-width="fullscreen ? undefined : 520" :fullscreen="fullscreen" scrollable>
    <v-card :rounded="fullscreen ? 0 : 'lg'" class="dd-card">
      <button class="dialog-close-sm" @click="open = false">
        <v-icon icon="mdi-close" size="18" />
      </button>

      <div class="dd-head">
        <div class="dd-title">Скидка по договору</div>
        <div class="dd-sub">Долг уменьшится, договор продолжит действовать</div>
      </div>

      <div class="dd-body">
        <div class="dd-facts mb-4">
          <div class="dd-fact">
            <span>Клиент должен сейчас</span>
            <strong>{{ formatCurrency(outstandingNow) }}</strong>
          </div>
          <div class="dd-fact">
            <span>Можно скинуть не более</span>
            <strong>{{ formatCurrency(maxDiscount) }}</strong>
          </div>
        </div>

        <div class="mb-4">
          <label class="field-label">Сумма скидки</label>
          <div class="input-with-suffix">
            <input
              :value="amount || ''"
              v-maska="CURRENCY_MASK"
              type="text"
              inputmode="numeric"
              class="field-input"
              @maska="(e: any) => amount = parseMasked(e)"
            />
            <span class="input-suffix">₽</span>
          </div>
          <!-- Железное правило: прощается только заработок, закупка возвращается
               всегда. Поэтому предел показываем прямо при вводе. -->
          <div v-if="exceedsIncome" class="dd-error">
            Это больше оставшегося дохода по договору ({{ formatCurrency(maxDiscount) }}).
            Закупочную цену скидка не затрагивает.
          </div>
          <div v-else-if="exceedsDebt" class="dd-error">
            Это больше остатка долга ({{ formatCurrency(outstandingNow) }}).
          </div>
        </div>

        <div v-if="valid && openRows.length" class="dd-modes mb-4">
          <div class="dd-modes-head">Как распределить скидку</div>
          <div class="dd-mode-row">
            <button
              v-for="m in MODES"
              :key="m.key"
              type="button"
              class="dd-mode"
              :class="{ 'dd-mode--active': mode === m.key }"
              @click="pickMode(m.key)"
            >{{ m.label }}</button>
          </div>
          <div class="dd-mode-hint">{{ MODES.find((m) => m.key === mode)?.hint }}</div>

          <template v-if="mode === 'MANUAL'">
            <div v-if="preview.error" class="dd-error">{{ preview.error }}</div>
            <div class="dd-manual">
              <div v-for="row in openRows" :key="row.id" class="dd-manual-row">
                <span class="dd-manual-no">№{{ row.number }}</span>
                <span class="dd-manual-old">{{ formatCurrency(row.amount) }}</span>
                <v-icon icon="mdi-arrow-right" size="13" class="dd-manual-arrow" />
                <div class="dd-manual-input">
                  <input
                    :value="manualSchedule[row.id] ?? 0"
                    type="text"
                    inputmode="numeric"
                    class="dd-manual-field"
                    @input="(e: any) => manualSchedule[row.id] = Math.max(0, Math.round(Number(String(e.target.value).replace(/\D/g, '')) || 0))"
                  />
                  <span class="dd-manual-suffix">₽</span>
                </div>
              </div>
            </div>
            <div class="dd-manual-total" :class="{ 'dd-manual-total--bad': manualSum !== regularTarget }">
              <span>Распределено</span>
              <span>{{ formatCurrency(manualSum) }} / {{ formatCurrency(regularTarget) }}</span>
            </div>
          </template>
        </div>

        <!-- Живой график: видно, каким он станет, до подтверждения.
             Подпись здесь, а не внутри компонента: там она дублировала бы
             заголовок в окне оплаты. -->
        <div v-if="valid && schedule.length" class="dd-sched-label">Каким станет график</div>
        <PaymentSchedulePreview
          v-if="valid && schedule.length"
          class="mb-4"
          :schedule="schedule"
          target-id=""
          :entered="null"
          :preview="preview"
          :redistributing="true"
        />

        <div class="dd-total">
          <span>{{ valid ? 'Останется к оплате' : 'Останется к оплате сейчас' }}</span>
          <strong>{{ formatCurrency(outstandingAfter) }}</strong>
        </div>
        <div v-if="valid && outstandingAfter === 0" class="dd-note">
          <v-icon icon="mdi-flag-checkered" size="16" />
          <span>Скидка покрывает весь остаток — договор будет закрыт</span>
        </div>
        <div v-if="deal?.coInvestors?.length" class="dd-note dd-note--warn">
          <v-icon icon="mdi-account-multiple-outline" size="16" />
          <span>В сделке есть инвесторы: доход уменьшится, их доля считается от уменьшенного</span>
        </div>
      </div>

      <div class="dd-actions">
        <button class="btn-secondary flex-grow-1" @click="open = false">Отмена</button>
        <button class="btn-primary flex-grow-1" :disabled="!canSubmit" @click="submit">
          <v-progress-circular v-if="saving" indeterminate size="18" width="2" />
          <span v-else>Дать скидку</span>
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.dd-sched-label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}

.dd-card { display: flex; flex-direction: column; max-height: 88vh; width: 100%; min-width: 0; }
.dd-head {
  padding: 20px 56px 14px 24px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.dd-title { font-size: 17px; font-weight: 700; }
.dd-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 2px; }
.dd-body { padding: 18px 24px 4px; overflow-y: auto; overflow-x: hidden; flex: 1; min-width: 0; }
.dd-actions {
  display: flex; gap: 12px;
  padding: 14px 24px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.dd-facts {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.dd-fact {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65);
}
.dd-fact strong { color: rgba(var(--v-theme-on-surface), 0.9); }

.dd-error { font-size: 12px; color: #dc2626; margin-top: 6px; }

.dd-modes {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px; padding: 10px 12px;
}
.dd-modes-head {
  font-size: 12px; font-weight: 600; margin-bottom: 8px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.dd-mode-row { display: flex; gap: 6px; flex-wrap: wrap; }
.dd-mode {
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  font-size: 12.5px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.12s;
}
.dd-mode--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.dd-mode-hint {
  font-size: 11.5px; margin-top: 7px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.dd-manual { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.dd-manual-row {
  display: grid; grid-template-columns: auto 1fr auto minmax(0, 110px);
  align-items: center; gap: 8px; font-size: 12.5px;
}
.dd-manual-no { color: rgba(var(--v-theme-on-surface), 0.45); }
.dd-manual-old {
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-decoration: line-through; white-space: nowrap;
}
.dd-manual-arrow { color: rgba(var(--v-theme-on-surface), 0.3); }
.dd-manual-input { position: relative; }
.dd-manual-field {
  width: 100%; padding: 5px 24px 5px 8px; border-radius: 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  font-size: 12.5px; outline: none; text-align: right;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.dd-manual-field:focus { border-color: #047857; }
.dd-manual-suffix {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}
.dd-manual-total {
  display: flex; justify-content: space-between;
  margin-top: 8px; padding-top: 8px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.dd-manual-total--bad { color: #dc2626; }

.dd-total {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65);
  padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.dd-total strong { font-size: 15px; color: rgba(var(--v-theme-on-surface), 0.9); }
.dd-note {
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 10px; padding: 9px 12px; border-radius: 10px;
  font-size: 12.5px; color: #0369a1;
  background: rgba(14, 165, 233, 0.07);
}
.dd-note--warn { color: #b45309; background: rgba(245, 158, 11, 0.08); }

/* Поля и кнопки — те же, что в окнах оплаты: правила лежат в их scoped-стилях
   и сюда не попадают, поэтому продублированы дословно. */
.dialog-close-sm {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s; z-index: 1;
}
.dialog-close-sm:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.field-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: border-color 0.15s;
}
.field-input:focus { border-color: #047857; }
.input-with-suffix { position: relative; }
.input-with-suffix .field-input { padding-right: 36px; }
.input-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}
.btn-primary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #065f46; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
</style>
