<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCashBoxesStore, type CashBoxSummary } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useCapital } from '@/composables/useCapital'
import { formatCurrency } from '@/utils/formatters'
import CashBoxEditDialog from '@/components/CashBoxEditDialog.vue'

const router = useRouter()
const toast = useToast()
const { isDark } = useIsDark()
const store = useCashBoxesStore()
// Cross-cashbox waterfall figures (netProfit, pendingCIPayout, availableCapital).
// Replaces the dedicated /finance page — partner sees totals here.
const { capital, fetchCapital } = useCapital()

const showCreate = ref(false)
const editing = ref<CashBoxSummary | null>(null)

onMounted(() => {
  store.fetchAll().catch((e: any) => toast.error(e.message || 'Ошибка загрузки касс'))
  fetchCapital()
})

// Aggregate over all cashboxes for the top "summary across all wallets" card
const total = computed(() => {
  return store.items.reduce(
    (acc, b) => ({
      balance: acc.balance + b.balance,
      inProgress: acc.inProgress + b.inProgress,
      initialCapital: acc.initialCapital + b.initialCapital,
      activeDealsCount: acc.activeDealsCount + b.activeDealsCount,
      dealsCount: acc.dealsCount + b.dealsCount,
    }),
    { balance: 0, inProgress: 0, initialCapital: 0, activeDealsCount: 0, dealsCount: 0 },
  )
})

function openCreate() {
  editing.value = null
  showCreate.value = true
}

function openEdit(box: CashBoxSummary, e: Event) {
  e.stopPropagation()
  editing.value = box
  showCreate.value = true
}

function openDetail(id: string) {
  router.push(`/cashboxes/${id}`)
}

async function handleArchive(box: CashBoxSummary, e: Event) {
  e.stopPropagation()
  if (box.isDefault) {
    toast.error('Нельзя удалить основную кассу')
    return
  }
  const msg = box.dealsCount > 0
    ? `Удалить кассу «${box.name}»? Касса будет архивирована — её ${box.dealsCount} сделок останутся доступны, но касса исчезнет из выбора при создании новых сделок. Действие необратимо.`
    : `Удалить кассу «${box.name}»? Действие необратимо.`
  if (!confirm(msg)) return
  try {
    await store.archive(box.id)
    toast.success('Касса архивирована')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить')
  }
}

function cashboxProgressPct(box: CashBoxSummary): number {
  const denom = box.initialCapital
  if (denom <= 0) return 0
  return Math.min(100, Math.round((box.inProgress / denom) * 100))
}
</script>

