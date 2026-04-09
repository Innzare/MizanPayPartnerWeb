<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import type { StaffMember, StaffRole } from '@/types'
import { STAFF_ROLE_LABELS } from '@/types'

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
const editForm = ref({ role: 'MANAGER' as StaffRole, isActive: true })

// Delete
const deleteDialog = ref(false)
const deleteTarget = ref<StaffMember | null>(null)
const deleteLoading = ref(false)

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
    staff.value = await api.get<StaffMember[]>('/auth/investor/staff')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки')
  } finally {
    pageLoading.value = false
  }
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
  editForm.value = { role: member.role, isActive: member.isActive }
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

onMounted(loadStaff)
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

      <!-- Main card -->
      <v-card rounded="lg" elevation="0" border>
        <div class="pa-4">
          <!-- Header -->
          <div class="d-flex align-center ga-3 mb-4 flex-wrap">
            <div class="text-body-2 text-medium-emphasis flex-grow-1">
              Управляйте доступом сотрудников к платформе
            </div>
            <button class="sf-add-btn" @click="openAdd">
              <v-icon icon="mdi-plus" size="18" />
              <span class="d-none d-sm-inline">Добавить сотрудника</span>
            </button>
          </div>

          <!-- Info banner -->
          <div class="sf-info-banner mb-4">
            <div class="sf-info-icon">
              <v-icon icon="mdi-information-outline" size="18" color="primary" />
            </div>
            <div>
              <div class="sf-info-title">Роли и доступ</div>
              <div class="sf-info-text">
                <strong>Менеджер</strong> — полный доступ ко всем разделам кроме настроек и управления сотрудниками.
                <strong>Оператор</strong> — только сделки, клиенты, платежи и калькулятор.
                На email сотрудника будут отправлены логин и пароль для входа.
              </div>
            </div>
          </div>

          <!-- Staff list -->
          <div v-if="staff.length" class="sf-list">
            <div
              v-for="m in staff"
              :key="m.id"
              class="sf-card"
              :class="{ 'sf-card--inactive': !m.isActive }"
            >
              <div class="sf-header">
                <div class="sf-avatar" :style="{ background: ROLE_COLORS[m.role] + '14', color: ROLE_COLORS[m.role] }">
                  {{ m.firstName[0] }}{{ m.lastName[0] }}
                </div>

                <div class="sf-main">
                  <div class="sf-name-row">
                    <span class="sf-name">{{ m.firstName }} {{ m.lastName }}</span>
                    <span class="sf-role-badge" :style="{ background: ROLE_COLORS[m.role] + '14', color: ROLE_COLORS[m.role] }">
                      <v-icon :icon="ROLE_ICONS[m.role]" size="12" class="mr-1" />
                      {{ STAFF_ROLE_LABELS[m.role] }}
                    </span>
                    <span v-if="!m.isActive" class="sf-role-badge" style="background: rgba(239,68,68,0.08); color: #ef4444;">
                      Деактивирован
                    </span>
                  </div>
                  <div class="sf-meta">{{ m.email }} · {{ formatDate(m.createdAt) }}</div>
                </div>

                <!-- Desktop stats -->
                <div class="sf-stats d-none d-md-flex">
                  <div class="sf-stat">
                    <div class="sf-stat-value" :style="{ color: m.isActive ? '#10b981' : '#ef4444' }">
                      {{ m.isActive ? 'Активен' : 'Отключён' }}
                    </div>
                    <div class="sf-stat-label">Статус</div>
                  </div>
                </div>

                <div class="sf-actions">
                  <button class="sf-action-btn" title="Редактировать" @click="openEdit(m)">
                    <v-icon icon="mdi-pencil-outline" size="16" />
                  </button>
                  <button class="sf-action-btn sf-action-btn--danger" title="Удалить" @click="openDelete(m)">
                    <v-icon icon="mdi-delete-outline" size="16" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else class="sf-empty">
            <div class="sf-empty-icon">
              <v-icon icon="mdi-account-key-outline" size="36" color="grey-lighten-1" />
            </div>
            <div class="sf-empty-title">Нет сотрудников</div>
            <div class="sf-empty-subtitle">Добавьте первого сотрудника для совместной работы</div>
            <button class="sf-add-btn mt-4" @click="openAdd">
              <v-icon icon="mdi-plus" size="18" />
              <span>Добавить сотрудника</span>
            </button>
          </div>
        </div>
      </v-card>
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
</style>
