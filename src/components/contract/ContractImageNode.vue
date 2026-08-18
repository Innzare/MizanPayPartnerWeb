<script lang="ts" setup>
/**
 * Node view картинки в конструкторе договора.
 *
 * Даёт то, чего нет у дефолтного tiptap-image: тянуть за углы, выравнивать,
 * пускать текст в обтекание, задавать точные размеры и оформление. Панель
 * управления телепортируется в body и позиционируется fixed — иначе её режет
 * `overflow` у «бумаги» договора.
 */
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { useIsDark } from '@/composables/useIsDark'
import { prepareImageFile } from '@/utils/imageFile'

const props = defineProps(nodeViewProps)

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const SIGN_X: Record<Handle, number> = { nw: -1, n: 0, ne: 1, e: 1, se: 1, s: 0, sw: -1, w: -1 }
const SIGN_Y: Record<Handle, number> = { nw: -1, n: -1, ne: -1, e: 0, se: 1, s: 1, sw: 1, w: 0 }

const imgRef = ref<HTMLImageElement | null>(null)
const replaceInputRef = ref<HTMLInputElement | null>(null)
const showPanel = ref(false)
/** Панели прячутся, когда работа ушла из редактора (клик по меню, шапке и т.п.). */
const uiHidden = ref(false)
const linkMargins = ref(false)
const loadFailed = ref(false)

const a = computed<any>(() => props.node.attrs)

/** Живой размер во время перетаскивания — в атрибуты уходит только по отпусканию. */
const live = ref<{ w: number; h: number } | null>(null)
const resizing = ref(false)
/** Счётчик замеров DOM: делает реактивными поля, читающие offsetWidth/Height. */
const domTick = ref(0)

function set(patch: Record<string, any>) {
  props.updateAttributes(patch)
}

// ── Размеры ──────────────────────────────────────────────────────────────────

const unit = computed<'px' | '%'>(() => (String(a.value.width || '').endsWith('%') ? '%' : 'px'))

function contentWidth(): number {
  const parent = imgRef.value?.parentElement?.parentElement as HTMLElement | null
  return parent?.clientWidth || 640
}

function pxWidth(): number {
  return imgRef.value?.offsetWidth || 0
}

function pxHeight(): number {
  return imgRef.value?.offsetHeight || 0
}

/** Ширина в текущих единицах — для инпута в панели. */
const widthNumber = computed<number>(() => {
  void domTick.value
  if (live.value) {
    return unit.value === '%'
      ? Math.round((live.value.w / contentWidth()) * 1000) / 10
      : Math.round(live.value.w)
  }
  const raw = parseFloat(String(a.value.width || ''))
  if (Number.isFinite(raw)) return Math.round(raw * 10) / 10
  return Math.round(pxWidth())
})

const heightNumber = computed<number>(() => {
  void domTick.value
  if (live.value) return Math.round(live.value.h)
  const raw = parseFloat(String(a.value.height || ''))
  return Number.isFinite(raw) ? Math.round(raw) : Math.round(pxHeight())
})

const autoHeight = computed(() => !a.value.height)

function applyWidth(value: number) {
  const v = Math.max(1, Number(value) || 1)
  if (unit.value === '%') set({ width: `${Math.min(100, v)}%` })
  else set({ width: `${Math.min(Math.round(contentWidth()), Math.round(v))}px` })
}

function applyHeight(value: number) {
  const v = Math.max(1, Math.round(Number(value) || 1))
  set({ height: `${v}px`, lockAspect: false })
}

function setUnit(next: 'px' | '%') {
  if (next === unit.value) return
  const w = pxWidth() || 1
  set({ width: next === '%' ? `${Math.round((w / contentWidth()) * 1000) / 10}%` : `${Math.round(w)}px` })
}

function setPreset(percent: number) {
  set({ width: `${percent}%`, height: null, lockAspect: true })
}

