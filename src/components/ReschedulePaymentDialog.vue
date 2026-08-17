<script setup lang="ts">
/**
 * Перенос даты платежа — единая модалка для всех разделов.
 *
 * Логика и вид перенесены со страницы сделки и страницы платежей: там жили две
 * копии одного диалога, и правка в одной не доезжала до другой. Теперь перенос
 * открывается одинаково откуда угодно — со страницы платежей, со страницы
 * сделки и из превью сделки в списке.
 *
 * Обновление списков остаётся за страницей: событие `rescheduled` несёт id
 * сделки, а что перечитать — знает только она.
 */
import { computed, ref, watch } from 'vue'
import { usePaymentsStore } from '@/stores/payments'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDate } from '@/utils/formatters'
import type { Deal, Payment } from '@/types'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** Платёж, который переносим. */
    payment: Payment | null
    /**
     * Сделка платежа. Передана — в шапке видно, к какому договору он относится.
     * Нужно там, где в списке перемешаны сделки (страница платежей); внутри
     * самой сделки строка была бы лишней.
     */
    deal?: Deal | null
    fullscreen?: boolean
  }>(),
  { deal: null, fullscreen: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** Дата перенесена. Страница сама решает, что обновить. */
  (e: 'rescheduled', dealId: string): void
}>()

const paymentsStore = usePaymentsStore()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const newDate = ref('')
const reason = ref('')
const submitting = ref(false)

const REASON_OPTIONS = [
  'Клиент попросил отсрочку',
  'Задержка зарплаты клиента',
  'По договорённости сторон',
  'Другая причина',
]

/** Переносить можно только вперёд — минимум на завтра. */
const minDate = computed(() => {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.toISOString().slice(0, 10)
})

// Сброс при каждом открытии: иначе в модалку протекали бы дата и причина от
// предыдущего платежа.
watch(
  () => [props.modelValue, props.payment?.id],
  ([isOpen]) => {
    if (!isOpen || !props.payment) return
    // По умолчанию — неделя от текущего срока: самый частый шаг переноса.
    const d = new Date(props.payment.dueDate)
    d.setDate(d.getDate() + 7)
    newDate.value = d.toISOString().slice(0, 10)
    reason.value = ''
  },
  { immediate: true },
)

async function confirm() {
  const target = props.payment
  if (!target || !newDate.value || submitting.value) return
  submitting.value = true
  try {
    await paymentsStore.reschedulePayment(
      target.id,
      target.dealId,
      new Date(newDate.value).toISOString(),
      reason.value || undefined,
    )
    toast.success('Платёж перенесён')
    open.value = false
    emit('rescheduled', target.dealId)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при переносе платежа')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="460" :fullscreen="fullscreen">
    <v-card rounded="lg" class="pa-6">
      <button class="dialog-close-sm" @click="open = false">
        <v-icon icon="mdi-close" size="18" />
      </button>

      <div class="text-h6 font-weight-bold mb-1">Перенос платежа</div>
      <div class="text-caption text-medium-emphasis mb-5">Выберите новую дату и укажите причину</div>

      <div v-if="payment" class="reschedule-info mb-5">
        <div v-if="deal" class="d-flex justify-space-between mb-1">
          <span class="text-caption text-medium-emphasis">Сделка</span>
          <span class="text-truncate ml-4">{{ deal.productName }}</span>
        </div>
        <div class="d-flex justify-space-between mb-1">
          <span class="text-caption text-medium-emphasis">Платёж #{{ payment.number }}</span>
          <span class="font-weight-bold">{{ formatCurrency(payment.amount) }}</span>
        </div>
        <div class="d-flex justify-space-between">
          <span class="text-caption text-medium-emphasis">Текущая дата</span>
          <span :class="{ 'text-error': payment.status === 'OVERDUE' }">
            {{ formatDate(payment.dueDate) }}
          </span>
        </div>
      </div>

      <div class="mb-4">
        <label class="field-label">Новая дата</label>
        <input v-model="newDate" type="date" :min="minDate" class="field-input" />
      </div>

      <div class="mb-5">
        <label class="field-label">Причина</label>
        <div class="d-flex flex-wrap ga-2 mb-3">
          <button
            v-for="opt in REASON_OPTIONS"
            :key="opt"
            class="reason-chip"
            :class="{ active: reason === opt }"
            @click="reason = reason === opt ? '' : opt"
          >
            {{ opt }}
          </button>
        </div>
        <textarea
          v-if="reason === 'Другая причина'"
          v-model="reason"
          placeholder="Опишите причину..."
          class="field-input"
          rows="2"
        />
      </div>

      <div class="d-flex ga-3">
        <button class="btn-secondary flex-grow-1" @click="open = false">Отмена</button>
        <button
          class="btn-primary flex-grow-1"
          :disabled="!newDate || submitting"
          @click="confirm"
        >
          <v-progress-circular v-if="submitting" indeterminate size="16" width="2" color="white" class="mr-2" />
          Перенести
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Цвета — на theme-переменных: диалог уезжает в body, и .dark-селектор
   страницы до него не достаёт (см. styles/forms.css). */
.dialog-close-sm {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
}
.dialog-close-sm:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

.reschedule-info {
  padding: 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

.field-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.field-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none; resize: vertical;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-family: inherit;
  transition: border-color 0.15s;
}
.field-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.3); }
.field-input:focus { border-color: #047857; }

.reason-chip {
  padding: 6px 14px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 13px; cursor: pointer; transition: all 0.15s;
}
.reason-chip:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.reason-chip.active { background: rgba(4, 120, 87, 0.1); color: #047857; font-weight: 500; }

.btn-primary {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 12px 20px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #065f46; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 12px 20px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500; cursor: pointer;
  transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
</style>
