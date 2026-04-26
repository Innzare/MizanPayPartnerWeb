<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="(v) => emit('update:modelValue', v)"
    max-width="480"
    persistent
  >
    <v-card rounded="lg" class="cicd">
      <div class="cicd-header">
        <span class="cicd-title">Новый со-инвестор</span>
        <button class="cicd-close" @click="close">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="pa-5">
        <div class="cicd-field mb-4">
          <label class="cicd-label">Имя <span style="color: #ef4444;">*</span></label>
          <input
            ref="nameInputRef"
            v-model="form.name"
            type="text"
            class="cicd-input"
            placeholder="Фамилия Имя"
          />
        </div>

        <div class="cicd-field mb-4">
          <label class="cicd-label">Телефон</label>
          <input
            v-model="form.phone"
            v-maska="PHONE_MASK"
            type="tel"
            class="cicd-input"
            placeholder="+7 (___) ___-__-__"
          />
        </div>

        <div class="cicd-field mb-4">
          <label class="cicd-label">Капитал <span style="color: #ef4444;">*</span></label>
          <div class="cicd-input-wrap">
            <input
              :value="form.capital || ''"
              v-maska="CURRENCY_MASK"
              @maska="(e: any) => form.capital = parseMasked(e)"
              type="text"
              inputmode="numeric"
              class="cicd-input"
              placeholder="0"
            />
            <span class="cicd-suffix">₽</span>
          </div>
        </div>

        <div class="cicd-field mb-2">
          <label class="cicd-label">Процент от прибыли <span style="color: #ef4444;">*</span></label>
          <div class="cicd-presets mb-2">
            <button
              v-for="p in PERCENT_PRESETS"
              :key="p"
              class="cicd-chip"
              :class="{ 'cicd-chip--active': form.profitPercent === p }"
              @click="form.profitPercent = p"
            >
              {{ p }}%
            </button>
          </div>
          <div class="cicd-input-wrap">
            <input
              v-model.number="form.profitPercent"
              type="number"
              class="cicd-input"
              placeholder="30"
              min="1"
              max="99"
            />
            <span class="cicd-suffix">%</span>
          </div>
          <div class="cicd-hint">От 1% до 99%. Ваша доля: {{ 100 - (form.profitPercent || 0) }}%</div>
        </div>
      </div>

      <div class="cicd-actions">
        <button class="cicd-btn cicd-btn--ghost" @click="close" :disabled="saving">Отмена</button>
        <button class="cicd-btn cicd-btn--primary" @click="onSave" :disabled="saving || !canSave">
          <v-progress-circular v-if="saving" indeterminate size="16" width="2" color="white" class="mr-2" />
          Создать
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch, nextTick } from 'vue'
import { vMaska } from 'maska/vue'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useToast } from '@/composables/useToast'
import { PHONE_MASK, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import type { CoInvestor } from '@/types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'created', coInvestor: CoInvestor): void
}>()

const { createCoInvestor } = useCoInvestors()
const { show: showToast } = useToast()

const PERCENT_PRESETS = [10, 20, 30, 40, 50]

const form = reactive({ name: '', phone: '', capital: 0, profitPercent: 30 })
const saving = ref(false)
const nameInputRef = ref<HTMLInputElement | null>(null)

const canSave = computed(
  () => !!form.name.trim() && form.capital > 0 && form.profitPercent >= 1 && form.profitPercent <= 99,
)

watch(() => props.modelValue, (open) => {
  if (open) {
    form.name = ''
    form.phone = ''
    form.capital = 0
    form.profitPercent = 30
    nextTick(() => nameInputRef.value?.focus())
  }
})

function close() {
  emit('update:modelValue', false)
}

async function onSave() {
  if (!canSave.value) return
  saving.value = true
  try {
    const created = await createCoInvestor({
      name: form.name.trim(),
      phone: form.phone || undefined,
      capital: form.capital,
      profitPercent: form.profitPercent,
    })
    showToast('Со-инвестор создан', 'success')
    emit('created', created)
    close()
  } catch (e: any) {
    showToast(e.message || 'Не удалось создать со-инвестора', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.cicd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.cicd-title { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.cicd-close {
  width: 30px; height: 30px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.cicd-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

.cicd-field { }
.cicd-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.cicd-input-wrap { position: relative; display: flex; align-items: center; }
.cicd-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: border-color 0.15s;
  font-family: inherit; box-sizing: border-box;
}
.cicd-input:focus { border-color: #047857; }
.cicd-input-wrap .cicd-input { padding-right: 36px; }
.cicd-suffix {
  position: absolute; right: 14px;
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}
.cicd-hint {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 6px;
}

.cicd-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.cicd-chip {
  padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s;
}
.cicd-chip:hover { border-color: #047857; color: #047857; }
.cicd-chip--active {
  background: #047857; color: #fff; border-color: #047857;
}

.cicd-actions {
  display: flex; gap: 8px;
  padding: 12px 20px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  justify-content: flex-end;
}
.cicd-btn {
  padding: 10px 18px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 500; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all 0.15s; font-family: inherit;
}
.cicd-btn--ghost {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.cicd-btn--ghost:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.1); }
.cicd-btn--primary {
  background: #047857; color: #fff;
}
.cicd-btn--primary:hover:not(:disabled) { background: #065f46; }
.cicd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
