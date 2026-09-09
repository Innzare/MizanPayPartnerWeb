<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSuppliersStore, type SupplierRow } from '@/stores/suppliers'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatCurrencyShort, formatDateShort, pluralizeRu } from '@/utils/formatters'
import SupplierFormDialog from '@/components/SupplierFormDialog.vue'
import SupplierMapDialog from '@/components/SupplierMapDialog.vue'
import SupplierSparkline from '@/components/suppliers/SupplierSparkline.vue'

const store = useSuppliersStore()
const auth = useAuthStore()
const router = useRouter()
const toast = useToast()
function openDetail(s: SupplierRow) { router.push(`/suppliers/${s.id}`) }

/**
 * Помесячная картина работы с партнёром.
 *
 * Раскрытая строка показывает те же цифры, что и мини-график: данные приходят
 * вместе со списком, поэтому раскрытие ничего не догружает.
 */
const expandedId = ref<string | null>(null)

/** Закупка и заработок закрыты правом: без него показываем розничные суммы. */
const costVisible = computed(() => auth.can('deals.cost'))

const TREND_ICON: Record<string, string> = {
  GROWING: 'mdi-trending-up',
  STABLE: 'mdi-trending-neutral',
  FALLING: 'mdi-trending-down',
  DORMANT: 'mdi-sleep',
  NEW: 'mdi-sprout-outline',
}

/** Словами: партнёру важно «растёт» и «встало», а не «+18.3%». */
function trendLabel(s: SupplierRow): string {
  if (!s.trend) return 'Стабильно'
  if (s.trend === 'DORMANT') return 'Работа встала'
  if (s.trend === 'NEW') return 'Только начали'
  const pct = s.trendChange != null ? Math.round(Math.abs(s.trendChange) * 100) : null
  if (s.trend === 'GROWING') return pct ? `Растёт на ${pct}%` : 'Растёт'
  if (s.trend === 'FALLING') return pct ? `Спад на ${pct}%` : 'Спад'
  return 'Стабильно'
}

function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString('ru-RU', { month: 'short' })
}

// Гарды на случай, если фронт окажется свежее бэка: старый ответ без
// помесячных данных не должен ронять всю таблицу партнёров.
function yearTotal(s: SupplierRow): number {
  return (s.monthly ?? []).reduce((acc, m) => acc + (costVisible.value ? m.purchase : m.retail), 0)
}
function yearDeals(s: SupplierRow): number {
  return (s.monthly ?? []).reduce((acc, m) => acc + m.deals, 0)
}

const canCreate = computed(() => auth.can('suppliers.create'))
const canEdit = computed(() => auth.can('suppliers.edit'))
const canDelete = computed(() => auth.can('suppliers.delete'))

const search = ref('')
const onlyDebt = ref(false)
const sort = ref<'debt' | 'name'>('debt')

const formOpen = ref(false)
const editing = ref<SupplierRow | null>(null)

async function reload() {
  await Promise.all([
    store.fetchList({ search: search.value.trim() || undefined, hasDebt: onlyDebt.value, sort: sort.value }),
    store.fetchSummary(),
  ])
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(reload, 300)
}

function openCreate() { editing.value = null; formOpen.value = true }
function openEdit(s: SupplierRow) { editing.value = s; formOpen.value = true }
defineExpose({ openCreate })

// Полный адрес = город + адрес.
function fullAddress(s: SupplierRow) { return [s.city, s.address].filter(Boolean).join(', ') }
function hasPoint(s: SupplierRow) { return s.lat != null && s.lng != null }

// Диалог с картой адреса.
const mapDialog = ref(false)
const mapSupplier = ref<SupplierRow | null>(null)
function openMap(s: SupplierRow) { mapSupplier.value = s; mapDialog.value = true }

async function onSaved() {
  toast.success(editing.value ? 'Партнёр обновлён' : 'Партнёр добавлен')
  await reload()
}

async function removeSupplier(s: SupplierRow) {
  if (!confirm(`Удалить партнёра «${s.name}»?`)) return
  try {
    const res = await store.remove(s.id)
    toast.success(res.archived ? 'Партнёр архивирован (есть история)' : 'Партнёр удалён')
    await reload()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось удалить')
  }
}

onMounted(reload)
</script>

