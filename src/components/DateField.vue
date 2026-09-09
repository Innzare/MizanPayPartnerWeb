<script setup lang="ts">
/**
 * Поле даты: печатать и выбирать мышкой можно одновременно.
 *
 * Заменяет `<input type="date">`, у которого три отдельные клетки ДД/ММ/ГГГГ,
 * клик попадает в случайную из них, а чтобы добраться до года рождения, нужно
 * листать месяцы десятками.
 *
 * Контракт значения тот же, что был: строка `YYYY-MM-DD`, пусто — `''`.
 * Менять его нельзя — эта строка уходит в платежи, графики и отчёты.
 *
 * Наружу значение уходит только по завершённому действию: клик по дню, кнопка,
 * Enter или уход из поля. Пока человек набирает цифры, календарь подсвечивает
 * дату, но `v-model` молчит — иначе формы, которые сохраняются на каждое
 * изменение, отправляли бы на сервер полуфабрикаты.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useIsMobile } from '@/composables/useIsMobile'
import {
  dateToIso,
  describeIso,
  formatDateInput,
  isWithin,
  isoToDate,
  maskDateText,
  parseDateInput,
  shiftIso,
  todayIso,
} from '@/utils/dateInput'

const props = withDefaults(
  defineProps<{
    /** Значение в формате `YYYY-MM-DD`; пусто — `''`. */
    modelValue?: string | null
    label?: string
    placeholder?: string
    /** Нижняя и верхняя границы, тоже `YYYY-MM-DD`. */
    min?: string | null
    max?: string | null
    disabled?: boolean
    clearable?: boolean
    /** Открывать календарь сразу на выборе года — для дат рождения. */
    openTo?: 'day' | 'year'
    /** Кнопки «Сегодня · Вчера · Завтра · Через неделю». */
    presets?: boolean
    density?: 'default' | 'comfortable' | 'compact'
    variant?: 'outlined' | 'solo-filled' | 'plain' | 'underlined' | 'filled'
    hideDetails?: boolean
    /** Своё оформление вместо Vuetify-поля — для форм с фирменными инпутами. */
    plain?: boolean
  }>(),
  {
    openTo: 'day',
    presets: true,
    density: 'comfortable',
    variant: 'outlined',
    hideDetails: true,
    clearable: true,
  },
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const { isMobile } = useIsMobile()

const open = ref(false)
const text = ref(formatDateInput(props.modelValue || ''))
/** Дата, которую человек «нащупал» вводом или стрелками, но ещё не подтвердил. */
const tentative = ref(props.modelValue || '')

// Значение могли поменять снаружи (сброс формы, загрузка карточки) — тогда
// текст в поле переписываем, но только если человек его сейчас не правит.
watch(
  () => props.modelValue,
  (v) => {
    if (open.value) return
    text.value = formatDateInput(v || '')
    tentative.value = v || ''
  },
)

const inputRef = ref<HTMLInputElement | null>(null)
/**
 * На телефоне тап по полю открывает панель снизу, а не клавиатуру: иначе они
 * дерутся за низ экрана. Кнопка «Ввести» переключает поле в режим набора —
 * на это время снимаем readonly (иначе клавиатура не появится) и не даём
 * фокусу снова открыть панель.
 */
const typing = ref(false)
const readonlyOnMobile = computed(() => isMobile.value && !typing.value)

const calendarDate = computed(() => isoToDate(tentative.value || props.modelValue || '') ?? undefined)
const outOfRange = computed(() => !!tentative.value && !isWithin(tentative.value, props.min, props.max))
/** Текст набран, но датой не является («31.02.2026», «99»). */
const invalid = computed(() => !!text.value.trim() && !parseDateInput(text.value))

/**
 * Подсказка под календарём. Разбираемая дата — словами, неразбираемая —
 * прямым сообщением по-русски: «Invalid Date» человеку ничего не говорит.
 */
