<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useIsMobile } from '@/composables/useIsMobile'
import { useChats } from '@/composables/useChats'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useAccountingStore } from '@/stores/accounting'
import ChatPanel from '@/components/ChatPanel.vue'
import RolesManager from '@/components/RolesManager.vue'
import SelectField from '@/components/SelectField.vue'
import type { StaffMember, StaffRole, DealsAccessMode, Deal, DealStatus, StaffRoleTemplate, ActivityLog } from '@/types'
import { STAFF_ROLE_LABELS } from '@/types'
import StaffActivityFeed from '@/components/staff/StaffActivityFeed.vue'
import { formatCurrency, pluralizeRu } from '@/utils/formatters'

const { isDark } = useIsDark()
const toast = useToast()
const { isMobile } = useIsMobile()
const router = useRouter()
const route = useRoute()
const cashBoxesStore = useCashBoxesStore()
const accountingStore = useAccountingStore()

const staff = ref<StaffMember[]>([])
const pageLoading = ref(true)

// Вкладки страницы: список сотрудников | управление ролями.
const activeMainTab = ref<'staff' | 'roles'>('staff')

// Add dialog
const addDialog = ref(false)
const addLoading = ref(false)
/**
 * Новый сотрудник заводится сразу на роли из новой системы прав.
 *
 * Старые роли (менеджер / оператор) остались только у тех, кого завели до
 * ролей, — новым их выдавать незачем. Оператор пункта приёма — исключение: у
 * него не права, а список пунктов и отдельный кабинет, поэтому он остался
 * отдельным видом сотрудника.
 */
const addForm = ref({
  email: '',
  firstName: '',
  lastName: '',
  roleId: null as string | null,
  pointOperator: false,
})

// Edit dialog
const editDialog = ref(false)
const editLoading = ref(false)
const editTarget = ref<StaffMember | null>(null)
const editForm = ref({
  roleId: null as string | null,
  role: 'MANAGER' as StaffRole,
  isActive: true,
  dealsAccessMode: 'ALL' as DealsAccessMode,
  cashBoxOverrides: [] as string[],
  // Пункты приёма оператора — белый список, поэтому пустой массив означает
  // «доступа нет», а не «доступ ко всему», как у списка скрытых касс.
  assignedAccountIds: [] as string[],
  // Права, выданные этому человеку поимённо сверх роли.
  extraPermissions: [] as string[],
})

/** Редактируем оператора пункта: у него нет ни ролей, ни касс — только пункты. */
const isEditingPointOperator = computed(() => editForm.value.role === 'POINT_OPERATOR')

const paymentPoints = computed(() =>
  accountingStore.accounts.filter((a) => a.type === 'PAYMENT_POINT'),
)

/** Право «простить остаток» — единственное, что можно выдать оператору пункта. */
const canForgive = computed(() => editForm.value.extraPermissions.includes('payments.forgive'))
function toggleForgive() {
  const list = editForm.value.extraPermissions
  const i = list.indexOf('payments.forgive')
  if (i >= 0) list.splice(i, 1)
  else list.push('payments.forgive')
}

function togglePoint(id: string) {
  const idx = editForm.value.assignedAccountIds.indexOf(id)
  if (idx >= 0) editForm.value.assignedAccountIds.splice(idx, 1)
  else editForm.value.assignedAccountIds.push(id)
}

// Роли для пикера в модалке редактирования.
const roles = ref<StaffRoleTemplate[]>([])

/** Роли для нашего селекта: справа — сколько действий открывает роль. */
const roleOptions = computed(() =>
  roles.value.map((r) => ({
    value: r.id,
    label: r.name,
    hint: `${r.permissions?.length ?? 0} ${pluralizeRu(r.permissions?.length ?? 0, 'право', 'права', 'прав')}`,
  })),
)
async function loadRoles() {
  try { roles.value = await api.get<StaffRoleTemplate[]>('/auth/investor/roles') } catch { /* noop */ }
}

// Закрыть модалку и открыть вкладку «Роли».
function goToRolesTab() {
  editDialog.value = false
  addDialog.value = false
  activeMainTab.value = 'roles'
}

// Routes available to toggle for the current edit target — intersection of
// the role's base set with the toggleable list.
// ── Cashbox access (deny-list) ──
const allCashBoxes = computed(() => cashBoxesStore.items)

function isCashBoxEnabled(id: string): boolean {
  return !editForm.value.cashBoxOverrides.includes(id)
}

function toggleCashBox(id: string) {
  const idx = editForm.value.cashBoxOverrides.indexOf(id)
  if (idx >= 0) editForm.value.cashBoxOverrides.splice(idx, 1)
  else editForm.value.cashBoxOverrides.push(id)
}

// Count of cashboxes visible to the staff (total − hidden).
const visibleCashBoxCount = computed(() => {
  const hidden = editForm.value.cashBoxOverrides.filter((id) =>
    allCashBoxes.value.some((b) => b.id === id),
  ).length
  return allCashBoxes.value.length - hidden
})

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
type RightPanelTab = 'chat' | 'deals' | 'activity'
const activeTab = ref<RightPanelTab>('chat')

// Assigned deals — loaded when partner selects a staff and opens "Сделки" tab
const assignedDeals = ref<Deal[]>([])
const assignedDealsLoading = ref(false)

