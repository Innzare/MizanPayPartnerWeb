<script setup lang="ts">
/**
 * Выбор города — наш собственный список, а не `v-combobox`.
 *
 * Смысл поля — чтобы один и тот же город не записывали пятью способами и по
 * нему можно было фильтровать. Поэтому подсказки идут в двух группах:
 *   • сначала города, которые партнёр уже заводил (с числом клиентов) — они
 *     точнее любого справочника и повторяют его собственные формулировки;
 *   • затем справочник населённых пунктов округа — на случай нового города.
 *
 * Ввод при этом остаётся свободным: сёл и хуторов в справочнике заведомо нет,
 * и запретить ввести своё было бы хуже, чем допустить разнобой. Поэтому в
 * списке есть строка поиска, и набранное можно оставить как есть отдельным
 * пунктом — сам по себе поиск ничего не подставляет: набранное «Гойское» молча
 * превратилось бы в похожее «Гойты» из списка.
 *
 * Список рисуется в конце страницы (`Teleport`) — иначе в модалке с прокруткой
 * он уезжал бы вместе с содержимым и срезался её границей.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { CITIES } from '@/constants/cities'
import { useClientCities } from '@/composables/useClientCities'
import { useAnchoredMenu } from '@/composables/useAnchoredMenu'

const props = withDefaults(
  defineProps<{
    modelValue?: string | null
    /** Что показать, когда город не выбран. */
    placeholder?: string
    disabled?: boolean
    /** Компактная высота — для строк внутри таблиц и узких форм. */
    compact?: boolean
  }>(),
  { placeholder: 'Город не указан' },
)

const emit = defineEmits<{ 'update:modelValue': [string | null] }>()

const { cities: partnerCities } = useClientCities()
const { open, anchor: root, menu, pos, flipped, toggle: toggleMenu, close, place } = useAnchoredMenu({ maxHeight: 340 })

const search = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

interface CityOption {
  value: string
  /** Приписка справа: сколько клиентов уже в этом городе. */
  hint?: string
}

/** Города партнёра идут первыми — это его собственные формулировки. */
const ownCities = computed<CityOption[]>(() =>
  partnerCities.value.map((c) => ({ value: c.city, hint: `${c.count} ${plural(c.count)}` })),
)

const restCities = computed<CityOption[]>(() => {
  const own = new Set(ownCities.value.map((o) => o.value.toLowerCase()))
  return CITIES.filter((name) => !own.has(name.toLowerCase())).map((name) => ({ value: name }))
})

function match(list: CityOption[]): CityOption[] {
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((c) => c.value.toLowerCase().includes(q))
}

const ownFound = computed(() => match(ownCities.value))
const restFound = computed(() => match(restCities.value))

/**
 * Набрали то, чего нет в списках, — предлагаем оставить как есть.
 *
 * Точное совпадение сюда не попадает: пункт «Оставить «Хасавюрт»» рядом с
 * готовым «Хасавюрт» из справочника только сбивает с толку.
 */
const custom = computed(() => {
  const q = search.value.trim()
  if (!q) return null
  const exists = [...ownCities.value, ...restCities.value].some(
    (c) => c.value.toLowerCase() === q.toLowerCase(),
  )
  return exists ? null : q
})

const nothingFound = computed(
  () => !ownFound.value.length && !restFound.value.length && !custom.value,
)

const label = computed(() => props.modelValue?.trim() || props.placeholder)

function pick(city: string | null) {
  const clean = city?.trim()
  // Пустая строка — это «не заполнено», а не город с пустым названием: иначе
  // в фильтре появится безымянный пункт.
  emit('update:modelValue', clean ? clean : null)
  close()
}

function onToggle() {
  toggleMenu(props.disabled)
}

// Поиск сбрасываем при каждом открытии и сразу ставим в него курсор: список
// длинный, и первое, что делают, — начинают печатать.
watch(open, async (isOpen) => {
  if (!isOpen) return
  search.value = ''
  await nextTick()
  searchInput.value?.focus()
})

// Список меняет высоту по мере фильтрации — координаты пересчитываем, иначе
// открытый вверх список «отрывается» от поля.
watch([ownFound, restFound, custom], () => {
  if (open.value) void place()
})

function plural(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'клиент'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'клиента'
  return 'клиентов'
}
</script>

