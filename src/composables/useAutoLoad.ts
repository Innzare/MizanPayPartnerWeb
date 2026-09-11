/**
 * Автоподгрузка длинных списков: долистали до конца — следующая порция
 * приходит сама.
 *
 * Composable отвечает только за «когда пора грузить»: следит за меткой в
 * конце списка и считает порции. Что именно грузить и куда складывать —
 * дело страницы: у разделов разные сторы и параметры выборки.
 *
 * Настройка своя у каждого раздела (в сделках включена, в платежах может быть
 * выключена), поэтому ключ хранения передаётся снаружи.
 */
import { computed, onUnmounted, ref, watch, type Ref } from 'vue'

export function useAutoLoad(options: {
  /** Ключ хранения настройки, например `deals:auto-load`. */
  storageKey: string
  /** Есть ли ещё что грузить. */
  hasMore: Ref<boolean>
  /** Идёт ли запрос сейчас. */
  busy: Ref<boolean>
  /** Загрузить следующую порцию. */
  loadMore: () => void | Promise<void>
}) {
  const enabled = ref(loadEnabled(options.storageKey))
  /** Сколько порций подряд подгрузилось само — на случай, если строк не знаем. */
  const autoBatches = ref(0)
  watch(enabled, (v) => {
    try { localStorage.setItem(options.storageKey, v ? '1' : '0') } catch { /* ignore */ }
    autoBatches.value = 0
  })

  /** Метка в конце списка: попала в поле зрения — пора грузить. */
  const sentinel = ref<HTMLElement | null>(null)
  let observer: IntersectionObserver | null = null

  /**
   * Своя отметка «запрос отправлен».
   *
   * `busy` приходит из стора и поднимается не мгновенно: между решением
   * грузить и появлением флага успевают сработать и наблюдатель за меткой, и
   * обработчик прокрутки — уходили две-три одинаковые порции подряд.
   */
  let inFlight = false

  function shouldLoad(): boolean {
    return (
      enabled.value &&
      !inFlight &&
      !options.busy.value &&
      options.hasMore.value
    )
  }

  /** Одна точка запуска подгрузки — чтобы отметка ставилась всегда. */
  function startLoad() {
    inFlight = true
    autoBatches.value += 1
    void Promise.resolve(options.loadMore()).finally(() => {
      inFlight = false
    })
  }

  function bind() {
    observer?.disconnect()
    observer = null
    const el = sentinel.value
    if (!el || !enabled.value) return
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        if (!shouldLoad()) return
        startLoad()
      },
      // Грузим заранее, до того как партнёр упёрся в конец списка.
      { rootMargin: '400px' },
    )
    observer.observe(el)
  }

  /**
   * Запасная проверка по прокрутке.
   *
   * IntersectionObserver — основной механизм, но он молчит в двух случаях:
   * метка появилась уже внутри экрана (список короче окна) и при программной
   * прокрутке в некоторых окружениях. Проверка по положению метки закрывает
   * оба, а стоит один расчёт координат на кадр прокрутки.
   */
  // Ограничение по времени, а не через requestAnimationFrame: кадры не
  // выдаются в фоновой вкладке, и подгрузка там просто не срабатывала бы.
  let lastCheck = 0
  function onScroll() {
    const now = Date.now()
    if (now - lastCheck < 150) return
    lastCheck = now
    const el = sentinel.value
    if (!el || !shouldLoad()) return
    const top = el.getBoundingClientRect().top
    if (top - window.innerHeight > 400) return // до края ещё далеко
    startLoad()
  }

  watch(
    [sentinel, enabled],
    () => {
      bind()
      window.removeEventListener('scroll', onScroll)
      if (enabled.value) {
        window.addEventListener('scroll', onScroll, { passive: true })
        // Список может быть короче экрана — тогда прокрутки не будет вовсе.
        onScroll()
      }
    },
    { immediate: true },
  )

  // Порция догрузилась — сразу проверяем, не пора ли за следующей. Без этого
  // застреваем в положении «прокрутил в самый конец и стою»: события прокрутки
  // больше не приходят, а метка так и осталась на экране.
  watch(
    () => options.busy.value,
    (busy) => {
      if (busy) return
      // Даём списку дорисоваться, иначе метка ещё на старом месте.
      lastCheck = 0
      setTimeout(onScroll, 0)
    },
  )

  onUnmounted(() => {
    observer?.disconnect()
    window.removeEventListener('scroll', onScroll)
  })

  /**
   * Догрузка по кнопке — для тех, кто не включил подгрузку при прокрутке.
   *
   * Пока порция грузится, повторные нажатия игнорируются: по кнопке жмут
   * несколько раз подряд, и каждый клик уходил отдельным запросом — сервер
   * отвечал на такой залп отказом «слишком часто».
   */
  function loadMoreManually() {
    if (inFlight || options.busy.value || !options.hasMore.value) return
    autoBatches.value = 0
    inFlight = true
    void Promise.resolve(options.loadMore()).finally(() => {
      inFlight = false
    })
  }

  /** Смена фильтров — новая выборка, счёт порций начинается заново. */
  function reset() {
    autoBatches.value = 0
  }

  return { enabled, sentinel, loadMoreManually, reset }
}

function loadEnabled(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
