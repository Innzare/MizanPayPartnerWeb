<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="(v) => emit('update:modelValue', v)"
    max-width="420"
  >
    <v-card rounded="xl" class="fcd">
      <div class="fcd-header">
        <div class="fcd-header-icon" :style="{ background: form.color + '18', color: form.color }">
          <v-icon icon="mdi-folder" size="22" />
        </div>
        <div>
          <div class="fcd-title">Новая папка</div>
          <div class="fcd-subtitle">Группируйте сделки для удобства</div>
        </div>
        <button class="fcd-close" @click="close">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="fcd-body">
        <div class="fcd-field">
          <label class="fcd-label">Название</label>
          <input
            ref="nameInputRef"
            v-model="form.name"
            class="fcd-input"
            placeholder="Например: Телефоны"
            @keyup.enter="onSave"
          />
        </div>

        <div class="fcd-field">
          <label class="fcd-label">Цвет</label>
          <div class="fcd-colors">
            <button
              v-for="c in FOLDER_COLORS"
              :key="c"
              class="fcd-color"
              :class="{ active: form.color === c }"
              :style="{ background: c }"
              @click="form.color = c"
            >
              <v-icon v-if="form.color === c" icon="mdi-check" size="14" color="white" />
            </button>
          </div>
        </div>

        <div class="fcd-preview">
          <span class="fcd-preview-label">Предпросмотр:</span>
          <span class="fcd-preview-chip" :style="{ background: form.color + '18', color: form.color }">
            <span class="fcd-preview-dot" :style="{ background: form.color }" />
            {{ form.name || 'Название папки' }}
          </span>
        </div>
      </div>

      <div class="fcd-footer">
        <button class="fcd-cancel" @click="close">Отмена</button>
        <button class="fcd-save" :disabled="saving || !form.name.trim()" @click="onSave">
          <v-progress-circular v-if="saving" indeterminate size="14" width="2" color="white" />
          <v-icon v-else icon="mdi-check" size="16" />
          Создать
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch, nextTick } from 'vue'
import { useFolders } from '@/composables/useFolders'
import { useToast } from '@/composables/useToast'
import type { DealFolder } from '@/types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'created', folder: DealFolder): void
}>()

const { createFolder } = useFolders()
const { show: showToast } = useToast()

const FOLDER_COLORS = ['#6366f1', '#3b82f6', '#0ea5e9', '#10b981', '#047857', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b']

const form = reactive({ name: '', color: '#6366f1', icon: 'mdi-folder' })
const saving = ref(false)
const nameInputRef = ref<HTMLInputElement | null>(null)

watch(() => props.modelValue, (open) => {
  if (open) {
    form.name = ''
    form.color = '#6366f1'
    form.icon = 'mdi-folder'
    nextTick(() => nameInputRef.value?.focus())
  }
})

function close() {
  emit('update:modelValue', false)
}

async function onSave() {
  if (!form.name.trim()) return
  saving.value = true
  try {
    const folder = await createFolder({ name: form.name.trim(), color: form.color, icon: form.icon })
    showToast('Папка создана', 'success')
    emit('created', folder)
    close()
  } catch (e: any) {
    showToast(e.message || 'Не удалось создать папку', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.fcd-header {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 20px 14px;
  position: relative;
}
.fcd-header-icon {
  width: 40px; height: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.fcd-title { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.fcd-subtitle { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px; }
.fcd-close {
  position: absolute; top: 12px; right: 12px;
  width: 30px; height: 30px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background 0.15s;
}
.fcd-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

.fcd-body { padding: 0 20px 16px; }
.fcd-field { margin-bottom: 16px; }
.fcd-label {
  display: block; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 6px;
}
.fcd-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
  transition: border-color 0.15s;
  font-family: inherit; box-sizing: border-box;
}
.fcd-input:focus { border-color: #047857; }

.fcd-colors { display: flex; gap: 8px; flex-wrap: wrap; }
.fcd-color {
  width: 32px; height: 32px; border-radius: 50%; border: none;
  cursor: pointer; transition: transform 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.fcd-color:hover { transform: scale(1.1); }
.fcd-color.active { box-shadow: 0 0 0 2px rgb(var(--v-theme-surface)), 0 0 0 4px currentColor; }

.fcd-preview {
  display: flex; align-items: center; gap: 8px;
  padding: 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.fcd-preview-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.fcd-preview-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
}
.fcd-preview-dot { width: 6px; height: 6px; border-radius: 50%; }

.fcd-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 20px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.fcd-cancel, .fcd-save {
  padding: 10px 18px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 500; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  transition: all 0.15s; font-family: inherit;
}
.fcd-cancel {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-left: auto;
}
.fcd-cancel:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.fcd-save {
  background: #047857; color: #fff;
}
.fcd-save:hover:not(:disabled) { background: #065f46; }
.fcd-save:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
