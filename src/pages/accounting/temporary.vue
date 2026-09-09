<script setup lang="ts">
/**
 * Бухгалтерия → Временные операции.
 *
 * Все движения денег, кроме обычной работы со счетами. Партнёр взял из кассы
 * на свои нужды, положил своё, чтобы закрыть нехватку, дал знакомому в долг,
 * оплатил бензин, выдал сотруднику под отчёт, получил перевод от неизвестного
 * отправителя. Каждая операция мелкая, но за месяц их набегает несколько
 * десятков, и в общей ленте бухгалтерии они тонут.
 *
 * На «Балансе» остаётся только работа со счетами: внести, снять, перевести.
 *
 * Раздел отвечает на два разных вопроса, и цифры в нём поэтому двух родов:
 *
 * - «что ещё не закрыто» — на сегодня, независимо от периода: невозвращённые
 *   долги и операции без назначения. Долг, взятый весной, не исчезает оттого,
 *   что смотрят август;
 * - «что было за период» — итог месяца, ради которого раздел и заведён.
 *
 * «Должны мы» и «должны нам» не складываются в одну сумму: это разные деньги,
 * и общий итог из них ничего не значит.
 */
import { computed, onMounted, ref } from 'vue'
import AccountingTabs from '@/components/AccountingTabs.vue'
import DateField from '@/components/DateField.vue'
import OperationDialog from '@/components/OperationDialog.vue'
import AccountOperationItems from '@/components/AccountOperationItems.vue'
import { useAccountingStore, type TemporarySummary, type LiabilityView } from '@/stores/accounting'
import { useAuthStore } from '@/stores/auth'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { rangeForPreset, customLabel } from '@/composables/useReports'
import type { PeriodPreset, PeriodRange } from '@/types/reports'
import { TEMPORARY_KINDS, type OperationKind } from '@/constants/operationKinds'
import { CURRENCY_MASK, parseMasked, formatCurrency, formatDate, formatDateShort } from '@/utils/formatters'

const store = useAccountingStore()
const auth = useAuthStore()
const toast = useToast()
const { isDark } = useIsDark()

const canManage = computed(() => auth.can('finance.capital'))

// ── Период: тот же механизм, что в «Отчётах», чтобы выбор периода в разделе
// вёл себя одинаково везде. ──
const PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: 'month', label: 'Этот месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'half', label: 'Полугодие' },
  { key: 'year', label: 'Год' },
  { key: 'all', label: 'За всё время' },
]
const period = ref<PeriodRange>(rangeForPreset('month'))
const customOpen = ref(false)
const thisMonth = rangeForPreset('month')
const customFrom = ref(thisMonth.from)
const customTo = ref(thisMonth.to)

const periodItems = computed(() => {
  const list = PRESETS.map((p) => ({ title: p.label, value: p.key as string }))
  if (period.value.preset === 'custom') list.push({ title: period.value.label, value: 'custom' })
  return list
})

function pickPreset(p: PeriodPreset) {
  if (p === 'custom') return
  period.value = rangeForPreset(p)
  void load()
}

function applyCustom() {
  if (!customFrom.value || !customTo.value) return
  const [f, t] =
    customFrom.value <= customTo.value
      ? [customFrom.value, customTo.value]
      : [customTo.value, customFrom.value]
  period.value = { from: f, to: t, preset: 'custom', label: customLabel(f, t) }
  customOpen.value = false
  void load()
}

const data = ref<TemporarySummary | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    data.value = await store.fetchTemporary(period.value.from, period.value.to)
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить временные операции')
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ── Итог за период ──
const net = computed(() => data.value?.period.net ?? 0)

/**
 * Из чего сложился итог: виды операций, по которым за период было движение.
 * Пустые не показываем — восемь нулей подряд это шум, а не информация.
 */
const inGroups = computed(() =>
  (data.value?.period.groups ?? []).filter((g) => g.flow === 'in' && g.count > 0),
)
const outGroups = computed(() =>
  (data.value?.period.groups ?? []).filter((g) => g.flow === 'out' && g.count > 0),
)

const activePeople = computed(() =>
  (data.value?.people ?? []).filter((p) => p.status === 'ACTIVE' && p.left > 0),
)

/** Сколько уже вернули по расчёту — полосой, чтобы не считать в уме. */
function repaidPct(l: LiabilityView): number {
  if (!l.principal) return 0
  return Math.min(100, Math.round((l.repaid / l.principal) * 100))
}

