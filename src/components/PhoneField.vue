<script setup lang="ts">
/**
 * Поле телефона с выбором страны.
 *
 * Раньше поле принимало только российские номера: маска «+7 (###) ###-##-##»
 * и проверка на одиннадцать цифр. Клиента с азербайджанским или турецким
 * номером завести было нельзя.
 *
 * Значение наружу — строка E.164 («+79281234567», «+994501234567»), пусто —
 * `''`. Ровно так номера и хранились, поэтому существующие формы работают
 * по-прежнему; изменилось только то, что код страны теперь может быть любым.
 *
 * Россия остаётся страной по умолчанию — для обычного случая ничего не
 * поменялось: открыл форму, набрал десять цифр, сохранил.
 */
import { computed, nextTick, ref, watch } from 'vue'
// Стили флагов подключаются здесь, а не глобально: тогда сборщик уносит их
// в отдельный кусок и они не тормозят загрузку страниц без телефона.
import 'flag-icons/css/flag-icons.min.css'
import {
  DEFAULT_COUNTRY_ISO,
  PHONE_COUNTRIES,
  countryByIso,
  detectCountry,
  formatE164,
  nationalPart,
  parsePhoneLoose,
  phoneDigits,
  toE164,
  type PhoneCountry,
} from '@/utils/phone'

const props = withDefaults(
  defineProps<{
    /** Номер в формате E.164; пусто — `''`. */
    modelValue?: string | null
    label?: string
    placeholder?: string
    disabled?: boolean
    density?: 'default' | 'comfortable' | 'compact'
    variant?: 'outlined' | 'solo-filled' | 'plain' | 'underlined' | 'filled'
    hideDetails?: boolean
    /** Своё оформление вместо Vuetify-поля — для форм с фирменными инпутами. */
    plain?: boolean
    autofocus?: boolean
  }>(),
  { density: 'comfortable', variant: 'outlined', hideDetails: true },
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

/** Разбор входящего значения — включая старые записи вида «+7 (963) 984-44-42». */
function readValue(v?: string | null): { country: PhoneCountry; national: string } {
  const parsed = v ? parsePhoneLoose(v) : null
  if (parsed) return parsed
  return { country: countryByIso(DEFAULT_COUNTRY_ISO), national: v ? phoneDigits(v) : '' }
}

const initial = readValue(props.modelValue)
const country = ref<PhoneCountry>(initial.country)
const national = ref(initial.national)
const menuOpen = ref(false)
const search = ref('')

// Значение могли поменять снаружи — например, загрузилась карточка клиента.
watch(
  () => props.modelValue,
  (v) => {
    const next = v || ''
    if (next === toE164(national.value, country.value)) return
    const parsed = readValue(next)
    country.value = parsed.country
    national.value = parsed.national
  },
)

/**
 * Предел ввода. Для России и Казахстана — ровно десять цифр: столько же
 * требует сервер, и лишняя цифра всё равно вернулась бы ошибкой. Для прочих
 * стран даём одну про запас: планы нумерации меняются чаще справочника.
 */
const maxDigits = computed(() => {
  const byMask = Math.max(...country.value.lengths, country.value.mask.split('#').length - 1)
  return country.value.dial === '+7' ? 10 : byMask + 1
})

/** Показ по маске: «(928) 123-45-67». */
const display = computed(() => {
  const digits = national.value
  if (!digits) return ''
  let out = ''
  let i = 0
  for (const ch of country.value.mask) {
    if (i >= digits.length) break
    if (ch === '#') {
      out += digits[i]
      i++
    } else {
      out += ch
    }
  }
  if (i < digits.length) out += digits.slice(i)
  return out
})

function push() {
  emit('update:modelValue', toE164(national.value, country.value))
}

const inputRef = ref<HTMLInputElement | null>(null)
const fieldRef = ref<{ $el?: HTMLElement } | null>(null)

/** Сам `<input>` — и в своём оформлении, и внутри Vuetify-поля. */
function inputEl(): HTMLInputElement | null {
  if (inputRef.value) return inputRef.value
  return (fieldRef.value?.$el?.querySelector('input') as HTMLInputElement) ?? null
}

function onInput(raw: string) {
  // Вставили номер целиком с кодом страны — распознаём и переключаем флаг.
  const pasted = raw.trim().startsWith('+') ? parsePhoneLoose(raw) : null
  if (pasted) {
    country.value = pasted.country
    national.value = pasted.national.slice(0, maxDigits.value)
  } else {
    // Обычный ввод: буквы и знаки отбрасываем, лишние цифры не помещаем.
    let digits = phoneDigits(raw)
    // Привычка набирать российский номер с восьмёрки: «89281234567» — это тот
    // же номер, что «9281234567». Восьмёрку убираем, иначе последняя цифра
    // не поместилась бы и номер молча обрезался.
    if (country.value.dial === '+7' && digits.length === 11 && /^[78]/.test(digits)) {
      digits = digits.slice(1)
    }
    national.value = digits.slice(0, maxDigits.value)
  }
  push()
  // Значение в самом поле правим вручную: если отфильтрованный текст совпал с
  // прежним (набрали букву или лишнюю цифру), Vue не стал бы перерисовывать
  // input — и мусор остался бы на экране.
  syncInput()
}

/** Привести содержимое поля к тому, что реально принято. */
function syncInput() {
  void nextTick(() => {
    const el = inputEl()
    if (el && el.value !== display.value) el.value = display.value
  })
}

function pickCountry(c: PhoneCountry) {
  // Национальную часть сохраняем: человек меняет код, а не номер заново.
  country.value = c
  // Но у новой страны номер может быть короче — лишние цифры убираем.
  national.value = national.value.slice(0, maxDigits.value)
  menuOpen.value = false
  search.value = ''
  push()
  syncInput()
}

const filteredCountries = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return PHONE_COUNTRIES
  const digits = q.replace(/\D/g, '')
  return PHONE_COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.nameEn.toLowerCase().includes(q) ||
      (digits && c.dial.includes(digits)),
  )
})