// История операций сотрудника — все его действия (activity log по actorId).
const staffActivity = ref<ActivityLog[]>([])
const staffActivityLoading = ref(false)
async function loadStaffActivity() {
  if (!selectedStaff.value) { staffActivity.value = []; return }
  staffActivityLoading.value = true
  try {
    const res = await api.get<{ items: ActivityLog[] }>(
      `/activity?actorId=${selectedStaff.value.id}&limit=100`,
    )
    staffActivity.value = res.items
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить историю операций')
  } finally {
    staffActivityLoading.value = false
  }
}

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
  if (tab === 'activity' && staff) loadStaffActivity()
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

/**
 * Кандидаты на прикрепление. Ищет и отбирает сервер: раньше окно выкачивало
 * ВЕСЬ портфель партнёра и фильтровало его в браузере — на пятнадцати тысячах
 * сделок оно открывалось секундами.
 *
 * Сначала показываем активные (их и прикрепляют чаще всего), а когда их не
 * хватает до полусотни — добираем остальными, кроме отменённых.
 */
let attachReq = 0

async function loadAttachCandidates() {
  if (!selectedStaff.value) return
  const req = ++attachReq
  attachLoading.value = true
  try {
    const base = new URLSearchParams({
      role: 'investor',
      excludeStaffId: selectedStaff.value.id,
      sort: 'createdAt',
      dir: 'desc',
      limit: '50',
    })
    if (attachSearch.value.trim()) base.set('q', attachSearch.value.trim())

    const active = new URLSearchParams(base)
    active.set('status', 'ACTIVE,DISPUTED')
    const activeRes = await api.get<{ items: Deal[]; total: number }>(`/deals?${active}`)
    if (req !== attachReq) return

    let rows = activeRes.items
    if (rows.length < 50) {
      const rest = new URLSearchParams(base)
      rest.set('status', 'COMPLETED')
      rest.set('limit', String(50 - rows.length))
      const restRes = await api.get<{ items: Deal[]; total: number }>(`/deals?${rest}`)
      if (req !== attachReq) return
      rows = [...rows, ...restRes.items]
    }
    allInvestorDeals.value = rows
  } catch (e: any) {
    if (req === attachReq) toast.error(e.message || 'Не удалось загрузить сделки')
  } finally {
    if (req === attachReq) attachLoading.value = false
  }
}

let attachSearchTimer: ReturnType<typeof setTimeout> | null = null
watch(attachSearch, () => {
  if (!attachDialog.value) return
  if (attachSearchTimer) clearTimeout(attachSearchTimer)
  attachSearchTimer = setTimeout(loadAttachCandidates, 350)
})

function openAttachDialog() {
  attachSearch.value = ''
  attachDialog.value = true
  allInvestorDeals.value = []
  loadAttachCandidates()
}

const attachDealCandidates = computed(() => allInvestorDeals.value)

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
  POINT_OPERATOR: '#8b5cf6',
}

const ROLE_ICONS: Record<StaffRole, string> = {
  MANAGER: 'mdi-shield-account',
  OPERATOR: 'mdi-account-hard-hat',
  POINT_OPERATOR: 'mdi-storefront-outline',
}

// Бейдж роли. Пока сотрудник не переведён на роль (roleId пуст), права берутся
// из старой системы, и правка ролей на него НЕ действует — раньше здесь всегда
// показывалось старое название роли, неотличимое от одноимённой новой роли.
function roleTag(m: StaffMember) {
  if (m.roleName) {
    return {
      label: m.roleName,
      legacy: false,
      icon: ROLE_ICONS[m.role],
      color: ROLE_COLORS[m.role],
    }
  }
  return {
    label: `Старые права · ${STAFF_ROLE_LABELS[m.role]}`,
    legacy: true,
    icon: 'mdi-alert-outline',
    color: '#b45309',
  }
}

// Сколько работающих сотрудников ещё не переведено на роли.
const legacyStaffCount = computed(
  () => staff.value.filter((m) => m.isActive && !m.roleId).length,
)

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
  addForm.value = {
    email: '',
    firstName: '',
    lastName: '',
    roleId: null,
    pointOperator: false,
  }
  addDialog.value = true
  if (!roles.value.length) loadRoles()
}

async function addStaffMember() {
  addLoading.value = true
  try {
    const { email, firstName, lastName, roleId, pointOperator } = addForm.value
    // Легаси-роль не шлём: сервер сам поставит минимальную, а права даёт roleId.
    const created = await api.post<StaffMember>('/auth/investor/staff', {
      email,
      firstName,
      lastName,
      ...(pointOperator ? { role: 'POINT_OPERATOR' } : { roleId }),
    })
    toast.success('Сотрудник добавлен. Данные для входа отправлены на email.')
    addDialog.value = false
    await loadStaff()
    // Оператору без назначенных пунктов работать негде, поэтому сразу
    // открываем доступы — иначе об этом вспоминают, когда он не может принять
    // первый платёж.
    if (pointOperator) {
      const fresh = staff.value.find((m) => m.id === created.id)
      if (fresh) openEdit(fresh)
    }
  } catch (e: any) {
    toast.error(e.message || 'Ошибка при добавлении')
  } finally {
    addLoading.value = false
  }
}

function openEdit(member: StaffMember) {
  editTarget.value = member
  editForm.value = {
    roleId: member.roleId ?? null,
    role: member.role,
    isActive: member.isActive,
    dealsAccessMode: member.dealsAccessMode || 'ALL',
    cashBoxOverrides: [...(member.cashBoxOverrides || [])],
    assignedAccountIds: [...(member.assignedAccountIds || [])],
    extraPermissions: [...(member.extraPermissions || [])],
  }
  editDialog.value = true
  if (member.role === 'POINT_OPERATOR' && !accountingStore.accounts.length) {
    accountingStore.fetchAccounts().catch(() => {})
  }
  if (!cashBoxesStore.items.length) cashBoxesStore.fetchAll().catch(() => {})
  if (!roles.value.length) loadRoles()
}

