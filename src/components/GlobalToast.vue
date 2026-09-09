<script lang="ts" setup>
import { useToast } from '@/composables/useToast'

import { ref } from 'vue'
import type { Toast } from '@/composables/useToast'

const { toasts, remove } = useToast()

/** Уведомления, у которых действие уже запущено, — второй раз не отправляем. */
const busy = ref(new Set<number>())

async function runAction(toast: Toast) {
  if (!toast.action || busy.value.has(toast.id)) return
  busy.value.add(toast.id)
  try {
    await toast.action.handler()
  } finally {
    busy.value.delete(toast.id)
    remove(toast.id)
  }
}

const iconMap: Record<string, string> = {
  success: 'mdi-check-circle-outline',
  error: 'mdi-alert-circle-outline',
  warning: 'mdi-alert-outline',
  info: 'mdi-information-outline',
}

const colorMap: Record<string, string> = {
  success: '#047857',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
}
</script>

<template>
  <Teleport to="body">
    <div class="gt-container">
      <TransitionGroup name="gt-slide">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="gt-toast"
          :style="{ '--gt-color': colorMap[toast.type] }"
        >
          <v-icon :icon="iconMap[toast.type]" size="20" :color="colorMap[toast.type]" />
          <span class="gt-message">{{ toast.message }}</span>
          <!-- Кнопка действия — например «Отменить» сразу после отметки
               оплаты. Гасим её после нажатия, чтобы двойной клик не отправил
               отмену дважды. -->
          <button
            v-if="toast.action"
            class="gt-action"
            :disabled="busy.has(toast.id)"
            @click="runAction(toast)"
          >
            {{ toast.action.label }}
          </button>
          <button class="gt-close" @click="remove(toast.id)">
            <v-icon icon="mdi-close" size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.gt-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 400px;
}

.gt-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  /* Тост всплывает над контентом — берём приподнятый слой темы, а не белый:
     иначе в тёмных темах это светлая плашка посреди тёмного экрана. */
  background: rgb(var(--v-theme-surface-elevated));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.1);
  border-left: 3px solid var(--gt-color);
  min-width: 280px;
}


.gt-message {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.88);
  line-height: 1.4;
}


.gt-action {
  padding: 4px 10px;
  border-radius: 7px;
  border: 1px solid var(--gt-color);
  background: transparent;
  color: var(--gt-color);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.gt-action:hover:not(:disabled) { background: color-mix(in srgb, var(--gt-color) 12%, transparent); }
.gt-action:disabled { opacity: 0.5; cursor: default; }
.gt-close {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: none;
  color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
}

.gt-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.65);
}



/* Transitions */
.gt-slide-enter-active {
  transition: all 0.3s ease;
}

.gt-slide-leave-active {
  transition: all 0.2s ease;
}

.gt-slide-enter-from {
  opacity: 0;
  transform: translateX(40px);
}

.gt-slide-leave-to {
  opacity: 0;
  transform: translateX(40px);
}

.gt-slide-move {
  transition: transform 0.2s ease;
}
</style>