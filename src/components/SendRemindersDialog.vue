<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDate } from '@/utils/formatters'

interface PaymentRow {
  paymentId: string
  number: number
  amount: number
  dueDate: string
  status: 'PENDING' | 'OVERDUE'
  dealId: string
  dealNumber: number | null
  productName: string
}

interface ClientGroup {
  key: string
  clientPhone: string | null
  clientName: string
  canSend: boolean
  payments: PaymentRow[]
  totals: {
    overdueCount: number
    overdueAmount: number
    upcomingCount: number
    upcomingAmount: number
    totalCount: number
    totalAmount: number
  }
}

interface PreviewResponse {
  daysBeforeDue: number
  groups: ClientGroup[]
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const toast = useToast()

const daysBeforeDue = ref(3)
const loading = ref(false)
const sending = ref(false)
const groups = ref<ClientGroup[]>([])
// Exclusions are split into two layers so the user can deselect
// either a whole client (group key) or individual payments inside an
// expanded client card. A payment is sent if BOTH its group is not
// in `excluded` AND its paymentId is not in `excludedPayments`.
const excluded = ref<Set<string>>(new Set())
const excludedPayments = ref<Set<string>>(new Set())
const search = ref('')
const expanded = ref<Set<string>>(new Set())

// On dialog open: reset, then preview with current daysBeforeDue.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      excluded.value = new Set()
      excludedPayments.value = new Set()
      expanded.value = new Set()
      search.value = ''
      loadPreview()
    }
  },
)

async function loadPreview() {
  loading.value = true
  try {
    const res = await api.post<PreviewResponse>('/whatsapp/remind-preview', {
      daysBeforeDue: daysBeforeDue.value,
    })
    groups.value = res.groups
  } catch (e: any) {
    toast.error(e.message || 'Не удалось загрузить список')
    groups.value = []
  } finally {
    loading.value = false
  }
}

const visibleGroups = computed(() => {
  if (!search.value.trim()) return groups.value
  const s = search.value.trim().toLowerCase()
  return groups.value.filter(
    (g) =>
      g.clientName.toLowerCase().includes(s) ||
      (g.clientPhone ?? '').toLowerCase().includes(s) ||
      g.payments.some((p) => p.productName.toLowerCase().includes(s)),
  )
})

const sendableGroups = computed(() => groups.value.filter((g) => g.canSend))

/**
 * Returns the effective payments for a group — i.e. those that are NOT
 * individually excluded by the user. The group-level checkbox only
 * removes the group from `excluded`; for fine-grained control the user
 * can also uncheck specific payments inside the expanded card, which
 * end up in `excludedPayments`.
 */
function effectivePayments(group: ClientGroup): PaymentRow[] {
  return group.payments.filter((p) => !excludedPayments.value.has(p.paymentId))
}

/**
 * Recompute totals based on the user's per-payment exclusions. Used in
 * the group header (counts/sums) and in the bottom summary so numbers
 * always reflect what will actually be sent.
 */
function effectiveTotals(group: ClientGroup) {
  let overdueCount = 0
  let overdueAmount = 0
  let upcomingCount = 0
  let upcomingAmount = 0
  for (const p of effectivePayments(group)) {
    if (p.status === 'OVERDUE') {
      overdueCount++
      overdueAmount += p.amount
    } else {
      upcomingCount++
      upcomingAmount += p.amount
    }
  }
  return {
    overdueCount,
    overdueAmount,
    upcomingCount,
    upcomingAmount,
    totalCount: overdueCount + upcomingCount,
    totalAmount: overdueAmount + upcomingAmount,
  }
}

