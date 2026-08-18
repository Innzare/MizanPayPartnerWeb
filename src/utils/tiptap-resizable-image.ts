import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ContractImageNode from '@/components/contract/ContractImageNode.vue'

/**
 * Картинка в конструкторе договора: размер, выравнивание, обтекание текстом,
 * отступы, рамка, скругление, прозрачность и поворот.
 *
 * Всё оформление уезжает в inline-style самого <img>, потому что экспорт в PDF
 * (templatePdfExport) вставляет сохранённый HTML в скрытый контейнер и снимает
 * его html2canvas — внешние классы туда не доедут, а inline-стили доедут.
 */

export type ImageAlign = 'left' | 'center' | 'right'
export type ImageFloat = 'none' | 'left' | 'right'

export interface ContractImageAttrs {
  src: string
  alt: string | null
  title: string | null
  /** '320px' | '50%' | null (авто) */
  width: string | null
  /** '180px' | null (пропорционально) */
  height: string | null
  align: ImageAlign
  float: ImageFloat
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  radius: number
  borderWidth: number
  borderColor: string
  /** 0..100 */
  opacity: number
  /** градусы, -180..180 */
  rotate: number
  lockAspect: boolean
}

export const IMAGE_DEFAULT_ATTRS: Omit<ContractImageAttrs, 'src' | 'alt' | 'title' | 'width' | 'height'> = {
  align: 'left',
  float: 'none',
  marginTop: 0,
  marginRight: 0,
  marginBottom: 8,
  marginLeft: 0,
  radius: 0,
  borderWidth: 0,
  borderColor: '#000000',
  opacity: 100,
  rotate: 0,
  lockAspect: true,
}

function toNum(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Длина из style: '320px' / '50%' → как есть, всё остальное → null. */
function parseLength(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = String(raw).trim()
  if (!v || v === 'auto') return null
  if (/^-?\d+(\.\d+)?(px|%|em|rem|mm|cm|pt)$/.test(v)) return v
  // width="320" в атрибуте тега — без единиц.
  if (/^\d+(\.\d+)?$/.test(v)) return `${v}px`
  return null
}

/** Собирает inline-style картинки — им же рендерится и превью, и PDF. */
export function buildImageStyle(attrs: Partial<ContractImageAttrs>): string {
  const floated = attrs.float === 'left' || attrs.float === 'right'
  const parts: string[] = []

  parts.push(floated ? `float:${attrs.float}` : 'display:block')
  if (attrs.width) parts.push(`width:${attrs.width}`)
  parts.push(`height:${attrs.height || 'auto'}`)

  const mt = toNum(attrs.marginTop, 0)
  const mr = toNum(attrs.marginRight, 0)
  const mb = toNum(attrs.marginBottom, 0)
  const ml = toNum(attrs.marginLeft, 0)
  parts.push(`margin:${mt}px ${mr}px ${mb}px ${ml}px`)

  // Выравнивание блочной картинки — авто-отступами; при обтекании его нет,
  // сторону задаёт сам float.
  if (!floated) {
    if (attrs.align === 'center') parts.push('margin-left:auto', 'margin-right:auto')
    else if (attrs.align === 'right') parts.push('margin-left:auto')
  }

  const bw = toNum(attrs.borderWidth, 0)
  if (bw > 0) parts.push(`border:${bw}px solid ${attrs.borderColor || '#000000'}`)

  const radius = toNum(attrs.radius, 0)
  if (radius > 0) parts.push(`border-radius:${radius}px`)

  const opacity = toNum(attrs.opacity, 100)
  if (opacity < 100) parts.push(`opacity:${(Math.max(0, opacity) / 100).toFixed(2)}`)

  const rotate = toNum(attrs.rotate, 0)
  if (rotate) parts.push(`transform:rotate(${rotate}deg)`)

  return parts.join(';')
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    contractImage: {
      setImage: (attrs: Partial<ContractImageAttrs> & { src: string }) => ReturnType
      updateImage: (attrs: Partial<ContractImageAttrs>) => ReturnType
    }
  }
}

/**
 * Числовой атрибут, который ездит в HTML отдельным data-* (в style его не
 * вычитать однозначно: margin схлопывается в шорткат, а auto-выравнивание
 * затирает левый/правый отступ).
 */