function resetSize() {
  const natural = imgRef.value?.naturalWidth || 0
  const max = contentWidth()
  const w = natural ? Math.min(natural, max) : max
  set({ width: `${Math.round(w)}px`, height: null, lockAspect: true })
}

function toggleLock() {
  const next = !a.value.lockAspect
  // Включили пропорции — фиксированная высота больше не нужна.
  set(next ? { lockAspect: true, height: null } : { lockAspect: false, height: `${Math.round(pxHeight())}px` })
}

// ── Перетаскивание маркеров ──────────────────────────────────────────────────

function startResize(event: PointerEvent, handle: Handle) {
  if (!props.editor.isEditable || !imgRef.value) return
  event.preventDefault()
  event.stopPropagation()

  const startW = pxWidth()
  const startH = pxHeight()
  if (!startW || !startH) return
  const ratio = startW / startH
  const startX = event.clientX
  const startY = event.clientY
  const maxW = contentWidth()
  const lock = a.value.lockAspect !== false
  resizing.value = true

  const onMove = (e: PointerEvent) => {
    const dx = (e.clientX - startX) * SIGN_X[handle]
    const dy = (e.clientY - startY) * SIGN_Y[handle]
    let w: number
    let h: number
    if (lock) {
      if (SIGN_X[handle] !== 0) {
        w = startW + dx
        h = w / ratio
      } else {
        h = startH + dy
        w = h * ratio
      }
    } else {
      w = SIGN_X[handle] !== 0 ? startW + dx : startW
      h = SIGN_Y[handle] !== 0 ? startH + dy : startH
    }
    w = Math.max(24, Math.min(w, maxW))
    h = Math.max(24, lock ? w / ratio : h)
    live.value = { w, h }
    updateRect()
  }

  const onUp = () => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    resizing.value = false
    const size = live.value
    live.value = null
    if (!size) return
    const width = unit.value === '%'
      ? `${Math.round((size.w / maxW) * 1000) / 10}%`
      : `${Math.round(size.w)}px`
    set({ width, height: lock ? null : `${Math.round(size.h)}px` })
    nextTick(updateRect)
  }

  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
}

// ── Положение ────────────────────────────────────────────────────────────────

function setAlign(align: 'left' | 'center' | 'right') {
  set({ align, float: 'none' })
}

function setFloat(float: 'none' | 'left' | 'right') {
  if (float === 'none') {
    set({ float: 'none', marginLeft: 0, marginRight: 0 })
    return
  }
  // При обтекании нужен зазор со стороны текста, иначе буквы липнут к картинке.
  set({
    float,
    align: 'left',
    marginRight: float === 'left' ? Math.max(12, a.value.marginRight) : 0,
    marginLeft: float === 'right' ? Math.max(12, a.value.marginLeft) : 0,
  })
}

function setMargin(side: 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft', value: number) {
  const v = Math.max(0, Math.min(200, Math.round(Number(value) || 0)))
  if (linkMargins.value) set({ marginTop: v, marginRight: v, marginBottom: v, marginLeft: v })
  else set({ [side]: v })
}

// ── Оформление ───────────────────────────────────────────────────────────────

function rotateBy(delta: number) {
  let next = Math.round((Number(a.value.rotate) || 0) + delta)
  while (next > 180) next -= 360
  while (next < -180) next += 360
  set({ rotate: next })
}

function resetStyle() {
  set({
    marginTop: 0, marginRight: 0, marginBottom: 8, marginLeft: 0,
    radius: 0, borderWidth: 0, borderColor: '#000000',
    opacity: 100, rotate: 0,
  })
}

async function onReplaceFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const prepared = await prepareImageFile(file)
    loadFailed.value = false
    set({ src: prepared.src })
  } catch { /* молча: файл битый — картинка остаётся прежней */ }
}

function removeSelf() {
  props.deleteNode()
}

// ── Стили ────────────────────────────────────────────────────────────────────

