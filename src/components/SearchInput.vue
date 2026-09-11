<script setup lang="ts">
/**
 * Строка поиска над списком.
 *
 * Одинаковая на всех страницах: лупа слева, крестик справа, как только в поле
 * что-то введено. Раньше каждая страница собирала её сама — где-то крестик
 * был, где-то нет, и чтобы вернуть полный список, приходилось стирать текст
 * по букве.
 *
 * Класс и стиль с места использования попадают на корень (ширина, отступы у
 * всех разные), поэтому обёртка снаружи не нужна.
 */
import { ref } from 'vue'

withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    /** Иконка слева: у поиска по людям уместнее человек, чем лупа. */
    icon?: string
    disabled?: boolean
  }>(),
  { placeholder: 'Поиск', icon: 'mdi-magnify' },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  /** Поле очистили крестиком — иногда за этим следует перезагрузка списка. */
  (e: 'clear'): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)

function clear() {
  emit('update:modelValue', '')
  emit('clear')
  // Курсор возвращаем в поле: очистка почти всегда означает «ищу другое».
  inputRef.value?.focus()
}
</script>

<template>
  <div class="si">
    <v-icon :icon="icon" size="18" class="si-icon" />
    <input
      ref="inputRef"
      :value="modelValue"
      type="text"
      class="si-input"
      :class="{ 'si-input--filled': !!modelValue }"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button v-if="modelValue" type="button" class="si-clear" title="Очистить" @click="clear">
      <v-icon icon="mdi-close" size="14" />
    </button>
  </div>
</template>

<style scoped>
/* Обёртка может оказаться выше поля (например, в колонке, которая тянет
   элементы по высоте), поэтому иконки привязаны не к её середине, а к
   середине самого поля — его высота фиксированная, 40px. */
.si { position: relative; flex: 1 1 auto; min-width: 0; }

.si-icon {
  position: absolute; left: 12px; top: 20px; transform: translateY(-50%);
  color: #9ca3af; pointer-events: none;
}

.si-input {
  width: 100%; height: 40px; padding: 0 16px 0 38px;
  border: 1px solid #e4e4e7; border-radius: 10px;
  background: #fff; font-size: 14px; color: inherit;
  outline: none; transition: all 0.15s ease;
}
/* Место под крестик — чтобы он не наезжал на текст в конце строки. */
.si-input--filled { padding-right: 36px; }
.si-input::placeholder { color: #9ca3af; }
.si-input:focus { border-color: #047857; }
.si-input:disabled { opacity: 0.6; cursor: default; }

.si-clear {
  position: absolute; right: 8px; top: 20px; transform: translateY(-50%);
  width: 22px; height: 22px; border: none; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.4);
  cursor: pointer;
}
.si-clear:hover {
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.dark .si-input {
  background: rgb(var(--v-theme-surface));
  border-color: rgb(var(--v-theme-border));
}
</style>
