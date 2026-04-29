<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useChats } from '@/composables/useChats'
import ChatPanel from '@/components/ChatPanel.vue'
import type { StaffMember, StaffRole, DealsAccessMode, Deal, DealStatus } from '@/types'
import { STAFF_ROLE_LABELS, ROLE_ROUTE_ACCESS, STAFF_TOGGLEABLE_ROUTES } from '@/types'
import { formatCurrency } from '@/utils/formatters'

const { isDark } = useIsDark()
const toast = useToast()

const staff = ref<StaffMember[]>([])
const pageLoading = ref(true)

// Add dialog
const addDialog = ref(false)
const addLoading = ref(false)
const addForm = ref({ email: '', firstName: '', lastName: '', role: 'MANAGER' as StaffRole })

// Edit dialog
const editDialog = ref(false)
const editLoading = ref(false)
const editTarget = ref<StaffMember | null>(null)
const editForm = ref({
  role: 'MANAGER' as StaffRole,
  isActive: true,
  dealsAccessMode: 'ALL' as DealsAccessMode,
  accessOverrides: [] as string[],
  canCreateDeals: true,
})

// Routes available to toggle for the current edit target — intersection of
// the role's base set with the toggleable list.
const editToggleableRoutes = computed(() => {
  const role = editForm.value.role
  const baseRoutes = new Set(ROLE_ROUTE_ACCESS[role] || [])
  return STAFF_TOGGLEABLE_ROUTES.filter((r) => baseRoutes.has(r.path))
})

function isRouteEnabled(path: string): boolean {
  return !editForm.value.accessOverrides.includes(path)
}

function toggleRoute(path: string) {
  const idx = editForm.value.accessOverrides.indexOf(path)
  if (idx >= 0) editForm.value.accessOverrides.splice(idx, 1)
  else editForm.value.accessOverrides.push(path)
}

// Delete
const deleteDialog = ref(false)
const deleteTarget = ref<StaffMember | null>(null)
const deleteLoading = ref(false)

// Inline chat (right panel of split layout)
const chats = useChats()
const selectedStaff = ref<StaffMember | null>(null)
const selectedChatId = ref<string | null>(null)
const chatOpening = ref(false)
let threadsPollTimer: number | null = null

async function selectStaff(member: StaffMember) {
  if (selectedStaff.value?.id === member.id) return
  selectedStaff.value = member
  selectedChatId.value = null
  chatOpening.value = true
  try {
    const thread = await chats.findOrCreate(member.id)
    selectedChatId.value = thread.id
    // Optimistic local zero — backend will reconfirm via fetchThreads next poll
    const t = chats.threads.value.find((x) => x.id === thread.id)
    if (t) t.unreadCount = 0
  } catch (e: any) {
    toast.error(e.message || 'Не удалось открыть чат')
    selectedStaff.value = null
  } finally {
    chatOpening.value = false
  }
}

function closeSelected() {
  selectedStaff.value = null
  selectedChatId.value = null
  activeTab.value = 'chat'
  chats.fetchThreads().catch(() => {})
}

// Tabs in right panel: chat (default) or assigned deals list
type RightPanelTab = 'chat' | 'deals'
const activeTab = ref<RightPanelTab>('chat')

// Assigned deals — loaded when partner selects a staff and opens "Сделки" tab
const assignedDeals = ref<Deal[]>([])
const assignedDealsLoading = ref(false)

async function loadAssignedDeals() {
  if (!selectedStaff.value) {
    assignedDeals.value = []
    return
  }
  assignedDealsLoading.value = true
  try {
    assignedDeals.value = await api.get<Deal[]>(
      `/deals?role=investor&assignedStaffId=${selectedStaff.value.id}`,
    )
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить сделки')
  } finally {
    assignedDealsLoading.value = false
  }
}

watch([activeTab, selectedStaff], ([tab, staff]) => {
  if (tab === 'deals' && staff) loadAssignedDeals()
})

// Detach a deal from currently selected staff
async function detachDeal(deal: Deal) {
  if (!selectedStaff.value) return
  if (!confirm(`Открепить «${deal.productName}» от ${selectedStaff.value.firstName}?`)) return
  try {
    await api.patch(`/deals/${deal.id}/assignee`, { staffId: null })
    toast.success('Сделка откреплена')
    await loadAssignedDeals()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось открепить')
  }
}

// Attach-deal dialog: pick from existing deals (search by number/product)
const attachDialog = ref(false)
const attachSearch = ref('')
const allInvestorDeals = ref<Deal[]>([])
const attachLoading = ref(false)

async function openAttachDialog() {
  attachSearch.value = ''
  attachDialog.value = true
  attachLoading.value = true
  try {
    // Fetch all partner's deals (no staff filter — we want to see what to attach)
    allInvestorDeals.value = await api.get<Deal[]>('/deals?role=investor')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить сделки')
  } finally {
    attachLoading.value = false
  }
}

