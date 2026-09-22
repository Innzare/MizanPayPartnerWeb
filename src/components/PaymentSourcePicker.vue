<script setup lang="ts">
/**
 * Куда легли деньги по этой оплате.
 *
 * Показываем компактной строкой: в большинстве случаев счёт один и тот же, и
 * заставлять выбирать его при каждой оплате — лишний клик. Поэтому сервис
 * подставляет счёт сам (по кассе и настройке «по умолчанию»), а здесь можно
 * поменять — и сразу видно, куда деньги пойдут.
 *
 * Если счетов нет вовсе, блока не будет: раздел «Счета» ещё не заведён, и
 * спрашивать не о чем — деньги встанут в «не разнесено».
 */
import { computed, onMounted, ref, watch } from 'vue'
import AccountSelect from '@/components/AccountSelect.vue'
import { useAccountingStore, type AccountView } from '@/stores/accounting'
import { useAuthStore } from '@/stores/auth'
import { CURRENCY_MASK, parseMasked, formatCurrency } from '@/utils/formatters'

const props = defineProps<{
  /** Выбранный счёт. Пусто — сервис определит сам. */
  modelValue: string | null
  /**
   * Сумма платежа. Нужна для смешанной оплаты: доли обязаны сойтись с ней
   * до копейки, иначе деньги «появятся» на счетах из ниоткуда.
   */
  total?: number
  /** Разнесение по счетам, когда платят частями. */
  allocations?: Array<{ accountId: string; amount: number }> | null
  /** Способ оплаты: наличные подсказывают сейф, перевод — карту. */
  method?: 'CASH' | 'TRANSFER' | 'CARD' | 'AUTO' | null
  /** Касса сделки — у неё может быть свой счёт. */
  cashBoxId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string | null): void
  (e: 'update:allocations', v: Array<{ accountId: string; amount: number }> | null): void
}>()

const store = useAccountingStore()
const auth = useAuthStore()

const loaded = ref(false)

onMounted(async () => {
  // Раздел может быть закрыт правом — тогда молча ничего не показываем.
  if (!auth.can('accounting.view')) return
  try {
    if (!store.accounts.length) await store.fetchAccounts()
    // Обороты по лимитам — чтобы пометить карту, у которой лимит уже выбран.
    // Принять на неё деньги можно (банк перевод проведёт), но человек должен
    // видеть это до выбора, а не узнавать из отчёта.
    if (!store.limits.length) await store.fetchLimits().catch(() => {})
  } catch {
    /* счета не критичны для оплаты: не срываем её из-за них */
  }
  loaded.value = true
})

/**
 * Счета в выборе.
 *
 * Отключённые и упёршиеся в лимит показываем тоже — с пометкой. Эти признаки
 * говорят «сама система сюда деньги не кладёт», но не отменяют перевода,
 * который клиент уже сделал: раньше такую карту нельзя было даже выбрать, и
 * оплата записывалась не туда, где деньги лежат на самом деле.
 */
const usable = computed(() => store.accounts)

/** Куда система подставит счёт сама — отключённые для этого не годятся. */
const autoUsable = computed(() => store.accounts.filter((a) => !a.disabledAt))

/**
 * Тот же порядок, что на сервере: счёт кассы → счёт по умолчанию для этого
 * вида денег → единственный подходящий. Иначе подсказка на экране расходилась
 * бы с тем, куда деньги лягут на самом деле.
 */
const suggested = computed<AccountView | null>(() => {
  const cash = props.method === 'CASH'
  const fit = autoUsable.value.filter((a) => (cash ? a.type === 'CASH' : a.type === 'BANK_CARD'))
  // Деньги кассы ложатся на счета этой кассы — и только на них. Счёт чужой
  // кассы не подставляем, даже если он отмечен «по умолчанию».
  const own = props.cashBoxId ? fit.filter((a) => a.cashBoxId === props.cashBoxId) : fit
  const byDefault = own.find((a) => (cash ? a.isDefaultForCash : a.isDefaultForBank))
  if (byDefault) return byDefault
  return own.length === 1 ? own[0]! : (props.cashBoxId ? (own[0] ?? null) : null)
})

