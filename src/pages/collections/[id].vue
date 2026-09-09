<script lang="ts" setup>
import { useAccountingStore } from '@/stores/accounting'
import { useAuthStore } from '@/stores/auth'
import { usePageHeaderStore } from '@/stores/pageHeader'
import { useToast } from '@/composables/useToast'
import { formatCurrency } from '@/utils/formatters'
import type { CollectionRunDetail, CollectionStopView } from '@/stores/accounting'

/**
 * Рейс инкассации: пункты, подтверждение приёма и сдача выручки в офис.
 *
 * Деньги двигаются ровно в двух местах этого экрана — «принял» по пункту и
 * «принял в кассу». Оба требуют подтверждения второй стороной, поэтому суммы
 * вводятся руками, а не подставляются молча.
 */

const store = useAccountingStore()
const auth = useAuthStore()
const pageHeader = usePageHeaderStore()
const toast = useToast()
const route = useRoute()
const router = useRouter()

const runId = computed(() => (route.params as { id: string }).id)
const run = ref<CollectionRunDetail | null>(null)
const loading = ref(false)

const canCollect = computed(() => auth.can('collections.collect'))
const canReceive = computed(() => auth.can('collections.receive'))
const canPlan = computed(() => auth.can('collections.plan'))

const STOP_STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Ждём', color: '#6b7280' },
  HANDED: { label: 'Передано оператором', color: '#f59e0b' },
  RECEIVED: { label: 'Принято', color: '#10b981' },
  SKIPPED: { label: 'Пропущен', color: '#9ca3af' },
}

const receivedTotal = computed(() =>
  (run.value?.stops ?? []).reduce((s, x) => s + (x.receivedAmount ?? 0), 0),
)
const openStops = computed(() =>
  (run.value?.stops ?? []).filter((s) => s.status === 'PENDING' || s.status === 'HANDED'),
)
const stillInPoints = computed(() =>
  (run.value?.stops ?? [])
    .filter((s) => s.status !== 'RECEIVED')
    .reduce((a, s) => a + (s.account.balance ?? 0), 0),
)