<template>
  <div class="cb-page" :class="{ dark: isDark }">
    <!-- Header -->
    <div class="cb-page-header">
      <div>
        <h1 class="cb-page-title">Кассы</h1>
        <div class="cb-page-subtitle">
          Разделите учёт по источникам средств — личные, по инвесторам или просто разные группы продаж
        </div>
      </div>
      <button class="cb-create-btn" @click="openCreate">
        <v-icon icon="mdi-plus" size="18" />
        Новая касса
      </button>
    </div>

    <!-- Loading -->
    <div v-if="store.isLoading && store.items.length === 0" class="d-flex justify-center align-center" style="min-height: 300px;">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Top: total across all cashboxes -->
      <div class="cb-total-card">
        <div class="cb-total-header">
          <div class="cb-total-label">Все кассы</div>
          <div class="cb-total-count">{{ store.items.length }} {{ store.items.length === 1 ? 'касса' : 'касс' }}</div>
        </div>
        <div class="cb-total-amount">{{ formatCurrency(capital?.availableCapital ?? total.balance) }}</div>
        <div class="cb-total-sub">Доступный капитал по всем кассам</div>

        <div class="cb-total-metrics">
          <div class="cb-metric">
            <div class="cb-metric-value">{{ formatCurrency(total.initialCapital) }}</div>
            <div class="cb-metric-label">Начальный капитал</div>
          </div>
          <div class="cb-metric-divider" />
          <div class="cb-metric">
            <div class="cb-metric-value">{{ formatCurrency(total.inProgress) }}</div>
            <div class="cb-metric-label">В работе</div>
          </div>
          <div class="cb-metric-divider" />
          <div class="cb-metric">
            <div class="cb-metric-value" style="color: #10b981;">+{{ formatCurrency(capital?.netProfit ?? 0) }}</div>
            <div class="cb-metric-label">Заработано</div>
          </div>
          <template v-if="(capital?.coInvestorPayout ?? 0) > 0">
            <div class="cb-metric-divider" />
            <div class="cb-metric">
              <div class="cb-metric-value" style="color: #f59e0b;">{{ formatCurrency(capital?.coInvestorPayout ?? 0) }}</div>
              <div class="cb-metric-label">Резерв инвесторам</div>
            </div>
          </template>
          <div class="cb-metric-divider" />
          <div class="cb-metric">
            <div class="cb-metric-value">{{ total.activeDealsCount }} <span class="cb-metric-small">/ {{ total.dealsCount }}</span></div>
            <div class="cb-metric-label">Активных сделок</div>
          </div>
        </div>
      </div>

      <!-- Cashbox cards grid -->
      <div class="cb-grid">
        <div
          v-for="box in store.items"
          :key="box.id"
          class="cb-card"
          :style="{ '--cb-color': box.color }"
          @click="openDetail(box.id)"
        >
          <div class="cb-card-header">
            <div class="cb-card-icon" :style="{ background: box.color + '18', color: box.color }">
              <v-icon :icon="box.icon" size="22" />
            </div>
            <div class="cb-card-title-block">
              <div class="cb-card-title">{{ box.name }}</div>
              <div v-if="box.isDefault" class="cb-card-badge">Основная</div>
            </div>

            <!-- Menu -->
            <v-menu @click.stop>
              <template #activator="{ props }">
                <button class="cb-card-menu" v-bind="props" @click.stop>
                  <v-icon icon="mdi-dots-vertical" size="18" />
                </button>
              </template>
              <v-list density="compact" rounded="lg">
                <v-list-item @click="openEdit(box, $event as any)" prepend-icon="mdi-pencil-outline">
                  <v-list-item-title>Изменить</v-list-item-title>
                </v-list-item>
                <v-list-item
                  v-if="!box.isDefault"
                  @click="handleArchive(box, $event as any)"
                  prepend-icon="mdi-delete-outline"
                  base-color="error"
                >
                  <v-list-item-title>Удалить</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
          </div>

          <div class="cb-card-amount">{{ formatCurrency(box.balance) }}</div>
          <div class="cb-card-sub">Текущий баланс</div>

          <!-- Mini progress bar showing capital deployment -->
          <div class="cb-card-progress">
            <div
              class="cb-card-progress-fill"
              :style="{ width: cashboxProgressPct(box) + '%', background: box.color }"
            />
          </div>
          <div class="cb-card-progress-meta">
            <span>В работе: {{ formatCurrency(box.inProgress) }}</span>
            <span>{{ cashboxProgressPct(box) }}%</span>
          </div>

          <div class="cb-card-footer">
            <div class="cb-card-stat">
              <v-icon icon="mdi-briefcase-outline" size="14" />
              <span>{{ box.activeDealsCount }} активн. / {{ box.dealsCount }} всего</span>
            </div>
            <v-icon icon="mdi-arrow-right" size="16" class="cb-card-arrow" />
          </div>
        </div>

        <!-- "+ Add" placeholder card -->
        <button class="cb-card cb-card--add" @click="openCreate">
          <v-icon icon="mdi-plus" size="32" />
          <div class="cb-card-add-text">Новая касса</div>
        </button>
      </div>
    </template>

    <!-- Create/edit dialog -->
    <CashBoxEditDialog v-model="showCreate" :cashbox="editing" />
  </div>
</template>

<style scoped>
.cb-page { max-width: 1440px; margin: 0 auto; padding: 24px; }

