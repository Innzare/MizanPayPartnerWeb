<script setup lang="ts">
/**
 * Окно тарифа рассрочки — условия, по которым продавец оформляет договор.
 *
 * Живёт отдельным компонентом, потому что открывается из двух мест: из
 * настроек (список тарифов) и прямо из визарда сделки, где партнёр видит
 * применённый тариф и хочет его поправить, не уходя со страницы.
 *
 * Условия задаются сеткой «срок × стоимость товара», а не списком полос с
 * границами: партнёр называет сроки, при необходимости добавляет ступени по
 * стоимости и заполняет проценты в клетках; границы считаются сами, поэтому
 * дыр и пересечений не бывает.
 *
 * Правки тарифа не касаются заключённых договоров: у каждого сохранён снимок
 * условий на день подписания.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { formatCurrency, pluralizeRu, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import {
  findRuleProblems,
  matchRule,
  ROUNDING_STEP,
  scheduleShape,
  totalFor,
  type MarkupBase,
  type ProgramDownMode,
  type ProgramRounding,
  type ProgramRoundingTarget,
  type ProgramRule,
} from '@/utils/programMath'
import NumberStepper from '@/components/NumberStepper.vue'
import {
  downStepCount,
  downStepLabels,
  downStepRange,
  emptyGrid,
  gridToRules,
  rulesToGrid,
  stepCount,
  stepLabels,
  type ProgramGrid,
} from '@/utils/programGrid'

export interface ProgramForEdit {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  markupBase: MarkupBase
  paymentInterval: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'
  rounding: ProgramRounding
  /** Ступенями или кривой считается зависимость наценки от взноса. */
  downMode?: ProgramDownMode
  /** Куда уходит расхождение от округления платежа. */
  roundingTarget?: ProgramRoundingTarget
  /** Наценка не меньше этой суммы в рублях. */
  minMarkupAmount?: number | null
  /** Взнос, подставляемый в форму сделки, процент от цены договора. */
  defaultDownPaymentPercent?: number | null
  minAmount: number | null
  maxAmount: number | null
  strict: boolean
  rules: ProgramRule[]
}

const props = defineProps<{
  modelValue: boolean
  /** Тариф для правки. `null` — создаём новый. */
  program: ProgramForEdit | null
  /** Сколько тарифов уже есть: первый становится тарифом по умолчанию. */
  existingCount?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved'): void
}>()

const toast = useToast()

const dialog = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

/**
 * Сроки, которые предлагаются сразу — весь ряд от 2 до 12.
 *
 * Раньше показывались только круглые (3, 6, 9, 12, 18, 24), а рассрочка на 5
 * или 7 платежей заводилась через «свой срок», хотя встречается не реже. Более
 * длинные сроки остались за той же кнопкой: их берут единицы.
 */
const TERM_PRESETS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const saving = ref(false)
const isNew = computed(() => !props.program)

const draft = ref({
  name: '',
  description: '',
  isDefault: false,
  markupBase: 'OF_COST' as MarkupBase,
  paymentInterval: 'MONTHLY' as 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY',
  rounding: 'NONE' as ProgramRounding,
  downMode: 'STEPS' as ProgramDownMode,
  roundingTarget: 'LAST_PAYMENT' as ProgramRoundingTarget,
  minMarkupAmount: null as number | null,
  defaultDownPaymentPercent: null as number | null,
  minAmount: null as number | null,
  maxAmount: null as number | null,
  strict: false,
})

/** Условия сеткой — основной режим. */
const grid = ref<ProgramGrid>(emptyGrid())
/**
 * Подробный режим: старые полосы «от … до …», по одной строке.
 *
 * Нужен для программ, заведённых прежним редактором: в них бывают разные
 * взносы в соседних клетках или несовпадающие границы, и в сетку они не
 * раскладываются. Молча выпрямлять такие условия нельзя — по ним идут продажи.
 */
const advanced = ref(false)
const rawRules = ref<ProgramRule[]>([])

/**
 * Обязателен ли первый взнос.
 *
 * Отдельный переключатель, а не «поставьте 0»: партнёр решает это как правило
 * продажи — «без взноса не отдаём» — и должен видеть ответ сразу, не вчитываясь
 * в проценты. Включено — рядом появляется минимальный процент.
 *
 * Включённое положение означает требование, а не его отсутствие: раньше
 * переключатель стоял «на да» у тарифа без всяких условий по взносу, и
 * включённым выглядело как раз более свободное правило.
 */
const requireDownPayment = ref(false)
watch(requireDownPayment, (required) => {
  if (!required) grid.value.minDownPaymentPercent = 0
  else if (!grid.value.minDownPaymentPercent) grid.value.minDownPaymentPercent = 10
})

/**
 * Клетки одной ступени стоимости — по клетке на каждую ступень взноса.
 * Новая клетка наследует наценку соседней: её правят, а не вводят с нуля.
 */
function downRow(from?: number[]): number[] {
  const n = downStepCount(grid.value.downSteps)
  return Array.from({ length: n }, (_, i) => {
    const own = from?.[i]
    if (own != null) return own
    const last = from?.[from.length - 1]
    if (last == null) return 20
    // Новая ступень взноса на 5 пунктов дешевле предыдущей: тариф включают
    // ради слов «чем больше взнос — тем дешевле», и равные проценты в соседних
    // ступенях означали бы, что зависимости нет.
    return Math.max(0, last - 5)
  })
}

/**
 * Какая ступень стоимости сейчас в таблице.
 *
 * Условий три измерения — срок, стоимость и взнос, — а таблица плоская:
 * стоимость выбирается вкладками, иначе в одной сетке пришлось бы держать
 * все комбинации, и читать её стало бы нельзя.
 */
const activeAmountStep = ref(0)

/** Ступени по стоимости — необязательная часть: чаще условия от цены не зависят. */
const byAmount = ref(false)
watch(byAmount, (on) => {
  if (!on) {
    grid.value.steps = []
    activeAmountStep.value = 0
    for (const t of grid.value.terms) {
      grid.value.markup[t] = [downRow(grid.value.markup[t]?.[0])]
    }
  } else if (!grid.value.steps.length) {
    addStep(100000)
  }
})

/**
 * Ступени по первоначальному взносу.
 *
 * Отдельная ось условий: тот же товар на тот же срок стоит дешевле, если
 * клиент внёс больше. Выключено — наценка от взноса не зависит, и тариф ведёт
 * себя ровно как раньше.
 */
const byDownPayment = ref(false)
watch(byDownPayment, (on) => {
  if (!on) {
    grid.value.downSteps = []
    for (const t of grid.value.terms) {
      grid.value.markup[t] = (grid.value.markup[t] ?? []).map((cells) => [cells[0] ?? 20])
    }
  } else if (!grid.value.downSteps.length) {
    addDownStep(30)
  }
})

function addDownStep(value?: number) {
  const last = grid.value.downSteps[grid.value.downSteps.length - 1]
  const next = value ?? Math.min(90, (last ?? 0) + 20)
  if (grid.value.downSteps.includes(next)) return
  grid.value.downSteps.push(next)
  grid.value.downSteps.sort((a, b) => a - b)
  for (const t of grid.value.terms) {
    grid.value.markup[t] = (grid.value.markup[t] ?? []).map((cells) => downRow(cells))
  }
}

function removeDownStep(i: number) {
  grid.value.downSteps.splice(i, 1)
  for (const t of grid.value.terms) {
    grid.value.markup[t] = (grid.value.markup[t] ?? []).map((cells) => {
      const next = [...cells]
      next.splice(i, 1)
      return downRow(next)
    })
  }
}

function setDownStep(i: number, value: number | null) {
  if (value == null || !Number.isFinite(value)) return
  const clamped = Math.min(99, Math.max(1, Math.round(value)))
  grid.value.downSteps.splice(i, 1, clamped)
  grid.value.downSteps.sort((a, b) => a - b)
}

/**
 * Наполняем форму при открытии: новый тариф — с нуля, существующий — из его
 * условий. Раскладываем полосы в сетку; не раскладываются (разный взнос,
 * несовпадающие границы) — показываем как есть, построчно.
 */
watch(
  () => [props.modelValue, props.program] as const,
  ([open]) => {
    if (!open) return
    const p = props.program
    draft.value = {
      name: p?.name ?? '',
      description: p?.description ?? '',
      isDefault: p ? p.isDefault : (props.existingCount ?? 0) === 0,
      markupBase: p?.markupBase ?? 'OF_COST',
      paymentInterval: p?.paymentInterval ?? 'MONTHLY',
      rounding: p?.rounding ?? 'NONE',
      downMode: p?.downMode ?? 'STEPS',
      roundingTarget: p?.roundingTarget ?? 'LAST_PAYMENT',
      minMarkupAmount: p?.minMarkupAmount ?? null,
      defaultDownPaymentPercent: p?.defaultDownPaymentPercent ?? null,
      minAmount: p?.minAmount ?? null,
      maxAmount: p?.maxAmount ?? null,
      strict: p?.strict ?? false,
    }
    const asGrid = p ? rulesToGrid(p.rules) : null
    activeAmountStep.value = 0
    if (!p) {
      grid.value = emptyGrid()
      byAmount.value = false
      byDownPayment.value = false
      requireDownPayment.value = false
      advanced.value = false
      rawRules.value = []
    } else if (asGrid) {
      grid.value = asGrid
      byAmount.value = asGrid.steps.length > 0
      byDownPayment.value = asGrid.downSteps.length > 0
      requireDownPayment.value = !!asGrid.minDownPaymentPercent
      advanced.value = false
      rawRules.value = []
    } else {
      grid.value = emptyGrid()
      byAmount.value = false
      byDownPayment.value = false
      requireDownPayment.value = false
      advanced.value = true
      rawRules.value = p.rules.map((r) => ({ ...r }))
    }
  },
  { immediate: true },
)

// ── Сроки ──

function toggleTerm(term: number) {
  const i = grid.value.terms.indexOf(term)
  if (i >= 0) {
    grid.value.terms.splice(i, 1)
    delete grid.value.markup[term]
  } else {
    grid.value.terms.push(term)
    grid.value.terms.sort((a, b) => a - b)
    // Новый срок наследует наценку соседнего: чаще её правят, чем вводят с нуля.
    const donor = grid.value.terms.find((t) => t !== term && grid.value.markup[t])
    const base = donor ? (grid.value.markup[donor] ?? []) : []
    grid.value.markup[term] = Array.from({ length: stepCount(grid.value.steps) }, (_, i2) =>
      downRow(base[i2] ?? base[0]),
    )
  }
}

