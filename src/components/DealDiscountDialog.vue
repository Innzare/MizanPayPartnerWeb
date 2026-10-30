<script setup lang="ts">
import { useMonthLocks } from '@/composables/useMonthLocks'
/**
 * Скидка на остаток договора — дать или изменить.
 *
 * «Изменить» задаёт итоговую сумму скидки: больше — прирост снимается с
 * открытых месяцев, меньше — разница возвращается в график (месяцы, закрытые
 * скидкой, могут открыться снова), 0 — скидка убрана целиком. Отмена оплаты
 * скидку не трогает — только это окно.
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
import { formatCurrency, CURRENCY_MASK, maskedMoney, parseMasked } from '@/utils/formatters'
import { redistribute, type RedistributeMode } from '@/utils/redistribute'
import * as money from '@/utils/paymentMath'
import type { Deal, Payment } from '@/types'

const props = defineProps<{
  modelValue: boolean
  deal: Deal | null
  /** Весь график сделки — по нему считается остаток и превью. */
  schedule: Payment[]
  fullscreen?: boolean
  /**
   * `apply` — дать скидку (её ещё нет); `edit` — изменить данную;
   * `remove` — то же окно изменения, сразу с нулём.
   */
  action?: 'apply' | 'edit' | 'remove'
}>()

// Закрытые месяцы, в которые попадают оплаты сделки.
const monthLocks = useMonthLocks()
const closedMonths = computed(() => [...new Set(
  (props.schedule ?? [])
    .filter((p) => p.status === 'PAID' && p.paidAt && monthLocks.isLocked(props.deal?.cashBoxId, p.paidAt))
    .map((p) => monthLocks.monthTitle(p.paidAt!)),
)])


const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** Скидка применена, изменена или убрана — страница перечитывает сделку и график. */
  (e: 'applied'): void
}>()

const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** Уже прощённое по договору. */
const discountNow = computed(() => Math.max(Math.round(props.deal?.discount ?? 0), 0))

const isEdit = computed(() => props.action === 'edit' || props.action === 'remove')

/** «Дать»: сколько скинуть. */
const amount = ref<number | null>(null)
/** «Изменить»: какой станет скидка. Пусто — ещё не ввели. */
const target = ref<number | null>(null)
const mode = ref<RedistributeMode>('EQUAL')
/** Партнёр сам выбрал режим — больше не подменяем его умолчанием. */
const modeTouched = ref(false)
const manualSchedule = ref<Record<string, number>>({})
const saving = ref(false)

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!isOpen) return
    amount.value = null
    target.value = props.action === 'remove' ? 0 : isEdit.value ? discountNow.value : null
    mode.value = props.action === 'remove' ? 'LAST' : 'EQUAL'
    modeTouched.value = false
    manualSchedule.value = {}
  },
)

/** Итоговая скидка после подтверждения; null — сумму ещё не ввели. */
const nextDiscount = computed<number | null>(() => {
  if (isEdit.value) return target.value == null ? null : Math.max(Math.round(target.value), 0)
  const a = Math.max(Math.round(amount.value ?? 0), 0)
  return a > 0 ? discountNow.value + a : null
})

/** Скидка растёт, уменьшается или не меняется. */
const direction = computed<'up' | 'down' | 'none'>(() => {
  const t = nextDiscount.value
  if (t == null || t === discountNow.value) return 'none'
  return t > discountNow.value ? 'up' : 'down'
})
/** На сколько меняется скидка. */
const delta = computed(() => Math.abs((nextDiscount.value ?? discountNow.value) - discountNow.value))
const isRemoveAll = computed(() => isEdit.value && nextDiscount.value === 0 && discountNow.value > 0)

/** Пометка строк, закрытых скидкой, — та же, что пишет сервер. */
const DISCOUNT_NOTE = 'Скидка по договору'

const todayStart = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * График, с которым работает окно. Когда скидку уменьшают, месяцы, закрытые
 * ею, могут открыться снова — показываем их открытыми с нулём, и превью
 * видит, сколько в них вернётся. Так же их берёт сервер.
 */
const sched = computed<Payment[]>(() => {
  if (direction.value !== 'down') return props.schedule
  const today = todayStart()
  return props.schedule.map((p) =>
    p.status === 'CLOSED_EARLY' && p.note === DISCOUNT_NOTE && !money.isShortfallRow(p)
      ? { ...p, amount: 0, note: undefined, status: new Date(p.dueDate) < today ? 'OVERDUE' : 'PENDING' }
      : p,
  )
})