const hint = computed(() => {
  if (invalid.value) return 'Некорректная дата'
  if (outOfRange.value) {
    if (props.min && tentative.value < props.min) return `Не раньше ${formatDateInput(props.min)}`
    if (props.max && tentative.value > props.max) return `Не позже ${formatDateInput(props.max)}`
    return 'Дата недоступна'
  }
  return describeIso(tentative.value)
})
const hintIsError = computed(() => invalid.value || outOfRange.value)

/** Дни вне разрешённого диапазона календарь показывает неактивными. */
function allowedDate(value: unknown): boolean {
  const iso = value instanceof Date ? dateToIso(value) : String(value ?? '')
  return isWithin(iso, props.min, props.max)
}

function commit(iso: string) {
  if (iso && !isWithin(iso, props.min, props.max)) return
  tentative.value = iso
  text.value = formatDateInput(iso)
  if (iso !== (props.modelValue || '')) emit('update:modelValue', iso)
}

function onInput(raw: string) {
  // Буквы и лишние знаки в дату не попадают, точки расставляются сами.
  const masked = maskDateText(raw)
  text.value = masked
  // Значение в самом поле ввода правим вручную: v-model мы не используем,
  // иначе Vue не перерисует input, когда отфильтрованный текст совпал с
  // предыдущим (набрали букву — на экране она бы осталась).
  const el = plainInputEl()
  if (el && el.value !== masked) el.value = masked

  if (!masked) {
    tentative.value = ''
    return
  }
  const parsed = parseDateInput(masked)
  if (parsed) tentative.value = parsed
}

/** Сам `<input>` — и в своём оформлении, и внутри Vuetify-поля. */
function plainInputEl(): HTMLInputElement | null {
  const raw = inputRef.value as unknown as { $el?: HTMLElement } | HTMLInputElement | null
  if (!raw) return null
  if (raw instanceof HTMLInputElement) return raw
  return (raw.$el?.querySelector('input') as HTMLInputElement) ?? null
}

function onFocus() {
  if (props.disabled) return
  // Режим набора с клавиатуры — панель снизу не показываем.
  if (typing.value) return
  open.value = true
}

/**
 * Уход из поля — момент истины: разобрали текст → сохраняем, не разобрали →
 * возвращаем прежнее значение, чтобы недопечатанное не стирало дату.
 */
function onBlur() {
  // В режиме набора на телефоне возвращаемся к обычному поведению поля.
  typing.value = false
  const raw = text.value.trim()
  if (!raw) {
    commit('')
    return
  }
  const parsed = parseDateInput(raw)
  if (parsed && isWithin(parsed, props.min, props.max)) {
    commit(parsed)
    return
  }
  // Дата вне разрешённых границ — НЕ подменяем молча прежним значением:
  // человек видел бы на экране одно, а сохранилось бы другое. Оставляем
  // введённое с пометкой об ошибке, чтобы он поправил сам.
  if (parsed) {
    tentative.value = parsed
    return
  }
  // Неразобранный текст (недопечатали) — возвращаем прежнее значение.
  text.value = formatDateInput(props.modelValue || '')
  tentative.value = props.modelValue || ''
}

function pickFromCalendar(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return
  commit(dateToIso(date))
  open.value = false
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Сегодня', days: 0 },
  { label: 'Вчера', days: -1 },
  { label: 'Завтра', days: 1 },
  { label: 'Через неделю', days: 7 },
]
/** Показываем только те кнопки, которые реально сработают при этих границах. */
const availablePresets = computed(() =>
  props.presets
    ? PRESETS.filter((p) => isWithin(shiftIso(todayIso(), { days: p.days }), props.min, props.max))
    : [],
)

function applyPreset(days: number) {
  commit(shiftIso(todayIso(), { days }))
  open.value = false
}

/**
 * Клавиши. Стрелки влево-вправо намеренно не трогаем — они нужны каретке
 * при правке текста.
 */
