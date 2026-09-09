<script setup lang="ts">
/**
 * Выпадающий список сервиса.
 *
 * Браузерный `<select>` рисуется системой: на macOS он один, на Windows
 * другой, и рядом с нашими полями выглядит чужим. Раз уж в окнах оплаты и в
 * формах счетов списки свои, они должны быть своими везде — иначе интерфейс
 * распадается на «наши» и «не наши» места.
 *
 * Список рисуется в конце страницы (`Teleport`) и позиционируется по кнопке.
 * Внутри блока он жил бы по правилам этого блока: в окне со скроллом список
 * уезжал вместе с содержимым, и до него приходилось долистывать, а блок с
 * `overflow: hidden` просто срезал его по своей границе.
 *
 * Если снизу не помещается — открывается вверх. Закрывается по клику мимо, по
 * прокрутке и при изменении размера окна: после них координаты уже не те.
 */
import { computed } from 'vue'
import { useAnchoredMenu } from '@/composables/useAnchoredMenu'

export interface SelectOption {
  value: string
  label: string
  /** Приписка справа — например, «осн.» у кассы по умолчанию. */
  hint?: string
  /** Цветная точка слева: папки и кассы узнают по цвету. */
  color?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | null
    options: SelectOption[]
    /** Что показать, когда ничего не выбрано. */
    placeholder?: string
    /** Пункт «ничего не выбрано» с этой подписью. Пусто — пункта нет. */
    emptyLabel?: string | null
    disabled?: boolean
    /** Компактная высота — для строк внутри таблиц и узких форм. */
    compact?: boolean
  }>(),
  { placeholder: 'Выберите', emptyLabel: null },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string | null): void }>()

const { open, anchor: root, menu, pos, flipped, toggle: toggleMenu, close } = useAnchoredMenu()

const current = computed(() => props.options.find((o) => o.value === props.modelValue) ?? null)
const label = computed(() => current.value?.label ?? props.emptyLabel ?? props.placeholder)

function pick(value: string | null) {
  emit('update:modelValue', value)
  close()
}

</script>

<template>
  <div ref="root" class="sf">
    <button
      type="button"
      class="sf-btn"
      :class="{ 'sf-btn--open': open, 'sf-btn--compact': compact }"
      :disabled="disabled"
      @click="toggleMenu(disabled)"
    >
      <span v-if="current?.color" class="sf-dot" :style="{ background: current.color }" />
      <span class="sf-label" :class="{ 'sf-label--dim': !current }">{{ label }}</span>
      <v-icon icon="mdi-chevron-down" size="18" class="sf-chev" :class="{ 'sf-chev--rot': open }" />
    </button>

    <Teleport to="body">

      <Transition name="menu-pop">
      <div
        v-if="open"
        ref="menu"
        class="sf-menu"
        :class="{ 'menu-pop--up': flipped }"
        :style="{ top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px' }"
      >
        <button
          v-if="emptyLabel"
          type="button"
          class="sf-item"
          :class="{ 'sf-item--on': modelValue === null || modelValue === '' }"
          @click="pick(null)"
        >
          <span class="sf-item-label">{{ emptyLabel }}</span>
        </button>

        <button
          v-for="o in options"
          :key="o.value"
          type="button"
          class="sf-item"
          :class="{ 'sf-item--on': o.value === modelValue }"
          @click="pick(o.value)"
        >
          <span v-if="o.color" class="sf-dot" :style="{ background: o.color }" />
          <span class="sf-item-label">{{ o.label }}</span>
          <span v-if="o.hint" class="sf-item-hint">{{ o.hint }}</span>
          <v-icon v-if="o.value === modelValue" icon="mdi-check" size="15" class="sf-check" />
        </button>
      </div>
    </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.sf { position: relative; }

.sf-btn {
  width: 100%; height: 42px; padding: 0 12px;
  display: flex; align-items: center; gap: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9);
  text-align: left; cursor: pointer; transition: border-color 0.15s;
}
.sf-btn--compact { height: 36px; font-size: 13px; border-radius: 8px; }
.sf-btn:hover:not(:disabled) { border-color: rgba(var(--v-theme-on-surface), 0.22); }
.sf-btn--open { border-color: #047857; }
.sf-btn:disabled { opacity: 0.6; cursor: default; }

.sf-label {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sf-label--dim { color: rgba(var(--v-theme-on-surface), 0.45); }
.sf-chev { flex: none; color: rgba(var(--v-theme-on-surface), 0.4); transition: transform 0.15s; }
.sf-chev--rot { transform: rotate(180deg); }

.sf-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }

/* Список живёт в конце страницы, поэтому позиционируется от окна и должен
   быть выше модалок Vuetify (у них z-index 2400). */
.sf-menu {
  position: fixed; z-index: 2500;
  max-height: 280px; overflow-y: auto;
  padding: 5px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

.sf-item {
  width: 100%; display: flex; align-items: center; gap: 8px;
  /* Пункты не должны слипаться: без просвета список читается как один
     сплошной блок, и глаз не отделяет строки друг от друга. */
  margin-bottom: 2px;
  padding: 8px; border: none; border-radius: 9px; background: transparent;
  text-align: left; cursor: pointer;
  font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.9);
}
.sf-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.sf-item--on { background: rgba(4, 120, 87, 0.08); }
.sf-item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-item-hint { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); }
.sf-check { color: #047857; }
.sf-item:last-child { margin-bottom: 0; }
</style>