const attachDealCandidates = computed(() => {
  // Show deals that are NOT yet assigned to this staff. Sort: ACTIVE first, then by recency.
  if (!selectedStaff.value) return []
  const staffId = selectedStaff.value.id
  const q = attachSearch.value.trim().toLowerCase()
  let list = allInvestorDeals.value.filter(
    (d) => (d as any).assignedStaffId !== staffId && d.status !== 'CANCELLED',
  )
  if (q) {
    list = list.filter(
      (d) =>
        String(d.dealNumber).startsWith(q) ||
        d.productName.toLowerCase().includes(q),
    )
  }
  // Active first, then by createdAt desc
  list.sort((a, b) => {
    if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1
    if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
  return list.slice(0, 50)
})

async function attachDeal(deal: Deal) {
  if (!selectedStaff.value) return
  try {
    await api.patch(`/deals/${deal.id}/assignee`, { staffId: selectedStaff.value.id })
    toast.success('Сделка прикреплена')
    attachDialog.value = false
    await loadAssignedDeals()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось прикрепить')
  }
}

const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  ACTIVE: 'Активна',
  COMPLETED: 'Завершена',
  DISPUTED: 'Спор',
  CANCELLED: 'Отменена',
}
const DEAL_STATUS_COLORS: Record<DealStatus, string> = {
  ACTIVE: '#10b981',
  COMPLETED: '#6b7280',
  DISPUTED: '#f59e0b',
  CANCELLED: '#ef4444',
}

const ROLE_COLORS: Record<StaffRole, string> = {
  MANAGER: '#3b82f6',
  OPERATOR: '#f59e0b',
}

const ROLE_ICONS: Record<StaffRole, string> = {
  MANAGER: 'mdi-shield-account',
  OPERATOR: 'mdi-account-hard-hat',
}

async function loadStaff() {
  pageLoading.value = true
  try {
    const [list] = await Promise.all([
      api.get<StaffMember[]>('/auth/investor/staff'),
      chats.fetchThreads().catch(() => {}),
    ])
    staff.value = list
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки')
  } finally {
    pageLoading.value = false
  }
}

function staffUnread(staffId: string): number {
  const t = chats.threads.value.find((x) => x.counterpart.id === staffId)
  return t?.unreadCount || 0
}

function openAdd() {
  addForm.value = { email: '', firstName: '', lastName: '', role: 'MANAGER' }
  addDialog.value = true
}

async function addStaffMember() {
  addLoading.value = true
  try {
    await api.post('/auth/investor/staff', addForm.value)
    toast.success('Сотрудник добавлен. Данные для входа отправлены на email.')
    addDialog.value = false
    await loadStaff()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при добавлении')
  } finally {
    addLoading.value = false
  }
}

function openEdit(member: StaffMember) {
  editTarget.value = member
  editForm.value = {
    role: member.role,
    isActive: member.isActive,
    dealsAccessMode: member.dealsAccessMode || 'ALL',
    accessOverrides: [...(member.accessOverrides || [])],
    canCreateDeals: member.canCreateDeals !== false,
  }
  editDialog.value = true
}

async function saveEdit() {
  if (!editTarget.value) return
  editLoading.value = true
  try {
    await api.patch(`/auth/investor/staff/${editTarget.value.id}`, editForm.value)
    toast.success('Сохранено')
    editDialog.value = false
    await loadStaff()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  } finally {
    editLoading.value = false
  }
}

function openDelete(member: StaffMember) {
  deleteTarget.value = member
  deleteDialog.value = true
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleteLoading.value = true
  try {
    await api.delete(`/auth/investor/staff/${deleteTarget.value.id}`)
    toast.success('Сотрудник удалён')
    deleteDialog.value = false
    await loadStaff()
  } catch (e: any) {
    toast.error(e.message || 'Ошибка')
  } finally {
    deleteLoading.value = false
  }
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const addFormValid = computed(() =>
  addForm.value.email.includes('@') &&
  addForm.value.firstName.length >= 2 &&
  addForm.value.lastName.length >= 2
)

const activeCount = computed(() => staff.value.filter((s) => s.isActive).length)
const managersCount = computed(() => staff.value.filter((s) => s.role === 'MANAGER').length)
const operatorsCount = computed(() => staff.value.filter((s) => s.role === 'OPERATOR').length)

onMounted(async () => {
  await loadStaff()
  threadsPollTimer = window.setInterval(() => chats.fetchThreads().catch(() => {}), 15000)
})

onBeforeUnmount(() => {
  if (threadsPollTimer) window.clearInterval(threadsPollTimer)
})
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <div v-if="pageLoading" class="d-flex justify-center align-center" style="min-height: 400px;">
      <v-progress-circular indeterminate color="primary" size="40" />
    </div>

    <template v-else>
      <!-- Stats -->
      <div class="stats-row mb-6">
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
            <v-icon icon="mdi-account-group" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ staff.length }}</div>
            <div class="stat-label">Всего сотрудников</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">
            <v-icon icon="mdi-check-circle-outline" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ activeCount }}</div>
            <div class="stat-label">Активных</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
            <v-icon icon="mdi-shield-account" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ managersCount }}</div>
            <div class="stat-label">Менеджеров</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
            <v-icon icon="mdi-account-hard-hat" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ operatorsCount }}</div>
            <div class="stat-label">Операторов</div>
          </div>
        </div>
      </div>

      <!-- Split: staff list (left) + chat panel (right) -->
      <div class="sf-shell">
        <!-- LEFT: staff list -->
        <aside class="sf-sidebar">
          <header class="sf-sidebar-header">
            <span class="sf-sidebar-title">Сотрудники</span>
            <button class="sf-sidebar-add" @click="openAdd" title="Добавить сотрудника">
              <v-icon icon="mdi-plus" size="18" />
            </button>
          </header>

          <div v-if="staff.length" class="sf-sidebar-list">
            <div
              v-for="m in staff"
              :key="m.id"
              class="sf-row"
              :class="{
                'sf-row--active': selectedStaff?.id === m.id,
                'sf-row--inactive': !m.isActive,
              }"
              @click="selectStaff(m)"
            >
              <div class="sf-avatar" :style="{ background: ROLE_COLORS[m.role] + '14', color: ROLE_COLORS[m.role] }">
                {{ m.firstName[0] }}{{ m.lastName[0] }}
              </div>
              <div class="sf-row-main">
                <div class="sf-row-line">
                  <span class="sf-row-name">{{ m.firstName }} {{ m.lastName }}</span>
                  <span v-if="staffUnread(m.id) > 0" class="sf-row-badge">
                    {{ staffUnread(m.id) > 99 ? '99+' : staffUnread(m.id) }}
                  </span>
                </div>
                <div class="sf-row-line">
                  <span class="sf-row-role" :style="{ color: ROLE_COLORS[m.role] }">
                    <v-icon :icon="ROLE_ICONS[m.role]" size="11" class="mr-1" />
                    {{ STAFF_ROLE_LABELS[m.role] }}
                  </span>
                  <span v-if="!m.isActive" class="sf-row-meta sf-row-meta--off">· Отключён</span>
                </div>
              </div>
              <div class="sf-row-actions">
                <button class="sf-action-btn" title="Редактировать" @click.stop="openEdit(m)">
                  <v-icon icon="mdi-pencil-outline" size="14" />
                </button>
                <button class="sf-action-btn sf-action-btn--danger" title="Удалить" @click.stop="openDelete(m)">
                  <v-icon icon="mdi-delete-outline" size="14" />
                </button>
              </div>
            </div>
          </div>

          <!-- Sidebar empty state -->
          <div v-else class="sf-sidebar-empty">
            <v-icon icon="mdi-account-key-outline" size="32" color="grey-lighten-1" />
            <div class="sf-sidebar-empty-title">Нет сотрудников</div>
            <div class="sf-sidebar-empty-sub">Добавьте первого, чтобы начать переписку</div>
            <button class="sf-add-btn mt-3" @click="openAdd">
              <v-icon icon="mdi-plus" size="16" />
              <span>Добавить</span>
            </button>
          </div>
        </aside>

        <!-- RIGHT: chat panel -->
        <section class="sf-main-panel">
          <template v-if="selectedStaff">
            <header class="sf-chat-bar">
              <div class="sf-avatar sf-avatar--sm" :style="{ background: ROLE_COLORS[selectedStaff.role] + '14', color: ROLE_COLORS[selectedStaff.role] }">
                {{ selectedStaff.firstName[0] }}{{ selectedStaff.lastName[0] }}
              </div>
              <div class="sf-chat-bar-info">
                <div class="sf-chat-bar-name">{{ selectedStaff.firstName }} {{ selectedStaff.lastName }}</div>
                <div class="sf-chat-bar-sub">
                  {{ STAFF_ROLE_LABELS[selectedStaff.role] }} · {{ selectedStaff.email }}{{ selectedStaff.isActive ? '' : ' · Деактивирован' }}
                </div>
              </div>
              <button class="sf-chat-bar-close" title="Закрыть" @click="closeSelected">
                <v-icon icon="mdi-close" size="18" />
              </button>
            </header>

            <!-- Tabs row -->
            <div class="sf-tabs">
              <button
                class="sf-tab"
                :class="{ 'sf-tab--active': activeTab === 'chat' }"
                @click="activeTab = 'chat'"
              >
                <v-icon icon="mdi-message-text-outline" size="14" />
                <span>Чат</span>
                <span v-if="staffUnread(selectedStaff.id) > 0" class="sf-tab-badge">{{ staffUnread(selectedStaff.id) }}</span>
              </button>
              <button
                class="sf-tab"
                :class="{ 'sf-tab--active': activeTab === 'deals' }"
                @click="activeTab = 'deals'"
              >
                <v-icon icon="mdi-briefcase-outline" size="14" />
                <span>Сделки</span>
                <span v-if="assignedDeals.length > 0" class="sf-tab-badge sf-tab-badge--neutral">{{ assignedDeals.length }}</span>
              </button>
            </div>

            <!-- Chat tab -->
            <template v-if="activeTab === 'chat'">
              <div v-if="chatOpening" class="d-flex justify-center pa-6">
                <v-progress-circular indeterminate size="20" color="primary" />
              </div>
              <ChatPanel v-else :chat-id="selectedChatId" />
            </template>

            <!-- Deals tab -->
            <div v-else class="sf-deals-tab">
              <div class="sf-deals-header">
                <div class="sf-deals-title">
                  Назначенные сделки
                  <span class="sf-deals-count">{{ assignedDeals.length }}</span>
                </div>
                <button class="sf-deals-add-btn" @click="openAttachDialog">
                  <v-icon icon="mdi-plus" size="14" />
                  Прикрепить
                </button>
              </div>

              <div v-if="assignedDealsLoading" class="d-flex justify-center pa-6">
                <v-progress-circular indeterminate size="20" color="primary" />
              </div>

              <div v-else-if="assignedDeals.length === 0" class="sf-deals-empty">
                <v-icon icon="mdi-briefcase-off-outline" size="32" color="grey-lighten-1" />
                <div class="sf-deals-empty-title">Сделок пока нет</div>
                <div class="sf-deals-empty-sub">
                  Прикрепите первую сделку — работник с режимом «Только назначенные» увидит её в своём списке.
                </div>
                <button class="sf-deals-add-btn mt-3" @click="openAttachDialog">
                  <v-icon icon="mdi-plus" size="14" />
                  Прикрепить сделку
                </button>
              </div>

              <div v-else class="sf-deals-list">
                <RouterLink
                  v-for="d in assignedDeals"
                  :key="d.id"
                  :to="`/deals/${d.id}`"
                  class="sf-deal-row"
                >
                  <div class="sf-deal-num">#{{ d.dealNumber }}</div>
                  <div class="sf-deal-main">
                    <div class="sf-deal-product">{{ d.productName }}</div>
                    <div class="sf-deal-meta">
                      {{ formatCurrency(d.totalPrice) }} · остаток {{ formatCurrency(d.remainingAmount) }}
                    </div>
                  </div>
                  <span
                    class="sf-deal-status"
                    :style="{ background: DEAL_STATUS_COLORS[d.status] + '14', color: DEAL_STATUS_COLORS[d.status] }"
                  >
                    {{ DEAL_STATUS_LABELS[d.status] }}
                  </span>
                  <button class="sf-deal-detach" title="Открепить" @click.stop.prevent="detachDeal(d)">
                    <v-icon icon="mdi-link-off" size="14" />
                  </button>
                </RouterLink>
              </div>
            </div>
          </template>

          <!-- Empty state when no staff selected -->
          <div v-else class="sf-placeholder">
            <v-icon icon="mdi-message-outline" size="48" color="grey-lighten-1" />
            <div class="sf-placeholder-title">Выберите сотрудника</div>
            <div class="sf-placeholder-sub">
              Слева — список ваших работников. Кликните, чтобы открыть переписку.
              Упоминайте сделки через <code>#номер</code>.
            </div>
          </div>
        </section>
      </div>
    </template>

    <!-- Add Dialog -->
    <v-dialog v-model="addDialog" max-width="480">
      <v-card rounded="lg">
        <div class="pa-6">
          <div class="d-flex align-center justify-space-between mb-5">
            <div>
              <div class="text-h6 font-weight-bold">Новый сотрудник</div>
              <div class="text-caption text-medium-emphasis">Данные для входа будут отправлены на email</div>
            </div>
            <button class="dialog-close-sm" @click="addDialog = false">
              <v-icon icon="mdi-close" size="18" />
            </button>
          </div>

          <div class="d-flex flex-column mb-5" style="gap: 14px;">
            <v-text-field v-model="addForm.lastName" label="Фамилия" variant="outlined" density="comfortable" rounded="lg" hide-details />
            <v-text-field v-model="addForm.firstName" label="Имя" variant="outlined" density="comfortable" rounded="lg" hide-details />
            <v-text-field v-model="addForm.email" label="Email" type="email" variant="outlined" density="comfortable" rounded="lg" hide-details prepend-inner-icon="mdi-email-outline" />
          </div>

          <div class="mb-6">
            <div class="sf-section-label mb-3">Роль</div>
            <div class="sf-role-grid">
              <button
                v-for="(label, key) in STAFF_ROLE_LABELS"
                :key="key"
                class="sf-role-card"
                :class="{ 'sf-role-card--active': addForm.role === key }"
                :style="addForm.role === key ? { borderColor: ROLE_COLORS[key], background: ROLE_COLORS[key] + '06' } : {}"
                @click="addForm.role = key as StaffRole"
              >
                <div class="sf-role-card-icon" :style="{ background: ROLE_COLORS[key] + '14', color: ROLE_COLORS[key] }">
                  <v-icon :icon="ROLE_ICONS[key]" size="20" />
                </div>
                <div class="sf-role-card-label">{{ label }}</div>
                <div class="sf-role-card-desc">
                  {{ key === 'MANAGER' ? 'Полный доступ кроме настроек' : 'Сделки, клиенты, платежи' }}
                </div>
                <div v-if="addForm.role === key" class="sf-role-card-check">
                  <v-icon icon="mdi-check-circle" size="18" :color="ROLE_COLORS[key]" />
                </div>
              </button>
            </div>
          </div>

          <div class="d-flex ga-3">
            <button class="btn-secondary flex-grow-1" @click="addDialog = false">Отмена</button>
            <button class="btn-primary flex-grow-1" :disabled="!addFormValid || addLoading" @click="addStaffMember">
              <v-progress-circular v-if="addLoading" indeterminate size="16" width="2" color="white" class="mr-2" />
              <v-icon v-else icon="mdi-send" size="16" class="mr-1" />
              {{ addLoading ? 'Отправка...' : 'Добавить и отправить' }}
            </button>
          </div>
        </div>
      </v-card>
    </v-dialog>

    <!-- Edit Dialog -->
    <v-dialog v-model="editDialog" max-width="440">
      <v-card v-if="editTarget" rounded="lg">
        <div class="pa-6">
          <div class="d-flex align-center justify-space-between mb-5">
            <div>
              <div class="text-h6 font-weight-bold">Редактировать</div>
              <div class="text-caption text-medium-emphasis">{{ editTarget.firstName }} {{ editTarget.lastName }} · {{ editTarget.email }}</div>
            </div>
            <button class="dialog-close-sm" @click="editDialog = false">
              <v-icon icon="mdi-close" size="18" />
            </button>
          </div>

          <div class="mb-5">
            <div class="sf-section-label mb-3">Роль</div>
            <div class="sf-role-grid">
              <button
                v-for="(label, key) in STAFF_ROLE_LABELS"
                :key="key"
                class="sf-role-card"
                :class="{ 'sf-role-card--active': editForm.role === key }"
                :style="editForm.role === key ? { borderColor: ROLE_COLORS[key], background: ROLE_COLORS[key] + '06' } : {}"
                @click="editForm.role = key as StaffRole"
              >
                <div class="sf-role-card-icon" :style="{ background: ROLE_COLORS[key] + '14', color: ROLE_COLORS[key] }">
                  <v-icon :icon="ROLE_ICONS[key]" size="20" />
                </div>
                <div class="sf-role-card-label">{{ label }}</div>
                <div class="sf-role-card-desc">
                  {{ key === 'MANAGER' ? 'Полный доступ кроме настроек' : 'Сделки, клиенты, платежи' }}
                </div>
                <div v-if="editForm.role === key" class="sf-role-card-check">
                  <v-icon icon="mdi-check-circle" size="18" :color="ROLE_COLORS[key]" />
                </div>
              </button>
            </div>
          </div>

          <div class="mb-5">
            <div class="sf-section-label mb-3">Доступ к сделкам</div>
            <div class="sf-role-grid">
              <button
                class="sf-role-card"
                :class="{ 'sf-role-card--active': editForm.dealsAccessMode === 'ALL' }"
                :style="editForm.dealsAccessMode === 'ALL' ? { borderColor: '#10b981', background: '#10b98106' } : {}"
                @click="editForm.dealsAccessMode = 'ALL'"
              >
                <div class="sf-role-card-icon" style="background: #10b98114; color: #10b981;">
                  <v-icon icon="mdi-folder-multiple-outline" size="20" />
                </div>
                <div class="sf-role-card-label">Все сделки</div>
                <div class="sf-role-card-desc">Видит все сделки и платежи партнёра</div>
                <div v-if="editForm.dealsAccessMode === 'ALL'" class="sf-role-card-check">
                  <v-icon icon="mdi-check-circle" size="18" color="#10b981" />
                </div>
              </button>
              <button
                class="sf-role-card"
                :class="{ 'sf-role-card--active': editForm.dealsAccessMode === 'ASSIGNED_ONLY' }"
                :style="editForm.dealsAccessMode === 'ASSIGNED_ONLY' ? { borderColor: '#f59e0b', background: '#f59e0b06' } : {}"
                @click="editForm.dealsAccessMode = 'ASSIGNED_ONLY'"
              >
                <div class="sf-role-card-icon" style="background: #f59e0b14; color: #f59e0b;">
                  <v-icon icon="mdi-account-arrow-right-outline" size="20" />
                </div>
                <div class="sf-role-card-label">Только назначенные</div>
                <div class="sf-role-card-desc">Видит только сделки, привязанные к нему</div>
                <div v-if="editForm.dealsAccessMode === 'ASSIGNED_ONLY'" class="sf-role-card-check">
                  <v-icon icon="mdi-check-circle" size="18" color="#f59e0b" />
                </div>
              </button>
            </div>
          </div>

          <div class="sf-active-toggle mb-5" :class="{ 'sf-active-toggle--off': !editForm.canCreateDeals }" @click="editForm.canCreateDeals = !editForm.canCreateDeals">
            <div class="sf-active-toggle-dot" :style="{ background: editForm.canCreateDeals ? '#10b981' : '#9ca3af' }" />
            <div class="sf-active-toggle-text">
              <div class="sf-active-toggle-title">Создание сделок</div>
              <div class="sf-active-toggle-desc">{{ editForm.canCreateDeals ? 'Может создавать новые сделки и импорт' : 'Кнопка "Создать" в шапке скрыта' }}</div>
            </div>
            <div class="sf-switch-track" :class="{ 'sf-switch-track--on': editForm.canCreateDeals }">
              <div class="sf-switch-thumb" />
            </div>
          </div>

          <div v-if="editToggleableRoutes.length" class="mb-5">
            <div class="sf-section-label mb-3">Доступ к разделам</div>
            <div class="sf-routes-grid">
              <button
                v-for="r in editToggleableRoutes"
                :key="r.path"
                type="button"
                class="sf-route-card"
                :class="{ 'sf-route-card--off': !isRouteEnabled(r.path) }"
                @click="toggleRoute(r.path)"
              >
                <v-icon :icon="r.icon" size="18" />
                <span class="sf-route-label">{{ r.label }}</span>
                <v-icon
                  :icon="isRouteEnabled(r.path) ? 'mdi-check-circle' : 'mdi-close-circle-outline'"
                  size="16"
                  class="sf-route-mark"
                />
              </button>
            </div>
            <div class="sf-routes-hint">Снимите галку, чтобы скрыть раздел у работника</div>
          </div>

          <div class="sf-active-toggle mb-6" :class="{ 'sf-active-toggle--off': !editForm.isActive }" @click="editForm.isActive = !editForm.isActive">
            <div class="sf-active-toggle-dot" :style="{ background: editForm.isActive ? '#10b981' : '#ef4444' }" />
            <div class="sf-active-toggle-text">
              <div class="sf-active-toggle-title">{{ editForm.isActive ? 'Активен' : 'Деактивирован' }}</div>
              <div class="sf-active-toggle-desc">{{ editForm.isActive ? 'Сотрудник может входить в систему' : 'Доступ заблокирован' }}</div>
            </div>
            <div class="sf-switch-track" :class="{ 'sf-switch-track--on': editForm.isActive }">
              <div class="sf-switch-thumb" />
            </div>
          </div>

          <div class="d-flex ga-3">
            <button class="btn-secondary flex-grow-1" @click="editDialog = false">Отмена</button>
            <button class="btn-primary flex-grow-1" :disabled="editLoading" @click="saveEdit">
              <v-progress-circular v-if="editLoading" indeterminate size="16" width="2" color="white" class="mr-2" />
              Сохранить
            </button>
          </div>
        </div>
      </v-card>
    </v-dialog>

    <!-- Attach Deal Dialog -->
    <v-dialog v-model="attachDialog" max-width="560">
      <v-card v-if="selectedStaff" rounded="lg">
        <div class="pa-5">
          <div class="d-flex align-center justify-space-between mb-4">
            <div>
              <div class="text-h6 font-weight-bold">Прикрепить сделку</div>
              <div class="text-caption text-medium-emphasis">
                Назначить сотрудника {{ selectedStaff.firstName }} {{ selectedStaff.lastName }} ответственным
              </div>
            </div>
            <button class="dialog-close-sm" @click="attachDialog = false">
              <v-icon icon="mdi-close" size="18" />
            </button>
          </div>

          <div class="sf-attach-search-wrap mb-3">
            <v-icon icon="mdi-magnify" size="16" class="sf-attach-search-icon" />
            <input
              v-model="attachSearch"
              type="text"
              class="sf-attach-search-input"
              placeholder="Поиск по номеру (#42) или названию"
              autofocus
            />
          </div>

          <div v-if="attachLoading" class="d-flex justify-center pa-6">
            <v-progress-circular indeterminate size="20" color="primary" />
          </div>

          <div v-else-if="attachDealCandidates.length === 0" class="sf-attach-empty">
            <v-icon icon="mdi-magnify-close" size="28" color="grey-lighten-1" />
            <div class="mt-2">{{ attachSearch ? 'Ничего не найдено' : 'Нет сделок для прикрепления' }}</div>
          </div>

          <div v-else class="sf-attach-list">
            <button
              v-for="d in attachDealCandidates"
              :key="d.id"
              type="button"
              class="sf-attach-row"
              @click="attachDeal(d)"
            >
              <div class="sf-attach-num">#{{ d.dealNumber }}</div>
              <div class="sf-attach-main">
                <div class="sf-attach-product">{{ d.productName }}</div>
                <div class="sf-attach-meta">{{ formatCurrency(d.totalPrice) }}</div>
              </div>
              <span
                class="sf-deal-status"
                :style="{ background: DEAL_STATUS_COLORS[d.status] + '14', color: DEAL_STATUS_COLORS[d.status] }"
              >
                {{ DEAL_STATUS_LABELS[d.status] }}
              </span>
              <span
                v-if="(d as any).assignedStaff"
                class="sf-attach-current"
                :title="`Сейчас: ${(d as any).assignedStaff.firstName} ${(d as any).assignedStaff.lastName}`"
              >
                <v-icon icon="mdi-account-arrow-right-outline" size="12" />
                переназначить
              </span>
            </button>
          </div>
        </div>
      </v-card>
    </v-dialog>

    <!-- Delete Dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card v-if="deleteTarget" rounded="lg" class="pa-6 text-center">
        <div class="sf-delete-icon mb-4">
          <v-icon icon="mdi-alert-circle-outline" size="28" color="#ef4444" />
        </div>
        <div class="text-h6 font-weight-bold mb-2">Удалить сотрудника?</div>
        <div class="text-body-2 text-medium-emphasis mb-6">
          {{ deleteTarget.firstName }} {{ deleteTarget.lastName }} ({{ deleteTarget.email }}) потеряет доступ к платформе
        </div>
        <div class="d-flex ga-3">
          <button class="btn-secondary flex-grow-1" @click="deleteDialog = false">Отмена</button>
          <button class="btn-danger flex-grow-1" :disabled="deleteLoading" @click="confirmDelete">
            <v-progress-circular v-if="deleteLoading" indeterminate size="16" width="2" color="white" class="mr-2" />
            Удалить
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* ── Stats (shared pattern) ── */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
@media (max-width: 960px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 500px) { .stats-row { grid-template-columns: 1fr; } }

