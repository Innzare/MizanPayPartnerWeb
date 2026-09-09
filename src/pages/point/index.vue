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
import type { PointSearchResult } from '@/stores/point'

/**
 * Приём платежа в пункте.
 *
 * Оператор не выбирает ни счёт, ни дату, ни режим распределения: всё это
 * решено за него. Его работа — найти человека и принять сумму.
 */

const point = usePointStore()
const toast = useToast()

const query = ref('')
const results = ref<PointSearchResult[]>([])
const searching = ref(false)
const searched = ref(false)
const searchError = ref('')

const selected = ref<PointSearchResult | null>(null)
const amount = ref<number | null>(null)
const paying = ref(false)

/**
 * Больше остатка по договору принимать нечего — почти всегда это лишний ноль
 * при вводе. Сервер такую сумму тоже не пропустит, здесь — чтобы оператор
 * увидел ошибку до нажатия.
 */
const overLimit = computed(
  () => !!selected.value && !!amount.value && amount.value > selected.value.remainingAmount,
)

/**
 * Закрыть договор внесённой суммой, простив разницу.
 *
 * Появляется, только если владелец выдал это право именно этому оператору, и
 * только когда клиент вносит меньше остатка целиком.
 */
const forgiveRest = ref(false)
const canOfferForgive = computed(
  () =>
    !!point.context?.canForgive &&
    !!selected.value &&
    !!amount.value &&
    amount.value < selected.value.remainingAmount,
)
const forgivenAmount = computed(() =>
  selected.value && amount.value ? selected.value.remainingAmount - amount.value : 0,
)
watch(canOfferForgive, (v) => {
  if (!v) forgiveRest.value = false
})

/** Что показать после успешного приёма — с кнопкой отмены на время окна. */
const done = ref<{ paymentId: string; amount: number; clientName: string; until: number } | null>(null)
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

const canUndo = computed(() => !!done.value && done.value.until > now.value)
const undoLeft = computed(() => {
  if (!done.value) return ''
  const sec = Math.max(0, Math.round((done.value.until - now.value) / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
})

const offline = ref(typeof navigator !== 'undefined' && navigator.onLine === false)
function onNet() {
  offline.value = !navigator.onLine
}

onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 1000)
  window.addEventListener('online', onNet)
  window.addEventListener('offline', onNet)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  window.removeEventListener('online', onNet)
  window.removeEventListener('offline', onNet)
})

async function runSearch() {
  const q = query.value.trim()
  searchError.value = ''
  if (q.length < 3) {
    searchError.value = 'Введите телефон, номер договора или фамилию'
    return
  }
  searching.value = true
  searched.value = false
  try {
    results.value = await point.search(q)
    searched.value = true
  } catch (e: any) {
    searchError.value = e?.message || 'Не удалось найти'
    results.value = []
  } finally {
    searching.value = false
  }
}

function choose(r: PointSearchResult) {
  if (!r.nextPayment) return
  selected.value = r
  amount.value = r.nextPayment.amount
  forgiveRest.value = false
}

async function confirmPay() {
  if (!selected.value?.nextPayment || !point.activePointId) return
  paying.value = true
  try {
    await point.pay({
      paymentId: selected.value.nextPayment.paymentId,
      accountId: point.activePointId,
      amount: amount.value ?? undefined,
      forgiveRest: forgiveRest.value || undefined,
    })
    done.value = {
      paymentId: selected.value.nextPayment.paymentId,
      amount: amount.value ?? selected.value.nextPayment.amount,
      clientName: selected.value.clientName,
      until: Date.now() + (point.context?.undoMinutes ?? 60) * 60000,
    }
    selected.value = null
    query.value = ''
    results.value = []
    searched.value = false
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось принять платёж')
  } finally {
    paying.value = false
  }
}

async function undoLast() {
  if (!done.value) return
  try {
    await point.undo(done.value.paymentId)
    toast.success('Оплата отменена')
    done.value = null
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отменить')
  }
}
</script>

