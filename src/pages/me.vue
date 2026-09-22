<script setup lang="ts">
/**
 * «Мой профиль» — личная страница сотрудника.
 *
 * Сотруднику закрыт раздел «Сотрудники», и до сих пор он не видел о себе
 * ничего: ни своей работы за месяц, ни того, что ему вообще разрешено. Эта
 * страница отвечает на три вопроса — кто я в системе, что я сделал за период и
 * куда мне открыт вход.
 *
 * Данные берутся тем же эндпоинтом, что и карточка сотрудника у владельца
 * (`/staff-profile/:id/...`): свой профиль сотрудник видит всегда, поэтому
 * отдельного API не понадобилось, а цифры у него и у владельца одни и те же.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useSubscription } from '@/composables/useSubscription'
import { useToast } from '@/composables/useToast'
import { usePageHeaderStore } from '@/stores/pageHeader'
import { formatCurrency, formatDate, pluralizeRu } from '@/utils/formatters'
import { MAIN_NAV } from '@/utils/navSections'
import { STAFF_ROLE_LABELS } from '@/types'

interface StaffSummary {
  staff: {
    id: string
    name: string
    email: string
    role: 'MANAGER' | 'OPERATOR' | 'POINT_OPERATOR'
    roleName: string | null
    isActive: boolean
    since: string
    dealsAccessMode: 'ALL' | 'ASSIGNED_ONLY'
    canCreateDeals: boolean
    hiddenCashBoxCount: number
  }
  period: { from: string; to: string }
  metrics: {
    money: { count: number; amount: number; overdueCount: number; overdueAmount: number }
    deals: {
      createdCount: number
      createdVolume: number
      assignedActive: number
      assignedRemaining: number
      assignedOverdueAmount: number
      assignedOverdueDeals: number
    }
    collections: {
      contacts: number
      promises: number
      promisesKept: number
      promisesBroken: number
      keptRate: number | null
    }
    attention: {
      paymentsUnmarked: number
      dealsDeleted: number
      forgiveCount: number
      forgiveAmount: number
      actionsTotal: number
    }
  }
  attentionItems: Array<{ code: string; text: string }>
}

interface StaffDeal {
  id: string
  dealNumber: number
  productName: string
  status: string
  totalPrice: number
  remainingAmount: number
  dealDate: string
  clientName: string
}

const router = useRouter()
const auth = useAuthStore()
const subscription = useSubscription()
const toast = useToast()
const pageHeader = usePageHeaderStore()

const staffId = computed(() => auth.user?.staffId ?? '')
const data = ref<StaffSummary | null>(null)
const deals = ref<StaffDeal[]>([])
const loading = ref(true)

const PRESETS = [
  { key: '30', label: '30 дней', days: 30 },
  { key: '90', label: '3 месяца', days: 90 },
  { key: '365', label: 'Год', days: 365 },
]
const preset = ref('30')

async function load() {
  if (!staffId.value) return
  loading.value = true
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'
    const days = PRESETS.find((p) => p.key === preset.value)?.days ?? 30
    const from = new Date(Date.now() - days * 86400000).toISOString()
    const [summary, dealRows] = await Promise.all([
      api.get<StaffSummary>(
        `/staff-profile/${staffId.value}/summary?from=${from}&tz=${encodeURIComponent(tz)}`,
      ),
      api.get<StaffDeal[]>(`/staff-profile/${staffId.value}/deals?limit=50`).catch(() => []),
    ])
    data.value = summary
    deals.value = dealRows
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось загрузить профиль')
  } finally {
    loading.value = false
  }
}

function setPreset(key: string) {
  if (preset.value === key) return
  preset.value = key
  void load()
}

onMounted(() => {
  pageHeader.set('Мой профиль', 'Показатели работы и доступы')
  void load()
})

const initials = computed(() => {
  const name = data.value?.staff.name || auth.userName || ''
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'Я'
  )
})

/** Роль словами: своя роль партнёра, иначе — старое название. */
const roleLabel = computed(() => {
  const s = data.value?.staff
  if (!s) return ''
  return s.roleName || STAFF_ROLE_LABELS[s.role]
})