.stat-card {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 20px; border-radius: 14px;
  background: rgba(var(--v-theme-surface), 1); border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.stat-card:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.stat-icon {
  width: 40px; height: 40px; min-width: 40px;
  border-radius: 10px; display: flex; align-items: center; justify-content: center;
}
.stat-value {
  font-size: 18px; font-weight: 700; line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.stat-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 2px;
}

/* ── Add button ── */
.sf-add-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 18px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.sf-add-btn:hover {
  background: #065f46;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}

/* ── Info banner ── */
.sf-info-banner {
  display: flex; gap: 14px;
  padding: 16px 18px; border-radius: 12px;
  background: rgba(4, 120, 87, 0.03);
  border: 1px solid rgba(4, 120, 87, 0.08);
}
.sf-info-icon {
  width: 36px; height: 36px; min-width: 36px;
  border-radius: 10px; display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.08);
}
.sf-info-title {
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 4px;
}
.sf-info-text {
  font-size: 12px; line-height: 1.6;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* ── Staff list ── */
.sf-list { display: flex; flex-direction: column; gap: 8px; }

.sf-card {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 14px;
  background: rgba(var(--v-theme-surface), 1);
  overflow: hidden; transition: all 0.2s;
}
.sf-card:hover { border-color: rgba(var(--v-theme-on-surface), 0.15); }
.sf-card--inactive { opacity: 0.6; }

.sf-header {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 18px;
}

.sf-avatar {
  width: 44px; height: 44px; min-width: 44px;
  border-radius: 12px; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 15px; letter-spacing: 0.5px;
}

.sf-main { flex: 1; min-width: 0; }
.sf-name-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.sf-name {
  font-size: 15px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.sf-role-badge {
  display: inline-flex; align-items: center;
  font-size: 11px; font-weight: 700;
  padding: 2px 10px; border-radius: 6px;
}
.sf-meta {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 3px;
}

.sf-stats {
  display: flex; align-items: center; gap: 20px; margin-right: 8px;
}
.sf-stat { text-align: right; }
.sf-stat-value {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  white-space: nowrap;
}
.sf-stat-label {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}

.sf-actions {
  display: flex; align-items: center; gap: 4px;
}
.sf-action-btn {
  display: inline-flex; align-items: center;
  padding: 7px; border-radius: 8px; border: none;
  background: transparent; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.35);
  transition: all 0.15s;
}
.sf-action-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.sf-action-btn--danger:hover {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

/* ── Empty state ── */
.sf-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 48px 24px; text-align: center;
}
.sf-empty-icon {
  width: 80px; height: 80px; border-radius: 20px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 16px;
}
.sf-empty-title {
  font-size: 18px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 6px;
}
.sf-empty-subtitle {
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.4);
  max-width: 320px;
}

/* ── Dialog shared ── */
.dialog-close-sm {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer; transition: background 0.15s;
}
.dialog-close-sm:hover {
  background: rgba(var(--v-theme-on-surface), 0.12);
}

.sf-section-label {
  font-size: 13px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.35);
}

