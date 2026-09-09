<script setup lang="ts">
/**
 * Поручители: кто и за сколько поручился.
 *
 * Отвечает на вопрос, которого раньше нельзя было задать: сколько на человеке
 * уже висит чужих обязательств. Роль нигде не хранится — она вытекает из
 * связей, поэтому список всегда актуален.
 *
 * Раньше это был отдельный пункт меню. Поручитель — тот же клиент, поэтому
 * панель встроена вкладкой в «Клиенты», а своего раздела у неё больше нет.
 * Оформление — общее для разделов сервиса: KPI-плитки stats-row/stat-card,
 * поиск filter-input, кнопки fb-btn, таблица в карточке и ServerPager.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import ServerPager from '@/components/ServerPager.vue'
import { useAutoLoad } from '@/composables/useAutoLoad'
import { formatCurrency, formatPhone } from '@/utils/formatters'

interface GuarantorRow {
  id: string
  firstName: string
  lastName: string | null
  patronymic: string | null
  phone: string | null
  city: string | null
  guaranteeCount: number
  guaranteeVolume: number
  activeCount: number
  closedCount: number
  overdueDealCount: number
  overdueAmount: number
  guaranteeRemaining: number
  ownDebt: number
  ownOverdue: boolean
  totalExposure: number
}
interface Totals {
  total: number
  underGuarantee: number
  withOverdue: number
  overdueTotal: number
}
interface MutualPair {
  a: { id: string; name: string }
  b: { id: string; name: string }
}

const auth = useAuthStore()
const toast = useToast()
const router = useRouter()
const { isDark } = useIsDark()

const items = ref<GuarantorRow[]>([])
const totals = ref<Totals | null>(null)
const mutual = ref<MutualPair[]>([])
const loading = ref(false)

const q = ref('')
const onlyOverdue = ref(false)
const sort = ref('totalExposure')
const dir = ref<'asc' | 'desc'>('desc')
/** Страницы считаются от единицы: этого ждёт общий ServerPager. */
const page = ref(1)
const perPage = ref(50)
const PER_PAGE_OPTIONS = [25, 50, 100, 200]

const COLUMNS: Array<{ key: string; title: string; sortable?: boolean; align?: 'end' }> = [
  { key: 'name', title: 'Поручитель', sortable: true },
  { key: 'guaranteeCount', title: 'Поручительств', sortable: true, align: 'end' },
  { key: 'guaranteeRemaining', title: 'Под поручительством', align: 'end' },
  { key: 'overdueAmount', title: 'Просрочка', sortable: true, align: 'end' },
  { key: 'ownDebt', title: 'Свой долг', sortable: true, align: 'end' },
  { key: 'totalExposure', title: 'Ответственность', sortable: true, align: 'end' },
]

/**
 * Загрузка порции.
 *
 * `append` — режим автоподгрузки: строки добавляются к уже показанным, а не
 * заменяют их. Смещение при этом считается от числа загруженных строк, а не
 * от номера страницы: порции и страницы — разные способы листать один список.
 */
async function load(append = false) {
  loading.value = true
  try {
    const params = new URLSearchParams({
      sort: sort.value,
      dir: dir.value,
      limit: String(perPage.value),
      offset: String(append ? items.value.length : (page.value - 1) * perPage.value),
      ...(q.value.trim() ? { q: q.value.trim() } : {}),
      ...(onlyOverdue.value ? { onlyOverdue: 'true' } : {}),
    })
    const res = await api.get<{ items: GuarantorRow[]; totals: Totals }>(`/guarantors?${params}`)
    items.value = append ? [...items.value, ...res.items] : res.items
    totals.value = res.totals
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить поручителей')
  } finally {
    loading.value = false
  }
}

async function loadMutual() {
  try {
    mutual.value = await api.get<MutualPair[]>('/guarantors/mutual')
  } catch {
    // не критично для раздела
  }
}