function daysOverdue(l: LiabilityView): number {
  if (!l.dueDate) return 0
  const diff = Date.now() - new Date(l.dueDate).getTime()
  return Math.max(0, Math.floor(diff / 86_400_000))
}

const pendingOps = computed(() => data.value?.pending ?? [])

// ── История: фильтр по виду движения ──
const HISTORY_FILTERS = [
  { key: 'all', title: 'Все' },
  { key: 'in', title: 'Пришло' },
  { key: 'out', title: 'Ушло' },
]
const historyFilter = ref('all')

const history = computed(() => {
  const rows = data.value?.history ?? []
  if (historyFilter.value === 'all') return rows
  return rows.filter((h) => h.flow === historyFilter.value)
})

// ── Возврат ──
const repayTarget = ref<LiabilityView | null>(null)
const repayAmount = ref<number | null>(null)
const repaying = ref(false)

function openRepay(l: LiabilityView) {
  repayTarget.value = l
  repayAmount.value = l.left
}

/** Вернуть больше, чем брали, нельзя: излишек — это уже другая операция. */
const tooMuch = computed(
  () => !!repayTarget.value && (repayAmount.value ?? 0) > repayTarget.value.left,
)

async function confirmRepay() {
  if (!repayTarget.value || !repayAmount.value || tooMuch.value) return
  repaying.value = true
  try {
    await store.repayLiability(repayTarget.value.id, { amount: repayAmount.value })
    toast.success('Возврат записан')
    repayTarget.value = null
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось записать возврат')
  } finally {
    repaying.value = false
  }
}

// ── Новая операция ──
// Все виды раздела: долги в обе стороны, прочий доход, расход по бизнесу и
// операции без назначения. Работа со счетами (внести, снять, перевести)
// осталась на «Балансе».
const showOperation = ref(false)
const operationKind = ref<OperationKind>('BORROW')
function newOperation(kind: OperationKind) {
  operationKind.value = kind
  showOperation.value = true
}
</script>

