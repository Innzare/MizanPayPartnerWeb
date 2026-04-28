<script setup lang="ts">
import { useDealsStore } from '@/stores/deals'
import { usePaymentsStore } from '@/stores/payments'
import { formatCurrency, formatDate, formatDateShort, formatPercent, timeAgo } from '@/utils/formatters'
import { DEAL_STATUS_CONFIG, PAYMENT_STATUS_CONFIG } from '@/constants/statuses'
import { type Deal, type DealFolder, userName, clientProfileName } from '@/types'
import { useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { useFolders } from '@/composables/useFolders'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'

const router = useRouter()
const { isDark, statusStyle } = useIsDark()
const toast = useToast()
const dealsStore = useDealsStore()
const authStore = useAuthStore()
const paymentsStore = usePaymentsStore()
const { folders, fetchFolders, createFolder, updateFolder, deleteFolder, moveDeal, moveBatch } = useFolders()

// Folders
const activeFolder = ref<string | null>(null) // null = all

// Co-investor filter — null = all deals (regardless of CI link)
const activeCoInvestor = ref<string | null>(null)
const { coInvestors: ciList, fetchCoInvestors } = useCoInvestors()
fetchCoInvestors()
const activeCoInvestorObj = computed(() =>
  activeCoInvestor.value ? ciList.value.find((c) => c.id === activeCoInvestor.value) ?? null : null,
)

// Staff assignee filter — partner-only. null = all deals.
interface StaffOption { id: string; firstName: string; lastName: string; isActive: boolean }
const staffList = ref<StaffOption[]>([])
const activeStaff = ref<string | null>(null)
async function loadStaffList() {
  if (!authStore.isOwner) return
  try {
    const list = await api.get<StaffOption[]>('/auth/investor/staff')
    staffList.value = list.filter((s) => s.isActive)
  } catch { /* ignore */ }
}
loadStaffList()
const activeStaffObj = computed(() =>
  activeStaff.value ? staffList.value.find((s) => s.id === activeStaff.value) ?? null : null,
)
const showFolderDialog = ref(false)
const editingFolder = ref<DealFolder | null>(null)
const folderForm = ref({ name: '', color: '#6366f1', icon: 'mdi-folder' })
const folderSaving = ref(false)
const showMoveMenu = ref(false)

const FOLDER_COLORS = ['#6366f1', '#3b82f6', '#0ea5e9', '#10b981', '#047857', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b']

function openCreateFolder() {
  editingFolder.value = null
  folderForm.value = { name: '', color: '#6366f1', icon: 'mdi-folder' }
  showFolderDialog.value = true
}

function openEditFolder(folder: DealFolder) {
  editingFolder.value = folder
  folderForm.value = { name: folder.name, color: folder.color, icon: folder.icon }
  showFolderDialog.value = true
}

async function saveFolder() {
  if (!folderForm.value.name.trim()) return toast.error('Укажите название')
  folderSaving.value = true
  try {
    if (editingFolder.value) {
      await updateFolder(editingFolder.value.id, folderForm.value)
      toast.success('Папка обновлена')
    } else {
      await createFolder(folderForm.value)
      toast.success('Папка создана')
    }
    showFolderDialog.value = false
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  } finally { folderSaving.value = false }
}

async function handleDeleteFolder(folder: DealFolder) {
  if (!confirm(`Удалить папку «${folder.name}»? Сделки не удалятся.`)) return
  try {
    await deleteFolder(folder.id)
    if (activeFolder.value === folder.id) activeFolder.value = null
    toast.success('Папка удалена')
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
}

async function moveSelectedToFolder(folderId: string | null) {
  const ids = Array.from(selectedIds.value)
  if (!ids.length) return
  try {
    await moveBatch(ids, folderId)
    await dealsStore.fetchDeals()
    selectedIds.value = new Set()
    showMoveMenu.value = false
    toast.success(`${ids.length} сделок перемещено`)
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
}

async function handleMoveSingle(dealId: string, folderId: string | null) {
  try {
    await moveDeal(dealId, folderId)
    await Promise.all([dealsStore.fetchDeals(), fetchFolders()])
    toast.success(folderId ? 'Сделка перемещена' : 'Сделка убрана из папки')
  } catch (e: any) { toast.error(e.message || 'Ошибка') }
}

const pageLoading = ref(true)

onMounted(async () => {
  try {
    await Promise.all([
      dealsStore.fetchDeals(),
      paymentsStore.fetchPayments(),
      dealsStore.fetchTrash(),
      fetchFolders(),
    ])
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки сделок')
  } finally {
    pageLoading.value = false
  }
})

const tab = ref(0)
const viewMode = ref<'grid' | 'table'>('table')
const search = ref('')
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const deleting = ref(false)

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
  selectedIds.value = new Set(selectedIds.value) // trigger reactivity
}

function selectAll() {
  if (selectedIds.value.size === displayedDeals.value.length) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(displayedDeals.value.map(d => d.id))
  }
}

function cancelSelect() {
  selectMode.value = false
  selectedIds.value = new Set()
}

async function deleteSelected() {
  if (!selectedIds.value.size) return
  if (!confirm(`Переместить ${selectedIds.value.size} сделок в корзину?`)) return

  deleting.value = true
  try {
    const result = await api.post<{ deleted: number; total: number }>('/deals/delete-batch', {
      ids: Array.from(selectedIds.value),
    })
    toast.success(`${result.deleted} сделок перемещено в корзину`)
    await dealsStore.fetchDeals()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }

  cancelSelect()
  deleting.value = false
}

async function restoreSelected() {
  if (!selectedIds.value.size) return
  deleting.value = true
  try {
    await dealsStore.restoreBatch(Array.from(selectedIds.value))
    toast.success(`${selectedIds.value.size} сделок восстановлено`)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка восстановления')
  }
  cancelSelect()
  deleting.value = false
}

async function emptyTrash() {
  if (!confirm('Удалить все сделки из корзины навсегда? Это действие необратимо.')) return
  deleting.value = true
  try {
    await dealsStore.emptyTrash()
    toast.success('Корзина очищена')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка очистки')
  }
  deleting.value = false
}

async function restoreOne(id: string) {
  try {
    await dealsStore.restoreDeal(id)
    toast.success('Сделка восстановлена')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка восстановления')
  }
}

async function permanentDeleteOne(id: string) {
  if (!confirm('Удалить сделку навсегда? Это действие необратимо.')) return
  try {
    await dealsStore.permanentDelete(id)
    toast.success('Сделка удалена навсегда')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
}

async function permanentDeleteSelected() {
  if (!selectedIds.value.size) return
  if (!confirm(`Удалить ${selectedIds.value.size} сделок навсегда? Это действие необратимо.`)) return
  deleting.value = true
  try {
    for (const id of selectedIds.value) {
      await dealsStore.permanentDelete(id)
    }
    toast.success(`Удалено навсегда`)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка удаления')
  }
  cancelSelect()
  deleting.value = false
}
const selectedDeal = ref<Deal | null>(null)
const showDialog = ref(false)
const sortBy = ref<'newest' | 'amount_desc' | 'amount_asc' | 'progress'>('newest')

const tabFilters = [
  { label: 'Активные', key: 'active' },
  { label: 'Завершённые', key: 'completed' },
  { label: 'Все', key: 'all' },
  { label: 'Корзина', key: 'trash' },
]

const sortOptions = [
  { title: 'Новые', value: 'newest' },
  { title: 'Сумма ↓', value: 'amount_desc' },
  { title: 'Сумма ↑', value: 'amount_asc' },
  { title: 'По прогрессу', value: 'progress' },
]

const isTrashTab = computed(() => tab.value === 3)

const baseDeals = computed(() => {
  switch (tab.value) {
    case 0: return dealsStore.activeDeals
    case 1: return dealsStore.completedDeals
    case 2: return dealsStore.investorDeals
    case 3: return dealsStore.trash
    default: return dealsStore.investorDeals
  }
})

watch(tab, (v) => {
  if (v === 3 && !dealsStore.trash.length) {
    dealsStore.fetchTrash()
  }
})

const displayedDeals = computed(() => {
  let result = [...baseDeals.value]

  // Folder filter
  if (activeFolder.value) {
    result = result.filter(d => d.folderId === activeFolder.value)
  }

  // Co-investor filter
  if (activeCoInvestor.value) {
    result = result.filter(d =>
      d.coInvestors?.some(link => link.coInvestor.id === activeCoInvestor.value),
    )
  }

  // Staff assignee filter
  if (activeStaff.value) {
    result = result.filter(d => (d as any).assignedStaffId === activeStaff.value)
  }

  if (search.value) {
    const s = search.value.toLowerCase()
    result = result.filter(d =>
      d.productName.toLowerCase().includes(s) ||
      dealClientName(d).toLowerCase().includes(s)
    )
  }

  switch (sortBy.value) {
    case 'newest': result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); break
    case 'amount_desc': result.sort((a, b) => b.totalPrice - a.totalPrice); break
    case 'amount_asc': result.sort((a, b) => a.totalPrice - b.totalPrice); break
    case 'progress': result.sort((a, b) => {
      const pa = a.numberOfPayments > 0 ? a.paidPayments / a.numberOfPayments : 0
      const pb = b.numberOfPayments > 0 ? b.paidPayments / b.numberOfPayments : 0
      return pb - pa
    }); break
  }

  return result
})

// Summary stats for current tab
const tabStats = computed(() => {
  const deals = baseDeals.value
  const totalVolume = deals.reduce((s, d) => s + d.totalPrice, 0)
  const totalProfit = deals.reduce((s, d) => s + d.markup, 0)
  const totalRemaining = deals.reduce((s, d) => s + d.remainingAmount, 0)
  return { count: deals.length, totalVolume, totalProfit, totalRemaining }
})

function getDealProgress(deal: Deal) {
  return deal.numberOfPayments > 0 ? (deal.paidPayments / deal.numberOfPayments) * 100 : 0
}

function dealClientName(deal: Deal) {
  if (deal.client) return userName(deal.client)
  if (deal.clientProfile) return clientProfileName(deal.clientProfile)
  return deal.externalClientName || '—'
}

function openDeal(deal: Deal) {
  selectedDeal.value = deal
  showDialog.value = true
}

function goToDeal(deal: Deal) {
  router.push(`/deals/${deal.id}`)
}

const selectedDealPayments = computed(() => {
  if (!selectedDeal.value) return []
  return paymentsStore.getPaymentsForDeal(selectedDeal.value.id)
})

const selectedDealPaidTotal = computed(() =>
  selectedDealPayments.value.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0)
)
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Page loader -->
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
    <!-- Summary Cards -->
    <div class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-briefcase" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ tabStats.count }}</div>
          <div class="stat-label">Сделок</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
          <v-icon icon="mdi-cash-multiple" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(tabStats.totalVolume) }}</div>
          <div class="stat-label">Общий объём</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
          <v-icon icon="mdi-trending-up" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(tabStats.totalProfit) }}</div>
          <div class="stat-label">Прибыль</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
          <v-icon icon="mdi-clock-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(tabStats.totalRemaining) }}</div>
          <div class="stat-label">Остаток к получению</div>
        </div>
      </div>
    </div>

    <!-- Filters row (top right, above main card): folder + co-investor -->
    <div v-if="!isTrashTab" class="d-flex justify-end ga-2 mb-3 flex-wrap">
      <!-- Co-investor filter -->
      <v-menu v-if="ciList.length > 0" :close-on-content-click="true">
        <template #activator="{ props: mp }">
          <button v-bind="mp" class="fb-btn" :class="{ 'fb-btn--active': activeCoInvestor }">
            <v-icon icon="mdi-account-group-outline" size="16" />
            <template v-if="activeCoInvestorObj">
              {{ activeCoInvestorObj.name }}
            </template>
            <template v-else>
              Со-инвестор
            </template>
            <v-icon icon="mdi-chevron-down" size="14" style="opacity: 0.4;" />
          </button>
        </template>
        <v-card rounded="lg" elevation="4" class="fb-dropdown">
          <div class="fb-dropdown-header">
            <span>Со-инвесторы</span>
          </div>
          <div class="fb-dropdown-body">
            <button class="fb-item" :class="{ 'fb-item--active': !activeCoInvestor }" @click="activeCoInvestor = null">
              <v-icon icon="mdi-view-list" size="18" style="color: rgba(var(--v-theme-on-surface), 0.35);" />
              <span class="fb-item-name">Все сделки</span>
            </button>
            <div class="fb-divider" />
            <button
              v-for="ci in ciList"
              :key="ci.id"
              class="fb-item"
              :class="{ 'fb-item--active': activeCoInvestor === ci.id }"
              @click="activeCoInvestor = activeCoInvestor === ci.id ? null : ci.id"
            >
              <v-icon icon="mdi-account-outline" size="14" style="color: rgba(var(--v-theme-on-surface), 0.45);" />
              <span class="fb-item-name">{{ ci.name }}</span>
              <span class="fb-item-count">{{ ci.profitPercent }}%</span>
            </button>
          </div>
        </v-card>
      </v-menu>

      <!-- Staff assignee filter -->
      <v-menu v-if="authStore.isOwner && staffList.length > 0" :close-on-content-click="true">
        <template #activator="{ props: mp }">
          <button v-bind="mp" class="fb-btn" :class="{ 'fb-btn--active': activeStaff }">
            <v-icon icon="mdi-account-tie-outline" size="16" />
            <template v-if="activeStaffObj">
              {{ activeStaffObj.firstName }} {{ activeStaffObj.lastName }}
            </template>
            <template v-else>
              Сотрудник
            </template>
            <v-icon icon="mdi-chevron-down" size="14" style="opacity: 0.4;" />
          </button>
        </template>
        <v-card rounded="lg" elevation="4" class="fb-dropdown">
          <div class="fb-dropdown-header">
            <span>Ответственные</span>
          </div>
          <div class="fb-dropdown-body">
            <button class="fb-item" :class="{ 'fb-item--active': !activeStaff }" @click="activeStaff = null">
              <v-icon icon="mdi-view-list" size="18" style="color: rgba(var(--v-theme-on-surface), 0.35);" />
              <span class="fb-item-name">Все сделки</span>
            </button>
            <div class="fb-divider" />
            <button
              v-for="s in staffList"
              :key="s.id"
              class="fb-item"
              :class="{ 'fb-item--active': activeStaff === s.id }"
              @click="activeStaff = activeStaff === s.id ? null : s.id"
            >
              <v-icon icon="mdi-account-outline" size="14" style="color: rgba(var(--v-theme-on-surface), 0.45);" />
              <span class="fb-item-name">{{ s.firstName }} {{ s.lastName }}</span>
            </button>
          </div>
        </v-card>
      </v-menu>

      <!-- Folder filter -->
      <v-menu :close-on-content-click="false">
        <template #activator="{ props: mp }">
          <button v-bind="mp" class="fb-btn" :class="{ 'fb-btn--active': activeFolder }">
            <v-icon icon="mdi-folder-outline" size="16" />
            <template v-if="activeFolder">
              <span class="fb-dot" :style="{ background: folders.find(f => f.id === activeFolder)?.color || '#6366f1' }" />
              {{ folders.find(f => f.id === activeFolder)?.name || 'Папка' }}
            </template>
            <template v-else>
              Папки
            </template>
            <v-icon icon="mdi-chevron-down" size="14" style="opacity: 0.4;" />
          </button>
        </template>
        <v-card rounded="lg" elevation="4" class="fb-dropdown">
          <div class="fb-dropdown-header">
            <span>Папки</span>
            <button class="fb-dropdown-add" @click="openCreateFolder">
              <v-icon icon="mdi-plus" size="14" />
              Создать
            </button>
          </div>

          <div class="fb-dropdown-body">
            <!-- All deals -->
            <button class="fb-item" :class="{ 'fb-item--active': !activeFolder }" @click="activeFolder = null">
              <v-icon icon="mdi-view-list" size="18" style="color: rgba(var(--v-theme-on-surface), 0.35);" />
              <span class="fb-item-name">Все сделки</span>
              <span class="fb-item-count">{{ dealsStore.investorDeals.length }}</span>
            </button>

            <div v-if="folders.length" class="fb-divider" />

            <!-- Folder list -->
            <button
              v-for="f in folders" :key="f.id"
              class="fb-item" :class="{ 'fb-item--active': activeFolder === f.id }"
              @click="activeFolder = activeFolder === f.id ? null : f.id"
            >
              <span class="fb-item-dot" :style="{ background: f.color }" />
              <span class="fb-item-name">{{ f.name }}</span>
              <span class="fb-item-edit" role="button" @click.stop="openEditFolder(f)" title="Редактировать">
                <v-icon icon="mdi-pencil-outline" size="12" />
              </span>
              <span class="fb-item-count">{{ f._count?.deals || 0 }}</span>
            </button>

            <!-- No folders hint -->
            <div v-if="!folders.length" class="fb-empty">
              <div style="font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.35);">Нет папок</div>
              <div style="font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.25);">Создайте папку для группировки</div>
            </div>
          </div>
        </v-card>
      </v-menu>
    </div>

    <!-- Main card -->
    <v-card rounded="lg" elevation="0" border>
      <div class="pa-4">
        <!-- Tabs + toolbar -->
        <div class="d-flex flex-wrap ga-2 align-center mb-4">
          <div class="d-flex ga-2">
            <button
              v-for="(f, i) in tabFilters"
              :key="f.key"
              class="tab-btn"
              :class="{ active: tab === i }"
              @click="tab = i"
            >
              {{ f.label }}
              <span class="tab-count">{{ i === 0 ? dealsStore.activeDeals.length : i === 1 ? dealsStore.completedDeals.length : i === 2 ? dealsStore.investorDeals.length : dealsStore.trash.length }}</span>
            </button>
          </div>

          <v-spacer class="d-none d-md-block" />

          <!-- Move to folder (batch) -->
          <v-menu v-if="selectedIds.size > 0" v-model="showMoveMenu" location="bottom">
            <template #activator="{ props: menuProps }">
              <button v-bind="menuProps" class="folder-move-btn">
                <v-icon icon="mdi-folder-arrow-right" size="16" />
                В папку
              </button>
            </template>
            <v-card rounded="lg" elevation="3" min-width="200" class="pa-1">
              <button class="folder-menu-item" @click="moveSelectedToFolder(null)">
                <v-icon icon="mdi-folder-remove-outline" size="16" color="grey" />
                Без папки
              </button>
              <div v-if="folders.length" style="height: 1px; background: rgba(var(--v-theme-on-surface), 0.06); margin: 4px 8px;" />
              <button v-for="f in folders" :key="f.id" class="folder-menu-item" @click="moveSelectedToFolder(f.id)">
                <span class="folder-chip-dot" :style="{ background: f.color }" />
                {{ f.name }}
              </button>
            </v-card>
          </v-menu>

          <div class="d-flex flex-wrap ga-2 align-center">
            <div class="filter-input-wrap" style="max-width: 240px; min-width: 160px;">
              <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
              <input
                v-model="search"
                type="text"
                placeholder="Поиск..."
                class="filter-input"
              />
            </div>

            <v-select
              v-model="sortBy"
              :items="sortOptions"
              item-title="title"
              item-value="value"
              variant="solo-filled"
              flat
              density="compact"
              hide-details
              prepend-inner-icon="mdi-sort"
              class="filter-select"
              style="max-width: 180px; min-width: 140px"
            />

            <div class="view-toggle">
              <button class="view-toggle-btn" :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">
                <v-icon icon="mdi-table" size="18" />
              </button>
              <button class="view-toggle-btn" :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">
                <v-icon icon="mdi-view-grid-outline" size="18" />
              </button>
            </div>

            <button v-if="!selectMode" class="view-toggle-btn" @click="selectMode = true" title="Выбрать">
              <v-icon icon="mdi-checkbox-multiple-outline" size="18" />
            </button>
          </div>
        </div>

        <!-- Selection bar -->
        <Transition name="slide-down">
          <div v-if="selectMode" class="select-bar">
            <div class="select-bar-left">
              <v-checkbox-btn
                :model-value="selectedIds.size === displayedDeals.length && displayedDeals.length > 0"
                :indeterminate="selectedIds.size > 0 && selectedIds.size < displayedDeals.length"
                density="compact"
                hide-details
                @update:model-value="selectAll"
              />
              <span class="select-bar-count">
                {{ selectedIds.size > 0 ? `Выбрано ${selectedIds.size} из ${displayedDeals.length}` : 'Выберите сделки' }}
              </span>
            </div>
            <div class="select-bar-right">
              <template v-if="isTrashTab">
                <button
                  v-if="selectedIds.size > 0"
                  class="select-bar-restore"
                  :disabled="deleting"
                  @click="restoreSelected"
                >
                  <v-icon icon="mdi-restore" size="18" />
                  <span>Восстановить ({{ selectedIds.size }})</span>
                </button>
                <button
                  v-if="selectedIds.size > 0"
                  class="select-bar-delete"
                  :disabled="deleting"
                  @click="permanentDeleteSelected"
                >
                  <v-icon icon="mdi-delete-forever" size="18" />
                  <span>Удалить навсегда</span>
                </button>
              </template>
              <button
                v-else-if="selectedIds.size > 0"
                class="select-bar-delete"
                :disabled="deleting"
                @click="deleteSelected"
              >
                <v-progress-circular v-if="deleting" indeterminate size="16" width="2" color="white" />
                <v-icon v-else icon="mdi-delete-outline" size="18" />
                <span>{{ deleting ? 'Удаление...' : `В корзину (${selectedIds.size})` }}</span>
              </button>
              <button class="select-bar-cancel" @click="cancelSelect">
                <v-icon icon="mdi-close" size="18" />
                <span>Отмена</span>
              </button>
            </div>
          </div>
        </Transition>

        <!-- Trash actions bar -->
        <div v-if="isTrashTab && displayedDeals.length" class="trash-bar">
          <div class="trash-bar-left">
            <div class="trash-bar-icon">
              <v-icon icon="mdi-delete-clock-outline" size="18" />
            </div>
            <div class="trash-bar-text">
              <div class="trash-bar-title">{{ dealsStore.trash.length }} {{ dealsStore.trash.length === 1 ? 'сделка' : dealsStore.trash.length < 5 ? 'сделки' : 'сделок' }} в корзине</div>
              <div class="trash-bar-sub">Автоматически удалятся навсегда через 30 дней</div>
            </div>
          </div>
          <button
            class="trash-bar-btn"
            :disabled="deleting"
            @click="emptyTrash"
          >
            <v-progress-circular v-if="deleting" indeterminate size="14" width="2" />
            <v-icon v-else icon="mdi-delete-sweep-outline" size="17" />
            <span>Очистить корзину</span>
          </button>
        </div>

        <!-- GRID VIEW -->
        <v-row v-if="viewMode === 'grid' && displayedDeals.length">
          <v-col v-for="deal in displayedDeals" :key="deal.id" cols="12" sm="6" lg="4" xl="3">
            <div class="deal-card" @click="openDeal(deal)">
              <div class="deal-card-photo">
                <v-img v-if="deal.productPhotos?.[0]" :src="deal.productPhotos[0]" height="140" cover />
                <div v-else class="deal-card-placeholder" style="height: 140px;">
                  <v-icon icon="mdi-package-variant-closed" size="36" />
                </div>
                <div
                  class="deal-card-status"
                  :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])"
                >
                  {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                </div>
              </div>

              <div class="deal-card-body">
                <div class="deal-card-title">
                  <span class="deal-card-num">#{{ deal.dealNumber }}</span>
                  {{ deal.productName }}
                </div>
                <div class="deal-card-client">
                  <v-icon icon="mdi-account" size="14" /> {{ dealClientName(deal) }}
                  <span v-if="!deal.client && deal.clientProfile && !deal.clientProfile.userId" class="external-badge">Внешний</span>
                </div>

                <div class="deal-card-prices">
                  <div class="deal-card-total">{{ formatCurrency(deal.totalPrice) }}</div>
                  <div class="deal-card-markup">+{{ formatCurrency(deal.markup) }} ({{ formatPercent(deal.markupPercent) }})</div>
                </div>

                <div class="deal-card-progress-row">
                  <v-progress-linear
                    :model-value="getDealProgress(deal)"
                    color="primary"
                    rounded
                    height="4"
                    class="flex-grow-1"
                  />
                  <span class="deal-card-progress-text">{{ deal.paidPayments }}/{{ deal.numberOfPayments }}</span>
                </div>
              </div>
            </div>
          </v-col>
        </v-row>

        <!-- TABLE VIEW -->
        <v-table v-if="viewMode === 'table' && displayedDeals.length" density="default" hover class="deals-table">
          <thead>
            <tr>
              <th v-if="selectMode" style="width: 40px;">
                <v-checkbox-btn
                  :model-value="selectedIds.size === displayedDeals.length && displayedDeals.length > 0"
                  :indeterminate="selectedIds.size > 0 && selectedIds.size < displayedDeals.length"
                  density="compact"
                  hide-details
                  @update:model-value="selectAll"
                />
              </th>
              <th>Товар</th>
              <th>Клиент</th>
              <th class="text-end">Итого</th>
              <th class="text-end">Наценка</th>
              <th class="text-end">Остаток</th>
              <th class="text-center">Прогресс</th>
              <th>Статус</th>
              <th>Дата</th>
              <th v-if="isTrashTab" class="text-end">Действия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="deal in displayedDeals" :key="deal.id" class="cursor-pointer" @click="selectMode ? toggleSelect(deal.id) : openDeal(deal)">
              <td v-if="selectMode" @click.stop>
                <v-checkbox-btn
                  :model-value="selectedIds.has(deal.id)"
                  density="compact"
                  hide-details
                  @update:model-value="toggleSelect(deal.id)"
                />
              </td>
              <td>
                <div class="d-flex align-center ga-3 py-3">
                  <v-avatar size="44" rounded="lg" :color="deal.productPhotos?.[0] ? undefined : 'grey-lighten-3'">
                    <v-img v-if="deal.productPhotos?.[0]" :src="deal.productPhotos[0]" cover />
                    <v-icon v-else icon="mdi-package-variant-closed" size="22" color="grey" />
                  </v-avatar>
                  <span class="table-deal-num">#{{ deal.dealNumber }}</span>
                  <span class="font-weight-medium table-product-name">{{ deal.productName }}</span>
                  <span v-if="deal.folder" class="deal-folder-badge" :style="{ background: deal.folder.color + '18', color: deal.folder.color }">
                    <span class="folder-chip-dot" :style="{ background: deal.folder.color }" />
                    {{ deal.folder.name }}
                  </span>
                </div>
              </td>
              <td>
                <div class="d-flex align-center ga-2">
                  <span>{{ dealClientName(deal) }}</span>
                  <span v-if="!deal.client && deal.clientProfile && !deal.clientProfile.userId" class="external-badge">Внешний</span>
                  <v-chip size="x-small" variant="tonal" color="warning">
                    <v-icon icon="mdi-star" size="10" start /> {{ deal.client?.rating ?? 0 }}
                  </v-chip>
                </div>
              </td>
              <td class="text-end font-weight-bold text-no-wrap">{{ formatCurrency(deal.totalPrice) }}</td>
              <td class="text-end text-no-wrap" style="color: #047857;">+{{ formatCurrency(deal.markup) }}</td>
              <td class="text-end text-no-wrap text-medium-emphasis">{{ formatCurrency(deal.remainingAmount) }}</td>
              <td class="text-center" style="min-width: 140px;">
                <div class="d-flex align-center ga-2">
                  <v-progress-linear
                    :model-value="getDealProgress(deal)"
                    color="primary"
                    rounded
                    height="4"
                    style="width: 80px;"
                  />
                  <span class="text-caption text-medium-emphasis">{{ deal.paidPayments }}/{{ deal.numberOfPayments }}</span>
                </div>
              </td>
              <td>
                <div
                  class="deal-status-chip"
                  :style="statusStyle(DEAL_STATUS_CONFIG[deal.status])"
                >
                  {{ DEAL_STATUS_CONFIG[deal.status]?.label }}
                </div>
              </td>
              <td class="text-medium-emphasis text-no-wrap">{{ timeAgo(deal.createdAt) }}</td>
              <td v-if="isTrashTab" class="text-end text-no-wrap" @click.stop>
                <div class="row-actions">
                  <button class="row-action-btn row-action-btn--restore" title="Восстановить" @click="restoreOne(deal.id)">
                    <v-icon icon="mdi-restore" size="17" />
                  </button>
                  <button class="row-action-btn row-action-btn--delete" title="Удалить навсегда" @click="permanentDeleteOne(deal.id)">
                    <v-icon icon="mdi-delete-forever-outline" size="17" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>

        <!-- Empty state -->
        <div v-if="!displayedDeals.length" class="text-center pa-12">
          <v-icon :icon="isTrashTab ? 'mdi-delete-empty' : 'mdi-briefcase-search-outline'" size="56" color="grey-lighten-1" class="mb-3" />
          <p class="text-body-1 font-weight-medium text-medium-emphasis mb-1">
            {{ isTrashTab ? 'Корзина пуста' : 'Нет сделок' }}
          </p>
          <p class="text-body-2 text-medium-emphasis">
            {{ isTrashTab ? 'Удалённые сделки будут отображаться здесь' : search ? 'Попробуйте изменить параметры поиска' : 'Создайте первую сделку' }}
          </p>
          <v-btn
            v-if="!search && !isTrashTab"
            variant="tonal"
            color="primary"
            class="mt-4"
            prepend-icon="mdi-plus"
            @click="router.push('/create-deal')"
          >
            Новая сделка
          </v-btn>
        </div>
      </div>
    </v-card>

    <!-- Deal Detail Dialog -->
    <v-dialog v-model="showDialog" max-width="680" scrollable>
      <v-card v-if="selectedDeal" rounded="lg">
        <!-- Header with photo on the left -->
        <div class="dialog-hero">
          <button class="dialog-close" @click="showDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
          <div class="dialog-hero-photo" :class="{ 'dialog-hero-photo--empty': !selectedDeal.productPhotos?.length }">
            <img v-if="selectedDeal.productPhotos?.[0]" :src="selectedDeal.productPhotos[0]" alt="" />
            <div v-else class="dialog-hero-photo-placeholder">
              <v-icon icon="mdi-image-off-outline" size="28" />
              <span>Нет фото</span>
            </div>
          </div>
          <div class="dialog-hero-content">
            <div
              class="dialog-status"
              :style="{ color: DEAL_STATUS_CONFIG[selectedDeal.status]?.color }"
            >
              <span class="dialog-status-dot" :style="{ background: DEAL_STATUS_CONFIG[selectedDeal.status]?.color }" />
              {{ DEAL_STATUS_CONFIG[selectedDeal.status]?.label }}
            </div>
            <div class="dialog-title">{{ selectedDeal.productName }}</div>
            <div class="dialog-hero-meta">
              <v-icon icon="mdi-account" size="14" />
              {{ dealClientName(selectedDeal) }}
              <span class="mx-1">·</span>
              Создано {{ formatDate(selectedDeal.createdAt) }}
            </div>
          </div>
        </div>

        <v-card-text class="pa-5">

          <!-- Financial grid -->
          <div class="dialog-finance-grid mb-5">
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Закупочная</div>
              <div class="dialog-finance-value">{{ formatCurrency(selectedDeal.purchasePrice) }}</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Итого</div>
              <div class="dialog-finance-value font-weight-bold">{{ formatCurrency(selectedDeal.totalPrice) }}</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Наценка</div>
              <div class="dialog-finance-value" style="color: #047857;">+{{ formatCurrency(selectedDeal.markup) }} ({{ formatPercent(selectedDeal.markupPercent) }})</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Оплачено</div>
              <div class="dialog-finance-value" style="color: #047857;">{{ formatCurrency(selectedDealPaidTotal) }}</div>
            </div>
            <div class="dialog-finance-item">
              <div class="dialog-finance-label">Остаток</div>
              <div class="dialog-finance-value" style="color: #f59e0b;">{{ formatCurrency(selectedDeal.remainingAmount) }}</div>
            </div>
          </div>

          <!-- Progress -->
          <div class="mb-5">
            <div class="d-flex justify-space-between align-center mb-2">
              <span class="text-body-2 font-weight-medium">Прогресс платежей</span>
              <span class="text-caption text-medium-emphasis">{{ selectedDeal.paidPayments }} из {{ selectedDeal.numberOfPayments }}</span>
            </div>
            <v-progress-linear
              :model-value="getDealProgress(selectedDeal)"
              color="primary"
              rounded
              height="8"
            />
          </div>

          <!-- Link to full page -->
          <button class="detail-link-btn mb-5" @click="showDialog = false; goToDeal(selectedDeal!)">
            <v-icon icon="mdi-open-in-new" size="16" />
            Открыть полную страницу сделки
          </button>

          <!-- Payment schedule -->
          <div v-if="selectedDealPayments.length">
            <div class="text-body-2 font-weight-bold mb-3">График платежей</div>
            <div class="schedule-list">
              <div
                v-for="p in selectedDealPayments"
                :key="p.id"
                class="schedule-item"
                :class="{ 'schedule-item--paid': p.status === 'PAID', 'schedule-item--overdue': p.status === 'OVERDUE' }"
              >
                <div class="schedule-num">{{ p.number }}</div>
                <div class="schedule-info">
                  <div class="schedule-date">{{ formatDateShort(p.dueDate) }}</div>
                  <div v-if="p.paidAt" class="schedule-paid-at">Оплачено {{ formatDateShort(p.paidAt) }}</div>
                </div>
                <div class="schedule-amount">{{ formatCurrency(p.amount) }}</div>
                <div
                  class="schedule-status"
                  :style="statusStyle(PAYMENT_STATUS_CONFIG[p.status])"
                >
                  {{ PAYMENT_STATUS_CONFIG[p.status]?.label }}
                </div>
              </div>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
    </template>

    <!-- Folder dialog -->
    <v-dialog v-model="showFolderDialog" max-width="420">
      <v-card rounded="xl" class="fd-dialog">
        <div class="fd-header">
          <div class="fd-header-icon" :style="{ background: folderForm.color + '18', color: folderForm.color }">
            <v-icon icon="mdi-folder" size="22" />
          </div>
          <div>
            <div class="fd-title">{{ editingFolder ? 'Редактировать папку' : 'Новая папка' }}</div>
            <div class="fd-subtitle">Группируйте сделки для удобства</div>
          </div>
          <button class="fd-close" @click="showFolderDialog = false">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div class="fd-body">
          <div class="fd-field">
            <label class="fd-label">Название</label>
            <input v-model="folderForm.name" class="fd-input" placeholder="Например: Телефоны" autofocus />
          </div>

          <div class="fd-field">
            <label class="fd-label">Цвет</label>
            <div class="fd-colors">
              <button
                v-for="c in FOLDER_COLORS" :key="c"
                class="fd-color"
                :class="{ active: folderForm.color === c }"
                :style="{ background: c }"
                @click="folderForm.color = c"
              >
                <v-icon v-if="folderForm.color === c" icon="mdi-check" size="14" color="white" />
              </button>
            </div>
          </div>

          <!-- Preview -->
          <div class="fd-preview">
            <span class="fd-preview-label">Предпросмотр:</span>
            <span class="fd-preview-chip" :style="{ background: folderForm.color + '18', color: folderForm.color }">
              <span class="fd-preview-dot" :style="{ background: folderForm.color }" />
              {{ folderForm.name || 'Название папки' }}
            </span>
          </div>
        </div>

        <div class="fd-footer">
          <button v-if="editingFolder" class="fd-delete" @click="handleDeleteFolder(editingFolder!); showFolderDialog = false">
            <v-icon icon="mdi-delete-outline" size="16" />
            Удалить
          </button>
          <v-spacer />
          <button class="fd-cancel" @click="showFolderDialog = false">Отмена</button>
          <button class="fd-save" :disabled="folderSaving || !folderForm.name.trim()" @click="saveFolder">
            <v-progress-circular v-if="folderSaving" indeterminate size="14" width="2" color="white" />
            <v-icon v-else icon="mdi-check" size="16" />
            {{ editingFolder ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Stats row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .stats-row { grid-template-columns: 1fr; } }

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

/* Tab buttons */
.tab-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 20px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}

.tab-btn:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

.tab-btn.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}