function onKeydown(e: KeyboardEvent) {
  if (props.disabled) return
  const base = tentative.value || props.modelValue || todayIso()

  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    const parsed = parseDateInput(text.value) ?? tentative.value
    if (parsed && !isWithin(parsed, props.min, props.max)) {
      // Оставляем попап открытым с видимой ошибкой — молча закрыть значило бы
      // сохранить не то, что человек видит в поле.
      tentative.value = parsed
      return
    }
    if (parsed) commit(parsed)
    open.value = false
    return
  }
  if (e.key === 'Escape') {
    open.value = false
    text.value = formatDateInput(props.modelValue || '')
    tentative.value = props.modelValue || ''
    return
  }
  const step = (delta: { days?: number; months?: number; years?: number }) => {
    e.preventDefault()
    // Гасим всплытие: при открытом меню Vuetify перехватывает стрелки и уводит
    // фокус внутрь календаря — тогда сдвиг даты с клавиатуры не работал бы.
    e.stopPropagation()
    open.value = true
    const next = shiftIso(base, delta)
    if (!isWithin(next, props.min, props.max)) return
    tentative.value = next
    text.value = formatDateInput(next)
  }
  if (e.key === 'ArrowUp') return step({ days: e.shiftKey ? 7 : 1 })
  if (e.key === 'ArrowDown') return step({ days: e.shiftKey ? -7 : -1 })
  if (e.key === 'PageUp') return step(e.shiftKey ? { years: 1 } : { months: 1 })
  if (e.key === 'PageDown') return step(e.shiftKey ? { years: -1 } : { months: -1 })
}

async function focusForTyping() {
  typing.value = true
  open.value = false
  await nextTick()
  inputRef.value?.focus()
}
</script>

<template>
  <div class="date-field" :class="{ 'date-field--plain': plain }">
    <!-- Календарём управляет само поле, меню только показывается рядом.
         `open-on-click="false"` здесь принципиален: со стандартным поведением
         клик по полю одновременно ставил фокус (открыть) и переключал меню
         (закрыть) — календарь мигал и сразу пропадал. При этом поле остаётся
         активатором, поэтому клик по нему не считается «щелчком мимо». -->
    <v-menu
      v-model="open"
      :open-on-click="false"
      :close-on-content-click="false"
      :disabled="disabled || isMobile"
      location="bottom start"
      offset="6"
      min-width="0"
      transition="fade-transition"
    >
      <template #activator="{ props: activator }">
      <div v-bind="activator" class="date-field-anchor">
        <!-- Своё оформление: поле выглядит как остальные инпуты формы. -->
        <div v-if="plain" class="date-field-plain-wrap">
          <input
            ref="inputRef"
            :value="text"
            type="text"
            inputmode="numeric"
            maxlength="10"
            :class="['date-field-plain-input', { 'date-field-plain-input--error': outOfRange || invalid }]"
            :placeholder="placeholder || 'дд.мм.гггг'"
            :disabled="disabled"
            :readonly="readonlyOnMobile"
            @input="onInput(($event.target as HTMLInputElement).value)"
            @focus="onFocus"
            @click="onFocus"
            @blur="onBlur"
            @keydown="onKeydown"
          />
          <!-- Крестик вместо календаря, когда есть что стереть: иначе вернуть
               «не задано» можно только выделив текст и нажав Backspace. -->
          <button
            v-if="clearable && text && !disabled"
            type="button"
            class="date-field-plain-clear"
            title="Очистить"
            @mousedown.prevent
            @click.stop="commit('')"
          >
            <v-icon icon="mdi-close" size="16" />
          </button>
          <v-icon v-else icon="mdi-calendar-outline" size="18" class="date-field-plain-icon" />
        </div>

        <v-text-field
          v-else
          ref="inputRef"
          :model-value="text"
          :label="label"
          :placeholder="placeholder || 'дд.мм.гггг'"
          :density="density"
          :variant="variant"
          :hide-details="hideDetails"
          :disabled="disabled"
          :clearable="clearable"
          :readonly="readonlyOnMobile"
          :error="outOfRange || invalid"
          inputmode="numeric"
          maxlength="10"
          rounded="lg"
          prepend-inner-icon="mdi-calendar-outline"
          @update:model-value="onInput"
          @focus="onFocus"
          @click="onFocus"
          @blur="onBlur"
          @keydown="onKeydown"
          @click:clear="commit('')"
        />
      </div>
      </template>

      <v-card v-if="!isMobile" rounded="lg" elevation="8" class="date-field-popup">
        <div v-if="availablePresets.length" class="date-field-presets">
          <button
            v-for="p in availablePresets"
            :key="p.label"
            type="button"
            class="date-field-preset"
            @click="applyPreset(p.days)"
          >{{ p.label }}</button>
        </div>
        <v-date-picker
          :model-value="calendarDate"
          :view-mode="openTo === 'year' ? 'year' : 'month'"
          :allowed-dates="allowedDate"
          :max="max || undefined"
          :min="min || undefined"
          show-adjacent-months
          hide-header
          color="primary"
          @update:model-value="pickFromCalendar"
        />
        <div
          v-if="hint"
          class="date-field-hint"
          :class="{ 'date-field-hint--error': hintIsError }"
          aria-live="polite"
        >{{ hint }}</div>
      </v-card>
    </v-menu>

    <!-- На телефоне календарь удобнее панелью снизу: до верха экрана
         большим пальцем не дотянуться, а ячейки нужны крупные. -->
    <v-bottom-sheet v-if="isMobile" v-model="open">
      <v-card rounded="t-xl" class="date-field-sheet">
        <div class="date-field-sheet-head">
          <span class="date-field-sheet-title">{{ label || 'Выберите дату' }}</span>
          <button type="button" class="date-field-sheet-keyboard" @click="focusForTyping">
            <v-icon icon="mdi-keyboard-outline" size="18" />
            Ввести
          </button>
        </div>
        <div v-if="availablePresets.length" class="date-field-presets">
          <button
            v-for="p in availablePresets"
            :key="p.label"
            type="button"
            class="date-field-preset"
            @click="applyPreset(p.days)"
          >{{ p.label }}</button>
        </div>
        <v-date-picker
          :model-value="calendarDate"
          :view-mode="openTo === 'year' ? 'year' : 'month'"
          :allowed-dates="allowedDate"
          :max="max || undefined"
          :min="min || undefined"
          show-adjacent-months
          hide-header
          color="primary"
          class="date-field-sheet-picker"
          @update:model-value="pickFromCalendar"
        />
      </v-card>
    </v-bottom-sheet>
  </div>
