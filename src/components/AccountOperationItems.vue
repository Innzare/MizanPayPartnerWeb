<script setup lang="ts">
/**
 * Пункты меню «что сделать с деньгами».
 *
 * Один и тот же список нужен в четырёх местах: кнопка «Операции» в шапке
 * баланса, меню строки счёта, меню карточки и страница самого счёта. Раньше
 * разметка была скопирована, и добавленный вид операции появлялся только там,
 * куда его дописали.
 *
 * Кто открыл меню на конкретном счёте, тот уже выбрал счёт: форма получает его
 * готовым и не спрашивает второй раз.
 */
import { computed } from 'vue'
import { OPERATION_KINDS, type OperationKind } from '@/constants/operationKinds'
import { useAuthStore } from '@/stores/auth'

const props = withDefaults(
  defineProps<{
    /** Компактный вид — для меню «три точки», где пункты уже узкие. */
    compact?: boolean
    /**
     * Какие операции показывать. Пусто — все.
     *
     * В меню счёта список короче: там к операциям добавляются ещё пять
     * действий над самим счётом, и четырнадцать пунктов подряд превращают
     * меню в стену. Редкие виды остаются в кнопке «Операции» наверху.
     */
    kinds?: OperationKind[]
  }>(),
  { compact: false, kinds: undefined },
)

const emit = defineEmits<{ (e: 'pick', kind: OperationKind): void }>()

const auth = useAuthStore()

/**
 * Группы по направлению денег: пополнение, снятие и перевод.
 *
 * Раньше группы шли по «поводу» — деньги, долги, непонятное, — и человеку
 * приходилось помнить, в какой из них искать нужный вид. Направление известно
 * заранее: тот, кто открыл меню, уже знает, кладёт он деньги или забирает.
 * Перевод стоит отдельно: место хранения меняется, а денег не становится ни
 * больше, ни меньше.
 */
const groups = computed(() => {
  const allowed = OPERATION_KINDS.filter(
    (k) => auth.can(k.permission) && (!props.kinds || props.kinds.includes(k.kind)),
  )
  return [
    { title: 'Пополнение', items: allowed.filter((k) => k.direction === 'in') },
    { title: 'Снятие', items: allowed.filter((k) => k.direction === 'out') },
    { title: 'Перевод', items: allowed.filter((k) => k.direction === 'move') },
  ].filter((g) => g.items.length)
})
</script>

<template>
  <template v-for="(g, gi) in groups" :key="g.title">
    <div v-if="gi" class="opm-divider" />
    <div class="opm-group" :class="{ 'opm-group--compact': compact }">{{ g.title }}</div>
    <button
      v-for="k in g.items"
      :key="k.kind"
      type="button"
      class="opm-item"
      :class="{ 'opm-item--compact': compact }"
      @click="emit('pick', k.kind)"
    >
      <v-icon :icon="k.icon" :size="compact ? 16 : 18" class="opm-icon" />
      <span class="opm-body">
        <span class="opm-title">{{ k.title }}</span>
        <!-- Подсказка не украшение: «снять на себя» и «расход по бизнесу» по
             названию похожи, а по последствиям для прибыли — нет. В узком меню
             счёта её нет, зато полный вид объясняет разницу. -->
        <span v-if="!compact" class="opm-hint">{{ k.hint }}</span>
      </span>
    </button>
  </template>
</template>

<style scoped>
.opm-group {
  padding: 8px 10px 4px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.38);
}
.opm-group--compact { padding: 6px 10px 3px; }
.opm-divider { height: 1px; margin: 5px 0; background: rgba(var(--v-theme-on-surface), 0.08); }

.opm-item {
  display: flex; align-items: flex-start; gap: 10px; width: 100%;
  padding: 8px 10px; border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.85); cursor: pointer; text-align: left;
}
.opm-item:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.opm-item--compact { align-items: center; gap: 9px; padding: 8px 10px; }
.opm-icon { color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 1px; flex: none; }
.opm-item--compact .opm-icon { margin-top: 0; }
.opm-body { display: flex; flex-direction: column; min-width: 0; }
.opm-title { font-size: 13.5px; font-weight: 600; }
.opm-item--compact .opm-title { font-weight: 500; }
.opm-hint { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 1px; }
</style>
