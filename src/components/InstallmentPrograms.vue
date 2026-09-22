<script setup lang="ts">
/**
 * Тарифы рассрочки — справочник условий, из которых продавец выбирает при
 * оформлении договора.
 *
 * Живёт прямо в настройках, во вкладке «Тарифы»: отдельная страница ради
 * одного справочника только уводила из настроек и обратно.
 *
 * Условия задаются сеткой «срок × стоимость товара», а не списком полос с
 * границами. Раньше партнёр вбивал строку за строкой — «от 100 000 до 300 000,
 * 6 платежей, 20%» — и сам следил, чтобы полосы не пересекались и не оставляли
 * дыр. Теперь он называет сроки, при необходимости добавляет ступени по
 * стоимости, и заполняет проценты в клетках; границы считаются сами.
 *
 * Правки тарифа не касаются заключённых договоров: у каждого сохранён снимок
 * условий на день подписания. Об этом сказано прямо в форме — иначе партнёр
 * боится трогать тариф, по которому уже идут продажи.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { formatCurrency, pluralizeRu } from '@/utils/formatters'
import ProgramEditDialog from '@/components/ProgramEditDialog.vue'
import ProgramCalculator from '@/components/ProgramCalculator.vue'
import CardDisclosure from '@/components/CardDisclosure.vue'
import type {
  MarkupBase,
  ProgramDownMode,
  ProgramRounding,
  ProgramRoundingTarget,
  ProgramRule,
} from '@/utils/programMath'

interface Program {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  markupBase: MarkupBase
  paymentInterval: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'
  rounding: ProgramRounding
  downMode?: ProgramDownMode
  roundingTarget?: ProgramRoundingTarget
  minMarkupAmount?: number | null
  defaultDownPaymentPercent?: number | null
  minAmount: number | null
  maxAmount: number | null
  strict: boolean
  rules: ProgramRule[]
  dealsCount: number
}

const auth = useAuthStore()
const toast = useToast()

const canEdit = computed(() => auth.can('deals.programs'))

const loading = ref(false)
const saving = ref(false)
const items = ref<Program[]>([])

/**
 * Чей это тариф — в заголовке карточки.
 *
 * Партнёр показывает условия клиенту и печатает их в документах: «Тариф
 * „Стандарт“ от компании „Мизан“» читается как предложение, а просто
 * «Стандарт» — как строка в справочнике. Компании нет — берём фамилию с
 * инициалом, как подписываются в договорах.
 */
const sellerName = computed(() => {
  const u = auth.user as any
  const company = (u?.companyName ?? '').trim()
  if (company) return { label: `от компании «${company}»`, plain: company }
  const last = (u?.lastName ?? '').trim()
  const initial = (u?.firstName ?? '').trim().slice(0, 1)
  const person = [last, initial ? `${initial}.` : ''].filter(Boolean).join(' ')
  return person ? { label: `от ${person}`, plain: person } : { label: '', plain: '' }
})

const INTERVAL_LABEL: Record<string, string> = {
  WEEKLY: 'раз в неделю',
  BIWEEKLY: 'раз в две недели',
  MONTHLY: 'раз в месяц',
}
const ROUNDING_LABEL: Record<ProgramRounding, string> = {
  NONE: 'без округления',
  TO_50: 'до 50 ₽',
  TO_100: 'до 100 ₽',
  TO_500: 'до 500 ₽',
  TO_1000: 'до 1000 ₽',
}
/** Сроки, которые предлагаются сразу: остальные добавляются вручную. */
const TERM_PRESETS = [3, 6, 9, 12, 18, 24]

