<script setup lang="ts">
/**
 * Живой график сделки в окне оплаты.
 *
 * Показывает весь график и то, каким он станет после подтверждения: какая
 * строка оплачивается, какие суммы изменятся, что закроется. Раньше партнёр
 * узнавал последствия нестандартной суммы только после отметки.
 *
 * Компонент презентационный: ни одного расчёта внутри. Все суммы приходят
 * готовыми из общего слоя `utils/paymentMath` через родителя — иначе окно
 * показывало бы одно, а сервер делал другое.
 */
import { computed, ref, watch, nextTick, useTemplateRef } from 'vue'
import { formatCurrency } from '@/utils/formatters'
import type { Payment } from '@/types'

const props = withDefaults(
  defineProps<{
    /** Весь график сделки. */
    schedule: Payment[]
    /** Строка, которая оплачивается сейчас. */
    targetId: string
    /** Введённая сумма — она встаёт в целевую строку. */
    entered: number | null
    /** Превью перерасчёта: новые суммы и строки, закрывающиеся переплатой. */
    preview: { rows: Array<{ id: string; amount: number }>; closedIds: string[] }
    /** Остаток прощается: открытые строки не переносятся, а списываются. */
    forgive?: boolean
    /** Перерасчёт реально применяется (сумма ≠ плановой). */
    redistributing?: boolean
  }>(),
  { forgive: false, redistributing: false },
)

const SETTLED = ['PAID', 'CLOSED_EARLY']

/** Уже закрытые строки — прячем в свёрнутую группу, чтобы не мешали. */
const settledRows = computed(() => props.schedule.filter((p) => SETTLED.includes(p.status)))
const settledSum = computed(() => settledRows.value.reduce((s, p) => s + p.amount, 0))
const showSettled = ref(false)

/** Открытые строки и целевая — в порядке графика. */
const activeRows = computed(() =>
  props.schedule
    .filter((p) => !SETTLED.includes(p.status) || p.id === props.targetId)
    .sort((a, b) => a.number - b.number),
)

type RowState = 'target' | 'changed' | 'closing' | 'forgiven' | 'unchanged'

function stateOf(p: Payment): RowState {
  if (p.id === props.targetId) return 'target'
  // Прощение списывает всё, что осталось открытым.
  if (props.forgive) return 'forgiven'
  // Дальше — только то, что реально сделает перерасчёт. Полагаться на режим
  // нельзя: досрочная оплата с недостачей не закрывает график, а пересчитывает
  // его, и пометка «закроется» врала бы партнёру.
  if (props.preview.closedIds.includes(p.id)) return 'closing'
  const next = newAmount(p.id)
  if (next === null) return 'unchanged'
  if (Math.round(next) === 0) return 'closing'
  return Math.round(next) !== Math.round(p.amount) ? 'changed' : 'unchanged'
}

/** Новая сумма строки после перерасчёта, если она меняется. */
function newAmount(id: string): number | null {
  if (!props.redistributing) return null
  const r = props.preview.rows.find((x) => x.id === id)
  return r ? r.amount : null
}

