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
import { formatCurrency } from '@/utils/formatters'
import ProgramEditDialog from '@/components/ProgramEditDialog.vue'
import type { MarkupBase, ProgramRounding, ProgramRule } from '@/utils/programMath'
import { rulesToGrid, stepLabels } from '@/utils/programGrid'

interface Program {
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

/** Раскладка условий тарифа для карточки. `null` — условия нестандартные. */
function cardGrid(p: Program) {
  return rulesToGrid(p.rules)
}

/** Минимальный первый взнос тарифа: 0 — можно без взноса. */
function downPaymentOf(p: Program): number {
  return Math.max(0, ...p.rules.map((r) => r.minDownPaymentPercent ?? 0))
}

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

        <!-- Условия: сроки и наценки сеткой. Таблица со строками «от … до …»
             читалась как выгрузка из базы; здесь видно главное — на сколько
             платежей и под какой процент. -->
        <div class="ip-card-terms">
          <template v-if="cardGrid(p)">
            <div v-if="cardGrid(p)!.steps.length" class="ip-card-steps">
              <span class="ip-card-steps-label">Стоимость товара</span>
              <span v-for="(label, i) in stepLabels(cardGrid(p)!.steps)" :key="i" class="ip-card-step">
                {{ label }}
              </span>
            </div>
            <div v-for="t in cardGrid(p)!.terms" :key="t" class="ip-card-term">
              <span class="ip-card-term-name">{{ t }} платежей</span>
              <span
                v-for="(pct, i) in cardGrid(p)!.markup[t]"
                :key="i"
                class="ip-card-pct"
              >
                {{ pct }}%
              </span>
            </div>
          </template>

          <!-- Нестандартные условия показываем построчно: выпрямлять их нельзя. -->
          <template v-else>
            <div v-for="(r, i) in p.rules" :key="r.id ?? i" class="ip-card-term">
              <span class="ip-card-term-name">
                <template v-if="r.amountFrom == null && r.amountTo == null">любая стоимость</template>
                <template v-else-if="r.amountFrom == null">до {{ formatCurrency(r.amountTo!) }}</template>
                <template v-else-if="r.amountTo == null">от {{ formatCurrency(r.amountFrom) }}</template>
                <template v-else>{{ formatCurrency(r.amountFrom) }} — {{ formatCurrency(r.amountTo) }}</template>
                · {{ r.termPayments }} платежей
              </span>
              <span class="ip-card-pct">{{ r.markupPercent }}%</span>
            </div>
          </template>
        </div>

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
          <span v-if="p.rounding !== 'NONE'" class="ip-card-fact">
            <v-icon icon="mdi-decimal-decrease" size="14" />
            Платёж округляется {{ ROUNDING_LABEL[p.rounding] }}
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

.ip-card-foot { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
.ip-card-fact {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; color: rgba(255, 255, 255, 0.72);
}
.ip-card-fact--deals { color: rgba(255, 255, 255, 0.55); }

@media (max-width: 560px) {
  .ip-list { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 700px) {
  .ip-card-steps, .ip-card-term { grid-template-columns: 1fr; gap: 2px; }
  .ip-card-step, .ip-card-pct { text-align: left; }
  .ip-card-steps { display: none; }
}
</style>
