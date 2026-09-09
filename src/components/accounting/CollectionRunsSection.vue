<script lang="ts" setup>
import { useAccountingStore } from '@/stores/accounting'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { api } from '@/api/client'
import { formatCurrency } from '@/utils/formatters'
import type { CollectionRunStatus } from '@/stores/accounting'
import type { StaffMember } from '@/types'

/**
 * Инкассация: рейсы по пунктам приёма.
 *
 * Инкассатор видит здесь задание на день, партнёр — все рейсы и кнопку
 * планирования.
 *
 * Раньше это был отдельный пункт меню. Рейс — продолжение той же истории, что
 * и остаток в пункте, поэтому секция живёт на вкладке «Пункты приёма» в
 * «Бухгалтерии»: сначала где деньги лежат, следом — кто и когда за ними едет.
 */

const store = useAccountingStore()
const auth = useAuthStore()
const toast = useToast()
const router = useRouter()

const canPlan = computed(() => auth.can('collections.plan'))

const TABS: Array<{ key: string; label: string; status?: CollectionRunStatus }> = [
  { key: 'active', label: 'В работе' },
  { key: 'delivered', label: 'Сданные', status: 'DELIVERED' },
  { key: 'all', label: 'Все' },
]
const activeTab = ref('active')

const loading = ref(false)
const items = computed(() => {
  if (activeTab.value === 'active') {
    return store.runs.filter((r) => r.status === 'PLANNED' || r.status === 'IN_PROGRESS')
  }
  if (activeTab.value === 'delivered') return store.runs.filter((r) => r.status === 'DELIVERED')
  return store.runs
})

const STATUS: Record<CollectionRunStatus, { label: string; color: string }> = {
  PLANNED: { label: 'Запланирован', color: '#6b7280' },
  IN_PROGRESS: { label: 'В пути', color: '#f59e0b' },
  DELIVERED: { label: 'Сдан', color: '#10b981' },
  CANCELLED: { label: 'Отменён', color: '#ef4444' },
}

async function load() {
  loading.value = true
  try {
    await store.fetchRuns()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить рейсы')
  } finally {
    loading.value = false
  }
}

// ── Планирование ──
const planDialog = ref(false)
const staff = ref<StaffMember[]>([])
const planForm = ref({ collectorStaffId: '', collectorAccountId: '', accountIds: [] as string[], note: '' })
const planSaving = ref(false)

const cashAccounts = computed(() => store.accounts.filter((a) => a.type === 'CASH'))
const points = computed(() => store.accounts.filter((a) => a.type === 'PAYMENT_POINT'))
const plannedTotal = computed(() =>
  points.value
    .filter((p) => planForm.value.accountIds.includes(p.id))
    .reduce((s, p) => s + (p.balance ?? 0), 0),
)

async function openPlan() {
  planForm.value = { collectorStaffId: '', collectorAccountId: '', accountIds: [], note: '' }
  planDialog.value = true
  if (!store.accounts.length) await store.fetchAccounts().catch(() => {})
  if (!staff.value.length) {
    staff.value = await api.get<StaffMember[]>('/auth/investor/staff').catch(() => [])
  }
  // Пункты с деньгами предлагаем сразу: за пустыми ехать незачем.
  planForm.value.accountIds = points.value.filter((p) => (p.balance ?? 0) > 0).map((p) => p.id)
}

/** Инкассатором может быть любой сотрудник, кроме оператора пункта. */
const collectors = computed(() => staff.value.filter((s) => s.isActive && s.role !== 'POINT_OPERATOR'))