function setSort(key: string) {
  if (!COLUMNS.find((c) => c.key === key)?.sortable) return
  if (sort.value === key) dir.value = dir.value === 'desc' ? 'asc' : 'desc'
  else {
    sort.value = key
    dir.value = 'desc'
  }
  page.value = 1
  load()
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(q, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    load()
  }, 400)
})
watch(onlyOverdue, () => {
  page.value = 1
  load()
})
watch([page, perPage], () => load())

const totalRows = computed(() => totals.value?.total ?? 0)
const loadedCount = computed(() => items.value.length)
const hasMore = computed(() => loadedCount.value < totalRows.value)

// Автоподгрузка: долистали до конца — следующая порция приходит сама. Тот же
// механизм, что в «Сделках» и «Должниках», настройка своя у раздела.
const autoLoad = useAutoLoad({
  storageKey: 'guarantors:auto-load',
  hasMore,
  busy: loading,
  loadMore: () => load(true),
})
const autoLoadSentinel = autoLoad.sentinel

// Переключение режима возвращает к началу выборки: иначе счётчик «показано N»
// врал бы про уже пролистанные страницы.
watch(
  () => autoLoad.enabled.value,
  () => {
    autoLoad.reset()
    if (page.value !== 1) page.value = 1
    else load()
  },
)

function fullName(r: GuarantorRow) {
  return [r.lastName, r.firstName, r.patronymic].filter(Boolean).join(' ')
}

/** Телефон и город через точку — но без «висящей» точки, если чего-то нет. */
function subLine(r: GuarantorRow) {
  return [r.phone ? formatPhone(r.phone) : null, r.city].filter(Boolean).join(' · ')
}

// ── Пороги предупреждений ──
const settingsDialog = ref(false)
const settings = ref({
  maxActiveGuarantees: 3,
  maxActiveAmount: 0,
  warnIfOverdue: true,
  warnIfOwnOverdue: true,
  warnIfBlacklisted: true,
})
const savingSettings = ref(false)

async function openSettings() {
  try {
    settings.value = await api.get('/guarantors/settings')
    settingsDialog.value = true
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось открыть настройки')
  }
}
async function saveSettings() {
  savingSettings.value = true
  try {
    await api.patch('/guarantors/settings', settings.value)
    settingsDialog.value = false
    toast.success('Пороги сохранены')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить')
  } finally {
    savingSettings.value = false
  }
}

onMounted(() => {
  load()
  loadMutual()
})
</script>