/* ── Role selection cards ── */
.sf-role-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
.sf-role-card {
  position: relative;
  padding: 18px 16px; border-radius: 12px;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.08);
  background: transparent; cursor: pointer;
  text-align: left; transition: all 0.15s;
}
.sf-role-card:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.15);
}
.sf-role-card--active {
  box-shadow: 0 0 0 1px currentColor;
}
.sf-role-card-icon {
  width: 40px; height: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 12px;
}
.sf-role-card-label {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
  margin-bottom: 4px;
}
.sf-role-card-desc {
  font-size: 12px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.sf-role-card-check {
  position: absolute; top: 12px; right: 12px;
}

/* ── Active toggle ── */
.sf-active-toggle {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  cursor: pointer; user-select: none;
  transition: all 0.2s;
}
.sf-active-toggle:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.sf-active-toggle-dot {
  width: 10px; height: 10px; border-radius: 50%;
  flex-shrink: 0;
}
.sf-active-toggle-text { flex: 1; }
.sf-active-toggle-title {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.sf-active-toggle-desc {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-top: 1px;
}
.sf-switch-track {
  width: 36px; height: 20px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.15);
  position: relative; transition: background 0.2s; flex-shrink: 0;
}
.sf-switch-track--on { background: #10b981; }
.sf-switch-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: white; position: absolute; top: 2px; left: 2px;
  transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.sf-switch-track--on .sf-switch-thumb { transform: translateX(16px); }

/* ── Buttons ── */
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 4px; padding: 11px 22px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; color: white; background: #047857;
  cursor: pointer; transition: all 0.15s;
}
.btn-primary:hover { background: #065f46; box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

.btn-secondary {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 11px 22px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  background: transparent; cursor: pointer;
  transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.04); }

.btn-danger {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 4px; padding: 11px 22px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; color: white; background: #ef4444;
  cursor: pointer; transition: all 0.15s;
}
.btn-danger:hover { background: #dc2626; }
.btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Delete dialog icon ── */
.sf-delete-icon {
  width: 56px; height: 56px; border-radius: 50%;
  background: rgba(239, 68, 68, 0.08);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto;
}

/* ── Route checkboxes (per-staff access overrides) ── */
.sf-routes-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.sf-route-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  text-align: left;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.sf-route-card:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.dark .sf-route-card { background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.08); }
.dark .sf-route-card:hover { background: rgba(255,255,255,0.05); }
.sf-route-card--off {
  opacity: 0.5;
  background: transparent;
}
.sf-route-card--off .sf-route-mark { color: rgba(var(--v-theme-on-surface), 0.35); }
.sf-route-card:not(.sf-route-card--off) .sf-route-mark { color: #10b981; }
.sf-route-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-routes-hint {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* ── Split layout shell ── */
.sf-shell {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 0;
  height: calc(100vh - 280px);
  min-height: 480px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 14px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.dark .sf-shell { border-color: rgba(255,255,255,0.06); background: #1a1a26; }

/* LEFT — staff sidebar */
.sf-sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.015);
  min-height: 0;
}
.dark .sf-sidebar { border-right-color: rgba(255,255,255,0.06); background: #16161f; }

.sf-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.dark .sf-sidebar-header { border-bottom-color: rgba(255,255,255,0.06); }
.sf-sidebar-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.sf-sidebar-add {
  width: 32px; height: 32px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.sf-sidebar-add:hover { background: rgba(4, 120, 87, 0.18); }
.dark .sf-sidebar-add { background: rgba(4, 120, 87, 0.18); color: #34d399; }

.sf-sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px 12px;
}

.sf-sidebar-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 16px;
  gap: 8px;
}
.sf-sidebar-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.sf-sidebar-empty-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  max-width: 220px;
}

/* Compact staff row */
.sf-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px;
  margin: 2px 0;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.sf-row:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.dark .sf-row:hover { background: rgba(255,255,255,0.04); }
.sf-row--active { background: rgba(var(--v-theme-primary), 0.08); }
.sf-row--active:hover { background: rgba(var(--v-theme-primary), 0.12); }
.sf-row--inactive { opacity: 0.55; }

.sf-avatar--sm { width: 36px; height: 36px; min-width: 36px; font-size: 13px; border-radius: 10px; }

.sf-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sf-row-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sf-row-name {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sf-row-role {
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}
.sf-row-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.sf-row-meta--off { color: #ef4444; }
.sf-row-badge {
  flex-shrink: 0;
  background: rgb(var(--v-theme-primary));
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
  line-height: 1.4;
}

.sf-row-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.sf-row:hover .sf-row-actions,
.sf-row--active .sf-row-actions { opacity: 1; }

/* RIGHT — chat panel */
.sf-main-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.sf-chat-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  flex-shrink: 0;
}
.dark .sf-chat-bar { border-bottom-color: rgba(255,255,255,0.06); }
.sf-chat-bar-info { flex: 1; min-width: 0; }
.sf-chat-bar-name {
  font-size: 15px;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.sf-chat-bar-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.sf-chat-bar-close {
  width: 32px; height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sf-chat-bar-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.sf-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding: 32px;
}
.sf-placeholder-title {
  font-size: 16px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.sf-placeholder-sub {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  max-width: 360px;
  line-height: 1.5;
}
.sf-placeholder-sub code {
  background: rgba(var(--v-theme-on-surface), 0.06);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}

/* ── Tabs in right panel (Чат / Сделки) ── */
.sf-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 12px 0 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  flex-shrink: 0;
}
.dark .sf-tabs { border-bottom-color: rgba(255,255,255,0.06); }
.sf-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.55);
  transition: color 0.15s, border-color 0.15s;
  margin-bottom: -1px;
}
.sf-tab:hover { color: rgba(var(--v-theme-on-surface), 0.8); }
.sf-tab--active {
  color: rgb(var(--v-theme-primary));
  border-bottom-color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.sf-tab-badge {
  background: rgb(var(--v-theme-primary));
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 8px;
  min-width: 16px;
  text-align: center;
  line-height: 1.4;
}
.sf-tab-badge--neutral {
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* ── Deals tab content ── */
.sf-deals-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 14px 16px;
}
.sf-deals-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.sf-deals-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.sf-deals-count {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 8px;
}
.sf-deals-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  border: none;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.sf-deals-add-btn:hover { background: rgba(var(--v-theme-primary), 0.18); }

.sf-deals-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 40px 20px;
  gap: 4px;
}
.sf-deals-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.sf-deals-empty-sub {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  max-width: 320px;
  line-height: 1.5;
}

.sf-deals-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sf-deal-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgba(var(--v-theme-on-surface), 0.015);
  text-decoration: none;
  color: inherit;
  transition: background 0.15s, border-color 0.15s;
}
.sf-deal-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: rgba(var(--v-theme-on-surface), 0.15);
}
.sf-deal-num {
  flex-shrink: 0;
  font-weight: 700;
  font-size: 13px;
  color: rgb(var(--v-theme-primary));
  min-width: 40px;
}
.sf-deal-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sf-deal-product {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sf-deal-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.sf-deal-status {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
}
.sf-deal-detach {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.35);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.sf-deal-row:hover .sf-deal-detach { opacity: 1; }
.sf-deal-detach:hover {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

/* ── Attach Deal Dialog ── */
.sf-attach-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.sf-attach-search-icon {
  position: absolute;
  left: 10px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.sf-attach-search-input {
  width: 100%;
  padding: 9px 10px 9px 32px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.95);
  outline: none;
}
.sf-attach-search-input:focus { border-color: rgb(var(--v-theme-primary)); }

.sf-attach-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.sf-attach-list {
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sf-attach-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.015);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}
.sf-attach-row:hover { background: rgba(var(--v-theme-primary), 0.06); }
.sf-attach-num {
  flex-shrink: 0;
  font-weight: 700;
  font-size: 13px;
  color: rgb(var(--v-theme-primary));
  min-width: 40px;
}
.sf-attach-main {
  flex: 1;
  min-width: 0;
}
.sf-attach-product {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sf-attach-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.sf-attach-current {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.08);
  padding: 2px 7px;
  border-radius: 6px;
  font-weight: 600;
}
</style>