/** Открытые строки — их и перестраиваем. */
const openRows = computed(() => money.openRows(sched.value))

/**
 * Сколько клиент должен сейчас (с учётом прежних скидок). Внесённое
 * округляем построчно, как сервер: у импортных сделок бывают копейки, и
 * граница «больше долга» разошлась бы на рубль.
 */
const outstandingNow = computed(() => {
  if (!props.deal) return 0
  const settled = props.schedule
    .filter((p) => p.status === 'PAID' || p.status === 'CLOSED_EARLY')
    .reduce((sum, p) => sum + Math.round(p.amount), 0)
  return Math.max(Math.round(money.contractBalance(props.deal) - discountNow.value - settled), 0)
})

/** Весь заработок по сделке — больше этого скидка не бывает. */
const incomeTotal = computed(() => (props.deal ? money.grossProfitBase(props.deal) : 0))
/** «Дать»: сколько ещё можно скинуть. */
const maxDiscount = computed(() => Math.max(incomeTotal.value - discountNow.value, 0))

const exceedsIncome = computed(() => (nextDiscount.value ?? 0) > incomeTotal.value)
/** Прирост больше долга — прощать нечего сверх остатка. */
const exceedsDebt = computed(() => direction.value === 'up' && delta.value > outstandingNow.value)

/**
 * Сумму, которую нельзя применить, не показываем в графике: партнёр решил бы,
 * что всё в порядке, а подтвердить окно не даст.
 */
const valid = computed(() => direction.value !== 'none' && !exceedsIncome.value && !exceedsDebt.value)

/** Каким станет остаток после изменения скидки. */
const outstandingAfter = computed(() => {
  if (!valid.value) return outstandingNow.value
  return direction.value === 'down'
    ? outstandingNow.value + delta.value
    : Math.max(outstandingNow.value - delta.value, 0)
})

/**
 * Сколько ложится на обычные строки: долги-недоплаты держат свою сумму, и
 * скидка доходит до них, только когда обычных строк не хватило.
 */
const regularTarget = computed(() =>
  Math.max(outstandingAfter.value - money.openDebtSum(sched.value), 0),
)

/** Живое превью: как перестроится график. */
const preview = computed(() =>
  money.redistPreview(openRows.value, regularTarget.value, mode.value, manualSchedule.value),
)

const manualSum = computed(() =>
  openRows.value.reduce((s, r) => s + Math.round(manualSchedule.value[r.id] ?? 0), 0),
)

/**
 * Прошлые месяцы, которые уменьшение скидки откроет снова, — они сразу станут
 * просроченными и попадут в «Должники».
 */
const reopenedOverdue = computed(() => {
  if (direction.value !== 'down' || !valid.value) return []
  const today = todayStart()
  const after = new Map(preview.value.rows.map((r) => [r.id, r.amount]))
  return props.schedule
    .filter((p) =>
      p.status === 'CLOSED_EARLY' && p.note === DISCOUNT_NOTE && !money.isShortfallRow(p)
      && new Date(p.dueDate) < today && (after.get(p.id) ?? 0) > 0)
    .map((p) => p.number)
})

const APPLY_MODES: { key: RedistributeMode; label: string; hint: string }[] = [
  { key: 'EQUAL', label: 'Поровну', hint: 'Все оставшиеся платежи уменьшатся понемногу' },
  { key: 'NEXT', label: 'В ближайший', hint: 'Ближайший платёж станет меньше или закроется целиком' },
  { key: 'LAST', label: 'В последний', hint: 'Уменьшится последний платёж, срок может сократиться' },
  { key: 'MANUAL', label: 'Вручную', hint: 'Сами проставьте новые суммы — их сумма должна равняться остатку' },
]
const RETURN_MODES = computed<{ key: RedistributeMode; label: string; hint: string }[]>(() => {
  const sum = formatCurrency(delta.value)
  return [
    { key: 'EQUAL', label: 'Поровну', hint: 'Все оставшиеся платежи, включая месяцы, закрытые скидкой, станут равными' },
    { key: 'NEXT', label: 'В ближайший', hint: `Ближайший платёж вырастет на ${sum}` },
    { key: 'LAST', label: 'В последний', hint: `Последний платёж вырастет на ${sum} — остальные месяцы не изменятся` },
    { key: 'MANUAL', label: 'Вручную', hint: 'Сами проставьте новые суммы — их сумма должна равняться остатку' },
  ]
})
const MODES = computed(() => (direction.value === 'down' ? RETURN_MODES.value : APPLY_MODES))