const wrapStyle = computed(() => {
  const attrs = a.value
  const floated = attrs.float === 'left' || attrs.float === 'right'
  const style: Record<string, string> = {
    position: 'relative',
    marginTop: `${attrs.marginTop || 0}px`,
    marginRight: `${attrs.marginRight || 0}px`,
    marginBottom: `${attrs.marginBottom || 0}px`,
    marginLeft: `${attrs.marginLeft || 0}px`,
    maxWidth: '100%',
  }
  const width = live.value ? `${Math.round(live.value.w)}px` : attrs.width
  style.width = width || 'fit-content'

  if (floated) {
    style.float = attrs.float
  } else {
    style.display = 'block'
    if (attrs.align === 'center') { style.marginLeft = 'auto'; style.marginRight = 'auto' }
    else if (attrs.align === 'right') { style.marginLeft = 'auto' }
  }
  return style
})

const imgStyle = computed(() => {
  const attrs = a.value
  const style: Record<string, string> = {
    display: 'block',
    width: '100%',
    height: live.value
      ? `${Math.round(live.value.h)}px`
      : (attrs.height || 'auto'),
  }
  if ((attrs.borderWidth || 0) > 0) style.border = `${attrs.borderWidth}px solid ${attrs.borderColor || '#000'}`
  if ((attrs.radius || 0) > 0) style.borderRadius = `${attrs.radius}px`
  if ((attrs.opacity ?? 100) < 100) style.opacity = String(Math.max(0, attrs.opacity) / 100)
  if (attrs.rotate) style.transform = `rotate(${attrs.rotate}deg)`
  return style
})

// ── Позиция плавающих панелей ────────────────────────────────────────────────

const rect = reactive({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

function updateRect() {
  const el = imgRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  rect.top = r.top; rect.left = r.left; rect.right = r.right
  rect.bottom = r.bottom; rect.width = r.width; rect.height = r.height
  domTick.value++
}

const TOOLBAR_WIDTH = 330
const PANEL_WIDTH = 292

const toolbarStyle = computed(() => {
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - TOOLBAR_WIDTH - 8))
  const above = rect.top - 46
  const top = above > 60 ? above : Math.min(rect.bottom + 8, window.innerHeight - 52)
  return { top: `${top}px`, left: `${left}px` }
})

const panelStyle = computed(() => {
  // Панель встаёт под быстрой панелью и не вылезает за экран.
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8))
  const barTop = parseFloat(String(toolbarStyle.value.top))
  const top = Math.max(56, Math.min(barTop + 42, window.innerHeight - 200))
  return { top: `${top}px`, left: `${left}px`, maxHeight: `${Math.max(220, window.innerHeight - top - 16)}px` }
})

let observer: ResizeObserver | null = null

function onDocPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return
  if (target.closest('.ci-bar, .ci-panel')) return
  if (props.editor.view.dom.contains(target)) { uiHidden.value = false; return }
  uiHidden.value = true
  showPanel.value = false
}

watch(() => props.selected, (selected) => {
  if (!selected) {
    showPanel.value = false
    teardownListeners()
    return
  }
  uiHidden.value = false
  window.addEventListener('scroll', updateRect, true)
  window.addEventListener('resize', updateRect)
  document.addEventListener('pointerdown', onDocPointerDown, true)
  nextTick(() => {
    updateRect()
    if (imgRef.value && 'ResizeObserver' in window && !observer) {
      observer = new ResizeObserver(updateRect)
      observer.observe(imgRef.value)
    }
  })
}, { immediate: true })

function teardownListeners() {
  window.removeEventListener('scroll', updateRect, true)
  window.removeEventListener('resize', updateRect)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  observer?.disconnect()
  observer = null
}

function selectSelf() {
  if (props.selected) return
  const pos = typeof props.getPos === 'function' ? props.getPos() : null
  if (typeof pos === 'number') props.editor.commands.setNodeSelection(pos)
}

onMounted(() => {
  nextTick(updateRect)
})

onBeforeUnmount(teardownListeners)