.tab-count {
  font-size: 11px; font-weight: 600;
  padding: 0 6px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  line-height: 18px; min-width: 20px; text-align: center;
}

.tab-btn.active .tab-count {
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
}

/* Filter inputs */
.filter-input-wrap { position: relative; flex: 1; }
.filter-input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #9ca3af; pointer-events: none;
}
.filter-input {
  width: 100%; height: 40px; padding: 0 16px 0 38px;
  border: 1px solid #e4e4e7; border-radius: 10px;
  background: #f4f4f5; font-size: 14px; color: inherit;
  outline: none; transition: all 0.15s ease;
}
.filter-input::placeholder { color: #9ca3af; }
.filter-input:focus {
  border-color: #047857; background: #fff;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}

:deep(.filter-select .v-field) {
  border-radius: 10px; height: 40px; min-height: 40px !important;
  background: #f4f4f5 !important; border: 1px solid #e4e4e7;
  box-shadow: none !important; padding: 0 8px 0 12px;
  font-size: 14px; transition: all 0.15s ease;
}
:deep(.filter-select .v-field .v-field__input) {
  padding: 0 0 0 4px; min-height: unset !important;
  height: 40px; display: flex; align-items: center; font-size: 14px;
}
:deep(.filter-select .v-field .v-field__prepend-inner),
:deep(.filter-select .v-field .v-field__append-inner) {
  padding-top: 0 !important; align-self: center;
}
:deep(.filter-select .v-field .v-field__prepend-inner .v-icon),
:deep(.filter-select .v-field .v-field__append-inner .v-icon) { color: #9ca3af; }
:deep(.filter-select .v-field--focused) {
  border-color: #047857 !important; background: #fff !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent) !important;
}

/* View toggle */
.view-toggle {
  display: flex; border-radius: 10px; overflow: hidden;
  border: 1px solid #e4e4e7; background: #f4f4f5;
}
.view-toggle-btn {
  width: 40px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.45); transition: all 0.15s;
}
.view-toggle-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.view-toggle-btn.active {
  background: #fff; color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* Grid cards */
.deal-card {
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden; cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  background: rgba(var(--v-theme-surface), 1);
}
.deal-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.deal-card-photo { position: relative; }
.external-badge {
  display: inline-flex; padding: 2px 6px; border-radius: 5px;
  background: rgba(99, 102, 241, 0.1); color: #6366f1;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  margin-left: 4px; vertical-align: middle;
}
.deal-card-placeholder {
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.15);
}
.deal-card-status {
  position: absolute; top: 10px; right: 10px;
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px;
}

.deal-card-body { padding: 16px; }
.deal-card-num,
.table-deal-num {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.06);
  padding: 3px 8px;
  border-radius: 6px;
  margin-right: 6px;
  font-variant-numeric: tabular-nums;
  vertical-align: 1px;
}
.deal-card-title {
  font-size: 15px; font-weight: 600; line-height: 1.3; margin-bottom: 4px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.deal-card-client {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; gap: 4px; margin-bottom: 12px;
}
.deal-card-prices { margin-bottom: 12px; }
.deal-card-total {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.deal-card-markup {
  font-size: 13px; color: #047857; font-weight: 500;
}
.deal-card-progress-row {
  display: flex; align-items: center; gap: 8px;
}
.deal-card-progress-text {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
}

/* Table */
/* Selection bar */
.select-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.select-bar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-bar-count {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.select-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-bar-delete {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  background: #ef4444;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.select-bar-delete:hover { background: #dc2626; }
.select-bar-delete:disabled { opacity: 0.6; cursor: not-allowed; }

.select-bar-restore {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  border: none;
  background: #047857;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.select-bar-restore:hover { background: #065f46; }
.select-bar-restore:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── Trash bar ── */
.trash-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.04) 0%, rgba(239, 68, 68, 0.01) 100%);
  border: 1px solid rgba(239, 68, 68, 0.14);
}

.trash-bar-left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.trash-bar-icon {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
}

.trash-bar-text { min-width: 0; line-height: 1.3; }

.trash-bar-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.trash-bar-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 2px;
}

.trash-bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  border: 1px solid rgba(239, 68, 68, 0.25);
  background: rgba(var(--v-theme-surface), 1);
  color: #ef4444;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.trash-bar-btn:hover:not(:disabled) {
  background: #ef4444;
  color: #fff;
  border-color: #ef4444;
}

.trash-bar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dark .trash-bar {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(239, 68, 68, 0.02) 100%);
  border-color: rgba(239, 68, 68, 0.2);
}

