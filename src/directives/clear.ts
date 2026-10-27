import type { Directive } from 'vue'

/**
 * `v-clear` — крестик быстрой очистки внутри поля ввода (договорённость с
 * владельцем: везде, где введено значение, — крестик).
 *
 * Одна директива вместо ручной разметки в каждой форме: раньше крестик был
 * только в форме сделки и быстрых действиях, а в новых окнах его забывали.
 *
 * Как работает:
 * - кнопка ставится сразу после поля и позиционируется внутри него справа,
 *   левее подписи-суффикса («₽», «%»), если она есть;
 * - видна, только когда в поле что-то есть и оно не отключено/не только для
 *   чтения; узкое поле (ячейка таблицы, степпер) — без крестика, места нет;
 * - очистка — как ввод с клавиатуры: пустое значение и событие `input`, так
 *   что срабатывают и `v-model`, и маска суммы (`@maska`);
 * - если у поля уже есть свой крестик (`.input-clear`), директива ничего не делает.
 */

type Field = HTMLInputElement | HTMLTextAreaElement

interface State {
  btn: HTMLButtonElement
  sync: () => void
  ro?: ResizeObserver
  origPad: number
}

const STATE = new WeakMap<Field, State>()

/** Только текстовые поля: у даты, файла, флажка — свои элементы. */
const TEXT_TYPES = new Set(['text', 'search', 'tel', 'email', 'url', 'number', ''])
/** Уже́ — крестик некуда поставить. */
const MIN_WIDTH = 110
const ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'

function eligible(el: Field): boolean {
  if (el.tagName === 'INPUT' && !TEXT_TYPES.has((el as HTMLInputElement).type)) return false
  const parent = el.parentElement
  if (!parent) return false
  // Свой крестик у поля уже есть.
  if (parent.querySelector(':scope > .input-clear')) return false
  return true
}

/** Подпись справа внутри поля («₽», «%») — крестик ставим левее неё. */
function suffixOf(el: Field): HTMLElement | null {
  const parent = el.parentElement
  if (!parent) return null
  for (const child of Array.from(parent.children)) {
    if (child === el || !(child instanceof HTMLElement)) continue
    if (/suffix/.test(child.className) && getComputedStyle(child).position === 'absolute') return child
  }
  return null
}

/**
 * У поля свой крестик (поиск: `.search-clear`, `.rg-search-clear`…) — он
 * появляется по `v-if` вместе со значением, поэтому проверяем при каждом
 * обновлении, а не один раз: иначе крестиков стало бы два.
 */
function hasOwnClear(el: Field, ours: HTMLElement): boolean {
  const parent = el.parentElement
  if (!parent) return false
  return Array.from(parent.children).some(
    (c) => c !== ours && c.tagName === 'BUTTON' && /clear/i.test((c as HTMLElement).className),
  )
}

function place(el: Field, st: State) {
  const parent = el.parentElement!
  const suffix = suffixOf(el)
  // Расстояние от правого края поля до правого края родителя.
  const gap = parent.clientWidth - (el.offsetLeft + el.offsetWidth)
  const right = suffix ? parent.clientWidth - suffix.offsetLeft + 4 : gap + 8
  st.btn.style.right = `${Math.max(0, right)}px`
  if (el.tagName === 'TEXTAREA') {
    st.btn.style.top = `${el.offsetTop + 9}px`
    st.btn.style.transform = 'none'
  } else {
    st.btn.style.top = `${el.offsetTop + el.offsetHeight / 2}px`
    st.btn.style.transform = 'translateY(-50%)'
  }
  // Текст не должен заходить под крестик.
  el.style.paddingRight = `${Math.max(st.origPad, right - gap + 24)}px`
}

function attach(el: Field) {
  if (STATE.has(el) || !eligible(el)) return
  const parent = el.parentElement!
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'v-clear-btn'
  btn.tabIndex = -1
  btn.title = 'Очистить'
  btn.setAttribute('aria-label', 'Очистить')
  btn.innerHTML = ICON
  btn.style.display = 'none'
  // Фокус остаётся в поле: иначе клик по крестику закрывал бы выпадающие подсказки.
  btn.addEventListener('mousedown', (e) => e.preventDefault())
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.focus()
    st.sync()
  })
  el.insertAdjacentElement('afterend', btn)

  const st: State = {
    btn,
    origPad: parseFloat(getComputedStyle(el).paddingRight) || 0,
    sync: () => {
      const show =
        !!el.value && !el.disabled && !el.readOnly && el.offsetWidth >= MIN_WIDTH && !hasOwnClear(el, btn)
      if (show) {
        btn.style.display = ''
        place(el, st)
      } else {
        btn.style.display = 'none'
        el.style.paddingRight = ''
      }
    },
  }
  STATE.set(el, st)
  el.addEventListener('input', st.sync)
  if (typeof ResizeObserver !== 'undefined') {
    st.ro = new ResizeObserver(() => st.sync())
    st.ro.observe(el)
  }
  st.sync()
}

export const vClear: Directive<Field> = {
  mounted(el) {
    // Значение и размеры — после отрисовки: модель подставляется в mounted.
    requestAnimationFrame(() => attach(el))
  },
  updated(el) {
    // Значение поменялось кодом (сброс формы, подстановка) — показать или
    // спрятать. После отрисовки: свой крестик поля появляется в том же проходе.
    const st = STATE.get(el)
    if (st) requestAnimationFrame(() => st.sync())
  },
  unmounted(el) {
    const st = STATE.get(el)
    if (!st) return
    st.ro?.disconnect()
    el.removeEventListener('input', st.sync)
    st.btn.remove()
    STATE.delete(el)
  },
}