/** «20 авг. 2026» — срок платежа. Год нужен: графики бывают на несколько лет. */
function dayLabel(p: Payment): string {
  return new Date(p.dueDate).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Графики бывают на 36–60 месяцев: при открытии подкручиваем список к строке,
// которую оплачивают, иначе партнёр видит начало прошлогоднего графика.
const listRef = useTemplateRef<HTMLElement>('listRef')
watch(
  () => props.targetId,
  async () => {
    await nextTick()
    const list = listRef.value
    const el = list?.querySelector('.sched-row--target') as HTMLElement | null
    if (!el || !list) return
    // Ставим целевую строку сразу под шапкой списка: она главная в окне и
    // должна быть видна с первого взгляда, а не оставаться выше прокрутки.
    const top = el.offsetTop - list.offsetTop
    list.scrollTop = Math.max(0, Math.min(top - 8, list.scrollHeight - list.clientHeight))
  },
  { immediate: true },
)
</script>

<template>
  <div class="sched">

    <!-- Оплаченное сворачиваем: в длинном графике оно занимает весь экран,
         а решение принимается по открытым строкам. -->
    <button v-if="settledRows.length" type="button" class="sched-settled" @click="showSettled = !showSettled">
      <v-icon :icon="showSettled ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="15" />
      <span>Оплачено ранее: {{ settledRows.length }} на {{ formatCurrency(settledSum) }}</span>
    </button>

    <div ref="listRef" class="sched-list">
      <template v-if="showSettled">
        <div v-for="p in settledRows" :key="p.id" class="sched-row sched-row--paid">
          <span class="sched-when">№{{ p.number }} · {{ dayLabel(p) }}</span>
          <span class="sched-amount">{{ formatCurrency(p.amount) }}</span>
          <span class="sched-mark">оплачен</span>
        </div>
      </template>

      <div
        v-for="p in activeRows"
        :key="p.id"
        class="sched-row"
        :class="`sched-row--${stateOf(p)}`"
      >
        <span class="sched-when">№{{ p.number }} · {{ dayLabel(p) }}</span>

        <template v-if="stateOf(p) === 'target'">
          <span class="sched-amount">
            <span v-if="entered !== null && Math.round(entered) !== Math.round(p.amount)" class="sched-was">
              {{ formatCurrency(p.amount) }}
            </span>
            {{ formatCurrency(entered ?? p.amount) }}
          </span>
          <span class="sched-mark">оплачивается сейчас</span>
        </template>

        <template v-else-if="stateOf(p) === 'forgiven'">
          <span class="sched-amount sched-amount--muted">{{ formatCurrency(p.amount) }}</span>
          <span class="sched-mark">долг прощён</span>
        </template>

        <template v-else-if="stateOf(p) === 'closing'">
          <span class="sched-amount sched-amount--muted">{{ formatCurrency(p.amount) }}</span>
          <span class="sched-mark">закроется</span>
        </template>

        <template v-else-if="stateOf(p) === 'changed'">
          <span class="sched-amount">
            <span class="sched-was">{{ formatCurrency(p.amount) }}</span>
            {{ formatCurrency(newAmount(p.id) ?? p.amount) }}
          </span>
          <span class="sched-mark">пересчитан</span>
        </template>

        <template v-else>
          <span class="sched-amount">{{ formatCurrency(p.amount) }}</span>
          <span class="sched-mark"></span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Рамки и заголовка нет: компонент вставляют туда, где уже сказано, что это
   график платежей, и вторая рамка внутри рамки только шумела. */
.sched {
  border-radius: 10px;
  overflow: hidden;
}
.sched-head {
  display: flex; align-items: center; gap: 6px;
  padding: 9px 12px;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.sched-settled {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 8px 12px; cursor: pointer;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.sched-settled:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
/* overflow-x скрыт намеренно: строка «№10 · 20 окт. 2026 г. · 15 000 ₽ ·
   оплачивается сейчас» шире экрана телефона и растягивала всё окно. */
.sched-list { max-height: 260px; overflow-y: auto; overflow-x: hidden; }
.sched-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.sched-row:last-child { border-bottom: none; }
.sched-when {
  color: rgba(var(--v-theme-on-surface), 0.7);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sched-amount {
  font-weight: 600; white-space: nowrap;
  /* Суммы меняются на каждый ввод — плавный переход цвета показывает, что
     строка «ожила», без анимационных библиотек. */
  transition: color 0.15s ease;
}
.sched-amount--muted { color: rgba(var(--v-theme-on-surface), 0.4); text-decoration: line-through; }
.sched-was {
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.4);
  text-decoration: line-through;
  margin-right: 6px;
}
.sched-mark {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap;
  text-align: right;
}

.sched-row--paid { opacity: 0.6; }
.sched-row--target {
  background: rgba(var(--v-theme-primary), 0.07);
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-primary));
}
.sched-row--target .sched-mark { color: rgb(var(--v-theme-primary)); font-weight: 600; }
.sched-row--changed .sched-mark { color: #d97706; }
.sched-row--changed .sched-amount { color: #d97706; }
.sched-row--closing .sched-mark { color: #0ea5e9; }
.sched-row--forgiven { background: rgba(4, 120, 87, 0.05); }
.sched-row--forgiven .sched-mark { color: #047857; font-weight: 600; }

/* На телефоне место на вес золота: подписи мельче, отступы плотнее. */
@media (max-width: 480px) {
  .sched-row { gap: 6px; padding: 8px 10px; font-size: 12.5px; }
  .sched-mark { font-size: 10.5px; }
}

@media (prefers-reduced-motion: reduce) {
  .sched-amount { transition: none; }
}
</style>