<template>
  <div class="tp-page" :class="{ dark: isDark }">
    <AccountingTabs />

    <div class="tp-head">
      <div>
        <div class="tp-title">Временные операции</div>
        <div class="tp-hint">
          Всё, кроме обычной работы со счетами: взяли из кассы на свои нужды, положили своё,
          дали или взяли в долг, оплатили бензин, выдали под отчёт. За месяц их набегает
          много — здесь они сведены в один итог.
        </div>
      </div>

      <div class="tp-head-ctl">
        <v-select
          :model-value="period.preset"
          :items="periodItems"
          density="compact"
          variant="outlined"
          hide-details
          class="tp-vselect"
          @update:model-value="pickPreset"
        />
        <v-menu v-model="customOpen" :close-on-content-click="false" location="bottom end">
          <template #activator="{ props: menuProps }">
            <button
              v-bind="menuProps"
              class="tp-btn"
              :class="{ 'tp-btn--active': period.preset === 'custom' }"
              type="button"
            >
              <v-icon icon="mdi-calendar-range" size="16" />
              Свой период
            </button>
          </template>
          <v-card min-width="280" class="pa-4">
            <div class="text-caption text-medium-emphasis mb-2">С какой даты</div>
            <DateField v-model="customFrom" :max="customTo || undefined" />
            <div class="text-caption text-medium-emphasis mt-3 mb-2">По какую</div>
            <DateField v-model="customTo" :min="customFrom || undefined" />
            <v-btn color="primary" block class="mt-4" @click="applyCustom">Показать</v-btn>
          </v-card>
        </v-menu>
        <v-menu v-if="canManage" location="bottom end" offset="6">
          <template #activator="{ props: menuProps }">
            <button class="tp-btn tp-btn--main" v-bind="menuProps">
              <v-icon icon="mdi-plus" size="16" />
              Новая операция
              <v-icon icon="mdi-chevron-down" size="15" />
            </button>
          </template>
          <v-card rounded="lg" elevation="6" class="tp-opmenu">
            <AccountOperationItems :kinds="TEMPORARY_KINDS" @pick="newOperation" />
          </v-card>
        </v-menu>
      </div>
    </div>

    <div v-if="loading && !data" class="tp-loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Незакрытый остаток. Стоит выше периода намеренно: это ответ на
           вопрос «сколько денег сейчас в воздухе», и от дат он не зависит. -->
      <div class="tp-open">
        <div class="tp-open-cell">
          <div class="tp-open-label">Должны мы</div>
          <div class="tp-open-sum">{{ formatCurrency(data?.open.weOwe ?? 0) }}</div>
          <div class="tp-open-note">
            {{ data?.open.weOweCount || 0 }} незакрытых · лежат на счетах, но чужие
          </div>
        </div>
        <div class="tp-open-cell">
          <div class="tp-open-label">Должны нам</div>
          <div class="tp-open-sum">{{ formatCurrency(data?.open.owedToUs ?? 0) }}</div>
          <div class="tp-open-note">
            {{ data?.open.owedToUsCount || 0 }} незакрытых · вне кассы, ждём возврата
          </div>
        </div>
        <div class="tp-open-cell tp-open-cell--period">
          <div class="tp-open-label">{{ period.label }}</div>
          <!-- Ноль не красим: зелёный «+0 ₽» выглядит как достижение,
               хотя за период просто ничего не было. -->
          <div class="tp-open-sum" :class="net > 0 ? 'tp-in' : net < 0 ? 'tp-out' : ''">
            {{ net >= 0 ? '+' : '−' }}{{ formatCurrency(Math.abs(net)) }}
          </div>
          <div class="tp-open-note">
            изменение денег на счетах ·
            {{ data?.period.count || 0 }} {{ (data?.period.count || 0) === 1 ? 'операция' : 'операций' }}
          </div>
        </div>
      </div>

      <div v-if="data?.open.overdueCount" class="tp-alert">
        <v-icon icon="mdi-alert-circle-outline" size="18" />
        <span>
          Просрочено расчётов: {{ data.open.overdueCount }} — срок возврата прошёл,
          а деньги не вернулись.
        </span>
      </div>

      <!-- Неразобранные: деньги двигались, а куда отнести — ещё не решили.
           Пока список не пуст, часть денег в отчётах не отнесена ни к чему. -->
      <div v-if="data?.open.pendingCount" class="tp-alert tp-alert--info">
        <v-icon icon="mdi-help-circle-outline" size="18" />
        <span>
          Ждут разбора: {{ data.open.pendingCount }} на {{ formatCurrency(data.open.pendingAmount) }} —
          назначьте им место, иначе эти деньги не попадут ни в один отчёт.
        </span>
      </div>

      <!-- Из чего сложился итог: две стороны, пополнение и снятие. Восемь
           отдельных плиток занимали два ряда и не читались как две стороны
           одного итога. -->
      <div v-if="data?.period.count" class="tp-flow">
        <div class="tp-flow-col">
          <div class="tp-flow-head">
            <span class="tp-card-ico tp-bg-in"><v-icon icon="mdi-arrow-down-left" size="14" /></span>
            <span class="tp-flow-title">Пришло</span>
            <span class="tp-flow-sum tp-in">+{{ formatCurrency(data.period.inAmount) }}</span>
          </div>
          <div v-for="g in inGroups" :key="g.key" class="tp-flow-row">
            <span class="tp-flow-name">{{ g.title }}</span>
            <span class="tp-flow-count">{{ g.count }}×</span>
            <span class="tp-flow-amount">{{ formatCurrency(g.amount) }}</span>
          </div>
        </div>

        <div class="tp-flow-col">
          <div class="tp-flow-head">
            <span class="tp-card-ico tp-bg-out"><v-icon icon="mdi-arrow-up-right" size="14" /></span>
            <span class="tp-flow-title">Ушло</span>
            <span class="tp-flow-sum tp-out">−{{ formatCurrency(data.period.outAmount) }}</span>
          </div>
          <div v-for="g in outGroups" :key="g.key" class="tp-flow-row">
            <span class="tp-flow-name">{{ g.title }}</span>
            <span class="tp-flow-count">{{ g.count }}×</span>
            <span class="tp-flow-amount">{{ formatCurrency(g.amount) }}</span>
          </div>
        </div>
      </div>

      <!-- Незакрытые расчёты -->
      <div class="tp-block">
        <div class="tp-block-head">
          <div class="tp-block-title">Незакрытые расчёты</div>
          <span v-if="activePeople.length" class="tp-block-count">{{ activePeople.length }}</span>
          <div class="tp-block-note">не зависят от выбранного периода</div>
        </div>

        <div v-if="!activePeople.length" class="tp-empty">
          <v-icon icon="mdi-check-circle-outline" size="26" />
          <div class="tp-empty-title">Всё возвращено</div>
          <div class="tp-empty-text">
            Незакрытых расчётов нет: никто не должен вам, и вы никому.
          </div>
        </div>

        <div v-else class="tp-people">
          <div
            v-for="l in activePeople"
            :key="l.id"
            class="tp-person"
            :class="{ 'tp-person--overdue': l.overdue }"
          >
            <span class="tp-card-ico" :class="l.direction === 'BORROWED' ? 'tp-bg-in' : 'tp-bg-out'">
              <v-icon :icon="l.direction === 'BORROWED' ? 'mdi-arrow-down-left' : 'mdi-arrow-up-right'" size="15" />
            </span>

            <div class="tp-person-body">
              <div class="tp-person-name">
                {{ l.personName }}
                <span v-if="l.overdue" class="tp-badge">просрочено {{ daysOverdue(l) }} дн.</span>
              </div>
              <div class="tp-person-sub">
                {{ l.direction === 'BORROWED' ? 'внесли' : 'выдали' }} {{ formatCurrency(l.principal) }}
                <template v-if="l.dueDate"> · до {{ formatDate(l.dueDate) }}</template>
                <template v-if="l.note"> · {{ l.note }}</template>
              </div>
              <!-- Полоса возврата: «вернули 100 000 из 300 000» читается взглядом,
                   а не вычитанием в уме. -->
              <div class="tp-progress" :title="`Вернули ${formatCurrency(l.repaid)} из ${formatCurrency(l.principal)}`">
                <div class="tp-progress-fill" :style="{ width: repaidPct(l) + '%' }" />
              </div>
            </div>

            <div class="tp-person-num">
              <div class="tp-person-left">{{ formatCurrency(l.left) }}</div>
              <div class="tp-person-left-label">осталось</div>
            </div>

            <button v-if="canManage" class="tp-btn tp-btn--sm" @click="openRepay(l)">
              {{ l.direction === 'BORROWED' ? 'Вернуть' : 'Принять' }}
            </button>
          </div>
        </div>
      </div>

      <!-- История движений за период -->
      <div class="tp-block">
        <div class="tp-block-head">
          <div class="tp-block-title">История операций</div>
          <span v-if="history.length" class="tp-block-count">{{ history.length }}</span>
          <div class="tp-filters">
            <button
              v-for="f in HISTORY_FILTERS"
              :key="f.key"
              class="tp-filter"
              :class="{ 'tp-filter--on': historyFilter === f.key }"
              @click="historyFilter = f.key"
            >{{ f.title }}</button>
          </div>
        </div>

        <div v-if="!history.length" class="tp-empty">
          <v-icon icon="mdi-timeline-text-outline" size="26" />
          <div class="tp-empty-title">Движений нет</div>
          <div class="tp-empty-text">
            За {{ period.label.toLowerCase() }} временных операций не было.
            Смените период или внесите первую операцию.
          </div>
        </div>

        <div v-else class="tp-table">
          <div class="tp-tr tp-tr--head">
            <div>Дата</div>
            <div>Операция</div>
            <div>С кем</div>
            <div class="tp-td--right">Сумма</div>
          </div>
          <div v-for="h in history" :key="h.id" class="tp-tr">
            <div class="tp-td-date" :title="formatDate(h.date)">{{ formatDateShort(h.date) }}</div>
            <div class="tp-td-op">
              <span class="tp-card-ico" :class="h.flow === 'in' ? 'tp-bg-in' : 'tp-bg-out'">
                <v-icon :icon="h.flow === 'in' ? 'mdi-arrow-down-left' : 'mdi-arrow-up-right'" size="14" />
              </span>
              <span>{{ h.title }}</span>
            </div>
            <div class="tp-td-who">
              {{ h.who || '—' }}<span v-if="h.note" class="tp-td-note"> · {{ h.note }}</span>
              <span v-if="h.openItem" class="tp-badge tp-badge--wait">ждёт разбора</span>
            </div>
            <div class="tp-td--right tp-num" :class="h.flow === 'in' ? 'tp-in' : 'tp-out'">
              {{ h.flow === 'in' ? '+' : '−' }}{{ formatCurrency(h.amount) }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Возврат -->
    <v-dialog :model-value="!!repayTarget" max-width="420" @update:model-value="repayTarget = null">
      <v-card rounded="lg" class="pa-5">
        <div class="tp-dlg-title">
          {{ repayTarget?.direction === 'BORROWED' ? 'Вернуть деньги' : 'Принять возврат' }}
        </div>
        <div class="tp-dlg-sub">
          {{ repayTarget?.personName }} · осталось {{ formatCurrency(repayTarget?.left ?? 0) }}
        </div>
        <v-text-field
          v-model="repayAmount"
          v-maska:[CURRENCY_MASK]
          label="Сумма"
          variant="outlined"
          density="comfortable"
          rounded="lg"
          class="mt-4"
          :error="tooMuch"
          :error-messages="tooMuch ? 'Больше остатка вернуть нельзя' : ''"
          @update:model-value="repayAmount = parseMasked($event)"
        />
        <div class="d-flex justify-end ga-2 mt-2">
          <button class="tp-btn" @click="repayTarget = null">Отмена</button>
          <button
            class="tp-btn tp-btn--main"
            :disabled="repaying || tooMuch || !repayAmount"
            @click="confirmRepay"
          >
            Записать
          </button>
        </div>
      </v-card>
    </v-dialog>

    <OperationDialog v-model="showOperation" :kind="operationKind" @done="load" />
  </div>
</template>

<style scoped>
/* Раздел говорит тем же языком, что «Отчёты» и «Аудит»: те же отступы
   страницы, тот же размер заголовка, тот же выбор периода. */
.tp-page { padding: 24px 28px 40px; }
.tp-loading { display: flex; justify-content: center; align-items: center; min-height: 260px; }

.tp-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; margin-bottom: 18px;
}
.tp-title { font-size: 20px; font-weight: 700; }
.tp-hint {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 3px; max-width: 620px; line-height: 1.5;
}
.tp-head-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tp-vselect { min-width: 168px; }
.tp-vselect :deep(.v-field) {
  border-radius: 9px; font-size: 13px; font-weight: 600;
  background: rgb(var(--v-theme-surface));
}
.tp-vselect :deep(.v-field__input) { min-height: 40px; padding-top: 0; padding-bottom: 0; }

