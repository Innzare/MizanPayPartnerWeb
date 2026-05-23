<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import { useCashBoxesStore } from '@/stores/cashboxes'
import type { CashBoxSummary } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useIsMobile } from '@/composables/useIsMobile'

const props = defineProps<{
  modelValue: boolean
  /** Editing? Pass the existing cashbox. Omit to create a new one. */
  cashbox?: CashBoxSummary | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved', box: CashBoxSummary): void
}>()

const store = useCashBoxesStore()
const toast = useToast()
const { isDark } = useIsDark()
const { isMobile } = useIsMobile()

const isEdit = computed(() => !!props.cashbox)

const name = ref('')
const color = ref('#3b82f6')
const icon = ref('mdi-wallet-outline')
const initialCapital = ref<number | null>(null)
const submitting = ref(false)

// Palette of preset colors + icons — consistent with deal folders
const PRESET_COLORS = [
  '#3b82f6', // blue (default)
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#6366f1', // indigo
  '#84cc16', // lime
  '#737373', // neutral
]

const PRESET_ICONS = [
  'mdi-wallet-outline',
  'mdi-bank-outline',
  'mdi-cash-multiple',
  'mdi-piggy-bank-outline',
  'mdi-safe-square-outline',
  'mdi-account-cash-outline',
  'mdi-credit-card-outline',
  'mdi-handshake-outline',
  'mdi-home-outline',
  'mdi-account-group-outline',
]

// Initialize fields when opening
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    if (props.cashbox) {
      name.value = props.cashbox.name
      color.value = props.cashbox.color
      icon.value = props.cashbox.icon
      initialCapital.value = props.cashbox.initialCapital
    } else {
      name.value = ''
      color.value = '#3b82f6'
      icon.value = 'mdi-wallet-outline'
      initialCapital.value = null
    }
  },
)

