<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCashBoxesStore, type CashBoxSummary, type CashBoxDealBreakdown } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useCapital } from '@/composables/useCapital'
import { formatCurrency } from '@/utils/formatters'
import CashBoxEditDialog from '@/components/CashBoxEditDialog.vue'
import CashBoxLimitBlock from '@/components/CashBoxLimitBlock.vue'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const toast = useToast()
const { isDark } = useIsDark()
const store = useCashBoxesStore()
const authStore = useAuthStore()

// Plan cashbox limit (−1 = unlimited). FREE 1 · Стандарт 3 · Бизнес 5 · Премиум ∞.
// Only ACTIVE cashboxes count toward the limit (matches the backend).
const cashBoxLimit = computed(() => authStore.user?.planLimits?.maxCashBoxes ?? -1)
// Active = non-archived AND not read-only-locked (matches the backend limit).
const activeCashBoxCount = computed(() => store.items.filter((b) => !b.archivedAt && !b.lockedAt).length)
const atCashBoxLimit = computed(
  () => cashBoxLimit.value !== -1 && activeCashBoxCount.value >= cashBoxLimit.value,
)
// Cross-cashbox waterfall figures (netProfit, pendingCIPayout, availableCapital).
// Replaces the dedicated /finance page — partner sees totals here.
const { capital, fetchCapital } = useCapital()

const showCreate = ref(false)
const editing = ref<CashBoxSummary | null>(null)

// Any non-archived cashbox pushed into read-only because the active count
// exceeds the plan limit (e.g. after a downgrade). Drives the top warning block.
const hasLockedBoxes = computed(() => store.items.some((b) => !b.archivedAt && b.lockedAt))

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

function goToSubscription() {
  router.push({ path: '/settings', query: { tab: 'subscription' } })
}

function openCreate() {
  if (atCashBoxLimit.value) {
    toast.error(`Лимит касс для вашего тарифа: ${cashBoxLimit.value}. Перейдите на более высокий тариф, чтобы добавить больше.`)
    goToSubscription()
    return
  }
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

async function handleDelete(box: CashBoxSummary, e: Event) {
  e.stopPropagation()
  if (box.isDefault) {
    toast.error('Нельзя удалить основную кассу')
    return
  }
  if (box.dealsCount > 0) {
    toast.error(`В кассе ${box.dealsCount} сделок. Перенесите их в другую кассу или удалите.`)
    return
  }
  if (!confirm(`Удалить кассу «${box.name}»? Действие необратимо.`)) return
  try {
    await store.remove(box.id)
    toast.success('Касса удалена')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить')
  }
}

function cashboxProgressPct(box: CashBoxSummary): number {
  const denom = box.initialCapital
  if (denom <= 0) return 0
  return Math.min(100, Math.round((box.inProgress / denom) * 100))
}

// Общий капитал = свободные деньги (баланс) + капитал, который сейчас в сделках.
function cashboxTotalCapital(box: CashBoxSummary): number {
  return box.balance + box.inProgress
}

// ─── "В работе" info modal ───────────────────────────────────────────
const showInfo = ref(false)
const infoBox = ref<CashBoxSummary | null>(null)
const infoDeals = ref<CashBoxDealBreakdown[]>([])
const infoLoading = ref(false)

// Only ACTIVE deals contribute to the list-page inProgress; each adds
// (purchasePrice − received). Sorted by the biggest chunk still in work.
const infoActiveDeals = computed(() =>
  infoDeals.value
    .filter(d => d.status === 'ACTIVE')
    .map(d => ({ ...d, inWork: d.purchasePrice - d.received }))
    .sort((a, b) => b.inWork - a.inWork)
)

function dealsWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'сделка'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сделки'
  return 'сделок'
}

function goToDeal(dealId: string) {
  showInfo.value = false
  router.push(`/deals/${dealId}`)
}