<template>
  <div>
    <!-- Сводка -->
    <div class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(239,68,68,0.1); color:#ef4444;"><v-icon icon="mdi-cash-minus" size="20" /></div>
        <div><div class="stat-value">{{ formatCurrency(store.summary.totalDebt) }}</div><div class="stat-label">Общий долг поставщикам</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245,158,11,0.1); color:#f59e0b;"><v-icon icon="mdi-account-alert-outline" size="20" /></div>
        <div><div class="stat-value">{{ store.summary.suppliersWithDebt }}</div><div class="stat-label">С непогашенным долгом</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4,120,87,0.1); color:#047857;"><v-icon icon="mdi-handshake-outline" size="20" /></div>
        <div><div class="stat-value">{{ store.summary.suppliersCount }}</div><div class="stat-label">Всего партнёров</div></div>
      </div>
    </div>

    <!-- Тулбар -->
    <div class="sup-card">
      <div class="pa-4">
        <div class="d-flex justify-space-between align-center ga-2 mb-3 flex-wrap">
          <div class="d-flex align-center ga-2 flex-wrap">
            <button class="sup-chip" :class="{ active: onlyDebt }" @click="onlyDebt = !onlyDebt; reload()">
              <v-icon icon="mdi-cash-minus" size="15" /> Есть долг
            </button>
            <v-menu>
              <template #activator="{ props }">
                <button class="sup-chip" v-bind="props">
                  <v-icon icon="mdi-sort" size="15" /> {{ sort === 'debt' ? 'По долгу' : 'По имени' }}
                </button>
              </template>
              <div class="col-menu">
                <label class="col-menu-item" @click="sort = 'debt'; reload()"><span>По долгу</span></label>
                <label class="col-menu-item" @click="sort = 'name'; reload()"><span>По имени</span></label>
              </div>
            </v-menu>
          </div>
          <div class="d-flex align-center ga-2 flex-wrap">
            <div class="sup-search">
              <v-icon icon="mdi-magnify" size="18" />
              <input v-model="search" type="text" placeholder="Поиск по названию, городу, телефону…" @input="onSearch" />
            </div>
            <v-btn v-if="canCreate" class="mz-btn-text" color="primary" variant="flat" rounded="lg" prepend-icon="mdi-plus" @click="openCreate">Добавить</v-btn>
          </div>
        </div>

        <div v-if="store.loading" class="d-flex justify-center pa-12">
          <v-progress-circular indeterminate color="primary" size="40" />
        </div>

        <v-table v-else-if="store.rows.length" density="comfortable" hover class="sup-table">
          <thead>
            <tr>
              <th>Партнёр</th>
              <th style="min-width: 280px;">Адрес</th>
              <th>Контакт</th>
              <th class="text-center">Сделок</th>
              <th style="width: 110px;">Год</th>
              <th>Как идут дела</th>
              <th class="text-end">Долг</th>
              <th class="text-end" style="width: 96px;"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="s in store.rows" :key="s.id">
            <tr class="cursor-pointer" :class="{ 'sup-row--arch': s.archivedAt, 'sup-row--open': expandedId === s.id }" @click="openDetail(s)">
              <td>
                <div class="font-weight-medium">{{ s.name }} <span v-if="s.archivedAt" class="sup-arch-tag">архив</span></div>
                <div v-if="s.activity" class="sup-sub">{{ s.activity }}</div>
              </td>
              <td>
                <div v-if="fullAddress(s) || hasPoint(s)" class="sup-addr">
                  <button
                    v-if="hasPoint(s)"
                    class="sup-map-btn" title="Показать на карте"
                    @click.stop="openMap(s)"
                  >
                    <v-icon icon="mdi-map-marker-outline" size="18" />
                  </button>
                  <span class="sup-addr-text">{{ fullAddress(s) || 'Адрес не указан' }}</span>
                </div>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
              <td>
                <div v-if="s.contactName" class="text-no-wrap">{{ s.contactName }}</div>
                <div v-if="s.phone" class="sup-sub text-no-wrap">{{ s.phone }}</div>
                <span v-if="!s.contactName && !s.phone" class="text-medium-emphasis">—</span>
              </td>
              <td class="text-center">{{ s.dealsCount }}</td>
              <td>
                <SupplierSparkline :points="s.monthly" :field="costVisible ? 'purchase' : 'retail'" />
              </td>
              <td>
                <div class="sup-trend" :class="`sup-trend--${(s.trend ?? 'stable').toLowerCase()}`">
                  <v-icon :icon="TREND_ICON[s.trend ?? 'STABLE']" size="15" />
                  <span>{{ trendLabel(s) }}</span>
                </div>
                <div v-if="s.lastDealAt" class="sup-sub">
                  последняя {{ formatDateShort(new Date(s.lastDealAt)) }}
                </div>
              </td>
              <td class="text-end text-no-wrap">
                <span v-if="s.debtTotal > 0" class="sup-debt">{{ formatCurrency(s.debtTotal) }}</span>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
              <td class="text-end" @click.stop>
                <div class="d-flex ga-1 justify-end">
                  <button
                    class="sup-act"
                    :title="expandedId === s.id ? 'Свернуть месяцы' : 'Показать по месяцам'"
                    @click="expandedId = expandedId === s.id ? null : s.id"
                  >
                    <v-icon :icon="expandedId === s.id ? 'mdi-chevron-up' : 'mdi-chart-bar'" size="17" />
                  </button>
                  <button v-if="canEdit" class="sup-act" title="Редактировать" @click="openEdit(s)"><v-icon icon="mdi-pencil-outline" size="17" /></button>
                  <button v-if="canDelete" class="sup-act sup-act--del" title="Удалить" @click="removeSupplier(s)"><v-icon icon="mdi-delete-outline" size="17" /></button>
                </div>
              </td>
            </tr>
            <!-- Разворот: помесячные цифры, по которым построен график. Данные
                 уже пришли со страницей — дополнительных запросов нет. -->
            <tr v-if="expandedId === s.id" :key="s.id + '-months'" class="sup-months-row">
              <td colspan="8">
                <div class="sup-months">
                  <div class="sup-months-head">
                    <span>{{ costVisible ? 'Закупки по месяцам' : 'Продажи по месяцам' }}</span>
                    <span class="sup-months-total">
                      за год: {{ formatCurrency(yearTotal(s)) }} · {{ yearDeals(s) }}
                      {{ pluralizeRu(yearDeals(s), 'сделка', 'сделки', 'сделок') }}
                      <template v-if="costVisible && s.margin !== null">
                        · заработано {{ formatCurrency(s.margin) }}
                      </template>
                    </span>
                  </div>
                  <div class="sup-months-grid">
                    <div v-for="m in (s.monthly ?? [])" :key="m.ym" class="sup-month" :class="{ 'sup-month--empty': !m.deals }">
                      <div class="sup-month-name">{{ monthName(m.ym) }}</div>
                      <div class="sup-month-value">
                        <template v-if="m.deals">{{ formatCurrencyShort(costVisible ? m.purchase : m.retail) }}</template>
                        <template v-else>—</template>
                      </div>
                      <div class="sup-month-deals">
                        <template v-if="m.deals">{{ m.deals }}</template>
                      </div>
                    </div>
                  </div>
                  <div class="sup-months-facts">
                    <span v-if="costVisible && s.averageCheck">
                      Средняя закупка {{ formatCurrency(s.averageCheck) }}
                    </span>
                    <span v-if="s.shareOfPurchase > 0">
                      Доля в закупках {{ Math.round(s.shareOfPurchase * 100) }}%
                    </span>
                    <span v-if="s.problemShare > 0" class="sup-fact--warn">
                      Сейчас в просрочке {{ Math.round(s.problemShare * 100) }}% сделок
                    </span>
                  </div>
                </div>
              </td>
            </tr>
            </template>
          </tbody>
        </v-table>

        <div v-else class="text-center pa-12">
          <v-icon icon="mdi-handshake-outline" size="56" color="grey-lighten-1" class="mb-3" />
          <div class="text-h6 mb-1">{{ search || onlyDebt ? 'Ничего не найдено' : 'Партнёров пока нет' }}</div>
          <div class="text-body-2 text-medium-emphasis mb-4">
            {{ search || onlyDebt ? 'Измените фильтр или запрос' : 'Добавьте магазин-поставщика, у которого выкупаете товары' }}
          </div>
          <v-btn v-if="canCreate && !search && !onlyDebt" class="mz-btn-text" color="primary" variant="flat" rounded="lg" prepend-icon="mdi-plus" @click="openCreate">Добавить партнёра</v-btn>
        </div>
      </div>
    </div>

    <SupplierFormDialog v-model="formOpen" :supplier="editing" @saved="onSaved" />
    <SupplierMapDialog
      v-model="mapDialog"
      :name="mapSupplier?.name"
      :address="mapSupplier ? (fullAddress(mapSupplier) || mapSupplier.address) : null"
      :lat="mapSupplier?.lat"
      :lng="mapSupplier?.lng"
    />
  </div>
