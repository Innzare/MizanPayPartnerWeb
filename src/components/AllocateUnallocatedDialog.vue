<script setup lang="ts">
/**
 * Разнесение денег по счетам.
 *
 * «Не разнесено» — это деньги, которые в кассе есть, а где они физически
 * лежат, не сказано: старые оплаты без выбора счёта и перенесённая история.
 * Раньше строка о них только сообщала о проблеме, а лечить приходилось
 * пересчётом каждого счёта по одному, вручную считая, сколько добавить.
 *
 * Здесь партнёр сразу говорит, где эти деньги: вписывает суммы напротив
 * счетов, видит живой остаток «ещё не разнесено» и подтверждает разом. Под
 * капотом это тот же пересчёт остатка (accounting.reconcile) по каждому
 * задетому счёту — новых способов двигать деньги не появляется, поэтому
 * касса и капитал остаются нетронутыми: уточняется только место хранения.
 *
 * Окно работает в одну сторону: разложить деньги, которые в кассе есть.
 * Обратного хода — «списать лишнее со счетов» — здесь нет намеренно. Если на
 * счетах записано больше, чем в кассе, это ошибка учёта, а не место хранения:
 * лечится инвентаризацией конкретного счёта, где видно, что именно разошлось.
 */
import { computed, onMounted, ref, watch } from 'vue'
import BankLogo from '@/components/BankLogo.vue'
import { useAccountingStore, type AccountView } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { CURRENCY_MASK, parseMasked, formatCurrency } from '@/utils/formatters'

const props = defineProps<{
  modelValue: boolean
  /** Сколько денег кассы ещё не привязано к счетам. Всегда положительное. */
  amount: number
  /**
   * Чью кассу раскладываем. Деньги кассы могут лежать только на её счетах,
   * поэтому чужие в списке не показываем — иначе разнесение само создало бы
   * расхождение, которое лечит.
   */
  cashBoxId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'done'): void
}>()

const store = useAccountingStore()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const plan = ref<Record<string, number>>({})
const note = ref('')
const saving = ref(false)
const savedCount = ref(0)

/** Разносим только по живым счетам: на отключённый класть нечего. */
const accounts = computed(() =>
  store.accounts.filter(
    (a) =>
      !a.disabledAt &&
      a.balance !== null &&
      (!props.cashBoxId || a.cashBoxId === props.cashBoxId),
  ),
)

const TYPE_TITLE: Record<string, string> = {
  CASH: 'Наличные',
  BANK_CARD: 'Банки',
  PAYMENT_POINT: 'Пункты приёма',
}

const groups = computed(() => {
  const order = ['CASH', 'BANK_CARD', 'PAYMENT_POINT']
  return order
    .map((type) => ({ type, title: TYPE_TITLE[type], items: accounts.value.filter((a) => a.type === type) }))
    .filter((g) => g.items.length > 0)
})

const goal = computed(() => Math.abs(Math.round(props.amount)))

const planned = computed(() =>
  Object.values(plan.value).reduce((s, v) => s + (Number(v) || 0), 0),
)
/** Сколько ещё осталось разложить. Отрицательное — разложили больше, чем есть. */
const rest = computed(() => goal.value - planned.value)
const overflow = computed(() => rest.value < 0)

const canSave = computed(() => planned.value > 0 && !overflow.value && !saving.value)

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!isOpen) return
    plan.value = {}
    note.value = ''
    savedCount.value = 0
    if (!store.accounts.length) void store.fetchAccounts()
  },
)

// Окно могут открыть сразу с `modelValue: true` — watch тогда не сработает,
// а список счетов нужен в любом случае.
onMounted(() => { if (!store.accounts.length) void store.fetchAccounts() })

function setAmount(id: string, value: number | null) {
  if (!value) delete plan.value[id]
  else plan.value[id] = value
}

/** «Весь остаток сюда» — самый частый случай: деньги лежат в одном месте. */
function putRest(a: AccountView) {
  const current = plan.value[a.id] ?? 0
  const value = current + rest.value
  if (value <= 0) delete plan.value[a.id]
  else plan.value[a.id] = value
}

