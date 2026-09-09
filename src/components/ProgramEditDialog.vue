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
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { formatCurrency, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import {
  findRuleProblems,
  ROUNDING_STEP,
  scheduleShape,
  totalFor,
  type MarkupBase,
  type ProgramRounding,
  type ProgramRule,
} from '@/utils/programMath'
import {
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

/** Сроки, которые предлагаются сразу: остальные добавляются вручную. */
const TERM_PRESETS = [3, 6, 9, 12, 18, 24]

const saving = ref(false)
const isNew = computed(() => !props.program)

const draft = ref({
  name: '',
  description: '',
  isDefault: false,
  markupBase: 'OF_COST' as MarkupBase,
  paymentInterval: 'MONTHLY' as 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY',
  rounding: 'NONE' as ProgramRounding,
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
 * Можно ли оформить без первого взноса.
 *
 * Отдельный переключатель, а не «поставьте 0»: партнёр решает это как правило
 * продажи — «без взноса не отдаём» — и должен видеть ответ сразу, не вчитываясь
 * в проценты. Выключено — рядом появляется минимальный процент.
 */
const noDownPayment = ref(true)
watch(noDownPayment, (allowed) => {
  if (allowed) grid.value.minDownPaymentPercent = 0
  else if (!grid.value.minDownPaymentPercent) grid.value.minDownPaymentPercent = 10
})

/** Ступени по стоимости — необязательная часть: чаще условия от цены не зависят. */
const byAmount = ref(false)
watch(byAmount, (on) => {
  if (!on) {
    grid.value.steps = []
    for (const t of grid.value.terms) grid.value.markup[t] = [grid.value.markup[t]?.[0] ?? 20]
  } else if (!grid.value.steps.length) {
    addStep(100000)
  }
})

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
      minAmount: p?.minAmount ?? null,
      maxAmount: p?.maxAmount ?? null,
      strict: p?.strict ?? false,
    }
    const asGrid = p ? rulesToGrid(p.rules) : null
    if (!p) {
      grid.value = emptyGrid()
      byAmount.value = false
      noDownPayment.value = true
      advanced.value = false
      rawRules.value = []
    } else if (asGrid) {
      grid.value = asGrid
      byAmount.value = asGrid.steps.length > 0
      noDownPayment.value = !asGrid.minDownPaymentPercent
      advanced.value = false
      rawRules.value = []
    } else {
      grid.value = emptyGrid()
      byAmount.value = false
      noDownPayment.value = true
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
    const base = donor ? [...(grid.value.markup[donor] ?? [])] : []
    grid.value.markup[term] = Array.from({ length: stepCount(grid.value.steps) }, (_, i2) => base[i2] ?? 20)
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
    const row = grid.value.markup[t] ?? []
    grid.value.markup[t] = Array.from({ length: stepCount(grid.value.steps) }, (_, i) => row[i] ?? row[row.length - 1] ?? 20)
  }
}

function removeStep(i: number) {
  grid.value.steps.splice(i, 1)
  for (const t of grid.value.terms) {
    const row = grid.value.markup[t] ?? []
    row.splice(i, 1)
    grid.value.markup[t] = Array.from({ length: stepCount(grid.value.steps) }, (_, k) => row[k] ?? 20)
  }
}

function setStep(i: number, value: number | null) {
  if (value == null) return
  grid.value.steps.splice(i, 1, Math.round(value))
}

function cellValue(term: number, i: number): number | null {
  return grid.value.markup[term]?.[i] ?? null
}
function setCell(term: number, i: number, value: number | null) {
  const row = grid.value.markup[term] ?? []
  while (row.length < stepCount(grid.value.steps)) row.push(20)
  row[i] = value == null || !Number.isFinite(value) ? 0 : value
  grid.value.markup[term] = row
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
  })
}
function removeRawRule(i: number) {
  rawRules.value.splice(i, 1)
}

/** Что уедет на сервер: полосы из сетки либо строки подробного режима. */
const effectiveRules = computed<ProgramRule[]>(() =>
  advanced.value ? rawRules.value : gridToRules(grid.value),
)

const problems = computed(() => findRuleProblems(effectiveRules.value, draft.value.markupBase))
const canSave = computed(() => draft.value.name.trim().length > 0 && problems.value.length === 0)

// ── Живой пример ──
// Абстрактные проценты ничего не говорят: партнёр проверяет программу на
// знакомом товаре — «телефон за 60 000, сколько выйдет».
const sample = ref(100000)

