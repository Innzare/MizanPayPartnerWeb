/**
 * Выбор темы: светлая / тёмная / ночная.
 *
 * Раньше тема была бинарной (`localStorage.theme === 'dark'`), а переключение
 * жило прямо в шапке. Тем стало три, и выбор нужен и шапке, и любому месту,
 * которое подстраивается под тему, — поэтому он вынесен сюда.
 *
 * На корне документа проставляются два класса:
 *   • `dark`  — для ЛЮБОЙ тёмной темы (тёмной и ночной). Существующие правила
 *               `.dark .foo` продолжают работать без правок;
 *   • `night` — только для ночной, если где-то понадобится отличить её.
 * Сами цвета берутся из палитр Vuetify (см. plugins/vuetify.ts), поэтому
 * различие тёмной и ночной не требует ни одного CSS-правила.
 */
import { computed, ref } from 'vue'
import { useTheme } from 'vuetify'
import { THEME_IDS, THEME_LABELS, type ThemeId } from '@/plugins/vuetify'

const STORAGE_KEY = 'theme'

/** Прочитать сохранённый выбор. Старое значение 'dark' остаётся валидным. */
function readStored(): ThemeId {
  const raw = localStorage.getItem(STORAGE_KEY)
  return (THEME_IDS as readonly string[]).includes(raw ?? '') ? (raw as ThemeId) : 'light'
}

/** Одно значение на всё приложение: шапка и страницы не должны разъезжаться. */
const current = ref<ThemeId>(readStored())

function applyClasses(id: ThemeId) {
  const root = document.documentElement
  root.classList.toggle('dark', id !== 'light')
  root.classList.toggle('night', id === 'night')
}

export function useThemeMode() {
  const theme = useTheme()

  function setTheme(id: ThemeId) {
    current.value = id
    theme.change(id)
    localStorage.setItem(STORAGE_KEY, id)
    applyClasses(id)
  }

  /** Применить сохранённую тему при старте приложения. */
  function initTheme() {
    setTheme(current.value)
  }

  return {
    /** Выбранная тема. */
    current: computed(() => current.value),
    /** Тёмная ИЛИ ночная — для мест, где важен только факт темноты. */
    isDark: computed(() => current.value !== 'light'),
    options: THEME_IDS.map((id) => ({ id, ...THEME_LABELS[id] })),
    setTheme,
    initTheme,
  }
}
