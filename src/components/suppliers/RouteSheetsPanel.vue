<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useRouteSheetsStore, type RouteSheetStatus, type RouteSheetRow } from '@/stores/routeSheets'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDateShort } from '@/utils/formatters'
import RouteSheetFormDialog from '@/components/RouteSheetFormDialog.vue'

const store = useRouteSheetsStore()
const auth = useAuthStore()
const router = useRouter()
const toast = useToast()

const canManage = computed(() => auth.can('suppliers.routesheet'))

type Tab = 'all' | 'ISSUED' | 'COMPLETED' | 'CANCELLED'
const tab = ref<Tab>('all')
const formOpen = ref(false)
const search = ref('')

const editOpen = ref(false)
const editingId = ref<string | null>(null)
function openEdit(s: RouteSheetRow) { editingId.value = s.id; editOpen.value = true }
async function onEdited() { toast.success('Путевой лист обновлён'); reload() }
async function removeSheet(s: RouteSheetRow) {
  if (!confirm(`Удалить путевой лист №${s.number}?`)) return
  try {
    await store.remove(s.id)
    toast.success('Путевой лист удалён')
    reload()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось удалить')
  }
}

const tabs: { key: Tab; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'ISSUED', label: 'В работе' },
  { key: 'COMPLETED', label: 'Завершённые' },
  { key: 'CANCELLED', label: 'Отменённые' },
]
const statusMeta: Record<RouteSheetStatus, { label: string; cls: string }> = {
  ISSUED: { label: 'В работе', cls: 'st-issued' },
  COMPLETED: { label: 'Завершён', cls: 'st-done' },
  CANCELLED: { label: 'Отменён', cls: 'st-canc' },
}

const kpi = ref({ inWork: 0, total: 0, paid: 0 })
async function loadKpi() {
  try {
    const all = await api.get<RouteSheetRow[]>('/route-sheets')
    kpi.value = {
      inWork: all.filter((s) => s.status === 'ISSUED').length,
      total: all.length,
      paid: all.reduce((a, s) => a + s.totalPaid, 0),
    }
  } catch { /* ignore */ }
}

const displayRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return store.rows
  return store.rows.filter((s) =>
    String(s.number).includes(q) ||
    (s.assignedStaffName ?? '').toLowerCase().includes(q) ||
    (s.note ?? '').toLowerCase().includes(q),
  )
})

function reload() {
  store.fetchList(tab.value === 'all' ? undefined : tab.value)
  loadKpi()
}
function setTab(t: Tab) { tab.value = t; reload() }
function open(id: string) { router.push(`/suppliers/route-sheets/${id}`) }
function onCreated(id: string) { open(id) }
function openCreate() { formOpen.value = true }
defineExpose({ openCreate })

onMounted(reload)
</script>