<template>
  <div class="gp-panel" :class="{ dark: isDark }">
    <!-- Показатели раздела — тот же вид, что на «Сделках» и «Должниках». -->
    <div v-if="totals" class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-account-check-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ totals.total }}</div>
          <div class="stat-label">Поручителей</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
          <v-icon icon="mdi-shield-account-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(totals.underGuarantee) }}</div>
          <div class="stat-label">Под поручительством</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
          <v-icon icon="mdi-alert-circle-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ totals.withOverdue }}</div>
          <div class="stat-label">С просрочкой на {{ formatCurrency(totals.overdueTotal) }}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
          <v-icon icon="mdi-swap-horizontal" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ mutual.length }}</div>
          <div class="stat-label">Ручаются друг за друга</div>
        </div>
      </div>
    </div>

    <!-- Взаимные поручительства: сигнал, что обеспечения по сути нет. -->
    <v-card v-if="mutual.length" rounded="lg" elevation="0" border class="pa-4 mb-3 gp-mutual">
      <div class="gp-mutual-title">
        <v-icon icon="mdi-swap-horizontal" size="16" />
        Ручаются друг за друга
        <span class="gp-mutual-hint">обеспечения по таким сделкам по сути нет</span>
      </div>
      <div class="gp-mutual-list">
        <div v-for="(m, i) in mutual.slice(0, 12)" :key="i" class="gp-mutual-pair">
          <button class="gp-link" @click="router.push(`/clients/${m.a.id}`)">{{ m.a.name }}</button>
          <v-icon icon="mdi-swap-horizontal" size="13" />
          <button class="gp-link" @click="router.push(`/clients/${m.b.id}`)">{{ m.b.name }}</button>
        </div>
        <span v-if="mutual.length > 12" class="gp-mutual-more">и ещё {{ mutual.length - 12 }}</span>
      </div>
    </v-card>

    <!-- Панель инструментов: слева фильтры, справа поиск — как в «Сделках». -->
    <div class="d-flex justify-space-between align-center ga-2 mb-3 flex-wrap">
      <div class="d-flex align-center ga-2 flex-wrap">
        <button
          class="fb-btn"
          :class="{ 'fb-btn--active': onlyOverdue }"
          @click="onlyOverdue = !onlyOverdue"
        >
          <v-icon icon="mdi-alert-outline" size="16" />
          <span>Только с просрочкой</span>
        </button>
        <button v-if="auth.can('guarantors.settings')" class="fb-btn" @click="openSettings">
          <v-icon icon="mdi-tune" size="16" />
          <span>Пороги предупреждений</span>
        </button>
      </div>
      <div class="d-flex align-center ga-2 flex-grow-1 justify-end">
        <div class="filter-input-wrap" style="max-width: 620px; min-width: 320px; flex: 1 1 320px;">
          <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
          <input
            v-model="q"
            type="text"
            placeholder="Поиск по имени или телефону"
            class="filter-input"
          />
        </div>
      </div>
    </div>

    <v-card rounded="lg" elevation="0" border class="gp-card">
      <div class="pa-4">
        <div v-if="loading && !items.length" class="d-flex justify-center pa-12">
          <v-progress-circular indeterminate color="primary" size="32" />
        </div>

        <div v-else-if="!items.length" class="text-center pa-12">
          <v-icon icon="mdi-account-check-outline" size="56" color="grey-lighten-1" class="mb-3" />
          <div class="text-h6 mb-1">Поручителей не нашлось</div>
          <div class="text-body-2 text-medium-emphasis">
            Здесь появятся люди, которых указывают поручителями в сделках
          </div>
        </div>

        <template v-else>
          <v-table density="default" hover class="gp-table">
            <thead>
              <tr>
                <th
                  v-for="c in COLUMNS"
                  :key="c.key"
                  :class="[
                    c.align === 'end' ? 'text-end' : 'text-start',
                    { 'th-sortable': c.sortable, 'th-sorted': sort === c.key },
                  ]"
                  @click="setSort(c.key)"
                >
                  <span class="th-inner">
                    {{ c.title }}
                    <v-icon
                      v-if="c.sortable"
                      :icon="sort === c.key ? (dir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down') : 'mdi-unfold-more-horizontal'"
                      size="14"
                      class="th-sort-ico"
                    />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in items"
                :key="r.id"
                class="cursor-pointer"
                @click="router.push(`/clients/${r.id}`)"
              >
                <td>
                  <div class="gp-name">{{ fullName(r) }}</div>
                  <div v-if="subLine(r)" class="gp-sub">{{ subLine(r) }}</div>
                </td>
                <td class="text-end">
                  {{ r.guaranteeCount }}
                  <div class="gp-sub">действующих {{ r.activeCount }}</div>
                </td>
                <td class="text-end">{{ formatCurrency(r.guaranteeRemaining) }}</td>
                <td class="text-end">
                  <span :class="{ 'gp-bad': r.overdueAmount > 0 }">
                    {{ formatCurrency(r.overdueAmount) }}
                  </span>
                  <div v-if="r.overdueDealCount" class="gp-sub">
                    в {{ r.overdueDealCount }} сделк{{ r.overdueDealCount === 1 ? 'е' : 'ах' }}
                  </div>
                </td>
                <td class="text-end">
                  {{ formatCurrency(r.ownDebt) }}
                  <div v-if="r.ownOverdue" class="gp-sub gp-bad">сам просрочил</div>
                </td>
                <td class="text-end gp-strong">{{ formatCurrency(r.totalExposure) }}</td>
              </tr>
            </tbody>
          </v-table>

          <!-- Метка конца списка для автоподгрузки. -->
          <div v-if="autoLoad.enabled.value" ref="autoLoadSentinel" class="auto-load-sentinel" />

          <ServerPager
            v-if="totalRows > 0"
            :page="page"
            :total="totalRows"
            :per-page="perPage"
            :busy="loading"
            :per-page-options="PER_PAGE_OPTIONS"
            :auto-load="autoLoad.enabled.value"
            :loaded="loadedCount"
            :has-more="hasMore"
            :paused="autoLoad.paused.value"
            @update:page="page = $event"
            @update:per-page="perPage = $event"
            @update:auto-load="autoLoad.enabled.value = $event"
            @load-more="autoLoad.loadMoreManually()"
          />
        </template>
      </div>
    </v-card>

    <!-- Пороги -->
    <v-dialog v-model="settingsDialog" max-width="500">
      <v-card class="pa-6">
        <div class="text-h6 mb-1">Когда предупреждать</div>
        <div class="text-body-2 text-medium-emphasis mb-5">
          Сервис покажет предупреждение в момент выбора поручителя. Запрета нет — решение остаётся
          за вами.
        </div>

        <v-text-field
          v-model.number="settings.maxActiveGuarantees"
          label="Предупреждать, если действующих поручительств не меньше"
          type="number"
          variant="outlined"
          density="comfortable"
          hide-details
          class="mb-1"
        />
        <div class="text-caption text-medium-emphasis mb-4">0 — не проверять количество</div>

        <v-text-field
          v-model.number="settings.maxActiveAmount"
          label="…или сумма под его поручительством не меньше"
          type="number"
          suffix="₽"
          variant="outlined"
          density="comfortable"
          hide-details
          class="mb-1"
        />
        <div class="text-caption text-medium-emphasis mb-4">0 — не проверять сумму</div>

        <v-switch
          v-model="settings.warnIfOverdue"
          color="primary"
          density="compact"
          hide-details
          label="Есть просрочка по его поручительствам"
        />
        <v-switch
          v-model="settings.warnIfOwnOverdue"
          color="primary"
          density="compact"
          hide-details
          label="У него самого есть просроченная рассрочка"
        />
        <v-switch
          v-model="settings.warnIfBlacklisted"
          color="primary"
          density="compact"
          hide-details
          label="Человек в чёрном списке"
        />

        <div class="d-flex ga-2 mt-5">
          <v-btn variant="text" @click="settingsDialog = false">Отмена</v-btn>
          <v-spacer />
          <v-btn color="primary" :loading="savingSettings" @click="saveSettings">Сохранить</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
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

