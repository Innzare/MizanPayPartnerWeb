<script setup lang="ts">
/**
 * Лимиты счёта.
 *
 * Раньше это была раскрывающаяся секция в настройках счёта: семь полей подряд,
 * где пустое значение молча означало «ограничения нет». Понять по такой форме,
 * что именно сейчас включено, было нельзя.
 *
 * Здесь у каждого правила свой переключатель, а внизу — та же настройка
 * словами: партнёр читает вслух, что получилось, и видит ошибку до сохранения.
 *
 * Окно работает в двух режимах. С `account` — сохраняет лимиты сразу (его
 * открывают из меню счёта). Без него — отдаёт значения наверх через
 * `update:limits`: так его открывают поверх формы нового счёта, где сохранять
 * ещё нечего.
 */
import { computed, ref, watch } from 'vue'
import { useAccountingStore, type AccountLimits, type AccountView } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { CURRENCY_MASK, parseMasked, formatCurrency } from '@/utils/formatters'

const props = defineProps<{
  modelValue: boolean
  /** Счёт, если лимиты правят у существующего. */
  account?: AccountView | null
  /** Стартовые значения, если счёт ещё не создан. */
  limits?: AccountLimits | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'update:limits', v: AccountLimits): void
  (e: 'saved'): void
}>()

const store = useAccountingStore()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

function blank(): AccountLimits {
  return {
    perOpMax: null,
    w1Days: 5,
    w1SumMax: null,
    w1CountMax: null,
    w2Days: 30,
    w2SumMax: null,
    w2CountMax: null,
    warnPct: 80,
  }
}

const form = ref<AccountLimits>(blank())
/** Включённость правил — отдельно от значений: выключил и не потерял цифры. */
const on = ref({ perOp: false, w1: false, w2: false })
const saving = ref(false)

/** Читаем лимиты счёта (или переданные значения) в форму окна. */
function fill() {
  const src = props.account?.limits ?? props.limits ?? null
  form.value = src ? { ...blank(), ...src } : blank()
  on.value = {
    perOp: form.value.perOpMax != null,
    w1: form.value.w1SumMax != null || form.value.w1CountMax != null,
    w2: form.value.w2SumMax != null || form.value.w2CountMax != null,
  }
}

// Окно открывается заново при каждом показе, но может быть смонтировано уже
// открытым — тогда watch не сработает, а поля обязаны быть заполнены.
watch(() => props.modelValue, (isOpen) => { if (isOpen) fill() }, { immediate: true })

// Выключенное правило не должно тихо сохраниться: гасим его значения сразу,
// иначе сервер получит лимит, которого партнёр уже не видит на экране.
watch(() => on.value.perOp, (v) => { if (!v) form.value.perOpMax = null })
watch(() => on.value.w1, (v) => { if (!v) { form.value.w1SumMax = null; form.value.w1CountMax = null } })
watch(() => on.value.w2, (v) => { if (!v) { form.value.w2SumMax = null; form.value.w2CountMax = null } })

const anyLimit = computed(
  () => form.value.perOpMax != null || form.value.w1SumMax != null || form.value.w1CountMax != null
    || form.value.w2SumMax != null || form.value.w2CountMax != null,
)

/** «12 переводов», «2 перевода», «1 перевод» — иначе получается «перевод(ов)». */
function pluralTransfers(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'переводов'
  const mod10 = n % 10
  if (mod10 === 1) return 'перевод'
  if (mod10 >= 2 && mod10 <= 4) return 'перевода'
  return 'переводов'
}

function windowText(days: number, sum: number | null, count: number | null): string {
  const parts: string[] = []
  if (sum != null) parts.push(`не больше ${formatCurrency(sum)}`)
  if (count != null) parts.push(`не больше ${count} ${pluralTransfers(count)}`)
  return `За ${days} дн. — ${parts.join(' и ')}`
}

/** Та же настройка словами: читается вслух и сразу видно, если чушь. */
const summary = computed(() => {
  const lines: string[] = []
  if (form.value.perOpMax != null) {
    lines.push(`Одна операция — не больше ${formatCurrency(form.value.perOpMax)}`)
  }
  if (on.value.w1 && (form.value.w1SumMax != null || form.value.w1CountMax != null)) {
    lines.push(windowText(form.value.w1Days, form.value.w1SumMax, form.value.w1CountMax))
  }
  if (on.value.w2 && (form.value.w2SumMax != null || form.value.w2CountMax != null)) {
    lines.push(windowText(form.value.w2Days, form.value.w2SumMax, form.value.w2CountMax))
  }
  return lines
})

/** Окна одинаковой длины — почти наверняка описка: скажем об этом до сохранения. */
const sameWindows = computed(
  () => on.value.w1 && on.value.w2 && form.value.w1Days === form.value.w2Days,
)

