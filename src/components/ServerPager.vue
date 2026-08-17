<script setup lang="ts">
/**
 * Пагинация серверных списков. Один компонент на все разделы: сделки,
 * платежи и всё, что переедет на постраничную загрузку дальше.
 *
 * Панель прилипает к низу экрана, пока список виден — на 200 строках иначе
 * пришлось бы прокручивать таблицу до конца ради перехода на другую страницу.
 *
 * Прыжок по номеру обязателен: с сотней страниц добраться до 37-й кнопками
 * «вперёд» невозможно, а окно номеров показывает только соседние.
 */
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    page: number
    total: number
    perPage: number
    /** Блокировка на время запроса — чтобы не накликать несколько переходов. */
    busy?: boolean
    perPageOptions?: number[]
  }>(),
  { busy: false, perPageOptions: () => [25, 50, 100, 200] },
)

const emit = defineEmits<{
  (e: 'update:page', value: number): void
  (e: 'update:perPage', value: number): void
}>()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.perPage)))
const rangeFrom = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.perPage + 1))
const rangeTo = computed(() => Math.min(props.page * props.perPage, props.total))

/** Первая, последняя, соседи текущей и «…» вместо пропусков. */
const pageWindow = computed<{ key: string; num: number | null }[]>(() => {
  const total = pageCount.value
  const cur = props.page
  const nums = new Set<number>([1, total, cur - 1, cur, cur + 1])
  const shown = [...nums].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const out: { key: string; num: number | null }[] = []
  let prev = 0
  for (const n of shown) {
    if (prev && n - prev > 1) out.push({ key: `gap-${prev}`, num: null })
    out.push({ key: `p-${n}`, num: n })
    prev = n
  }
  return out
})

function goToPage(p: number) {
  const next = Math.min(Math.max(1, Math.round(p)), pageCount.value)
  if (next === props.page) return
  emit('update:page', next)
  // Таблица длинная: после смены страницы читать начинают сверху.
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// ── Активная страница как поле ввода ──
// Отдельного блока «перейти к странице» нет: номер текущей страницы прямо в
// ряду и есть поле. С сотней страниц добраться до 37-й стрелками невозможно,
// а окно номеров показывает только соседние.
const jumpValue = ref(String(props.page))
const jumpFocused = ref(false)

// Пока поле в фокусе, не перетираем то, что печатает партнёр.
watch(
  () => props.page,
  (v) => { if (!jumpFocused.value) jumpValue.value = String(v) },
)

/** Ширина по длине числа: поле не должно прыгать на переходе 9 → 10 → 100. */
const jumpWidth = computed(() => `${Math.max(52, String(props.page).length * 11 + 28)}px`)

function onJumpFocus(e: FocusEvent) {
  jumpFocused.value = true
  // Выделяем целиком: партнёр почти всегда печатает новый номер, а не правит
  // текущий по одной цифре.
  ;(e.target as HTMLInputElement).select()
}

function applyJump() {
  const n = parseInt(jumpValue.value, 10)
  if (!Number.isFinite(n)) {
    jumpValue.value = String(props.page) // мусор — молча возвращаем текущую
    return
  }
  const clamped = Math.min(Math.max(1, n), pageCount.value)
  jumpValue.value = String(clamped)
  goToPage(clamped)
}

function onJumpBlur() {
  jumpFocused.value = false
  applyJump()
}

/**
 * Escape — отказ от правки: возвращаем текущую страницу и снимаем фокус.
 * Элемент берём из события: поле живёт внутри v-for, и ref там собирается
 * в массив, а не в одиночную ссылку.
 */
function onJumpEscape(e: KeyboardEvent) {
  jumpValue.value = String(props.page)
  ;(e.target as HTMLInputElement).blur()
}

/** Стрелками вверх/вниз — соседние страницы, как в числовых полях. */
function onJumpStep(delta: number) {
  const n = parseInt(jumpValue.value, 10)
  const base = Number.isFinite(n) ? n : props.page
  const next = Math.min(Math.max(1, base + delta), pageCount.value)
  jumpValue.value = String(next)
}
</script>

<template>
  <div v-if="total > 0" class="sp-pager">
    <div class="sp-info">
      Показано {{ rangeFrom }}–{{ rangeTo }} из {{ total.toLocaleString('ru-RU') }}
    </div>

    <div class="sp-nav">
      <button class="sp-btn" :disabled="page <= 1 || busy" @click="goToPage(page - 1)">
        <v-icon icon="mdi-chevron-left" size="18" />
      </button>

      <template v-for="pw in pageWindow" :key="pw.key">
        <!-- Текущая страница — поле ввода прямо в ряду номеров: щёлкнул,
             напечатал 37, Enter — и ты там. Отдельный блок «перейти к
             странице» для этого не нужен. -->
        <input
          v-if="pw.num === page"
          v-model="jumpValue"
          class="sp-btn sp-current"
          :class="{ 'sp-current--editing': jumpFocused }"
          type="text"
          inputmode="numeric"
          :style="{ width: jumpWidth }"
          :disabled="busy"
          :title="`Страница ${page} из ${pageCount} — можно ввести номер`"
          :aria-label="`Страница ${page} из ${pageCount}. Введите номер страницы`"
          @focus="onJumpFocus"
          @blur="onJumpBlur"
          @keyup.enter="applyJump(); ($event.target as HTMLInputElement).blur()"
          @keydown.esc.prevent="onJumpEscape($event)"
          @keydown.up.prevent="onJumpStep(1)"
          @keydown.down.prevent="onJumpStep(-1)"
        />
        <button
          v-else
          class="sp-btn"
          :class="{ 'sp-btn--gap': pw.num === null }"
          :disabled="pw.num === null || busy"
          @click="pw.num && goToPage(pw.num)"
        >
          {{ pw.num ?? '…' }}
        </button>
      </template>

      <button class="sp-btn" :disabled="page >= pageCount || busy" @click="goToPage(page + 1)">
        <v-icon icon="mdi-chevron-right" size="18" />
      </button>
    </div>

    <div class="sp-size">
      <span class="sp-size-label">На странице</span>
      <select
        :value="perPage"
        class="sp-select"
        :disabled="busy"
        @change="emit('update:perPage', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="n in perPageOptions" :key="n" :value="n">{{ n }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.sp-pager {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  /* Отрицательные поля гасят padding карточки: панель во всю её ширину и
     вплотную к нижнему краю, без просвета под собой. */
  margin: 0 -16px -16px;
  padding: 14px 16px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 0 0 8px 8px;
  background: rgb(var(--v-theme-surface));
  /* Тень видна только в светлой теме; в тёмных панель отделяет граница выше —
     слои там различаются тоном, а не тенями. */
  box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.05);
}

