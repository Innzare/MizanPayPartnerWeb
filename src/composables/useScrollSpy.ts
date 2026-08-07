import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

/**
 * Подсветка активного пункта оглавления при прокрутке страницы.
 *
 * Считаем геометрию вручную, а не через IntersectionObserver. Наблюдатель
 * отвечает на вопрос «элемент пересёк полосу», а нам нужен другой ответ —
 * «какой заголовок последним ушёл под шапку». Склеивать одно с другим значит
 * держать два источника истины, которые начинают спорить и мигать на краях
 * страницы. Один обработчик даёт предсказуемый результат, а на полутора сотнях
 * заголовков с кэшем позиций стоит доли миллисекунды.
 *
 * Прокрутка идёт по окну: в лэйауте нет внутреннего скролл-контейнера
 * (.lyt-content — обычный блок, а .lyt-header работает как sticky, что
 * возможно только при прокрутке документа).
 */
export function useScrollSpy(
  ids: Ref<string[]>,
  opts: {
    /** Высота залипающей шапки плюс запас — с этой линии считаем «раздел начался». */
    offset: Ref<number>
  },
) {
  const activeId = ref<string | null>(null)

  // Позиции заголовков от верха документа. Пересчитываем только когда
  // раскладка реально поменялась — на каждом кадре прокрутки это было бы
  // лишним обращением к геометрии и дёрганьем страницы.
  let positions: { id: string; top: number }[] = []
  let rafId = 0

  /**
   * Пока идёт programmatic-прокрутка, подсветку не трогаем. Иначе по клику
   * на дальнюю главу все промежуточные успевают «мигнуть» активными, и
   * оглавление скачет.
   */
  let locked = false
  let unlockTimer: number | undefined

  function measure() {
    positions = ids.value
      .map((id) => {
        const el = document.getElementById(id)
        if (!el) return null
        return { id, top: el.getBoundingClientRect().top + window.scrollY }
      })
      .filter((x): x is { id: string; top: number } => !!x)
  }

  function recompute() {
    if (locked || !positions.length) return

    // Дно страницы: последний раздел часто короче экрана и его верх никогда
    // не доходит до расчётной линии. Без этой ветки он не подсветится никогда.
    //
    // Проверку применяем ТОЛЬКО к прокручиваемой странице. Если контент короче
    // экрана (например, поиск оставил один короткий раздел), условие «мы у дна»
    // истинно всегда — и подсветился бы последний заголовок вместо первого.
    const scrollable = document.documentElement.scrollHeight > window.innerHeight + 2
    const atBottom =
      scrollable &&
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
    if (atBottom) {
      activeId.value = positions[positions.length - 1]!.id
      return
    }

    const line = window.scrollY + opts.offset.value + 1
    let current = positions[0]!.id
    for (const p of positions) {
      if (p.top <= line) current = p.id
      else break
    }
    activeId.value = current
  }

  function onScroll() {
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = 0
      recompute()
    })
  }

  function unlock() {
    locked = false
    if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = undefined }
    recompute()
  }

  /** Пользователь перехватил управление — прекращаем игнорировать прокрутку. */
  function onUserScrollIntent() {
    if (locked) unlock()
  }

  /** Прокрутить к разделу и сразу подсветить его в оглавлении. */
  function scrollTo(id: string, behavior: ScrollBehavior = 'smooth') {
    const el = document.getElementById(id)
    if (!el) return

    // Снимаем страховку от ПРЕДЫДУЩЕГО клика. Иначе при быстром втором клике
    // её таймер (или отложенное scrollend) сработает посреди новой прокрутки
    // и подсветка снова начнёт скакать — ровно то, от чего блокировка и нужна.
    if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = undefined }
    window.removeEventListener('scrollend', unlock)

    measure()
    locked = true
    activeId.value = id

    // scroll-margin-top у заголовков уводит их из-под залипающей шапки —
    // тот же отступ, что и в расчёте активного пункта, иначе подсветка
    // разъедется с тем, что человек видит.
    el.scrollIntoView({ behavior, block: 'start' })

    if ('onscrollend' in window) {
      window.addEventListener('scrollend', unlock, { once: true })
    }
    // Страховка: событие может не прийти вовсе — например, если вкладку
    // свернули посреди прокрутки. Без таймера подсветка замерла бы навсегда.
    unlockTimer = window.setTimeout(unlock, 1200)
  }

  function refresh() {
    measure()
    recompute()
  }

  let ro: ResizeObserver | undefined

  onMounted(() => {
    measure()
    recompute()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', refresh)
    window.addEventListener('wheel', onUserScrollIntent, { passive: true })
    window.addEventListener('touchstart', onUserScrollIntent, { passive: true })
    window.addEventListener('keydown', onUserScrollIntent)

    // Высоты меняются и без изменения размера окна: раскрылся вопрос в FAQ,
    // догрузился баннер подписки над контентом. Без пересчёта позиции «уплывут».
    ro = new ResizeObserver(() => refresh())
    ro.observe(document.body)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', refresh)
    window.removeEventListener('wheel', onUserScrollIntent)
    window.removeEventListener('touchstart', onUserScrollIntent)
    window.removeEventListener('keydown', onUserScrollIntent)
    window.removeEventListener('scrollend', unlock)
    if (unlockTimer) clearTimeout(unlockTimer)
    if (rafId) cancelAnimationFrame(rafId)
    ro?.disconnect()
  })

  return { activeId, scrollTo, refresh }
}