.tp-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 14px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.tp-btn:hover:not(:disabled) { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.tp-btn:disabled { opacity: 0.6; cursor: default; }
.tp-btn--active { background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.32); color: #10b981; }
.tp-btn--main { background: #047857; border-color: #047857; color: #fff; }
.tp-btn--main:hover:not(:disabled) { background: #036b4e; border-color: #036b4e; color: #fff; }
.tp-btn--sm { height: 34px; padding: 0 12px; font-size: 12.5px; }

/* Три ответа в одной строке: сколько должны мы, сколько должны нам и что
   произошло за период. Разделены линиями, а не сложены в сумму, — это
   принципиально разные деньги. */
.tp-open {
  display: grid; grid-template-columns: repeat(3, 1fr);
  border-radius: 14px; margin-bottom: 14px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.tp-open-cell { padding: 16px 18px; border-left: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
.tp-open-cell:first-child { border-left: none; }
.tp-open-cell--period { background: rgba(var(--v-theme-on-surface), 0.022); }
.tp-open-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.tp-open-sum {
  font-size: 25px; font-weight: 700; letter-spacing: -0.5px; margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.tp-open-note { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.48); margin-top: 4px; }

.tp-alert {
  display: flex; align-items: center; gap: 9px;
  padding: 12px 15px; border-radius: 12px; margin-bottom: 14px;
  font-size: 13px; font-weight: 600;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #b45309;
}
.tp-alert--info {
  background: rgba(var(--v-theme-on-surface), 0.035);
  border-color: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.tp-flow {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px;
}
.tp-flow-col {
  padding: 14px 16px 10px; border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.tp-flow-head {
  display: flex; align-items: center; gap: 8px;
  padding-bottom: 10px; margin-bottom: 6px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.tp-flow-title { font-size: 13px; font-weight: 700; }
.tp-flow-sum {
  margin-left: auto; font-size: 17px; font-weight: 700;
  font-variant-numeric: tabular-nums; letter-spacing: -0.3px;
}
.tp-flow-row {
  display: flex; align-items: baseline; gap: 8px;
  padding: 6px 0; font-size: 13px;
}
.tp-flow-name {
  flex: 1; min-width: 0; color: rgba(var(--v-theme-on-surface), 0.7);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tp-flow-count {
  font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.4);
  font-variant-numeric: tabular-nums;
}
.tp-flow-amount { font-weight: 600; font-variant-numeric: tabular-nums; }

.tp-card-ico {
  width: 24px; height: 24px; border-radius: 7px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
}
.tp-bg-in { background: rgba(4, 120, 87, 0.12); color: #047857; }
.tp-bg-out { background: rgba(180, 83, 9, 0.12); color: #b45309; }

.tp-block {
  border-radius: 14px; margin-bottom: 18px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
}
.tp-block-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 14px 18px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.tp-block-title { font-size: 15px; font-weight: 700; }
.tp-block-count {
  font-size: 11.5px; font-weight: 700; padding: 1px 7px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.tp-block-note { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4); }

.tp-filters { display: flex; gap: 6px; margin-left: auto; }
.tp-filter {
  padding: 5px 11px; border-radius: 8px; font-size: 12.5px; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.55);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.tp-filter:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.tp-filter--on { background: rgba(4, 120, 87, 0.12); color: #047857; font-weight: 600; }

.tp-people { padding: 6px 8px 8px; }
.tp-person {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 10px; border-radius: 10px;
}
.tp-person:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.tp-person--overdue { background: rgba(245, 158, 11, 0.06); }
.tp-person-body { flex: 1; min-width: 0; }
.tp-person-name { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.tp-badge {
  padding: 1px 7px; border-radius: 6px; font-size: 10.5px; font-weight: 700;
  background: rgba(245, 158, 11, 0.16); color: #b45309;
}
.tp-badge--wait { background: rgba(var(--v-theme-on-surface), 0.07); color: rgba(var(--v-theme-on-surface), 0.5); }
.tp-person-sub {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tp-progress {
  height: 3px; border-radius: 2px; margin-top: 7px; max-width: 320px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.tp-progress-fill { height: 100%; border-radius: 2px; background: #047857; opacity: 0.7; }
.tp-person-num { text-align: right; }
.tp-person-left { font-size: 14.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tp-person-left-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45); }

.tp-table { width: 100%; }
.tp-tr {
  display: grid; grid-template-columns: 92px minmax(150px, 1fr) minmax(160px, 1.4fr) 130px;
  align-items: center; gap: 12px;
  padding: 11px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.tp-tr:first-child { border-top: none; }
.tp-tr--head {
  padding: 10px 18px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.tp-tr:not(.tp-tr--head):hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.tp-td-date {
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5);
  font-variant-numeric: tabular-nums;
}
.tp-td-op { display: flex; align-items: center; gap: 9px; font-size: 13.5px; font-weight: 600; }
.tp-td-who {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tp-td-note { color: rgba(var(--v-theme-on-surface), 0.4); }
.tp-td--right { text-align: right; }
.tp-num { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tp-in { color: #047857; }
.tp-out { color: #b45309; }

.tp-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 44px 24px; text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.tp-empty-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.8); }
.tp-empty-text { font-size: 13px; max-width: 380px; line-height: 1.5; }

.tp-opmenu { padding: 6px; min-width: 290px; }

.tp-dlg-title { font-size: 17px; font-weight: 700; }
.tp-dlg-sub { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 2px; }

@media (max-width: 900px) {
  .tp-open { grid-template-columns: 1fr; }
  .tp-flow { grid-template-columns: 1fr; }
  .tp-open-cell { border-left: none; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07); }
  .tp-open-cell:first-child { border-top: none; }
}
@media (max-width: 760px) {
  .tp-page { padding: 16px 12px 40px; }
  /* Таблица истории на телефоне становится карточками: четыре колонки в
     360 px не помещаются, а горизонтальная прокрутка в ленте раздражает. */
  .tp-tr { grid-template-columns: 1fr auto; row-gap: 4px; padding: 12px 14px; }
  .tp-tr--head { display: none; }
  .tp-td-date { grid-column: 1; order: 1; }
  .tp-td--right { grid-column: 2; grid-row: 1 / span 2; order: 2; align-self: center; }
  .tp-td-op { grid-column: 1; order: 3; }
  .tp-td-who { grid-column: 1 / -1; order: 4; }
  .tp-person { flex-wrap: wrap; }
  .tp-person-num { margin-left: auto; }
}

.dark .tp-in { color: #34d399; }
.dark .tp-out { color: #fbbf24; }
.dark .tp-bg-in { background: rgba(52, 211, 153, 0.14); color: #34d399; }
.dark .tp-bg-out { background: rgba(251, 191, 36, 0.14); color: #fbbf24; }
.dark .tp-alert { background: rgba(251, 191, 36, 0.1); border-color: rgba(251, 191, 36, 0.32); color: #fbbf24; }
.dark .tp-badge { background: rgba(251, 191, 36, 0.16); color: #fbbf24; }
.dark .tp-filter--on { background: rgba(52, 211, 153, 0.16); color: #34d399; }
.dark .tp-btn--main { background: #059669; border-color: #059669; }
.dark .tp-progress-fill { background: #34d399; }
</style>
