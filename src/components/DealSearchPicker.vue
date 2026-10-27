<script setup lang="ts">
/**
 * Поиск сделки по номеру договора, клиенту, телефону или товару — тот же
 * поиск, что в быстрых действиях (`/deals/quick-search`). Сервер сам учитывает
 * кассы, скрытые от сотрудника.
 *
 * `amountHint` — сумма, которую ищем (например, неизвестный приход): сделки,
 * где ближайший платёж ровно такой, подсвечиваются и стоят первыми.
 */
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import { formatCurrency, formatDate } from '@/utils/formatters'

export interface DealSearchResult {
  id: string
  dealNumber: number
  productName: string
  clientName: string
  clientPhone: string
  totalPrice: number
  remainingAmount: number
  paidPayments: number
  numberOfPayments: number
  nextPayment: { id: string; number: number; amount: number; dueDate: string; status: 'PENDING' | 'OVERDUE' } | null
}

const props = defineProps<{ amountHint?: number | null; selectedId?: string | null }>()
const emit = defineEmits<{ (e: 'pick', deal: DealSearchResult): void }>()

const q = ref('')
const results = ref<DealSearchResult[]>([])
const searching = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

watch(q, (v) => {
  if (timer) clearTimeout(timer)
  if (!v.trim()) {
    results.value = []
    return
  }
  timer = setTimeout(() => void search(v.trim()), 250)
})

async function search(text: string) {
  searching.value = true
  try {
    results.value = await api.get<DealSearchResult[]>(`/deals/quick-search?q=${encodeURIComponent(text)}`)
  } catch {
    results.value = []
  } finally {
    searching.value = false
  }
}

const matches = (r: DealSearchResult) =>
  !!props.amountHint && !!r.nextPayment && Math.round(r.nextPayment.amount) === Math.round(props.amountHint)

const sorted = computed(() => [...results.value].sort((a, b) => Number(matches(b)) - Number(matches(a))))
</script>

<template>
  <div class="dsp">
    <div class="dsp-input-wrap">
      <v-icon icon="mdi-magnify" size="18" class="dsp-icon" />
      <input v-clear v-model="q" class="dsp-input" placeholder="Номер договора, клиент, телефон или товар" />
      <v-progress-circular v-if="searching" indeterminate size="16" width="2" class="dsp-spin" />
    </div>
    <div v-if="sorted.length" class="dsp-list">
      <button
        v-for="r in sorted"
        :key="r.id"
        type="button"
        class="dsp-item"
        :class="{ 'dsp-item--on': r.id === selectedId, 'dsp-item--match': matches(r) }"
        @click="emit('pick', r)"
      >
        <div class="dsp-top">
          <span class="dsp-num">№{{ r.dealNumber }}</span>
          <span class="dsp-name">{{ r.clientName }}</span>
          <span v-if="matches(r)" class="dsp-badge">сумма совпадает</span>
        </div>
        <div class="dsp-sub">
          {{ r.productName }}
          <template v-if="r.nextPayment">
            · платёж {{ r.nextPayment.number }}: {{ formatCurrency(r.nextPayment.amount) }} до {{ formatDate(r.nextPayment.dueDate) }}
            <span v-if="r.nextPayment.status === 'OVERDUE'" class="dsp-late">просрочен</span>
          </template>
          <template v-else> · открытых платежей нет</template>
        </div>
      </button>
    </div>
    <div v-else-if="q.trim() && !searching" class="dsp-empty">Ничего не нашлось</div>
  </div>
</template>

<style scoped>
.dsp-input-wrap { position: relative; }
.dsp-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: rgba(var(--v-theme-on-surface), 0.4); }
.dsp-spin { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); }
.dsp-input {
  width: 100%; height: 42px; padding: 0 36px 0 38px; border-radius: 10px; outline: none;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9);
}
.dsp-input:focus { border-color: #4f46e5; }
.dsp-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; max-height: 260px; overflow-y: auto; }
.dsp-item {
  text-align: left; padding: 9px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1); background: rgb(var(--v-theme-surface));
}
.dsp-item:hover { border-color: rgba(79, 70, 229, 0.4); }
.dsp-item--on { border-color: #4f46e5; background: rgba(99, 102, 241, 0.07); }
.dsp-top { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; }
.dsp-num { color: rgba(var(--v-theme-on-surface), 0.5); font-variant-numeric: tabular-nums; }
.dsp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-badge { margin-left: auto; padding: 1px 7px; border-radius: 6px; font-size: 10.5px; font-weight: 700; background: rgba(4, 120, 87, 0.12); color: #047857; flex: none; }
.dsp-sub { font-size: 12px; margin-top: 2px; color: rgba(var(--v-theme-on-surface), 0.55); }
.dsp-late { color: #dc2626; font-weight: 600; }
.dsp-empty { font-size: 13px; margin-top: 8px; color: rgba(var(--v-theme-on-surface), 0.5); }
</style>