/**
 * Ключевые цифры периода — в самом верху, на зелёном.
 *
 * Показываем то, за что сотрудник отвечает: принятые деньги, свои сделки и
 * просрочку по ним. Порядок от «что сделал» к «за чем следить».
 */
const heroStats = computed(() => {
  const m = data.value?.metrics
  if (!m) return []
  return [
    {
      key: 'money',
      label: 'Принято платежей',
      value: formatCurrency(m.money.amount),
      note: `${m.money.count} ${pluralizeRu(m.money.count, 'платёж', 'платежа', 'платежей')}`,
    },
    {
      key: 'created',
      label: 'Оформлено сделок',
      value: String(m.deals.createdCount),
      note: m.deals.createdVolume ? `на ${formatCurrency(m.deals.createdVolume)}` : 'за период',
    },
    {
      key: 'assigned',
      label: 'Сделок в работе',
      value: String(m.deals.assignedActive),
      note: m.deals.assignedRemaining
        ? `остаток ${formatCurrency(m.deals.assignedRemaining)}`
        : 'нет остатка',
    },
    {
      key: 'overdue',
      label: 'Просрочка по сделкам',
      value: formatCurrency(m.deals.assignedOverdueAmount),
      note: m.deals.assignedOverdueDeals
        ? `${m.deals.assignedOverdueDeals} ${pluralizeRu(m.deals.assignedOverdueDeals, 'сделка', 'сделки', 'сделок')}`
        : 'всё по графику',
      alarm: m.deals.assignedOverdueAmount > 0,
    },
  ]
})

/** Работа с должниками — отдельным блоком: она есть не у всех. */
const hasCollections = computed(() => {
  const c = data.value?.metrics.collections
  return !!c && (c.contacts > 0 || c.promises > 0)
})

/**
 * Разделы, куда сотруднику открыт вход.
 *
 * Берём общий список навигации и фильтруем ровно теми же правилами, что и
 * боковая панель, — иначе перечень расходился бы с меню.
 */
const availableSections = computed(() =>
  MAIN_NAV.filter((s) => {
    if (s.path === '/me') return false
    if (s.ownerOnly) return false
    if (s.permission && !auth.can(s.permission)) return false
    if (s.requiredFeature && !subscription.canAccess(s.requiredFeature)) return false
    return auth.canAccess(s.path)
  }),
)

const DEAL_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Активна',
  COMPLETED: 'Завершена',
  OVERDUE: 'Просрочена',
  CANCELLED: 'Отменена',
  DEFAULTED: 'Закрыта принудительно',
}
</script>