// A group is "selected" only if it's not group-excluded AND has at
// least one payment that isn't individually excluded. Otherwise it
// won't produce any message and shouldn't count toward the sender.
const selectedGroups = computed(() =>
  sendableGroups.value.filter(
    (g) => !excluded.value.has(g.key) && effectivePayments(g).length > 0,
  ),
)
const selectedAmount = computed(() =>
  selectedGroups.value.reduce((s, g) => s + effectiveTotals(g).totalAmount, 0),
)
const totalPaymentsCount = computed(() =>
  groups.value.reduce((s, g) => s + g.totals.totalCount, 0),
)
const noPhoneCount = computed(() => groups.value.filter((g) => !g.canSend).length)

function toggleGroup(key: string) {
  const next = new Set(excluded.value)
  if (next.has(key)) {
    // Re-selecting the group — also clear any per-payment exclusions
    // for this group so the user gets the full set back. Otherwise
    // they'd have to uncheck/check both layers separately.
    next.delete(key)
    const group = groups.value.find((g) => g.key === key)
    if (group) {
      const cleared = new Set(excludedPayments.value)
      for (const p of group.payments) cleared.delete(p.paymentId)
      excludedPayments.value = cleared
    }
  } else {
    next.add(key)
  }
  excluded.value = next
}

/**
 * Toggle a single payment inside an expanded card. If unchecking a
 * payment makes ALL payments in the group excluded, also flip the
 * group-level checkbox so the UI stays consistent ("nothing selected
 * for this client" matches "client unchecked").
 */
function togglePayment(group: ClientGroup, paymentId: string) {
  const next = new Set(excludedPayments.value)
  if (next.has(paymentId)) next.delete(paymentId)
  else next.add(paymentId)
  excludedPayments.value = next

  // Sync group-level state with payment-level reality.
  const allExcluded = group.payments.every((p) => next.has(p.paymentId))
  const groupExcl = new Set(excluded.value)
  if (allExcluded) groupExcl.add(group.key)
  else groupExcl.delete(group.key)
  excluded.value = groupExcl
}

