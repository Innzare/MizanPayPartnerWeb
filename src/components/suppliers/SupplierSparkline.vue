<script setup lang="ts">
/**
 * Мини-график закупок по месяцам.
 *
 * Рисуется прямо в разметке, без графических библиотек: в таблице таких
 * графиков сотня, и любая библиотека заметно замедлила бы её отрисовку ради
 * двенадцати точек.
 *
 * Высота нормируется по собственному максимуму строки — сравнивать поставщиков
 * между собой по высоте нельзя, и это честно: график показывает динамику
 * одного, а не долю среди всех.
 */
import { computed } from 'vue'
import type { SupplierMonth } from '@/stores/suppliers'

const props = withDefaults(
  defineProps<{
    points: SupplierMonth[]
    /** Что показывать: закупку или розницу. Закупка скрыта — рисуем розницу. */
    field?: 'purchase' | 'retail'
    width?: number
    height?: number
  }>(),
  { field: 'purchase', width: 84, height: 24 },
)

const values = computed(() => props.points.map((p) => p[props.field] ?? 0))
const max = computed(() => Math.max(...values.value, 1))

/** Столбики: пустой месяц — заметная риска у основания, а не пустота. */
const bars = computed(() => {
  const n = values.value.length || 1
  const gap = 2
  const barWidth = Math.max(2, (props.width - gap * (n - 1)) / n)
  return values.value.map((v, i) => {
    const h = v > 0 ? Math.max(2, (v / max.value) * (props.height - 2)) : 1
    return {
      x: i * (barWidth + gap),
      y: props.height - h,
      w: barWidth,
      h,
      empty: v === 0,
    }
  })
})

const hasData = computed(() => values.value.some((v) => v > 0))
</script>

<template>
  <svg
    v-if="hasData"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    class="spark"
    aria-hidden="true"
  >
    <rect
      v-for="(b, i) in bars"
      :key="i"
      :x="b.x"
      :y="b.y"
      :width="b.w"
      :height="b.h"
      :class="{ 'spark-bar': true, 'spark-bar--empty': b.empty }"
      rx="1"
    />
  </svg>
  <span v-else class="spark-empty">—</span>
</template>

<style scoped>
.spark { display: block; }
.spark-bar { fill: #047857; opacity: 0.75; }
.spark-bar--empty { fill: rgba(var(--v-theme-on-surface), 0.15); opacity: 1; }
.spark-empty { color: rgba(var(--v-theme-on-surface), 0.3); font-size: 13px; }
</style>
