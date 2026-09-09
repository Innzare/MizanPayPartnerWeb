<script setup lang="ts">
/**
 * Пересчёт денег на счёте.
 *
 * Человек считает наличные в сейфе или смотрит остаток в банке и вписывает,
 * сколько там на самом деле. Расхождение не прячется: остаток счёта
 * подтягивается к факту, а недостача или излишек остаётся в истории с датой
 * и автором — иначе через месяц не понять, когда деньги разошлись.
 *
 * Кассы и капитала это не касается: денег в бизнесе не стало больше или
 * меньше, уточнилось, сколько их лежит в этом месте.
 */
import { computed, ref, watch } from 'vue'
import { useAccountingStore, type AccountView } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { CURRENCY_MASK, parseMasked, formatCurrency } from '@/utils/formatters'

const props = defineProps<{
  modelValue: boolean
  account: AccountView | null
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

const actual = ref<number | null>(null)
const note = ref('')
const saving = ref(false)

const expected = computed(() => props.account?.balance ?? 0)
const delta = computed(() => (actual.value === null ? null : Math.round(actual.value - expected.value)))

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!isOpen) return
    actual.value = null
    note.value = ''
  },
)

async function save() {
  if (!props.account || actual.value === null) return
  saving.value = true
  try {
    await store.reconcile({
      accountId: props.account.id,
      actualAmount: actual.value,
      note: note.value.trim() || undefined,
    })
    toast.success(delta.value === 0 ? 'Пересчёт записан: всё сошлось' : 'Пересчёт записан')
    open.value = false
    emit('done')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось записать пересчёт')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="440">
    <v-card rounded="lg" class="rc-card">
      <div class="rc-title">Пересчёт денег</div>
      <div class="rc-sub">
        Счёт «{{ account?.name }}». Впишите, сколько денег там на самом деле —
        остаток подтянется к факту, а расхождение останется в истории.
      </div>

      <div class="rc-expected">
        <span>По учёту сейчас</span>
        <b>{{ formatCurrency(expected) }}</b>
      </div>

      <div class="rc-field">
        <label class="rc-label">Пересчитано на самом деле</label>
        <div class="rc-suffix-wrap">
          <input
            :value="actual ?? ''"
            v-maska="CURRENCY_MASK"
            type="text"
            inputmode="numeric"
            class="rc-input"
            @maska="(e: any) => actual = parseMasked(e)"
          />
          <span class="rc-suffix">₽</span>
        </div>
      </div>

      <!-- Итог пересчёта: сразу видно, недостача это или излишек -->
      <div
        v-if="delta !== null"
        class="rc-delta"
        :class="delta === 0 ? 'rc-delta--ok' : delta < 0 ? 'rc-delta--minus' : 'rc-delta--plus'"
      >
        <v-icon
          :icon="delta === 0 ? 'mdi-check-circle-outline' : delta < 0 ? 'mdi-arrow-down-circle-outline' : 'mdi-arrow-up-circle-outline'"
          size="18"
        />
        <span v-if="delta === 0">Всё сошлось — расхождения нет</span>
        <span v-else-if="delta < 0">Недостача {{ formatCurrency(Math.abs(delta)) }}</span>
        <span v-else>Излишек {{ formatCurrency(delta) }}</span>
      </div>

      <div class="rc-field">
        <label class="rc-label">Комментарий</label>
        <input v-model="note" class="rc-input" placeholder="Пересчёт в конце смены" />
        <div v-if="delta !== null && delta !== 0" class="rc-hint">
          Напишите, откуда расхождение, пока помните: через месяц это уже не восстановить.
        </div>
      </div>

      <div class="rc-actions">
        <button class="rc-cancel" @click="open = false">Отмена</button>
        <button class="rc-confirm" :disabled="actual === null || saving" @click="save">
          {{ saving ? 'Записываю…' : 'Записать пересчёт' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.rc-card { padding: 22px 24px 18px; }
.rc-title { font-size: 17px; font-weight: 700; }
.rc-sub {
  font-size: 12.5px; line-height: 1.5; margin-top: 5px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.rc-expected {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 16px; padding: 11px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.7);
}
.rc-field { margin-top: 16px; }
.rc-label {
  display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.rc-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.rc-input:focus { border-color: #047857; }
.rc-suffix-wrap { position: relative; }
.rc-suffix-wrap .rc-input { padding-right: 34px; }
.rc-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600; pointer-events: none;
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.rc-hint {
  font-size: 11.5px; line-height: 1.45; margin-top: 5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.rc-delta {
  display: flex; align-items: center; gap: 8px;
  margin-top: 14px; padding: 11px 14px; border-radius: 10px;
  font-size: 13.5px; font-weight: 600;
}
.rc-delta--ok { background: rgba(16, 185, 129, 0.1); color: #047857; }
.rc-delta--minus { background: rgba(239, 68, 68, 0.1); color: #b91c1c; }
.rc-delta--plus { background: rgba(245, 158, 11, 0.12); color: #b45309; }

.rc-actions { display: flex; gap: 10px; margin-top: 20px; }
.rc-cancel, .rc-confirm {
  flex: 1; padding: 11px 16px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.rc-cancel {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500;
}
.rc-confirm { background: #047857; color: #fff; }
.rc-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
