<script setup lang="ts">
import { inlineOrToast } from '@/api/showError'
/**
 * Подтверждение отмены оплаты.
 *
 * Раньше кнопка «Отменить оплату» срабатывала с одного нажатия: промахнулся
 * строкой — и деньги ушли из кассы, доля инвесторов снялась, закрытая сделка
 * открылась. Теперь — окно: какой платёж, что произойдёт, и причина. Причина
 * пишется в журнал и видна в истории сделки: через месяц иначе не понять,
 * почему оплата исчезла.
 */
import { computed, ref, watch } from 'vue'
import type { Payment } from '@/types'
import { usePaymentsStore } from '@/stores/payments'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDateShortYear } from '@/utils/formatters'

const props = defineProps<{
  modelValue: boolean
  payment: Payment | null
  /** «iPhone 17 Pro · Тукаев Ислам» — если окно открыто не со страницы сделки. */
  dealLabel?: string | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'done', payment: Payment): void
}>()

const paymentsStore = usePaymentsStore()
const toast = useToast()
const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const PRESETS = ['Отметил по ошибке', 'Не тот платёж или сделка', 'Неверная сумма', 'Деньги не поступили']
const preset = ref<string | null>(null)
const text = ref('')
const running = ref(false)
const error = ref('')

watch(open, (v) => {
  if (!v) return
  preset.value = null
  text.value = ''
  error.value = ''
})

/** Готовая причина: вариант + уточнение своими словами. */
const reason = computed(() => [preset.value, text.value.trim()].filter(Boolean).join(' — ').slice(0, 300))
const ready = computed(() => !!props.payment && reason.value.length > 0)

const summary = computed(() => {
  const p = props.payment
  if (!p) return ''
  const paid = p.paidAt ? ` · оплачен ${formatDateShortYear(p.paidAt)}` : ''
  return `Платёж №${p.number} · ${formatCurrency(p.amount)}${paid}`
})

function pick(v: string) {
  preset.value = preset.value === v ? null : v
}

async function run() {
  const p = props.payment
  if (!p || !ready.value || running.value) return
  running.value = true
  error.value = ''
  try {
    await paymentsStore.unmarkPaid(p.id, p.dealId, reason.value)
    toast.success('Оплата отменена')
    open.value = false
    emit('done', p)
  } catch (e: any) {
    error.value = inlineOrToast(e, 'Не удалось отменить оплату. Попробуйте ещё раз.')
  } finally {
    running.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="460" :persistent="running">
    <v-card v-if="payment" rounded="lg" class="up-card">
      <div class="up-head">
        <div class="up-icon"><v-icon icon="mdi-cash-remove" size="22" /></div>
        <div class="up-head-text">
          <div class="up-title">Отменить оплату?</div>
          <div class="up-sub">{{ summary }}</div>
          <div v-if="dealLabel" class="up-sub">{{ dealLabel }}</div>
        </div>
      </div>

      <ul class="up-list">
        <li>Платёж снова станет ожидаемым — или просроченным, если срок уже прошёл.</li>
        <li>Сумма уйдёт из кассы, доход по платежу и доля инвесторов снимутся.</li>
        <li>Если сделка была завершена, она снова станет активной.</li>
      </ul>

      <div class="up-label">Причина отмены</div>
      <div class="up-presets">
        <button
          v-for="v in PRESETS"
          :key="v"
          type="button"
          class="up-chip"
          :class="{ active: preset === v }"
          :disabled="running"
          @click="pick(v)"
        >
          {{ v }}
        </button>
      </div>
      <textarea
        v-model="text"
        class="up-input"
        rows="2"
        maxlength="300"
        :disabled="running"
        :placeholder="preset ? 'Уточните, если нужно' : 'Или опишите своими словами'"
        @keydown.enter.exact.prevent="run"
      />
      <div class="up-hint">Причина сохранится в истории сделки.</div>

      <div v-if="error" class="up-error">{{ error }}</div>

      <div class="up-actions">
        <button class="up-btn up-btn--ghost" :disabled="running" @click="open = false">Не отменять</button>
        <button class="up-btn up-btn--danger" :disabled="!ready || running" @click="run">
          <v-progress-circular v-if="running" indeterminate size="15" width="2" color="white" />
          {{ running ? 'Отменяем…' : 'Отменить оплату' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.up-card { padding: 20px; }
.up-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.up-icon {
  width: 40px; height: 40px; border-radius: 11px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(239, 68, 68, 0.1); color: #dc2626;
}
.up-head-text { min-width: 0; }
.up-title { font-size: 16px; font-weight: 700; }
.up-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; }
.up-list { margin: 0 0 16px; padding-left: 18px; font-size: 13px; line-height: 1.55; color: rgba(var(--v-theme-on-surface), 0.75); }
.up-list li + li { margin-top: 3px; }
.up-label { font-size: 12.5px; font-weight: 600; margin-bottom: 8px; color: rgba(var(--v-theme-on-surface), 0.75); }
.up-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.up-chip {
  height: 30px; padding: 0 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14); background: transparent;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.8);
}
.up-chip:hover:not(:disabled) { border-color: rgba(var(--v-theme-on-surface), 0.3); }
.up-chip.active { border-color: #dc2626; background: rgba(239, 68, 68, 0.08); color: #b91c1c; font-weight: 600; }
.up-input {
  width: 100%; padding: 9px 12px; resize: vertical; min-height: 44px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14); border-radius: 10px;
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.9);
  font: inherit; font-size: 13.5px; outline: none;
}
.up-input:focus { border-color: #dc2626; }
.up-hint { font-size: 11.5px; margin-top: 4px; color: rgba(var(--v-theme-on-surface), 0.5); }
.up-error { margin-top: 10px; font-size: 12.5px; color: #dc2626; }
.up-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
.up-btn {
  display: flex; align-items: center; gap: 7px;
  height: 40px; padding: 0 16px; border: none; border-radius: 10px;
  font-size: 13.5px; font-weight: 600; cursor: pointer;
}
.up-btn:disabled { opacity: 0.5; cursor: default; }
.up-btn--ghost { background: transparent; color: rgba(var(--v-theme-on-surface), 0.65); border: 1px solid rgba(var(--v-theme-on-surface), 0.12); }
.up-btn--danger { background: #dc2626; color: #fff; }
</style>