function clear() {
  plan.value = {}
}

/**
 * Записываем по счёту за раз: каждый пересчёт — отдельная запись в истории с
 * автором и комментарием, как если бы партнёр сделал их руками. Если что-то
 * упало на середине, уже записанное остаётся: деньги нигде не теряются, а
 * повторный заход покажет уже уменьшенный остаток «не разнесено».
 */
async function save() {
  if (!canSave.value) return
  saving.value = true
  savedCount.value = 0
  const comment = note.value.trim() || 'Разнесение остатков по счетам'
  try {
    for (const [accountId, add] of Object.entries(plan.value)) {
      const acc = accounts.value.find((a) => a.id === accountId)
      if (!acc || !add) continue
      await store.reconcile({
        accountId,
        actualAmount: Math.round((acc.balance ?? 0) + add),
        note: comment,
      })
      savedCount.value += 1
    }
    await store.fetchUnallocated()
    toast.success(
      savedCount.value === 1
        ? 'Остаток счёта уточнён'
        : `Остатки уточнены по ${savedCount.value} счетам`,
    )
    open.value = false
    emit('done')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось разнести деньги')
    // Часть уже записана — обновляем список, чтобы суммы на экране были живые.
    await store.fetchAccounts().catch(() => {})
    await store.fetchUnallocated().catch(() => {})
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="640" scrollable>
    <v-card rounded="lg" class="al-card">
      <div class="al-head">
        <div>
          <div class="al-title">Разнести деньги по счетам</div>
          <div class="al-sub">
            Скажите, где лежат эти деньги. Остатки счетов подтянутся к факту,
            в кассе и капитале ничего не изменится.
          </div>
        </div>
        <button class="al-close" @click="open = false">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <!-- Живой счётчик: главное число, ради которого открыли окно. -->
      <div class="al-meter" :class="{ 'al-meter--over': overflow, 'al-meter--done': rest === 0 }">
        <div class="al-meter-main">
          <div class="al-meter-label">
            <template v-if="overflow">Указано больше, чем нужно</template>
            <template v-else-if="rest === 0">Разложено полностью</template>
            <template v-else>Ещё не разнесено</template>
          </div>
          <div class="al-meter-value">{{ formatCurrency(Math.abs(rest)) }}</div>
        </div>
        <div class="al-meter-side">
          <span>из {{ formatCurrency(goal) }}</span>
          <button v-if="planned" class="al-clear" @click="clear">Сбросить</button>
        </div>
      </div>

      <div class="al-body">
        <div v-for="g in groups" :key="g.type" class="al-group">
          <div class="al-group-title">{{ g.title }}</div>
          <div v-for="a in g.items" :key="a.id" class="al-row" :class="{ 'al-row--on': !!plan[a.id] }">
            <!-- Логотип вместо цветной точки: счета выбирают по банку. -->
            <BankLogo
              :bank-name="a.bank?.name"
              :color="a.bank?.color || a.color"
              :fallback="a.code"
              :size="28"
            />
            <div class="al-row-body">
              <div class="al-row-name">{{ a.name }}</div>
              <div class="al-row-sub">
                сейчас {{ formatCurrency(a.balance ?? 0) }}
                <template v-if="plan[a.id]">
                  → станет {{ formatCurrency((a.balance ?? 0) + (plan[a.id] ?? 0)) }}
                </template>
              </div>
            </div>
            <div class="al-input-wrap">
              <input
                :value="plan[a.id] ?? ''"
                v-maska="CURRENCY_MASK"
                type="text"
                inputmode="numeric"
                class="al-input"
                placeholder="0"
                @maska="(e: any) => setAmount(a.id, parseMasked(e))"
              />
              <span class="al-input-suffix">₽</span>
            </div>
            <!-- Самый частый случай — все деньги лежат в одном месте. -->
            <button
              class="al-rest"
              :disabled="rest <= 0"
              title="Положить сюда весь нераспределённый остаток"
              @click="putRest(a)"
            >
              Весь остаток
            </button>
          </div>
        </div>

        <div v-if="!accounts.length" class="al-empty">
          Нет счетов, на которые можно положить деньги. Заведите счёт на вкладке «Баланс».
        </div>
      </div>

      <div class="al-foot">
        <div class="al-note">
          <label class="al-note-label">Комментарий к пересчёту</label>
          <input
            v-model="note"
            class="al-input al-input--wide"
            placeholder="Разнесение остатков по счетам"
          />
        </div>
        <div class="al-actions">
          <button class="al-cancel" @click="open = false">Отмена</button>
          <button class="al-confirm" :disabled="!canSave" @click="save">
            {{ saving ? 'Записываю…' : 'Разнести' }}
          </button>
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.al-card { padding: 0; }

.al-head {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 20px 24px 14px;
}
.al-title { font-size: 17px; font-weight: 700; }
.al-sub {
  font-size: 13px; line-height: 1.5; margin-top: 3px; max-width: 480px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.al-close {
  margin-left: auto; width: 32px; height: 32px; border-radius: 8px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5); cursor: pointer;
}
.al-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

/* Счётчик прилипает к верху списка: сколько осталось — видно всё время. */
.al-meter {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 14px 24px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(4, 120, 87, 0.05);
}
.al-meter--done { background: rgba(16, 185, 129, 0.12); }
.al-meter--over { background: rgba(239, 68, 68, 0.08); }
.al-meter-label { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.al-meter-value {
  font-size: 22px; font-weight: 800; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.al-meter--over .al-meter-value { color: #dc2626; }
.al-meter--done .al-meter-value { color: #047857; }
.al-meter-side {
  display: flex; align-items: center; gap: 12px;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5);
}
.al-clear {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 12.5px; font-weight: 600; color: rgb(var(--v-theme-primary));
}

.al-body { padding: 8px 24px 4px; max-height: 46vh; overflow-y: auto; }
.al-group + .al-group { margin-top: 14px; }
.al-group-title {
  font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin: 10px 0 6px;
}
.al-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 12px;
  border: 1px solid transparent;
}
.al-row + .al-row { margin-top: 4px; }
.al-row:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.al-row--on {
  background: rgba(4, 120, 87, 0.05);
  border-color: rgba(4, 120, 87, 0.25);
}
.al-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.al-row-body { flex: 1; min-width: 0; }
.al-row-name {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.al-row-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }

.al-input-wrap { position: relative; width: 132px; flex-shrink: 0; }
.al-input {
  width: 100%; height: 38px; padding: 0 26px 0 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15); border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  font-size: 14px; text-align: right; color: inherit;
  outline: none; transition: border-color 0.15s, box-shadow 0.15s;
  font-variant-numeric: tabular-nums;
}
.al-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 10%, transparent);
}
.al-input--wide { width: 100%; text-align: left; padding: 0 12px; }
.al-input-suffix {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.4);
  pointer-events: none;
}
.al-rest {
  flex-shrink: 0; padding: 8px 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; white-space: nowrap; transition: all 0.12s;
}
.al-rest:hover:not(:disabled) {
  border-color: rgba(4, 120, 87, 0.4); color: #047857;
}
.al-rest:disabled { opacity: 0.4; cursor: default; }

.al-warn {
  display: flex; align-items: center; gap: 8px;
  margin: 10px 0 4px; padding: 10px 12px; border-radius: 10px;
  background: rgba(239, 68, 68, 0.08);
  font-size: 12.5px; color: #dc2626;
}
.al-empty {
  padding: 24px 0; text-align: center; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.al-foot {
  padding: 14px 24px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.al-note-label {
  display: block; font-size: 12.5px; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.al-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.al-cancel {
  padding: 9px 16px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.al-cancel:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.al-confirm {
  padding: 9px 18px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.al-confirm:hover:not(:disabled) { background: #065f46; }
.al-confirm:disabled { opacity: 0.5; cursor: default; }
</style>