function onImageLoad() {
  loadFailed.value = false
  // Старые шаблоны и вставка из буфера приходят без ширины — фиксируем текущую,
  // иначе нечего тянуть и не от чего считать проценты.
  if (!a.value.width && imgRef.value) {
    const natural = imgRef.value.naturalWidth || 0
    const max = contentWidth()
    set({ width: `${Math.round(natural ? Math.min(natural, max) : max)}px` })
  }
  nextTick(updateRect)
}

const { isDark } = useIsDark()
</script>

<template>
  <NodeViewWrapper class="ci-wrap" :class="{ 'ci-wrap--selected': selected }" :style="wrapStyle">
    <img
      ref="imgRef"
      data-drag-handle
      :src="a.src"
      :alt="a.alt || ''"
      :style="imgStyle"
      @load="onImageLoad"
      @error="loadFailed = true"
      @click="selectSelf"
    />

    <div v-if="loadFailed" class="ci-broken">
      <i class="mdi mdi-image-broken-variant" />
      <span>Изображение не загрузилось</span>
    </div>

    <!-- Рамка выделения с маркерами -->
    <div v-if="selected && editor.isEditable" class="ci-frame">
      <span
        v-for="h in HANDLES"
        :key="h"
        class="ci-handle"
        :class="`ci-handle--${h}`"
        @pointerdown="startResize($event, h)"
      />
    </div>

    <div v-if="resizing" class="ci-size-badge">
      {{ Math.round(live?.w || 0) }} × {{ Math.round(live?.h || 0) }} px
    </div>

    <Teleport v-if="selected && editor.isEditable && !uiHidden" to="body">
      <!-- Быстрая панель -->
      <div class="ci-bar" :class="{ 'ci-dark': isDark }" :style="toolbarStyle" @mousedown.prevent>
        <button class="ci-bar-btn" :class="{ active: a.float === 'none' && a.align === 'left' }" title="По левому краю" @click="setAlign('left')">
          <i class="mdi mdi-format-align-left" />
        </button>
        <button class="ci-bar-btn" :class="{ active: a.float === 'none' && a.align === 'center' }" title="По центру" @click="setAlign('center')">
          <i class="mdi mdi-format-align-center" />
        </button>
        <button class="ci-bar-btn" :class="{ active: a.float === 'none' && a.align === 'right' }" title="По правому краю" @click="setAlign('right')">
          <i class="mdi mdi-format-align-right" />
        </button>

        <span class="ci-bar-sep" />

        <button class="ci-bar-btn" :class="{ active: a.float === 'left' }" title="Обтекание текстом справа" @click="setFloat('left')">
          <i class="mdi mdi-format-float-left" />
        </button>
        <button class="ci-bar-btn" :class="{ active: a.float === 'right' }" title="Обтекание текстом слева" @click="setFloat('right')">
          <i class="mdi mdi-format-float-right" />
        </button>
        <button class="ci-bar-btn" :class="{ active: a.float === 'none' }" title="Без обтекания" @click="setFloat('none')">
          <i class="mdi mdi-format-float-none" />
        </button>

        <span class="ci-bar-sep" />

        <button class="ci-bar-btn" :class="{ active: showPanel }" title="Все настройки" @click="showPanel = !showPanel">
          <i class="mdi mdi-tune-variant" />
        </button>
        <button class="ci-bar-btn" title="Заменить изображение" @click="replaceInputRef?.click()">
          <i class="mdi mdi-image-sync-outline" />
        </button>
        <button class="ci-bar-btn ci-bar-btn--danger" title="Удалить" @click="removeSelf">
          <i class="mdi mdi-trash-can-outline" />
        </button>
      </div>

      <!-- Полная панель настроек -->
      <div v-if="showPanel" class="ci-panel" :class="{ 'ci-dark': isDark }" :style="panelStyle" @mousedown.stop>
        <div class="ci-panel-head">
          <span>Изображение</span>
          <button class="ci-panel-close" @mousedown.prevent @click="showPanel = false">
            <i class="mdi mdi-close" />
          </button>
        </div>

        <!-- Размер -->
        <div class="ci-group">
          <div class="ci-group-title">Размер</div>
          <div class="ci-row">
            <label class="ci-field">
              <span>Ширина</span>
              <input type="number" min="1" :value="widthNumber" @change="applyWidth(($event.target as HTMLInputElement).valueAsNumber)" />
            </label>
            <div class="ci-unit">
              <button :class="{ active: unit === 'px' }" @mousedown.prevent @click="setUnit('px')">px</button>
              <button :class="{ active: unit === '%' }" @mousedown.prevent @click="setUnit('%')">%</button>
            </div>
          </div>
          <div class="ci-row">
            <label class="ci-field">
              <span>Высота</span>
              <input
                type="number" min="1"
                :value="heightNumber"
                :class="{ 'ci-field--auto': autoHeight }"
                @change="applyHeight(($event.target as HTMLInputElement).valueAsNumber)"
              />
            </label>
            <button
              class="ci-lock"
              :class="{ active: a.lockAspect !== false }"
              :title="a.lockAspect !== false ? 'Пропорции сохраняются' : 'Пропорции свободные'"
              @mousedown.prevent
              @click="toggleLock"
            >
              <i class="mdi" :class="a.lockAspect !== false ? 'mdi-link-variant' : 'mdi-link-variant-off'" />
            </button>
          </div>
          <div class="ci-presets">
            <button v-for="p in [25, 50, 75, 100]" :key="p" @mousedown.prevent @click="setPreset(p)">{{ p }}%</button>
            <button title="Исходный размер" @mousedown.prevent @click="resetSize">
              <i class="mdi mdi-image-size-select-actual" />
            </button>
          </div>
          <div class="ci-hint">Тяните за углы картинки — размер меняется прямо в тексте</div>
        </div>

        <!-- Отступы -->
        <div class="ci-group">
          <div class="ci-group-title">
            Отступы, px
            <button class="ci-mini" :class="{ active: linkMargins }" title="Одинаковые со всех сторон" @mousedown.prevent @click="linkMargins = !linkMargins">
              <i class="mdi" :class="linkMargins ? 'mdi-link-variant' : 'mdi-link-variant-off'" />
            </button>
          </div>
          <div class="ci-grid4">
            <label class="ci-field">
              <span>Сверху</span>
              <input type="number" min="0" max="200" :value="a.marginTop" @change="setMargin('marginTop', ($event.target as HTMLInputElement).valueAsNumber)" />
            </label>
            <label class="ci-field">
              <span>Справа</span>
              <input type="number" min="0" max="200" :value="a.marginRight" @change="setMargin('marginRight', ($event.target as HTMLInputElement).valueAsNumber)" />
            </label>
            <label class="ci-field">
              <span>Снизу</span>
              <input type="number" min="0" max="200" :value="a.marginBottom" @change="setMargin('marginBottom', ($event.target as HTMLInputElement).valueAsNumber)" />
            </label>
            <label class="ci-field">
              <span>Слева</span>
              <input type="number" min="0" max="200" :value="a.marginLeft" @change="setMargin('marginLeft', ($event.target as HTMLInputElement).valueAsNumber)" />
            </label>
          </div>
        </div>

        <!-- Оформление -->
        <div class="ci-group">
          <div class="ci-group-title">Оформление</div>
          <div class="ci-row">
            <label class="ci-field">
              <span>Рамка</span>
              <input type="number" min="0" max="12" :value="a.borderWidth" @change="set({ borderWidth: Math.max(0, Math.min(12, ($event.target as HTMLInputElement).valueAsNumber || 0)) })" />
            </label>
            <input class="ci-color" type="color" :value="a.borderColor || '#000000'" @input="set({ borderColor: ($event.target as HTMLInputElement).value })" />
            <label class="ci-field">
              <span>Скругление</span>
              <input type="number" min="0" max="200" :value="a.radius" @change="set({ radius: Math.max(0, Math.min(200, ($event.target as HTMLInputElement).valueAsNumber || 0)) })" />
            </label>
          </div>

          <div class="ci-slider">
            <span>Прозрачность</span>
            <input type="range" min="10" max="100" step="5" :value="a.opacity" @input="set({ opacity: Number(($event.target as HTMLInputElement).value) })" />
            <b>{{ a.opacity }}%</b>
          </div>

          <div class="ci-slider">
            <span>Поворот</span>
            <input type="range" min="-180" max="180" step="1" :value="a.rotate" @input="set({ rotate: Number(($event.target as HTMLInputElement).value) })" />
            <b>{{ a.rotate }}°</b>
          </div>
          <div class="ci-presets">
            <button @mousedown.prevent @click="rotateBy(-90)"><i class="mdi mdi-rotate-left" /></button>
            <button @mousedown.prevent @click="rotateBy(90)"><i class="mdi mdi-rotate-right" /></button>
            <button @mousedown.prevent @click="set({ rotate: 0 })">0°</button>
          </div>
        </div>

        <button class="ci-reset" @mousedown.prevent @click="resetStyle">
          <i class="mdi mdi-backup-restore" />
          Сбросить оформление
        </button>
      </div>
    </Teleport>

    <input ref="replaceInputRef" type="file" accept="image/*" style="display: none;" @change="onReplaceFile" />
  </NodeViewWrapper>
