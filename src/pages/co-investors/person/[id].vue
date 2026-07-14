<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useIsMobile } from '@/composables/useIsMobile'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useCashBoxesStore } from '@/stores/cashboxes'
import CoInvestorCashier from '@/components/CoInvestorCashier.vue'
import CoInvestorRemoveDialog from '@/components/CoInvestorRemoveDialog.vue'
import CoInvestorEditDialog from '@/components/CoInvestorEditDialog.vue'
import { formatCurrency, CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import { type InvestorPersonDetail } from '@/types'

// Unified investor profile — a "person" participating across several cashboxes.
// Header (name/phone, share link, add-to-cashbox), summary totals, then the
// list of per-cashbox stakes. Clicking a stake opens its existing cashier page.
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { isDark } = useIsDark()
const { isMobile } = useIsMobile()
const { fetchPerson, addStake, deletePerson } = useCoInvestors()

// ── Full person editor (identity + all cashbox stakes) ──
const editDialog = ref(false)
const cashboxesStore = useCashBoxesStore()

const personId = computed(() => (route.params as { id: string }).id)

const loading = ref(true)
const data = ref<InvestorPersonDetail | null>(null)

// Which cashbox tab is open. The per-cashbox cashier renders below the tabs,
// so switching a tab swaps the whole cashier without leaving the page.
const activeStakeId = ref<string | null>(null)

async function load() {
  loading.value = true
  try {
    const [d] = await Promise.all([
      fetchPerson(personId.value),
      cashboxesStore.items.length === 0 ? cashboxesStore.fetchAll() : Promise.resolve(),
    ])
    data.value = d
    // Keep the current tab if it still exists, else fall back to the first.
    const ids = d.stakes.map((s) => s.id)
    if (!activeStakeId.value || !ids.includes(activeStakeId.value)) {
      activeStakeId.value = ids[0] ?? null
    }
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить инвестора')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// Re-fetch when navigating between investors (route param changes).
watch(personId, load)

// The cashier emits `changed` after a dividend payout OR after a stake was
// removed from its cashbox. Reload the person: if the removed stake was the
// last remaining cashbox, there's nothing left to show — go back to the list.
async function onCashierChanged() {
  await load()
  // If the profile failed to load, bail to the list. When it loads with zero
  // cashboxes (last one just fully deleted) we STAY — the empty-state card
  // renders so the investor's profile is clearly still here (not deleted).
  if (!data.value) router.push('/co-investors')
}

// ── Delete the whole investor (all cashboxes) ──
const showDeleteDialog = ref(false)
const deleting = ref(false)

async function confirmDeletePerson(opts: { mode: 'full' | 'exclude'; unpaid?: 'keep' | 'writeoff' }) {
  deleting.value = true
  try {
    await deletePerson(personId.value, opts)
    toast.success(opts.mode === 'full' ? 'Инвестор удалён' : 'Инвестор исключён')
    // Person is gone (or fully excluded) — back to the list.
    router.push('/co-investors')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось удалить инвестора')
  } finally {
    deleting.value = false
  }
}

// ── Add-to-cashbox dialog ──
const showAddDialog = ref(false)
const addLoading = ref(false)
const PERCENT_PRESETS = [10, 20, 25, 30, 40, 50]
const FEE_PRESETS = [0, 20, 30, 50]
const COST_FEE_PRESETS = [5, 7.5, 10, 12.5]

// Share-mode options for the dropdown (cost-fee first, as everywhere).
const SHARE_TYPE_OPTIONS = [
  { value: 'COST_FEE' as const, label: 'Комиссия от закупки', icon: 'mdi-tag-outline' },
  { value: 'FIXED' as const, label: 'Фиксированный %', icon: 'mdi-percent-outline' },
  { value: 'WEIGHT' as const, label: 'По вкладу', icon: 'mdi-scale-balance' },
]
function shareTypeOption(v: 'FIXED' | 'WEIGHT' | 'COST_FEE') {
  return SHARE_TYPE_OPTIONS.find((o) => o.value === v) ?? SHARE_TYPE_OPTIONS[0]
}

// Task 3: multi-cashbox. Pick several cashboxes; each gets its own params.
type AddBlock = {
  cashBoxId: string
  capital: number
  shareType: 'FIXED' | 'WEIGHT' | 'COST_FEE'
  profitPercent: number
  managementFeePct: number
  costFeeDefaultRatePct: number | null
}
const addBlocks = ref<AddBlock[]>([])

function makeBlock(cashBoxId: string): AddBlock {
  return { cashBoxId, capital: 0, shareType: 'WEIGHT', profitPercent: 30, managementFeePct: 0, costFeeDefaultRatePct: null }
}
function isAddCashBoxSelected(id: string) {
  return addBlocks.value.some((b) => b.cashBoxId === id)
}
function toggleAddCashBox(id: string) {
  const idx = addBlocks.value.findIndex((b) => b.cashBoxId === id)
  if (idx >= 0) addBlocks.value.splice(idx, 1)
  else addBlocks.value.push(makeBlock(id))
}

// Cashboxes where this person doesn't participate yet.
const availableCashBoxes = computed(() => {
  const used = new Set((data.value?.stakes ?? []).map((s) => s.cashBox.id))
  return cashboxesStore.items.filter((b) => !b.archivedAt && !used.has(b.id))
})

function getCashBox(id: string | null | undefined) {
  if (!id) return undefined
  return cashboxesStore.items.find((b) => b.id === id)
}

function openAddDialog() {
  const first = availableCashBoxes.value[0]?.id
  addBlocks.value = first ? [makeBlock(first)] : []
  showAddDialog.value = true
}

async function saveStake() {
  const blocks = addBlocks.value
  if (blocks.length === 0) return toast.error('Выберите хотя бы одну кассу')
  for (const b of blocks) {
    if (b.capital <= 0) return toast.error('Укажите капитал для каждой кассы')
    if (b.shareType === 'FIXED' && (b.profitPercent <= 0 || b.profitPercent >= 100)) {
      return toast.error('Процент от 1 до 99')
    }
    if (b.shareType === 'COST_FEE' && b.costFeeDefaultRatePct != null && (b.costFeeDefaultRatePct < 0 || b.costFeeDefaultRatePct > 100)) {
      return toast.error('Ставка от 0 до 100')
    }
  }
  addLoading.value = true
  try {
    await Promise.all(
      blocks.map((b) =>
        addStake(personId.value, {
          cashBoxId: b.cashBoxId,
          capital: Number(b.capital),
          profitPercent: b.shareType === 'FIXED' ? Number(b.profitPercent) : null,
          managementFeePct: b.shareType === 'WEIGHT' ? Number(b.managementFeePct || 0) : 0,
          costFeeMode: b.shareType === 'COST_FEE',
          costFeeDefaultRatePct:
            b.shareType === 'COST_FEE' && b.costFeeDefaultRatePct != null
              ? Number(b.costFeeDefaultRatePct)
              : null,
        }),
      ),
    )
    toast.success(blocks.length > 1 ? 'Инвестор добавлен в кассы' : 'Инвестор добавлен в кассу')
    showAddDialog.value = false
    await load()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось добавить в кассу')
  } finally {
    addLoading.value = false
  }
}
</script>

<template>
  <div class="pp-page" :class="{ dark: isDark }">
    <div class="pp-topbar mb-4">
      <button class="pp-back" @click="router.push('/co-investors')">
        <v-icon icon="mdi-arrow-left" size="18" />
        К списку
      </button>
    </div>

    <div v-if="loading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else-if="data">
      <!-- Multi-cashbox only: Σ-summary across all cashboxes + cashbox tabs.
           With a single cashbox this whole block is skipped — the cashier
           below (its own hero + KPIs) is the entire page, and "Add to cashbox"
           lives in the cashier action row (see #hero-action). -->
      <template v-if="data.stakes.length > 1">
      <div class="pp-section-title mb-2">Сводка по всем кассам</div>
      <v-card rounded="lg" elevation="0" border class="pa-5 mb-4">
        <div class="pp-totals">
          <div class="pp-total">
            <div class="pp-total-label">Капитал</div>
            <div class="pp-total-value" style="color: #3b82f6;">{{ formatCurrency(data.totals.currentCapital) }}</div>
          </div>
          <div class="pp-total" v-if="data.totals.activeDeployment != null">
            <div class="pp-total-label">В работе</div>
            <div class="pp-total-value" style="color: #0ea5e9;">{{ formatCurrency(data.totals.activeDeployment) }}</div>
          </div>
          <div class="pp-total">
            <div class="pp-total-label">Начислено</div>
            <div class="pp-total-value" style="color: #047857;">{{ formatCurrency(data.totals.realizedProfit) }}</div>
          </div>
          <div class="pp-total">
            <div class="pp-total-label">Выплачено</div>
            <div class="pp-total-value" style="color: #7c3aed;">{{ formatCurrency(data.totals.totalPayout) }}</div>
          </div>
          <div class="pp-total pp-total--accent">
            <div class="pp-total-label">К выплате</div>
            <div class="pp-total-value" style="color: #f59e0b;">{{ formatCurrency(data.totals.balanceOwed) }}</div>
          </div>
        </div>
      </v-card>

      <!-- Cashbox tabs — pick a cashbox, its full cashier renders below. -->
      <div class="pp-section-title mb-2">Участие по кассам</div>
      <div class="pp-tabs" role="tablist">
        <button
          v-for="s in data.stakes"
          :key="s.id"
          class="pp-tab"
          :class="{ 'pp-tab--active': activeStakeId === s.id }"
          role="tab"
          :aria-selected="activeStakeId === s.id"
          @click="activeStakeId = s.id"
        >
          <span class="pp-tab-icon" :style="{ background: s.cashBox.color + '18', color: s.cashBox.color }">
            <v-icon :icon="s.cashBox.icon || 'mdi-wallet-outline'" size="16" />
          </span>
          <span class="pp-tab-body">
            <span class="pp-tab-name">{{ s.cashBox.name }}</span>
            <span class="pp-tab-mode">
              <template v-if="s.costFeeMode">
                От закупки <template v-if="s.costFeeDefaultRatePct != null"> {{ s.costFeeDefaultRatePct }}%</template>
              </template>
              <template v-else-if="s.profitPercent != null && s.profitPercent > 0">Фикс {{ s.profitPercent }}%</template>
              <template v-else>По вкладу {{ (s.effectivePct ?? 0).toFixed(1) }}%</template>
            </span>
          </span>
          <span v-if="s.balanceOwed > 0" class="pp-tab-badge">{{ formatCurrency(s.balanceOwed) }}</span>
        </button>
      </div>
      </template>

      <!-- Selected cashbox cashier (capital / deals / payouts / journal).
           "Add to cashbox" always sits in the cashier action row, next to
           "Pay dividends" — for one or many cashboxes alike. -->
      <CoInvestorCashier
        v-if="activeStakeId"
        :id="activeStakeId"
        :key="activeStakeId"
        @changed="onCashierChanged"
      >
        <!-- Cashier actions live in its single "Действия" dropdown now.
             We feed our extra items into its menu slots; the `.ci-menu-item`
             classes are defined in the cashier (and mirrored below in this
             page's scoped styles so slot content matches the menu look). -->
        <template #menu-primary>
          <button class="ci-menu-item" @click="editDialog = true">
            <v-icon icon="mdi-pencil-outline" size="18" />
            <span>Редактировать</span>
          </button>
          <button class="ci-menu-item" :disabled="availableCashBoxes.length === 0" @click="openAddDialog">
            <v-icon icon="mdi-plus" size="18" />
            <span>Добавить в кассу</span>
          </button>
        </template>
        <template #menu-danger>
          <button class="ci-menu-item ci-menu-item--danger" @click="showDeleteDialog = true">
            <v-icon icon="mdi-trash-can-outline" size="18" />
            <span>Удалить инвестора</span>
          </button>
        </template>
      </CoInvestorCashier>

      <!-- No cashboxes left (e.g. the last one was fully deleted). The profile
           still exists — offer to re-add, edit or delete the investor. -->
      <v-card v-if="data.stakes.length === 0" rounded="lg" elevation="0" border class="pp-empty">
        <v-icon icon="mdi-wallet-outline" size="40" class="pp-empty-icon" />
        <div class="pp-empty-name">{{ data.person.name }}</div>
        <div class="pp-empty-text">Инвестор не участвует ни в одной кассе.</div>
        <div class="pp-empty-actions">
          <button class="pp-btn pp-btn--primary" :disabled="availableCashBoxes.length === 0" @click="openAddDialog">
            <v-icon icon="mdi-plus" size="16" /> Добавить в кассу
          </button>
          <button class="pp-btn pp-btn--ghost" @click="editDialog = true">
            <v-icon icon="mdi-pencil-outline" size="16" /> Редактировать
          </button>
          <button class="pp-btn pp-btn--ghost pp-btn--danger" @click="showDeleteDialog = true">
            <v-icon icon="mdi-trash-can-outline" size="16" /> Удалить инвестора
          </button>
        </div>
      </v-card>
    </template>

    <!-- Full person editor (identity + all cashbox stakes + add cashbox) -->
    <CoInvestorEditDialog
      v-if="data"
      v-model="editDialog"
      :person-id="personId"
      @saved="load"
    />

    <!-- Delete-investor dialog (across all cashboxes) -->
    <CoInvestorRemoveDialog
      v-if="data"
      v-model="showDeleteDialog"
      scope="person"
      :name="data.person.name"
      :cash-box-count="data.stakes.length"
      :balance-owed="data.totals.balanceOwed"
      :loading="deleting"
      @confirm="confirmDeletePerson"
    />

    <!-- Add-to-cashbox dialog (multi-cashbox) -->
    <v-dialog v-model="showAddDialog" max-width="480" persistent scrollable :fullscreen="isMobile">
      <v-card rounded="lg">
        <div class="pp-dialog-header">
          <span class="pp-dialog-title">Добавить в кассу</span>
          <button class="pp-dialog-close" @click="showAddDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
        <div class="pa-5">
          <!-- Cashbox multi-select -->
          <div class="pp-field mb-4">
            <label class="pp-field-label">Кассы <span style="color: #ef4444;">*</span></label>
            <div v-if="availableCashBoxes.length === 0" class="pp-menu-empty" style="text-align: left;">
              Инвестор уже во всех кассах
            </div>
            <div v-else class="pp-cb-multi">
              <button
                v-for="b in availableCashBoxes"
                :key="b.id"
                type="button"
                class="pp-cb-tag"
                :class="{ 'pp-cb-tag--active': isAddCashBoxSelected(b.id) }"
                :style="isAddCashBoxSelected(b.id) ? { borderColor: b.color, color: b.color, background: b.color + '14' } : {}"
                @click="toggleAddCashBox(b.id)"
              >
                <v-icon :icon="isAddCashBoxSelected(b.id) ? 'mdi-check-circle' : b.icon" size="15" :style="{ color: b.color }" />
                {{ b.name }}
              </button>
            </div>
            <div class="pp-dialog-hint mt-2" style="font-size: 12px;">Параметры задаются отдельно на каждую выбранную кассу.</div>
          </div>

          <!-- Per-cashbox parameter blocks -->
          <div v-for="block in addBlocks" :key="block.cashBoxId" class="pp-cb-block mb-4">
            <div class="pp-cb-block-head">
              <span class="pp-picker-icon" :style="{ color: getCashBox(block.cashBoxId)?.color }">
                <v-icon :icon="getCashBox(block.cashBoxId)?.icon || 'mdi-wallet-outline'" size="16" />
              </span>
              <span class="pp-cb-block-name">{{ getCashBox(block.cashBoxId)?.name }}</span>
              <button type="button" class="pp-cb-block-remove" title="Убрать кассу" @click="toggleAddCashBox(block.cashBoxId)">
                <v-icon icon="mdi-close" size="16" />
              </button>
            </div>

            <!-- Capital -->
            <div class="pp-field mb-3">
              <label class="pp-field-label">Капитал <span style="color: #ef4444;">*</span></label>
              <div class="pp-field-input-wrap">
                <input
                  :value="block.capital || ''"
                  v-maska="CURRENCY_MASK"
                  @maska="(e: any) => block.capital = parseMasked(e)"
                  type="text"
                  inputmode="numeric"
                  class="pp-field-input"
                  placeholder="0"
                />
                <span class="pp-field-suffix">₽</span>
              </div>
            </div>

            <!-- Share type (cost-fee first) -->
            <div class="pp-field mb-3">
              <label class="pp-field-label">Способ деления прибыли</label>
              <v-menu :close-on-content-click="true" offset="4">
                <template #activator="{ props: menuProps }">
                  <button type="button" class="pp-picker" v-bind="menuProps">
                    <v-icon :icon="shareTypeOption(block.shareType).icon" size="18" />
                    <span class="pp-menu-item-name">{{ shareTypeOption(block.shareType).label }}</span>
                    <v-icon icon="mdi-chevron-down" size="18" />
                  </button>
                </template>
                <div class="pp-menu">
                  <button
                    v-for="opt in SHARE_TYPE_OPTIONS"
                    :key="opt.value"
                    type="button"
                    class="pp-menu-item"
                    :class="{ 'pp-menu-item--active': block.shareType === opt.value }"
                    @click="block.shareType = opt.value"
                  >
                    <v-icon :icon="opt.icon" size="18" />
                    <span class="pp-menu-item-name">{{ opt.label }}</span>
                    <v-icon v-if="block.shareType === opt.value" icon="mdi-check" size="16" />
                  </button>
                </div>
              </v-menu>
            </div>

            <!-- Cost-fee rate -->
            <div v-if="block.shareType === 'COST_FEE'" class="pp-field mb-1">
              <label class="pp-field-label">Ставка по умолчанию, % от закупки</label>
              <div class="pp-presets mb-2">
                <button
                  v-for="p in COST_FEE_PRESETS"
                  :key="p"
                  class="pp-preset"
                  :class="{ 'pp-preset--active': block.costFeeDefaultRatePct === p }"
                  @click="block.costFeeDefaultRatePct = p"
                >{{ p }}%</button>
              </div>
              <div class="pp-field-input-wrap">
                <input v-model.number="block.costFeeDefaultRatePct" type="number" class="pp-field-input" placeholder="напр. 5" min="0" max="100" />
                <span class="pp-field-suffix">%</span>
              </div>
            </div>

            <!-- Fixed percent -->
            <div v-if="block.shareType === 'FIXED'" class="pp-field mb-1">
              <label class="pp-field-label">Процент от прибыли <span style="color: #ef4444;">*</span></label>
              <div class="pp-presets mb-2">
                <button
                  v-for="p in PERCENT_PRESETS"
                  :key="p"
                  class="pp-preset"
                  :class="{ 'pp-preset--active': block.profitPercent === p }"
                  @click="block.profitPercent = p"
                >{{ p }}%</button>
              </div>
              <div class="pp-field-input-wrap">
                <input v-model.number="block.profitPercent" type="number" class="pp-field-input" placeholder="30" min="1" max="99" />
                <span class="pp-field-suffix">%</span>
              </div>
            </div>

            <!-- Partner commission -->
            <div v-if="block.shareType === 'WEIGHT'" class="pp-field mb-1">
              <label class="pp-field-label">Комиссия партнёра</label>
              <div class="pp-presets mb-2">
                <button
                  v-for="p in FEE_PRESETS"
                  :key="p"
                  class="pp-preset"
                  :class="{ 'pp-preset--active': block.managementFeePct === p }"
                  @click="block.managementFeePct = p"
                >{{ p }}%</button>
              </div>
              <div class="pp-field-input-wrap">
                <input v-model.number="block.managementFeePct" type="number" class="pp-field-input" placeholder="0" min="0" max="100" />
                <span class="pp-field-suffix">%</span>
              </div>
            </div>
          </div>
        </div>
        <div class="pp-dialog-actions">
          <button class="pp-btn pp-btn--ghost" @click="showAddDialog = false" :disabled="addLoading">Отмена</button>
          <button class="pp-btn pp-btn--primary" @click="saveStake" :disabled="addLoading">
            <v-progress-circular v-if="addLoading" indeterminate size="16" width="2" color="white" class="mr-2" />
            Добавить
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.pp-page { padding: 8px; }
.pp-topbar { display: flex; align-items: center; }
.pp-back {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px; border: 1px solid #e5e7eb;
  background: #fff; color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s;
}
.pp-back:hover { background: rgba(var(--v-theme-on-surface), 0.04); border-color: #d1d5db; }
.dark .pp-back { background: #1e1e2e; border-color: #2e2e42; color: #d4d4d8; }

.pp-hero { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.pp-avatar {
  width: 60px; height: 60px; border-radius: 16px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 20px; letter-spacing: 1px;
}
.pp-identity { flex: 1; min-width: 0; }
.pp-name {
  font-size: 20px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pp-meta {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px;
}
.pp-dot { opacity: 0.5; }
.pp-hero-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.pp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 16px; border-radius: 10px; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent; transition: all 0.15s;
}
.pp-btn:disabled { opacity: 0.5; cursor: default; }
.pp-btn--primary { background: #6366f1; color: #fff; }
.pp-btn--primary:not(:disabled):hover { background: #4f46e5; }
.pp-btn--ghost {
  background: transparent; border-color: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.pp-btn--ghost:not(:disabled):hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.pp-btn--danger { color: #dc2626; }
.pp-btn--danger:not(:disabled):hover { background: rgba(220, 38, 38, 0.08); border-color: rgba(220, 38, 38, 0.3); }

.pp-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: 8px; padding: 40px 24px;
}
.pp-empty-icon { color: rgba(var(--v-theme-on-surface), 0.3); }
.pp-empty-name { font-size: 18px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.pp-empty-text { font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.55); margin-bottom: 8px; }
.pp-empty-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }

.pp-totals { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
@media (max-width: 1100px) { .pp-totals { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 600px) { .pp-totals { grid-template-columns: repeat(2, 1fr); } }
.pp-total { padding: 14px 16px; border-radius: 12px; background: rgba(var(--v-theme-on-surface), 0.03); }
.pp-total--accent { background: rgba(245, 158, 11, 0.06); border: 1px solid rgba(245, 158, 11, 0.18); }
.pp-total-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); }
.pp-total-value { font-size: 18px; font-weight: 700; margin-top: 4px; }

/* Menu items injected into the cashier's "Действия" dropdown (menu-primary /
   menu-danger slots). Slot content renders in THIS component's scope, so the
   cashier's scoped .ci-menu-item styles don't reach it — mirror them here so
   the injected items look identical to the menu's own items. */
.ci-menu-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 10px 12px;
  border-radius: 8px; border: none; background: none;
  font-size: 13px; font-weight: 500; color: #374151;
  cursor: pointer; transition: all 0.12s ease; text-align: left;
}
.ci-menu-item:hover { background: #f9f4f0; }
.ci-menu-item:disabled { opacity: 0.45; cursor: not-allowed; }
.ci-menu-item:disabled:hover { background: none; }
.ci-menu-item--danger { color: #ef4444; }
.ci-menu-item--danger :deep(.v-icon) { color: #ef4444; }
.ci-menu-item--danger:hover { background: #fef2f2; }
.dark .ci-menu-item { color: #a1a1aa; }
.dark .ci-menu-item:hover { background: #252538; }
.dark .ci-menu-item--danger { color: #f87171; }
.dark .ci-menu-item--danger:hover { background: rgba(239, 68, 68, 0.12); }

.pp-section-title { font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }

/* Cashbox tabs */
.pp-tabs {
  display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 16px;
  scrollbar-width: thin;
}
.pp-tab {
  display: flex; align-items: center; gap: 10px; flex-shrink: 0;
  padding: 10px 14px; border-radius: 12px; cursor: pointer; text-align: left;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface)); transition: all 0.15s;
}
.pp-tab:hover { border-color: rgba(99, 102, 241, 0.4); }
.pp-tab--active {
  border-color: #6366f1; background: rgba(99, 102, 241, 0.06);
  box-shadow: 0 0 0 1px #6366f1 inset;
}
.pp-tab-icon {
  width: 34px; height: 34px; min-width: 34px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.pp-tab-body { display: flex; flex-direction: column; line-height: 1.2; }
.pp-tab-name {
  font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.92);
  white-space: nowrap;
}
.pp-tab-mode { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.5); white-space: nowrap; }
.pp-tab-badge {
  font-size: 12px; font-weight: 700; color: #f59e0b; white-space: nowrap;
  padding: 2px 8px; border-radius: 8px; background: rgba(245, 158, 11, 0.1);
}

/* Dialogs */
.pp-dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.pp-dialog-title { font-size: 17px; font-weight: 700; }
.pp-dialog-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.pp-dialog-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 14px 20px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.pp-dialog-hint { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); line-height: 1.5; }
.pp-share-url {
  padding: 12px 14px; border-radius: 10px; word-break: break-all;
  font-size: 13px; font-family: monospace;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.pp-field { }
.pp-field-label {
  display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.pp-field-input-wrap { position: relative; display: flex; align-items: center; }
.pp-field-input {
  width: 100%; padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface)); font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.pp-field-input:focus { outline: none; border-color: #6366f1; }
.pp-field-suffix {
  position: absolute; right: 12px; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.pp-picker {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface)); font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.pp-picker-placeholder { color: rgba(var(--v-theme-on-surface), 0.4); }
.pp-menu {
  padding: 6px; min-width: 240px; border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
}
.pp-menu-item {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 9px 10px; border-radius: 8px; cursor: pointer; border: none;
  background: transparent; font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9);
}
.pp-menu-item + .pp-menu-item { margin-top: 6px; }
.pp-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.pp-menu-item--active { background: rgba(99, 102, 241, 0.1); }
.pp-menu-item-name { flex: 1; }
.pp-menu-empty { padding: 12px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45); text-align: center; }

.pp-mode-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
@media (max-width: 500px) { .pp-mode-grid { grid-template-columns: 1fr; } }
.pp-mode-card {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 8px; border-radius: 10px; cursor: pointer; text-align: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.7);
  transition: all 0.15s;
}
.pp-mode-card--active { border-color: #6366f1; background: rgba(99, 102, 241, 0.08); color: #6366f1; }
.pp-mode-name { font-size: 12px; font-weight: 600; }

.pp-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.pp-preset {
  padding: 6px 12px; border-radius: 8px; font-size: 13px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.7);
}
.pp-preset--active { border-color: #6366f1; background: rgba(99, 102, 241, 0.1); color: #6366f1; }

/* Task 3: multi-cashbox picker + per-cashbox blocks */
.pp-cb-multi { display: flex; flex-wrap: wrap; gap: 6px; }
.pp-cb-tag {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 999px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.pp-cb-tag:hover { border-color: rgba(99, 102, 241, 0.4); }
.pp-cb-tag--active { font-weight: 700; }

.pp-cb-block {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px; padding: 14px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.pp-cb-block-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.pp-cb-block-name { flex: 1; font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.pp-cb-block-remove {
  width: 28px; height: 28px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.pp-cb-block-remove:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
</style>
