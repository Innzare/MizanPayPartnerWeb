<route lang="json">
{
  "meta": {
    "layout": "point"
  }
}
</route>

<script lang="ts" setup>
import { usePointStore } from '@/stores/point'
import { useToast } from '@/composables/useToast'
import { formatCurrency } from '@/utils/formatters'
import type { PointEntry } from '@/stores/point'

/**
 * Свои операции: что принял именно этот оператор.
 *
 * Здесь же — отмена собственной ошибки. Окно короткое и считается сервером:
 * дальше правит владелец, потому что отмена возвращает долг клиенту.
 */

const point = usePointStore()
const toast = useToast()

const items = ref<PointEntry[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const undoing = ref<string | null>(null)
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

async function load(more = false) {
  if (!point.activePointId) return
  loading.value = true
  try {
    const res = await point.history(point.activePointId, more ? nextCursor.value ?? undefined : undefined)
    items.value = more ? [...items.value, ...res.items] : res.items
    nextCursor.value = res.nextCursor
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!point.context) await point.loadContext()
  load()
  ticker = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})
watch(() => point.activePointId, () => load())

function undoLeft(e: PointEntry) {
  if (!e.undoUntil) return ''
  const sec = Math.max(0, Math.round((new Date(e.undoUntil).getTime() - now.value) / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
function canUndo(e: PointEntry) {
  return !!e.canUndo && !!e.undoUntil && new Date(e.undoUntil).getTime() > now.value
}

async function undo(e: PointEntry) {
  if (!e.paymentId) return
  undoing.value = e.id
  try {
    await point.undo(e.paymentId)
    toast.success('Оплата отменена')
    await load()
  } catch (err: any) {
    toast.error(err?.message || 'Не удалось отменить')
  } finally {
    undoing.value = null
  }
}

function timeLabel(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}
</script>

<template>
  <div>
    <div class="pt-title mb-1">Мои операции</div>
    <div class="pt-hint mb-4">Только то, что приняли вы</div>

    <v-progress-linear v-if="loading && !items.length" indeterminate color="primary" class="mb-3" />

    <div v-if="!loading && !items.length" class="pt-empty">
      <v-icon icon="mdi-clipboard-text-clock-outline" size="36" class="mb-2" />
      <div>Операций пока нет</div>
    </div>

    <div class="d-flex flex-column ga-2">
      <v-card v-for="e in items" :key="e.id" flat class="pt-row">
        <div class="d-flex align-center ga-3">
          <div class="flex-grow-1 min-w-0">
            <div class="font-weight-medium text-truncate">
              <template v-if="e.dealNumber">№{{ e.dealNumber }} · {{ e.productName }}</template>
              <template v-else>{{ e.note || 'Операция' }}</template>
            </div>
            <div class="text-caption text-medium-emphasis">{{ timeLabel(e.date) }}</div>
          </div>
          <div class="text-right">
            <div class="font-weight-bold" :class="e.amount < 0 ? 'text-error' : ''">
              {{ e.amount > 0 ? '+' : '' }}{{ formatCurrency(e.amount) }}
            </div>
            <v-btn
              v-if="canUndo(e)"
              size="x-small"
              variant="text"
              color="error"
              class="mt-1"
              :loading="undoing === e.id"
              @click="undo(e)"
            >
              Отменить · {{ undoLeft(e) }}
            </v-btn>
          </div>
        </div>
      </v-card>
    </div>

    <v-btn v-if="nextCursor" block variant="tonal" class="mt-3" :loading="loading" @click="load(true)">
      Показать ещё
    </v-btn>
  </div>
</template>

<style scoped>
.pt-title {
  font-size: 20px;
  font-weight: 700;
}
.pt-hint {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.pt-row {
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
}
.pt-empty {
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 32px 0;
}
</style>
