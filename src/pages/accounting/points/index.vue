<script setup lang="ts">
/**
 * Пункты приёма глазами партнёра.
 *
 * Баланс отвечает на вопрос «сколько у меня денег», этот экран — на другой:
 * где сейчас чужие наличные, давно ли забирали и не пора ли ехать. Поэтому
 * здесь нет сводки «где деньги» — она целиком повторяла бы «Баланс»; вместо
 * неё показатели про сами пункты: сколько точек, за сколькими ехать, сколько
 * через них прошло.
 *
 * Ниже — инкассация: рейсы по этим же пунктам. Отдельного раздела у неё нет.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountingStore } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { formatCurrency } from '@/utils/formatters'
import AccountingTabs from '@/components/AccountingTabs.vue'
import CollectionRunsSection from '@/components/accounting/CollectionRunsSection.vue'
import { useAuthStore } from '@/stores/auth'
import { useSections } from '@/composables/useSections'
import type { PointRow } from '@/stores/accounting'

const store = useAccountingStore()
const auth = useAuthStore()
const sections = useSections()
const toast = useToast()
const router = useRouter()
const { isDark } = useIsDark()

const loading = ref(false)
const points = ref<PointRow[]>([])

/**
 * Инкассация показывается здесь же, ниже пунктов: отдельного раздела у неё
 * больше нет. Право своё — сотрудник-инкассатор видит рейсы, даже если
 * остальная бухгалтерия ему закрыта.
 */
const canSeeCollections = computed(() => auth.can('collections.view'))
// Владелец мог скрыть пункты приёма в настройках — тогда раздела нет и по
// прямой ссылке, иначе скрытие обходилось бы адресной строкой.
const canSeePoints = computed(() => auth.can('accounting.view') && sections.visible('paymentPoints'))

// Инкассатору бухгалтерия закрыта: без этой проверки он получал бы 403 на
// пунктах, хотя пришёл сюда только за своим рейсом.
onMounted(() => { if (canSeePoints.value) void load() })

async function load() {
  loading.value = true
  try {
    const list = await store.fetchPoints()
    points.value = list.points
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить пункты')
  } finally {
    loading.value = false
  }
}

// ── Показатели: только про пункты, без пересказа «Баланса» ──
const totalInPoints = computed(() => points.value.reduce((s, p) => s + p.balance, 0))
const dueCount = computed(() => points.value.filter((p) => p.pickupDue && !p.inRunNumber).length)
const inRunCount = computed(() => points.value.filter((p) => p.inRunNumber).length)
const income30d = computed(() => points.value.reduce((s, p) => s + p.income30d, 0))
const payments30d = computed(() => points.value.reduce((s, p) => s + p.payments30d, 0))

// ── Поиск, фильтр, сортировка ──
const search = ref('')
const onlyDue = ref(false)

type SortKey = 'name' | 'balance' | 'pickup' | 'income30d'
const sortKey = ref<SortKey>('pickup')
const sortDir = ref<'asc' | 'desc'>('desc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else {
    sortKey.value = key
    sortDir.value = key === 'name' ? 'asc' : 'desc'
  }
}

/** Насколько срочно ехать: за этим пунктом (2) → он в рейсе (1) → спокойно (0). */
function urgency(p: PointRow): number {
  if (p.pickupDue && !p.inRunNumber) return 2
  if (p.inRunNumber) return 1
  return 0
}

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = points.value
  if (q) {
    list = list.filter((p) =>
      [p.name, p.address, p.contactName, p.operators.join(' ')]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }
  if (onlyDue.value) list = list.filter((p) => p.pickupDue && !p.inRunNumber)

  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    switch (sortKey.value) {
      case 'name':
        return a.name.localeCompare(b.name, 'ru') * dir
      case 'balance':
        return (a.balance - b.balance) * dir
      case 'income30d':
        return (a.income30d - b.income30d) * dir
      default: {
        // «Пора забрать» сначала, внутри группы — по остатку: за большими
        // деньгами едут раньше.
        const u = urgency(a) - urgency(b)
        return u !== 0 ? u * dir : (a.balance - b.balance) * dir
      }
    }
  })
})

function pickupLabel(p: PointRow): string {
  if (p.inRunNumber) return `В рейсе №${p.inRunNumber}`
  if (p.pickupDue) return p.pickupReason === 'amount' ? 'Накопилась сумма' : 'Давно не забирали'
  if (p.daysSincePickup == null) return 'Ещё не забирали'
  if (p.daysSincePickup === 0) return 'Забрали сегодня'
  return `Забрали ${p.daysSincePickup} дн. назад`
}

function pickupIcon(p: PointRow): string {
  if (p.inRunNumber) return 'mdi-truck-fast-outline'
  if (p.pickupDue) return 'mdi-alert-circle-outline'
  return 'mdi-check-circle-outline'
}

/** «12 платежей», «2 платежа», «1 платёж» — иначе получается «платеж(ей)». */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = n % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/** Карточка пункта — общая для всех счетов: у пункта не должно быть двух. */
function openPoint(p: PointRow) {
  router.push(`/accounting/accounts/${p.id}`)
}
</script>