function pickMode(m: RedistributeMode, byUser = true) {
  if (byUser) modeTouched.value = true
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

/**
 * Сменилось направление — сменился и набор строк. Пока партнёр режим не
 * выбирал, при уменьшении скидки ставим «В последний»: «Поровну» открыло бы
 * все месяцы, закрытые скидкой, и прошлые сразу стали бы просроченными.
 * Ручные суммы пересобираем.
 */
watch(direction, (dir) => {
  if (!modeTouched.value) mode.value = dir === 'down' ? 'LAST' : 'EQUAL'
  if (mode.value === 'MANUAL') pickMode('MANUAL', false)
})

/** Сумму некуда разнести: в графике нет открытых платежей. */
const noRows = computed(() => valid.value && openRows.value.length === 0)

const canSubmit = computed(
  () =>
    !saving.value &&
    valid.value &&
    openRows.value.length > 0 &&
    !(mode.value === 'MANUAL' && !!preview.value.error),
)

const submitLabel = computed(() => {
  if (!isEdit.value) return 'Дать скидку'
  return isRemoveAll.value ? 'Убрать скидку' : 'Сохранить'
})

async function submit() {
  if (!props.deal || !canSubmit.value || nextDiscount.value == null) return
  const before = discountNow.value
  const after = nextDiscount.value
  saving.value = true
  try {
    // Одна операция на любое изменение: сервер получает итоговую сумму и ту,
    // что видел партнёр, — если скидку успели изменить, он откажет.
    await api.post(`/deals/${props.deal.id}/discount/set`, {
      target: after,
      expectedCurrent: before,
      mode: mode.value,
      manual:
        mode.value === 'MANUAL'
          ? openRows.value.map((r) => ({
              paymentId: r.id,
              amount: Math.round(manualSchedule.value[r.id] ?? 0),
            }))
          : undefined,
    })
    toast.success(
      after === 0
        ? `Скидка ${formatCurrency(before)} убрана`
        : before === 0
          ? `Скидка ${formatCurrency(after)} применена`
          : after > before
            ? `Скидка увеличена до ${formatCurrency(after)}`
            : `Скидка уменьшена до ${formatCurrency(after)}`,
    )
    open.value = false
    emit('applied')
  } catch (e: any) {
    if (e?.code === 'DISCOUNT_STALE') {
      // Скидку изменили в другом окне — показываем актуальную сделку.
      toast.error(e, 'Скидку только что изменили')
      open.value = false
      emit('applied')
    } else {
      toast.error(e, isEdit.value ? 'Не удалось изменить скидку' : 'Не удалось применить скидку')
    }
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
        <div class="dd-title">{{ isEdit ? 'Изменить скидку' : 'Скидка по договору' }}</div>
        <div class="dd-sub">
          {{ isEdit
            ? 'Новая сумма скидки — не больше дохода по договору'
            : 'Долг уменьшится, договор продолжит действовать' }}
        </div>
      </div>

      <div class="dd-body">
        <div class="dd-facts mb-4">
          <div class="dd-fact">
            <span>Клиент должен сейчас</span>
            <strong>{{ formatCurrency(outstandingNow) }}</strong>
          </div>
          <template v-if="isEdit">
            <div class="dd-fact">
              <span>Скидка сейчас</span>
              <strong>{{ formatCurrency(discountNow) }}</strong>
            </div>
            <div class="dd-fact">
              <span>Скидка не может быть больше</span>
              <strong>{{ formatCurrency(incomeTotal) }}</strong>
            </div>
          </template>
          <div v-else class="dd-fact">
            <span>Можно скинуть не более</span>
            <strong>{{ formatCurrency(maxDiscount) }}</strong>
          </div>
        </div>

        <div v-if="isEdit" class="mb-4">
          <label class="field-label">Новая сумма скидки</label>
          <div class="input-with-suffix">
            <!-- Ноль здесь значимый («убрать полностью») — показываем его, а
                 не пустое поле, как у обычных денежных полей. -->
            <input v-clear
              :value="target == null ? '' : target === 0 ? '0' : maskedMoney(target)"
              v-maska="CURRENCY_MASK"
              type="text"
              inputmode="numeric"
              class="field-input"
              @maska="(e: any) => target = e.detail?.unmasked === '' ? null : parseMasked(e)"
            />
            <span class="input-suffix">₽</span>
          </div>
          <button
            v-if="target !== 0"
            type="button"
            class="dd-link"
            @click="target = 0"
          >
            <v-icon icon="mdi-tag-off-outline" size="15" />
            Убрать скидку полностью
          </button>
          <div v-if="exceedsIncome" class="dd-error">
            Это больше дохода по договору ({{ formatCurrency(incomeTotal) }}).
            Закупочную цену скидка не затрагивает.
          </div>
          <div v-else-if="exceedsDebt" class="dd-error">
            Скидка вырастет на {{ formatCurrency(delta) }} — это больше остатка долга ({{ formatCurrency(outstandingNow) }}).
          </div>
          <div v-else-if="target == null" class="dd-hint">
            Введите сумму или нажмите «Убрать скидку полностью»
          </div>
          <div v-else-if="direction === 'none'" class="dd-hint">Скидка не изменилась</div>
          <div v-else-if="isRemoveAll" class="dd-hint">
            Скидки не будет: клиент снова должен {{ formatCurrency(delta) }}
          </div>
          <div v-else-if="direction === 'down'" class="dd-hint">
            Скидка уменьшится на {{ formatCurrency(delta) }} — клиент снова должен эту сумму
          </div>
          <div v-else class="dd-hint">Скидка вырастет на {{ formatCurrency(delta) }}</div>
        </div>

        <div v-else class="mb-4">
          <label class="field-label">Сумма скидки</label>
          <div class="input-with-suffix">
            <input v-clear
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

        <div v-if="noRows" class="dd-error mb-4">
          {{ direction === 'down'
            ? 'Скидку некуда вернуть: в графике нет открытых платежей'
            : 'В графике нет открытых платежей — скидку не к чему применить' }}
        </div>
        <div v-if="valid && openRows.length" class="dd-modes mb-4">
          <div class="dd-modes-head">{{ direction === 'down' ? 'Куда вернуть сумму' : 'Как распределить скидку' }}</div>
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
                  <input v-clear
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
        <div v-if="valid && sched.length" class="dd-sched-label">Каким станет график</div>
        <PaymentSchedulePreview
          v-if="valid && sched.length"
          class="mb-4"
          :schedule="sched"
          target-id=""
          :entered="null"
          :preview="preview"
          :redistributing="true"
        />

        <div class="dd-total">
          <span>{{ valid ? 'Останется к оплате' : 'Останется к оплате сейчас' }}</span>
          <strong>{{ formatCurrency(outstandingAfter) }}</strong>
        </div>
        <div v-if="reopenedOverdue.length" class="dd-note dd-note--warn">
          <v-icon icon="mdi-alert-outline" size="16" />
          <span>
            {{ reopenedOverdue.length === 1 ? 'Месяц' : 'Месяцы' }} №{{ reopenedOverdue.join(', №') }}
            {{ reopenedOverdue.length === 1 ? 'снова откроется и сразу станет просроченным' : 'снова откроются и сразу станут просроченными' }}.
            Чтобы этого избежать, выберите «В последний».
          </span>
        </div>
        <div v-if="direction === 'up' && valid && outstandingAfter === 0" class="dd-note">
          <v-icon icon="mdi-flag-checkered" size="16" />
          <span>Скидка покрывает весь остаток — договор будет закрыт</span>
        </div>
        <!-- Скидка пересчитывает доход всех оплат сделки — и тех, что в
             закрытых месяцах (мягко: можно, но итоги месяца разойдутся). -->
        <div v-if="closedMonths.length" class="dd-note dd-note--warn">
          <v-icon icon="mdi-lock-outline" size="14" />
          У сделки есть оплаты в закрытых месяцах ({{ closedMonths.join(', ') }}). Скидка пересчитает их доход и доли
          инвесторов — итоги этих месяцев разойдутся с сохранёнными при закрытии.
        </div>
        <div v-if="deal?.coInvestors?.length" class="dd-note dd-note--warn">
          <v-icon icon="mdi-account-multiple-outline" size="16" />
          <span v-if="direction === 'down'">В сделке есть инвесторы: доход вырастет на {{ formatCurrency(delta) }}, их доля считается от него</span>
          <span v-else>В сделке есть инвесторы: доход уменьшится, их доля считается от уменьшенного</span>
        </div>
      </div>

      <div class="dd-actions">
        <button class="btn-secondary flex-grow-1" @click="open = false">Отмена</button>
        <button class="btn-primary flex-grow-1" :disabled="!canSubmit" @click="submit">
          <v-progress-circular v-if="saving" indeterminate size="18" width="2" />
          <span v-else>{{ submitLabel }}</span>
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
.dd-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 6px; }
.dd-link {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 8px; padding: 0; border: none; background: none;
  font-size: 12.5px; font-weight: 600; color: #c2413b; cursor: pointer;
}
.dd-link:hover { text-decoration: underline; }

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
