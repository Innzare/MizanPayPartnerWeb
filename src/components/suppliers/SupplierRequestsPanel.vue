<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useSuppliersStore, type SupplierRequest, type SupplierRequestStatus } from '@/stores/suppliers'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDateShort } from '@/utils/formatters'
import SupplierRequestFormDialog from '@/components/SupplierRequestFormDialog.vue'

const store = useSuppliersStore()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const toast = useToast()

const canManage = computed(() => auth.can('suppliers.requests'))
const canCreateDeal = computed(() => auth.can('deals.create') || auth.isOwner)

type Tab = 'NEW' | 'CONVERTED' | 'REJECTED' | 'CANCELLED' | 'all'
const tab = ref<Tab>('all')
const loading = ref(false)
const rows = ref<SupplierRequest[]>([])

const formOpen = ref(false)
const editing = ref<SupplierRequest | null>(null)
const presetSupplier = ref<string | null>(null)

const kpi = ref({ new: 0, converted: 0, total: 0 })
async function loadKpi() {
  try {
    const all = await store.fetchRequests({ status: 'all' })
    kpi.value = {
      new: all.filter((r) => r.status === 'NEW').length,
      converted: all.filter((r) => r.status === 'CONVERTED').length,
      total: all.length,
    }
  } catch { /* ignore */ }
}

const search = ref('')
const displayRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((r) =>
    r.productName.toLowerCase().includes(q) ||
    (r.supplierName ?? '').toLowerCase().includes(q) ||
    (r.clientName ?? '').toLowerCase().includes(q) ||
    (r.clientPhone ?? '').toLowerCase().includes(q),
  )
})

const tabs: { key: Tab; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'NEW', label: 'Новые' },
  { key: 'CONVERTED', label: 'В сделках' },
  { key: 'REJECTED', label: 'Отклонённые' },
  { key: 'CANCELLED', label: 'Отменённые' },
]
const statusMeta: Record<SupplierRequestStatus, { label: string; cls: string }> = {
  NEW: { label: 'Новая', cls: 'st-new' },
  CONVERTED: { label: 'В сделке', cls: 'st-conv' },
  REJECTED: { label: 'Отклонена', cls: 'st-rej' },
  CANCELLED: { label: 'Отменена', cls: 'st-canc' },
}

async function reload() {
  loading.value = true
  try {
    rows.value = await store.fetchRequests({ status: tab.value })
    store.fetchRequestsCount()
    loadKpi()
  } finally {
    loading.value = false
  }
}
function setTab(t: Tab) { tab.value = t; reload() }

function openCreate() {
  editing.value = null
  presetSupplier.value = (route.query.supplierId as string) || null
  formOpen.value = true
}
function openEdit(r: SupplierRequest) { editing.value = r; presetSupplier.value = null; formOpen.value = true }
defineExpose({ openCreate })

async function onSaved() {
  toast.success(editing.value ? 'Заявка обновлена' : 'Заявка создана')
  await reload()
}

function convert(r: SupplierRequest) {
  router.push({ path: '/create-deal', query: { supplierRequestId: r.id, supplierId: r.supplierId } })
}

async function setStatus(r: SupplierRequest, status: 'NEW' | 'REJECTED' | 'CANCELLED') {
  try {
    await store.setRequestStatus(r.id, status)
    await reload()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось изменить статус')
  }
}

async function removeRequest(r: SupplierRequest) {
  if (!confirm(`Удалить заявку «${r.productName}»?`)) return
  try {
    await store.removeRequest(r.id)
    toast.success('Заявка удалена')
    await reload()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось удалить')
  }
}

onMounted(() => {
  if (route.query.supplierId) openCreate()
  reload()
})
</script>