async function handleSave() {
  const trimmed = name.value.trim()
  if (!trimmed) {
    toast.error('Введите название кассы')
    return
  }
  submitting.value = true
  try {
    const payload = {
      name: trimmed,
      color: color.value,
      icon: icon.value,
      initialCapital: initialCapital.value ?? 0,
    }
    const box = props.cashbox
      ? await store.update(props.cashbox.id, payload)
      : await store.create(payload)
    toast.success(isEdit.value ? 'Касса обновлена' : 'Касса создана')
    emit('saved', box)
    emit('update:modelValue', false)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось сохранить')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="(v) => emit('update:modelValue', v)"
    max-width="520"
    persistent
    :fullscreen="isMobile"
  >
    <v-card rounded="lg" :class="{ 'cb-dialog': true, dark: isDark }">
      <div class="cb-header">
        <div class="cb-header-icon" :style="{ background: color + '22', color }">
          <v-icon :icon="icon" size="22" />
        </div>
        <div class="cb-header-text">
          <div class="cb-title">{{ isEdit ? 'Изменить кассу' : 'Новая касса' }}</div>
          <div class="cb-subtitle">
            {{ isEdit ? 'Поменяйте название, цвет, иконку или капитал' : 'Создайте отдельный кошелёк' }}
          </div>
        </div>
        <button class="cb-close" @click="emit('update:modelValue', false)">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="cb-body">
        <!-- Live preview -->
        <div class="cb-preview" :style="{ borderColor: color + '40', background: color + '08' }">
          <div class="cb-preview-icon" :style="{ background: color + '20', color }">
            <v-icon :icon="icon" size="20" />
          </div>
          <div class="cb-preview-text">
            <div class="cb-preview-name">{{ name.trim() || 'Название кассы' }}</div>
            <div class="cb-preview-meta">
              Начальный капитал · {{ (initialCapital ?? 0).toLocaleString('ru-RU') }} ₽
            </div>
          </div>
        </div>

        <!-- Fields -->
        <div class="cb-field">
          <label class="cb-label">Название *</label>
          <v-text-field
            v-model="name"
            placeholder="Например: Семейная или Касса с Мусой"
            variant="outlined"
            density="compact"
            hide-details
            maxlength="50"
            :class="{ 'cb-input': true, dark: isDark }"
          />
        </div>

        <div class="cb-field">
          <label class="cb-label">Начальный капитал</label>
          <v-text-field
            :model-value="initialCapital === null ? '' : initialCapital.toLocaleString('ru-RU')"
            @update:model-value="(v: string) => initialCapital = parseInt(String(v).replace(/\D/g, ''), 10) || null"
            placeholder="0"
            variant="outlined"
            density="compact"
            hide-details
            suffix="₽"
            :class="{ 'cb-input': true, dark: isDark }"
          />
          <div class="cb-hint">
            Сумма с которой начинает работать касса. Если касса для конкретного партнёра — введите ту сумму, что он внёс.
          </div>
        </div>

        <div class="cb-field">
          <label class="cb-label">Цвет</label>
          <div class="cb-palette">
            <button
              v-for="c in PRESET_COLORS"
              :key="c"
              class="cb-swatch"
              :class="{ active: color === c }"
              :style="{ background: c }"
              @click="color = c"
            >
              <v-icon v-if="color === c" icon="mdi-check" size="14" color="#fff" />
            </button>
          </div>
        </div>

        <div class="cb-field">
          <label class="cb-label">Иконка</label>
          <div class="cb-icons">
            <button
              v-for="ic in PRESET_ICONS"
              :key="ic"
              class="cb-icon-btn"
              :class="{ active: icon === ic }"
              :style="icon === ic ? { background: color + '20', color, borderColor: color + '60' } : {}"
              @click="icon = ic"
            >
              <v-icon :icon="ic" size="20" />
            </button>
          </div>
        </div>
      </div>

      <div class="cb-footer">
        <button class="cb-btn cb-btn--ghost" @click="emit('update:modelValue', false)" :disabled="submitting">
          Отмена
        </button>
        <button class="cb-btn cb-btn--primary" :disabled="submitting" @click="handleSave">
          <v-progress-circular v-if="submitting" indeterminate size="16" width="2" color="white" />
          <span v-else>{{ isEdit ? 'Сохранить' : 'Создать' }}</span>
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.cb-dialog { background: #fff; }
.cb-dialog.dark { background: #1c1c1e; }

/* Header */
.cb-header {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 20px;
  border-bottom: 1px solid #f0f0f0;
}
.cb-dialog.dark .cb-header { border-bottom-color: #2a2a2c; }

.cb-header-icon {
  width: 42px; height: 42px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.cb-header-text { flex: 1; min-width: 0; }
.cb-title { font-size: 16px; font-weight: 700; color: #111; }
.cb-subtitle { font-size: 12px; color: #737373; margin-top: 2px; }
.cb-dialog.dark .cb-title { color: #f5f5f5; }
.cb-dialog.dark .cb-subtitle { color: #a3a3a3; }

.cb-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: transparent; color: #737373; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.cb-close:hover { background: #f5f5f5; color: #111; }
.cb-dialog.dark .cb-close:hover { background: #2a2a2c; color: #f5f5f5; }

/* Body */
.cb-body {
  padding: 20px;
  display: flex; flex-direction: column; gap: 18px;
}

.cb-preview {
  display: flex; align-items: center; gap: 12px;
  padding: 14px; border-radius: 12px;
  border: 1px solid;
}
.cb-preview-icon {
  width: 38px; height: 38px; border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
}
.cb-preview-name { font-size: 14px; font-weight: 700; color: #111; }
.cb-preview-meta { font-size: 11px; color: #737373; margin-top: 2px; }
.cb-dialog.dark .cb-preview-name { color: #f5f5f5; }
.cb-dialog.dark .cb-preview-meta { color: #a3a3a3; }

/* Fields */
.cb-field { display: flex; flex-direction: column; gap: 6px; }
.cb-label {
  font-size: 12px; font-weight: 600; color: #525252;
  text-transform: uppercase; letter-spacing: 0.4px;
}
.cb-dialog.dark .cb-label { color: #a3a3a3; }

.cb-hint { font-size: 11px; color: #737373; line-height: 1.4; }
.cb-dialog.dark .cb-hint { color: #737373; }

/* Color palette */
.cb-palette {
  display: flex; gap: 8px; flex-wrap: wrap;
}
.cb-swatch {
  width: 32px; height: 32px; border-radius: 10px;
  border: 2px solid transparent;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s;
}
.cb-swatch:hover { transform: scale(1.08); }
.cb-swatch.active {
  border-color: #fff;
  box-shadow: 0 0 0 2px currentColor;
}

/* Icon picker */
.cb-icons {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;
}
.cb-icon-btn {
  height: 44px; border-radius: 10px;
  border: 1.5px solid #e5e5e5;
  background: transparent; color: #525252;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.cb-icon-btn:hover { border-color: #a3a3a3; color: #111; }
.cb-dialog.dark .cb-icon-btn { border-color: #2a2a2c; color: #a3a3a3; }
.cb-dialog.dark .cb-icon-btn:hover { border-color: #525252; color: #f5f5f5; }

/* Footer */
.cb-footer {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 14px 20px;
  border-top: 1px solid #f0f0f0;
}
.cb-dialog.dark .cb-footer { border-top-color: #2a2a2c; }

.cb-btn {
  height: 40px; padding: 0 18px; border-radius: 10px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: none; transition: all 0.15s;
}
.cb-btn:disabled { opacity: 0.5; cursor: default; }
.cb-btn--ghost { background: transparent; color: #525252; }
.cb-btn--ghost:hover:not(:disabled) { background: #f5f5f5; }
.cb-dialog.dark .cb-btn--ghost { color: #a3a3a3; }
.cb-dialog.dark .cb-btn--ghost:hover:not(:disabled) { background: #2a2a2c; }

.cb-btn--primary { background: #047857; color: #fff; }
.cb-btn--primary:hover:not(:disabled) { background: #065f46; }
</style>