const customTerm = ref<number | null>(null)
function addCustomTerm() {
  const t = Math.trunc(customTerm.value ?? 0)
  if (!(t >= 1) || grid.value.terms.includes(t)) return
  toggleTerm(t)
  customTerm.value = null
}

// ── Ступени по стоимости ──

function addStep(value?: number) {
  const last = grid.value.steps[grid.value.steps.length - 1]
  const next = value ?? (last ? last * 2 : 100000)
  grid.value.steps.push(next)
  grid.value.steps.sort((a, b) => a - b)
  // В новой ступени наценка повторяет соседнюю: партнёр правит её, а не вводит.
  for (const t of grid.value.terms) {
    const rows = grid.value.markup[t] ?? []
    grid.value.markup[t] = Array.from({ length: stepCount(grid.value.steps) }, (_, i) =>
      downRow(rows[i] ?? rows[rows.length - 1]),
    )
  }
}

function removeStep(i: number) {
  grid.value.steps.splice(i, 1)
  for (const t of grid.value.terms) {
    const rows = [...(grid.value.markup[t] ?? [])]
    rows.splice(i, 1)
    grid.value.markup[t] = Array.from({ length: stepCount(grid.value.steps) }, (_, k) =>
      downRow(rows[k]),
    )
  }
  // Убрали ступень, на которой стояла вкладка, — таблица смотрела бы в пустоту.
  const last = stepCount(grid.value.steps) - 1
  if (activeAmountStep.value > last) activeAmountStep.value = last
}

function setStep(i: number, value: number | null) {
  if (value == null) return
  grid.value.steps.splice(i, 1, Math.round(value))
}

/** Клетка сетки: срок × ступень стоимости × ступень взноса. */
function cellValue(term: number, ai: number, di: number): number | null {
  return grid.value.markup[term]?.[ai]?.[di] ?? null
}
function setCell(term: number, ai: number, di: number, value: number | null) {
  const rows = [...(grid.value.markup[term] ?? [])]
  while (rows.length < stepCount(grid.value.steps)) rows.push(downRow())
  const cells = [...(rows[ai] ?? downRow())]
  while (cells.length < downStepCount(grid.value.downSteps)) cells.push(20)
  cells[di] = value == null || !Number.isFinite(value) ? 0 : value
  rows[ai] = cells
  grid.value.markup[term] = rows
}

// ── Подробный режим ──

function addRawRule() {
  const last = rawRules.value[rawRules.value.length - 1]
  rawRules.value.push({
    amountFrom: last?.amountTo ?? null,
    amountTo: null,
    termPayments: last?.termPayments ?? 6,
    markupPercent: last?.markupPercent ?? 20,
    minDownPaymentPercent: last?.minDownPaymentPercent ?? 0,
    downFromPercent: null,
    downToPercent: null,
  })
}
function removeRawRule(i: number) {
  rawRules.value.splice(i, 1)
}

/** Что уедет на сервер: полосы из сетки либо строки подробного режима. */
const effectiveRules = computed<ProgramRule[]>(() =>
  advanced.value ? rawRules.value : gridToRules(grid.value),
)

/**
 * Подпись под заголовком «Наценка» — ведёт по порядку внутри шага: сперва
 * ответ «от чего зависит», потом сами проценты.
 */
const markupHint = computed(() => {
  if (byAmount.value && byDownPayment.value) {
    return 'Зависит от цены товара и размера взноса — проценты в таблице ниже'
  }
  if (byDownPayment.value) return 'Зависит от размера взноса — проценты в таблице ниже'
  if (byAmount.value) return 'Зависит от цены товара — проценты в таблице ниже'
  return 'Сначала выберите, от чего она зависит, потом впишите проценты'
})

/**
 * Что означают оси таблицы процентов.
 *
 * Включённая зависимость превращается в колонку или вкладку, и без подписи
 * связь между галочкой выше и сеткой ниже приходилось угадывать.
 */
const gridLegend = computed(() => {
  const parts = ['строки — сроки']
  if (byDownPayment.value) parts.push('колонки — ступени взноса')
  if (byAmount.value) parts.push('вкладки — ступени цены товара')
  return parts.length > 1 ? parts.join(' · ') : ''
})

/**
 * Подпись над таблицей: от чего считается процент.
 *
 * «20%» в клетке ничего не говорит, пока не сказано, к чему эти проценты
 * прибавляются — к закупке или к цене продажи.
 */
const partNote = computed(() => {
  const base =
    draft.value.markupBase === 'OF_COST'
      ? 'наценка прибавляется к закупочной цене'
      : 'наценка входит в цену продажи'
  return [base, gridLegend.value].filter(Boolean).join(' · ')
})

const problems = computed(() => findRuleProblems(effectiveRules.value, draft.value.markupBase))
const canSave = computed(() => draft.value.name.trim().length > 0 && problems.value.length === 0)

// ── Живой пример ──
// Абстрактные проценты ничего не говорят: партнёр проверяет программу на
// знакомом товаре — «телефон за 60 000, сколько выйдет».
const sample = ref(100000)

/**
 * Взнос в примере, процент от цены договора.
 *
 * Когда наценка зависит от взноса, без него проверку не прочитать: на один
 * срок приходится несколько ступеней, и непонятно, какая из них сработает.
 */
const sampleDownPercent = ref(0)

const sampleRows = computed(() => {
  const price = sample.value || 0
  const fits = effectiveRules.value.filter((r) => {
    const from = r.amountFrom ?? 0
    if (price < from) return false
    return r.amountTo == null || price < r.amountTo
  })
  // По строке на срок: ступень взноса выбирается той же функцией, что и при
  // оформлении сделки, — иначе проверка показывала бы не те условия.
  const terms = [...new Set(fits.map((r) => r.termPayments))].sort((a, b) => a - b)
  return terms
    .map((term) => matchRule(fits, price, term, sampleDownPercent.value))
    .filter((r): r is ProgramRule => !!r)
    .map((r) => {
      const total = totalFor(price, r.markupPercent, draft.value.markupBase)
      const down = Math.round(
        (total * Math.max(r.minDownPaymentPercent ?? 0, sampleDownPercent.value)) / 100,
      )
      const shape = scheduleShape(total - down, r.termPayments, draft.value.rounding)
      const step = ROUNDING_STEP[draft.value.rounding] ?? 0
      return {
        term: r.termPayments,
        percent: r.markupPercent,
        total,
        down,
        payment: shape.regular || shape.last,
        // Последний платёж забирает всё расхождение от округления. Показать
        // только регулярный — значит скрыть, что в конце сумма другая.
        last: shape.last,
        lastDiffers: r.termPayments > 1 && shape.regular > 0 && shape.last !== shape.regular,
        // Шаг округления больше самого платежа: округлить нечего, и график
        // считается как без округления. Молчать об этом нельзя — партнёр
        // меняет настройку и не понимает, почему цифры не двигаются.
        roundingSkipped: step > 0 && shape.regular > 0 && shape.regular % step !== 0,
        overpay: total - price,
      }
    })
})

/**
 * Что получит клиент по этому сроку — прямо в строке наценки.
 *
 * Пока условия простые, «Проверка» внизу окна для этого слишком далеко:
 * партнёр правит процент и должен видеть платёж в ту же секунду.
 */
/** Срок словами: «1 платёж», «3 платежа», «12 платежей». */
function termLabel(term: number): string {
  return `${term} ${pluralizeRu(term, 'платёж', 'платежа', 'платежей')}`
}

function simpleRow(term: number): {
  payment: string
  total: string
  down: string
  markup: string
} {
  const price = sample.value || 0
  if (!price) return { payment: '—', total: '—', down: '—', markup: '—' }
  const total = totalFor(price, cellValue(term, 0, 0) ?? 0, draft.value.markupBase)
  const down = Math.round((total * (grid.value.minDownPaymentPercent ?? 0)) / 100)
  const shape = scheduleShape(total - down, term, draft.value.rounding)
  return {
    payment: formatCurrency(shape.regular || shape.last),
    total: formatCurrency(total),
    down: down ? formatCurrency(down) : '—',
    // Процент сам по себе абстрактен: рядом с ним нужен заработок в рублях.
    markup: `+${formatCurrency(total - price)}`,
  }
}

/**
 * Схема «взнос → наценка» под выбором способа перехода.
 *
 * Разницу между ступенями и кривой словами объяснить трудно: на схеме видно,
 * что у ступеней линия скачет на границе, а у кривой идёт наклоном. Рисуем не
 * абстракцию, а сам тариф — берём первый срок и текущую ступень стоимости.
 */
/**
 * Схема занимает всю ширину блока, поэтому система координат равна ей в
 * пикселях: единица viewBox — ровно один пиксель на экране. Так подписи
 * читаются одинаково и в широком окне, и в узком (фиксированный viewBox
 * пришлось бы растягивать, и текст ехал бы вместе с ним), а расстояния между
 * засечками можно мерить настоящими пикселями.
 */
const vizEl = ref<HTMLElement | null>(null)
const vizWidth = ref(640)
let vizObserver: ResizeObserver | null = null

watch(vizEl, (el) => {
  vizObserver?.disconnect()
  vizObserver = null
  if (!el) return
  vizObserver = new ResizeObserver(([entry]) => {
    const w = Math.round(entry?.contentRect.width ?? 0)
    if (w > 0) vizWidth.value = Math.max(240, w)
  })
  vizObserver.observe(el)
})
onBeforeUnmount(() => vizObserver?.disconnect())

const VIZ_GEOM = computed(() => {
  const w = vizWidth.value
  return {
    w,
    // Чем шире блок, тем выше схема — иначе на всю ширину она вырождается в
    // полоску, а на узкой становится квадратом.
    h: Math.round(Math.min(150, Math.max(110, w * 0.19))),
    padX: 24,
    padTop: 18,
    padBottom: 28,
  }
})

const vizBands = computed(() => {
  const term = grid.value.terms[0]
  if (!term || !byDownPayment.value) return null
  const bands: { from: number; to: number; markup: number }[] = []
  for (let di = 0; di < downStepCount(grid.value.downSteps); di++) {
    const range = downStepRange(grid.value.downSteps, di)
    bands.push({
      from: range.from ?? 0,
      to: range.to ?? 100,
      markup: cellValue(term, activeAmountStep.value, di) ?? 0,
    })
  }
  return bands.length ? bands : null
})