function reset() {
  form.value = blank()
  on.value = { perOp: false, w1: false, w2: false }
}

async function save() {
  // Без счёта сохранять нечего: значения забирает форма нового счёта.
  if (!props.account) {
    emit('update:limits', { ...form.value })
    open.value = false
    return
  }
  saving.value = true
  try {
    await store.updateAccount(props.account.id, { limits: { ...form.value } })
    toast.success(anyLimit.value ? 'Лимиты сохранены' : 'Лимиты сняты')
    open.value = false
    emit('saved')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить лимиты')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" scrollable>
    <v-card rounded="lg" class="lm-card">
      <div class="lm-head">
        <div>
          <div class="lm-title">Лимиты счёта</div>
          <div class="lm-sub">
            <template v-if="account">«{{ account.name }}» — </template>
            ограничения на переводы: помогают не упереться в банковский потолок
            неожиданно, посреди рабочего дня.
          </div>
        </div>
        <button class="lm-close" @click="open = false">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="lm-body">
        <!-- Правило 1: одна операция -->
        <div class="lm-rule" :class="{ 'lm-rule--on': on.perOp }">
          <label class="lm-rule-head">
            <input v-model="on.perOp" type="checkbox" class="lm-check" />
            <span class="lm-rule-title">Ограничить одну операцию</span>
            <span class="lm-rule-hint">Больше этой суммы за раз не провести</span>
          </label>
          <div v-if="on.perOp" class="lm-rule-body">
            <div class="lm-field">
              <label class="lm-label">Максимум за операцию</label>
              <div class="lm-input-wrap">
                <input
                  :value="form.perOpMax || ''"
                  v-maska="CURRENCY_MASK"
                  type="text"
                  inputmode="numeric"
                  class="lm-input"
                  placeholder="100 000"
                  @maska="(e: any) => form.perOpMax = parseMasked(e)"
                />
                <span class="lm-input-suffix">₽</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Правило 2 и 3: скользящие окна -->
        <div class="lm-rule" :class="{ 'lm-rule--on': on.w1 }">
          <label class="lm-rule-head">
            <input v-model="on.w1" type="checkbox" class="lm-check" />
            <span class="lm-rule-title">Ограничить короткий период</span>
            <span class="lm-rule-hint">Например, сколько уходит за несколько дней</span>
          </label>
          <div v-if="on.w1" class="lm-rule-body">
            <div class="lm-days">
              За последние
              <input v-model.number="form.w1Days" type="number" min="1" max="365" class="lm-days-input" />
              дней
            </div>
            <div class="lm-two">
              <div class="lm-field">
                <label class="lm-label">Сумма переводов</label>
                <div class="lm-input-wrap">
                  <input
                    :value="form.w1SumMax || ''"
                    v-maska="CURRENCY_MASK"
                    type="text"
                    inputmode="numeric"
                    class="lm-input"
                    placeholder="без ограничения"
                    @maska="(e: any) => form.w1SumMax = parseMasked(e)"
                  />
                  <span class="lm-input-suffix">₽</span>
                </div>
              </div>
              <div class="lm-field">
                <label class="lm-label">Количество переводов</label>
                <input
                  v-model.number="form.w1CountMax"
                  type="number"
                  min="1"
                  class="lm-input"
                  placeholder="без ограничения"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="lm-rule" :class="{ 'lm-rule--on': on.w2 }">
          <label class="lm-rule-head">
            <input v-model="on.w2" type="checkbox" class="lm-check" />
            <span class="lm-rule-title">Ограничить длинный период</span>
            <span class="lm-rule-hint">Обычно месяц — как считает банк</span>
          </label>
          <div v-if="on.w2" class="lm-rule-body">
            <div class="lm-days">
              За последние
              <input v-model.number="form.w2Days" type="number" min="1" max="365" class="lm-days-input" />
              дней
            </div>
            <div class="lm-two">
              <div class="lm-field">
                <label class="lm-label">Сумма переводов</label>
                <div class="lm-input-wrap">
                  <input
                    :value="form.w2SumMax || ''"
                    v-maska="CURRENCY_MASK"
                    type="text"
                    inputmode="numeric"
                    class="lm-input"
                    placeholder="без ограничения"
                    @maska="(e: any) => form.w2SumMax = parseMasked(e)"
                  />
                  <span class="lm-input-suffix">₽</span>
                </div>
              </div>
              <div class="lm-field">
                <label class="lm-label">Количество переводов</label>
                <input
                  v-model.number="form.w2CountMax"
                  type="number"
                  min="1"
                  class="lm-input"
                  placeholder="без ограничения"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Порог предупреждения: полезен, только когда лимиты вообще есть. -->
        <div v-if="anyLimit" class="lm-warn">
          <div class="lm-warn-head">
            <span class="lm-label">Предупреждать при заполнении</span>
            <span class="lm-warn-value">{{ form.warnPct }}%</span>
          </div>
          <input v-model.number="form.warnPct" type="range" min="50" max="100" step="5" class="lm-range" />
          <div class="lm-warn-hint">
            Счёт начнёт подсвечиваться, когда израсходовано столько от лимита
          </div>
        </div>

        <!-- Настройка словами: последняя проверка перед сохранением. -->
        <div class="lm-summary" :class="{ 'lm-summary--empty': !summary.length }">
          <div class="lm-summary-title">Что получится</div>
          <template v-if="summary.length">
            <div v-for="(line, i) in summary" :key="i" class="lm-summary-line">
              <v-icon icon="mdi-check" size="14" />
              {{ line }}
            </div>
          </template>
          <div v-else class="lm-summary-line lm-summary-line--dim">
            Ограничений нет — переводы по счёту ничем не сдерживаются
          </div>
          <div v-if="sameWindows" class="lm-summary-warn">
            <v-icon icon="mdi-alert-outline" size="14" />
            Оба периода по {{ form.w1Days }} дн. — вероятно, вы хотели указать разные
          </div>
        </div>
      </div>

      <div class="lm-actions">
        <button v-if="anyLimit" class="lm-reset" @click="reset">Снять все лимиты</button>
        <v-spacer />
        <button class="lm-cancel" @click="open = false">Отмена</button>
        <button class="lm-confirm" :disabled="saving" @click="save">
          {{ saving ? 'Сохраняю…' : 'Сохранить' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.lm-card { padding: 0; }

.lm-head { display: flex; align-items: flex-start; gap: 12px; padding: 20px 24px 12px; }
.lm-title { font-size: 17px; font-weight: 700; }
.lm-sub {
  font-size: 13px; line-height: 1.5; margin-top: 3px; max-width: 430px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.lm-close {
  margin-left: auto; width: 32px; height: 32px; border-radius: 8px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5); cursor: pointer;
}
.lm-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

.lm-body { padding: 4px 24px 8px; max-height: 60vh; overflow-y: auto; }

/* Правило — отдельная карточка с переключателем: видно, что включено. */
.lm-rule {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  padding: 12px 14px;
}
.lm-rule + .lm-rule { margin-top: 10px; }
.lm-rule--on { border-color: rgba(4, 120, 87, 0.35); background: rgba(4, 120, 87, 0.03); }
.lm-rule-head {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  align-items: center;
  cursor: pointer;
}
.lm-check { grid-row: span 2; width: 17px; height: 17px; accent-color: #047857; cursor: pointer; }
.lm-rule-title { font-size: 14px; font-weight: 600; }
.lm-rule-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.lm-rule-body { margin-top: 12px; padding-left: 27px; }

.lm-field { display: flex; flex-direction: column; gap: 5px; }
.lm-label { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); }
.lm-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
.lm-input-wrap { position: relative; }
.lm-input {
  width: 100%; height: 38px; padding: 0 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15); border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  font-size: 14px; color: inherit; outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.lm-input-wrap .lm-input { padding-right: 26px; }
.lm-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 10%, transparent);
}
.lm-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.32); }
.lm-input-suffix {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.4); pointer-events: none;
}