</template>

<style scoped>
.ci-wrap {
  line-height: 0;
}
.ci-wrap img {
  max-width: 100%;
  cursor: pointer;
}
.ci-wrap--selected img {
  cursor: grab;
}

/* Рамка выделения */
.ci-frame {
  position: absolute;
  inset: 0;
  pointer-events: none;
  outline: 1.5px solid #047857;
  outline-offset: 1px;
  border-radius: 2px;
}
.ci-handle {
  position: absolute;
  width: 11px;
  height: 11px;
  background: #fff;
  border: 1.5px solid #047857;
  border-radius: 3px;
  pointer-events: auto;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
.ci-handle--nw { top: -6px; left: -6px; cursor: nwse-resize; }
.ci-handle--n  { top: -6px; left: 50%; margin-left: -5.5px; cursor: ns-resize; }
.ci-handle--ne { top: -6px; right: -6px; cursor: nesw-resize; }
.ci-handle--e  { top: 50%; right: -6px; margin-top: -5.5px; cursor: ew-resize; }
.ci-handle--se { bottom: -6px; right: -6px; cursor: nwse-resize; }
.ci-handle--s  { bottom: -6px; left: 50%; margin-left: -5.5px; cursor: ns-resize; }
.ci-handle--sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
.ci-handle--w  { top: 50%; left: -6px; margin-top: -5.5px; cursor: ew-resize; }

@media (pointer: coarse) {
  .ci-handle { width: 16px; height: 16px; }
  .ci-handle--nw, .ci-handle--n, .ci-handle--ne { top: -9px; }
  .ci-handle--sw, .ci-handle--s, .ci-handle--se { bottom: -9px; }
  .ci-handle--nw, .ci-handle--w, .ci-handle--sw { left: -9px; }
  .ci-handle--ne, .ci-handle--e, .ci-handle--se { right: -9px; }
  .ci-handle--n, .ci-handle--s { margin-left: -8px; }
  .ci-handle--e, .ci-handle--w { margin-top: -8px; }
}

.ci-size-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(4, 120, 87, 0.92);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.3;
  font-family: system-ui, sans-serif;
  pointer-events: none;
}