</template>

<style scoped>
.date-field {
  width: 100%;
}
.date-field-anchor {
  width: 100%;
}

/* Поле в фирменном оформлении форм — повторяет вид .field-input */
.date-field-plain-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.date-field-plain-input {
  width: 100%;
  height: 40px;
  padding: 0 38px 0 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}
.date-field-plain-input:focus {
  border-color: rgb(var(--v-theme-primary));
}
.date-field-plain-input:disabled {
  opacity: 0.6;
}
.date-field-plain-input--error {
  border-color: rgb(var(--v-theme-error));
}
.date-field-plain-clear {
  position: absolute;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer;
}
.date-field-plain-clear:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-on-surface));
}
.date-field-plain-icon {
  position: absolute;
  right: 12px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  pointer-events: none;
}

.date-field-popup {
  /* Ширина по календарю, а не по полю: у широкого поля пустая карточка
     растягивалась на всю его ширину. */
  width: max-content;
  padding-bottom: 4px;
}
.date-field-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px 4px;
}
.date-field-preset {
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.date-field-preset:hover {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
}
.date-field-hint {
  padding: 2px 14px 10px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.date-field-hint--error {
  color: rgb(var(--v-theme-error));
}

.date-field-sheet {
  padding-bottom: env(safe-area-inset-bottom, 8px);
}
.date-field-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 4px;
}
.date-field-sheet-title {
  font-size: 15px;
  font-weight: 600;
}
.date-field-sheet-keyboard {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px;
  cursor: pointer;
}
/* Крупные ячейки — пальцем в мелкие не попасть. */
.date-field-sheet-picker :deep(.v-date-picker-month__day) {
  width: 44px;
  height: 44px;
}
.date-field-sheet-picker :deep(.v-btn--size-default) {
  --v-btn-height: 40px;
}
</style>