async function saveEdit() {
  if (!editTarget.value) return
  editLoading.value = true
  try {
    // Отправляем только новую модель: роль + индивидуальный скоуп.
    await api.patch(`/auth/investor/staff/${editTarget.value.id}`, {
      // У оператора пункта нет ни роли, ни доступа к сделкам и кассам —
      // отправлять эти поля значило бы навязать ему чужую модель доступа.
      ...(isEditingPointOperator.value
        ? {
            assignedAccountIds: editForm.value.assignedAccountIds,
            extraPermissions: editForm.value.extraPermissions,
          }
        : {
            roleId: editForm.value.roleId,
            dealsAccessMode: editForm.value.dealsAccessMode,
            cashBoxOverrides: editForm.value.cashBoxOverrides,
          }),
      isActive: editForm.value.isActive,
    })
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
  addForm.value.lastName.length >= 2 &&
  // Без роли сотрудник не увидит ничего: пусть выбор будет обязательным.
  (addForm.value.pointOperator || !!addForm.value.roleId)
)

const activeCount = computed(() => staff.value.filter((s) => s.isActive).length)
const offCount = computed(() => staff.value.filter((s) => !s.isActive).length)
/** Непрочитанные сообщения по всем сотрудникам — повод открыть чат. */
const unreadTotal = computed(() =>
  staff.value.reduce((sum, m) => sum + staffUnread(m.id), 0),
)

// ─── Поиск и отбор в списке ─────────────────────────────────────────
// У партнёра с пятнадцатью работниками список перестаёт читаться: нужного
// ищут глазами сверху вниз. Поиск по имени и почте плюс отбор по состоянию
// решают это, не заставляя открывать чужие карточки.
const search = ref('')
const statusFilter = ref<'all' | 'active' | 'off'>('all')
const roleFilter = ref<StaffRole | null>(null)

const filteredStaff = computed(() => {
  const q = search.value.trim().toLowerCase()
  return staff.value.filter((m) => {
    if (statusFilter.value === 'active' && !m.isActive) return false
    if (statusFilter.value === 'off' && m.isActive) return false
    if (roleFilter.value && m.role !== roleFilter.value) return false
    if (!q) return true
    return (
      `${m.firstName} ${m.lastName}`.toLowerCase().includes(q) ||
      (m.email ?? '').toLowerCase().includes(q)
    )
  })
})

const filtersOn = computed(
  () => !!search.value.trim() || statusFilter.value !== 'all' || roleFilter.value !== null,
)

function resetFilters() {
  search.value = ''
  statusFilter.value = 'all'
  roleFilter.value = null
}

/** Короткая строка под именем: что человеку доступно, без открытия карточки. */
function accessLine(m: StaffMember): string {
  if (m.role === 'POINT_OPERATOR') return 'Только свои пункты приёма'
  const parts: string[] = []
  parts.push(m.dealsAccessMode === 'ASSIGNED_ONLY' ? 'Только назначенные сделки' : 'Все сделки')
  const hidden = m.cashBoxOverrides?.length ?? 0
  if (hidden > 0) parts.push(`${hidden} ${hidden === 1 ? 'касса скрыта' : 'кассы скрыты'}`)
  if (!m.canCreateDeals) parts.push('без создания сделок')
  return parts.join(' · ')
}

onMounted(async () => {
  await loadStaff()
  // Пришли с профиля сотрудника по кнопке «Написать» — сразу открываем его
  // переписку, иначе кнопка приводила бы просто в список.
  const wanted = route.query.staff
  if (typeof wanted === 'string') {
    const m = staff.value.find((x) => x.id === wanted)
    if (m) void selectStaff(m)
  }
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
      <!-- Табы: Сотрудники | Роли -->
      <div class="page-tabs-row">
        <div class="page-tabs">
          <button class="page-tab" :class="{ 'page-tab--active': activeMainTab === 'staff' }" @click="activeMainTab = 'staff'">
            <v-icon icon="mdi-account-group" size="18" /> Сотрудники
          </button>
          <button class="page-tab" :class="{ 'page-tab--active': activeMainTab === 'roles' }" @click="activeMainTab = 'roles'">
            <v-icon icon="mdi-shield-key-outline" size="18" /> Роли
          </button>
        </div>
        <div class="page-tabs-actions">
          <!-- Главное действие раздела стоит на виду: раньше сотрудника
               добавляли плюсиком в шапке узкого списка. -->
          <button v-if="activeMainTab === 'staff'" class="sf-primary-btn" @click="openAdd">
            <v-icon icon="mdi-account-plus-outline" size="16" />
            Добавить сотрудника
          </button>
        </div>
      </div>

      <!-- Роли живут в такой же панели, что и список сотрудников: без неё
           вкладка висела прямо на фоне страницы и выглядела чужой. -->
      <div v-if="activeMainTab === 'roles'" class="sf-panel">
        <RolesManager />
      </div>

      <!-- Показатели: сколько людей и что требует внимания. Разбивка по ролям
           отсюда убрана — она видна в самом списке и ничего не решала. -->
      <div v-if="activeMainTab === 'staff'" class="stats-row mb-6">
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
            <div class="stat-label">Работают сейчас</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(148, 163, 184, 0.18); color: #64748b;">
            <v-icon icon="mdi-account-off-outline" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ offCount }}</div>
            <div class="stat-label">Отключены</div>
          </div>
        </div>
        <button class="stat-card stat-card--action" :disabled="!unreadTotal" @click="statusFilter = 'all'">
          <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
            <v-icon icon="mdi-message-text-outline" size="20" />
          </div>
          <div>
            <div class="stat-value">{{ unreadTotal }}</div>
            <div class="stat-label">Непрочитанных сообщений</div>
          </div>
        </button>
      </div>

      <!-- Пока сотрудник не переведён на роль, права ему даёт старая система:
           правка роли с тем же названием на него не подействует. Это молча
           сбивало с толку — теперь говорим прямо. -->
      <div v-if="activeMainTab === 'staff' && legacyStaffCount" class="sf-legacy-banner mb-4">
        <v-icon icon="mdi-alert-outline" size="18" />
        <div class="sf-legacy-banner-text">
          <b>{{ legacyStaffCount }} {{ legacyStaffCount === 1 ? 'сотрудник работает' : 'сотрудников работают' }} на старых правах.</b>
          Изменения ролей на них не действуют: права берутся из старой системы.
          Откройте «Доступы и роль» и назначьте роль, чтобы права считались по ней.
        </div>
      </div>

      <!-- Split: staff list (left) + chat panel (right) -->
      <div v-if="activeMainTab === 'staff'" class="sf-shell">
        <!-- LEFT: staff list -->
        <aside class="sf-sidebar">
          <header class="sf-sidebar-header">
            <span class="sf-sidebar-title">Сотрудники</span>
            <span class="sf-sidebar-count">{{ filteredStaff.length }}</span>
          </header>

          <!-- Поиск и отбор: у партнёра с полутора десятками работников нужного
               иначе ищут глазами сверху вниз. -->
          <div class="sf-search">
            <v-icon icon="mdi-magnify" size="16" class="sf-search-icon" />
            <input v-model="search" type="text" class="sf-search-input" placeholder="Имя или почта" />
            <button v-if="search" class="sf-search-clear" title="Очистить" @click="search = ''">
              <v-icon icon="mdi-close" size="14" />
            </button>
          </div>

          <div class="sf-filters">
            <button
              v-for="f in [
                { key: 'all', label: 'Все' },
                { key: 'active', label: 'Работают' },
                { key: 'off', label: 'Отключены' },
              ]"
              :key="f.key"
              class="sf-chip"
              :class="{ 'sf-chip--on': statusFilter === f.key }"
              @click="statusFilter = f.key as 'all' | 'active' | 'off'"
            >
              {{ f.label }}
            </button>
          </div>

          <div v-if="filteredStaff.length" class="sf-sidebar-list">
            <div
              v-for="m in filteredStaff"
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
                  <span v-if="!m.isActive" class="sf-row-off">выкл</span>
                  <span v-if="staffUnread(m.id) > 0" class="sf-row-badge">
                    {{ staffUnread(m.id) > 99 ? '99+' : staffUnread(m.id) }}
                  </span>
                </div>
                <!-- Роль бейджем, как статусы в остальных разделах: подпись
                     с иконкой ломалась на две строки и читалась как ссылка. -->
                <div class="sf-row-line sf-row-line--sub">
                  <span
                    class="sf-role-tag"
                    :style="{ background: roleTag(m).color + '14', color: roleTag(m).color }"
                    :title="roleTag(m).legacy ? 'Сотрудник не переведён на роли — изменения ролей на него не влияют' : 'Роль из раздела «Роли»'"
                  >
                    <v-icon :icon="roleTag(m).icon" size="11" />
                    {{ roleTag(m).label }}
                  </span>
                </div>
                <!-- Что человеку доступно — прямо в списке: главный вопрос к
                     сотруднику именно этот, а почта видна в шапке справа. -->
                <div class="sf-row-access">{{ accessLine(m) }}</div>
              </div>

              <!-- Действия — одним меню: три иконки на наведении не работали
                   на планшете и не помещались рядом с длинным именем. -->
              <v-menu location="bottom end">
                <template #activator="{ props: act }">
                  <button v-bind="act" class="sf-row-more" title="Действия" @click.stop>
                    <v-icon icon="mdi-dots-vertical" size="16" />
                  </button>
                </template>
                <div class="sf-menu">
                  <button class="sf-menu-item" @click="router.push(`/staff/${m.id}`)">
                    <v-icon icon="mdi-chart-box-outline" size="16" />
                    Профиль и статистика
                  </button>
                  <button class="sf-menu-item" @click="openEdit(m)">
                    <v-icon icon="mdi-pencil-outline" size="16" />
                    Доступы и роль
                  </button>
                  <div class="sf-menu-sep" />
                  <button class="sf-menu-item sf-menu-item--danger" @click="openDelete(m)">
                    <v-icon icon="mdi-delete-outline" size="16" />
                    Удалить
                  </button>
                </div>
              </v-menu>
            </div>
          </div>

          <!-- Ничего не нашли по фильтрам — это не «нет сотрудников». -->
          <div v-else-if="staff.length" class="sf-sidebar-empty">
            <v-icon icon="mdi-magnify" size="30" color="grey-lighten-1" />
            <div class="sf-sidebar-empty-title">Никого не нашли</div>
            <div class="sf-sidebar-empty-sub">Попробуйте другое имя или снимите отбор</div>
            <button v-if="filtersOn" class="sf-ghost-btn mt-3" @click="resetFilters">Сбросить</button>
          </div>

          <!-- Sidebar empty state -->
          <div v-else class="sf-sidebar-empty">
            <v-icon icon="mdi-account-key-outline" size="32" color="grey-lighten-1" />
            <div class="sf-sidebar-empty-title">Нет сотрудников</div>
            <div class="sf-sidebar-empty-sub">Добавьте первого — он получит доступ на почту</div>
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
                <div class="sf-chat-bar-name">
                  {{ selectedStaff.firstName }} {{ selectedStaff.lastName }}
                  <span
                    class="sf-role-tag"
                    :style="{ background: roleTag(selectedStaff).color + '14', color: roleTag(selectedStaff).color }"
                  >
                    <v-icon :icon="roleTag(selectedStaff).icon" size="11" />
                    {{ roleTag(selectedStaff).label }}
                  </span>
                  <button
                    v-if="roleTag(selectedStaff).legacy"
                    class="sf-legacy-fix"
                    title="Назначить роль из раздела «Роли»"
                    @click="openEdit(selectedStaff)"
                  >
                    Назначить роль
                  </button>
                  <span v-if="!selectedStaff.isActive" class="sf-row-off">отключён</span>
                </div>
                <!-- Что человеку доступно — сразу под именем: раньше это можно
                     было узнать, только открыв окно правки. -->
                <div class="sf-chat-bar-sub">{{ selectedStaff.email }} · {{ accessLine(selectedStaff) }}</div>
              </div>
              <div class="sf-chat-bar-actions">
                <button class="sf-ghost-btn" @click="router.push(`/staff/${selectedStaff.id}`)">
                  <v-icon icon="mdi-chart-box-outline" size="15" />
                  Профиль
                </button>
                <button class="sf-ghost-btn" @click="openEdit(selectedStaff)">
                  <v-icon icon="mdi-pencil-outline" size="15" />
                  Доступы
                </button>
                <button class="sf-chat-bar-close" title="Закрыть" @click="closeSelected">
                  <v-icon icon="mdi-close" size="18" />
                </button>
              </div>
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
              <button
                class="sf-tab"
                :class="{ 'sf-tab--active': activeTab === 'activity' }"
                @click="activeTab = 'activity'"
              >
                <v-icon icon="mdi-history" size="14" />
                <span>История операций</span>
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
            <div v-else-if="activeTab === 'deals'" class="sf-deals-tab">
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

            <!-- Activity tab -->
            <div v-else-if="activeTab === 'activity'" class="sf-act-tab">
              <div v-if="staffActivityLoading" class="d-flex justify-center pa-6">
                <v-progress-circular indeterminate size="20" color="primary" />
              </div>
              <div v-else-if="staffActivity.length === 0" class="sf-deals-empty">
                <v-icon icon="mdi-history" size="32" color="grey-lighten-1" />
                <div class="sf-deals-empty-title">Пока нет операций</div>
                <div class="sf-deals-empty-sub">
                  Здесь появятся все действия сотрудника: сделки, платежи, изменения и т.д.
                </div>
              </div>
              <StaffActivityFeed v-else :items="staffActivity" compact />
            </div>
          </template>

          <!-- Пока никто не выбран, панель не пустует: здесь коротко сказано,
               что тут можно сделать, и стоят те же действия раздела. -->
          <div v-else class="sf-placeholder">
            <div class="sf-placeholder-icon">
              <v-icon icon="mdi-account-group-outline" size="30" />
            </div>
            <div class="sf-placeholder-title">Выберите сотрудника слева</div>
            <div class="sf-placeholder-sub">
              Откроется переписка с ним, назначенные сделки и история его действий.
              В сообщениях можно ссылаться на сделку через <code>#номер</code>.
            </div>
            <div class="sf-placeholder-acts">
              <button class="sf-primary-btn" @click="openAdd">
                <v-icon icon="mdi-account-plus-outline" size="16" />
                Добавить сотрудника
              </button>
              <button class="sf-ghost-btn" @click="activeMainTab = 'roles'">
                <v-icon icon="mdi-shield-key-outline" size="15" />
                Настроить роли
              </button>
            </div>
          </div>
        </section>
      </div>
    </template>

    <!-- Add Dialog -->
    <v-dialog v-model="addDialog" max-width="480" :fullscreen="isMobile">
      <v-card rounded="lg">
        <div class="pa-6">
          <div class="d-flex align-center justify-space-between mb-5">
            <div>
              <div class="text-h6 font-weight-bold">Новый сотрудник</div>
              <div class="text-caption text-medium-emphasis">Заведите человека и выдайте ему роль</div>
            </div>
            <button class="dialog-close-sm" @click="addDialog = false">
              <v-icon icon="mdi-close" size="18" />
            </button>
          </div>

          <!-- Поля как в остальных окнах: подпись сверху, инпут 40 px.
               Плавающие подписи Vuetify выбивались из общего вида форм. -->
          <div class="sf-form">
            <div class="sf-form-row">
              <div class="sf-field">
                <label class="sf-label">Фамилия</label>
                <input v-model="addForm.lastName" type="text" class="sf-input" placeholder="Магомедов" />
              </div>
              <div class="sf-field">
                <label class="sf-label">Имя</label>
                <input v-model="addForm.firstName" type="text" class="sf-input" placeholder="Ахмед" />
              </div>
            </div>
            <div class="sf-field">
              <label class="sf-label">Почта для входа</label>
              <input v-model="addForm.email" type="email" class="sf-input" placeholder="name@example.com" />
              <div class="sf-field-hint">На неё придут логин и пароль — это и есть доступ в систему</div>
            </div>
          </div>

          <div class="mb-6">
            <div class="sf-section-label mb-3">Роль</div>

            <!-- Права выдаёт роль из новой системы. Старые роли остались лишь
                 у заведённых раньше — новым их не предлагаем. -->
            <template v-if="!addForm.pointOperator">
              <SelectField
                v-model="addForm.roleId"
                :options="roleOptions"
                :placeholder="roles.length ? 'Выберите роль' : 'Ролей пока нет'"
                :disabled="!roles.length"
              />
              <div class="sf-field-hint mt-2">
                {{
                  roles.length
                    ? 'Роль решает, что сотрудник видит и может делать. Доступ к кассам и сделкам настраивается после добавления.'
                    : 'Ролей пока нет — заведите первую на вкладке «Роли», там видно, какие действия она открывает.'
                }}
              </div>
              <button type="button" class="sf-goto-roles" @click="goToRolesTab">
                <v-icon icon="mdi-shield-key-outline" size="15" />
                Управлять ролями
              </button>
            </template>

            <!-- Оператор пункта приёма: у него не права, а список пунктов и
                 свой кабинет, поэтому это отдельный вид сотрудника. -->
            <div
              class="sf-active-toggle mt-3"
              :class="{ 'sf-active-toggle--off': !addForm.pointOperator }"
              @click="addForm.pointOperator = !addForm.pointOperator"
            >
              <div
                class="sf-active-toggle-dot"
                :style="{ background: addForm.pointOperator ? '#f59e0b' : '#9ca3af' }"
              />
              <div class="sf-active-toggle-text">
                <div class="sf-active-toggle-title">Оператор пункта приёма</div>
                <div class="sf-active-toggle-desc">
                  {{
                    addForm.pointOperator
                      ? 'Отдельный кабинет: только приём платежей в своих пунктах. Пункты назначим сразу после добавления'
                      : 'Отдельный кабинет для приёма платежей вместо обычных прав'
                  }}
                </div>
              </div>
              <div class="sf-switch-track" :class="{ 'sf-switch-track--on': addForm.pointOperator }">
                <div class="sf-switch-thumb" />
              </div>
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
    <v-dialog v-model="editDialog" max-width="440" :fullscreen="isMobile">
      <v-card v-if="editTarget" rounded="lg">
        <div class="pa-6">
          <div class="d-flex align-center justify-space-between mb-5">
            <div>
              <div class="text-h6 font-weight-bold">Доступы и роль</div>
              <div class="text-caption text-medium-emphasis">{{ editTarget.firstName }} {{ editTarget.lastName }} · {{ editTarget.email }}</div>
            </div>
            <button class="dialog-close-sm" @click="editDialog = false">
              <v-icon icon="mdi-close" size="18" />
            </button>
          </div>

          <!-- Оператор пункта: ни ролей, ни касс — только его пункты. -->
          <div v-if="isEditingPointOperator" class="mb-5">
            <div class="d-flex align-center justify-space-between mb-3">
              <div class="sf-section-label">Пункты приёма</div>
              <span v-if="editForm.assignedAccountIds.length" class="sf-cashbox-count">
                назначено {{ editForm.assignedAccountIds.length }}
              </span>
            </div>

            <div class="sf-legacy-note mb-3">
              <v-icon icon="mdi-information-outline" size="15" />
              Оператор видит только приём платежей и кассу своих пунктов. Остальные разделы ему закрыты.
            </div>

            <div v-if="paymentPoints.length" class="sf-routes-grid">
              <button
                v-for="p in paymentPoints"
                :key="p.id"
                type="button"
                class="sf-route-card"
                :class="{ 'sf-route-card--off': !editForm.assignedAccountIds.includes(p.id) }"
                @click="togglePoint(p.id)"
              >
                <span class="sf-cashbox-dot" :style="{ background: p.color }">
                  <v-icon icon="mdi-storefront-outline" size="12" color="white" />
                </span>
                <span class="sf-route-label">{{ p.name }}</span>
                <v-icon
                  :icon="editForm.assignedAccountIds.includes(p.id) ? 'mdi-check-circle' : 'mdi-close-circle-outline'"
                  size="16"
                  class="sf-route-mark"
                />
              </button>
            </div>
            <div v-else class="sf-routes-hint">
              Пунктов приёма пока нет — заведите счёт типа «Пункт приёма» в разделе «Бухгалтерия»
            </div>
            <div v-if="!editForm.assignedAccountIds.length" class="sf-routes-hint">
              Пока ни один пункт не выбран, оператор не сможет принимать платежи
            </div>

            <!-- Прощение остатка списывает заработок партнёра, поэтому это
                 отдельное решение по конкретному человеку, а не свойство роли. -->
            <div
              class="sf-active-toggle mt-4"
              :class="{ 'sf-active-toggle--off': !canForgive }"
              @click="toggleForgive"
            >
              <div class="sf-active-toggle-dot" :style="{ background: canForgive ? '#10b981' : '#9ca3af' }" />
              <div class="sf-active-toggle-text">
                <div class="sf-active-toggle-title">Может закрывать договор со скидкой</div>
                <div class="sf-active-toggle-desc">
                  {{
                    canForgive
                      ? 'Сможет простить остаток при досрочном погашении — это ваш заработок'
                      : 'Принимает только платежи, простить остаток не может'
                  }}
                </div>
              </div>
              <div class="sf-switch-track" :class="{ 'sf-switch-track--on': canForgive }">
                <div class="sf-switch-thumb" />
              </div>
            </div>
          </div>

          <div v-if="!isEditingPointOperator" class="mb-5">
            <div class="sf-section-label mb-3">Роль</div>
            <div v-if="!editForm.roleId" class="sf-legacy-note mb-3">
              <v-icon icon="mdi-information-outline" size="15" />
              Сейчас на старой роли «{{ STAFF_ROLE_LABELS[editForm.role] }}». Выберите роль, чтобы перевести на новую систему прав.
            </div>
            <SelectField
              v-model="editForm.roleId"
              :options="roleOptions"
              :placeholder="roles.length ? 'Выберите роль' : 'Ролей пока нет'"
              :disabled="!roles.length"
            />
            <button type="button" class="sf-goto-roles" @click="goToRolesTab">
              <v-icon icon="mdi-shield-key-outline" size="15" />
              Управлять ролями
            </button>
          </div>

          <div v-if="!isEditingPointOperator" class="mb-5">
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

          <div v-if="!isEditingPointOperator" class="mb-5">
            <div class="d-flex align-center justify-space-between mb-3">
              <div class="sf-section-label">Доступ к кассам</div>
              <span
                v-if="allCashBoxes.length && visibleCashBoxCount < allCashBoxes.length"
                class="sf-cashbox-count"
              >
                видит {{ visibleCashBoxCount }} из {{ allCashBoxes.length }}
              </span>
            </div>

            <div v-if="allCashBoxes.length" class="sf-routes-grid">
              <button
                v-for="b in allCashBoxes"
                :key="b.id"
                type="button"
                class="sf-route-card"
                :class="{ 'sf-route-card--off': !isCashBoxEnabled(b.id) }"
                @click="toggleCashBox(b.id)"
              >
                <span class="sf-cashbox-dot" :style="{ background: b.color }">
                  <v-icon :icon="b.icon" size="12" color="white" />
                </span>
                <span class="sf-route-label">{{ b.name }}</span>
                <v-icon
                  :icon="isCashBoxEnabled(b.id) ? 'mdi-check-circle' : 'mdi-close-circle-outline'"
                  size="16"
                  class="sf-route-mark"
                />
              </button>
            </div>
            <div v-else class="sf-routes-hint">Касс пока нет</div>
            <div v-if="allCashBoxes.length" class="sf-routes-hint">Снимите галку, чтобы скрыть кассу у работника</div>
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
    <v-dialog v-model="attachDialog" max-width="560" :fullscreen="isMobile">
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
    <v-dialog v-model="deleteDialog" max-width="400" :fullscreen="isMobile">
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
/* Панель раздела — общая рамка для вкладок. */
.sf-panel {
  padding: 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
}
.dark .sf-panel { border-color: rgba(255, 255, 255, 0.06); background: rgb(var(--v-theme-surface-deep)); }

