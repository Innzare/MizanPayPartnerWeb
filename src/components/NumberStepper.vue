<script setup lang="ts">
/**
 * Число со своими кнопками «вверх-вниз».
 *
 * Браузерный `<input type="number">` показывает крошечные стрелки, которые
 * появляются только при наведении и по-разному выглядят в каждом браузере —
 * попасть по ним мышью трудно, а на тач-экране невозможно. Здесь поле обычное
 * текстовое (цифровая клавиатура на телефоне остаётся), а шаг задают две
 * нормальные кнопки; стрелки на клавиатуре тоже работают.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number | null
    min?: number
    max?: number
    step?: number
    suffix?: string
    /** Сколько знаков после запятой разрешено вводить. */
    precision?: number
  }>(),
  { min: 0, max: 999, step: 1, suffix: '%', precision: 1 },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: number | null): void }>()

const text = computed(() => (props.modelValue == null ? '' : String(props.modelValue)))

function clamp(v: number): number {
  return Math.min(props.max, Math.max(props.min, v))
}

/** Хвост вроде 20.30000000000000004 — из-за сложения дробных шагов. */
function round(v: number): number {
  const k = 10 ** props.precision
  return Math.round(v * k) / k
}

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(',', '.').trim()
  if (!raw) return emit('update:modelValue', null)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return
  emit('update:modelValue', round(clamp(parsed)))
}

function bump(direction: 1 | -1) {
  const base = props.modelValue ?? 0
  emit('update:modelValue', round(clamp(base + props.step * direction)))
}
</script>

<template>
  <span class="ns">
    <input
      class="ns-input"
      type="text"
      inputmode="decimal"
      :value="text"
      @input="onInput"
      @keydown.up.prevent="bump(1)"
      @keydown.down.prevent="bump(-1)"
    />
    <span v-if="suffix" class="ns-suffix">{{ suffix }}</span>
    <!-- tabindex=-1: кнопки не должны перехватывать переход по Tab между полями. -->
    <span class="ns-btns">
      <button class="ns-btn" tabindex="-1" title="Больше" @click="bump(1)">
        <v-icon icon="mdi-chevron-up" size="13" />
      </button>
      <button class="ns-btn" tabindex="-1" title="Меньше" @click="bump(-1)">
        <v-icon icon="mdi-chevron-down" size="13" />
      </button>
    </span>
  </span>
</template>

<style scoped>
.ns {
  position: relative; display: inline-flex; align-items: center;
  width: 108px; height: 38px;
}
.ns-input {
  width: 100%; height: 100%; padding: 0 44px 0 11px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16); border-radius: 9px;
  background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface));
  font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums;
  outline: none; transition: border-color 0.15s;
}
.ns-input:hover { border-color: rgba(var(--v-theme-on-surface), 0.28); }
.ns-input:focus { border-color: rgba(4, 120, 87, 0.55); }
.ns-suffix {
  position: absolute; right: 26px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4); pointer-events: none;
}
.ns-btns {
  position: absolute; right: 1px; top: 1px; bottom: 1px;
  display: flex; flex-direction: column; width: 22px;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.ns-btn {
  flex: 1; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; cursor: pointer; padding: 0;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ns-btn:first-child { border-radius: 0 8px 0 0; }
.ns-btn:last-child { border-radius: 0 0 8px 0; }
.ns-btn:hover { background: rgba(4, 120, 87, 0.1); color: #047857; }
.ns-btn:active { background: rgba(4, 120, 87, 0.18); }
</style>