async function openInfo(box: CashBoxSummary, e: Event) {
  e.stopPropagation()
  infoBox.value = box
  showInfo.value = true
  infoLoading.value = true
  infoDeals.value = []
  try {
    infoDeals.value = await store.fetchDeals(box.id)
  } catch (err: any) {
    toast.error(err.message || 'Не удалось загрузить сделки')
  } finally {
    infoLoading.value = false
  }
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
      <div class="cb-header-actions">
        <span
          v-if="cashBoxLimit !== -1"
          class="cb-limit-chip"
          :class="{ 'cb-limit-chip--full': atCashBoxLimit }"
          :title="atCashBoxLimit ? 'Лимит касс для вашего тарифа достигнут' : ''"
        >
          <v-icon :icon="atCashBoxLimit ? 'mdi-lock-outline' : 'mdi-wallet-outline'" size="13" />
          {{ activeCashBoxCount }} / {{ cashBoxLimit }}
        </span>
        <button class="cb-create-btn" :class="{ 'cb-create-btn--locked': atCashBoxLimit }" @click="openCreate">
          <v-icon :icon="atCashBoxLimit ? 'mdi-lock-outline' : 'mdi-plus'" size="18" />
          Новая касса
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="store.isLoading && store.items.length === 0" class="d-flex justify-center align-center" style="min-height: 300px;">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Read-only cashboxes over the plan limit → pick which stay active -->
      <CashBoxLimitBlock v-if="hasLockedBoxes" :boxes="store.items" @saved="fetchCapital" />

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
            <div class="cb-metric-value" style="color: #10b981;">+{{ formatCurrency(capital?.partnerNetProfit ?? capital?.netProfit ?? 0) }}</div>
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
              <div v-if="box.lockedAt" class="cb-card-lock-badge">
                <v-icon icon="mdi-lock-outline" size="11" />
                Только просмотр
              </div>
            </div>

            <!-- Menu -->
            <v-menu :close-on-content-click="true" location="bottom end" offset="6">
              <template #activator="{ props }">
                <button class="cb-card-menu" v-bind="props" @click.stop>
                  <v-icon icon="mdi-dots-vertical" size="18" />
                </button>
              </template>
              <v-card rounded="lg" elevation="4" class="cb-menu" @click.stop>
                <div class="cb-menu-body">
                  <button class="cb-menu-item" @click="openEdit(box, $event as any)">
                    <v-icon icon="mdi-pencil-outline" size="16" />
                    <span>Изменить</span>
                  </button>
                  <template v-if="!box.isDefault">
                    <div class="cb-menu-divider" />
                    <button
                      class="cb-menu-item cb-menu-item--danger"
                      @click="handleDelete(box, $event as any)"
                    >
                      <v-icon icon="mdi-delete-outline" size="16" />
                      <span>Удалить</span>
                    </button>
                  </template>
                </div>
              </v-card>
            </v-menu>
          </div>

          <div class="cb-card-amount">{{ formatCurrency(box.balance) }}</div>
          <div class="cb-card-sub">Текущий баланс</div>
          <div class="cb-card-total">
            <v-icon icon="mdi-cash-multiple" size="13" />
            Общий капитал: <b>{{ formatCurrency(cashboxTotalCapital(box)) }}</b>
          </div>

          <!-- Mini progress bar showing capital deployment -->
          <div class="cb-card-progress">
            <div
              class="cb-card-progress-fill"
              :style="{ width: cashboxProgressPct(box) + '%', background: box.color }"
            />
          </div>
          <div class="cb-card-progress-meta">
            <span class="cb-card-inwork">
              В работе: {{ formatCurrency(box.inProgress) }}
              <button class="cb-info-btn" title="Из чего складывается сумма" @click.stop="openInfo(box, $event)">
                <v-icon icon="mdi-information-outline" size="14" />
              </button>
            </span>
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

        <!-- "+ Add" placeholder card — locked with an upsell at the plan limit -->
        <button
          class="cb-card cb-card--add"
          :class="{ 'cb-card--locked': atCashBoxLimit }"
          @click="atCashBoxLimit ? goToSubscription() : openCreate()"
        >
          <v-icon :icon="atCashBoxLimit ? 'mdi-lock-outline' : 'mdi-plus'" size="32" />
          <div class="cb-card-add-text">
            {{ atCashBoxLimit ? 'Лимит касс достигнут' : 'Новая касса' }}
          </div>
          <div v-if="atCashBoxLimit" class="cb-card-add-sub">Повысьте тариф, чтобы добавить больше</div>
        </button>
      </div>
    </template>

    <!-- Create/edit dialog -->
    <CashBoxEditDialog v-model="showCreate" :cashbox="editing" />

    <!-- "В работе" breakdown modal -->
    <v-dialog v-model="showInfo" max-width="560" scrollable>
      <div class="cb-info-modal" :class="{ dark: isDark }">
        <div class="cb-info-head">
          <div>
            <div class="cb-info-title">Капитал в работе</div>
            <div class="cb-info-box-name" v-if="infoBox">
              {{ infoBox.name }}
              <template v-if="!infoLoading"> · {{ infoActiveDeals.length }}&nbsp;{{ dealsWord(infoActiveDeals.length) }}</template>
            </div>
          </div>
          <button class="cb-info-close" @click="showInfo = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <!-- Hint: where the number comes from -->
        <div class="cb-info-hint">
          <v-icon icon="mdi-lightbulb-on-outline" size="16" />
          <span>
            «В работе» — это закупочный капитал по&nbsp;<b>активным</b> сделкам за вычетом уже
            полученных платежей (включая первоначальный взнос). По мере оплаты клиентами сумма
            уменьшается, а свободный баланс растёт.
          </span>
        </div>

        <div class="cb-info-body">
          <div v-if="infoLoading" class="d-flex justify-center pa-8">
            <v-progress-circular indeterminate color="primary" size="28" />
          </div>

          <div v-else-if="infoActiveDeals.length === 0" class="cb-info-empty">
            <v-icon icon="mdi-briefcase-outline" size="32" />
            <div>Нет активных сделок — весь капитал свободен</div>
          </div>

          <template v-else>
            <template v-for="(d, i) in infoActiveDeals" :key="d.id">
              <div
                class="cb-info-row cb-info-row--clickable"
                @click="goToDeal(d.id)"
              >
                <div class="cb-info-num">{{ i + 1 }}</div>
                <div class="cb-info-row-main">
                  <div class="cb-info-deal-name">{{ d.productName }}</div>
                  <div class="cb-info-deal-sub">
                    <span v-if="d.client">{{ d.client }} · </span>
                    закупка {{ formatCurrency(d.purchasePrice) }} · получено {{ formatCurrency(d.received) }}
                  </div>
                </div>
                <div class="cb-info-row-amount" :class="{ 'cb-info-row-amount--zero': d.inWork <= 0 }">
                  {{ d.inWork > 0 ? formatCurrency(d.inWork) : 'возвращён' }}
                </div>
              </div>
              <div v-if="i < infoActiveDeals.length - 1" class="cb-info-divider" />
            </template>
          </template>
        </div>

        <div class="cb-info-total" v-if="infoBox">
          <span>Итого в работе</span>
          <b>{{ formatCurrency(infoBox.inProgress) }}</b>
        </div>
      </div>
    </v-dialog>
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
.cb-create-btn--locked { background: rgba(var(--v-theme-on-surface), 0.25); }
.cb-create-btn--locked:hover { background: rgba(var(--v-theme-on-surface), 0.35); }

.cb-header-actions { display: flex; align-items: center; gap: 10px; }
.cb-limit-chip {
  display: inline-flex; align-items: center; gap: 4px;
  height: 40px; padding: 0 12px; border-radius: 10px;
  font-size: 12.5px; font-weight: 700; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.6);
  background: rgba(var(--v-theme-on-surface), 0.05);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.cb-limit-chip--full {
  color: #b45309; background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.3);
}
.cb-card--locked { opacity: 0.85; }
.cb-card-add-sub {
  font-size: 11px; font-weight: 500; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

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
.cb-card-lock-badge {
  display: inline-flex; align-items: center; gap: 3px; margin-top: 4px;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
  padding: 2px 8px; border-radius: 6px;
  background: rgba(245, 158, 11, 0.15); color: #b45309;
}
.cb-page.dark .cb-card-lock-badge { background: rgba(245, 158, 11, 0.18); color: #fbbf24; }

.cb-card-menu {
  width: 30px; height: 30px; border-radius: 8px;
  border: none; background: transparent; color: #737373;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
  flex-shrink: 0;
}
.cb-card-menu:hover { background: rgba(0,0,0,0.05); color: #111; }
.cb-page.dark .cb-card-menu:hover { background: rgba(255,255,255,0.08); color: #f5f5f5; }

.cb-menu {
  width: 200px;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.cb-menu-body { padding: 6px; }
.cb-menu-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 9px 12px; border-radius: 8px; border: none; background: none;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: pointer; text-align: left; transition: background 0.1s;
}
.cb-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.cb-menu-item--danger { color: rgb(var(--v-theme-error)); }
.cb-menu-item--danger:hover { background: rgba(var(--v-theme-error), 0.08); }
.cb-menu-divider {
  height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  margin: 4px 6px;
}

.cb-card-amount {
  font-size: 24px; font-weight: 800; color: #111;
  letter-spacing: -0.3px;
}
.cb-card-sub { font-size: 11px; color: #737373; margin-top: 2px; }
.cb-page.dark .cb-card-amount { color: #f5f5f5; }

.cb-card-total {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 8px; font-size: 12px; color: #525252;
}
.cb-card-total b { font-weight: 700; color: #111; }
.cb-page.dark .cb-card-total { color: #a3a3a3; }
.cb-page.dark .cb-card-total b { color: #f5f5f5; }

/* Info "i" button next to the progress meta */
.cb-card-inwork { display: inline-flex; align-items: center; gap: 4px; }
.cb-info-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 50%;
  border: none; background: transparent; color: #9ca3af;
  cursor: pointer; transition: all 0.15s; padding: 0;
}
.cb-info-btn:hover { background: rgba(0,0,0,0.06); color: var(--cb-color); }
.cb-page.dark .cb-info-btn:hover { background: rgba(255,255,255,0.1); }

/* Info modal */
.cb-info-modal { background: #fff; border-radius: 16px; overflow: hidden; }
.cb-info-modal.dark { background: #1c1c1e; }
.cb-info-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 22px 14px;
}
.cb-info-title { font-size: 18px; font-weight: 800; color: #111; }
.cb-info-modal.dark .cb-info-title { color: #f5f5f5; }
.cb-info-box-name { font-size: 13px; color: #737373; margin-top: 2px; }
.cb-info-close {
  width: 32px; height: 32px; border-radius: 9px; border: none;
  background: rgba(0,0,0,0.05); color: #525252; cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: all 0.15s;
}
.cb-info-close:hover { background: rgba(0,0,0,0.1); }
.cb-info-modal.dark .cb-info-close { background: rgba(255,255,255,0.08); color: #d4d4d4; }

.cb-info-hint {
  display: flex; gap: 8px; align-items: flex-start;
  margin: 0 22px 14px; padding: 12px 14px;
  background: rgba(4, 120, 87, 0.07); border-radius: 10px;
  font-size: 12.5px; line-height: 1.5; color: #047857;
}
.cb-info-modal.dark .cb-info-hint { background: rgba(16, 185, 129, 0.1); color: #34d399; }
.cb-info-hint b { font-weight: 700; }

.cb-info-body { padding: 0 10px; max-height: 46vh; overflow-y: auto; }
.cb-info-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 32px; color: #9ca3af; font-size: 13px; text-align: center;
}
.cb-info-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px;
}
.cb-info-divider {
  height: 1px; background: #f0f0f0; margin: 0 12px;
}
.cb-info-modal.dark .cb-info-divider { background: #2a2a2c; }
.cb-info-row--clickable { cursor: pointer; border-radius: 8px; transition: background 0.12s; }
.cb-info-row--clickable:hover { background: rgba(0,0,0,0.035); }
.cb-info-modal.dark .cb-info-row--clickable:hover { background: rgba(255,255,255,0.05); }
.cb-info-num {
  flex-shrink: 0;
  min-width: 38px;
  font-size: 12px; font-weight: 700; color: #9ca3af;
  font-variant-numeric: tabular-nums;
}
.cb-info-modal.dark .cb-info-num { color: #6b7280; }
.cb-info-row-main { min-width: 0; flex: 1; }
.cb-info-deal-name { font-size: 14px; font-weight: 600; color: #111; }
.cb-info-modal.dark .cb-info-deal-name { color: #f5f5f5; }
.cb-info-deal-sub { font-size: 11.5px; color: #737373; margin-top: 2px; }
.cb-info-row-amount { font-size: 14px; font-weight: 800; color: #111; white-space: nowrap; }
.cb-info-modal.dark .cb-info-row-amount { color: #f5f5f5; }
.cb-info-row-amount--zero { color: #9ca3af; font-weight: 600; font-size: 12px; }

.cb-info-total {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 22px; margin-top: 4px;
  border-top: 1px solid #e5e5e5;
  font-size: 14px; color: #525252;
}
.cb-info-total b { font-size: 18px; font-weight: 800; color: #047857; }
.cb-info-modal.dark .cb-info-total { border-top-color: #2a2a2c; color: #a3a3a3; }
.cb-info-modal.dark .cb-info-total b { color: #34d399; }

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