async function load() {
  loading.value = true
  try {
    run.value = await store.fetchRun(runId.value)
    pageHeader.set(
      `Рейс №${run.value.number}`,
      `${run.value.collector.name} · ${new Date(run.value.date).toLocaleDateString('ru-RU')}`,
    )
  } catch (e: any) {
    toast.error(e?.message || 'Рейс не найден')
    router.push('/accounting/points')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ── Приём в пункте ──
const receiveTarget = ref<CollectionStopView | null>(null)
const receiveForm = ref({ amount: 0, note: '' })
const receiving = ref(false)

/** Расхождение с заявкой оператора требует объяснения — молча его не проглатываем. */
const mismatch = computed(
  () =>
    !!receiveTarget.value &&
    receiveTarget.value.handedAmount != null &&
    receiveTarget.value.handedAmount !== receiveForm.value.amount,
)

function openReceive(s: CollectionStopView) {
  receiveTarget.value = s
  receiveForm.value = { amount: s.handedAmount ?? s.expectedAmount, note: '' }
}

async function confirmReceive() {
  if (!receiveTarget.value) return
  receiving.value = true
  try {
    await store.receiveStop(runId.value, receiveTarget.value.id, {
      amount: receiveForm.value.amount,
      discrepancyNote: receiveForm.value.note || undefined,
    })
    receiveTarget.value = null
    toast.success('Деньги приняты')
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось принять')
  } finally {
    receiving.value = false
  }
}

async function skip(s: CollectionStopView) {
  try {
    await store.skipStop(runId.value, s.id, 'Пропущен инкассатором')
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось пропустить')
  }
}

// ── Сдача в офис ──
const declareDialog = ref(false)
const declareAmount = ref(0)
const declaring = ref(false)

function openDeclare() {
  declareAmount.value = receivedTotal.value
  declareDialog.value = true
}
async function confirmDeclare() {
  declaring.value = true
  try {
    await store.declareRun(runId.value, declareAmount.value)
    declareDialog.value = false
    toast.success('Отмечено. Ждём приёма в офисе')
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отметить')
  } finally {
    declaring.value = false
  }
}

const deliverDialog = ref(false)
const deliverForm = ref({ amount: 0, officeAccountId: '', note: '' })
const delivering = ref(false)
const officeAccounts = computed(() =>
  store.accounts.filter(
    (a) => a.type !== 'PAYMENT_POINT' && a.id !== run.value?.collectorAccount.id,
  ),
)
const deliverMismatch = computed(
  () => run.value?.declaredAmount != null && run.value.declaredAmount !== deliverForm.value.amount,
)

async function openDeliver() {
  if (!store.accounts.length) await store.fetchAccounts().catch(() => {})
  deliverForm.value = {
    amount: run.value?.declaredAmount ?? receivedTotal.value,
    officeAccountId: officeAccounts.value[0]?.id ?? '',
    note: '',
  }
  deliverDialog.value = true
}

async function confirmDeliver() {
  delivering.value = true
  try {
    await store.deliverRun(runId.value, {
      amount: deliverForm.value.amount,
      officeAccountId: deliverForm.value.officeAccountId,
      discrepancyNote: deliverForm.value.note || undefined,
    })
    deliverDialog.value = false
    toast.success('Выручка принята в кассу')
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось принять')
  } finally {
    delivering.value = false
  }
}

async function cancelRun() {
  try {
    await store.cancelRun(runId.value)
    toast.success('Рейс отменён')
    await load()
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отменить')
  }
}
</script>

<template>
  <div class="page-wrap">
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-3" />

    <template v-if="run">
      <!-- Где сейчас деньги этого рейса -->
      <div class="cl-flow mb-5">
        <div class="cl-flow-step">
          <div class="cl-flow-label">В пунктах</div>
          <div class="cl-flow-value">{{ formatCurrency(stillInPoints) }}</div>
        </div>
        <v-icon icon="mdi-arrow-right" class="cl-flow-arrow" />
        <div class="cl-flow-step">
          <div class="cl-flow-label">У инкассатора</div>
          <div class="cl-flow-value">{{ formatCurrency(run.collectorAccount.balance) }}</div>
        </div>
        <v-icon icon="mdi-arrow-right" class="cl-flow-arrow" />
        <div class="cl-flow-step">
          <div class="cl-flow-label">Сдано в кассу</div>
          <div class="cl-flow-value">
            {{ run.officeReceivedAmount != null ? formatCurrency(run.officeReceivedAmount) : '—' }}
          </div>
        </div>
      </div>

      <div class="cl-title mb-2">Пункты</div>
      <div class="d-flex flex-column ga-2 mb-5">
        <v-card v-for="s in run.stops" :key="s.id" flat class="cl-stop">
          <div class="d-flex align-center ga-3 flex-wrap">
            <div class="flex-grow-1 min-w-0">
              <div class="d-flex align-center ga-2">
                <span class="font-weight-bold">{{ s.account.name }}</span>
                <span
                  class="cl-badge"
                  :style="{
                    color: STOP_STATUS[s.status]?.color,
                    borderColor: (STOP_STATUS[s.status]?.color || '') + '55',
                  }"
                >
                  {{ STOP_STATUS[s.status]?.label }}
                </span>
              </div>
              <div class="text-caption text-medium-emphasis">
                <template v-if="s.status === 'RECEIVED'"
                  >принято {{ formatCurrency(s.receivedAmount || 0)
                  }}<template v-if="s.handedAmount != null && s.handedAmount !== s.receivedAmount"
                    >, оператор передавал {{ formatCurrency(s.handedAmount) }}</template
                  ></template
                >
                <template v-else-if="s.handedAmount != null">
                  оператор передаёт {{ formatCurrency(s.handedAmount) }}
                </template>
                <template v-else> в кассе сейчас {{ formatCurrency(s.account.balance) }} </template>
              </div>
              <div v-if="s.discrepancyNote" class="cl-note mt-1">{{ s.discrepancyNote }}</div>
            </div>

            <div v-if="canCollect && (s.status === 'PENDING' || s.status === 'HANDED')" class="d-flex ga-2">
              <v-btn size="small" variant="text" @click="skip(s)">Пропустить</v-btn>
              <v-btn size="small" color="primary" @click="openReceive(s)">Принять</v-btn>
            </div>
          </div>
        </v-card>
      </div>

      <!-- Сдача выручки -->
      <v-card flat class="cl-stop">
        <div class="d-flex align-center ga-4 flex-wrap">
          <div class="flex-grow-1">
            <div class="font-weight-bold">Сдача в кассу</div>
            <div class="text-caption text-medium-emphasis">
              <template v-if="run.deliveredAt">
                Принято {{ formatCurrency(run.officeReceivedAmount || 0) }}
                <template v-if="run.officeAccount"> на «{{ run.officeAccount.name }}»</template>
              </template>
              <template v-else-if="run.declaredAmount != null">
                Инкассатор сдаёт {{ formatCurrency(run.declaredAmount) }} — ждём приёма
              </template>
              <template v-else-if="openStops.length">
                Сначала закройте пункты: осталось {{ openStops.length }}
              </template>
              <template v-else> Собрано {{ formatCurrency(receivedTotal) }} </template>
            </div>
            <div v-if="run.officeDiscrepancyNote" class="cl-note mt-1">
              {{ run.officeDiscrepancyNote }}
            </div>
          </div>

          <v-btn
            v-if="canCollect && !run.deliveredAt && run.declaredAmount == null"
            :disabled="!!openStops.length"
            variant="tonal"
            @click="openDeclare"
          >
            Сдал деньги
          </v-btn>
          <!-- Пока есть незакрытые пункты, сдавать нечего: иначе рейс станет
               «сданным», а деньги останутся в магазинах. -->
          <v-btn
            v-if="canReceive && !run.deliveredAt"
            color="primary"
            :disabled="!!openStops.length"
            @click="openDeliver"
          >
            Принять в кассу
          </v-btn>
        </div>
      </v-card>

      <div v-if="canPlan && run.status !== 'DELIVERED' && run.status !== 'CANCELLED'" class="mt-4">
        <v-btn variant="text" color="error" size="small" @click="cancelRun">Отменить рейс</v-btn>
      </div>
    </template>

    <!-- Приём денег в пункте -->
    <v-dialog
      :model-value="!!receiveTarget"
      max-width="440"
      @update:model-value="(v) => { if (!v) receiveTarget = null }"
    >
      <v-card v-if="receiveTarget" class="pa-5">
        <div class="text-h6 mb-1">Принять деньги</div>
        <div class="text-body-2 text-medium-emphasis mb-4">{{ receiveTarget.account.name }}</div>

        <v-text-field
          v-model.number="receiveForm.amount"
          label="Сколько приняли"
          type="number"
          variant="outlined"
          density="comfortable"
          suffix="₽"
          hide-details
        />
        <div class="text-caption text-medium-emphasis mt-2">
          <template v-if="receiveTarget.handedAmount != null">
            Оператор передавал {{ formatCurrency(receiveTarget.handedAmount) }}
          </template>
          <template v-else>
            В кассе пункта {{ formatCurrency(receiveTarget.account.balance) }}
          </template>
        </div>

        <!-- Расхождение не списывается автоматически: разница остаётся на
             пункте, пока люди не разберутся. -->
        <template v-if="mismatch">
          <v-textarea
            v-model="receiveForm.note"
            label="Причина расхождения"
            variant="outlined"
            density="comfortable"
            rows="2"
            hide-details
            class="mt-3"
          />
          <div class="cl-note mt-2">Разница останется на пункте — она не спишется сама</div>
        </template>

        <div class="d-flex ga-2 mt-5">
          <v-btn variant="text" @click="receiveTarget = null">Отмена</v-btn>
          <v-spacer />
          <v-btn
            color="primary"
            :loading="receiving"
            :disabled="
              !receiveForm.amount || receiveForm.amount <= 0 || (mismatch && !receiveForm.note.trim())
            "
            @click="confirmReceive"
          >
            Принять {{ formatCurrency(receiveForm.amount || 0) }}
          </v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- Инкассатор сдаёт -->
    <v-dialog v-model="declareDialog" max-width="400">
      <v-card class="pa-5">
        <div class="text-h6 mb-4">Сдать выручку</div>
        <v-text-field
          v-model.number="declareAmount"
          label="Сумма"
          type="number"
          variant="outlined"
          density="comfortable"
          suffix="₽"
          hide-details
        />
        <div class="text-caption text-medium-emphasis mt-2">
          Деньги перейдут в кассу, когда их примут в офисе
        </div>
        <div class="d-flex ga-2 mt-5">
          <v-btn variant="text" @click="declareDialog = false">Отмена</v-btn>
          <v-spacer />
          <v-btn color="primary" :loading="declaring" :disabled="!declareAmount" @click="confirmDeclare">
            Отметить
          </v-btn>
        </div>
      </v-card>
    </v-dialog>

    <!-- Приём в кассу -->
    <v-dialog v-model="deliverDialog" max-width="440">
      <v-card class="pa-5">
        <div class="text-h6 mb-4">Принять выручку в кассу</div>

        <v-select
          v-model="deliverForm.officeAccountId"
          :items="officeAccounts"
          item-title="name"
          item-value="id"
          label="Куда кладём"
          variant="outlined"
          density="comfortable"
          hide-details
          class="mb-3"
        />
        <v-text-field
          v-model.number="deliverForm.amount"
          label="Сколько приняли"
          type="number"
          variant="outlined"
          density="comfortable"
          suffix="₽"
          hide-details
        />
        <div v-if="run?.declaredAmount != null" class="text-caption text-medium-emphasis mt-2">
          Инкассатор сдавал {{ formatCurrency(run.declaredAmount) }}
        </div>

        <v-textarea
          v-if="deliverMismatch"
          v-model="deliverForm.note"
          label="Причина расхождения"
          variant="outlined"
          density="comfortable"
          rows="2"
          hide-details
          class="mt-3"
        />

        <div class="d-flex ga-2 mt-5">
          <v-btn variant="text" @click="deliverDialog = false">Отмена</v-btn>
          <v-spacer />
          <v-btn
            color="primary"
            :loading="delivering"
            :disabled="
              !deliverForm.amount ||
              !deliverForm.officeAccountId ||
              (deliverMismatch && !deliverForm.note.trim())
            "
            @click="confirmDeliver"
          >
            Принять {{ formatCurrency(deliverForm.amount || 0) }}
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.page-wrap {
  padding: 0 4px;
}
.cl-flow {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.cl-flow-step {
  flex: 1;
  min-width: 150px;
  padding: 14px 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
}
.cl-flow-label {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cl-flow-value {
  font-size: 20px;
  font-weight: 700;
}
.cl-flow-arrow {
  color: rgba(var(--v-theme-on-surface), 0.3);
}
.cl-title {
  font-size: 16px;
  font-weight: 600;
}
.cl-stop {
  padding: 14px 18px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
}
.cl-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border: 1px solid;
  border-radius: 20px;
}
.cl-note {
  font-size: 12px;
  color: #b45309;
}
</style>