.ci-broken {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
  color: #9ca3af;
  font-size: 12px;
  line-height: 1.4;
}
</style>

<style>
/* Плавающие панели живут в body (иначе их режет overflow «бумаги»),
   поэтому стили не scoped. */
.ci-bar,
.ci-panel {
  position: fixed;
  z-index: 2400;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #1f2937;
}
.ci-bar.ci-dark,
.ci-panel.ci-dark {
  background: #23262b;
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.ci-bar {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 4px 6px;
}
.ci-bar-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  opacity: 0.65;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  cursor: pointer;
  transition: all 0.12s;
}
.ci-bar-btn:hover { background: rgba(127, 127, 127, 0.14); opacity: 1; }
.ci-bar-btn.active { background: rgba(4, 120, 87, 0.12); color: #047857; opacity: 1; }
.ci-dark .ci-bar-btn.active { background: rgba(16, 185, 129, 0.18); color: #34d399; }
.ci-bar-btn--danger:hover { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
.ci-bar-sep {
  width: 1px;
  height: 18px;
  margin: 0 5px;
  background: rgba(127, 127, 127, 0.25);
}

.ci-panel {
  width: 292px;
  padding: 12px 14px 14px;
  overflow-y: auto;
}
.ci-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
}
.ci-panel-close {
  width: 24px; height: 24px;
  border: none; border-radius: 6px;
  background: rgba(127, 127, 127, 0.1);
  color: inherit; opacity: 0.6;
  cursor: pointer; font-size: 14px;
}
.ci-panel-close:hover { opacity: 1; }

.ci-group { margin-bottom: 14px; }
.ci-group-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; opacity: 0.45; margin-bottom: 6px;
}
.ci-row { display: flex; align-items: flex-end; gap: 6px; margin-bottom: 6px; }
.ci-grid4 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

.ci-field { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.ci-field > span { font-size: 10px; opacity: 0.5; }
.ci-field input {
  width: 100%; height: 30px; padding: 0 8px;
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 7px; background: transparent; color: inherit;
  font-size: 12px; font-weight: 600; outline: none;
}
.ci-field input:focus { border-color: #047857; }
.ci-field--auto { opacity: 0.55; }

.ci-unit { display: flex; gap: 2px; }
.ci-unit button {
  height: 30px; min-width: 30px; padding: 0 7px;
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 7px; background: transparent; color: inherit;
  font-size: 11px; font-weight: 700; cursor: pointer; opacity: 0.6;
}
.ci-unit button.active { background: rgba(4, 120, 87, 0.12); border-color: #047857; color: #047857; opacity: 1; }

.ci-lock, .ci-mini {
  height: 30px; min-width: 30px;
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 7px; background: transparent; color: inherit;
  font-size: 15px; cursor: pointer; opacity: 0.6;
  display: flex; align-items: center; justify-content: center;
}
.ci-mini { height: 20px; min-width: 22px; font-size: 12px; }
.ci-lock.active, .ci-mini.active {
  background: rgba(4, 120, 87, 0.12); border-color: #047857; color: #047857; opacity: 1;
}

.ci-presets { display: flex; gap: 4px; margin-top: 6px; }
.ci-presets button {
  flex: 1; height: 26px;
  border: 1px solid rgba(127, 127, 127, 0.22);
  border-radius: 7px; background: transparent; color: inherit;
  font-size: 11px; font-weight: 600; cursor: pointer; opacity: 0.7;
}
.ci-presets button:hover { background: rgba(4, 120, 87, 0.1); border-color: #047857; color: #047857; opacity: 1; }

.ci-hint { font-size: 10px; opacity: 0.4; margin-top: 6px; line-height: 1.35; }

.ci-color {
  width: 32px; height: 30px; padding: 2px;
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 7px; background: transparent; cursor: pointer;
}

.ci-slider {
  display: flex; align-items: center; gap: 8px;
  margin-top: 8px; font-size: 11px;
}
.ci-slider > span { opacity: 0.5; width: 84px; flex-shrink: 0; }
.ci-slider input[type='range'] { flex: 1; min-width: 0; accent-color: #047857; }
.ci-slider > b { width: 38px; text-align: right; font-size: 11px; font-weight: 700; }

.ci-reset {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; height: 32px;
  border: 1px solid rgba(127, 127, 127, 0.22);
  border-radius: 8px; background: transparent; color: inherit;
  font-size: 12px; font-weight: 600; cursor: pointer; opacity: 0.75;
}
.ci-reset:hover { background: rgba(127, 127, 127, 0.08); opacity: 1; }
</style>
