<script setup lang="ts">
/**
 * Выбор периода «месяц / год / всё время» — как фильтр месяцев на «Платежах».
 *
 * Кнопка показывает выбранное («Октябрь 2026»), стрелки по бокам листают
 * соседние месяцы (или годы, если выбран год) — самый частый сценарий «а что
 * было в прошлом месяце» в один клик. По нажатию — год со стрелками, сетка
 * месяцев и быстрые «Весь год» / «За всё время».
 *
 * Диапазон «от и до»: первый клик выбирает месяц и оставляет окно открытым,
 * второй клик по другому месяцу — конец диапазона (в том числе через год).
 * Повторный клик по тому же месяцу или закрытие окна — остаётся один месяц.
 *
 * Значение — тот же PeriodRange, что у пресетов «Отчётов», поэтому страницы,
 * которые раньше брали период из списка пресетов, меняют только разметку.
 */
import { computed, ref, watch } from 'vue'
import { rangeForPreset } from '@/composables/useReports'
import type { PeriodRange } from '@/types/reports'

const props = defineProps<{
  modelValue: PeriodRange
  /** Сколько операций в каждом месяце: { 'YYYY-MM': n }. Необязательно. */
  counts?: Record<string, number>
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: PeriodRange): void }>()

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

const open = ref(false)
const now = new Date()

/** Номер месяца от нулевого года — удобно сравнивать и сдвигать. */
const idx = (y: number, m: number) => y * 12 + m
const ymOf = (i: number) => ({ y: Math.floor(i / 12), m: i % 12 })
const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate()

/**
 * Выбранные месяцы «с — по» (индексы). Есть у месяца и у диапазона месяцев;
 * у года и «всего времени» — null.
 */
const selRange = computed<{ a: number; b: number } | null>(() => {
  const p = props.modelValue
  const fy = parseInt(p.from.slice(0, 4), 10)
  const fm = parseInt(p.from.slice(5, 7), 10) - 1
  if (p.preset === 'month') return { a: idx(fy, fm), b: idx(fy, fm) }
  if (p.preset === 'custom' && p.from.endsWith('-01')) {
    const ty = parseInt(p.to.slice(0, 4), 10)
    const tm = parseInt(p.to.slice(5, 7), 10) - 1
    if (parseInt(p.to.slice(8, 10), 10) === lastDay(ty, tm)) return { a: idx(fy, fm), b: idx(ty, tm) }
  }
  return null
})
const isRange = computed(() => !!selRange.value && selRange.value.a !== selRange.value.b)
const selYear = computed(() => parseInt(props.modelValue.from.slice(0, 4), 10))
const selMonth = computed(() =>
  props.modelValue.preset === 'month' ? parseInt(props.modelValue.from.slice(5, 7), 10) - 1 : null,
)
/** Год в окне выбора — листается отдельно, пока окно открыто. */
const viewYear = ref(selYear.value)
/** Начало диапазона, пока ждём второй клик; и месяц под курсором для подсветки. */
const anchor = ref<number | null>(null)
const hover = ref<number | null>(null)
watch(open, (v) => {
  if (v) {
    viewYear.value = props.modelValue.preset === 'all'
      ? now.getFullYear()
      : selRange.value ? ymOf(selRange.value.b).y : selYear.value
  } else {
    anchor.value = null
    hover.value = null
  }
})

/** Период из диапазона месяцев: один месяц — пресет «месяц», иначе «свой». */
function rangeOf(a: number, b: number): PeriodRange {
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  const s = ymOf(lo)
  const e = ymOf(hi)
  if (lo === hi) return rangeForPreset('month', new Date(s.y, s.m, 1))
  const label = s.y === e.y
    ? `${MONTHS[s.m]} — ${(MONTHS[e.m] ?? "").toLowerCase()} ${e.y}`
    : `${MONTHS[s.m]} ${s.y} — ${(MONTHS[e.m] ?? "").toLowerCase()} ${e.y}`
  return {
    from: `${s.y}-${pad(s.m + 1)}-01`,
    to: `${e.y}-${pad(e.m + 1)}-${pad(lastDay(e.y, e.m))}`,
    preset: 'custom',
    label,
  }
}

function pickMonth(y: number, m: number) {
  const i = idx(y, m)
  if (anchor.value == null) {
    // Первый клик: месяц выбран сразу, окно ждёт возможный конец диапазона.
    anchor.value = i
    emit('update:modelValue', rangeOf(i, i))
    return
  }
  // Второй клик: тот же месяц — остаётся один месяц, другой — диапазон.
  emit('update:modelValue', rangeOf(anchor.value, i))
  open.value = false
}

/** Подсветка ячейки: выбранный период или диапазон под курсором. */
function cellState(y: number, m: number): 'edge' | 'inside' | null {
  const i = idx(y, m)
  let a: number | null = null
  let b: number | null = null
  if (anchor.value != null) {
    a = anchor.value
    b = hover.value ?? anchor.value
  } else if (selRange.value) {
    a = selRange.value.a
    b = selRange.value.b
  }
  if (a == null || b == null) return null
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  if (i === lo || i === hi) return 'edge'
  if (i > lo && i < hi) return 'inside'
  return null
}
function pickYear(y: number) {
  emit('update:modelValue', rangeForPreset('year', new Date(y, 0, 1)))
  open.value = false
}
function pickAll() {
  emit('update:modelValue', rangeForPreset('all'))
  open.value = false
}

/**
 * Стрелки у кнопки: соседний месяц; у диапазона — сдвиг на его длину
 * (март–июнь → июль–октябрь); у года — соседний год.
 */