const vizGeom = computed(() => {
  const bands = vizBands.value
  if (!bands) return null
  const VIZ = VIZ_GEOM.value
  const values = bands.map((b) => b.markup)
  const min = Math.min(...values)
  const max = Math.max(...values)
  // Все проценты равны — рисуем ровную линию по середине, а не делим на ноль.
  const span = max - min || 1
  const x = (p: number) => VIZ.padX + (p / 100) * (VIZ.w - VIZ.padX * 2)
  // Нижняя линия не должна ложиться на саму ось — иначе они сливаются.
  const inner = VIZ.h - VIZ.padTop - VIZ.padBottom - 8
  const y = (v: number) =>
    max === min ? VIZ.padTop + inner / 2 : VIZ.padTop + ((max - v) / span) * inner

  const segments = bands.map((b) => ({
    x1: x(b.from),
    x2: x(b.to),
    y: y(b.markup),
    mid: x(b.from) + (x(b.to) - x(b.from)) / 2,
    markup: b.markup,
  }))
  const jumps = bands.slice(1).map((b, i) => ({
    x: x(b.from),
    y1: y(bands[i]!.markup),
    y2: y(b.markup),
  }))
  // На кривой границы — опорные точки, а за последней наценка держится ровно.
  const points = bands.map((b) => ({ x: x(b.from), y: y(b.markup), markup: b.markup }))
  const tail = { x: x(100), y: points[points.length - 1]!.y }
  const curvePath = [...points, tail].map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')

  /**
   * Промежуточные значения между опорными точками — главное в плавном режиме.
   * Без них схема читается как «две ступени, только соединённые линией», и
   * непонятно, что взнос в 15% даст свой собственный процент.
   *
   * Одной засечки посередине для этого мало: она выглядит как ещё одна
   * граница. Ставим несколько на участок — тогда видно ряд значений, то есть
   * непрерывность, а не третью ступень. Сколько именно — по ширине участка,
   * иначе подписи наедут друг на друга.
   */
  const midPoints: { x: number; y: number; value: string; at: string; showAt: boolean }[] = []
  for (let i = 1; i < bands.length; i++) {
    const prev = bands[i - 1]!
    const cur = bands[i]!
    const width = x(cur.from) - x(prev.from)
    const fractions =
      width >= 170
        ? [0.25, 0.5, 0.75]
        : width >= 90
          ? [1 / 3, 2 / 3]
          : width >= 44
            ? [0.5]
            : []
    for (const f of fractions) {
      const at = prev.from + (cur.from - prev.from) * f
      // Между опорными точками линия прямая, поэтому значение считается долей.
      const value = prev.markup + (cur.markup - prev.markup) * f
      midPoints.push({
        x: x(at),
        y: y(value),
        value: `${String(Math.round(value * 10) / 10).replace('.', ',')}%`,
        at: `${Math.round(at)}%`,
        // На тесном участке подпись засечки сталкивается с подписью границы:
        // процент над точкой важнее, чем то, какому взносу он отвечает.
        showAt: width >= 150,
      })
    }
  }

  return {
    ...VIZ,
    segments,
    jumps,
    points,
    midPoints,
    curvePath,
    edges: bands.slice(1).map((b) => ({ x: x(b.from), label: `${b.from}%` })),
    baseY: VIZ.h - VIZ.padBottom,
    zeroX: x(0),
    fullX: x(100),
  }
})

/**
 * Границы списком: каждая строка — одна граница и те две ступени, которые она
 * разделяет. Россыпью полей было видно только число; какие условия из него
 * получаются, приходилось складывать в уме.
 */
const amountEdgeRows = computed(() => {
  const labels = stepLabels(grid.value.steps)
  return grid.value.steps.map((value, i) => ({
    value,
    below: labels[i] ?? '',
    above: labels[i + 1] ?? '',
  }))
})

const downEdgeRows = computed(() => {
  const labels = downStepLabels(grid.value.downSteps)
  return grid.value.downSteps.map((value, i) => ({
    value,
    below: labels[i] ?? '',
    above: labels[i + 1] ?? '',
  }))
})

/** Строки простой таблицы считаем один раз, а не по разу на каждую ячейку. */
const simpleRows = computed(() => {
  const map: Record<number, ReturnType<typeof simpleRow>> = {}
  for (const t of grid.value.terms) map[t] = simpleRow(t)
  return map
})

/** Схема рисуется по первому сроку — говорим, по какому именно. */
const vizTermNote = computed(() => {
  const term = grid.value.terms[0]
  return term ? ` · показан срок ${termLabel(term)}` : ''
})

/** Тот же пример, но для таблицы: считаем по первому сроку и первой клетке. */
const cellExampleLabel = computed(() => {
  const term = grid.value.terms[0]
  const price = sample.value || 0
  if (!term || !price) return ''
  const percent = cellValue(term, activeAmountStep.value, 0) ?? 0
  const total = totalFor(price, percent, draft.value.markupBase)
  const shape = scheduleShape(total, term, draft.value.rounding)
  return `Например, ${percent}% на ${termLabel(term)} при товаре за ${formatCurrency(price)} — это ${formatCurrency(shape.regular || shape.last)} в месяц.`
})

/** Подписи в карточках выбора: что именно настроено, без ухода в детали ниже. */
const amountChoiceSummary = computed(() =>
  grid.value.steps.length ? stepLabels(grid.value.steps).join(' · ') : 'Добавьте границу цены',
)
const downChoiceSummary = computed(() => {
  if (!grid.value.downSteps.length) return 'Добавьте границу взноса'
  const mode = draft.value.downMode === 'CURVE' ? 'плавно' : 'ступенями'
  return `${downStepLabels(grid.value.downSteps).join(' · ')} · ${mode}`
})

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    const payload = {
      ...draft.value,
      description: draft.value.description.trim() || null,
      rules: effectiveRules.value.map((r) => ({
        amountFrom: r.amountFrom,
        amountTo: r.amountTo,
        termPayments: r.termPayments,
        markupPercent: r.markupPercent,
        minDownPaymentPercent: r.minDownPaymentPercent,
        downFromPercent: r.downFromPercent ?? null,
        downToPercent: r.downToPercent ?? null,
      })),
    }
    if (props.program) await api.patch(`/installment-programs/${props.program.id}`, payload)
    else await api.post('/installment-programs', payload)
    dialog.value = false
    toast.success(props.program ? 'Тариф сохранён' : 'Тариф создан')
    emit('saved')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить тариф')
  } finally {
    saving.value = false
  }
}
</script>

