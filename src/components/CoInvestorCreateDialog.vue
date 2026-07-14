<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="(v) => emit('update:modelValue', v)"
    max-width="480"
    persistent
    :fullscreen="isMobile"
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
          <label class="cicd-label">Доля прибыли <span style="color: #ef4444;">*</span></label>
          <div class="cicd-mode-toggle mb-3">
            <button
              type="button"
              class="cicd-mode-btn"
              :class="{ 'cicd-mode-btn--active': form.mode === 'fixed' }"
              @click="form.mode = 'fixed'"
            >
              <v-icon icon="mdi-handshake-outline" size="14" />
              Фикс. процент
            </button>
            <button
              type="button"
              class="cicd-mode-btn"
              :class="{ 'cicd-mode-btn--active': form.mode === 'weight' }"
              @click="form.mode = 'weight'"
            >
              <v-icon icon="mdi-scale-balance" size="14" />
              По капиталу
            </button>
          </div>

          <template v-if="form.mode === 'fixed'">
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
            <div class="cicd-hint">От 1% до 99%. Этот процент со-инвестор будет забирать с каждой сделки кассы первым.</div>
          </template>

          <div v-else class="cicd-hint cicd-hint--info">
            <v-icon icon="mdi-information-outline" size="14" />
            Со-инвестор получит долю пропорционально вложенному капиталу — из остатка после со-инвесторов с фиксированным процентом.
          </div>
        </div>

        <!-- Комиссия партнёра — только для доли по капиталу. -->
        <div v-if="form.mode === 'weight'" class="cicd-field mt-4">
          <label class="cicd-label">Комиссия партнёра</label>
          <div class="cicd-presets mb-2">
            <button
              v-for="p in FEE_PRESETS"
              :key="p"
              class="cicd-chip"
              :class="{ 'cicd-chip--active': form.managementFeePct === p }"
              @click="form.managementFeePct = p"
            >
              {{ p }}%
            </button>
          </div>
          <div class="cicd-input-wrap">
            <input
              v-model.number="form.managementFeePct"
              type="number"
              class="cicd-input"
              placeholder="0"
              min="0"
              max="100"
            />
            <span class="cicd-suffix">%</span>
          </div>
          <div class="cicd-hint">
            Сколько вы забираете с доли этого со-инвестора по вкладу. 0% — делите чисто по капиталу; 50% — половину его расчётной доли забираете себе за управление.
          </div>
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
import { useIsMobile } from '@/composables/useIsMobile'
import { PHONE_MASK, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import type { CoInvestor } from '@/types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'created', coInvestor: CoInvestor): void
}>()

const { createCoInvestor } = useCoInvestors()
const { show: showToast } = useToast()
const { isMobile } = useIsMobile()

const PERCENT_PRESETS = [10, 20, 30, 40, 50]
const FEE_PRESETS = [0, 20, 30, 50]

const form = reactive<{
  name: string
  phone: string
  capital: number
  mode: 'fixed' | 'weight'
  profitPercent: number
  managementFeePct: number
}>({ name: '', phone: '', capital: 0, mode: 'fixed', profitPercent: 30, managementFeePct: 0 })
const saving = ref(false)
const nameInputRef = ref<HTMLInputElement | null>(null)

const canSave = computed(() => {
  if (!form.name.trim() || form.capital <= 0) return false
  if (form.mode === 'fixed') return form.profitPercent >= 1 && form.profitPercent <= 99
  return true
})

watch(() => props.modelValue, (open) => {
  if (open) {
    form.name = ''
    form.phone = ''
    form.capital = 0
    form.mode = 'fixed'
    form.profitPercent = 30
    form.managementFeePct = 0
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
      profitPercent: form.mode === 'fixed' ? form.profitPercent : null,
      // Commission only meaningful for by-capital share; fixed-% is already final.
      managementFeePct: form.mode === 'weight' ? (form.managementFeePct || 0) : 0,
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

.cicd-mode-toggle {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 4px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 10px;
}
.cicd-mode-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 10px; border-radius: 7px; border: none;
  background: transparent;
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.cicd-mode-btn:hover { color: rgba(var(--v-theme-on-surface), 0.85); }
.cicd-mode-btn--active {
  background: rgb(var(--v-theme-surface));
  color: #047857;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
.cicd-hint--info {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 10px 12px;
  background: rgba(14, 165, 233, 0.08);
  border: 1px solid rgba(14, 165, 233, 0.2);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.75);
  line-height: 1.4;
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
