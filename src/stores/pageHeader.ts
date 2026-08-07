import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Динамический заголовок верхнего бара. Страница может переопределить
 * title/subtitle (напр. «Путевой лист №1» + «В работе · 31 июл. · …»),
 * чтобы не дублировать заголовок внутри контента. Layout читает эти значения
 * с приоритетом над статическими routeTitles/routeSubtitles.
 */
export const usePageHeaderStore = defineStore('pageHeader', () => {
  const title = ref<string | null>(null)
  const subtitle = ref<string | null>(null)

  function set(t: string | null, s: string | null = null) {
    title.value = t
    subtitle.value = s
  }
  function clear() {
    title.value = null
    subtitle.value = null
  }

  return { title, subtitle, set, clear }
})