.lm-days {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7);
}
.lm-days-input {
  width: 64px; height: 34px; padding: 0 8px; text-align: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15); border-radius: 8px;
  background: rgb(var(--v-theme-surface)); font-size: 14px; color: inherit; outline: none;
}
.lm-days-input:focus { border-color: #047857; }

.lm-warn {
  margin-top: 14px; padding: 12px 14px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.lm-warn-head { display: flex; align-items: center; justify-content: space-between; }
.lm-warn-value { font-size: 14px; font-weight: 700; color: #047857; }
.lm-range { width: 100%; margin-top: 8px; accent-color: #047857; }
.lm-warn-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 4px; }

.lm-summary {
  margin-top: 14px; padding: 12px 14px; border-radius: 12px;
  background: rgba(4, 120, 87, 0.06);
}
.lm-summary--empty { background: rgba(var(--v-theme-on-surface), 0.04); }
.lm-summary-title {
  font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 6px;
}
.lm-summary-line {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.8);
}
.lm-summary-line + .lm-summary-line { margin-top: 3px; }
.lm-summary-line--dim { color: rgba(var(--v-theme-on-surface), 0.5); }
.lm-summary-warn {
  display: flex; align-items: center; gap: 6px; margin-top: 8px;
  font-size: 12.5px; color: #b45309;
}

.lm-actions {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 24px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.lm-reset {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55);
}
.lm-reset:hover { color: #dc2626; }
.lm-cancel {
  padding: 9px 16px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.lm-cancel:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.lm-confirm {
  padding: 9px 18px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.lm-confirm:hover:not(:disabled) { background: #065f46; }
.lm-confirm:disabled { opacity: 0.5; cursor: default; }
</style>
