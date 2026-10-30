<script setup lang="ts">
/**
 * Лента месяцев: столбик — месяц (как «график цен» у Aviasales). Общий движок
 * для «Инвесторов» и страницы кассы: шкала, прокрутка, пузырь с суммой над
 * выбранным месяцем, подсказка у наведённого, скелет и пустое состояние.
 *
 * О смысле цифр движок ничего не знает: части столбика (снизу вверх) с их
 * цветом, число в пузыре, содержимое подсказки и легенду даёт обёртка.
 * Для подсказки и легенды у движка есть готовые классы — rc-tip-head,
 * rc-tag(--now/--future), rc-tip-line, rc-tip-sub, rc-tip-sep, rc-dot,
 * rc-tip-foot; rc-legend-item.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'

export interface RibbonSegment {
  value: number
  /** Фон части: цвет, градиент или штриховка. */
  background: string
  /** Рамка штриховки «ожидается» и т. п. */
  outline?: string
}
export interface RibbonMonth {
  month: string
  future: boolean
  current: boolean
  closed?: boolean
  segments: RibbonSegment[]
  /** Число в пузыре над выбранным месяцем. */
  headline: string
  /** Значение месяца неизвестно — без «нулевой» черты. */
  unknown?: boolean
}

const props = defineProps<{
  months: RibbonMonth[]
  selected: string
  loading?: boolean
  title: string
  subtitle: string
  emptyText: string
  /** Есть ли что показать; без него — пустое состояние. */
  hasData: boolean
}>()
const emit = defineEmits<{ (e: 'select', month: string): void }>()

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
function parts(m: string) {
  const [y, mm] = m.split('-').map(Number)
  return { y: y!, m: mm! }
}
const shortOf = (m: string) => MONTHS_SHORT[parts(m).m - 1]
const titleOf = (m: string) => `${MONTHS_NOM[parts(m).m - 1]} ${parts(m).y}`

/** Высота столбика — от самого большого месяца ленты. */
const scaleMax = computed(() => {
  let max = 0
  for (const x of props.months) {
    const v = x.segments.reduce((a, s) => a + Math.max(s.value, 0), 0)
    if (v > max) max = v
  }
  return max
})
// Столбик не выше 112 px из 132: сверху остаётся место под пузырь с суммой
// (лента прокручивается вбок и обрезает всё, что выходит за её высоту).
const BAR_H = 112
function h(v: number) {
  if (!(v > 0) || !(scaleMax.value > 0)) return 0
  return Math.max(3, Math.round((v / scaleMax.value) * BAR_H))
}

