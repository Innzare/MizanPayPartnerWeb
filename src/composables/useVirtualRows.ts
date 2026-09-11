/**
 * Виртуализация длинных таблиц: в разметке живут только те строки, что видны
 * на экране, остальное место занимают две распорки.
 *
 * Зачем: строка списка — это три десятка узлов и несколько компонентов
 * Vuetify. На двух тысячах сделок получалось 62 тысячи элементов и почти
 * секунда на отрисовку, на пяти тысячах — 155 тысяч и 1,7 секунды; дальше
 * страница отвечала с задержкой на любое движение мышью.
 *
 * Считать всё это самим оказалось плохой идеей: своя реализация ломалась на
 * мелочах — список пустел при быстрой прокрутке, дёргался у нижнего края и
 * уезжал сам по себе от собственных поправок. Поэтому механику берём из
 * самого Vuetify, ту, на которой работает его `<v-virtual-scroll>`: она
 * учитывает направление и скорость прокрутки, меряет каждую строку через
 * ResizeObserver и ведёт собственную карту высот. Здесь — только обвязка:
 * страница прокручивается целиком, а строки живут внутри <table>, куда
 * готовый компонент со своими <div>-распорками не вставить.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import { useVirtual } from 'vuetify/lib/composables/virtual.js'

export interface VirtualRowsOptions {
  /** Обёртка таблицы: от её положения отсчитывается список. */
  viewport: Ref<HTMLElement | null>
  /** Ниже этого числа строк виртуализация не нужна и только мешает. */
  threshold?: number
  /** Оценка высоты строки до первого замера. */
  estimatedRowHeight?: number
}