<template>
  <div>
    <div class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59,130,246,0.1); color:#3b82f6;"><v-icon icon="mdi-bell-badge-outline" size="20" /></div>
        <div><div class="stat-value">{{ kpi.new }}</div><div class="stat-label">Новые заявки</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4,120,87,0.1); color:#047857;"><v-icon icon="mdi-file-check-outline" size="20" /></div>
        <div><div class="stat-value">{{ kpi.converted }}</div><div class="stat-label">Превращено в сделки</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(99,102,241,0.1); color:#6366f1;"><v-icon icon="mdi-clipboard-text-outline" size="20" /></div>
        <div><div class="stat-value">{{ kpi.total }}</div><div class="stat-label">Всего заявок</div></div>
      </div>
    </div>

    <div class="sup-card">
      <div class="pa-4">
        <div class="d-flex justify-space-between align-center ga-2 mb-3 flex-wrap">
          <div class="d-flex align-center ga-2 flex-wrap">
            <button
              v-for="t in tabs" :key="t.key"
              class="sup-chip" :class="{ active: tab === t.key }"
              @click="setTab(t.key)"
            >
              {{ t.label }}
              <span v-if="t.key === 'NEW' && store.requestsNewCount" class="req-chip-badge">{{ store.requestsNewCount }}</span>
            </button>
          </div>
          <div class="d-flex align-center ga-2 flex-wrap">
            <div class="sup-search">
              <v-icon icon="mdi-magnify" size="18" />
              <input v-model="search" type="text" placeholder="Поиск по товару, партнёру, клиенту…" />
            </div>
            <v-btn v-if="canManage" class="mz-btn-text" color="primary" variant="flat" rounded="lg" prepend-icon="mdi-plus" @click="openCreate">Новая заявка</v-btn>
          </div>
        </div>

        <div v-if="loading" class="d-flex justify-center pa-12"><v-progress-circular indeterminate color="primary" size="40" /></div>

        <v-table v-else-if="displayRows.length" density="comfortable" hover class="req-table">
        <thead>
          <tr>
            <th>Товар</th>
            <th>Партнёр</th>
            <th>Клиент</th>
            <th class="text-end">Цена</th>
            <th>Статус</th>
            <th class="text-no-wrap">Дата</th>
            <th class="text-end" style="width: 48px;"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in displayRows" :key="r.id">
            <td>
              <div class="font-weight-medium">{{ r.productName }}</div>
              <div v-if="r.comment" class="req-sub req-comment-cell">{{ r.comment }}</div>
            </td>
            <td>
              <div class="text-no-wrap">{{ r.supplierName || '—' }}</div>
              <div v-if="r.supplierCity" class="req-sub">{{ r.supplierCity }}</div>
            </td>
            <td>
              <template v-if="r.clientName">
                <div class="text-no-wrap">{{ r.clientName }}</div>
                <div v-if="r.clientPhone" class="req-sub text-no-wrap">{{ r.clientPhone }}</div>
              </template>
              <span v-else class="text-medium-emphasis">—</span>
            </td>
            <td class="text-end text-no-wrap">
              <span v-if="r.price != null">{{ formatCurrency(r.price) }}</span>
              <span v-else class="text-medium-emphasis">—</span>
            </td>
            <td><span class="req-status" :class="statusMeta[r.status].cls">{{ statusMeta[r.status].label }}</span></td>
            <td class="text-no-wrap req-sub">{{ formatDateShort(new Date(r.createdAt).toISOString()) }}</td>
            <td class="text-end">
              <router-link
                v-if="r.status === 'CONVERTED' && r.dealId"
                :to="`/deals/${r.dealId}`" class="req-deal-btn" title="Перейти к сделке"
              >
                <v-icon icon="mdi-file-document-outline" size="15" />
                <span>Сделка #{{ r.dealNumber }}</span>
                <v-icon icon="mdi-arrow-right" size="15" class="req-deal-btn-arrow" />
              </router-link>
              <v-menu v-else location="bottom end" :close-on-content-click="true">
                <template #activator="{ props }">
                  <button class="req-kebab" v-bind="props" title="Действия"><v-icon icon="mdi-dots-vertical" size="18" /></button>
                </template>
                <div class="req-menu">
                  <template v-if="r.status === 'NEW'">
                    <button v-if="canCreateDeal" class="req-menu-item" @click="convert(r)"><v-icon icon="mdi-plus" size="17" /> Создать сделку</button>
                    <button v-if="canManage" class="req-menu-item" @click="openEdit(r)"><v-icon icon="mdi-pencil-outline" size="17" /> Редактировать</button>
                    <button v-if="canManage" class="req-menu-item" @click="setStatus(r, 'REJECTED')"><v-icon icon="mdi-close-circle-outline" size="17" /> Отклонить</button>
                    <div v-if="canManage" class="req-menu-divider" />
                    <button v-if="canManage" class="req-menu-item req-menu-item--del" @click="removeRequest(r)"><v-icon icon="mdi-delete-outline" size="17" /> Удалить</button>
                  </template>
                  <template v-else-if="r.status === 'REJECTED' || r.status === 'CANCELLED'">
                    <button v-if="canManage" class="req-menu-item" @click="setStatus(r, 'NEW')"><v-icon icon="mdi-restore" size="17" /> Вернуть в работу</button>
                    <div v-if="canManage" class="req-menu-divider" />
                    <button v-if="canManage" class="req-menu-item req-menu-item--del" @click="removeRequest(r)"><v-icon icon="mdi-delete-outline" size="17" /> Удалить</button>
                  </template>
                </div>
              </v-menu>
            </td>
          </tr>
        </tbody>
        </v-table>

        <div v-else class="text-center pa-12">
          <v-icon icon="mdi-clipboard-text-outline" size="56" color="grey-lighten-1" class="mb-3" />
          <div class="text-h6 mb-1">{{ search ? 'Ничего не найдено' : 'Заявок нет' }}</div>
          <div class="text-body-2 text-medium-emphasis mb-4">
            {{ search ? 'Измените запрос или фильтр' : 'Поставщики предлагают товар — фиксируйте здесь и превращайте в сделки' }}
          </div>
          <v-btn v-if="canManage && !search" class="mz-btn-text" color="primary" variant="flat" rounded="lg" prepend-icon="mdi-plus" @click="openCreate">Новая заявка</v-btn>
        </div>
      </div>
    </div>

    <SupplierRequestFormDialog v-model="formOpen" :request="editing" :preset-supplier-id="presetSupplier" @saved="onSaved" />
  </div>