<template>
  <div ref="root" class="ci">
    <button
      type="button"
      class="ci-btn"
      :class="{ 'ci-btn--open': open, 'ci-btn--compact': compact }"
      :disabled="disabled"
      @click="onToggle"
    >
      <v-icon icon="mdi-city-variant-outline" size="17" class="ci-btn-ico" />
      <span class="ci-label" :class="{ 'ci-label--dim': !modelValue }">{{ label }}</span>
      <v-icon
        v-if="modelValue && !disabled"
        icon="mdi-close"
        size="16"
        class="ci-clear"
        title="Очистить"
        @click.stop="pick(null)"
      />
      <v-icon icon="mdi-chevron-down" size="18" class="ci-chev" :class="{ 'ci-chev--rot': open }" />
    </button>

    <Teleport to="body">
      <Transition name="menu-pop">
        <div
          v-if="open"
          ref="menu"
          class="ci-menu"
          :class="{ 'menu-pop--up': flipped }"
          :style="{ top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px' }"
        >
          <div class="ci-search">
            <v-icon icon="mdi-magnify" size="16" />
            <input
              ref="searchInput"
              v-model="search"
              type="text"
              placeholder="Найти город или ввести свой"
              @keydown.enter.prevent="custom ? pick(custom) : undefined"
            />
          </div>

          <div class="ci-list">
            <!-- Своё написание — первым пунктом: если человек печатает название
                 села, он ищет не справочник, а способ его сохранить. -->
            <button v-if="custom" type="button" class="ci-item ci-item--custom" @click="pick(custom)">
              <v-icon icon="mdi-plus" size="15" />
              <span class="ci-item-label">Оставить «{{ custom }}»</span>
            </button>

            <template v-if="ownFound.length">
              <div class="ci-group">Ваши города</div>
              <button
                v-for="c in ownFound"
                :key="`own-${c.value}`"
                type="button"
                class="ci-item"
                :class="{ 'ci-item--on': c.value === modelValue }"
                @click="pick(c.value)"
              >
                <span class="ci-item-label">{{ c.value }}</span>
                <span v-if="c.hint" class="ci-item-hint">{{ c.hint }}</span>
                <v-icon v-if="c.value === modelValue" icon="mdi-check" size="15" class="ci-check" />
              </button>
            </template>

            <template v-if="restFound.length">
              <div class="ci-group">Справочник</div>
              <button
                v-for="c in restFound"
                :key="`all-${c.value}`"
                type="button"
                class="ci-item"
                :class="{ 'ci-item--on': c.value === modelValue }"
                @click="pick(c.value)"
              >
                <span class="ci-item-label">{{ c.value }}</span>
                <v-icon v-if="c.value === modelValue" icon="mdi-check" size="15" class="ci-check" />
              </button>
            </template>

            <div v-if="nothingFound" class="ci-empty">Ничего не найдено</div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ci { position: relative; }

.ci-btn {
  /* 40px — как у соседних полей формы клиента: разнобой по высоте виден
     сразу, когда поля стоят одно под другим. */
  width: 100%; height: 40px; padding: 0 12px;
  display: flex; align-items: center; gap: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9);
  text-align: left; cursor: pointer; transition: border-color 0.15s;
}
.ci-btn--compact { height: 36px; font-size: 13px; border-radius: 8px; }
.ci-btn:hover:not(:disabled) { border-color: rgba(var(--v-theme-on-surface), 0.22); }
.ci-btn--open { border-color: #047857; }
.ci-btn:disabled { opacity: 0.6; cursor: default; }
.ci-btn-ico { flex: none; color: rgba(var(--v-theme-on-surface), 0.4); }

.ci-label {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ci-label--dim { color: rgba(var(--v-theme-on-surface), 0.45); }
.ci-clear { flex: none; color: rgba(var(--v-theme-on-surface), 0.35); }
.ci-clear:hover { color: #dc2626; }
.ci-chev { flex: none; color: rgba(var(--v-theme-on-surface), 0.4); transition: transform 0.15s; }
.ci-chev--rot { transform: rotate(180deg); }

/* Список живёт в конце страницы, поэтому позиционируется от окна и должен
   быть выше модалок Vuetify (у них z-index 2400). */
.ci-menu {
  position: fixed; z-index: 2500;
  display: flex; flex-direction: column;
  max-height: 340px;
  padding: 6px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

/* Поиск закреплён сверху: список длинный, и прокручиваться должен он, а не
   поле ввода вместе с ним. */
.ci-search {
  display: flex; align-items: center; gap: 6px;
  flex: none; margin-bottom: 4px;
  padding: 0 8px; height: 34px; border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.ci-search input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.9);
}

.ci-list { overflow-y: auto; }

.ci-group {
  padding: 6px 8px 4px;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.ci-item {
  width: 100%; display: flex; align-items: center; gap: 8px;
  /* Пункты не должны слипаться: без просвета список читается как один
     сплошной блок, и глаз не отделяет строки друг от друга. */
  margin-bottom: 2px;
  padding: 8px; border: none; border-radius: 9px; background: transparent;
  text-align: left; cursor: pointer;
  font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.9);
}
.ci-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.ci-item--on { background: rgba(4, 120, 87, 0.08); }
.ci-item--custom { color: #047857; font-weight: 600; }
.ci-item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ci-item-hint { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); }
.ci-check { color: #047857; }

.ci-empty {
  padding: 10px 8px;
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}
</style>