.dark .trash-bar-btn {
  background: #1e1e2e;
}

/* ── Row action buttons ── */
.row-actions {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.row-action-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.row-action-btn:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.1);
}

.row-action-btn--restore:hover {
  background: rgba(4, 120, 87, 0.08);
  border-color: rgba(4, 120, 87, 0.2);
  color: #047857;
}

.row-action-btn--delete:hover {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.select-bar-cancel {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.select-bar-cancel:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* Slide transition */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Dark mode */
.dark .select-bar {
  background: #1e1e2e;
  border-color: #2e2e42;
}

.deals-table :deep(td) { font-size: 14px; }
.deals-table :deep(th) {
  font-size: 12px !important; text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}
.table-product-name {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
}
.deal-status-chip {
  display: inline-block; font-size: 11px; font-weight: 600;
  padding: 4px 10px; border-radius: 6px; white-space: nowrap;
}

/* Dialog */
.dialog-hero {
  position: relative;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  display: flex; gap: 16px; align-items: stretch;
  padding: 20px 24px;
  min-height: 160px;
}
.dialog-close {
  position: absolute; top: 12px; right: 12px; z-index: 3;
  width: 30px; height: 30px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
  backdrop-filter: blur(8px);
}
.dialog-close:hover { background: rgba(255, 255, 255, 0.3); }
.dialog-edit {
  position: absolute; top: 12px; right: 52px; z-index: 3;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 11px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.2);
  color: #fff; font-size: 12px; font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.15s;
}
.dialog-edit:hover { background: rgba(255, 255, 255, 0.3); }
.dialog-hero-photo {
  flex-shrink: 0;
  width: 120px; height: 120px;
  border-radius: 12px; overflow: hidden;
  align-self: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.dialog-hero-photo img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.dialog-hero-photo--empty {
  display: flex; align-items: center; justify-content: center;
}
.dialog-hero-photo-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  color: rgba(255, 255, 255, 0.55); font-size: 10px;
}
.dialog-hero-content {
  flex: 1; min-width: 0; color: #fff;
  display: flex; flex-direction: column; justify-content: flex-start;
  padding-right: 44px; /* room for close button */
}
.dialog-status {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  font-size: 11px; font-weight: 600;
  padding: 4px 10px; border-radius: 999px;
  background: #fff; margin-bottom: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.dialog-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.dialog-title {
  font-size: 20px; font-weight: 700; color: #fff; line-height: 1.25;
  margin-bottom: 6px; word-break: break-word;
}
.dialog-hero-meta {
  font-size: 12px; opacity: 0.85;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  margin-top: auto;
}

.dialog-avatar {
  width: 36px; height: 36px; min-width: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 14px;
}

.dialog-finance-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 600px) { .dialog-finance-grid { grid-template-columns: repeat(2, 1fr); } }
.dialog-finance-item {
  padding: 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.dialog-finance-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-bottom: 2px;
}
.dialog-finance-value {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

/* Schedule */
.schedule-list { display: flex; flex-direction: column; gap: 4px; }
.schedule-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 8px;
  transition: background 0.15s;
}
.schedule-item:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.schedule-item--paid { opacity: 0.65; }
.schedule-item--overdue { background: rgba(239, 68, 68, 0.04); }
.schedule-num {
  width: 24px; height: 24px; min-width: 24px;
  border-radius: 6px; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.schedule-info { flex: 1; min-width: 0; }
.schedule-date {
  font-size: 14px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.schedule-paid-at {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.schedule-amount {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
}
.schedule-status {
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 6px; white-space: nowrap;
}

/* Detail link */
.detail-link-btn {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 10px 16px; border-radius: 10px;
  border: 1px dashed rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.04);
  color: rgb(var(--v-theme-primary));
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  justify-content: center;
}
.detail-link-btn:hover {
  background: rgba(var(--v-theme-primary), 0.1);
  border-color: rgba(var(--v-theme-primary), 0.5);
}

/* Dark mode */
.dark .stat-card {
  background: #1e1e2e; border-color: #2e2e42;
}
.dark .deal-card {
  background: #1e1e2e; border-color: #2e2e42;
}
.dark .filter-input {
  background: #252538; border-color: #2e2e42; color: #e4e4e7;
}
.dark .filter-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark :deep(.filter-select .v-field) {
  background: #252538 !important; border-color: #2e2e42; color: #e4e4e7;
}
.dark :deep(.filter-select .v-field--focused) {
  border-color: #047857 !important; background: #1e1e2e !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent) !important;
}
.dark .view-toggle { background: #252538; border-color: #2e2e42; }
.dark .view-toggle-btn.active { background: #2e2e42; box-shadow: none; }
.dark .filter-input::placeholder { color: #71717a; }
.dark :deep(.filter-select .v-field .v-field__prepend-inner),
.dark :deep(.filter-select .v-field .v-field__append-inner) { color: #71717a; }
.dark .dialog-finance-item { background: rgba(255, 255, 255, 0.04); }

/* Folders */
.folder-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 12px; font-weight: 500;
  cursor: pointer; transition: all 0.12s; white-space: nowrap;
}
.folder-chip:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.folder-chip.active {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}
.folder-chip--add {
  padding: 5px 8px;
  color: rgba(var(--v-theme-on-surface), 0.3);
}
.folder-chip--add:hover { color: rgb(var(--v-theme-primary)); }
.folder-chip-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.folder-chip-count {
  font-size: 10px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.3);
  margin-left: 1px;
}

.folder-move-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 14px; border-radius: 8px; border: none;
  background: rgba(99, 102, 241, 0.1); color: #6366f1;
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.12s;
}
.folder-move-btn:hover { background: rgba(99, 102, 241, 0.18); }

.folder-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 12px; border-radius: 8px; border: none;
  background: none; font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; text-align: left;
}
.folder-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }

/* Folder button & dropdown */
.fb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: #fff;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.12s;
}
.fb-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.2); color: rgba(var(--v-theme-on-surface), 0.8); }
.fb-btn--active {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
  background: #fff;
  color: rgba(var(--v-theme-on-surface), 0.8); font-weight: 600;
}