</template>

<style scoped>
.stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 760px) { .stats-row { grid-template-columns: 1fr; } }
.stat-card { display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-surface), 1); }
.stat-icon { width: 40px; height: 40px; min-width: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.stat-value { font-size: 18px; font-weight: 700; line-height: 1.2; }
.stat-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }

.sup-card { border-radius: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.08); background: rgba(var(--v-theme-surface), 1); overflow: hidden; }
.sup-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: transparent; font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; }
.sup-chip:hover { border-color: rgba(var(--v-theme-on-surface), 0.2); }
.sup-chip.active { border-color: rgba(4,120,87,0.5); color: #047857; font-weight: 600; background: rgba(4,120,87,0.06); }
.req-chip-badge { background: #ef4444; color: #fff; font-size: 11px; font-weight: 700; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; }
.sup-search { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); min-width: 360px; color: rgba(var(--v-theme-on-surface), 0.6); }
.sup-search input { flex: 1; border: none; background: none; outline: none; color: inherit; font-size: 14px; }
@media (max-width: 600px) { .sup-search { min-width: 0; width: 100%; } }

.req-table :deep(th) { font-size: 12px !important; text-transform: uppercase; letter-spacing: 0.03em; color: rgba(var(--v-theme-on-surface), 0.5) !important; }
.req-table :deep(tbody td) { height: 68px !important; padding-top: 12px !important; padding-bottom: 12px !important; }
.req-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.req-comment-cell { max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.req-status { font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 999px; white-space: nowrap; }
.st-new { background: rgba(59,130,246,0.12); color: #3b82f6; }
.st-conv { background: rgba(4,120,87,0.12); color: #047857; }
.st-rej { background: rgba(239,68,68,0.12); color: #ef4444; }
.st-canc { background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.5); }
.req-deal-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 9px;
  border: 1px solid rgba(4,120,87,0.28);
  background: rgba(4,120,87,0.08);
  color: #047857; font-size: 13px; font-weight: 600;
  text-decoration: none; white-space: nowrap; transition: all 0.15s;
}
.req-deal-btn:hover { background: rgba(4,120,87,0.15); border-color: rgba(4,120,87,0.5); }
.req-deal-btn-arrow { opacity: 0.7; transition: transform 0.15s; }
.req-deal-btn:hover .req-deal-btn-arrow { transform: translateX(2px); opacity: 1; }
.req-kebab { width: 34px; height: 34px; border-radius: 8px; border: none; background: transparent; color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.req-kebab:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.req-menu { background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.1); border-radius: 12px; padding: 6px; min-width: 190px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); }
.req-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border: none; background: none; border-radius: 8px; font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85); cursor: pointer; text-align: left; }
.req-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.req-menu-item--del { color: #ef4444; }
.req-menu-item--del:hover { background: rgba(239,68,68,0.1); }
.req-menu-divider { height: 1px; margin: 5px 8px; background: rgba(var(--v-theme-on-surface), 0.08); }
</style>