<template>
  <div class="pp-page" :class="{ dark: isDark }">
    <AccountingTabs />

    <template v-if="canSeePoints">
      <!-- Показатели раздела — канон stats-row/stat-card, как в «Сделках».
           Сводки «где деньги» здесь нет: она дословно повторяла «Баланс». -->
      <div class="stats-row mb-6">
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
            <v-icon icon="mdi-storefront-outline" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ points.length }}</div>
            <div class="stat-label">Пунктов приёма</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
            <v-icon icon="mdi-cash-multiple" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ formatCurrency(totalInPoints) }}</div>
            <div class="stat-label">Сейчас лежит в пунктах</div>
          </div>
        </div>
        <div class="stat-card">
          <div
            class="stat-icon"
            :style="dueCount
              ? 'background: rgba(239, 68, 68, 0.1); color: #ef4444;'
              : 'background: rgba(16, 185, 129, 0.1); color: #10b981;'"
          >
            <v-icon :icon="dueCount ? 'mdi-alert-circle-outline' : 'mdi-check-circle-outline'" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ dueCount }}</div>
            <div class="stat-label">
              Пора забрать<template v-if="inRunCount"> · в рейсе {{ inRunCount }}</template>
            </div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
            <v-icon icon="mdi-chart-timeline-variant" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ formatCurrency(income30d) }}</div>
            <div class="stat-label">
              Принято за 30 дней · {{ payments30d }}
              {{ plural(payments30d, 'платёж', 'платежа', 'платежей') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Панель инструментов: слева фильтр, справа поиск — как в «Сделках». -->
      <div class="d-flex justify-space-between align-center ga-2 mb-3 flex-wrap">
        <div class="d-flex align-center ga-2 flex-wrap">
          <button class="fb-btn" :class="{ 'fb-btn--active': onlyDue }" @click="onlyDue = !onlyDue">
            <v-icon icon="mdi-alert-outline" size="16" />
            <span>Только те, за кем ехать</span>
            <span v-if="dueCount" class="fb-btn-count">{{ dueCount }}</span>
          </button>
        </div>
        <div class="d-flex align-center ga-2 flex-grow-1 justify-end">
          <div class="filter-input-wrap" style="max-width: 520px; min-width: 300px; flex: 1 1 300px;">
            <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
            <input
              v-model="search"
              type="text"
              placeholder="Поиск по названию, адресу или оператору"
              class="filter-input"
            />
          </div>
        </div>
      </div>

      <v-card rounded="lg" elevation="0" border class="pp-card">
        <div class="pa-4">
          <div v-if="loading && !points.length" class="d-flex justify-center pa-12">
            <v-progress-circular indeterminate color="primary" size="32" />
          </div>

          <div v-else-if="!points.length" class="text-center pa-12">
            <v-icon icon="mdi-storefront-outline" size="56" color="grey-lighten-1" class="mb-3" />
            <div class="text-h6 mb-1">Пунктов приёма пока нет</div>
            <div class="text-body-2 text-medium-emphasis">
              Заведите счёт типа «Пункт приёма» на вкладке «Баланс» — это магазин,
              который принимает платежи от ваших клиентов
            </div>
          </div>

          <div v-else-if="!rows.length" class="text-center pa-12">
            <v-icon icon="mdi-magnify" size="56" color="grey-lighten-1" class="mb-3" />
            <div class="text-h6 mb-1">Ничего не найдено</div>
            <div class="text-body-2 text-medium-emphasis">Попробуйте изменить запрос или фильтр</div>
          </div>

          <v-table v-else density="default" hover class="pp-table">
            <thead>
              <tr>
                <th class="th-sortable" :class="{ 'th-sorted': sortKey === 'name' }" @click="toggleSort('name')">
                  <span class="th-inner">
                    Пункт
                    <v-icon
                      :icon="sortKey === 'name' ? (sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down') : 'mdi-unfold-more-horizontal'"
                      size="14"
                      class="th-sort-ico"
                    />
                  </span>
                </th>
                <th class="th-sortable" :class="{ 'th-sorted': sortKey === 'pickup' }" @click="toggleSort('pickup')">
                  <span class="th-inner">
                    Инкассация
                    <v-icon
                      :icon="sortKey === 'pickup' ? (sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down') : 'mdi-unfold-more-horizontal'"
                      size="14"
                      class="th-sort-ico"
                    />
                  </span>
                </th>
                <th>Оператор</th>
                <th
                  class="text-end th-sortable"
                  :class="{ 'th-sorted': sortKey === 'income30d' }"
                  @click="toggleSort('income30d')"
                >
                  <span class="th-inner">
                    За 30 дней
                    <v-icon
                      :icon="sortKey === 'income30d' ? (sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down') : 'mdi-unfold-more-horizontal'"
                      size="14"
                      class="th-sort-ico"
                    />
                  </span>
                </th>
                <th
                  class="text-end th-sortable"
                  :class="{ 'th-sorted': sortKey === 'balance' }"
                  @click="toggleSort('balance')"
                >
                  <span class="th-inner">
                    Сейчас в пункте
                    <v-icon
                      :icon="sortKey === 'balance' ? (sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down') : 'mdi-unfold-more-horizontal'"
                      size="14"
                      class="th-sort-ico"
                    />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in rows"
                :key="p.id"
                class="cursor-pointer"
                :class="{ 'pp-row--off': p.disabled }"
                @click="openPoint(p)"
              >
                <td>
                  <div class="pp-name">
                    <span class="pp-dot" :style="{ background: p.color }" />
                    {{ p.name }}
                    <span v-if="p.disabled" class="pp-off-badge">отключён</span>
                  </div>
                  <div v-if="p.address" class="pp-sub">{{ p.address }}</div>
                </td>
                <td>
                  <span
                    class="pp-pickup"
                    :class="{
                      'pp-pickup--due': p.pickupDue && !p.inRunNumber,
                      'pp-pickup--run': !!p.inRunNumber,
                    }"
                  >
                    <v-icon :icon="pickupIcon(p)" size="14" />
                    {{ pickupLabel(p) }}
                  </span>
                </td>
                <td>
                  <span v-if="p.operators.length" class="pp-ops">{{ p.operators.join(', ') }}</span>
                  <span v-else class="pp-sub">не назначен</span>
                </td>
                <td class="text-end">
                  {{ formatCurrency(p.income30d) }}
                  <div class="pp-sub">
                    {{ p.payments30d }} {{ plural(p.payments30d, 'платёж', 'платежа', 'платежей') }}
                  </div>
                </td>
                <td class="text-end pp-balance">{{ formatCurrency(p.balance) }}</td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card>
    </template>

    <!-- Инкассация: продолжение той же истории — из этих пунктов забирают
         наличные. Отдельного раздела у неё больше нет. -->
    <div v-if="canSeeCollections" class="pp-collections">
      <CollectionRunsSection />
    </div>
  </div>
</template>

<style scoped>
/* Поля страницы — как у «Баланса», «Истории» и «Отчётов»: раздел один,
   и вкладки не должны отличаться шириной содержимого. */
.pp-page { padding: 24px 28px 40px; }

/* ── KPI-плитки: канонический блок разделов (см. pages/deals/index.vue) ── */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .stats-row { grid-template-columns: repeat(2, 1fr); gap: 8px; } }

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.stat-icon {
  width: 40px; height: 40px; min-width: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.stat-value {
  font-size: 18px; font-weight: 700; line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.stat-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* ── Кнопки-фильтры и поиск: канон со страницы «Сделки» ── */
.fb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: #fff;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.12s;
}
.fb-btn:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.2);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.fb-btn--active {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-weight: 600;
}
.fb-btn-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.filter-input-wrap { position: relative; flex: 1; }
.filter-input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #9ca3af; pointer-events: none;
}
.filter-input {
  width: 100%; height: 40px; padding: 0 16px 0 38px;
  border: 1px solid #e4e4e7; border-radius: 10px;
  background: #fff; font-size: 14px; color: inherit;
  outline: none; transition: all 0.15s ease;
}
.filter-input::placeholder { color: #9ca3af; }
.filter-input:focus {
  border-color: #047857; background: #fff;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}

/* ── Таблица пунктов ── */
.pp-card { overflow: visible; }
.pp-table :deep(td) { font-size: 14px; }
.pp-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important; white-space: nowrap;
}
.th-inner { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.th-sortable { cursor: pointer; user-select: none; }
.th-sortable .th-sort-ico { opacity: 0.35; transition: opacity 0.15s; }
.th-sortable:hover .th-sort-ico { opacity: 0.7; }
.th-sorted { color: rgb(var(--v-theme-primary)); }
.th-sorted .th-sort-ico { opacity: 1; color: rgb(var(--v-theme-primary)); }
.pp-table th.text-end .th-inner { flex-direction: row-reverse; }

.pp-name {
  display: flex; align-items: center; gap: 8px;
  font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9);
}
.pp-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.pp-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.pp-ops { font-size: 13px; }
.pp-balance { font-weight: 700; font-variant-numeric: tabular-nums; }
.pp-row--off { opacity: 0.55; }
.pp-off-badge {
  font-size: 10.5px; font-weight: 600; padding: 1px 7px; border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/* Состояние инкассации — единственное цветное место в строке: это повод
   действовать, а не справка. */
.pp-pickup {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 8px; white-space: nowrap;
  font-size: 12.5px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.pp-pickup--due { background: rgba(239, 68, 68, 0.1); color: #dc2626; font-weight: 600; }
.pp-pickup--run { background: rgba(59, 130, 246, 0.12); color: #2563eb; font-weight: 600; }

.pp-collections {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}

/* ── Тёмная тема: у всех белых подложек обязана быть пара ── */
.dark .stat-card {
  background: rgb(var(--v-theme-surface)); border-color: rgb(var(--v-theme-border));
}
.dark .fb-btn {
  background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border));
}
.dark .filter-input {
  background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border));
  color: rgba(var(--v-theme-on-surface), 0.92);
}
.dark .filter-input:focus {
  border-color: #047857; background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .filter-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.5); }
</style>
