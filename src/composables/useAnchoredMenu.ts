import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * Выпадающий список, который рисуется поверх всего.
 *
 * Внутри своего блока список живёт по его правилам: в окне со скроллом уезжает
 * вместе с содержимым, и до него приходится долистывать, а блок с
 * `overflow: hidden` просто срезает его по границе. Поэтому список выносится в
 * конец страницы (`Teleport`) и позиционируется по кнопке, от которой открыт.
 *
 * Если снизу не помещается — открывается вверх.
 *
 * Прокрутка страницы под открытым списком не закрывает его, а сдвигает следом
 * за кнопкой; закрываем только когда кнопка ушла из видимой области — список,
 * повисший в пустоте, хуже закрытого. Прокрутка внутри самого списка (в нём
 * может быть три десятка банков) не значит ничего и обрабатываться не должна:
 * из-за неё список закрывался в момент, когда человек листал его содержимое.
 *
 * Появление плавное: список коротко всплывает от кнопки (класс `menu-pop`,
 * см. `styles/anchored-menu.css`) — резкое возникновение читалось как сбой
 * отрисовки рядом с меню Vuetify, которые всегда открывались с анимацией.
 *
 * Использование:
 *   const { open, anchor, menu, pos, toggle } = useAnchoredMenu()
 *   <div ref="anchor"><button @click="toggle">…</button></div>
 *   <Teleport to="body">
 *     <div v-if="open" ref="menu" :style="{ top: pos.top + 'px', … }">…</div>
 *   </Teleport>
 */
export function useAnchoredMenu(options: { maxHeight?: number; gap?: number } = {}) {
  const maxHeight = options.maxHeight ?? 280
  const gap = options.gap ?? 4

  const open = ref(false)
  const anchor = ref<HTMLElement | null>(null)
  const menu = ref<HTMLElement | null>(null)
  const pos = ref({ top: 0, left: 0, width: 0 })
  /**
   * Список открылся вверх — от этого зависит, откуда он «вырастает» при
   * появлении: раскрытие вниз с ростом от нижнего края выглядит как рывок.
   */
  const flipped = ref(false)

  async function place() {
    const el = anchor.value
    if (!el) return
    const r = el.getBoundingClientRect()
    pos.value = { top: r.bottom + gap, left: r.left, width: r.width }
    // Предварительная оценка направления — до отрисовки: класс появления
    // вешается на элемент в момент вставки, и уточнять его потом уже поздно.
    flipped.value = window.innerHeight - r.bottom < maxHeight + gap && r.top > window.innerHeight - r.bottom
    await nextTick()
    const height = menu.value?.offsetHeight ?? maxHeight
    const below = window.innerHeight - r.bottom
    // Снизу не помещается — открываем вверх, но только если сверху места больше.
    const up = below < height + gap && r.top > below
    flipped.value = up
    if (up) {
      pos.value = { ...pos.value, top: Math.max(gap, r.top - height - gap) }
    }
  }

  function toggle(disabled = false) {
    if (disabled) return
    open.value = !open.value
    if (open.value) void place()
  }

  function close() {
    open.value = false
  }

  /**
   * Прокрутили что-то снаружи: держим список у кнопки, пока она видна.
   * Событие ловим в фазе перехвата, поэтому сюда попадает и прокрутка внутри
   * самого списка — её пропускаем.
   */
  function onScroll(e: Event) {
    const target = e.target as Node | null
    if (target && menu.value && (target === menu.value || menu.value.contains(target))) return

    const r = anchor.value?.getBoundingClientRect()
    if (!r || r.bottom < 0 || r.top > window.innerHeight) {
      open.value = false
      return
    }
    void place()
  }

  function onDocPointer(e: MouseEvent) {
    const t = e.target as Node
    if (anchor.value?.contains(t) || menu.value?.contains(t)) return
    open.value = false
  }

  watch(open, (isOpen) => {
    if (isOpen) {
      document.addEventListener('mousedown', onDocPointer)
      // capture: ловим прокрутку любого контейнера, а не только окна.
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', close)
    } else {
      document.removeEventListener('mousedown', onDocPointer)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  })

  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocPointer)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', close)
  })

  return { open, anchor, menu, pos, flipped, toggle, close, place }
}