<template>
<v-dialog v-model="dialog" max-width="860" scrollable>
    <v-card rounded="lg" class="ip-editor">
      <div class="ip-editor-head">
        <div>
          <div class="ip-title">{{ isNew ? 'Новый тариф' : 'Тариф рассрочки' }}</div>
          <div class="ip-sub">
            Изменения коснутся только новых договоров: у заключённых сохранён
            снимок условий на день подписания.
          </div>
        </div>
        <button class="ip-close" @click="dialog = false">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="ip-editor-body">
        <div class="ip-row-2">
          <div class="ip-field">
            <label class="ip-label">Название</label>
            <input v-model="draft.name" class="ip-text" placeholder="Стандарт, Акция «Без переплат»" />
          </div>
          <div class="ip-field">
            <label class="ip-label">Пояснение для продавца</label>
            <input v-model="draft.description" class="ip-text" placeholder="Когда предлагать этот тариф" />
            <!-- Текст показывается в карточке тарифа и при оформлении сделки:
                 без подписи непонятно, откуда он там берётся. -->
            <div class="ip-hint">Видно в карточке тарифа и при оформлении сделки. Можно оставить пустым.</div>
          </div>
        </div>

        <!-- ── Условия ── -->
        <div class="ip-block">
          <div class="ip-block-title">Условия</div>

          <!-- 1. Сроки -->
          <div class="ip-step-block">
            <div class="ip-step-head">
              <div class="ip-step-num">1</div>
              <div class="ip-step-heading">
                <div class="ip-step-title">Сроки рассрочки</div>
                <div class="ip-step-hint">Сколько платежей бывает по этому тарифу</div>
              </div>
            </div>
            <div class="ip-step-body">
              <div class="ip-terms">
                <button
                  v-for="t in TERM_PRESETS"
                  :key="t"
                  class="ip-term"
                  :class="{ 'ip-term--on': grid.terms.includes(t) }"
                  :disabled="advanced"
                  @click="toggleTerm(t)"
                >
                  {{ t }}
                </button>
                <span
                  v-for="t in grid.terms.filter((x) => !TERM_PRESETS.includes(x))"
                  :key="`extra-${t}`"
                  class="ip-term ip-term--on ip-term--extra"
                  @click="!advanced && toggleTerm(t)"
                >
                  {{ t }}
                  <v-icon icon="mdi-close" size="12" />
                </span>
                <!-- Свой срок: у кого-то рассрочка на 5 или 10 платежей. -->
                <span class="ip-term-custom">
                  <input
                    v-model.number="customTerm"
                    type="number"
                    min="1"
                    class="ip-term-input"
                    placeholder="свой"
                    :disabled="advanced"
                    @keyup.enter="addCustomTerm"
                  />
                  <button class="ip-term-add" :disabled="advanced || !customTerm" @click="addCustomTerm">
                    <v-icon icon="mdi-plus" size="15" />
                  </button>
                </span>
              </div>
            </div>
          </div>

          <template v-if="!advanced">
            <!-- 2. Наценка. Идёт сразу за сроками: это и есть тариф, всё
                 остальное — необязательные уточнения ниже. -->
            <div class="ip-step-block">
              <div class="ip-step-head">
                <div class="ip-step-num">2</div>
                <div class="ip-step-heading">
                  <div class="ip-step-title">Наценка</div>
                  <div class="ip-step-hint">{{ markupHint }}</div>
                </div>
              </div>
              <div class="ip-step-body">
                <div v-if="!grid.terms.length" class="ip-note">
                  Выберите хотя бы один срок — иначе тарифу нечего предлагать
                </div>

                <!-- Сначала «от чего зависит», сразу под каждым ответом — его
                     границы, и только потом сами проценты. Раньше это были два
                     разных шага, и связь между галочкой и таблицей терялась. -->
                <div class="ip-part">
                  <div class="ip-part-title">От чего зависит наценка</div>

                  <div class="ip-deps">
                    <div class="ip-dep" :class="{ 'ip-dep--on': byAmount }">
                      <label class="ip-dep-head">
                        <input v-model="byAmount" type="checkbox" />
                        <span class="ip-dep-text">
                          <span class="ip-dep-title">От цены товара</span>
                          <span class="ip-dep-sub">
                            {{
                              byAmount
                                ? `Ступени: ${amountChoiceSummary}`
                                : 'На дорогой товар — своя наценка. Например: до 100 000 ₽ — 25%, дороже — 18%'
                            }}
                          </span>
                        </span>
                      </label>

                      <!-- Границы живут внутри своего переключателя: это его
                           настройка, а не отдельный шаг. -->
                      <div v-if="byAmount" class="ip-dep-body">
                        <!-- Границы — таблицей: у каждой видно, какие две
                             ступени она разводит. Кнопка добавления живёт в
                             шапке, а не в конце списка: место постоянное, и
                             её не нужно искать после каждой новой строки. -->
                        <div class="ip-edges">
                          <div class="ip-edges-head">
                            <span class="ip-edges-title">Границы цены</span>
                            <button class="ip-step-add" @click="addStep()">
                              <v-icon icon="mdi-plus" size="14" />
                              Граница
                            </button>
                          </div>

                          <div class="ip-grid-wrap">
                            <table class="ip-tbl ip-tbl--edges">
                              <thead>
                                <tr>
                                  <th class="ip-tbl-edge-val">Граница</th>
                                  <th class="ip-tbl-edge-split">Что она делит</th>
                                  <th class="ip-tbl-edge-act"><span class="ip-sr">Убрать</span></th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr v-for="(row, i) in amountEdgeRows" :key="i">
                                  <td class="ip-tbl-edge-val">
                                    <span class="ip-step-chip">
                                      <input
                                        :value="row.value"
                                        v-maska="CURRENCY_MASK"
                                        class="ip-step-input"
                                        @maska="(e: any) => setStep(i, parseMasked(e))"
                                      />
                                      <span class="ip-step-cur">₽</span>
                                    </span>
                                  </td>
                                  <td class="ip-tbl-edge-split">
                                    <span class="ip-edge-band">{{ row.below }}</span>
                                    <v-icon icon="mdi-arrow-right" size="13" class="ip-edge-arrow" />
                                    <span class="ip-edge-band">{{ row.above }}</span>
                                  </td>
                                  <td class="ip-tbl-edge-act">
                                    <button
                                      class="ip-edge-del"
                                      title="Убрать границу"
                                      @click="removeStep(i)"
                                    >
                                      <v-icon icon="mdi-close" size="14" />
                                    </button>
                                  </td>
                                </tr>
                                <tr v-if="!amountEdgeRows.length">
                                  <td colspan="3" class="ip-edges-empty">
                                    Границ пока нет — наценка одна на любую цену
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          <div class="ip-steps-hint">
                            Товар ровно на границе идёт в верхнюю ступень: за 100 000 ₽ — уже «от 100 000».
                            Каждая ступень получит свою вкладку в таблице ниже.
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="ip-dep" :class="{ 'ip-dep--on': byDownPayment }">
                      <label class="ip-dep-head">
                        <input v-model="byDownPayment" type="checkbox" />
                        <span class="ip-dep-text">
                          <span class="ip-dep-title">От первого взноса</span>
                          <span class="ip-dep-sub">
                            {{
                              byDownPayment
                                ? `Ступени: ${downChoiceSummary}`
                                : 'Чем больше взнос — тем дешевле. Например: без взноса 25%, а со взносом от 30% — 18%'
                            }}
                          </span>
                        </span>
                      </label>

                      <div v-if="byDownPayment" class="ip-dep-body">
                        <!-- Порядок: сначала способ перехода и схема, границы —
                             под ними. Способ меняет смысл самих границ (опорные
                             точки или ступени), поэтому выбирается раньше; схема
                             отвечает на вопрос «что это даст», а числа правят уже
                             по ней. -->

                        <!-- Выбор между скачком и плавным переходом — карточками, а не
                             выпадающим списком: разницу нужно прочитать, а не угадать. -->
                        <div class="ip-choices ip-choices--inline">
                          <label class="ip-choice" :class="{ 'ip-choice--on': draft.downMode === 'STEPS' }">
                            <input v-model="draft.downMode" type="radio" value="STEPS" />
                            <span class="ip-choice-body">
                              <span class="ip-choice-title">Ступенями</span>
                              <span class="ip-choice-text">
                                Внутри ступени процент один, на границе меняется скачком.
                                Проще объяснять клиенту
                              </span>
                            </span>
                          </label>
                          <label class="ip-choice" :class="{ 'ip-choice--on': draft.downMode === 'CURVE' }">
                            <input v-model="draft.downMode" type="radio" value="CURVE" />
                            <span class="ip-choice-body">
                              <span class="ip-choice-title">Плавно</span>
                              <span class="ip-choice-text">
                                Границы — опорные точки, между ними наценка меняется постепенно.
                                Лишний процент взноса всегда чуть выгоднее
                              </span>
                            </span>
                          </label>
                        </div>

                        <!-- Схема на своих же числах: у ступеней линия держится
                             и падает скачком на границе, у кривой едет наклоном.
                             Словами эта разница не читается. -->
                        <div v-if="vizGeom" ref="vizEl" class="ip-viz">
                          <svg class="ip-viz-svg" :viewBox="`0 0 ${vizGeom.w} ${vizGeom.h}`">
                            <line
                              :x1="vizGeom.zeroX"
                              :y1="vizGeom.baseY"
                              :x2="vizGeom.fullX"
                              :y2="vizGeom.baseY"
                              class="ip-viz-axis"
                            />
                            <line
                              v-for="(e, i) in vizGeom.edges"
                              :key="`edge-${i}`"
                              :x1="e.x"
                              y1="8"
                              :x2="e.x"
                              :y2="vizGeom.baseY"
                              class="ip-viz-edge"
                            />

                            <template v-if="draft.downMode === 'STEPS'">
                              <line
                                v-for="(s, i) in vizGeom.segments"
                                :key="`seg-${i}`"
                                :x1="s.x1"
                                :y1="s.y"
                                :x2="s.x2"
                                :y2="s.y"
                                class="ip-viz-line"
                              />
                              <line
                                v-for="(j, i) in vizGeom.jumps"
                                :key="`jump-${i}`"
                                :x1="j.x"
                                :y1="j.y1"
                                :x2="j.x"
                                :y2="j.y2"
                                class="ip-viz-jump"
                              />
                              <text
                                v-for="(s, i) in vizGeom.segments"
                                :key="`sv-${i}`"
                                :x="s.mid"
                                :y="s.y - 6"
                                class="ip-viz-val"
                              >
                                {{ s.markup }}%
                              </text>
                            </template>

                            <template v-else>
                              <path :d="vizGeom.curvePath" class="ip-viz-line" fill="none" />

                              <!-- Промежуточное значение: штрих от линии вниз и
                                   подпись. Ради него плавный режим и включают —
                                   взнос между границами даёт свой процент. -->
                              <template v-for="(m, i) in vizGeom.midPoints" :key="`mid-${i}`">
                                <line
                                  :x1="m.x"
                                  :y1="m.y"
                                  :x2="m.x"
                                  :y2="vizGeom.baseY"
                                  class="ip-viz-mid-line"
                                />
                                <circle :cx="m.x" :cy="m.y" r="2.5" class="ip-viz-mid-dot" />
                                <text :x="m.x" :y="m.y - 7" class="ip-viz-mid-val">{{ m.value }}</text>
                                <text
                                  v-if="m.showAt"
                                  :x="m.x"
                                  :y="vizGeom.h - 6"
                                  class="ip-viz-ax ip-viz-ax--mid ip-viz-ax--soft"
                                >
                                  {{ m.at }}
                                </text>
                              </template>

                              <circle
                                v-for="(p, i) in vizGeom.points"
                                :key="`pt-${i}`"
                                :cx="p.x"
                                :cy="p.y"
                                r="3"
                                class="ip-viz-dot"
                              />
                              <text
                                v-for="(p, i) in vizGeom.points"
                                :key="`pv-${i}`"
                                :x="p.x"
                                :y="p.y - 8"
                                class="ip-viz-val"
                              >
                                {{ p.markup }}%
                              </text>
                            </template>

                            <text :x="vizGeom.zeroX" :y="vizGeom.h - 6" class="ip-viz-ax">0%</text>
                            <text
                              v-for="(e, i) in vizGeom.edges"
                              :key="`el-${i}`"
                              :x="e.x"
                              :y="vizGeom.h - 6"
                              class="ip-viz-ax ip-viz-ax--mid"
                            >
                              {{ e.label }}
                            </text>
                            <text
                              :x="vizGeom.fullX"
                              :y="vizGeom.h - 6"
                              class="ip-viz-ax ip-viz-ax--end"
                            >
                              100%
                            </text>
                          </svg>

                          <div class="ip-viz-note">
                            {{
                              draft.downMode === 'STEPS'
                                ? 'Внутри полосы наценка одна и та же: и при 5%, и при 29% взноса. На границе она падает скачком.'
                                : 'Наценка съезжает постепенно: каждый лишний процент взноса немного её снижает, скачков на границе нет.'
                            }}
                          </div>
                          <div class="ip-viz-legend">
                            по горизонтали — первый взнос, по вертикали — наценка{{ vizTermNote }}
                          </div>
                        </div>

                        <!-- Границы — таблицей под схемой: правишь число и
                             сразу видишь наверху, как поехала линия. -->
                        <div class="ip-edges">
                          <div class="ip-edges-head">
                            <span class="ip-edges-title">
                              {{ draft.downMode === 'CURVE' ? 'Опорные точки' : 'Границы взноса' }}
                            </span>
                            <button class="ip-step-add" @click="addDownStep()">
                              <v-icon icon="mdi-plus" size="14" />
                              {{ draft.downMode === 'CURVE' ? 'Точка' : 'Граница' }}
                            </button>
                          </div>

                          <div class="ip-grid-wrap">
                            <table class="ip-tbl ip-tbl--edges">
                              <thead>
                                <tr>
                                  <th class="ip-tbl-edge-val">Взнос</th>
                                  <th class="ip-tbl-edge-split">Что она делит</th>
                                  <th class="ip-tbl-edge-act"><span class="ip-sr">Убрать</span></th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr v-for="(row, i) in downEdgeRows" :key="i">
                                  <td class="ip-tbl-edge-val">
                                    <NumberStepper
                                      :model-value="row.value"
                                      :min="1"
                                      :max="99"
                                      :precision="0"
                                      @update:model-value="(v) => setDownStep(i, v)"
                                    />
                                  </td>
                                  <td class="ip-tbl-edge-split">
                                    <span class="ip-edge-band">{{ row.below }}</span>
                                    <v-icon icon="mdi-arrow-right" size="13" class="ip-edge-arrow" />
                                    <span class="ip-edge-band">{{ row.above }}</span>
                                  </td>
                                  <td class="ip-tbl-edge-act">
                                    <button
                                      class="ip-edge-del"
                                      title="Убрать границу"
                                      @click="removeDownStep(i)"
                                    >
                                      <v-icon icon="mdi-close" size="14" />
                                    </button>
                                  </td>
                                </tr>
                                <tr v-if="!downEdgeRows.length">
                                  <td colspan="3" class="ip-edges-empty">
                                    Границ пока нет — наценка одна при любом взносе
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          <!-- В плавном режиме говорить про «верхнюю ступень»
                               нельзя: скачка на границе там как раз нет. -->
                          <div class="ip-steps-hint">
                            {{
                              draft.downMode === 'CURVE'
                                ? 'Доля считается от цены договора. В самой точке действует её процент, между точками наценка меняется плавно. Каждая точка станет колонкой в таблице ниже.'
                                : 'Доля считается от цены договора; взнос ровно на границе идёт в верхнюю ступень: 30% — это уже «от 30%». Каждая ступень станет колонкой в таблице ниже.'
                            }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Таблица наценок — в своей рамке с шапкой: это самая
                     плотная часть окна, и без внешней границы её строки
                     сливались с полями шага вокруг. -->
                <div v-if="grid.terms.length" class="ip-part ip-part--framed">
                  <div class="ip-part-head">
                    <div class="ip-part-headings">
                      <span class="ip-part-title">Наценка по срокам</span>
                      <!-- Легенда связывает включённые зависимости с осями
                           таблицы: без неё непонятно, откуда взялись колонки
                           и вкладки. -->
                      <span class="ip-part-note">{{ partNote }}</span>
                    </div>
                    <!-- Цена примера здесь же: иначе, чтобы понять, что получит
                         клиент, пришлось бы листать до «Проверки». -->
                    <label class="ip-part-sample">
                      <span class="ip-part-sample-label">что выйдет за товар</span>
                      <span class="ip-suffix-wrap ip-suffix-wrap--sample">
                        <input
                          :value="sample"
                          v-maska="CURRENCY_MASK"
                          class="ip-text ip-text--sample"
                          @maska="(e: any) => (sample = parseMasked(e) ?? 0)"
                        />
                        <span class="ip-suffix">₽</span>
                      </span>
                    </label>
                  </div>

                  <div class="ip-part-body">

                <!-- Пока наценка ни от чего не зависит, таблица не нужна: это
                     одно число на срок, и сетка вокруг него только мешала. -->
                <template v-if="!byAmount && !byDownPayment">
                  <div class="ip-grid-wrap">
                    <table class="ip-tbl">
                      <thead>
                        <tr>
                          <th>Срок</th>
                          <th class="ip-tbl-mid">Наценка, %</th>
                          <th class="ip-tbl-num">Наценка, ₽</th>
                          <th v-if="grid.minDownPaymentPercent" class="ip-tbl-num">Первый взнос</th>
                          <th class="ip-tbl-num">Платёж</th>
                          <th class="ip-tbl-num">Цена договора</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="t in grid.terms" :key="t">
                          <td class="ip-tbl-term">{{ termLabel(t) }}</td>
                          <td class="ip-tbl-mid">
                            <NumberStepper
                              :model-value="cellValue(t, 0, 0)"
                              :max="500"
                              @update:model-value="(v) => setCell(t, 0, 0, v)"
                            />
                          </td>
                          <td class="ip-tbl-num ip-tbl-markup">{{ simpleRows[t]?.markup }}</td>
                          <td v-if="grid.minDownPaymentPercent" class="ip-tbl-num">
                            {{ simpleRows[t]?.down }}
                          </td>
                          <td class="ip-tbl-num">{{ simpleRows[t]?.payment }}</td>
                          <td class="ip-tbl-num">{{ simpleRows[t]?.total }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </template>

                <template v-else>
                  <!-- Стоимость переключается вкладками: в одной таблице три
                       измерения читаются хуже, чем два плюс выбор ступени. -->
                  <div v-if="byAmount && grid.steps.length" class="ip-tabs">
                    <button
                      v-for="(label, i) in stepLabels(grid.steps)"
                      :key="i"
                      class="ip-tab"
                      :class="{ 'ip-tab--on': activeAmountStep === i }"
                      @click="activeAmountStep = i"
                    >
                      {{ label }}
                    </button>
                  </div>

                  <div class="ip-grid-wrap">
                    <table class="ip-tbl ip-tbl--grid">
                      <thead>
                        <tr>
                          <th rowspan="2" class="ip-tbl-corner">Срок</th>
                          <!-- Надпись над колонками: без неё в клетках просто
                               числа, и к чему они — к наценке или к платежу —
                               приходится догадываться. -->
                          <th :colspan="downStepCount(grid.downSteps)" class="ip-tbl-group">
                            Наценка при первом взносе
                          </th>
                        </tr>
                        <tr>
                          <th
                            v-for="(label, i) in downStepLabels(grid.downSteps)"
                            :key="i"
                            class="ip-tbl-mid"
                          >
                            {{ label }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="t in grid.terms" :key="t">
                          <td class="ip-tbl-term">{{ termLabel(t) }}</td>
                          <td v-for="di in downStepCount(grid.downSteps)" :key="di" class="ip-tbl-mid">
                            <NumberStepper
                              :model-value="cellValue(t, activeAmountStep, di - 1)"
                              :max="500"
                              @update:model-value="(v) => setCell(t, activeAmountStep, di - 1, v)"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div class="ip-step-hint" style="margin-top: 8px;">
                    В клетке — наценка. {{ cellExampleLabel }}
                  </div>
                </template>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. Первый взнос -->
            <div class="ip-step-block ip-step-block--last">
              <div class="ip-step-head">
                <div class="ip-step-num">3</div>
                <div class="ip-step-heading">
                  <div class="ip-step-title">Первый взнос</div>
                </div>
              </div>
              <div class="ip-step-body">
                <label class="ip-toggle">
                  <input v-model="requireDownPayment" type="checkbox" />
                  <span class="ip-toggle-track"><span class="ip-toggle-thumb" /></span>
                  <span class="ip-toggle-text">
                    {{ requireDownPayment ? 'Первый взнос обязателен' : 'Можно оформить без первого взноса' }}
                    <span class="ip-toggle-hint">
                      {{
                        requireDownPayment
                          ? 'без взноса продавец не сможет оформить договор по этому тарифу'
                          : 'клиент может забрать товар, не заплатив ничего в день сделки'
                      }}
                    </span>
                  </span>
                </label>

                <div v-if="requireDownPayment" class="ip-down">
                  <span class="ip-down-label">Не меньше</span>
                  <NumberStepper
                    v-model="grid.minDownPaymentPercent"
                    :min="1"
                    :max="99"
                    :precision="0"
                  />
                  <span class="ip-down-note">от цены договора</span>
                </div>
              </div>
            </div>
          </template>

          <!-- Подробный режим — для старых программ со сложными полосами. -->
          <template v-else>
            <div class="ip-note ip-note--warn">
              <v-icon icon="mdi-information-outline" size="15" />
              У этого тарифа условия заданы полосами, которые не ложатся в простую
              таблицу (разный взнос или несовпадающие границы). Показываем их как есть,
              чтобы ничего не сломать по идущим продажам.
            </div>
            <div class="ip-raw-head">
              <span>Стоимость от</span>
              <span>до</span>
              <span>Платежей</span>
              <span>Наценка %</span>
              <span>Взнос %</span>
              <span></span>
            </div>
            <div v-for="(r, i) in rawRules" :key="i" class="ip-raw-row">
              <input
                :value="r.amountFrom ?? ''"
                v-maska="CURRENCY_MASK"
                class="ip-cell"
                placeholder="0"
                @maska="(e: any) => (r.amountFrom = parseMasked(e))"
              />
              <input
                :value="r.amountTo ?? ''"
                v-maska="CURRENCY_MASK"
                class="ip-cell"
                placeholder="без предела"
                @maska="(e: any) => (r.amountTo = parseMasked(e))"
              />
              <input v-model.number="r.termPayments" type="number" min="1" class="ip-cell" />
              <NumberStepper v-model="r.markupPercent" :max="500" />
              <NumberStepper v-model="r.minDownPaymentPercent" :max="99" :precision="0" />
              <button class="ip-step-del" title="Удалить строку" @click="removeRawRule(i)">
                <v-icon icon="mdi-close" size="15" />
              </button>
            </div>
            <button class="ip-ghost mt-2" @click="addRawRule">
              <v-icon icon="mdi-plus" size="15" />
              Добавить строку
            </button>
          </template>
        </div>

        <!-- ── Как считается ── -->
        <div class="ip-block">
          <div class="ip-block-title">Как считается</div>
          <div class="ip-row-3">
            <div class="ip-field">
              <label class="ip-label">Наценка считается</label>
              <select v-model="draft.markupBase" class="ip-text">
                <option value="OF_COST">от закупочной цены</option>
                <option value="OF_TOTAL">от цены продажи</option>
              </select>
            </div>
            <div class="ip-field">
              <label class="ip-label">Платежи</label>
              <select v-model="draft.paymentInterval" class="ip-text">
                <option value="MONTHLY">раз в месяц</option>
                <option value="BIWEEKLY">раз в две недели</option>
                <option value="WEEKLY">раз в неделю</option>
              </select>
            </div>
            <div class="ip-field">
              <label class="ip-label">Округлять платёж</label>
              <select v-model="draft.rounding" class="ip-text">
                <option value="NONE">не округлять</option>
                <option value="TO_50">до 50 ₽</option>
                <option value="TO_100">до 100 ₽</option>
                <option value="TO_500">до 500 ₽</option>
                <option value="TO_1000">до 1000 ₽</option>
              </select>
            </div>
          </div>

          <div v-if="draft.rounding !== 'NONE'" class="ip-field">
            <label class="ip-label">Куда уходит остаток от округления</label>
            <select v-model="draft.roundingTarget" class="ip-text">
              <option value="LAST_PAYMENT">в последний платёж — цена договора точная</option>
              <option value="TOTAL">в цену договора — все платежи одинаковые</option>
            </select>
            <div class="ip-step-hint" style="margin-top: 6px;">
              {{
                draft.roundingTarget === 'TOTAL'
                  ? 'Платёж округляется, а цена подгоняется под него: клиент платит одинаково весь срок'
                  : 'Цена остаётся ровно посчитанной, а разница копится в последнем платеже'
              }}
            </div>
          </div>

          <div class="ip-row-3" style="margin-top: 12px;">
            <div class="ip-field">
              <label class="ip-label">Наценка не меньше</label>
              <span class="ip-suffix-wrap">
                <input
                  :value="draft.minMarkupAmount ?? ''"
                  v-maska="CURRENCY_MASK"
                  class="ip-text"
                  placeholder="без ограничения"
                  @maska="(e: any) => (draft.minMarkupAmount = parseMasked(e) || null)"
                />
                <span class="ip-suffix">₽</span>
              </span>
              <div class="ip-step-hint" style="margin-top: 6px;">
                на дешёвом товаре процент даёт слишком мало
              </div>
            </div>
            <div class="ip-field">
              <label class="ip-label">Взнос по умолчанию</label>
              <NumberStepper
                v-model="draft.defaultDownPaymentPercent"
                :max="99"
                :precision="0"
              />
              <div class="ip-step-hint" style="margin-top: 6px;">
                подставится в форму сделки, продавец сможет поправить
              </div>
            </div>
          </div>

          <div class="ip-toggles">
            <label class="ip-toggle">
              <input v-model="draft.isDefault" type="checkbox" />
              <span class="ip-toggle-track"><span class="ip-toggle-thumb" /></span>
              <span class="ip-toggle-text">
                Подставлять этот тариф в новых сделках
                <span class="ip-toggle-hint">продавцу останется только проверить условия</span>
              </span>
            </label>
            <label class="ip-toggle">
              <input v-model="draft.strict" type="checkbox" />
              <span class="ip-toggle-track"><span class="ip-toggle-thumb" /></span>
              <span class="ip-toggle-text">
                Строгий тариф — продавец не может изменить условия
                <span class="ip-toggle-hint">отступить сможет только тот, кому вы это разрешили</span>
              </span>
            </label>
          </div>
        </div>

        <!-- ── Проверка на живом товаре ── -->
        <div class="ip-block ip-block--sample">
          <div class="ip-block-title">Проверка</div>
          <div class="ip-sample-head">
            <span>Товар за</span>
            <span class="ip-suffix-wrap ip-suffix-wrap--sample">
              <input
                :value="sample"
                v-maska="CURRENCY_MASK"
                class="ip-text ip-text--sample"
                @maska="(e: any) => (sample = parseMasked(e) ?? 0)"
              />
              <span class="ip-suffix">₽</span>
            </span>
            <span>по этому тарифу</span>

            <!-- Когда наценка зависит от взноса, без него проверку не прочитать:
                 на один срок приходится несколько ступеней. -->
            <template v-if="byDownPayment">
              <span>при взносе</span>
              <NumberStepper v-model="sampleDownPercent" :max="99" :precision="0" />
            </template>
          </div>

          <div v-if="sampleRows.length" class="ip-sample">
            <div class="ip-sample-row ip-sample-row--head">
              <span>Срок</span>
              <span>Цена договора</span>
              <span>Первый взнос</span>
              <span>Платёж</span>
              <span>Переплата</span>
            </div>
            <div v-for="r in sampleRows" :key="r.term" class="ip-sample-row">
              <span>{{ termLabel(r.term) }}</span>
              <span>{{ formatCurrency(r.total) }}</span>
              <span>{{ r.down ? formatCurrency(r.down) : '—' }}</span>
              <span>
                {{ formatCurrency(r.payment) }}
                <span v-if="r.lastDiffers" class="ip-sample-last">
                  последний {{ formatCurrency(r.last) }}
                </span>
              </span>
              <span class="ip-sample-over">+{{ formatCurrency(r.overpay) }}</span>
            </div>

            <div v-if="sampleRows.some((r) => r.roundingSkipped)" class="ip-sample-note">
              <v-icon icon="mdi-information-outline" size="14" />
              На коротких сроках платёж меньше шага округления — там график считается
              без округления, иначе последний платёж забирал бы почти весь долг.
            </div>
          </div>
          <div v-else class="ip-note">
            Для товара такой стоимости условий нет — продавец не сможет выбрать этот
            тариф. Добавьте срок или подвиньте границы стоимости.
          </div>
        </div>

        <div v-if="problems.length" class="ip-problems">
          <div v-for="(p, i) in problems" :key="i" class="ip-problem">
            <v-icon icon="mdi-alert-outline" size="15" />
            {{ p }}
          </div>
        </div>
      </div>

      <div class="ip-editor-actions">
        <button class="ip-cancel" @click="dialog = false">Отмена</button>
        <button class="ip-save" :disabled="!canSave || saving" @click="save">
          {{ saving ? 'Сохраняю…' : 'Сохранить' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.ip-head { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.ip-head-text { flex: 1 1 320px; min-width: 0; }
.ip-title { font-size: 17px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.ip-sub {
  font-size: 13px; line-height: 1.55; margin-top: 4px; max-width: 720px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ip-head-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.ip-add {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 15px; border-radius: 10px; border: none;
  background: #047857; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
}
.ip-add:hover { background: #036b4e; }
.ip-ghost {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 13px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; cursor: pointer;
  font-size: 12.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.65);
}
.ip-ghost:hover { border-color: rgba(4, 120, 87, 0.4); color: #047857; }

.ip-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 40px 24px; text-align: center;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 14px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ip-empty-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.ip-empty-text { font-size: 13px; line-height: 1.5; max-width: 460px; }

/* Карточки в ряд: тариф — короткая сущность, во всю ширину экрана он выглядел
   как баннер, а рядом их обычно два-три. */
.ip-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 480px));
  gap: 14px;
}
@media (max-width: 560px) {
  .ip-list { grid-template-columns: minmax(0, 1fr); }
}

/* Карточка тарифа — на фирменном зелёном градиенте, как шапки сделки и счёта:
   тариф это «лицо» условий, и в списке он должен читаться как карточка, а не
   как выгрузка таблицы. */
.ip-card {
  padding: 18px 20px; border-radius: 16px;
  background: linear-gradient(135deg, #047857 0%, #065f46 55%, #064e3b 100%);
  color: #fff;
}
.dark .ip-card { background: linear-gradient(135deg, #047857 0%, #064e3b 55%, #022c22 100%); }
.ip-card-head { display: flex; align-items: flex-start; gap: 16px; }
.ip-card-title { font-size: 17px; font-weight: 700; letter-spacing: -0.2px; }
.ip-card-seller { font-size: 12.5px; color: rgba(255, 255, 255, 0.7); margin-top: 2px; }
.ip-card-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
.ip-card-desc { font-size: 12.5px; color: rgba(255, 255, 255, 0.62); margin-top: 6px; }
.ip-card-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.ip-card-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 12px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.14); color: #fff;
  font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.ip-card-btn:hover { background: rgba(255, 255, 255, 0.24); }
/* Удаление — отдельной кнопкой-иконкой: действие необратимое, и его не должно
   быть легко нажать вместо «Изменить». */
.ip-card-btn--danger { padding: 0 9px; }
.ip-card-btn--danger:hover { background: rgba(220, 38, 38, 0.55); border-color: rgba(220, 38, 38, 0.6); }
.ip-badge {
  padding: 2px 8px; border-radius: 7px; font-size: 10.5px; font-weight: 700;
  background: rgba(255, 255, 255, 0.18); color: #fff;
}
.ip-badge--default { background: rgba(255, 255, 255, 0.9); color: #047857; }
.ip-badge--strict { background: rgba(251, 191, 36, 0.28); color: #fde68a; }

/* Условия внутри карточки: строка на срок, ячейка на ступень стоимости. */
.ip-card-terms {
  margin-top: 14px; padding: 10px 12px; border-radius: 12px;
  background: rgba(0, 0, 0, 0.16);
}
.ip-card-steps, .ip-card-term {
  display: grid;
  grid-template-columns: minmax(96px, 1.2fr) repeat(auto-fit, minmax(72px, 1fr));
  gap: 8px; align-items: center;
}
.ip-card-steps {
  padding-bottom: 6px; margin-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}
.ip-card-steps-label, .ip-card-step {
  font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}
.ip-card-step { text-align: center; }
.ip-card-term { padding: 5px 0; }
.ip-card-term-name { font-size: 13.5px; font-weight: 600; color: rgba(255, 255, 255, 0.9); }
.ip-card-pct {
  text-align: center; font-size: 15px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ip-card-foot {
  display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px;
}
.ip-card-fact {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; color: rgba(255, 255, 255, 0.72);
}
.ip-card-fact--deals { color: rgba(255, 255, 255, 0.55); }

@media (max-width: 700px) {
  .ip-card-steps, .ip-card-term { grid-template-columns: 1fr; gap: 2px; }
  .ip-card-step, .ip-card-pct { text-align: left; }
  .ip-card-steps { display: none; }
}

/* ── Редактор ── */
.ip-editor { padding: 0; }
.ip-editor-head {
  display: flex; align-items: flex-start; gap: 16px;
  padding: 18px 24px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.ip-close {
  margin-left: auto; width: 32px; height: 32px; border-radius: 9px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.05); cursor: pointer;
}
.ip-editor-body { padding: 18px 24px; max-height: 66vh; overflow-y: auto; }
.ip-editor-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 14px 24px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.ip-cancel {
  height: 40px; padding: 0 18px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; font-size: 13.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer;
}
.ip-save {
  height: 40px; padding: 0 22px; border-radius: 10px; border: none;
  background: #047857; color: #fff; font-size: 13.5px; font-weight: 600; cursor: pointer;
}
.ip-save:disabled { opacity: 0.5; cursor: default; }

.ip-row-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ip-row-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 700px) {
  .ip-row-2, .ip-row-3 { grid-template-columns: minmax(0, 1fr); }
}
.ip-field { margin-bottom: 12px; min-width: 0; }
.ip-field--narrow { max-width: 220px; }
.ip-label {
  display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ip-text {
  width: 100%; height: 40px; padding: 0 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 14px; outline: none;
}
.ip-text:focus { border-color: rgba(4, 120, 87, 0.5); }
/* У select своя стрелка: системная в Safari рисуется по-своему и ломает
   выравнивание в ряду с обычными полями. */
select.ip-text {
  appearance: none; -webkit-appearance: none;
  padding-right: 34px;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round'%3e%3cpath d='M6 9l6 6 6-6'/%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 16px;
  cursor: pointer;
}
.ip-hint { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.42); margin-top: 4px; }
.ip-suffix-wrap { position: relative; }
.ip-suffix-wrap .ip-text { padding-right: 30px; }
.ip-suffix {
  position: absolute; right: 11px; top: 50%; transform: translateY(-50%);
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.4); pointer-events: none;
}

/* ── Блоки редактора ── */
.ip-block {
  margin-top: 16px; padding: 16px 18px; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.ip-block-title { font-size: 14.5px; font-weight: 700; margin-bottom: 12px; }
.ip-sub-label {
  font-size: 12px; font-weight: 600; margin-bottom: 8px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/* Условия — четыре пронумерованных шага: сроки → стоимость → наценка → взнос.
   Раньше это был сплошной поток полей, и было неясно, что от чего зависит. */
.ip-step-block {
  padding: 14px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.ip-step-block:first-of-type { padding-top: 4px; }
.ip-step-block--last { border-bottom: none; padding-bottom: 4px; }
/* Номер шага держит только заголовок. Раньше он был колонкой на весь шаг, и
   всё содержимое — таблицы, схемы — жило с отступом под него, теряя ширину
   без всякой на то причины. */
.ip-step-head { display: flex; gap: 12px; align-items: flex-start; }
.ip-step-heading { min-width: 0; }
.ip-step-body { margin-top: 10px; }
.ip-step-num {
  width: 24px; height: 24px; border-radius: 8px; flex: none; margin-top: 1px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.1); color: #047857;
  font-size: 12px; font-weight: 800;
}
.ip-step-title { font-size: 13.5px; font-weight: 700; }
.ip-step-hint {
  font-size: 12px; line-height: 1.4; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Сроки — переключатели, а не поле ввода: их называют, а не считают. */
.ip-terms { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.ip-term {
  min-width: 44px; height: 36px; padding: 0 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  font-size: 13.5px; font-weight: 600; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-variant-numeric: tabular-nums;
}
.ip-term:hover:not(:disabled) { border-color: rgba(4, 120, 87, 0.4); }
.ip-term--on { background: rgba(4, 120, 87, 0.1); border-color: #047857; color: #047857; }
.ip-term:disabled { opacity: 0.5; cursor: default; }
.ip-term--extra { display: inline-flex; align-items: center; gap: 5px; }
.ip-term-custom { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; }
.ip-term-input {
  width: 72px; height: 36px; padding: 0 10px; border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.22);
  background: transparent; font-size: 13.5px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.ip-term-add {
  width: 32px; height: 32px; border-radius: 9px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06); cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ip-term-add:disabled { opacity: 0.4; cursor: default; }

/* Тумблер вместо галочки: подпись сама говорит, что сейчас выбрано. */
.ip-toggle {
  display: flex; align-items: flex-start; gap: 10px; margin-top: 10px;
  cursor: pointer;
}
.ip-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.ip-toggle-track {
  position: relative; width: 38px; height: 22px; border-radius: 12px; flex: none; margin-top: 1px;
  background: rgba(var(--v-theme-on-surface), 0.18);
  transition: background 0.15s;
}
.ip-toggle-thumb {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.15s;
}
.ip-toggle input:checked + .ip-toggle-track { background: #047857; }
.ip-toggle input:checked + .ip-toggle-track .ip-toggle-thumb { transform: translateX(16px); }
.ip-toggle-text { font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85); }
.ip-toggle-hint {
  display: block; font-size: 12px; line-height: 1.4; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* ── Ступени по стоимости ── */
.ip-step-chip { position: relative; display: inline-flex; align-items: center; }
/* Вкладки ступеней стоимости над таблицей наценок: третье измерение условий
   вынесено сюда, иначе в одной сетке пришлось бы держать все сочетания. */
.ip-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 2px; }
.ip-tab {
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s;
}
.ip-tab:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.ip-tab--on {
  border-color: #047857;
  background: rgba(4, 120, 87, 0.08);
  color: #047857;
  font-weight: 600;
}

.ip-step-input {
  width: 148px; height: 36px; padding: 0 44px 0 11px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  font-size: 13.5px; outline: none; color: rgba(var(--v-theme-on-surface), 0.87);
  font-variant-numeric: tabular-nums;
}
.ip-step-input:focus { border-color: rgba(4, 120, 87, 0.5); }
.ip-step-cur {
  position: absolute; right: 26px; font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.4); pointer-events: none;
}
.ip-step-del {
  position: absolute; right: 6px; width: 18px; height: 18px; border-radius: 5px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: transparent; cursor: pointer; color: rgba(var(--v-theme-on-surface), 0.35);
}
.ip-step-del:hover { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
.ip-step-add {
  display: inline-flex; align-items: center; gap: 5px;
  height: 36px; padding: 0 14px; border-radius: 9px;
  border: none; background: #047857; cursor: pointer;
  font-size: 12.5px; font-weight: 600; color: #fff;
  transition: background 0.15s;
}
.ip-step-add:hover { background: #036249; }
.ip-step-add:active { background: #02533d; }
.ip-steps-hint { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.42); margin-top: 8px; }

/* ── Границы ступеней таблицей ──
   Чипы в строку не говорили, что получается из чисел, и кнопка «Граница»
   уезжала вправо тем дальше, чем больше границ добавлено. Здесь у кнопки
   постоянное место в шапке, а каждая строка показывает, какие две ступени
   разводит её граница. */
.ip-edges { margin-top: 12px; }
.ip-edges-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; flex-wrap: wrap;
}
.ip-edges-title {
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ip-edges-head .ip-step-add { height: 32px; }
.ip-tbl--edges { margin-top: 2px; }
.ip-tbl--edges td { padding-top: 6px; padding-bottom: 6px; }
/* Колонка с числом — по своей ширине, «что делит» забирает остаток. Селекторы
   с двойным классом: у общей таблицы первый столбец растягивающийся, и при
   равной специфичности побеждало бы то правило. */
.ip-tbl.ip-tbl--edges th:first-child,
.ip-tbl.ip-tbl--edges td:first-child { width: 1%; white-space: nowrap; }
.ip-tbl.ip-tbl--edges .ip-tbl-edge-split { width: 100%; white-space: nowrap; }
.ip-tbl.ip-tbl--edges th:last-child,
.ip-tbl.ip-tbl--edges td:last-child { width: 1%; text-align: right; }
/* Крестик переехал в свою колонку — внутри поля он больше не нужен. */
.ip-tbl--edges .ip-step-input { width: 150px; padding-right: 30px; }
.ip-tbl--edges .ip-step-cur { right: 11px; }
.ip-edge-band {
  display: inline-block; padding: 2px 8px; border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.72); white-space: nowrap;
}
.ip-edge-arrow { margin: 0 6px; color: rgba(var(--v-theme-on-surface), 0.3); }
.ip-edge-del {
  width: 26px; height: 26px; border-radius: 7px; border: none;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; cursor: pointer; color: rgba(var(--v-theme-on-surface), 0.35);
}
.ip-edge-del:hover { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
.ip-edges-empty {
  color: rgba(var(--v-theme-on-surface), 0.45) !important;
  font-size: 12.5px !important;
}
/* Заголовок колонки с кнопкой нужен разметке, но не глазу. */
.ip-sr {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap;
}

/* ── Сетка наценок ── */
/* Простой режим наценки: пока она ни от чего не зависит, это список
   «срок → процент → что выйдет у клиента», а не таблица вокруг одного числа. */
/* Части одного шага: «от чего зависит» и «сколько процентов». Отдельными
   шагами они были раньше — и связь между галочкой и таблицей терялась. */
.ip-part { margin-top: 14px; }
.ip-part-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
}
.ip-part-title {
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ip-part-note {
  display: block; margin-top: 3px;
  font-size: 11.5px; line-height: 1.4; color: rgba(var(--v-theme-on-surface), 0.42);
}

/* Таблица наценок в собственной рамке: шапка с названием и ценой примера,
   ниже — тело с вкладками и сеткой. */
.ip-part--framed {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
  overflow: hidden;
}
.ip-part--framed .ip-part-head {
  padding: 11px 14px;
  background: rgba(var(--v-theme-on-surface), 0.025);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
/* Заголовок с легендой сжимается и переносится по словам, цена примера —
   нет: иначе длинная легенда сталкивала поле на вторую строку. */
.ip-part-headings { flex: 1 1 260px; min-width: 0; }
.ip-part--framed .ip-part-sample { flex: none; }
.ip-part-body { padding: 12px 14px 14px; }
/* Цена примера — подпись и поле одним элементом: подпись сама по себе
   читалась как заголовок соседнего блока. */
.ip-part-sample { display: inline-flex; align-items: center; gap: 9px; cursor: text; }
.ip-part-sample-label {
  font-size: 11.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45); white-space: nowrap;
}
.ip-part--framed .ip-suffix-wrap--sample { width: 132px; }
.ip-part--framed .ip-text--sample { height: 34px; font-size: 13.5px; }
@media (max-width: 640px) {
  .ip-part-sample { width: 100%; justify-content: space-between; }
}

/* Переключатель зависимости и её границы — один блок: настройка принадлежит
   тому ответу, который её включил. */
.ip-deps { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.ip-dep {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); border-radius: 10px;
  transition: border-color 0.15s, background 0.15s;
}
.ip-dep:hover { border-color: rgba(4, 120, 87, 0.3); }
.ip-dep--on { border-color: #047857; background: rgba(4, 120, 87, 0.05); }
.ip-dep-head {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 11px 12px; cursor: pointer;
}
.ip-dep-head input { flex: none; width: 16px; height: 16px; margin-top: 2px; accent-color: #047857; }
.ip-dep-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ip-dep-title { font-size: 13px; font-weight: 700; }
.ip-dep-sub { font-size: 11.5px; line-height: 1.45; color: rgba(var(--v-theme-on-surface), 0.5); }
.ip-dep-body {
  padding: 11px 12px 12px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
/* Карточки способа перехода открывают блок — отступ сверху не нужен. */
.ip-dep-body .ip-choices { margin-top: 0; }

/* Усложнения выбираются карточками: партнёр читает, что даст галочка,
   и видит в той же карточке, что уже настроено. */
.ip-choices {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px; margin-top: 12px;
}
.ip-choice {
  display: flex; gap: 10px; padding: 11px 12px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); border-radius: 10px;
  transition: border-color 0.15s, background 0.15s;
}
.ip-choice:hover { border-color: rgba(4, 120, 87, 0.35); }
.ip-choice--on { border-color: #047857; background: rgba(4, 120, 87, 0.06); }
.ip-choice input { flex: none; width: 16px; height: 16px; margin-top: 2px; accent-color: #047857; }
.ip-choice-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ip-choice-title { font-size: 13px; font-weight: 700; }
.ip-choice-text {
  font-size: 11.5px; line-height: 1.45; color: rgba(var(--v-theme-on-surface), 0.5);
}
@media (max-width: 640px) {
  .ip-choices { grid-template-columns: 1fr; }
}

/* Проценты — таблицей с шапкой и ячейками: и в простом тарифе, и в сетке со
   ступенями. Раньше простой режим был списком, а сетка — россыпью полей, и
   к чему относится число, приходилось додумывать. */
.ip-grid-wrap { overflow-x: auto; margin-top: 10px; }
.ip-tbl { width: 100%; border-collapse: collapse; }
.ip-tbl th {
  padding: 0 14px 7px; text-align: left; white-space: nowrap;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.ip-tbl td {
  padding: 7px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.72);
}
.ip-tbl tr:last-child td { border-bottom: none; }
/* Колонки разделены чертой: без неё «20 %», «+20 000 ₽» и «40 000 ₽» стояли
   встык и читались как одно число. */
.ip-tbl th:not(:last-child), .ip-tbl td:not(:last-child) {
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.ip-tbl th:first-child, .ip-tbl td:first-child { padding-left: 0; }
.ip-tbl th:last-child, .ip-tbl td:last-child { padding-right: 0; }
.ip-tbl-term {
  font-size: 13px !important; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85) !important; white-space: nowrap;
}
/* Первый столбец забирает свободную ширину, остальные идут компактной группой
   справа — иначе между наценкой и платежом зияла пустая полоса. */
.ip-tbl th:first-child, .ip-tbl td:first-child { width: 100%; }
.ip-tbl-mid { width: 1%; }
.ip-tbl-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
/* Заработок в рублях — рядом с процентом, чтобы тот не оставался абстракцией. */
.ip-tbl-markup { color: #047857; font-weight: 600; }
/* Общая шапка над колонками ступеней: сама граница у неё ниже, у подзаголовков. */
.ip-tbl-group {
  text-align: center !important; border-bottom: none !important; padding-bottom: 4px !important;
  color: rgba(var(--v-theme-on-surface), 0.55) !important;
}
.ip-tbl-corner { vertical-align: bottom; }

/* ── Сетка «срок × ступень взноса» ──
   Надпись «Наценка при первом взносе» раньше висела в воздухе: по ней нельзя
   было понять, накрывает она колонки ступеней или относится ко всей таблице.
   Даём ей фон-«крышу» того же цвета, что и колонки под ней, — группа читается
   одним блоком. Заодно клетки этой сетки центрированы и не липнут к краям:
   подзаголовок «взнос до 30%» стоял вплотную к границе таблицы. */
.ip-tbl--grid .ip-tbl-group {
  background: rgba(4, 120, 87, 0.08);
  color: #047857 !important;
  font-size: 10.5px;
  /* Надпись не должна сидеть на заголовках колонок: снизу воздуха больше,
     иначе две строки шапки читаются как одна слипшаяся. */
  padding: 8px 14px 11px !important;
}
.ip-tbl--grid thead tr + tr th {
  background: rgba(4, 120, 87, 0.035);
  padding-top: 9px;
}
/* Колонки ступеней — по центру: поле в клетке стоит по центру, и заголовок,
   прижатый влево, с ним не совпадал. */
.ip-tbl--grid .ip-tbl-mid { text-align: center; padding-left: 12px; padding-right: 12px; }
/* Край таблицы: у обычной таблицы последняя колонка прижата к краю намеренно
   (там числа по правому краю), здесь это выглядело как обрезка. */
.ip-tbl--grid th:last-child, .ip-tbl--grid td:last-child { padding-right: 12px; }
.ip-tbl--grid .ip-tbl-corner { padding-right: 14px; }

/* Схема «взнос → наценка»: ступени против кривой. */
.ip-viz {
  margin-top: 12px; padding: 10px 12px 11px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
/* Во всю ширину блока: чем длиннее ось взноса, тем заметнее разница между
   скачком и наклоном — ради неё схема и нарисована. */
.ip-viz-svg { display: block; width: 100%; height: auto; }
.ip-viz-axis { stroke: rgba(var(--v-theme-on-surface), 0.18); stroke-width: 1; }
.ip-viz-edge {
  stroke: rgba(var(--v-theme-on-surface), 0.16); stroke-width: 1; stroke-dasharray: 3 3;
}
.ip-viz-line { stroke: #047857; stroke-width: 2.5; stroke-linecap: round; fill: none; }
/* Скачок на границе — пунктиром: это не путь клиента, а разрыв условий. */
.ip-viz-jump {
  stroke: #047857; stroke-width: 1.5; stroke-dasharray: 2 3; opacity: 0.75;
}
.ip-viz-dot { fill: #047857; }
/* Промежуточная точка — тише опорной: она не задана партнёром, а посчитана. */
.ip-viz-mid-line {
  stroke: rgba(4, 120, 87, 0.45); stroke-width: 1; stroke-dasharray: 2 3;
}
.ip-viz-mid-dot { fill: #fff; stroke: #047857; stroke-width: 1.5; }
/* Тёмная тема: фирменный тёмно-зелёный на тёмном фоне почти не виден, а
   промежуточные подписи и так самые мелкие на схеме. */
.v-theme--dark .ip-viz-mid-val { fill: rgba(52, 211, 153, 0.95); }
.v-theme--dark .ip-viz-mid-line { stroke: rgba(52, 211, 153, 0.5); }
.v-theme--dark .ip-viz-mid-dot { fill: #1e1e1e; stroke: #34d399; }
.v-theme--dark .ip-viz-line { stroke: #34d399; }
.v-theme--dark .ip-viz-jump { stroke: #34d399; }
.v-theme--dark .ip-viz-dot { fill: #34d399; }
.v-theme--dark .ip-tbl--grid .ip-tbl-group { color: #34d399 !important; }
/* Единица viewBox равна пикселю, поэтому размеры подписей здесь настоящие и
   одинаково читаются при любой ширине блока. */
.ip-viz-mid-val {
  font-size: 9.5px; font-weight: 600; text-anchor: middle; fill: rgba(4, 120, 87, 0.85);
}
.ip-viz-ax--soft { fill: rgba(var(--v-theme-on-surface), 0.32); }
.ip-viz-val {
  font-size: 11.5px; font-weight: 700; text-anchor: middle;
  fill: rgba(var(--v-theme-on-surface), 0.75);
}
.ip-viz-ax { font-size: 10px; fill: rgba(var(--v-theme-on-surface), 0.42); }
.ip-viz-ax--mid { text-anchor: middle; }
.ip-viz-ax--end { text-anchor: end; }
.ip-viz-note {
  margin-top: 6px; font-size: 11.5px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ip-viz-legend {
  margin-top: 3px; font-size: 10.5px; color: rgba(var(--v-theme-on-surface), 0.4);
}
/* Поле с суффиксом: процент не «уплывает» от цифры, ширина одинаковая у всех. */
.ip-cell-wrap { position: relative; display: inline-flex; align-items: center; }
.ip-cell-wrap--wide { width: 108px; }
.ip-cell {
  width: 108px; height: 38px; padding: 0 28px 0 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-variant-numeric: tabular-nums;
}
.ip-cell:focus { border-color: rgba(4, 120, 87, 0.5); }
.ip-cell::-webkit-outer-spin-button,
.ip-cell::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.ip-cell-cur {
  position: absolute; right: 11px; font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.4); pointer-events: none;
}

/* Два правила тарифа под настройками расчёта: каждое — своей строкой. */
.ip-toggles { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }

/* ── Первый взнос ── */
.ip-down { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.ip-down-label { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.7); }
.ip-down-note { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.45); }

/* ── Подробный режим ── */
.ip-raw-head, .ip-raw-row {
  display: grid; grid-template-columns: 1.2fr 1.2fr 0.8fr 0.8fr 0.8fr 32px;
  gap: 6px; align-items: center;
}
.ip-raw-head {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.4); margin: 10px 0 4px;
}
.ip-raw-row { margin-bottom: 6px; }

.ip-note {
  font-size: 12.5px; line-height: 1.5; padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ip-note--warn {
  display: flex; align-items: flex-start; gap: 8px;
  background: rgba(245, 158, 11, 0.09); color: #b45309;
  border: 1px solid rgba(245, 158, 11, 0.25);
  margin-bottom: 10px;
}

/* ── Проверка на живом товаре ── */
.ip-block--sample { background: rgba(4, 120, 87, 0.04); border-color: rgba(4, 120, 87, 0.18); }
.ip-sample-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.7); margin-bottom: 12px;
}
.ip-suffix-wrap--sample { width: 150px; }
/* Процент взноса в проверке: поле короче суммы. */
.ip-suffix-wrap--pct { width: 92px; }
.ip-text--sample { height: 36px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ip-sample { display: flex; flex-direction: column; }
.ip-sample-row {
  display: grid; grid-template-columns: 1.1fr 1fr 1fr 1fr 1fr; gap: 10px;
  padding: 9px 4px; font-size: 13px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  font-variant-numeric: tabular-nums;
}
.ip-sample-row:last-child { border-bottom: none; }
.ip-sample-row--head {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.ip-sample-over { color: #047857; font-weight: 600; }
.ip-sample-last {
  display: block; font-size: 11.5px; font-weight: 500; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ip-sample-note {
  display: flex; align-items: flex-start; gap: 7px; margin-top: 10px;
  font-size: 12px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
@media (max-width: 700px) {
  .ip-sample-row { grid-template-columns: 1fr 1fr; row-gap: 2px; }
  .ip-sample-row--head { display: none; }
}

.ip-problems { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
.ip-problem {
  display: flex; align-items: flex-start; gap: 7px;
  font-size: 12.5px; line-height: 1.45; padding: 9px 11px; border-radius: 10px;
  background: rgba(220, 38, 38, 0.07); color: #b91c1c;
}
</style>
