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
import type { PointHandover } from '@/stores/point'

/**
 * Передача выручки инкассатору — сторона оператора.
 *
 * Он только заявляет сумму: деньги остаются в кассе пункта, пока инкассатор
 * не подтвердит приём. Так не бывает момента, когда наличные не числятся
 * ни за кем — ровно этой путаницы и нужно избежать.
 */

const point = usePointStore()
const toast = useToast()

const stop = ref<PointHandover | null>(null)
const loading = ref(false)
const amount = ref<number | null>(null)
const saving = ref(false)

const balance = computed(
  () => point.context?.points.find((p) => p.id === point.activePointId)?.balance ?? 0,
)
const overBalance = computed(() => !!amount.value && amount.value > balance.value)

async function load() {
  if (!point.activePointId) return
  loading.value = true
  try {
    stop.value = await point.handover(point.activePointId)
    amount.value = stop.value?.handedAmount ?? balance.value
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!point.context) await point.loadContext()
  load()
})
watch(() => point.activePointId, () => load())

async function submit() {
  if (!stop.value || !point.activePointId || !amount.value) return
  saving.value = true
  try {
    await point.hand({ accountId: point.activePointId, stopId: stop.value.stopId, amount: amount.value })
    toast.success('Передача отмечена — ждём подтверждения инкассатора')
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отметить передачу')
  } finally {
    saving.value = false
  }
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}
</script>

<template>
  <div>
    <div class="pt-title mb-1">Передать инкассатору</div>
    <div class="pt-hint mb-4">Деньги спишутся с пункта, когда инкассатор подтвердит приём</div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-3" />

    <div v-if="!loading && !stop" class="pt-empty">
      <v-icon icon="mdi-truck-outline" size="36" class="mb-2" />
      <div>Инкассация не назначена</div>
      <div class="text-caption">Когда за деньгами поедут, здесь появится заявка</div>
    </div>

    <template v-if="stop">
      <v-card flat class="pt-card mb-4">
        <div class="d-flex align-center ga-3">
          <v-icon icon="mdi-account-arrow-right-outline" size="22" />
          <div class="flex-grow-1">
            <div class="font-weight-bold">{{ stop.collectorName }}</div>
            <div class="text-caption text-medium-emphasis">
              Рейс №{{ stop.runNumber }} · {{ dateLabel(stop.runDate) }}
            </div>
          </div>
        </div>
      </v-card>

      <!-- Уже заявили — показываем, чего ждём, но менять ещё можно: инкассатор
           пока не подтвердил. -->
      <v-alert
        v-if="stop.status === 'HANDED'"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4"
      >
        Вы отметили передачу {{ formatCurrency(stop.handedAmount || 0) }}. Ждём подтверждения — до
        него деньги числятся за пунктом.
      </v-alert>

      <div class="pt-label mb-1">Сколько передаёте</div>
      <v-text-field
        v-model.number="amount"
        type="number"
        variant="outlined"
        density="comfortable"
        suffix="₽"
        hide-details
      />
      <div v-if="overBalance" class="text-caption text-error mt-2">
        В кассе пункта {{ formatCurrency(balance) }} — больше передать нечего
      </div>
      <div v-else class="text-caption text-medium-emphasis mt-2">
        В кассе пункта {{ formatCurrency(balance) }}
      </div>

      <v-btn
        block
        color="primary"
        size="large"
        class="mt-4"
        :loading="saving"
        :disabled="!amount || amount <= 0 || overBalance"
        @click="submit"
      >
        {{ stop.status === 'HANDED' ? 'Изменить сумму' : 'Отметить передачу' }}
      </v-btn>
    </template>
  </div>
</template>

<style scoped>
.pt-title {
  font-size: 20px;
  font-weight: 700;
}
.pt-hint,
.pt-label {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.pt-label {
  font-weight: 500;
}
.pt-card {
  padding: 14px 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
}
.pt-empty {
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 32px 0;
}
</style>