.fb-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.fb-dropdown { width: 240px; padding: 0; overflow: hidden; }
.fb-dropdown-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.fb-dropdown-add {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 4px 10px; border-radius: 6px; border: none;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  font-size: 11px; font-weight: 600; cursor: pointer;
}
.fb-dropdown-add:hover { background: rgba(var(--v-theme-primary), 0.15); }
.fb-dropdown-body { padding: 6px; }

.fb-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border-radius: 8px; border: none; background: none;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.65);
  cursor: pointer; text-align: left; transition: background 0.1s;
}
.fb-item:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.fb-item--active {
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}
.fb-item-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.fb-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-item-count {
  font-size: 11px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.2);
  flex-shrink: 0;
}
.fb-item-edit {
  width: 20px; height: 20px; border-radius: 5px; border: none;
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.15);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0; transition: all 0.12s; flex-shrink: 0;
}
.fb-item:hover .fb-item-edit { opacity: 1; }
.fb-item-edit:hover { background: rgba(var(--v-theme-on-surface), 0.1); color: rgba(var(--v-theme-on-surface), 0.6); }
.fb-divider { height: 1px; background: rgba(var(--v-theme-on-surface), 0.06); margin: 4px 6px; }
.fb-empty { padding: 12px; text-align: center; }

.dark .fb-dropdown-header { border-bottom-color: rgba(255,255,255,0.06); }
.dark .fb-btn { background: #252538; border-color: #2e2e42; }
.dark .fb-btn:hover { border-color: #3e3e52; }
.dark .fb-btn--active { background: rgba(var(--v-theme-primary), 0.1); border-color: rgba(var(--v-theme-primary), 0.2); }
.dark .fb-item:hover { background: rgba(255,255,255,0.04); }
.dark .fb-item--active { background: rgba(var(--v-theme-primary), 0.1); }

.folder-menu-item--active { background: rgba(var(--v-theme-primary), 0.06); }

.deal-folder-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 5px;
  font-size: 10px; font-weight: 600; margin-left: 6px;
}

/* Folder dialog */
.fd-dialog { padding: 0 !important; overflow: hidden; }
.fd-header {
  display: flex; align-items: center; gap: 12px;
  padding: 20px 24px 16px;
}
.fd-header-icon {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.fd-title { font-size: 17px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.fd-subtitle { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.4); margin-top: 1px; }
.fd-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.4);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; margin-left: auto;
}
.fd-close:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.fd-body { padding: 0 24px 16px; }
.fd-field { margin-bottom: 16px; }
.fd-label {
  display: block; font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; color: rgba(var(--v-theme-on-surface), 0.35);
  margin-bottom: 8px;
}
.fd-input {
  width: 100%; height: 44px; padding: 0 14px;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.02); outline: none;
}
.fd-input:focus { border-color: #047857; box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.08); }
.fd-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.25); }
.fd-colors { display: flex; gap: 8px; flex-wrap: wrap; }
.fd-color {
  width: 32px; height: 32px; border-radius: 50%; border: 3px solid transparent;
  cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.fd-color:hover { transform: scale(1.15); }
.fd-color.active { border-color: rgba(var(--v-theme-on-surface), 0.15); transform: scale(1.1); }
.fd-preview {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.fd-preview-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.35); }
.fd-preview-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 12px; border-radius: 7px;
  font-size: 12px; font-weight: 600;
}
.fd-preview-dot { width: 8px; height: 8px; border-radius: 50%; }
.fd-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 24px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.fd-delete {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 7px 14px; border-radius: 8px; border: none;
  background: rgba(239, 68, 68, 0.08); color: #ef4444;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.fd-delete:hover { background: rgba(239, 68, 68, 0.15); }
.fd-cancel {
  padding: 8px 18px; border-radius: 9px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.fd-cancel:hover { background: rgba(var(--v-theme-on-surface), 0.1); }
.fd-save {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 20px; border-radius: 9px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.fd-save:hover { background: #065f46; }
.fd-save:disabled { opacity: 0.4; cursor: not-allowed; }

.dark .folder-chip { background: rgba(255,255,255,0.06); }
.dark .folder-chip.active { background: rgba(var(--v-theme-primary), 0.15); }
.dark .fd-input { background: #1e1e2e; border-color: #2e2e42; }
.dark .fd-preview { background: rgba(255,255,255,0.04); }
.dark .fd-footer { border-top-color: rgba(255,255,255,0.06); }
.dark .fd-color.active { border-color: rgba(255,255,255,0.2); }
</style>
