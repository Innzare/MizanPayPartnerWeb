<route lang="json">
{
  "meta": {
    "layout": "point"
  }
}
</route>

<script lang="ts" setup>
import { usePointStore } from '@/stores/point'
import { formatCurrency } from '@/utils/formatters'
import type { PointEntry, PointAccount } from '@/stores/point'

/**
 * Касса пункта: сколько наличных лежит сейчас и откуда они взялись.
 * Оператор должен уметь пересчитать деньги в ящике и сойтись с экраном.
 */

const point = usePointStore()

const account = ref<PointAccount | null>(null)
const items = ref<PointEntry[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)

const KIND_LABEL: Record<string, string> = {
  PAYMENT_IN: 'Оплата по договору',
  TRANSFER_IN: 'Пополнение',
  TRANSFER_OUT: 'Передано инкассатору',
  REVERSAL: 'Отмена операции',
  ADJUSTMENT: 'Правка остатка',
  EXPENSE: 'Расход',
  INCOME: 'Приход',
}

async function load(more = false) {
  if (!point.activePointId) return
  loading.value = true
  try {
    const res = await point.cash(point.activePointId, more ? nextCursor.value ?? undefined : undefined)
    account.value = res.account
    items.value = more ? [...items.value, ...res.items] : res.items
    nextCursor.value = res.nextCursor
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!point.context) await point.loadContext()
  load()
})
watch(() => point.activePointId, () => load())

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

/** Группировка по дням: без неё лента превращается в сплошной столбец сумм. */
const groups = computed(() => {
  const map = new Map<string, PointEntry[]>()
  for (const e of items.value) {
    const key = dayLabel(e.date)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
  }
  return [...map.entries()]
})
</script>

<template>
  <div>
    <v-card flat class="pt-sum mb-4">
      <div class="text-caption text-medium-emphasis">В кассе пункта</div>
      <div class="pt-sum-value">{{ formatCurrency(account?.balance ?? 0) }}</div>
      <div class="text-caption text-medium-emphasis">{{ account?.name }}</div>
    </v-card>

    <div class="pt-title mb-2">Движения</div>

    <v-progress-linear v-if="loading && !items.length" indeterminate color="primary" class="mb-3" />

    <div v-if="!loading && !items.length" class="pt-empty">
      <v-icon icon="mdi-tray" size="36" class="mb-2" />
      <div>Пока пусто</div>
    </div>

    <div v-for="[day, rows] in groups" :key="day" class="mb-4">
      <div class="pt-day">{{ day }}</div>
      <div class="d-flex flex-column ga-1">
        <div v-for="e in rows" :key="e.id" class="pt-row">
          <div class="flex-grow-1 min-w-0">
            <div class="text-truncate">{{ KIND_LABEL[e.kind] || e.kind }}</div>
            <!-- Примечание показываем, только если оно добавляет что-то к названию
                 операции: иначе строка дублируется сама собой. -->
            <div
              v-if="e.note && e.note !== (KIND_LABEL[e.kind] || e.kind)"
              class="text-caption text-medium-emphasis text-truncate"
            >
              {{ e.note }}
            </div>
          </div>
          <div class="pt-amount" :class="e.amount < 0 ? 'text-error' : 'text-success'">
            {{ e.amount > 0 ? '+' : '' }}{{ formatCurrency(e.amount) }}
          </div>
        </div>
      </div>
    </div>

    <v-btn v-if="nextCursor" block variant="tonal" :loading="loading" @click="load(true)">
      Показать ещё
    </v-btn>
  </div>
</template>

<style scoped>
.pt-sum {
  padding: 18px;
  border-radius: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.pt-sum-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}
.pt-title {
  font-size: 16px;
  font-weight: 600;
}
.pt-day {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 6px;
}
.pt-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.pt-amount {
  font-weight: 600;
  white-space: nowrap;
}
.pt-empty {
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 32px 0;
}
</style>