<template>
  <div>
    <div class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59,130,246,0.1); color:#3b82f6;"><v-icon icon="mdi-truck-fast-outline" size="20" /></div>
        <div><div class="stat-value">{{ kpi.inWork }}</div><div class="stat-label">Листов в работе</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4,120,87,0.1); color:#047857;"><v-icon icon="mdi-cash-check" size="20" /></div>
        <div><div class="stat-value">{{ formatCurrency(kpi.paid) }}</div><div class="stat-label">Выплачено по листам</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(99,102,241,0.1); color:#6366f1;"><v-icon icon="mdi-clipboard-list-outline" size="20" /></div>
        <div><div class="stat-value">{{ kpi.total }}</div><div class="stat-label">Всего листов</div></div>
      </div>
    </div>

    <div class="sup-card">
      <div class="pa-4">
        <div class="d-flex justify-space-between align-center ga-2 mb-3 flex-wrap">
          <div class="d-flex align-center ga-2 flex-wrap">
            <button v-for="t in tabs" :key="t.key" class="sup-chip" :class="{ active: tab === t.key }" @click="setTab(t.key)">{{ t.label }}</button>
          </div>
          <div class="d-flex align-center ga-2 flex-wrap">
            <div class="sup-search">
              <v-icon icon="mdi-magnify" size="18" />
              <input v-model="search" type="text" placeholder="Поиск по номеру, сотруднику, заметке…" />
            </div>
            <v-btn v-if="canManage" class="mz-btn-text" color="primary" variant="flat" rounded="lg" prepend-icon="mdi-plus" @click="formOpen = true">Сформировать</v-btn>
          </div>
        </div>

        <div v-if="store.loading" class="d-flex justify-center pa-12"><v-progress-circular indeterminate color="primary" size="40" /></div>

        <v-table v-else-if="displayRows.length" density="comfortable" hover class="rs-table">
          <thead>
            <tr>
              <th style="width: 70px;">№</th>
              <th>Статус</th>
              <th class="text-no-wrap">Дата</th>
              <th>Ответственный</th>
              <th class="text-center">Поставщиков</th>
              <th class="text-end">К оплате / долг</th>
              <th v-if="canManage" class="text-end" style="width: 48px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in displayRows" :key="s.id" class="cursor-pointer" @click="open(s.id)">
              <td class="font-weight-bold">№{{ s.number }}</td>
              <td><span class="rs-status" :class="statusMeta[s.status].cls">{{ statusMeta[s.status].label }}</span></td>
              <td class="text-no-wrap rs-sub">{{ formatDateShort(new Date(s.date).toISOString()) }}</td>
              <td class="text-no-wrap">{{ s.assignedStaffName || '—' }}</td>
              <td class="text-center text-no-wrap">{{ s.paidLinesCount }}/{{ s.linesCount }}</td>
              <td class="text-end text-no-wrap">
                <div><span class="rs-sum">{{ formatCurrency(s.totalPlanned) }}</span><span class="rs-sub"> из {{ formatCurrency(s.totalDebt) }}</span></div>
                <div v-if="s.totalPaid > 0" class="rs-sub">оплачено {{ formatCurrency(s.totalPaid) }}</div>
              </td>
              <td v-if="canManage" class="text-end" @click.stop>
                <v-menu location="bottom end" :close-on-content-click="true">
                  <template #activator="{ props }">
                    <button class="rs-kebab" v-bind="props" title="Действия"><v-icon icon="mdi-dots-vertical" size="18" /></button>
                  </template>
                  <div class="rs-menu">
                    <button class="rs-menu-item" @click="openEdit(s)"><v-icon icon="mdi-pencil-outline" size="17" /> Редактировать</button>
                    <div class="rs-menu-divider" />
                    <button class="rs-menu-item rs-menu-item--del" @click="removeSheet(s)"><v-icon icon="mdi-delete-outline" size="17" /> Удалить</button>
                  </div>
                </v-menu>
              </td>
            </tr>
          </tbody>
        </v-table>

        <div v-else class="text-center pa-12">
          <v-icon icon="mdi-clipboard-list-outline" size="56" color="grey-lighten-1" class="mb-3" />
          <div class="text-h6 mb-1">{{ search ? 'Ничего не найдено' : 'Путевых листов нет' }}</div>
          <div class="text-body-2 text-medium-emphasis mb-4">
            {{ search ? 'Измените запрос или фильтр' : 'Сформируйте маршрут для сотрудника: кому и сколько отвезти' }}
          </div>
          <v-btn v-if="canManage && !search" class="mz-btn-text" color="primary" variant="flat" rounded="lg" prepend-icon="mdi-plus" @click="formOpen = true">Сформировать</v-btn>
        </div>
      </div>
    </div>

    <RouteSheetFormDialog v-model="formOpen" @created="onCreated" />
    <RouteSheetFormDialog v-model="editOpen" :edit-id="editingId" @saved="onEdited" />
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
.sup-search { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); min-width: 360px; color: rgba(var(--v-theme-on-surface), 0.6); }
.sup-search input { flex: 1; border: none; background: none; outline: none; color: inherit; font-size: 14px; }
@media (max-width: 600px) { .sup-search { min-width: 0; width: 100%; } }

.rs-table :deep(th) { font-size: 12px !important; text-transform: uppercase; letter-spacing: 0.03em; color: rgba(var(--v-theme-on-surface), 0.5) !important; }
.rs-table :deep(tbody td) { height: 64px !important; padding-top: 12px !important; padding-bottom: 12px !important; }
.rs-status { font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 999px; white-space: nowrap; }
.st-issued { background: rgba(59,130,246,0.12); color: #3b82f6; }
.st-done { background: rgba(4,120,87,0.12); color: #047857; }
.st-canc { background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.5); }
.rs-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.rs-sum { font-size: 14px; font-weight: 700; color: #047857; }
.rs-note-cell { max-width: 220px; margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-kebab { width: 34px; height: 34px; border-radius: 8px; border: none; background: transparent; color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.rs-kebab:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.rs-menu { background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.1); border-radius: 12px; padding: 6px; min-width: 180px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); }
.rs-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border: none; background: none; border-radius: 8px; font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85); cursor: pointer; text-align: left; }
.rs-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.rs-menu-item--del { color: #ef4444; }
.rs-menu-item--del:hover { background: rgba(239,68,68,0.1); }
.rs-menu-divider { height: 1px; margin: 5px 8px; background: rgba(var(--v-theme-on-surface), 0.08); }
</style>