async function load() {
  loading.value = true
  try {
    items.value = await api.get<Program[]>('/installment-programs')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить тарифы')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ── Окно тарифа ──
// Сам редактор живёт отдельным компонентом: он же открывается из визарда
// сделки, где партнёр правит применённый тариф, не уходя со страницы.
const dialog = ref(false)
const editing = ref<Program | null>(null)

function openNew() {
  editing.value = null
  dialog.value = true
}

function openEdit(p: Program) {
  editing.value = p
  dialog.value = true
}

/**
 * Удаление тарифа.
 *
 * Заключённым договорам это не вредит: применённые условия лежат в самом
 * договоре снимком, поэтому история «по каким условиям продали» остаётся.
 * Но подтверждение спрашиваем: тариф с продажами удаляют не каждый день.
 */
async function remove(p: Program) {
  const warn = p.dealsCount
    ? `Удалить тариф «${p.name}»?\n\nПо нему заключено договоров: ${p.dealsCount}. ` +
      'Их условия сохранены в самих договорах и не изменятся — тариф просто перестанет предлагаться при оформлении.'
    : `Удалить тариф «${p.name}»?`
  if (!confirm(warn)) return
  try {
    await api.delete(`/installment-programs/${p.id}`)
    toast.success('Тариф удалён')
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось удалить тариф')
  }
}

/**
 * Условия тарифа строками — как они и заданы: одно правило = одна строка.
 *
 * Прежняя сетка «срок × ступени» показывала проценты без подписей, к чему они
 * относятся, и на тарифе с двумя осями читалась как выгрузка. В таблице у
 * каждого числа есть свой столбец, а лишние столбцы просто не выводятся.
 */
interface RuleRow {
  term: number
  amount: string
  down: string
  minDown: number
  markup: number
}

function amountLabel(r: ProgramRule): string {
  if (r.amountFrom == null && r.amountTo == null) return 'любая'
  if (r.amountFrom == null) return `до ${formatCurrency(r.amountTo!)}`
  if (r.amountTo == null) return `от ${formatCurrency(r.amountFrom)}`
  return `${formatCurrency(r.amountFrom)} — ${formatCurrency(r.amountTo)}`
}

function downLabel(r: ProgramRule): string {
  if (r.downFromPercent == null && r.downToPercent == null) return 'любой'
  if (r.downFromPercent == null) return `до ${r.downToPercent}%`
  if (r.downToPercent == null) return `от ${r.downFromPercent}%`
  return `${r.downFromPercent}—${r.downToPercent}%`
}

function ruleRows(p: Program): RuleRow[] {
  return [...p.rules]
    .sort(
      (a, b) =>
        a.termPayments - b.termPayments ||
        (a.amountFrom ?? 0) - (b.amountFrom ?? 0) ||
        (a.downFromPercent ?? 0) - (b.downFromPercent ?? 0),
    )
    .map((r) => ({
      term: r.termPayments,
      amount: amountLabel(r),
      down: downLabel(r),
      minDown: r.minDownPaymentPercent ?? 0,
      markup: r.markupPercent,
    }))
}

/** Столбец показываем, только если тариф по этой оси вообще различается. */
function hasAmountAxis(p: Program): boolean {
  return p.rules.some((r) => r.amountFrom != null || r.amountTo != null)
}
function hasDownAxis(p: Program): boolean {
  return p.rules.some((r) => r.downFromPercent != null || r.downToPercent != null)
}
function hasMinDownAxis(p: Program): boolean {
  return p.rules.some((r) => (r.minDownPaymentPercent ?? 0) > 0)
}

/**
 * Условия одного срока идут вместе одной группой.
 *
 * На тарифе со ступенями взноса срок повторялся в каждой строке — «6 платежей»
 * подряд четыре раза, — и таблица читалась как список несвязанных условий.
 * Теперь срок указан один раз на всю группу.
 */
interface RuleGroup {
  term: number
  rows: RuleRow[]
}

const groupsByProgram = computed(() => {
  const map: Record<string, RuleGroup[]> = {}
  for (const p of items.value) {
    const byTerm = new Map<number, RuleRow[]>()
    for (const row of ruleRows(p)) {
      const list = byTerm.get(row.term) ?? []
      list.push(row)
      byTerm.set(row.term, list)
    }
    map[p.id] = [...byTerm.entries()].map(([term, rows]) => ({ term, rows }))
  }
  return map
})

/** Минимальный первый взнос тарифа: 0 — можно без взноса. */
function downPaymentOf(p: Program): number {
  return Math.max(0, ...p.rules.map((r) => r.minDownPaymentPercent ?? 0))
}

/** Сколько условий у тарифа — видно на кнопке, не раскрывая блок. */
const rulesCount = computed(() => {
  const map: Record<string, number> = {}
  for (const p of items.value) map[p.id] = p.rules.length
  return map
})

</script>

<template>
  <div class="ip">
    <div class="ip-head">
      <div class="ip-head-text">
        <div class="ip-title">Тарифы рассрочки</div>
        <div class="ip-sub">
          Готовые условия: срок, наценка и первый взнос. Продавец выбирает тариф
          при оформлении — цена и график считаются сами. Правки касаются только новых
          договоров: у заключённых сохранён снимок условий на день подписания.
        </div>
      </div>
      <div class="ip-head-actions">
        <button v-if="canEdit" class="ip-add" @click="openNew">
          <v-icon icon="mdi-plus" size="16" />
          Новый тариф
        </button>
      </div>
    </div>

    <div v-if="loading" class="d-flex justify-center pa-10">
      <v-progress-circular indeterminate color="#047857" size="30" />
    </div>

    <div v-else-if="!items.length" class="ip-empty">
      <v-icon icon="mdi-percent-outline" size="30" />
      <div class="ip-empty-title">Тарифов пока нет</div>
      <div class="ip-empty-text">
        Заведите первый — и продавцу останется только выбрать его при оформлении,
        а наценку и график посчитает система.
      </div>
      <button v-if="canEdit" class="ip-add mt-3" @click="openNew">
        <v-icon icon="mdi-plus" size="16" />
        Новый тариф
      </button>
    </div>

    <div v-else class="ip-list">
      <div
        v-for="p in items"
        :key="p.id"
        class="ip-card"
      >
        <div class="ip-card-head">
          <div class="min-w-0">
            <!-- Заголовок звучит как предложение клиенту, а не как строка
                 справочника: «Тариф „Стандарт“ от компании „Мизан“». -->
            <div class="ip-card-title">Тариф «{{ p.name }}»</div>
            <div v-if="sellerName.label" class="ip-card-seller">{{ sellerName.label }}</div>
            <div class="ip-card-tags">
              <span v-if="p.isDefault" class="ip-badge ip-badge--default">по умолчанию</span>
              <span v-if="p.strict" class="ip-badge ip-badge--strict">строгий</span>
            </div>
            <div v-if="p.description" class="ip-card-desc">{{ p.description }}</div>
          </div>

          <div v-if="canEdit" class="ip-card-actions">
            <button class="ip-card-btn" @click="openEdit(p)">
              <v-icon icon="mdi-pencil-outline" size="14" />
              Изменить
            </button>
            <button class="ip-card-btn ip-card-btn--danger" title="Удалить тариф" @click="remove(p)">
              <v-icon icon="mdi-delete-outline" size="15" />
            </button>
          </div>
        </div>

        <!-- Проверка тарифа на живых суммах: цена, взнос и срок — и сразу
             видно, что получит клиент. Раньше здесь стояла таблица процентов,
             но она не отвечала на главный вопрос партнёра. -->
        <ProgramCalculator
          :program="p"
          :title="`Тариф «${p.name}»`"
          :seller="sellerName.label"
        />


        <!-- Условия целиком: одно правило — одна строка, у каждого числа свой
             столбец с подписью. Оси, по которым тариф не различается, не
             выводим: столбец «Стоимость товара» из одного значения «любая»
             только занимал бы место. -->
        <CardDisclosure
          title="Все условия тарифа"
          icon="mdi-format-list-bulleted"
          :note="`${(rulesCount[p.id] ?? 0)} ${pluralizeRu(rulesCount[p.id] ?? 0, 'условие', 'условия', 'условий')}`"
        >
          <div class="ip-rules">
          <table class="ip-rules-table">
            <thead>
              <tr>
                <th>Срок</th>
                <th v-if="hasAmountAxis(p)">Стоимость товара</th>
                <th v-if="hasDownAxis(p)">Первый взнос</th>
                <th v-if="hasMinDownAxis(p)" class="ip-rules-num">Минимум взноса</th>
                <th class="ip-rules-num">Наценка</th>
              </tr>
            </thead>
            <!-- Группа = срок. Отдельный tbody держит строки вместе и рисует
                 черту между сроками. -->
            <tbody v-for="g in groupsByProgram[p.id] ?? []" :key="g.term">
              <tr v-for="(row, i) in g.rows" :key="i">
                <td v-if="i === 0" :rowspan="g.rows.length" class="ip-rules-term">
                  {{ g.term }} {{ pluralizeRu(g.term, 'платёж', 'платежа', 'платежей') }}
                </td>
                <td v-if="hasAmountAxis(p)">{{ row.amount }}</td>
                <td v-if="hasDownAxis(p)">{{ row.down }}</td>
                <td v-if="hasMinDownAxis(p)" class="ip-rules-num">{{ row.minDown }}%</td>
                <td class="ip-rules-num ip-rules-markup">{{ row.markup }}%</td>
              </tr>
            </tbody>
          </table>

          <!-- Правила границ словами: по самой таблице не видно, куда попадёт
               товар ровно на границе и от чего считается доля взноса. -->
          <div class="ip-rules-notes">
            <p>
              Наценка — {{ p.markupBase === 'OF_COST' ? 'от закупочной цены' : 'от цены продажи' }},
              платежи {{ INTERVAL_LABEL[p.paymentInterval] }}<template
                v-if="p.rounding !== 'NONE'"
              >, платёж округляется {{ ROUNDING_LABEL[p.rounding] }}<template
                v-if="p.roundingTarget === 'TOTAL'"
              > с уходом остатка в цену договора</template></template>.
            </p>
            <p v-if="hasAmountAxis(p)">
              Товар ровно на границе идёт в верхнюю ступень: за 100 000 ₽ — уже «от 100 000».
            </p>
            <p v-if="hasDownAxis(p)">
              Доля взноса считается от цены договора; взнос ровно на границе идёт в
              верхнюю ступень.<template v-if="p.downMode === 'CURVE'">
              Между границами наценка меняется плавно, а не скачком.</template>
            </p>
            <p v-if="p.minMarkupAmount">
              Наценка не бывает меньше {{ formatCurrency(p.minMarkupAmount) }} — на дешёвом
              товаре берётся эта сумма, а не процент.
            </p>
            </div>
          </div>
        </CardDisclosure>

        <div class="ip-card-foot">
          <span class="ip-card-fact">
            <v-icon icon="mdi-cash-multiple" size="14" />
            Наценка {{ p.markupBase === 'OF_COST' ? 'от закупки' : 'от цены продажи' }}
          </span>
          <span class="ip-card-fact">
            <v-icon icon="mdi-calendar-sync-outline" size="14" />
            Платежи {{ INTERVAL_LABEL[p.paymentInterval] }}
          </span>
          <span class="ip-card-fact">
            <v-icon :icon="downPaymentOf(p) ? 'mdi-wallet-outline' : 'mdi-wallet-plus-outline'" size="14" />
            {{ downPaymentOf(p) ? `Первый взнос от ${downPaymentOf(p)}%` : 'Можно без первого взноса' }}
          </span>
          <span v-if="p.downMode === 'CURVE'" class="ip-card-fact">
            <v-icon icon="mdi-chart-bell-curve-cumulative" size="14" />
            Наценка меняется плавно по взносу
          </span>
          <span v-if="p.minMarkupAmount" class="ip-card-fact">
            <v-icon icon="mdi-shield-check-outline" size="14" />
            Наценка не меньше {{ formatCurrency(p.minMarkupAmount) }}
          </span>
          <span v-if="p.defaultDownPaymentPercent" class="ip-card-fact">
            <v-icon icon="mdi-wallet-plus-outline" size="14" />
            Взнос по умолчанию {{ p.defaultDownPaymentPercent }}%
          </span>
          <span v-if="p.rounding !== 'NONE'" class="ip-card-fact">
            <v-icon icon="mdi-decimal-decrease" size="14" />
            Платёж округляется {{ ROUNDING_LABEL[p.rounding] }}<template
              v-if="p.roundingTarget === 'TOTAL'"
            >, остаток уходит в цену</template>
          </span>
          <span v-if="p.dealsCount" class="ip-card-fact ip-card-fact--deals">
            <v-icon icon="mdi-file-document-outline" size="14" />
            {{ p.dealsCount }} договоров
          </span>
        </div>
      </div>
    </div>

    <!-- Окно тарифа — общий компонент: то же окно открывается из визарда. -->
    <ProgramEditDialog
      v-model="dialog"
      :program="editing"
      :existing-count="items.length"
      @saved="load"
    />
  </div>
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
  /* Каждая карточка по своему содержимому: иначе соседняя с раскрытыми
     условиями растягивала бы весь ряд. */
  align-items: start;
  gap: 14px;
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

/* Условия таблицей: у каждого числа свой столбец с подписью. Подложку и
   отступы даёт сам сворачиваемый блок, поэтому здесь их нет. */
.ip-rules { min-width: 0; }
/* Колонки фиксированной ширины: срок и наценка короткие, всё остальное место
   достаётся средней колонке — иначе браузер растягивал «СРОК» на полтаблицы. */
.ip-rules-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ip-rules-table th {
  padding: 0 12px 8px; text-align: left; white-space: nowrap;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);
}
/* Заголовок числовой колонки тоже вправо: иначе он висел над значениями со
   сдвигом, и было неясно, к какой колонке относится. */
.ip-rules-table th.ip-rules-num { text-align: right; }
.ip-rules-table td {
  padding: 9px 12px; font-size: 13px; color: rgba(255, 255, 255, 0.82);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  vertical-align: middle;
}
/* Подложка колонки срока начинается от края таблицы, поэтому у первой колонки
   свой отступ — иначе текст лип бы к границе подложки. */
.ip-rules-table th:first-child, .ip-rules-table td:first-child { padding-left: 12px; width: 130px; }
.ip-rules-table th:last-child, .ip-rules-table td:last-child { padding-right: 0; width: 86px; }
/* Границу между сроками держит последняя строка группы: раньше к ней
   добавлялась ещё и верхняя граница следующей — линия выходила двойной. */
.ip-rules-table tbody:not(:last-child) > tr:last-child > td {
  border-bottom-color: rgba(255, 255, 255, 0.2);
}
.ip-rules-table tbody:last-child > tr:last-child > td { border-bottom: none; }
/* Селектор с элементом: правило `.ip-rules-table td` иначе перебивает класс.
   Группу держит не вертикальная линия, а лёгкая подложка: при схлопнутых
   границах линия рвалась на каждом стыке строк и выглядела неопрятно. */
.ip-rules-table td.ip-rules-term {
  font-weight: 600; color: #fff; white-space: nowrap; vertical-align: middle;
  background: rgba(255, 255, 255, 0.05);
  padding-left: 12px;
}
.ip-rules-num { text-align: right; font-variant-numeric: tabular-nums; }
.ip-rules-markup { font-size: 14px; font-weight: 700; color: #fff; }

.ip-rules-notes { display: flex; flex-direction: column; gap: 5px; margin-top: 11px; }
.ip-rules-notes p {
  margin: 0; font-size: 11.5px; line-height: 1.5; color: rgba(255, 255, 255, 0.55);
}

/* Справка о тарифе — ровная сетка в две колонки: вразнобой по ширине строки
   выглядели как обрывки, а не как список свойств. */
.ip-card-foot {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 14px;
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}
.ip-card-fact {
  display: flex; align-items: flex-start; gap: 6px; min-width: 0;
  font-size: 12px; line-height: 1.35; color: rgba(255, 255, 255, 0.72);
}
.ip-card-fact--deals { color: rgba(255, 255, 255, 0.55); }

@media (max-width: 560px) {
  .ip-list { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 700px) {
  .ip-rules { padding: 10px; }
  .ip-rules-table th, .ip-rules-table td { padding-right: 8px; font-size: 12px; }
}
</style>