/* ── Поля форм раздела ── */
.sf-form { display: flex; flex-direction: column; margin-bottom: 22px; }
.sf-form-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 480px) { .sf-form-row { grid-template-columns: minmax(0, 1fr); } }
.sf-field { margin-bottom: 12px; min-width: 0; }
.sf-label {
  display: block; font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 4px;
}
.sf-input {
  width: 100%; height: 40px; padding: 0 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 14px; outline: none; transition: border-color 0.15s;
}
.sf-input:focus { border-color: rgba(4, 120, 87, 0.5); }
.sf-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.32); }
.sf-field-hint {
  margin-top: 5px; font-size: 11.5px; line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* ── Действия раздела ── */
/* Высота — как у плашки вкладок слева (44 px): стоят в одной строке и должны
   читаться как одна полоса, а не кнопка на фоне блока. */
.sf-primary-btn {
  display: inline-flex; align-items: center; gap: 7px;
  height: 44px; padding: 0 16px; border-radius: 12px;
  border: 1px solid #047857; background: #047857; color: #fff;
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
  box-shadow: 0 1px 3px rgba(4, 120, 87, 0.2);
  transition: background 0.15s, box-shadow 0.15s;
}
.sf-primary-btn:hover { background: #036b4e; box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25); }
.sf-ghost-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; cursor: pointer;
  font-size: 12.5px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
  transition: border-color 0.15s, color 0.15s;
}
.sf-ghost-btn:hover { border-color: rgba(4, 120, 87, 0.4); color: #047857; }

/* Плитка «Непрочитанных» — кнопка, поэтому сбрасываем вид кнопки. */
.stat-card--action { text-align: left; cursor: pointer; font: inherit; }
.stat-card--action:disabled { cursor: default; }

/* ── Поиск и отбор в списке ── */
.sf-search {
  position: relative; margin: 10px 12px 8px;
}
.sf-search-icon {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.sf-search-input {
  width: 100%; height: 34px; padding: 0 30px 0 32px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.87); outline: none;
}
.sf-search-input:focus { border-color: rgba(4, 120, 87, 0.5); }
.sf-search-clear {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px; border-radius: 6px; border: none; background: transparent;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.sf-search-clear:hover { background: rgba(var(--v-theme-on-surface), 0.07); }

.sf-filters { display: flex; gap: 6px; padding: 0 12px 10px; flex-wrap: wrap; }
.sf-chip {
  height: 26px; padding: 0 10px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; cursor: pointer;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.sf-chip:hover { border-color: rgba(var(--v-theme-on-surface), 0.24); }
.sf-chip--on {
  background: rgba(4, 120, 87, 0.1); border-color: rgba(4, 120, 87, 0.35); color: #047857;
}

.sf-sidebar-count {
  font-size: 11.5px; font-weight: 700; padding: 1px 7px; border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Роль — бейджем, как статусы в остальных разделах. */
.sf-role-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 7px; border-radius: 7px;
  font-size: 11px; font-weight: 700; white-space: nowrap;
}
.sf-row-off {
  padding: 1px 6px; border-radius: 6px;
  font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  background: rgba(148, 163, 184, 0.2); color: #64748b;
}
.sf-row-line--sub { gap: 6px; margin-top: 3px; min-width: 0; }
.sf-row-access {
  margin-top: 3px; font-size: 11.5px; line-height: 1.35;
  color: rgba(var(--v-theme-on-surface), 0.42);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.sf-row-more {
  width: 28px; height: 28px; border-radius: 8px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: transparent; cursor: pointer; flex: none;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.sf-row-more:hover { background: rgba(var(--v-theme-on-surface), 0.08); color: rgba(var(--v-theme-on-surface), 0.8); }

.sf-menu {
  min-width: 220px; padding: 5px; border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}
.sf-menu-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 8px 10px; border: none; border-radius: 9px; background: transparent;
  font-size: 13px; font-weight: 500; text-align: left; cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.sf-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.sf-menu-item--danger { color: #dc2626; }
.sf-menu-item--danger:hover { background: rgba(220, 38, 38, 0.08); }
.sf-menu-sep { height: 1px; margin: 4px 6px; background: rgba(var(--v-theme-on-surface), 0.08); }

.sf-chat-bar-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

.sf-placeholder-icon {
  width: 56px; height: 56px; border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 120, 87, 0.08); color: #047857;
  margin-bottom: 14px;
}
.sf-placeholder-acts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 18px; }


/* Табы раздела — общий стиль, см. styles/page-tabs.css */

/* ── Пикер роли в модалке ── */
.sf-goto-roles {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 10px;
  font-size: 13px; font-weight: 600; color: #047857; cursor: pointer; background: none;
}
.sf-goto-roles:hover { opacity: 0.8; }
.sf-legacy-note {
  display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; line-height: 1.4;
  padding: 9px 11px; border-radius: 10px; background: rgba(245, 158, 11, 0.1); color: #b45309;
}

/* Предупреждение о сотрудниках на старых правах — над списком. */
.sf-legacy-banner {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 12px;
  background: rgba(245, 158, 11, 0.09); border: 1px solid rgba(245, 158, 11, 0.28);
  color: #92400e;
}
.sf-legacy-banner-text { font-size: 13px; line-height: 1.5; }
.sf-legacy-banner-text b { font-weight: 700; }

.sf-legacy-fix {
  font-size: 11.5px; font-weight: 600; line-height: 1;
  padding: 4px 9px; border-radius: 7px; white-space: nowrap;
  background: rgba(245, 158, 11, 0.12); color: #b45309;
  transition: background 0.15s;
}
.sf-legacy-fix:hover { background: rgba(245, 158, 11, 0.22); }

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

.sf-avatar {
  width: 44px; height: 44px; min-width: 44px;
  border-radius: 12px; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 15px; letter-spacing: 0.5px;
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

/* ── Cashbox access ── */
.sf-cashbox-count {
  font-size: 11px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgba(var(--v-theme-on-surface), 0.06);
  padding: 2px 8px;
  border-radius: 8px;
  text-transform: none;
  letter-spacing: 0;
}
.sf-cashbox-dot {
  width: 22px;
  height: 22px;
  min-width: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Split layout shell ── */
.sf-shell {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 0;
  height: calc(100vh - 280px);
  min-height: 480px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 14px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.dark .sf-shell { border-color: rgba(255,255,255,0.06); background: rgb(var(--v-theme-surface-deep)); }

/* LEFT — staff sidebar */
.sf-sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.015);
  min-height: 0;
}
.dark .sf-sidebar { border-right-color: rgba(255,255,255,0.06); background: rgb(var(--v-theme-surface-deep)); }

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
  min-width: 0;
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
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
/* ── История операций ── */
.sf-act-tab { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 12px 14px; overflow-y: auto; }
.sf-act-list { display: flex; flex-direction: column; gap: 2px; }
.sf-act-row { display: flex; gap: 10px; padding: 10px 8px; border-radius: 10px; transition: background .12s; }
.sf-act-row:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.sf-act-dot {
  width: 26px; height: 26px; min-width: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-primary), 0.1); color: rgb(var(--v-theme-primary)); margin-top: 1px;
}
.sf-act-main { min-width: 0; flex: 1; }
.sf-act-title { font-size: 13.5px; font-weight: 600; line-height: 1.3; }
.sf-act-desc { font-size: 12.5px; opacity: 0.65; margin-top: 2px; word-break: break-word; }
.sf-act-time { font-size: 11.5px; opacity: 0.45; margin-top: 3px; }

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

/* ── Mobile ── */
@media (max-width: 768px) {
  .stats-row { gap: 8px; }
  .stat-card { padding: 12px 14px; gap: 10px; }
  .stat-icon { width: 36px; height: 36px; min-width: 36px; }
  .stat-value { font-size: 17px; }
  .stat-label { font-size: 11px; }

  .sf-shell {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 0;
  }
  /* Hide chat panel when no staff selected on mobile */
  .sf-shell:not(:has(.sf-chat-bar)) .sf-main-panel { display: none; }
  /* Hide sidebar when chat is open */
  .sf-shell:has(.sf-chat-bar) .sf-sidebar { display: none; }

  .sf-sidebar { border-right: none; }
  .sf-sidebar-list { padding: 4px 8px 12px; }
  .sf-row { padding: 10px 8px; }
  .sf-row-actions { opacity: 1; }
  .sf-action-btn { width: 30px; height: 30px; }

  .sf-main-panel { min-height: calc(100vh - 200px); }
  .sf-chat-bar { padding: 12px 14px; gap: 10px; }
  .sf-chat-bar-name { font-size: 14px; }
  .sf-chat-bar-sub { font-size: 11px; }
}
</style>