const chosen = computed<AccountView | null>(
  () => usable.value.find((a) => a.id === props.modelValue) ?? suggested.value,
)

/**
 * Выбран счёт, которым система сама не пользуется: отключён или лимит выбран.
 * Деньги на него записать можно — но сказать об этом надо.
 */
const chosenUnavailable = computed<null | 'off' | 'full'>(() => {
  const a = chosen.value
  if (!a) return null
  if (a.disabledAt) return 'off'
  return store.limits.find((l) => l.id === a.id)?.limits.full ? 'full' : null
})

/**
 * Смешанная оплата: клиент принёс часть наличными, часть перевёл.
 *
 * Прячем за отдельной кнопкой: так платят редко, и показывать таблицу долей
 * при каждой оплате — мешать в девяти случаях из десяти.
 */
const split = ref(false)
const parts = ref<Array<{ accountId: string; amount: number | null }>>([])

const splitSum = computed(() => parts.value.reduce((s, p) => s + Math.round(p.amount ?? 0), 0))
const splitLeft = computed(() => Math.round(props.total ?? 0) - splitSum.value)

function startSplit() {
  split.value = true
  // Первая строка — счёт, который и так был выбран, на всю сумму: чаще всего
  // достаточно поправить её и добавить вторую.
  parts.value = [{ accountId: chosen.value?.id ?? autoUsable.value[0]?.id ?? '', amount: props.total ?? null }]
  emitParts()
}

function stopSplit() {
  split.value = false
  parts.value = []
  emit('update:allocations', null)
}

function addPart() {
  const used = new Set(parts.value.map((p) => p.accountId))
  const next = autoUsable.value.find((a) => !used.has(a.id))
  if (!next) return
  parts.value.push({ accountId: next.id, amount: splitLeft.value > 0 ? splitLeft.value : null })
  emitParts()
}

function removePart(i: number) {
  parts.value.splice(i, 1)
  emitParts()
}

/** Наружу отдаём только полные, сошедшиеся доли — половинчатые бессмысленны. */
function emitParts() {
  const ready = parts.value.filter((p) => p.accountId && (p.amount ?? 0) > 0)
  emit(
    'update:allocations',
    split.value && ready.length > 1 && splitLeft.value === 0
      ? ready.map((p) => ({ accountId: p.accountId, amount: Math.round(p.amount!) }))
      : null,
  )
}

watch([parts, split], emitParts, { deep: true })

function pick(id: string | null) {
  emit('update:modelValue', id)
}

// Сменился способ оплаты — прежний выбор мог перестать подходить.
watch(
  () => props.method,
  () => {
    if (!props.modelValue) return
    const still = usable.value.find((a) => a.id === props.modelValue)
    if (!still) emit('update:modelValue', null)
  },
)
</script>