export function useVirtualRows<T>(rows: Ref<T[]>, options: VirtualRowsOptions) {
  const threshold = options.threshold ?? 150

  /** Короткий список отдаём целиком — виртуализация там только мешает. */
  const enabled = computed(() => rows.value.length > threshold)
  const virtualized = computed(() => (enabled.value ? rows.value : []))

  const virtualProps = reactive({
    itemHeight: options.estimatedRowHeight ?? null,
    itemKey: null,
    height: undefined,
  })

  const {
    containerRef,
    markerRef,
    computedItems,
    paddingTop,
    paddingBottom,
    handleScroll,
    handleScrollend,
    handleItemResize,
    calculateVisibleItems,
  } = useVirtual(virtualProps as any, virtualized as Ref<readonly T[]>)

  /**
   * Свой запас строк сверх того, что рисует Vuetify.
   *
   * Он держит всего сотню пикселей за краями экрана — этого хватает при
   * неспешной прокрутке, но при быстрой видны пустые полосы: список не
   * успевает дорисоваться. Добавляем по паре десятков строк с каждой стороны
   * и ровно на их высоту укорачиваем распорки, поэтому общая высота списка не
   * меняется и ничего не съезжает.
   */
  const EXTRA_ROWS = 35

  /** Измеренные высоты строк — теми же числами, что получает Vuetify. */
  const heights = new Map<number, number>()
  /** Пока строку не показывали, её высота — это оценка. */
  let averageHeight = options.estimatedRowHeight ?? 56

  function spanHeight(from: number, to: number): number {
    let sum = 0
    for (let i = from; i < to; i++) sum += heights.get(i) ?? averageHeight
    return sum
  }

  const range = computed(() => {
    const items = computedItems.value
    if (!enabled.value || !items.length) return { from: 0, to: rows.value.length }
    const first = items[0]!.index
    const last = first + items.length
    return {
      from: Math.max(first - EXTRA_ROWS, 0),
      to: Math.min(last + EXTRA_ROWS, rows.value.length),
      first,
      last,
    }
  })

  /**
   * Снимок списка на время, пока открыто окно поверх страницы.
   *
   * Vuetify на время модалки делает страницу неподвижной: `html` становится
   * `position: fixed`, и прокрутка обнуляется. Виртуализация честно решает,
   * что мы в начале списка, и рисует первые строки — а за окном при этом
   * видна середина, то есть пустота. Закрыли окно — прокрутка вернулась, и
   * список появился снова.
   *
   * Пока страница заморожена, отдаём тот кусок, что был виден в момент
   * открытия.
   */
  const frozen = shallowRef<{ rows: T[]; offset: number; padTop: number; padBottom: number } | null>(null)

  const visibleRows = computed(() =>
    frozen.value
      ? frozen.value.rows
      : enabled.value
        ? rows.value.slice(range.value.from, range.value.to)
        : rows.value,
  )
  /** Номер первой отрисованной строки — для сквозной нумерации «№ п/п». */
  const offset = computed(() =>
    frozen.value ? frozen.value.offset : enabled.value ? range.value.from : 0,
  )

  const padTop = computed(() => {
    if (frozen.value) return frozen.value.padTop
    if (!enabled.value) return 0
    const { from, first } = range.value
    if (first == null) return 0
    return Math.max(paddingTop.value - spanHeight(from, first), 0)
  })
  const padBottom = computed(() => {
    if (frozen.value) return frozen.value.padBottom
    if (!enabled.value) return 0
    const { to, last } = range.value
    if (last == null) return 0
    return Math.max(paddingBottom.value - spanHeight(last, to), 0)
  })

  /**
   * Замер строк.
   *
   * Vuetify меряет каждую строку и запоминает её высоту — от этого зависит и
   * длина распорок, и попадание в нужный кусок списка. Свой наблюдатель
   * вместо готовой обёртки нужен потому, что обернуть <tr> чем-то ещё внутри
   * <tbody> нельзя.
   */
  let observer: ResizeObserver | null = null

  /** Сообщить высоту строки виртуализатору и запомнить её для своего запаса. */
  function remember(index: number, height: number) {
    handleItemResize(index, height)
    if (heights.get(index) === height) return
    heights.set(index, height)
    // Средняя по показанным — ею оцениваются строки, которых ещё не видели.
    let sum = 0
    heights.forEach((h) => { sum += h })
    averageHeight = sum / heights.size
  }

  function rowRef(index: number) {
    return (el: unknown) => {
      if (!(el instanceof HTMLElement) || !enabled.value) return
      el.dataset.virtualIndex = String(index)
      observer?.observe(el)
      // Первый замер сразу: наблюдатель сообщит размер только после отрисовки,
      // а до неё все строки считались бы одинаковыми.
      const height = el.getBoundingClientRect().height
      if (height > 0) remember(index, height)
    }
  }

  /** Заморожен ли список: страница неподвижна из-за открытого окна. */
  let blockWatcher: MutationObserver | null = null

  function watchScrollBlock() {
    const html = document.documentElement
    const blocked = () => html.classList.contains('v-overlay-scroll-blocked')
    blockWatcher = new MutationObserver(() => {
      if (blocked()) {
        if (!frozen.value && enabled.value) {
          frozen.value = {
            rows: visibleRows.value as T[],
            offset: offset.value,
            padTop: padTop.value,
            padBottom: padBottom.value,
          }
        }
      } else if (frozen.value) {
        frozen.value = null
        // Прокрутка вернулась на место — пересчитываем по ней.
        calculateVisibleItems()
      }
    })
    blockWatcher.observe(html, { attributes: true, attributeFilter: ['class'] })
  }

  onMounted(() => {
    watchScrollBlock()
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        const index = Number(el.dataset.virtualIndex)
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        if (Number.isFinite(index) && height > 0) remember(index, height)
      }
    })

    // Прокручивается страница целиком: разделы устроены так, что таблица
    // тянется во всю высоту, а не живёт в своём окне с прокруткой.
    containerRef.value = document.documentElement
    document.addEventListener('scroll', handleScroll, { passive: true })
    document.addEventListener('scrollend', handleScrollend)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    blockWatcher?.disconnect()
    blockWatcher = null
    document.removeEventListener('scroll', handleScroll)
    document.removeEventListener('scrollend', handleScrollend)
  })

  /**
   * Верхняя распорка — точка отсчёта списка.
   *
   * По её положению становится понятно, сколько страницы прокручено до начала
   * таблицы: над ней ещё шапка раздела, фильтры и вкладки.
   */
  const markerRow = ref<HTMLElement | null>(null)
  watch(markerRow, (el) => { markerRef.value = el ?? undefined }, { flush: 'post' })

  // Новая выборка — пересчитываем видимый кусок.
  watch(
    () => rows.value.length,
    () => {
      heights.clear()
      calculateVisibleItems()
    },
    { flush: 'post' },
  )

  return {
    visibleRows,
    offset,
    padTop,
    padBottom,
    enabled,
    /** Ставится на верхнюю распорку таблицы. */
    markerRow,
    /** Ставится на каждую строку: `:ref="virtual.rowRef(index)"`. */
    rowRef,
    recalc: calculateVisibleItems,
  }
}