</template>

<style scoped>
/* ── Как идут дела: слово важнее процента ── */
.sup-trend {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.sup-trend--growing { color: #047857; }
.sup-trend--falling { color: #dc2626; }
.sup-trend--dormant { color: #b45309; font-weight: 600; }
.sup-trend--new { color: #2563eb; }

/* ── Раскрытая строка: помесячные цифры ── */
.sup-row--open { background: rgba(var(--v-theme-on-surface), 0.02); }
.sup-months-row td { padding: 0 !important; }
.sup-months {
  padding: 14px 16px 16px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.sup-months-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
  flex-wrap: wrap; margin-bottom: 10px;
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.sup-months-total { font-weight: 400; color: rgba(var(--v-theme-on-surface), 0.5); }
.sup-months-grid {
  display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 6px;
}
@media (max-width: 900px) {
  .sup-months-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}
.sup-month {
  padding: 8px 6px; border-radius: 10px; text-align: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.sup-month--empty { opacity: 0.5; }
.sup-month-name {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.sup-month-value {
  font-size: 13px; font-weight: 700; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-variant-numeric: tabular-nums;
}
.sup-month-deals { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45); }
.sup-months-facts {
  display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 12px;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55);
}
.sup-fact--warn { color: #b45309; }

.stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 760px) { .stats-row { grid-template-columns: 1fr; } }
.stat-card { display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-surface), 1); }
.stat-icon { width: 40px; height: 40px; min-width: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.stat-value { font-size: 18px; font-weight: 700; line-height: 1.2; }
.stat-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }

.sup-card { border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-surface), 1); overflow: hidden; }

.sup-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: transparent; font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; }
.sup-chip:hover { border-color: rgba(var(--v-theme-on-surface), 0.2); }
.sup-chip.active { border-color: rgba(4,120,87,0.5); color: #047857; font-weight: 600; }
.col-menu { background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.1); border-radius: 12px; padding: 8px; min-width: 160px; box-shadow: 0 8px 28px rgba(0,0,0,0.16); }
.col-menu-item { display: block; padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 13.5px; }
.col-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }

.sup-search { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); min-width: 360px; color: rgba(var(--v-theme-on-surface), 0.6); }
.sup-search input { flex: 1; border: none; background: none; outline: none; color: inherit; font-size: 14px; }

.sup-table :deep(th) { font-size: 12px !important; text-transform: uppercase; letter-spacing: 0.03em; color: rgba(var(--v-theme-on-surface), 0.5) !important; }
.sup-table :deep(tbody td) { height: 68px !important; padding-top: 12px !important; padding-bottom: 12px !important; }
.sup-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.sup-addr { display: flex; align-items: center; gap: 10px; }
.sup-addr-text { font-size: 13px; line-height: 1.35; max-width: 280px; }
.sup-map-btn { flex-shrink: 0; width: 34px; height: 34px; border-radius: 9px; border: 1px solid rgba(4,120,87,0.25); background: rgba(4,120,87,0.08); color: #047857; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s; }
.sup-map-btn:hover { background: rgba(4,120,87,0.16); }
.sup-debt { font-weight: 700; color: #ef4444; }
.sup-row--arch { opacity: 0.6; }
.sup-arch-tag { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: rgba(var(--v-theme-on-surface), 0.1); color: rgba(var(--v-theme-on-surface), 0.55); }
.sup-act { width: 32px; height: 32px; border-radius: 8px; border: none; background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.sup-act:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.sup-act--del:hover { background: rgba(239,68,68,0.12); color: #ef4444; }

@media (max-width: 600px) { .sup-search { min-width: 0; width: 100%; } }
</style>