/** Линии шкалы: полный столбик и половина — с подписью суммы. */
function compact(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace('.', ',').replace(/,0$/, '')} млн`
  if (v >= 1_000) return `${Math.round(v / 1_000)} тыс`
  return `${Math.round(v)}`
}
// Верх области столбиков: отступ колонки 30 px + запас под пузырь 20 px.
const GRID_TOP = 30 + (132 - BAR_H)
const gridLines = computed(() => scaleMax.value > 0
  ? [1, 0.5].map((k) => ({ top: GRID_TOP + Math.round(BAR_H * (1 - k)), label: compact(scaleMax.value * k) }))
  : [])

/** Части столбика снизу вверх — с высотой, нулевые отброшены. */
function bars(x: RibbonMonth) {
  return x.segments
    .map((s) => ({ h: h(s.value), style: { height: `${h(s.value)}px`, background: s.background, boxShadow: s.outline } }))
    .filter((s) => s.h > 0)
}
function barTop(x: RibbonMonth) {
  return bars(x).reduce((t, s) => t + s.h, 0)
}

// ── Прокрутка: стрелки и выбранный месяц в центре ──
const viewport = ref<HTMLElement | null>(null)
const canLeft = ref(false)
const canRight = ref(false)
function updateArrows() {
  const el = viewport.value
  if (!el) return
  canLeft.value = el.scrollLeft > 4
  canRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
}
function scrollBy(dir: -1 | 1) {
  const el = viewport.value
  if (el) el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: 'smooth' })
}
async function centerSelected(smooth = false) {
  await nextTick()
  const el = viewport.value
  const col = el?.querySelector<HTMLElement>(`[data-month="${props.selected}"]`)
  if (!el || !col) { updateArrows(); return }
  const left = col.offsetLeft - el.clientWidth / 2 + col.clientWidth / 2
  el.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' })
  updateArrows()
}
watch(() => props.months.length, () => centerSelected())
watch(() => props.selected, () => centerSelected(true))
onMounted(() => centerSelected())

// ── Подсказка месяца: одна карточка над наведённым столбиком ──
// На экранах без наведения (телефон) не показываем: нажатие открывает
// месяц, где всё то же крупно, а всплывшая карточка закрывала бы ленту.
const canHover = typeof window !== 'undefined' && !window.matchMedia?.('(hover: none)').matches
const tipMonth = ref<string | null>(null)
const tipLeft = ref(0)
const TIP_W = 260
function showTip(month: string, e: Event) {
  if (!canHover) return
  const col = e.currentTarget as HTMLElement | null
  const el = viewport.value
  if (!col || !el) return
  // Сбоку от столбика, чтобы он оставался виден: справа, у правого края — слева.
  const left = col.offsetLeft - el.scrollLeft
  const right = left + col.offsetWidth
  tipLeft.value = right + 8 + TIP_W <= el.clientWidth ? right + 8 : Math.max(left - 8 - TIP_W, 0)
  tipMonth.value = month
}
function hideTip() { tipMonth.value = null }

/** Подпись года — у первого столбика и у каждого января. */
function showYear(i: number) {
  const m = props.months[i]!.month
  return i === 0 || m.endsWith('-01')
}
</script>

<template>
  <div class="mrc">
    <div class="mrc-head">
      <div>
        <div class="mrc-title">{{ title }}</div>
        <div class="mrc-sub">{{ subtitle }}</div>
      </div>
      <slot name="controls" />
    </div>

    <div v-if="loading && !months.length" class="mrc-skel">
      <i v-for="n in 14" :key="n" :style="{ height: 30 + ((n * 37) % 90) + 'px' }" />
    </div>
    <div v-else-if="!hasData" class="mrc-empty">{{ emptyText }}</div>
    <div v-else class="mrc-body">
      <div v-for="g in gridLines" :key="g.top" class="mrc-grid" :style="{ top: g.top + 'px' }"><span>{{ g.label }}</span></div>
      <div class="mrc-base" :style="{ top: GRID_TOP + BAR_H + 'px' }" />
      <button v-show="canLeft" type="button" class="mrc-nav mrc-nav--l" aria-label="Раньше" @click="scrollBy(-1)">
        <v-icon icon="mdi-chevron-left" size="20" />
      </button>
      <div ref="viewport" class="mrc-viewport" @scroll.passive="updateArrows(); hideTip()">
        <div class="mrc-track">
          <template v-for="(x, i) in months" :key="x.month">
          <button
            type="button"
            class="mrc-col"
            :class="{
              'mrc-col--sel': x.month === selected,
              'mrc-col--future': x.future,
              'mrc-col--year': showYear(i) && i > 0,
            }"
            :data-month="x.month"
            :aria-label="`${titleOf(x.month)}: ${x.headline}`"
            :aria-pressed="x.month === selected"
            @click="emit('select', x.month)"
            @mouseenter="showTip(x.month, $event)"
            @mouseleave="hideTip"
            @focus="showTip(x.month, $event)"
            @blur="hideTip"
          >
            <span v-if="showYear(i)" class="mrc-year">{{ x.month.slice(0, 4) }}</span>
            <span class="mrc-bars">
              <span
                v-if="x.month === selected"
                class="mrc-bubble"
                :style="{ bottom: barTop(x) + 10 + 'px' }"
              ><v-icon v-if="x.closed" icon="mdi-lock" size="12" class="mrc-bubble-lock" />{{ x.headline }}</span>
              <!-- Закрытый месяц — замок над столбиком, видно сразу на всей ленте. -->
              <span
                v-else-if="x.closed"
                class="mrc-lock"
                :style="{ bottom: barTop(x) + 6 + 'px' }"
                title="Месяц закрыт"
              ><v-icon icon="mdi-lock" size="12" /></span>
              <span class="mrc-stack">
                <span v-for="(s, k) in bars(x)" :key="k" class="mrc-seg-part" :style="s.style" />
                <span v-if="!bars(x).length && !x.unknown" class="mrc-zero" />
              </span>
            </span>
            <span class="mrc-label">{{ shortOf(x.month) }}</span>
            <span class="mrc-mark">
              <i v-if="x.current" class="mrc-now" />
            </span>
          </button>
          </template>
        </div>
      </div>
      <!-- Подробности месяца -->
      <div v-if="tipMonth" class="mrc-tip" :style="{ left: tipLeft + 'px' }">
        <slot name="tip" :month="tipMonth" :title="titleOf(tipMonth)" />
      </div>
      <button v-show="canRight" type="button" class="mrc-nav mrc-nav--r" aria-label="Позже" @click="scrollBy(1)">
        <v-icon icon="mdi-chevron-right" size="20" />
      </button>
    </div>

    <div v-if="hasData" class="mrc-legend">
      <slot name="legend" />
    </div>
  </div>
</template>

<style scoped>
.mrc {
  margin-top: 14px; padding: 18px 20px 12px; border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.mrc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.mrc-title { font-size: 16px; font-weight: 800; color: rgba(var(--v-theme-on-surface), 0.92); }
.mrc-sub { font-size: 12.5px; margin-top: 2px; color: rgba(var(--v-theme-on-surface), 0.55); }

.mrc-body { position: relative; margin-top: 10px; }
.mrc-viewport { overflow-x: auto; scrollbar-width: none; scroll-behavior: auto; }
.mrc-viewport::-webkit-scrollbar { display: none; }
.mrc-track { display: flex; gap: 4px; padding: 0 30px; min-width: max-content; }
.mrc-col {
  position: relative; width: 48px; flex: none; padding: 30px 0 4px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  border-radius: 10px; cursor: pointer; transition: background 0.15s;
}
.mrc-col:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.mrc-col--year::before {
  content: ''; position: absolute; left: -2px; top: 6px; bottom: 30px;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.14);
}
.mrc-year {
  position: absolute; top: 4px; left: 2px; font-size: 11.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.mrc-bars { position: relative; height: 132px; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
.mrc-stack {
  display: flex; flex-direction: column-reverse; width: 38px; border-radius: 5px 5px 0 0; overflow: hidden; gap: 1px;
  transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s;
}
.mrc-seg-part { display: block; width: 100%; }
.mrc-stack .mrc-seg-part:last-child { border-radius: 5px 5px 0 0; }
.mrc-lock {
  position: absolute; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.62);
  pointer-events: none;
}
.mrc-bubble-lock { margin-right: 4px; vertical-align: -1px; opacity: 0.85; }
.mrc-zero { display: block; width: 100%; height: 3px; border-radius: 2px 2px 0 0; background: rgba(var(--v-theme-on-surface), 0.14); }
.mrc-col .mrc-stack { opacity: 0.88; }
.mrc-col:hover .mrc-stack { opacity: 1; transform: translateY(-2px); }
.mrc-col--sel .mrc-stack { opacity: 1; box-shadow: 0 0 0 2px rgb(var(--v-theme-surface)), 0 0 0 4px rgba(var(--v-theme-on-surface), 0.82); }
.mrc-col--sel { background: rgba(var(--v-theme-on-surface), 0.045); }
.mrc-grid {
  position: absolute; left: 0; right: 0; height: 0; z-index: 0; pointer-events: none;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.1);
}
.mrc-grid span {
  position: absolute; right: 36px; top: -16px; font-size: 10.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.38); font-variant-numeric: tabular-nums;
}
.mrc-base {
  position: absolute; left: 0; right: 0; height: 0; z-index: 0; pointer-events: none;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.14);
}
.mrc-viewport { position: relative; z-index: 1; }
.mrc-bubble {
  position: absolute; left: 50%; transform: translateX(-50%); z-index: 1;
  padding: 4px 9px; border-radius: 6px; white-space: nowrap;
  font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums;
  background: #1f2433; color: #fff;
}
.mrc-bubble::after {
  content: ''; position: absolute; left: 50%; bottom: -4px; transform: translateX(-50%) rotate(45deg);
  width: 8px; height: 8px; background: #1f2433;
}
.mrc-label { font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.7); }
.mrc-col--sel .mrc-label { color: rgba(var(--v-theme-on-surface), 0.95); font-weight: 800; }
.mrc-col--future .mrc-label { color: rgba(var(--v-theme-on-surface), 0.42); }
.mrc-mark { height: 12px; display: flex; align-items: center; color: rgba(var(--v-theme-on-surface), 0.45); }
.mrc-now { width: 6px; height: 6px; border-radius: 50%; background: rgb(var(--v-theme-primary)); }

.mrc-nav {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 2;
  width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.75);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.mrc-nav--l { left: -6px; }
.mrc-nav--r { right: -6px; }

.mrc-legend {
  display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 8px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55);
}

.mrc-skel { display: flex; align-items: flex-end; gap: 14px; height: 170px; padding: 10px 8px 26px; }
.mrc-skel i {
  display: block; width: 36px; border-radius: 7px;
  background: linear-gradient(90deg, rgba(var(--v-theme-on-surface), 0.06), rgba(var(--v-theme-on-surface), 0.11), rgba(var(--v-theme-on-surface), 0.06));
  background-size: 200% 100%; animation: mrc-shimmer 1.2s linear infinite;
}
@keyframes mrc-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.mrc-empty { padding: 26px 0 14px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }

@media (max-width: 600px) {
  .mrc { padding: 14px 12px 10px; }
  .mrc-col { width: 38px; }
  .mrc-stack { width: 30px; }
  .mrc-grid span { right: 2px; }
  .mrc-nav { display: none; }
}

.mrc-tip {
  position: absolute; top: -10px; z-index: 5; width: 260px; pointer-events: none;
  min-width: 240px; padding: 12px 14px; border-radius: 12px;
  background: #1f2433; color: #fff; font-size: 12.5px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
</style>

<style>
/* Подсказка и легенда — содержимое обёрток (слоты), поэтому без scoped. */
.mrc-legend .rc-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.mrc-legend .rc-dot, .mrc-tip .rc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.mrc-tip .rc-tip-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 14px; }
.mrc-tip .rc-tag { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(255, 255, 255, 0.14); }
.mrc-tip .rc-tag--now { background: rgba(99, 102, 241, 0.35); }
.mrc-tip .rc-tag--future { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.75); }
.mrc-tip .rc-tip-line { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; color: rgba(255, 255, 255, 0.78); }
.mrc-tip .rc-tip-line b { color: #fff; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mrc-tip .rc-tip-sub { padding-left: 2px; }
.mrc-tip .rc-tip-sub span { display: inline-flex; align-items: center; gap: 6px; }
.mrc-tip .rc-tip-sep { height: 1px; margin: 6px 0; background: rgba(255, 255, 255, 0.12); }
.mrc-tip .rc-tip-foot { margin-top: 8px; font-size: 11.5px; color: rgba(255, 255, 255, 0.5); }
</style>