<template>
  <div>
    <!-- Связь могла пропасть: в магазине это обычное дело. Принять платёж
         вслепую нельзя — двойная отметка хуже задержки. -->
    <v-alert
      v-if="offline"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-4"
      text="Нет связи. Приём платежей недоступен, пока сеть не вернётся."
    />

    <!-- Итог последнего приёма с окном отмены -->
    <v-card v-if="done" flat class="pt-done mb-4">
      <div class="d-flex align-center ga-3">
        <v-icon icon="mdi-check-circle" color="success" size="28" />
        <div class="flex-grow-1">
          <div class="font-weight-bold">Принято {{ formatCurrency(done.amount) }}</div>
          <div class="text-caption text-medium-emphasis">{{ done.clientName }}</div>
        </div>
        <v-btn v-if="canUndo" size="small" variant="text" color="error" @click="undoLast">
          Отменить · {{ undoLeft }}
        </v-btn>
      </div>
    </v-card>

    <div class="pt-title">Приём платежа</div>
    <div class="pt-hint mb-3">Телефон, номер договора или фамилия — от 4 букв</div>

    <v-text-field
      v-model="query"
      placeholder="Например: 89170414764"
      variant="outlined"
      density="comfortable"
      hide-details="auto"
      :error-messages="searchError"
      clearable
      autocomplete="off"
      inputmode="search"
      @keyup.enter="runSearch"
    >
      <template #append-inner>
        <v-btn
          icon="mdi-magnify"
          variant="text"
          size="small"
          :loading="searching"
          @click="runSearch"
        />
      </template>
    </v-text-field>

    <div v-if="searched && !results.length" class="pt-empty mt-6">
      <v-icon icon="mdi-account-search-outline" size="36" class="mb-2" />
      <div>Ничего не нашлось</div>
      <div class="text-caption">Проверьте номер телефона или договора</div>
    </div>

    <div v-if="results.length" class="mt-4 d-flex flex-column ga-2">
      <v-card
        v-for="r in results"
        :key="r.dealId"
        flat
        class="pt-result"
        :class="{ 'pt-result--disabled': !r.nextPayment }"
        @click="choose(r)"
      >
        <div class="d-flex align-center ga-3">
          <div class="flex-grow-1 min-w-0">
            <div class="d-flex align-center ga-2">
              <span class="font-weight-bold">{{ r.clientName }}</span>
              <span v-if="r.phoneTail" class="text-caption text-medium-emphasis">···{{ r.phoneTail }}</span>
            </div>
            <div class="text-caption text-medium-emphasis text-truncate">
              №{{ r.dealNumber }} · {{ r.productName }}
            </div>
          </div>
          <div class="text-right">
            <template v-if="r.nextPayment">
              <div class="font-weight-bold">{{ formatCurrency(r.nextPayment.amount) }}</div>
              <div class="text-caption" :class="r.nextPayment.overdue ? 'text-error' : 'text-medium-emphasis'">
                {{ r.nextPayment.overdue ? 'просрочен' : 'платёж ' + r.nextPayment.number }}
              </div>
            </template>
            <div v-else class="text-caption text-medium-emphasis">нет открытых платежей</div>
          </div>
        </div>
      </v-card>
    </div>

    <!-- Подтверждение суммы. Счёт не выбирается: деньги ложатся в этот пункт. -->
    <v-dialog :model-value="!!selected" max-width="420" :persistent="paying" @update:model-value="v => { if (!v) selected = null }">
      <v-card v-if="selected" class="pa-5">
        <div class="text-h6 mb-1">Принять платёж</div>
        <div class="text-body-2 text-medium-emphasis mb-4">
          {{ selected.clientName }} · №{{ selected.dealNumber }} · {{ selected.productName }}
        </div>

        <v-text-field
          v-model.number="amount"
          label="Сумма"
          type="number"
          variant="outlined"
          density="comfortable"
          suffix="₽"
          hide-details
        />
        <div class="text-caption text-medium-emphasis mt-2">
          По графику {{ formatCurrency(selected.nextPayment?.amount ?? 0) }} · остаток по договору
          {{ formatCurrency(selected.remainingAmount) }}
        </div>
        <div v-if="overLimit" class="text-caption text-error mt-1">
          Больше остатка по договору принять нельзя
        </div>
        <div v-else class="text-caption text-medium-emphasis mt-1">
          Наличными в кассу пункта, сегодняшним числом
        </div>

        <!-- Закрытие договора со скидкой: только у оператора, которому владелец
             выдал это право, и только когда вносят меньше остатка. -->
        <label v-if="canOfferForgive" class="pt-forgive mt-3">
          <input type="checkbox" v-model="forgiveRest" />
          <span>
            <span class="d-block font-weight-medium">Закрыть договор этой суммой</span>
            <span class="text-caption text-medium-emphasis">
              Остаток {{ formatCurrency(forgivenAmount) }} будет прощён
            </span>
          </span>
        </label>

        <div class="d-flex ga-2 mt-5">
          <v-btn variant="text" :disabled="paying" @click="selected = null">Отмена</v-btn>
          <v-spacer />
          <v-btn
            color="primary"
            :loading="paying"
            :disabled="!amount || amount <= 0 || overLimit || offline"
            @click="confirmPay"
          >
            {{ forgiveRest ? 'Закрыть договор' : 'Принять' }} {{ formatCurrency(amount || 0) }}
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
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
.pt-done {
  padding: 14px 16px;
  border: 1px solid rgba(var(--v-theme-success), 0.35);
  background: rgba(var(--v-theme-success), 0.07);
  border-radius: 12px;
}
.pt-result {
  padding: 14px 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px;
  cursor: pointer;
}
.pt-result--disabled {
  opacity: 0.55;
  cursor: default;
}
.pt-empty {
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 24px 0;
}
.pt-forgive {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  cursor: pointer;
}
</style>