.sp-info { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); }

.sp-nav { display: flex; align-items: center; gap: 4px; }

.sp-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s, border-color 0.15s;
}
.sp-btn:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.06); }
.sp-btn:disabled { opacity: 0.4; }
.sp-btn--active {
  background: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary));
  color: #fff;
}
.sp-btn--gap { border-color: transparent; pointer-events: none; opacity: 0.6; }

/* Текущая страница — поле ввода. Раньше она была залита сплошным цветом, как
   активная кнопка, и никто не догадывался, что в неё можно печатать. Теперь
   это именно поле: светлая подложка, отчётливая рамка и цветной жирный номер —
   так видно и что это ввод, и что страница текущая. */
.sp-current {
  font-family: inherit;
  font-weight: 700;
  text-align: center;
  /* Заметно шире соседних номеров: в поле помещается трёхзначная страница,
     и сама ширина подсказывает, что сюда вводят. */
  min-width: 52px;
  padding: 0 10px;
  border: 1.5px solid rgb(var(--v-theme-primary));
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  caret-color: rgb(var(--v-theme-primary));
  cursor: text;
  /* Ширина считается по длине номера — ячейка не прыгает на 9 → 10 → 100. */
  transition: width 0.12s ease, box-shadow 0.15s, background-color 0.15s;
  -moz-appearance: textfield;
}
.sp-current::-webkit-outer-spin-button,
.sp-current::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

/* При наведении подложка плотнее — но цифра остаётся читаемой. Прежний
   осветляющий фильтр выбеливал ячейку вместе с текстом. */
.sp-current:hover:not(:disabled) {
  background: rgba(var(--v-theme-primary), 0.16);
}

/* В фокусе — белая подложка и кольцо: ячейка окончательно превращается в
   обычное поле, в котором печатают. */
.sp-current--editing {
  outline: none;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.22);
}
.sp-current::selection { background: rgba(var(--v-theme-primary), 0.22); }
.sp-current:disabled { opacity: 0.45; cursor: default; }


.sp-size { display: flex; align-items: center; gap: 8px; }
.sp-size-label { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); }

.sp-select {
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 13px;
  color: inherit;
  cursor: pointer;
}
.sp-select option { color: initial; background: initial; }

/* Отдельных правил под тёмные темы не нужно: всё выше — на переменных темы. */

@media (max-width: 720px) {
  .sp-pager { justify-content: center; gap: 12px; }
  .sp-info { width: 100%; text-align: center; }
}
</style>