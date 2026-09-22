<script setup lang="ts">
/**
 * Лента действий сотрудника — одна на оба места: карточку сотрудника в
 * разделе «Сотрудники» и его страницу с показателями.
 *
 * Раньше каждая строка была парой «заголовок + сумма»: «Платёж 6 оплачен ·
 * 16 857 ₽». По какому договору — неизвестно, а именно это владелец и хочет
 * знать, когда проверяет работу человека. Теперь под действием стоит сама
 * сделка: номер, товар и клиент, с переходом в договор.
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { ActivityLog } from '@/types'

const props = defineProps<{
  items: ActivityLog[]
  loading?: boolean
  /** Компактный вид — для узкой панели в списке сотрудников. */
  compact?: boolean
}>()

const router = useRouter()

/**
 * Цвет события по смыслу — как в истории сделки: зелёное принятие денег,
 * красное удаление, оранжевая отмена. Одинаковые серые точки заставляли
 * читать каждую строку, чтобы понять, случилось ли что-то плохое.
 */
const TONE: Record<string, { icon: string; color: string }> = {
  PAYMENT_PAID: { icon: 'mdi-cash-check', color: '#047857' },
  PAYMENT_UNPAID: { icon: 'mdi-cash-remove', color: '#b45309' },
  PAYMENT_RESCHEDULED: { icon: 'mdi-calendar-clock', color: '#b45309' },
  PAYMENT_ADDED: { icon: 'mdi-plus-circle-outline', color: '#0369a1' },
  PAYMENT_REMOVED: { icon: 'mdi-close-circle-outline', color: '#dc2626' },
  DEAL_CREATED: { icon: 'mdi-briefcase-plus-outline', color: '#047857' },
  DEAL_UPDATED: { icon: 'mdi-pencil-outline', color: '#0369a1' },
  DEAL_DELETED: { icon: 'mdi-delete-outline', color: '#dc2626' },
  DEAL_STATUS_CHANGED: { icon: 'mdi-swap-horizontal', color: '#0369a1' },
  CLIENT_CREATED: { icon: 'mdi-account-plus-outline', color: '#047857' },
  CLIENT_UPDATED: { icon: 'mdi-account-edit-outline', color: '#0369a1' },
  CLIENT_DELETED: { icon: 'mdi-account-remove-outline', color: '#dc2626' },
}
function toneOf(type: string) {
  return TONE[type] ?? { icon: 'mdi-circle-medium', color: '#64748b' }
}

/** Дата и время до минуты: «когда именно» — половина ответа на вопрос. */
function when(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Сделка одной строкой: «№9514 · Штукатурка · Ильясов Рамзан». */
function dealLine(a: ActivityLog): string | null {
  if (!a.deal) return null
  return [`№${a.deal.dealNumber}`, a.deal.productName, a.deal.clientName]
    .filter(Boolean)
    .join(' · ')
}

/** Отменённое действие видно по ссылке на исходное событие. */
function isUndo(a: ActivityLog): boolean {
  return !!(a.meta as any)?.undoOf
}

const rows = computed(() => props.items)

function openDeal(a: ActivityLog) {
  if (a.deal) router.push(`/deals/${a.deal.id}`)
}
</script>

<template>
  <div class="saf" :class="{ 'saf--compact': compact }">
    <div v-if="loading" class="saf-loading">
      <v-progress-circular indeterminate size="20" color="#047857" />
    </div>

    <div v-else-if="!rows.length" class="saf-empty">
      <v-icon icon="mdi-history" size="26" />
      <div class="saf-empty-title">Действий пока нет</div>
      <div class="saf-empty-text">
        Здесь появятся оплаты, сделки, правки и отмены — всё, что человек делает в системе.
      </div>
    </div>

    <div v-else class="saf-list">
      <div v-for="a in rows" :key="a.id" class="saf-row" :class="{ 'saf-row--undo': isUndo(a) }">
        <span class="saf-dot" :style="{ background: toneOf(a.type).color + '16', color: toneOf(a.type).color }">
          <v-icon :icon="toneOf(a.type).icon" size="15" />
        </span>
        <div class="saf-body">
          <div class="saf-title">{{ a.title }}</div>
          <div v-if="a.description" class="saf-desc">{{ a.description }}</div>
          <!-- Договор, по которому было действие: без него «Платёж 6
               оплачен» ничего не говорит. -->
          <button v-if="dealLine(a)" class="saf-deal" @click="openDeal(a)">
            <v-icon icon="mdi-briefcase-outline" size="13" />
            {{ dealLine(a) }}
          </button>
          <div class="saf-time">{{ when(a.createdAt) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.saf-loading { display: flex; justify-content: center; padding: 24px; }

.saf-empty { text-align: center; padding: 28px 16px; color: rgba(var(--v-theme-on-surface), 0.5); }
.saf-empty-title { font-size: 14px; font-weight: 600; margin-top: 6px; color: rgba(var(--v-theme-on-surface), 0.7); }
.saf-empty-text { font-size: 12.5px; margin-top: 4px; line-height: 1.45; }

.saf-list { display: flex; flex-direction: column; }
.saf-row {
  display: flex; gap: 11px; padding: 11px 2px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.saf-row:first-child { border-top: none; }
/* Отменённое действие — тусклее: оно случилось, но его уже откатили. */
.saf-row--undo { opacity: 0.6; }

.saf-dot {
  width: 28px; height: 28px; border-radius: 9px; flex: none;
  display: flex; align-items: center; justify-content: center;
}
.saf-body { min-width: 0; flex: 1; }
.saf-title { font-size: 13.5px; font-weight: 600; line-height: 1.35; }
.saf-desc { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 2px; }

.saf-deal {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  margin-top: 5px; padding: 3px 8px; border: none; border-radius: 7px; cursor: pointer;
  font-size: 12px; font-weight: 600; text-align: left;
  background: rgba(4, 120, 87, 0.08); color: #047857;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background 0.15s;
}
.saf-deal:hover { background: rgba(4, 120, 87, 0.16); }

.saf-time { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 5px; }

.saf--compact .saf-title { font-size: 13px; }
.saf--compact .saf-row { padding: 10px 2px; }
</style>