const sampleRows = computed(() => {
  const price = sample.value || 0
  return effectiveRules.value
    .filter((r) => {
      const from = r.amountFrom ?? 0
      if (price < from) return false
      return r.amountTo == null || price < r.amountTo
    })
    .sort((a, b) => a.termPayments - b.termPayments)
    .map((r) => {
      const total = totalFor(price, r.markupPercent, draft.value.markupBase)
      const down = Math.round((total * (r.minDownPaymentPercent ?? 0)) / 100)
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
            <div class="ip-step-num">1</div>
            <div class="ip-step-body">
              <div class="ip-step-title">Сроки рассрочки</div>
              <div class="ip-step-hint">Сколько платежей бывает по этому тарифу</div>
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
            <!-- 2. Стоимость товара -->
            <div class="ip-step-block">
              <div class="ip-step-num">2</div>
              <div class="ip-step-body">
                <div class="ip-step-title">Зависит ли наценка от стоимости товара</div>
                <label class="ip-toggle">
                  <input v-model="byAmount" type="checkbox" />
                  <span class="ip-toggle-track"><span class="ip-toggle-thumb" /></span>
                  <span class="ip-toggle-text">
                    {{ byAmount ? 'Да, разная по ступеням стоимости' : 'Нет, одинаковая для любого товара' }}
                    <span class="ip-toggle-hint">например, на дорогой товар наценка ниже</span>
                  </span>
                </label>

                <!-- Ступени задаются границами: соседние примыкают друг к
                     другу, и дыр между ними не бывает. -->
                <div v-if="byAmount" class="ip-steps">
                  <div class="ip-steps-row">
                    <span class="ip-steps-edge">Границы</span>
                    <span v-for="(st, i) in grid.steps" :key="i" class="ip-step-chip">
                      <input
                        :value="st"
                        v-maska="CURRENCY_MASK"
                        class="ip-step-input"
                        @maska="(e: any) => setStep(i, parseMasked(e))"
                      />
                      <span class="ip-step-cur">₽</span>
                      <button class="ip-step-del" title="Убрать границу" @click="removeStep(i)">
                        <v-icon icon="mdi-close" size="13" />
                      </button>
                    </span>
                    <button class="ip-step-add" @click="addStep()">
                      <v-icon icon="mdi-plus" size="14" />
                      Граница
                    </button>
                  </div>
                  <div class="ip-steps-hint">
                    Товар ровно на границе идёт в верхнюю ступень: за 100 000 ₽ — уже «от 100 000».
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. Наценка -->
            <div class="ip-step-block">
              <div class="ip-step-num">3</div>
              <div class="ip-step-body">
                <div class="ip-step-title">Наценка</div>
                <div class="ip-step-hint">
                  {{ byAmount ? 'Свой процент для каждого срока и ступени стоимости' : 'Свой процент для каждого срока' }}
                </div>

                <div v-if="grid.terms.length" class="ip-grid-wrap">
                  <table class="ip-grid">
                    <thead>
                      <tr>
                        <th class="ip-grid-corner">Срок</th>
                        <th v-for="(label, i) in stepLabels(grid.steps)" :key="i">{{ label }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="t in grid.terms" :key="t">
                        <th class="ip-grid-term">{{ t }} платежей</th>
                        <td v-for="i in stepCount(grid.steps)" :key="i">
                          <span class="ip-cell-wrap">
                            <input
                              :value="cellValue(t, i - 1)"
                              type="number"
                              min="0"
                              step="0.5"
                              class="ip-cell"
                              @input="setCell(t, i - 1, Number(($event.target as HTMLInputElement).value))"
                            />
                            <span class="ip-cell-cur">%</span>
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-else class="ip-note">Выберите хотя бы один срок — иначе тарифу нечего предлагать</div>
              </div>
            </div>

            <!-- 4. Первый взнос -->
            <div class="ip-step-block ip-step-block--last">
              <div class="ip-step-num">4</div>
              <div class="ip-step-body">
                <div class="ip-step-title">Первый взнос</div>
                <label class="ip-toggle">
                  <input v-model="noDownPayment" type="checkbox" />
                  <span class="ip-toggle-track"><span class="ip-toggle-thumb" /></span>
                  <span class="ip-toggle-text">
                    {{ noDownPayment ? 'Можно оформить без первого взноса' : 'Первый взнос обязателен' }}
                    <span class="ip-toggle-hint">
                      {{
                        noDownPayment
                          ? 'клиент может забрать товар, не заплатив ничего в день сделки'
                          : 'без взноса продавец не сможет оформить договор по этому тарифу'
                      }}
                    </span>
                  </span>
                </label>

                <div v-if="!noDownPayment" class="ip-down">
                  <span class="ip-down-label">Не меньше</span>
                  <span class="ip-cell-wrap ip-cell-wrap--wide">
                    <input
                      v-model.number="grid.minDownPaymentPercent"
                      type="number"
                      min="1"
                      max="99"
                      class="ip-cell"
                    />
                    <span class="ip-cell-cur">%</span>
                  </span>
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
              <input v-model.number="r.markupPercent" type="number" min="0" step="0.5" class="ip-cell" />
              <input v-model.number="r.minDownPaymentPercent" type="number" min="0" max="99" class="ip-cell" />
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
                <option value="TO_100">до 100 ₽</option>
                <option value="TO_500">до 500 ₽</option>
                <option value="TO_1000">до 1000 ₽</option>
              </select>
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
              <span>{{ r.term }} платежей</span>
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
  display: flex; gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.ip-step-block:first-of-type { padding-top: 4px; }
.ip-step-block--last { border-bottom: none; padding-bottom: 4px; }
.ip-step-num {
  width: 24px; height: 24px; border-radius: 8px; flex: none; margin-top: 1px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.1); color: #047857;
  font-size: 12px; font-weight: 800;
}
.ip-step-body { flex: 1; min-width: 0; }
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
.ip-steps { margin-top: 12px; }
.ip-steps-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ip-steps-edge {
  font-size: 12px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.45);
}
.ip-step-chip { position: relative; display: inline-flex; align-items: center; }
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
  height: 36px; padding: 0 12px; border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.22);
  background: transparent; cursor: pointer;
  font-size: 12.5px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.55);
}
.ip-step-add:hover { border-color: rgba(4, 120, 87, 0.45); color: #047857; }
.ip-steps-hint { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.42); margin-top: 8px; }

/* ── Сетка наценок ── */
.ip-grid-wrap { overflow-x: auto; margin-top: 10px; }
.ip-grid { border-collapse: separate; border-spacing: 0 4px; }
.ip-grid th {
  font-size: 11.5px; font-weight: 700; padding: 0 8px 4px; text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap;
}
.ip-grid-corner { text-align: left !important; }
.ip-grid-term {
  text-align: left !important; font-size: 13px !important; font-weight: 600 !important;
  color: rgba(var(--v-theme-on-surface), 0.75) !important;
  white-space: nowrap; padding: 0 14px 0 0 !important;
}
.ip-grid td { padding: 0 4px 0 0; }
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