function numAttr(dataAttr: string, key: string, fallback: number) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => toNum(el.getAttribute(dataAttr), fallback),
    renderHTML: (attrs: Record<string, any>) => ({ [dataAttr]: String(toNum(attrs[key], fallback)) }),
  }
}

export const ResizableImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    // data-* дублируют то, что не вычитать из style однозначно: так атрибуты
    // переживают круг «сохранили HTML → загрузили обратно».
    return {
      src: {
        default: null,
        parseHTML: el => el.getAttribute('src'),
        renderHTML: attrs => (attrs.src ? { src: attrs.src } : {}),
      },
      alt: {
        default: null,
        parseHTML: el => el.getAttribute('alt'),
        renderHTML: attrs => (attrs.alt ? { alt: attrs.alt } : {}),
      },
      title: {
        default: null,
        parseHTML: el => el.getAttribute('title'),
        renderHTML: attrs => (attrs.title ? { title: attrs.title } : {}),
      },
      width: {
        default: null,
        parseHTML: el => parseLength(el.style.width) || parseLength(el.getAttribute('width')),
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: el => parseLength(el.style.height) || parseLength(el.getAttribute('height')),
        renderHTML: () => ({}),
      },
      align: {
        default: IMAGE_DEFAULT_ATTRS.align,
        parseHTML: (el): ImageAlign => {
          const raw = el.getAttribute('data-align')
          if (raw === 'left' || raw === 'center' || raw === 'right') return raw
          // Старые шаблоны: центр угадываем по margin:auto.
          const ml = el.style.marginLeft
          const mr = el.style.marginRight
          if (ml === 'auto' && mr === 'auto') return 'center'
          if (ml === 'auto') return 'right'
          return 'left'
        },
        renderHTML: attrs => ({ 'data-align': attrs.align || 'left' }),
      },
      float: {
        default: IMAGE_DEFAULT_ATTRS.float,
        parseHTML: (el): ImageFloat => {
          const raw = el.getAttribute('data-float') || el.style.cssFloat
          return raw === 'left' || raw === 'right' ? raw : 'none'
        },
        renderHTML: attrs => ({ 'data-float': attrs.float || 'none' }),
      },
      marginTop: numAttr('data-mt', 'marginTop', IMAGE_DEFAULT_ATTRS.marginTop),
      marginRight: numAttr('data-mr', 'marginRight', IMAGE_DEFAULT_ATTRS.marginRight),
      marginBottom: numAttr('data-mb', 'marginBottom', IMAGE_DEFAULT_ATTRS.marginBottom),
      marginLeft: numAttr('data-ml', 'marginLeft', IMAGE_DEFAULT_ATTRS.marginLeft),
      radius: numAttr('data-radius', 'radius', IMAGE_DEFAULT_ATTRS.radius),
      borderWidth: numAttr('data-border-width', 'borderWidth', IMAGE_DEFAULT_ATTRS.borderWidth),
      borderColor: {
        default: IMAGE_DEFAULT_ATTRS.borderColor,
        parseHTML: el => el.getAttribute('data-border-color') || IMAGE_DEFAULT_ATTRS.borderColor,
        renderHTML: attrs => ({ 'data-border-color': attrs.borderColor || IMAGE_DEFAULT_ATTRS.borderColor }),
      },
      opacity: numAttr('data-opacity', 'opacity', IMAGE_DEFAULT_ATTRS.opacity),
      rotate: numAttr('data-rotate', 'rotate', IMAGE_DEFAULT_ATTRS.rotate),
      lockAspect: {
        default: IMAGE_DEFAULT_ATTRS.lockAspect,
        parseHTML: el => el.getAttribute('data-lock') !== '0',
        renderHTML: attrs => ({ 'data-lock': attrs.lockAspect === false ? '0' : '1' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'img[src]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['img', mergeAttributes(HTMLAttributes, { style: buildImageStyle(node.attrs as any) })]
  },

  addNodeView() {
    return VueNodeViewRenderer(ContractImageNode)
  },

  addCommands() {
    return {
      setImage: attrs => ({ commands }) =>
        commands.insertContent({ type: this.name, attrs: { ...IMAGE_DEFAULT_ATTRS, ...attrs } }),
      updateImage: attrs => ({ commands }) => commands.updateAttributes(this.name, attrs),
    }
  },
})

export default ResizableImage