function toggleExpanded(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function selectAllVisible() {
  const next = new Set(excluded.value)
  const nextPayments = new Set(excludedPayments.value)
  for (const g of visibleGroups.value) {
    if (g.canSend) {
      next.delete(g.key)
      // Selecting "all" should also clear per-payment exclusions —
      // otherwise the group looks selected but partially deflated.
      for (const p of g.payments) nextPayments.delete(p.paymentId)
    }
  }
  excluded.value = next
  excludedPayments.value = nextPayments
}

function clearAllVisible() {
  const next = new Set(excluded.value)
  for (const g of visibleGroups.value) {
    if (g.canSend) next.add(g.key)
  }
  excluded.value = next
  // Don't touch excludedPayments here — clearing the group flag is
  // sufficient. If the user re-selects the group, toggleGroup() will
  // restore the payment-level state.
}

const isAllVisibleSelected = computed(() => {
  const sendable = visibleGroups.value.filter((g) => g.canSend)
  if (sendable.length === 0) return false
  return sendable.every((g) => !excluded.value.has(g.key))
})

async function send() {
  // Collect paymentIds that are effectively selected (group on +
  // payment not individually excluded). Backend re-groups by phone
  // server-side and sends one consolidated message per group.
  const ids = selectedGroups.value.flatMap((g) =>
    effectivePayments(g).map((p) => p.paymentId),
  )
  if (!ids.length) {
    toast.error('Выберите хотя бы одного клиента')
    return
  }
  const groupCount = selectedGroups.value.length
  const noun = groupCount === 1 ? 'клиенту' : 'клиентам'
  if (!confirm(`Отправить напоминания ${groupCount} ${noun}? Действие необратимо.`)) return

  sending.value = true
  try {
    const res = await api.post<{ sent: number; failed: number; total: number }>(
      '/whatsapp/remind-all',
      { paymentIds: ids },
    )
    toast.success(`Отправлено ${res.sent} из ${res.total}`)
    if (res.failed > 0) toast.error(`${res.failed} не удалось отправить`)
    emit('update:modelValue', false)
  } catch (e: any) {
    toast.error(e.message || 'Ошибка отправки')
  } finally {
    sending.value = false
  }
}

function maskPhone(p: string | null) {
  if (!p) return '—'
  const digits = p.replace(/\D/g, '')
  if (digits.length === 11) {
    return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
  }
  return p
}

function getInitials(name: string) {
  if (!name || name === '—') return '?'
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? '' + (parts[1]?.[0] ?? '')).toUpperCase()
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="(v) => emit('update:modelValue', v)"
    max-width="780"
    persistent
  >
    <v-card rounded="lg" class="srd-card">
      <!-- Header -->
      <div class="srd-header">
        <div class="srd-header-icon">
          <v-icon icon="mdi-whatsapp" size="22" />
        </div>
        <div class="srd-header-text">
          <div class="srd-title">Напоминания о платежах</div>
          <div class="srd-subtitle">
            Каждый клиент получит одно сводное сообщение по всем своим платежам
          </div>
        </div>
        <button class="srd-close" @click="emit('update:modelValue', false)">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <!-- Filters -->
      <div class="srd-filters">
        <div class="srd-days">
          <label class="srd-days-label">Включить платежи на ближайшие</label>
          <div class="srd-days-control">
            <button
              class="srd-days-btn"
              v-for="d in [1, 3, 7, 14, 30]"
              :key="d"
              :class="{ active: daysBeforeDue === d }"
              @click="daysBeforeDue = d; loadPreview()"
            >
              {{ d }} {{ d === 1 ? 'день' : d <= 4 ? 'дня' : 'дней' }}
            </button>
          </div>
        </div>
        <div class="srd-search-wrap">
          <v-icon icon="mdi-magnify" size="16" class="srd-search-icon" />
          <input
            v-model="search"
            type="text"
            class="srd-search"
            placeholder="Поиск по клиенту, телефону или товару..."
          />
        </div>
      </div>

      <!-- Status strip -->
      <div class="srd-summary">
        <span class="srd-summary-item">
          <strong>{{ groups.length }}</strong>
          {{ groups.length === 1 ? 'клиент' : 'клиентов' }}
          ({{ totalPaymentsCount }} {{ totalPaymentsCount === 1 ? 'платёж' : 'платежей' }})
        </span>
        <span class="srd-summary-sep">·</span>
        <span class="srd-summary-item srd-summary-item--ok">
          <strong>{{ selectedGroups.length }}</strong> к отправке
          ({{ formatCurrency(selectedAmount) }})
        </span>
        <span v-if="noPhoneCount > 0" class="srd-summary-sep">·</span>
        <span v-if="noPhoneCount > 0" class="srd-summary-item srd-summary-item--warn">
          <v-icon icon="mdi-phone-off" size="13" />
          <strong>{{ noPhoneCount }}</strong> без телефона
        </span>
      </div>

      <!-- Select-all bar -->
      <div class="srd-list-head" v-if="groups.length > 0">
        <label class="srd-check">
          <input
            type="checkbox"
            :checked="isAllVisibleSelected"
            @change="isAllVisibleSelected ? clearAllVisible() : selectAllVisible()"
          />
        </label>
        <span class="srd-list-head-label">
          {{ isAllVisibleSelected ? 'Снять всех' : 'Выбрать всех' }}
        </span>
      </div>

      <!-- List of client groups -->
      <div class="srd-list" :class="{ loading }">
        <div v-if="loading" class="srd-empty">
          <v-progress-circular indeterminate size="28" color="primary" />
        </div>
        <div v-else-if="!visibleGroups.length" class="srd-empty">
          <v-icon icon="mdi-cash-check" size="36" color="grey" />
          <div class="srd-empty-title">Нет платежей по фильтру</div>
          <div class="srd-empty-sub">Попробуйте изменить срок или поиск</div>
        </div>

        <div
          v-for="g in visibleGroups"
          :key="g.key"
          class="srd-group"
          :class="{ 'srd-group--disabled': !g.canSend, 'srd-group--selected': g.canSend && !excluded.has(g.key) }"
        >
          <!-- Group header -->
          <div class="srd-group-head" @click="g.canSend && toggleGroup(g.key)">
            <label class="srd-check" @click.stop>
              <input
                type="checkbox"
                :checked="g.canSend && !excluded.has(g.key)"
                :disabled="!g.canSend"
                @change="toggleGroup(g.key)"
              />
            </label>

            <div class="srd-group-avatar">{{ getInitials(g.clientName) }}</div>

            <div class="srd-group-main">
              <div class="srd-group-title">
                <span class="srd-group-name">{{ g.clientName }}</span>
                <span class="srd-group-meta">
                  <v-icon icon="mdi-phone-outline" size="12" />
                  <span :class="{ 'srd-no-phone': !g.canSend }">
                    {{ g.canSend ? maskPhone(g.clientPhone) : 'Нет телефона' }}
                  </span>
                </span>
              </div>
              <div class="srd-group-stats">
                <span v-if="effectiveTotals(g).overdueCount > 0" class="srd-stat srd-stat--overdue">
                  <v-icon icon="mdi-alert-circle" size="12" />
                  {{ effectiveTotals(g).overdueCount }} просроч.
                  ({{ formatCurrency(effectiveTotals(g).overdueAmount) }})
                </span>
                <span v-if="effectiveTotals(g).upcomingCount > 0" class="srd-stat srd-stat--upcoming">
                  <v-icon icon="mdi-clock-outline" size="12" />
                  {{ effectiveTotals(g).upcomingCount }} ближайш.
                  ({{ formatCurrency(effectiveTotals(g).upcomingAmount) }})
                </span>
                <span
                  v-if="effectiveTotals(g).totalCount < g.totals.totalCount"
                  class="srd-stat srd-stat--partial"
                  :title="`Выбрано ${effectiveTotals(g).totalCount} из ${g.totals.totalCount}`"
                >
                  <v-icon icon="mdi-filter-variant" size="12" />
                  {{ effectiveTotals(g).totalCount }} из {{ g.totals.totalCount }}
                </span>
              </div>
            </div>

            <div class="srd-group-total">
              <div class="srd-group-total-label">Итого</div>
              <div class="srd-group-total-value">{{ formatCurrency(effectiveTotals(g).totalAmount) }}</div>
            </div>

            <button
              class="srd-group-toggle"
              :class="{ open: expanded.has(g.key) }"
              @click.stop="toggleExpanded(g.key)"
              type="button"
            >
              <v-icon icon="mdi-chevron-down" size="18" />
            </button>
          </div>

          <!-- Expanded payments list with per-payment checkboxes -->
          <div v-if="expanded.has(g.key)" class="srd-group-body">
            <div
              v-for="p in g.payments"
              :key="p.paymentId"
              class="srd-payment-row"
              :class="{ 'srd-payment-row--excluded': excludedPayments.has(p.paymentId) }"
              @click="g.canSend && togglePayment(g, p.paymentId)"
            >
              <label class="srd-check srd-check--small" @click.stop>
                <input
                  type="checkbox"
                  :checked="!excludedPayments.has(p.paymentId)"
                  :disabled="!g.canSend"
                  @change="togglePayment(g, p.paymentId)"
                />
              </label>
              <span
                class="srd-payment-status"
                :class="p.status === 'OVERDUE' ? 'srd-payment-status--overdue' : 'srd-payment-status--upcoming'"
              />
              <span class="srd-payment-amount">{{ formatCurrency(p.amount) }}</span>
              <span class="srd-payment-deal">
                <span v-if="p.dealNumber" class="srd-payment-dealnum">#{{ p.dealNumber }}</span>
                {{ p.productName }}
              </span>
              <span class="srd-payment-date">
                {{ p.status === 'OVERDUE' ? 'был' : 'срок' }} {{ formatDate(p.dueDate) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="srd-footer">
        <button class="srd-btn srd-btn--ghost" @click="emit('update:modelValue', false)" :disabled="sending">
          Отмена
        </button>
        <button
          class="srd-btn srd-btn--primary"
          :disabled="sending || selectedGroups.length === 0"
          @click="send"
        >
          <v-progress-circular v-if="sending" indeterminate size="14" width="2" color="white" />
          <v-icon v-else icon="mdi-whatsapp" size="16" />
          Отправить
          {{ selectedGroups.length }}
          {{ selectedGroups.length === 1 ? 'клиенту' : 'клиентам' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.srd-card { overflow: hidden; }

/* Header */
.srd-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.srd-header-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(37, 211, 102, 0.12);
  color: #25d366;
  display: flex;
  align-items: center;
  justify-content: center;
}
.srd-header-text { flex: 1; min-width: 0; }
.srd-title { font-size: 15px; font-weight: 700; }
.srd-subtitle { font-size: 12px; color: rgba(0, 0, 0, 0.55); margin-top: 2px; }
.srd-close {
  width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.srd-close:hover { background: rgba(0, 0, 0, 0.04); }

/* Filters */
.srd-filters {
  display: flex; flex-direction: column; gap: 12px;
  padding: 14px 20px; border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.srd-days { display: flex; flex-direction: column; gap: 6px; }
.srd-days-label { font-size: 12px; color: rgba(0, 0, 0, 0.55); }
.srd-days-control { display: flex; flex-wrap: wrap; gap: 6px; }
.srd-days-btn {
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: #fff; font-size: 12px; cursor: pointer;
  transition: all 0.15s;
}
.srd-days-btn:hover { border-color: rgba(4, 120, 87, 0.4); }
.srd-days-btn.active {
  background: #047857; color: #fff; border-color: #047857;
}
.srd-search-wrap {
  position: relative; display: flex; align-items: center;
  border: 1px solid rgba(0, 0, 0, 0.1); border-radius: 8px; padding: 0 10px;
}
.srd-search-icon { color: rgba(0, 0, 0, 0.4); }
.srd-search {
  flex: 1; border: none; outline: none; padding: 8px 8px;
  font-size: 13px; background: transparent;
}

/* Summary */
.srd-summary {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 10px 20px;
  background: rgba(0, 0, 0, 0.02);
  font-size: 12px; color: rgba(0, 0, 0, 0.65);
}
.srd-summary-item { display: inline-flex; align-items: center; gap: 4px; }
.srd-summary-item--ok strong { color: #047857; }
.srd-summary-item--warn { color: #b45309; }
.srd-summary-sep { color: rgba(0, 0, 0, 0.3); }

/* Select-all bar */
.srd-list-head {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  font-size: 12px; color: rgba(0, 0, 0, 0.6);
}
.srd-list-head-label { font-weight: 500; }
.srd-check input {
  width: 18px; height: 18px; cursor: pointer;
  accent-color: #047857;
}

/* List */
.srd-list {
  max-height: 500px; overflow-y: auto;
  padding: 8px 12px;
}
.srd-list.loading { opacity: 0.5; pointer-events: none; }
.srd-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60px 20px; text-align: center;
}
.srd-empty-title { font-size: 14px; font-weight: 600; margin-top: 8px; }
.srd-empty-sub { font-size: 12px; color: rgba(0, 0, 0, 0.5); margin-top: 4px; }

/* Group card */
.srd-group {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  margin-bottom: 8px;
  background: #fff;
  transition: all 0.15s;
}
.srd-group:hover { border-color: rgba(4, 120, 87, 0.3); }
.srd-group--disabled { opacity: 0.55; }
.srd-group--disabled:hover { border-color: rgba(0, 0, 0, 0.08); }
.srd-group--selected {
  border-color: rgba(4, 120, 87, 0.4);
  background: rgba(4, 120, 87, 0.02);
}

.srd-group-head {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px;
  cursor: pointer;
}
.srd-group-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: rgba(4, 120, 87, 0.1);
  color: #047857;
  font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.srd-group-main { flex: 1; min-width: 0; }
.srd-group-title {
  display: flex; align-items: center; gap: 10px;
  font-size: 13px;
}
.srd-group-name { font-weight: 600; color: rgba(0, 0, 0, 0.85); }
.srd-group-meta {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; color: rgba(0, 0, 0, 0.5);
  font-family: ui-monospace, monospace;
}
.srd-no-phone { color: #b45309; }
.srd-group-stats {
  display: flex; gap: 10px; margin-top: 3px;
  font-size: 11px;
}
.srd-stat {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 6px; border-radius: 6px;
}
.srd-stat--overdue {
  background: rgba(239, 68, 68, 0.1);
  color: #b91c1c;
}
.srd-stat--upcoming {
  background: rgba(245, 158, 11, 0.1);
  color: #b45309;
}
.srd-stat--partial {
  background: rgba(99, 102, 241, 0.1);
  color: #4338ca;
}
.srd-group-total {
  text-align: right;
  flex-shrink: 0;
}
.srd-group-total-label {
  font-size: 10px; text-transform: uppercase;
  color: rgba(0, 0, 0, 0.4); letter-spacing: 0.04em;
}
.srd-group-total-value {
  font-size: 14px; font-weight: 700;
  color: rgba(0, 0, 0, 0.85);
}
.srd-group-toggle {
  width: 28px; height: 28px;
  border-radius: 6px; border: none; background: transparent;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: rgba(0, 0, 0, 0.5);
  transition: transform 0.15s;
}
.srd-group-toggle:hover { background: rgba(0, 0, 0, 0.04); }
.srd-group-toggle.open { transform: rotate(180deg); }

.srd-group-body {
  padding: 4px 12px 10px 56px;
  display: flex; flex-direction: column; gap: 2px;
  border-top: 1px dashed rgba(0, 0, 0, 0.06);
  margin-top: 2px;
}
.srd-payment-row {
  display: grid;
  grid-template-columns: 22px 8px 90px 1fr auto;
  align-items: center; gap: 10px;
  padding: 4px 0;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.1s;
}
.srd-payment-row:hover { background: rgba(0, 0, 0, 0.02); }
.srd-payment-row--excluded {
  opacity: 0.45;
  text-decoration: line-through;
  text-decoration-color: rgba(0, 0, 0, 0.4);
}
.srd-payment-row--excluded:hover { opacity: 0.6; }
.srd-check--small input { width: 14px; height: 14px; }
.srd-payment-status {
  width: 6px; height: 6px; border-radius: 50%;
}
.srd-payment-status--overdue { background: #ef4444; }
.srd-payment-status--upcoming { background: #f59e0b; }
.srd-payment-amount { font-weight: 600; }
.srd-payment-deal {
  color: rgba(0, 0, 0, 0.7);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.srd-payment-dealnum {
  color: rgba(0, 0, 0, 0.4);
  font-family: ui-monospace, monospace;
  margin-right: 4px;
}
.srd-payment-date {
  color: rgba(0, 0, 0, 0.5); font-size: 11px;
  font-family: ui-monospace, monospace;
}

/* Footer */
.srd-footer {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 14px 20px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
.srd-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 18px; border-radius: 8px; border: none;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.srd-btn--ghost {
  background: transparent;
  color: rgba(0, 0, 0, 0.7);
}
.srd-btn--ghost:hover { background: rgba(0, 0, 0, 0.04); }
.srd-btn--primary {
  background: #25d366; color: #fff;
}
.srd-btn--primary:disabled {
  opacity: 0.5; cursor: not-allowed;
}
.srd-btn--primary:not(:disabled):hover { background: #1eb558; }
</style>
