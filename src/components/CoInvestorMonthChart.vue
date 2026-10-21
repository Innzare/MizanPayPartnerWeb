<script setup lang="ts">
/**
 * Месяцы кассы — столбики над таблицей инвесторов (как «график цен» у
 * Aviasales, только столбик — месяц). Видно сразу весь путь кассы: прибыль,
 * её раздел с инвесторами, долг инвесторам; будущие месяцы — прогноз по
 * графикам платежей. Наведение — подробности месяца, нажатие — открыть его
 * в таблице.
 *
 * Цифры приходят с сервера (GET /co-investors/month/series) и совпадают с
 * карточками и таблицей выбранного месяца.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { formatCurrency } from '@/utils/formatters'

export interface SeriesMonth {
  month: string
  future: boolean
  current: boolean
  closed: boolean
  gross: number
  investors: number
  partner: number
  expectedGross: number
  expectedInvestors: number
  paid: number
  reinvested: number
  owedEnd: number | null
  capitalEnd: number | null
}

const props = defineProps<{ months: SeriesMonth[]; selected: string; loading?: boolean }>()
const emit = defineEmits<{ (e: 'select', month: string): void }>()

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

type Mode = 'profit' | 'debt'
const mode = ref<Mode>('profit')

function parts(m: string) {
  const [y, mm] = m.split('-').map(Number)
  return { y: y!, m: mm! }
}
const shortOf = (m: string) => MONTHS_SHORT[parts(m).m - 1]
const titleOf = (m: string) => `${MONTHS_NOM[parts(m).m - 1]} ${parts(m).y}`

/** Высота столбика — от самого большого месяца графика. */
const scaleMax = computed(() => {
  let max = 0
  for (const x of props.months) {
    const v = mode.value === 'profit'
      ? Math.max(x.gross, 0) + (x.future || x.current ? Math.max(x.expectedGross, 0) : 0)
      : Math.max(x.owedEnd ?? 0, 0)
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

/** Части столбика снизу вверх. */
function segments(x: SeriesMonth) {
  if (mode.value === 'debt') {
    return x.owedEnd != null ? [{ cls: 'cmc-s-debt', h: h(x.owedEnd) }] : []
  }
  const inv = Math.max(Math.min(x.investors, x.gross), 0)
  const me = Math.max(x.gross - inv, 0)
  const out = [
    { cls: 'cmc-s-inv', h: h(inv) },
    { cls: 'cmc-s-me', h: h(me) },
  ]
  if (x.future || x.current) out.push({ cls: 'cmc-s-exp', h: h(x.expectedGross) })
  return out.filter((s) => s.h > 0)
}
/** Число в пузыре над выбранным месяцем. */
function headline(x: SeriesMonth) {
  if (mode.value === 'debt') return x.owedEnd == null ? '—' : formatCurrency(x.owedEnd)
  if (x.future) return `≈ ${formatCurrency(x.expectedGross)}`
  return formatCurrency(x.gross)
}
function barTop(x: SeriesMonth) {
  return segments(x).reduce((t, s) => t + s.h, 0)
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
const tipMonth = ref<SeriesMonth | null>(null)
const tipLeft = ref(0)
const TIP_W = 260
function showTip(x: SeriesMonth, e: Event) {
  const col = e.currentTarget as HTMLElement | null
  const el = viewport.value
  if (!col || !el) return
  // Сбоку от столбика, чтобы он оставался виден: справа, у правого края — слева.
  const left = col.offsetLeft - el.scrollLeft
  const right = left + col.offsetWidth
  tipLeft.value = right + 8 + TIP_W <= el.clientWidth ? right + 8 : Math.max(left - 8 - TIP_W, 0)
  tipMonth.value = x
}
function hideTip() { tipMonth.value = null }

/** Подпись года — у первого столбика и у каждого января. */
function showYear(i: number) {
  const m = props.months[i]!.month
  return i === 0 || m.endsWith('-01')
}

const hasAny = computed(() => props.months.some((x) => x.gross || x.expectedGross || x.owedEnd))
</script>

<template>
  <div class="cmc">
    <div class="cmc-head">
      <div>
        <div class="cmc-title">Месяцы кассы</div>
        <div class="cmc-sub">
          <template v-if="mode === 'profit'">Прибыль кассы по месяцам и её раздел. Нажмите на месяц, чтобы открыть его.</template>
          <template v-else>Сколько вы должны инвесторам на конец каждого месяца.</template>
        </div>
      </div>
      <div class="cmc-seg" role="tablist">
        <button type="button" class="cmc-seg-btn" :class="{ 'cmc-seg-btn--on': mode === 'profit' }" @click="mode = 'profit'">Прибыль</button>
        <button type="button" class="cmc-seg-btn" :class="{ 'cmc-seg-btn--on': mode === 'debt' }" @click="mode = 'debt'">Долг инвесторам</button>
      </div>
    </div>

    <div v-if="loading && !months.length" class="cmc-skel">
      <i v-for="n in 14" :key="n" :style="{ height: 30 + ((n * 37) % 90) + 'px' }" />
    </div>
    <div v-else-if="!hasAny" class="cmc-empty">По этой кассе пока нет ни прибыли, ни долгов инвесторам.</div>
    <div v-else class="cmc-body">
      <div v-for="g in gridLines" :key="g.top" class="cmc-grid" :style="{ top: g.top + 'px' }"><span>{{ g.label }}</span></div>
      <div class="cmc-base" :style="{ top: GRID_TOP + BAR_H + 'px' }" />
      <button v-show="canLeft" type="button" class="cmc-nav cmc-nav--l" aria-label="Раньше" @click="scrollBy(-1)">
        <v-icon icon="mdi-chevron-left" size="20" />
      </button>
      <div ref="viewport" class="cmc-viewport" @scroll.passive="updateArrows(); hideTip()">
        <div class="cmc-track">
          <template v-for="(x, i) in months" :key="x.month">
          <button
            type="button"
            class="cmc-col"
            :class="{
              'cmc-col--sel': x.month === selected,
              'cmc-col--future': x.future,
              'cmc-col--year': showYear(i) && i > 0,
            }"
            :data-month="x.month"
            @click="emit('select', x.month)"
            @mouseenter="showTip(x, $event)"
            @mouseleave="hideTip"
            @focus="showTip(x, $event)"
            @blur="hideTip"
          >
            <span v-if="showYear(i)" class="cmc-year">{{ x.month.slice(0, 4) }}</span>
            <span class="cmc-bars">
              <span
                v-if="x.month === selected"
                class="cmc-bubble"
                :style="{ bottom: barTop(x) + 10 + 'px' }"
              >{{ headline(x) }}</span>
              <span class="cmc-stack">
                <span v-for="(s, k) in segments(x)" :key="k" class="cmc-seg-part" :class="s.cls" :style="{ height: s.h + 'px' }" />
                <span v-if="!segments(x).length && !(mode === 'debt' && x.owedEnd == null)" class="cmc-zero" />
              </span>
            </span>
            <span class="cmc-label">{{ shortOf(x.month) }}</span>
            <span class="cmc-mark">
              <v-icon v-if="x.closed" icon="mdi-lock" size="11" />
              <i v-else-if="x.current" class="cmc-now" />
            </span>
          </button>
          </template>
        </div>
      </div>
      <!-- Подробности месяца -->
      <div v-if="tipMonth" class="cmc-tip cmc-tip--float" :style="{ left: tipLeft + 'px' }">
        <div class="cmc-tip-head">
          <b>{{ titleOf(tipMonth.month) }}</b>
          <span v-if="tipMonth.closed" class="cmc-tag">закрыт</span>
          <span v-else-if="tipMonth.current" class="cmc-tag cmc-tag--now">идёт сейчас</span>
          <span v-else-if="tipMonth.future" class="cmc-tag cmc-tag--future">прогноз</span>
        </div>
        <template v-if="!tipMonth.future">
          <div class="cmc-tip-line"><span>Прибыль кассы</span><b>{{ formatCurrency(tipMonth.gross) }}</b></div>
          <div class="cmc-tip-line cmc-tip-sub"><span><i class="cmc-dot cmc-s-inv" />Инвесторам</span><b>{{ formatCurrency(tipMonth.investors) }}</b></div>
          <div class="cmc-tip-line cmc-tip-sub"><span><i class="cmc-dot cmc-s-me" />Вам</span><b>{{ formatCurrency(tipMonth.partner) }}</b></div>
          <div class="cmc-tip-sep" />
          <div class="cmc-tip-line"><span>Выплачено инвесторам</span><b>{{ formatCurrency(tipMonth.paid) }}</b></div>
          <div v-if="tipMonth.reinvested" class="cmc-tip-line"><span>Реинвест</span><b>{{ formatCurrency(tipMonth.reinvested) }}</b></div>
          <div class="cmc-tip-line"><span>Долг на конец месяца</span><b class="cmc-c-debt">{{ formatCurrency(tipMonth.owedEnd ?? 0) }}</b></div>
          <div v-if="tipMonth.capitalEnd != null" class="cmc-tip-line"><span>Капитал инвесторов</span><b>{{ formatCurrency(tipMonth.capitalEnd) }}</b></div>
        </template>
        <template v-if="(tipMonth.future || tipMonth.current) && tipMonth.expectedGross > 0">
          <div v-if="tipMonth.current" class="cmc-tip-sep" />
          <div class="cmc-tip-line"><span>Ещё ожидается прибыли</span><b>{{ formatCurrency(tipMonth.expectedGross) }}</b></div>
          <div class="cmc-tip-line cmc-tip-sub"><span>из неё инвесторам ≈</span><b>{{ formatCurrency(tipMonth.expectedInvestors) }}</b></div>
        </template>
        <div v-if="tipMonth.future && !(tipMonth.expectedGross > 0)" class="cmc-tip-line"><span>Платежей по графику нет</span></div>
        <div class="cmc-tip-foot">Нажмите, чтобы открыть месяц</div>
      </div>
      <button v-show="canRight" type="button" class="cmc-nav cmc-nav--r" aria-label="Позже" @click="scrollBy(1)">
        <v-icon icon="mdi-chevron-right" size="20" />
      </button>
    </div>

    <div v-if="hasAny" class="cmc-legend">
      <template v-if="mode === 'profit'">
        <span><i class="cmc-dot cmc-s-inv" />Инвесторам</span>
        <span><i class="cmc-dot cmc-s-me" />Вам</span>
        <span><i class="cmc-dot cmc-s-exp" />Ожидается</span>
      </template>
      <span v-else><i class="cmc-dot cmc-s-debt" />Долг инвесторам на конец месяца</span>
      <span><v-icon icon="mdi-lock" size="11" /> закрыт</span>
    </div>
  </div>
</template>

<style scoped>
.cmc {
  margin-top: 14px; padding: 18px 20px 12px; border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.cmc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cmc-title { font-size: 16px; font-weight: 800; color: rgba(var(--v-theme-on-surface), 0.92); }
.cmc-sub { font-size: 12.5px; margin-top: 2px; color: rgba(var(--v-theme-on-surface), 0.55); }
.cmc-seg { display: inline-flex; padding: 3px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.07); }
.cmc-seg-btn {
  padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65); transition: background 0.15s, color 0.15s;
}
.cmc-seg-btn--on { background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.92); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }

.cmc-body { position: relative; margin-top: 10px; }
.cmc-viewport { overflow-x: auto; scrollbar-width: none; scroll-behavior: auto; }
.cmc-viewport::-webkit-scrollbar { display: none; }
.cmc-track { display: flex; gap: 4px; padding: 0 30px; min-width: max-content; }
.cmc-col {
  position: relative; width: 48px; flex: none; padding: 30px 0 4px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  border-radius: 10px; cursor: pointer; transition: background 0.15s;
}
.cmc-col:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.cmc-col--year::before {
  content: ''; position: absolute; left: -2px; top: 6px; bottom: 30px;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.14);
}
.cmc-year {
  position: absolute; top: 4px; left: 2px; font-size: 11.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.cmc-bars { position: relative; height: 132px; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
.cmc-stack {
  display: flex; flex-direction: column-reverse; width: 38px; border-radius: 5px 5px 0 0; overflow: hidden; gap: 1px;
  transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s;
}
.cmc-seg-part { display: block; width: 100%; }
.cmc-zero { display: block; width: 100%; height: 3px; border-radius: 2px 2px 0 0; background: rgba(var(--v-theme-on-surface), 0.14); }
/* Цвета — насыщенные, но спокойные: инвесторы — индиго, вы — изумрудный. */
.cmc-s-inv { background: linear-gradient(180deg, #6a6ff0 0%, #5157dc 100%); }
.cmc-s-me { background: linear-gradient(180deg, #19b88a 0%, #0b9a70 100%); }
.cmc-s-exp {
  background: repeating-linear-gradient(135deg, rgba(99, 102, 241, 0.16) 0 4px, rgba(99, 102, 241, 0.07) 4px 8px);
  box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.35);
}
.cmc-stack .cmc-s-exp { border-radius: 5px 5px 0 0; }
.cmc-s-debt { background: linear-gradient(180deg, #f2a93b 0%, #dd8a14 100%); }
.cmc-col .cmc-stack { opacity: 0.88; }
.cmc-col:hover .cmc-stack { opacity: 1; transform: translateY(-2px); }
.cmc-col--sel .cmc-stack { opacity: 1; box-shadow: 0 0 0 2px rgb(var(--v-theme-surface)), 0 0 0 4px rgba(var(--v-theme-on-surface), 0.82); }
.cmc-col--sel { background: rgba(var(--v-theme-on-surface), 0.045); }
.cmc-grid {
  position: absolute; left: 0; right: 0; height: 0; z-index: 0; pointer-events: none;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.1);
}
.cmc-grid span {
  position: absolute; right: 36px; top: -16px; font-size: 10.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.38); font-variant-numeric: tabular-nums;
}
.cmc-base {
  position: absolute; left: 0; right: 0; height: 0; z-index: 0; pointer-events: none;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.14);
}
.cmc-viewport { position: relative; z-index: 1; }
.cmc-bubble {
  position: absolute; left: 50%; transform: translateX(-50%); z-index: 1;
  padding: 4px 9px; border-radius: 6px; white-space: nowrap;
  font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums;
  background: #1f2433; color: #fff;
}
.cmc-bubble::after {
  content: ''; position: absolute; left: 50%; bottom: -4px; transform: translateX(-50%) rotate(45deg);
  width: 8px; height: 8px; background: #1f2433;
}
.cmc-label { font-size: 13px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.7); }
.cmc-col--sel .cmc-label { color: rgba(var(--v-theme-on-surface), 0.95); font-weight: 800; }
.cmc-col--future .cmc-label { color: rgba(var(--v-theme-on-surface), 0.42); }
.cmc-mark { height: 12px; display: flex; align-items: center; color: rgba(var(--v-theme-on-surface), 0.45); }
.cmc-now { width: 6px; height: 6px; border-radius: 50%; background: rgb(var(--v-theme-primary)); }

.cmc-nav {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 2;
  width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.75);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.cmc-nav--l { left: -6px; }
.cmc-nav--r { right: -6px; }

.cmc-legend {
  display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 8px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55);
}
.cmc-legend > span { display: inline-flex; align-items: center; gap: 5px; }
.cmc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }

.cmc-skel { display: flex; align-items: flex-end; gap: 14px; height: 170px; padding: 10px 8px 26px; }
.cmc-skel i {
  display: block; width: 36px; border-radius: 7px;
  background: linear-gradient(90deg, rgba(var(--v-theme-on-surface), 0.06), rgba(var(--v-theme-on-surface), 0.11), rgba(var(--v-theme-on-surface), 0.06));
  background-size: 200% 100%; animation: cmc-shimmer 1.2s linear infinite;
}
@keyframes cmc-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.cmc-empty { padding: 26px 0 14px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }

@media (max-width: 600px) {
  .cmc { padding: 14px 12px 10px; }
  .cmc-col { width: 38px; }
  .cmc-stack { width: 30px; }
  .cmc-grid span { right: 2px; }
  .cmc-nav { display: none; }
}

.cmc-tip--float {
  position: absolute; top: -10px; z-index: 5; width: 260px; pointer-events: none;
}
.cmc-tip {
  min-width: 240px; padding: 12px 14px; border-radius: 12px;
  background: #1f2433; color: #fff; font-size: 12.5px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
.cmc-tip-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 14px; }
.cmc-tag { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(255, 255, 255, 0.14); }
.cmc-tag--now { background: rgba(99, 102, 241, 0.35); }
.cmc-tag--future { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.75); }
.cmc-tip-line { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; color: rgba(255, 255, 255, 0.78); }
.cmc-tip-line b { color: #fff; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cmc-tip-sub { padding-left: 2px; }
.cmc-tip-sub span { display: inline-flex; align-items: center; gap: 6px; }
.cmc-tip-sep { height: 1px; margin: 6px 0; background: rgba(255, 255, 255, 0.12); }
.cmc-tip .cmc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.cmc-tip .cmc-s-inv { background: #8b8ff5; }
.cmc-tip .cmc-s-me { background: #2fd3a0; }
.cmc-tip .cmc-c-debt { color: #f5b14c; }
.cmc-tip-foot { margin-top: 8px; font-size: 11.5px; color: rgba(255, 255, 255, 0.5); }
</style>