/** Класс флага из пакета flag-icons: «fi fi-ru». */
const flagClass = (iso: string) => `fi fi-${iso.toLowerCase()}`

defineExpose({ formatted: computed(() => formatE164(toE164(national.value, country.value))) })
</script>

<template>
  <div class="phone-field" :class="{ 'phone-field--plain': plain }">
    <div v-if="plain" class="phone-field-plain">
      <v-menu v-model="menuOpen" :close-on-content-click="false" location="bottom start" offset="4">
        <template #activator="{ props: activator }">
          <button type="button" class="phone-field-country" :disabled="disabled" v-bind="activator">
            <span :class="flagClass(country.iso)" class="phone-field-flag" />
            <span class="phone-field-dial">{{ country.dial }}</span>
            <v-icon icon="mdi-chevron-down" size="14" class="phone-field-chev" />
          </button>
        </template>
        <v-card rounded="lg" elevation="8" class="phone-field-menu">
          <div class="phone-field-search">
            <v-icon icon="mdi-magnify" size="16" />
            <input v-model="search" type="text" placeholder="Страна или код" />
          </div>
          <div class="phone-field-list">
            <button
              v-for="c in filteredCountries"
              :key="c.iso"
              type="button"
              class="phone-field-option"
              :class="{ 'phone-field-option--active': c.iso === country.iso }"
              @click="pickCountry(c)"
            >
              <span :class="flagClass(c.iso)" class="phone-field-flag" />
              <span class="phone-field-option-name">{{ c.name }}</span>
              <span class="phone-field-option-dial">{{ c.dial }}</span>
            </button>
            <div v-if="!filteredCountries.length" class="phone-field-empty">Ничего не найдено</div>
          </div>
        </v-card>
      </v-menu>
      <input
        ref="inputRef"
        :value="display"
        type="tel"
        inputmode="tel"
        class="phone-field-input"
        :placeholder="placeholder || country.mask.replace(/#/g, '0')"
        :disabled="disabled"
        :autofocus="autofocus"
        @input="onInput(($event.target as HTMLInputElement).value)"
      />
    </div>

    <v-text-field
      v-else
      ref="fieldRef"
      :model-value="display"
      :label="label"
      :placeholder="placeholder || country.mask.replace(/#/g, '0')"
      :density="density"
      :variant="variant"
      :hide-details="hideDetails"
      :disabled="disabled"
      :autofocus="autofocus"
      type="tel"
      inputmode="tel"
      rounded="lg"
      @update:model-value="onInput"
    >
      <template #prepend-inner>
        <v-menu v-model="menuOpen" :close-on-content-click="false" location="bottom start" offset="4">
          <template #activator="{ props: activator }">
            <button type="button" class="phone-field-country phone-field-country--inner" :disabled="disabled" v-bind="activator">
              <span :class="flagClass(country.iso)" class="phone-field-flag" />
              <span class="phone-field-dial">{{ country.dial }}</span>
              <v-icon icon="mdi-chevron-down" size="14" class="phone-field-chev" />
            </button>
          </template>
          <v-card rounded="lg" elevation="8" class="phone-field-menu">
            <div class="phone-field-search">
              <v-icon icon="mdi-magnify" size="16" />
              <input v-model="search" type="text" placeholder="Страна или код" />
            </div>
            <div class="phone-field-list">
              <button
                v-for="c in filteredCountries"
                :key="c.iso"
                type="button"
                class="phone-field-option"
                :class="{ 'phone-field-option--active': c.iso === country.iso }"
                @click="pickCountry(c)"
              >
                <span :class="flagClass(c.iso)" class="phone-field-flag" />
                <span class="phone-field-option-name">{{ c.name }}</span>
                <span class="phone-field-option-dial">{{ c.dial }}</span>
              </button>
              <div v-if="!filteredCountries.length" class="phone-field-empty">Ничего не найдено</div>
            </div>
          </v-card>
        </v-menu>
      </template>
    </v-text-field>
  </div>
</template>

<style scoped>
.phone-field {
  width: 100%;
}

/* Фирменное оформление формы: код страны и номер в одной рамке. */
.phone-field-plain {
  display: flex;
  align-items: stretch;
  gap: 0;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.phone-field-plain:focus-within {
  border-color: rgb(var(--v-theme-primary));
}
.phone-field-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
  outline: none;
}

.phone-field-country {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 40px;
  border: none;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}
.phone-field-country:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.phone-field-country--inner {
  height: 32px;
  border-right: none;
  padding-left: 0;
  padding-right: 4px;
}
.phone-field-dial {
  font-variant-numeric: tabular-nums;
}
.phone-field-chev {
  opacity: 0.45;
}
.phone-field-flag {
  width: 20px;
  height: 15px;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
}

.phone-field-menu {
  width: 300px;
}
.phone-field-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.phone-field-search input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
}
.phone-field-list {
  max-height: 300px;
  overflow-y: auto;
}
.phone-field-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.phone-field-option:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.phone-field-option--active {
  background: rgba(var(--v-theme-primary), 0.1);
}
.phone-field-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.phone-field-option-dial {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-variant-numeric: tabular-nums;
}
.phone-field-empty {
  padding: 14px 12px;
  text-align: center;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
</style>