/* ── Таблица ── */
/* Карточка списка не режет содержимое: прилипающий ServerPager иначе
   обрезается по нижней границе. */
.gp-card { overflow: visible; }
.gp-table :deep(td) { font-size: 14px; }
.gp-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase; letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important; white-space: nowrap;
}
.th-inner { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.th-sortable { cursor: pointer; user-select: none; }
.th-sortable .th-sort-ico { opacity: 0.35; transition: opacity 0.15s; }
.th-sortable:hover .th-sort-ico { opacity: 0.7; }
.th-sorted { color: rgb(var(--v-theme-primary)); }
.th-sorted .th-sort-ico { opacity: 1; color: rgb(var(--v-theme-primary)); }
.gp-table th.text-end .th-inner { flex-direction: row-reverse; }

.gp-name { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }
.gp-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.gp-strong { font-weight: 700; }
.gp-bad { color: #ef4444; font-weight: 600; }

/* ── Взаимные поручительства ── */
.gp-mutual-title {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 8px;
}
.gp-mutual-hint {
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.gp-mutual-list { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.gp-mutual-pair {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.auto-load-sentinel { height: 1px; }

.gp-mutual-more { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.45); }
.gp-link {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 13px; font-weight: 600;
  color: rgb(var(--v-theme-primary));
}
.gp-link:hover { text-decoration: underline; }

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