/* Page header */
.cb-page-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; margin-bottom: 24px;
}
.cb-page-title { font-size: 28px; font-weight: 800; color: #111; letter-spacing: -0.5px; }
.cb-page-subtitle { font-size: 14px; color: #737373; margin-top: 6px; max-width: 600px; }
.cb-page.dark .cb-page-title { color: #f5f5f5; }
.cb-page.dark .cb-page-subtitle { color: #a3a3a3; }

.cb-create-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 18px; border-radius: 10px;
  background: #047857; color: #fff; border: none;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: all 0.15s;
}
.cb-create-btn:hover { background: #065f46; transform: translateY(-1px); }

/* Total card — top hero */
.cb-total-card {
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  border-radius: 18px; padding: 24px 28px;
  color: #fff;
  margin-bottom: 28px;
  box-shadow: 0 10px 40px rgba(4, 120, 87, 0.18);
}
.cb-total-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.cb-total-label {
  font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.7);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.cb-total-count {
  font-size: 11px; font-weight: 600;
  background: rgba(255,255,255,0.14);
  padding: 4px 10px; border-radius: 8px;
}
.cb-total-amount {
  font-size: 36px; font-weight: 800; letter-spacing: -0.5px;
  line-height: 1.1;
}
.cb-total-sub { font-size: 13px; color: rgba(255,255,255,0.55); margin-top: 4px; }

.cb-total-metrics {
  display: flex; align-items: center; justify-content: space-around; flex-wrap: wrap;
  margin-top: 18px; padding: 14px 18px;
  background: rgba(255,255,255,0.08); border-radius: 12px;
  row-gap: 12px;
}
.cb-metric { flex: 0 1 auto; min-width: 0; text-align: center; padding: 0 16px; }
.cb-metric-value { font-size: 17px; font-weight: 800; color: #fff; }
.cb-metric-small { font-size: 13px; font-weight: 500; opacity: 0.6; }
.cb-metric-label {
  font-size: 11px; color: rgba(255,255,255,0.55); margin-top: 2px;
}
.cb-metric-divider { width: 1px; height: 30px; background: rgba(255,255,255,0.12); margin: 0 4px; }

/* Cashbox grid */
.cb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 14px;
}

.cb-card {
  position: relative;
  background: #fff;
  border-radius: 14px; border: 1px solid #e5e5e5;
  padding: 18px;
  cursor: pointer;
  transition: all 0.18s;
  text-align: left;
  overflow: hidden;
}
.cb-card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0;
  height: 3px; border-radius: 14px 14px 0 0;
  background: var(--cb-color);
}
.cb-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  border-color: var(--cb-color);
}
.cb-page.dark .cb-card { background: #1c1c1e; border-color: #2a2a2c; }
.cb-page.dark .cb-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.4); }

.cb-card-header {
  display: flex; align-items: flex-start; gap: 12px;
  margin-bottom: 12px;
}
.cb-card-icon {
  width: 42px; height: 42px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.cb-card-title-block { flex: 1; min-width: 0; }
.cb-card-title { font-size: 15px; font-weight: 700; color: #111; }
.cb-card-badge {
  display: inline-block; margin-top: 4px;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  padding: 2px 8px; border-radius: 6px;
  background: var(--cb-color); color: #fff; opacity: 0.9;
}
.cb-page.dark .cb-card-title { color: #f5f5f5; }

.cb-card-menu {
  width: 30px; height: 30px; border-radius: 8px;
  border: none; background: transparent; color: #737373;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
  flex-shrink: 0;
}
.cb-card-menu:hover { background: rgba(0,0,0,0.05); color: #111; }
.cb-page.dark .cb-card-menu:hover { background: rgba(255,255,255,0.08); color: #f5f5f5; }

.cb-card-amount {
  font-size: 24px; font-weight: 800; color: #111;
  letter-spacing: -0.3px;
}
.cb-card-sub { font-size: 11px; color: #737373; margin-top: 2px; }
.cb-page.dark .cb-card-amount { color: #f5f5f5; }

.cb-card-progress {
  height: 5px; border-radius: 3px; overflow: hidden;
  background: rgba(0,0,0,0.06); margin-top: 14px;
}
.cb-page.dark .cb-card-progress { background: rgba(255,255,255,0.08); }
.cb-card-progress-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
.cb-card-progress-meta {
  display: flex; justify-content: space-between;
  font-size: 11px; color: #737373; margin-top: 6px; font-weight: 500;
}

.cb-card-footer {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 14px; padding-top: 14px;
  border-top: 1px solid #f0f0f0;
}
.cb-page.dark .cb-card-footer { border-top-color: #2a2a2c; }
.cb-card-stat {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: #525252; font-weight: 500;
}
.cb-page.dark .cb-card-stat { color: #a3a3a3; }
.cb-card-arrow { opacity: 0.4; transition: all 0.15s; color: var(--cb-color); }
.cb-card:hover .cb-card-arrow { opacity: 1; transform: translateX(4px); }

/* "+ Add" placeholder */
.cb-card--add {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; min-height: 220px;
  background: transparent;
  border: 1.5px dashed #d4d4d4; color: #737373;
}
.cb-card--add::before { display: none; }
.cb-card--add:hover {
  border-color: #047857; color: #047857;
  background: rgba(4, 120, 87, 0.04);
  box-shadow: none;
  transform: none;
}
.cb-page.dark .cb-card--add { border-color: #404040; color: #737373; }
.cb-page.dark .cb-card--add:hover {
  border-color: #047857; color: #34d399;
  background: rgba(4, 120, 87, 0.08);
}
.cb-card-add-text { font-size: 13px; font-weight: 700; }

/* ───── Mobile ───── */
@media (max-width: 599px) {
  .cb-page { padding: 16px 12px; }
  .cb-page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .cb-page-title { font-size: 22px; }
  .cb-page-subtitle { font-size: 13px; }
  .cb-create-btn {
    width: 100%;
    justify-content: center;
    height: 44px;
  }

  /* Hero-карточка «Все кассы» — компактнее. */
  .cb-total-card {
    padding: 18px 16px;
    border-radius: 14px;
    margin-bottom: 18px;
  }
  .cb-total-amount { font-size: 26px; }
  .cb-total-sub { font-size: 12px; }
  .cb-total-metrics {
    padding: 12px;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
  }
  .cb-metric {
    flex: 1 1 calc(50% - 6px);
    padding: 0;
    text-align: left;
  }
  .cb-metric-value { font-size: 15px; }
  .cb-metric-label { font-size: 10px; }
  /* Разделители на мобиле не нужны — лишний визуальный шум в 2×N сетке. */
  .cb-metric-divider { display: none; }

  /* Сетка касс — одна колонка на узких экранах. */
  .cb-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}
</style>