async function savePlan() {
  planSaving.value = true
  try {
    const run = await store.createRun({
      collectorStaffId: planForm.value.collectorStaffId,
      collectorAccountId: planForm.value.collectorAccountId,
      accountIds: planForm.value.accountIds,
      note: planForm.value.note || undefined,
    })
    planDialog.value = false
    toast.success(`Рейс №${run.number} создан`)
    router.push(`/collections/${run.id}`)
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось создать рейс')
  } finally {
    planSaving.value = false
  }
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

onMounted(() => {
  load()
  if (!store.accounts.length) store.fetchAccounts().catch(() => {})
})

</script>

<template>
  <div class="cl-section">
    <!-- Табы раздела здесь заняты «Бухгалтерией», поэтому свой фильтр — чипами. -->
    <div class="cl-head">
      <div>
        <div class="cl-title">Инкассация</div>
        <div class="cl-hint">Кто едет за наличными и что уже сдано в офис</div>
      </div>
      <div class="cl-head-actions">
        <div class="cl-chips">
          <button
            v-for="t in TABS"
            :key="t.key"
            class="fb-btn"
            :class="{ 'fb-btn--active': activeTab === t.key }"
            @click="activeTab = t.key"
          >
            {{ t.label }}
          </button>
        </div>
        <v-btn v-if="canPlan" color="primary" prepend-icon="mdi-plus" @click="openPlan">Спланировать рейс</v-btn>
      </div>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-3" />

    <!-- Список не бесконечный: честно говорим, что видно, а не молчим. -->
    <div v-if="store.runs.length >= 50" class="text-caption text-medium-emphasis mb-2">
      Показаны последние 50 рейсов
    </div>

    <div v-if="!loading && !items.length" class="text-center pa-12">
      <v-icon icon="mdi-truck-outline" size="56" color="grey-lighten-1" class="mb-3" />
      <div class="text-h6 mb-1">Рейсов пока нет</div>
      <div class="text-body-2 text-medium-emphasis">
        Рейс — это список пунктов, куда едет инкассатор, и сдача выручки в офис
      </div>
    </div>

    <div class="d-flex flex-column ga-2">
      <v-card
        v-for="r in items"
        :key="r.id"
        flat
        class="cl-row"
        @click="router.push(`/collections/${r.id}`)"
      >
        <div class="d-flex align-center ga-4">
          <div class="cl-num">№{{ r.number }}</div>
          <div class="flex-grow-1 min-w-0">
            <div class="d-flex align-center ga-2">
              <span class="font-weight-bold">{{ r.collectorName }}</span>
              <span class="cl-badge" :style="{ color: STATUS[r.status].color, borderColor: STATUS[r.status].color + '55' }">
                {{ STATUS[r.status].label }}
              </span>
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ dateLabel(r.date) }} · пункты {{ r.stopsDone }} из {{ r.stopsTotal }}
            </div>
          </div>
          <div class="text-right">
            <div class="font-weight-bold">{{ formatCurrency(r.receivedTotal || r.expectedTotal) }}</div>
            <div class="text-caption text-medium-emphasis">
              {{ r.receivedTotal ? 'принято' : 'ожидается' }}
            </div>
          </div>
          <v-icon icon="mdi-chevron-right" class="text-medium-emphasis" />
        </div>
      </v-card>
    </div>

    <!-- Планирование рейса -->
    <v-dialog v-model="planDialog" max-width="560">
      <v-card class="pa-6">
        <div class="text-h6 mb-4">Спланировать рейс</div>

        <v-select
          v-model="planForm.collectorStaffId"
          :items="collectors"
          :item-title="(s: StaffMember) => `${s.firstName} ${s.lastName}`"
          item-value="id"
          label="Кто едет"
          variant="outlined"
          density="comfortable"
          hide-details
          class="mb-3"
        />

        <v-select
          v-model="planForm.collectorAccountId"
          :items="cashAccounts"
          item-title="name"
          item-value="id"
          label="Куда складывает наличные"
          variant="outlined"
          density="comfortable"
          hide-details
          class="mb-1"
        />
        <div class="text-caption text-medium-emphasis mb-4">
          Наличный счёт инкассатора — пока деньги в пути, они числятся на нём
        </div>

        <div class="cl-label mb-2">Пункты</div>
        <div v-if="points.length" class="cl-points mb-4">
          <label v-for="p in points" :key="p.id" class="cl-point">
            <input type="checkbox" :value="p.id" v-model="planForm.accountIds" />
            <span class="flex-grow-1">{{ p.name }}</span>
            <span class="text-medium-emphasis">{{ formatCurrency(p.balance ?? 0) }}</span>
          </label>
        </div>
        <div v-else class="text-body-2 text-medium-emphasis mb-4">
          Пунктов приёма нет — заведите счёт типа «Пункт приёма» в «Бухгалтерии»
        </div>

        <div class="d-flex align-center ga-2">
          <div class="text-body-2 text-medium-emphasis">К сбору</div>
          <div class="text-h6 font-weight-bold">{{ formatCurrency(plannedTotal) }}</div>
          <v-spacer />
          <v-btn variant="text" @click="planDialog = false">Отмена</v-btn>
          <v-btn
            color="primary"
            :loading="planSaving"
            :disabled="!planForm.collectorStaffId || !planForm.collectorAccountId || !planForm.accountIds.length"
            @click="savePlan"
          >
            Создать
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.cl-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.cl-title {
  font-size: 17px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.cl-hint {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}
.cl-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cl-chips { display: flex; gap: 6px; flex-wrap: wrap; }

/* Кнопки-фильтры — канон со страницы «Сделки». */
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
.dark .fb-btn {
  background: rgb(var(--v-theme-surface-elevated)); border-color: rgb(var(--v-theme-border));
}

.cl-row {
  padding: 14px 18px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
  cursor: pointer;
}
.cl-row:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
}
.cl-num {
  font-size: 15px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);
  min-width: 46px;
}
.cl-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border: 1px solid;
  border-radius: 20px;
}
.cl-label {
  font-size: 13px;
  font-weight: 600;
}
.cl-points {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}
.cl-point {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
}
</style>