<template>
  <div v-if="loaded && usable.length" class="psp">
    <div class="psp-label">Куда поступили деньги</div>

    <!-- Тот же выбор счёта, что в остальных окнах: список раскрывается
         поверх окна и разделён по видам денег. Своя строка со своим списком
         уезжала под нижний край окна, и до счетов приходилось долистывать. -->
    <AccountSelect
      v-if="!split"
      :model-value="chosen?.id ?? null"
      :items="usable"
      placeholder="Счёт не выбран — попадёт в «не разнесено»"
      @update:model-value="pick"
    />

    <!-- Лимит выбран — деньги принять можно, но пусть это будет сказано
         вслух: потом по такой карте разбираться сложнее. -->
    <div v-if="!split && chosenUnavailable" class="psp-limit">
      <v-icon icon="mdi-alert-circle-outline" size="15" />
      <span v-if="chosenUnavailable === 'off'">
        Счёт отключён. Деньги всё равно запишутся на него — если клиент
        перевёл именно сюда, так и должно быть.
      </span>
      <span v-else>
        Лимит по счёту выбран. Принять деньги можно — операция запишется на
        него, но следующий перевод банк может не пропустить.
      </span>
    </div>

    <!-- Смешанная оплата нужна редко — прячем за ссылкой, а не за полем. -->
    <button v-if="!split && usable.length > 1 && (total ?? 0) > 0" class="psp-split-on" @click="startSplit">
      Платили с нескольких счетов?
    </button>

    <!-- Разделение по счетам -->
    <div v-if="split" class="psp-split">
      <div v-for="(p, i) in parts" :key="i" class="psp-part">
        <AccountSelect v-model="p.accountId" :items="usable" compact />
        <div class="psp-part-amount">
          <input
            :value="p.amount || ''"
            v-maska="CURRENCY_MASK"
            type="text"
            inputmode="numeric"
            class="psp-part-input"
            @maska="(e: any) => p.amount = parseMasked(e)"
          />
          <span class="psp-part-suffix">₽</span>
        </div>
        <button v-if="parts.length > 1" class="psp-part-del" title="Убрать" @click="removePart(i)">
          <v-icon icon="mdi-close" size="15" />
        </button>
      </div>

      <div class="psp-split-foot">
        <button v-if="parts.length < usable.length" class="psp-split-add" @click="addPart">
          <v-icon icon="mdi-plus" size="14" />
          Ещё счёт
        </button>
        <span class="psp-split-left" :class="{ 'psp-split-left--bad': splitLeft !== 0 }">
          <template v-if="splitLeft === 0">Суммы сошлись</template>
          <template v-else-if="splitLeft > 0">Осталось разнести {{ formatCurrency(splitLeft) }}</template>
          <template v-else>Лишние {{ formatCurrency(-splitLeft) }}</template>
        </span>
        <button class="psp-split-off" @click="stopSplit">Отменить разделение</button>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* Строка выбора счёта — общий компонент; здесь только отступы блока. */
.psp { margin-bottom: 16px; }
.psp-label {
  font-size: 13px; font-weight: 500; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* ── Смешанная оплата ── */
.psp-limit {
  display: flex; align-items: flex-start; gap: 7px; margin-top: 8px;
  padding: 8px 10px; border-radius: 9px; font-size: 12.5px; line-height: 1.45;
  background: rgba(239, 68, 68, 0.09); color: #b91c1c;
}
.psp-split-on {
  margin-top: 6px; font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5); cursor: pointer;
  text-decoration: underline; text-underline-offset: 3px;
  text-decoration-color: rgba(var(--v-theme-on-surface), 0.2);
}
.psp-split-on:hover { color: #047857; text-decoration-color: rgba(4, 120, 87, 0.4); }
.psp-split {
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
}
.psp-part { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.psp-part-select {
  flex: 1; min-width: 0; height: 36px; padding: 0 10px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; outline: none; color: rgba(var(--v-theme-on-surface), 0.85);
}
.psp-part-amount { position: relative; width: 140px; }
.psp-part-input {
  width: 100%; height: 36px; padding: 0 26px 0 10px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; outline: none; text-align: right;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.psp-part-suffix {
  position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.35); pointer-events: none;
}
.psp-part-del {
  width: 28px; height: 28px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.4); cursor: pointer;
}
.psp-part-del:hover { color: #dc2626; background: rgba(220, 38, 38, 0.08); }
.psp-split-foot {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding-top: 6px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.psp-split-add {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12.5px; font-weight: 600; color: #047857; cursor: pointer;
}
.psp-split-left {
  margin-left: auto; font-size: 12px; font-weight: 600; color: #047857;
}
.psp-split-left--bad { color: #b45309; }
.psp-split-off {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); cursor: pointer;
}
.psp-split-off:hover { color: rgba(var(--v-theme-on-surface), 0.7); }
</style>