const canStep = computed(() => !!selRange.value || props.modelValue.preset === 'year')
function step(delta: number) {
  const r = selRange.value
  if (r) {
    const len = r.b - r.a + 1
    emit('update:modelValue', rangeOf(r.a + delta * len, r.b + delta * len))
  } else if (props.modelValue.preset === 'year') {
    pickYear(selYear.value + delta)
  }
}

const label = computed(() => {
  const p = props.modelValue
  if (p.preset === 'month' && selMonth.value != null) return `${MONTHS[selMonth.value]} ${selYear.value}`
  if (isRange.value) return p.label
  if (p.preset === 'year') return `${selYear.value} год`
  if (p.preset === 'all') return 'За всё время'
  return p.label
})

const key = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`
const isFuture = (y: number, m: number) => y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())
</script>

<template>
  <div class="myp">
    <button v-if="canStep" type="button" class="myp-step" title="Назад" @click="step(-1)">
      <v-icon icon="mdi-chevron-left" size="18" />
    </button>

    <v-menu v-model="open" :close-on-content-click="false" location="bottom center" offset="6">
      <template #activator="{ props: menuProps }">
        <button v-bind="menuProps" type="button" class="myp-btn" :class="{ 'myp-btn--open': open }">
          <v-icon icon="mdi-calendar-month-outline" size="16" />
          <span class="myp-label">{{ label }}</span>
          <v-icon icon="mdi-chevron-down" size="14" class="myp-caret" />
        </button>
      </template>

      <v-card rounded="xl" elevation="4" class="myp-menu">
        <div class="myp-year">
          <button type="button" class="myp-year-btn" @click="viewYear--">
            <v-icon icon="mdi-chevron-left" size="18" />
          </button>
          <span class="myp-year-label">{{ viewYear }}</span>
          <button type="button" class="myp-year-btn" @click="viewYear++">
            <v-icon icon="mdi-chevron-right" size="18" />
          </button>
        </div>

        <div class="myp-grid">
          <button
            v-for="(name, i) in MONTHS"
            :key="i"
            type="button"
            class="myp-cell"
            :class="{
              'myp-cell--on': cellState(viewYear, i) === 'edge',
              'myp-cell--in': cellState(viewYear, i) === 'inside',
              'myp-cell--now': viewYear === now.getFullYear() && i === now.getMonth(),
              'myp-cell--future': isFuture(viewYear, i),
              'myp-cell--data': (counts?.[key(viewYear, i)] ?? 0) > 0,
            }"
            @click="pickMonth(viewYear, i)"
            @mouseenter="hover = idx(viewYear, i)"
          >
            <span class="myp-cell-name">{{ name.slice(0, 3) }}</span>
            <span v-if="counts?.[key(viewYear, i)]" class="myp-cell-count">{{ counts[key(viewYear, i)] }}</span>
          </button>
        </div>

        <!-- Подсказка о диапазоне: без неё второй клик никто не угадает. -->
        <div class="myp-hint">
          <template v-if="anchor != null">Выберите месяц окончания — или закройте, чтобы оставить один месяц</template>
          <template v-else>Нажмите месяц, затем второй — получится период «от и до»</template>
        </div>

        <div class="myp-footer">
          <button
            type="button"
            class="myp-quick"
            :class="{ 'myp-quick--on': modelValue.preset === 'year' && selYear === viewYear }"
            @click="pickYear(viewYear)"
          >Весь {{ viewYear }} год</button>
          <button
            type="button"
            class="myp-quick"
            :class="{ 'myp-quick--on': modelValue.preset === 'all' }"
            @click="pickAll"
          >За всё время</button>
        </div>
      </v-card>
    </v-menu>

    <button v-if="canStep" type="button" class="myp-step" title="Вперёд" @click="step(1)">
      <v-icon icon="mdi-chevron-right" size="18" />
    </button>
  </div>
</template>

<style scoped>
.myp {
  display: inline-flex; align-items: center; gap: 2px;
  height: 40px; padding: 0 3px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
}
.myp-step {
  width: 30px; height: 30px; border-radius: 8px; border: none; background: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.myp-step:hover { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.85); }
.myp-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 10px; border-radius: 8px; border: none; background: none; cursor: pointer;
  font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); white-space: nowrap;
}
.myp-btn:hover, .myp-btn--open { background: rgba(var(--v-theme-on-surface), 0.06); }
.myp-label { min-width: 96px; text-align: center; }
.myp-caret { opacity: 0.55; }

.myp-menu { padding: 0; width: 320px; overflow: hidden; }
.myp-year {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.myp-year-label { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.myp-year-btn {
  width: 32px; height: 32px; border-radius: 8px; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.6);
}
.myp-year-btn:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.myp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 12px; }
.myp-cell {
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 10px 4px; border-radius: 10px; border: none; cursor: pointer; background: none;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.myp-cell:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.myp-cell--future { color: rgba(var(--v-theme-on-surface), 0.38); }
.myp-cell--now { box-shadow: inset 0 0 0 1px rgba(var(--v-theme-primary), 0.35); }
.myp-cell--in, .myp-cell--in:hover { background: rgba(var(--v-theme-primary), 0.06); color: rgb(var(--v-theme-primary)); border-radius: 6px; }
.myp-hint {
  padding: 0 14px 10px; font-size: 11.5px; line-height: 1.4; text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.myp-cell--on, .myp-cell--on:hover { background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); font-weight: 600; }
.myp-cell-name { font-size: 13px; text-transform: capitalize; }
.myp-cell-count { font-size: 10.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.45); }
.myp-cell--on .myp-cell-count { color: rgb(var(--v-theme-primary)); }
.myp-footer {
  display: flex; gap: 6px; padding: 10px 12px 12px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.myp-quick {
  flex: 1; padding: 8px 10px; border-radius: 9px; border: none; cursor: pointer;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 12.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.65);
}
.myp-quick:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.myp-quick--on { background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); }
</style>