<template>
  <div class="at-page me-page">
    <div v-if="loading && !data" class="me-loader">
      <v-progress-circular indeterminate color="#047857" size="34" />
    </div>

    <template v-else-if="data">
      <!-- ── Шапка на фирменном градиенте ── -->
      <section class="me-hero">
        <div class="me-hero-top">
          <div class="me-ava">{{ initials }}</div>
          <div class="me-hero-id">
            <h1 class="me-name">{{ data.staff.name }}</h1>
            <div class="me-hero-tags">
              <span class="me-tag me-tag--role">{{ roleLabel }}</span>
              <span v-if="!data.staff.isActive" class="me-tag me-tag--off">доступ отключён</span>
            </div>
            <div class="me-hero-sub">
              {{ data.staff.email }} · в команде с {{ formatDate(data.staff.since) }}
            </div>
          </div>

          <!-- Период влияет только на цифры ниже, поэтому стоит рядом с ними. -->
          <div class="me-period">
            <button
              v-for="p in PRESETS"
              :key="p.key"
              class="me-period-btn"
              :class="{ 'me-period-btn--on': preset === p.key }"
              @click="setPreset(p.key)"
            >
              {{ p.label }}
            </button>
          </div>
        </div>

        <div class="me-stats">
          <div
            v-for="s in heroStats"
            :key="s.key"
            class="me-stat"
            :class="{ 'me-stat--alarm': (s as any).alarm }"
          >
            <div class="me-stat-label">{{ s.label }}</div>
            <div class="me-stat-value">{{ s.value }}</div>
            <div class="me-stat-note">{{ s.note }}</div>
          </div>
        </div>
      </section>

      <!-- ── Обратите внимание ── -->
      <section v-if="data.attentionItems.length" class="me-note">
        <v-icon icon="mdi-information-outline" size="18" class="me-note-icon" />
        <div>
          <div class="me-note-title">Обратите внимание</div>
          <div v-for="a in data.attentionItems" :key="a.code" class="me-note-line">{{ a.text }}</div>
        </div>
      </section>

      <div class="me-grid">
        <!-- ── Мои доступы ── -->
        <section class="me-card">
          <h2 class="me-card-title">Доступы</h2>

          <div class="me-rows">
            <div class="me-row">
              <span class="me-row-mark">
                <v-icon
                  :icon="data.staff.dealsAccessMode === 'ALL' ? 'mdi-folder-multiple-outline' : 'mdi-account-arrow-right-outline'"
                  size="18"
                />
              </span>
              <div class="me-row-main">
                <div class="me-row-title">Сделки</div>
                <div class="me-row-text">
                  {{
                    data.staff.dealsAccessMode === 'ALL'
                      ? 'Доступны все сделки компании'
                      : 'Доступны только назначенные сделки'
                  }}
                </div>
              </div>
            </div>

            <div class="me-row">
              <span class="me-row-mark" :class="{ 'me-row-mark--off': !data.staff.canCreateDeals }">
                <v-icon
                  :icon="data.staff.canCreateDeals ? 'mdi-check-circle-outline' : 'mdi-minus-circle-outline'"
                  size="18"
                />
              </span>
              <div class="me-row-main">
                <div class="me-row-title">Оформление сделок</div>
                <div class="me-row-text">
                  {{ data.staff.canCreateDeals ? 'Оформление новых сделок доступно' : 'Оформление сделок недоступно' }}
                </div>
              </div>
            </div>

            <div v-if="data.staff.hiddenCashBoxCount" class="me-row">
              <span class="me-row-mark">
                <v-icon icon="mdi-wallet-outline" size="18" />
              </span>
              <div class="me-row-main">
                <div class="me-row-title">Кассы</div>
                <div class="me-row-text">
                  {{ data.staff.hiddenCashBoxCount }}
                  {{ pluralizeRu(data.staff.hiddenCashBoxCount, 'касса скрыта', 'кассы скрыты', 'касс скрыто') }}
                </div>
              </div>
            </div>
          </div>

          <div class="me-sub-title">Доступные разделы</div>
          <div class="me-sections">
            <button
              v-for="s in availableSections"
              :key="s.path"
              class="me-section"
              @click="router.push(s.path)"
            >
              <v-icon :icon="s.icon" size="16" />
              {{ s.title }}
            </button>
          </div>
          <div class="me-hint">
            Права выдаёт владелец аккаунта. Для доступа к другому разделу — запрос через «Сообщения».
          </div>
        </section>

        <!-- ── Работа с должниками ── -->
        <section v-if="hasCollections" class="me-card">
          <h2 class="me-card-title">Работа с должниками</h2>
          <div class="me-mini">
            <div class="me-mini-item">
              <div class="me-mini-value">{{ data.metrics.collections.contacts }}</div>
              <div class="me-mini-label">контактов</div>
            </div>
            <div class="me-mini-item">
              <div class="me-mini-value">{{ data.metrics.collections.promises }}</div>
              <div class="me-mini-label">обещаний взято</div>
            </div>
            <div class="me-mini-item">
              <div class="me-mini-value">{{ data.metrics.collections.promisesKept }}</div>
              <div class="me-mini-label">сдержано</div>
            </div>
            <div class="me-mini-item">
              <div class="me-mini-value">
                {{ data.metrics.collections.keptRate === null ? '—' : `${data.metrics.collections.keptRate}%` }}
              </div>
              <div class="me-mini-label">держат слово</div>
            </div>
          </div>
          <div class="me-hint">
            Процент считается по обещаниям, срок которых уже наступил.
          </div>
        </section>
      </div>

      <!-- ── Мои сделки ── -->
      <section class="me-card">
        <div class="me-card-head">
          <h2 class="me-card-title">Закреплённые сделки</h2>
          <span v-if="deals.length" class="me-card-note">{{ deals.length }}</span>
        </div>

        <div v-if="deals.length" class="me-table-wrap">
          <table class="me-table">
            <thead>
              <tr>
                <th>Сделка</th>
                <th>Клиент</th>
                <th>Статус</th>
                <th class="me-num">Цена договора</th>
                <th class="me-num">Остаток</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in deals" :key="d.id" class="me-table-row" @click="router.push(`/deals/${d.id}`)">
                <td>
                  <div class="me-deal-name">{{ d.productName }}</div>
                  <div class="me-deal-sub">№ {{ d.dealNumber }} · {{ formatDate(d.dealDate) }}</div>
                </td>
                <td class="me-muted">{{ d.clientName }}</td>
                <td>
                  <span class="me-status" :class="`me-status--${d.status.toLowerCase()}`">
                    {{ DEAL_STATUS_LABEL[d.status] ?? d.status }}
                  </span>
                </td>
                <td class="me-num">{{ formatCurrency(d.totalPrice) }}</td>
                <td class="me-num me-num--strong">{{ formatCurrency(d.remainingAmount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="me-empty">
          <v-icon icon="mdi-briefcase-outline" size="26" />
          <div class="me-empty-title">За вами пока не закреплено сделок</div>
          <div class="me-empty-text">
            Здесь появятся сделки, назначенные владельцем: клиент, срок и остаток долга.
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.me-page { padding-bottom: 32px; }
.me-loader { display: flex; justify-content: center; padding: 80px 0; }

/* ── Шапка: тот же фирменный градиент, что у сводки на главной ── */
.me-hero {
  background: linear-gradient(135deg, #047857 0%, #065f46 50%, #064e3b 100%);
  border-radius: 16px; padding: 24px 28px; color: #fff;
}
.me-hero-top { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.me-ava {
  flex: none; width: 60px; height: 60px; border-radius: 18px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.16);
  font-size: 22px; font-weight: 700; letter-spacing: 0.5px;
}
.me-hero-id { flex: 1; min-width: 0; }
.me-name { font-size: 24px; font-weight: 700; letter-spacing: -0.3px; margin: 0; }
.me-hero-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
.me-tag {
  padding: 3px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 700;
  background: rgba(255, 255, 255, 0.18);
}
.me-tag--role { background: rgba(255, 255, 255, 0.9); color: #065f46; }
.me-tag--off { background: rgba(220, 38, 38, 0.35); }
.me-hero-sub { margin-top: 8px; font-size: 13px; color: rgba(255, 255, 255, 0.7); }

.me-period { display: flex; gap: 4px; flex-wrap: wrap; }
.me-period-btn {
  height: 30px; padding: 0 12px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85); font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.me-period-btn:hover { background: rgba(255, 255, 255, 0.2); color: #fff; }
.me-period-btn--on { background: #fff; border-color: #fff; color: #065f46; }

.me-stats {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;
  margin-top: 20px;
}
.me-stat { padding: 14px 16px; border-radius: 12px; background: rgba(255, 255, 255, 0.1); }
/* Просрочка — единственный показатель, который зовёт что-то сделать: он и
   выделен тёплым, чтобы в ряду ровных цифр его нельзя было пропустить. */
.me-stat--alarm { background: rgba(251, 191, 36, 0.16); }
.me-stat--alarm .me-stat-value { color: #fde68a; }
.me-stat-label { font-size: 12px; color: rgba(255, 255, 255, 0.65); }
.me-stat-value {
  margin-top: 4px; font-size: 22px; font-weight: 800; letter-spacing: -0.4px;
  font-variant-numeric: tabular-nums;
}
.me-stat-note { margin-top: 2px; font-size: 11.5px; color: rgba(255, 255, 255, 0.55); }

/* ── Обратите внимание ── */
.me-note {
  display: flex; gap: 10px; margin-top: 16px; padding: 14px 16px; border-radius: 12px;
  background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.3);
}
.me-note-icon { color: #b45309; flex: none; }
.me-note-title { font-size: 13.5px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.me-note-line {
  margin-top: 3px; font-size: 12.5px; line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.62);
}

/* ── Карточки ── */
.me-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  /* По верху: иначе короткая карточка растягивается под соседнюю и внизу
     остаётся пустое поле. */
  align-items: start;
  gap: 14px; margin-top: 16px;
}
.me-card {
  padding: 18px 20px; border-radius: 14px; margin-top: 16px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.me-grid .me-card { margin-top: 0; }
.me-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.me-card-title { font-size: 15px; font-weight: 700; margin: 0; }
.me-card-note {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45);
  font-variant-numeric: tabular-nums;
}

.me-rows { display: flex; flex-direction: column; margin-top: 12px; }
.me-row {
  display: flex; align-items: center; gap: 12px; padding: 11px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.me-row:last-child { border-bottom: none; }
.me-row-main { flex: 1; min-width: 0; }
.me-row-title { font-size: 13.5px; font-weight: 600; }
.me-row-text { margin-top: 2px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.me-row-mark {
  flex: none; display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 11px;
  background: rgba(4, 120, 87, 0.1); color: #047857;
}
.me-row-mark--off {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.35);
}

.me-sub-title {
  margin-top: 16px; font-size: 11px; font-weight: 700;
  letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.me-sections { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.me-section {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 11px; border-radius: 9px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.75);
  transition: border-color 0.15s, color 0.15s;
}
.me-section:hover { border-color: rgba(4, 120, 87, 0.45); color: #047857; }
.me-hint {
  margin-top: 10px; font-size: 11.5px; line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.42);
}

.me-mini { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.me-mini-item {
  padding: 12px 14px; border-radius: 11px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.me-mini-value { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.me-mini-label { margin-top: 2px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }

/* ── Таблица сделок ── */
.me-table-wrap { overflow-x: auto; margin-top: 12px; }
.me-table { width: 100%; border-collapse: collapse; }
.me-table th {
  padding: 0 14px 8px 0; text-align: left; white-space: nowrap;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.42);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.me-table th.me-num { text-align: right; }
.me-table td {
  padding: 11px 14px 11px 0; font-size: 13px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.me-table tbody tr:last-child td { border-bottom: none; }
.me-table th:last-child, .me-table td:last-child { padding-right: 0; }
.me-table-row { cursor: pointer; }
.me-table-row:hover td { background: rgba(var(--v-theme-on-surface), 0.02); }
.me-deal-name { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }
.me-deal-sub { margin-top: 2px; font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); }
.me-muted { color: rgba(var(--v-theme-on-surface), 0.6); }
.me-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.me-num--strong { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }

.me-status {
  display: inline-block; padding: 3px 9px; border-radius: 7px;
  font-size: 11.5px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.me-status--active { background: rgba(4, 120, 87, 0.1); color: #047857; }
.me-status--overdue { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
.me-status--completed { background: rgba(59, 130, 246, 0.1); color: #2563eb; }

.me-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 36px 20px; text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.me-empty-title { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.75); }
.me-empty-text { font-size: 12.5px; line-height: 1.5; max-width: 420px; }

@media (max-width: 900px) {
  .me-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .me-hero { padding: 20px; }
  .me-stats, .me-mini { grid-template-columns: minmax(0, 1fr); }
}
</style>
