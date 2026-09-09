<script setup lang="ts">
/**
 * Временные операции на «Балансе».
 *
 * Деньги уже двигались, а назначение неизвестно: выдали под отчёт, пришёл
 * перевод от неизвестного, потратили без категории. Остаток счёта при этом
 * правдив с первой секунды — здесь решается только, чем операция оказалась.
 *
 * Блок видно постоянно, пока буфер не пуст: без напоминания разбор
 * откладывается до бесконечности, а часть денег так и остаётся не отнесённой
 * ни к чему.
 */
import { computed, ref } from 'vue'
import BankLogo from '@/components/BankLogo.vue'
import { useAccountingStore, type PendingOpView } from '@/stores/accounting'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { formatCurrency, formatDate } from '@/utils/formatters'

const emit = defineEmits<{ (e: 'changed'): void }>()

const store = useAccountingStore()
const auth = useAuthStore()
const toast = useToast()

const canResolve = computed(() => auth.can('accounting.pending.resolve'))

/** Что выбираем при разборе. Цели — по направлению операции. */
const target = ref<PendingOpView | null>(null)
const kind = ref<'EXPENSE' | 'INCOME' | 'RETURNED'>('EXPENSE')
const note = ref('')
const busy = ref(false)

function openResolve(op: PendingOpView) {
  target.value = op
  kind.value = op.direction === 'OUT' ? 'EXPENSE' : 'INCOME'
  note.value = op.note ?? ''
}

const options = computed(() => {
  if (!target.value) return []
  return target.value.direction === 'OUT'
    ? [
        { value: 'EXPENSE' as const, title: 'Расход по бизнесу', hint: 'Аренда, зарплата, закупка мелочи' },
        { value: 'RETURNED' as const, title: 'Деньги вернули', hint: 'Не потратили — принесли обратно' },
      ]
    : [
        { value: 'INCOME' as const, title: 'Прочий доход', hint: 'Деньги, не связанные со сделками' },
        { value: 'RETURNED' as const, title: 'Вернули выданное', hint: 'Это возврат ранее выданных денег' },
      ]
})

async function confirm() {
  if (!target.value) return
  busy.value = true
  try {
    await store.resolvePending(target.value.id, { type: kind.value, note: note.value.trim() || undefined })
    toast.success('Операция разобрана')
    target.value = null
    emit('changed')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось разобрать операцию')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="store.pendingTotals.count > 0" class="po-card">
    <div class="po-head">
      <v-icon icon="mdi-help-circle-outline" size="18" />
      <span class="po-title">Деньги без назначения</span>
      <span class="po-count">{{ store.pendingTotals.count }}</span>
      <span class="po-sum">{{ formatCurrency(store.pendingTotals.amount) }}</span>
    </div>

    <div class="po-hint">
      Деньги уже двигались, но неизвестно, чем это было. Остатки счетов посчитаны
      верно — осталось сказать, куда отнести.
    </div>

    <div class="po-list">
      <div v-for="op in store.pendingOps" :key="op.id" class="po-row">
        <div class="po-row-icon" :class="op.direction === 'IN' ? 'po-row-icon--in' : 'po-row-icon--out'">
          <v-icon :icon="op.direction === 'IN' ? 'mdi-arrow-down-left' : 'mdi-arrow-up-right'" size="16" />
        </div>
        <div class="po-row-body">
          <div class="po-row-title">
            {{ op.note || (op.direction === 'IN' ? 'Поступление без назначения' : 'Выдача без назначения') }}
          </div>
          <div class="po-row-sub">
            <BankLogo
              :bank-name="op.account.bank?.name"
              :color="op.account.bank?.color || op.account.color"
              :fallback="op.account.code"
              :size="16"
            />
            {{ formatDate(op.date) }} · {{ op.account.code }}
            <template v-if="op.personName"> · за {{ op.personName }}</template>
          </div>
        </div>
        <div class="po-row-amount">
          {{ op.direction === 'IN' ? '+' : '−' }}{{ formatCurrency(op.amount) }}
        </div>
        <button v-if="canResolve" class="po-row-btn" @click="openResolve(op)">Разобрать</button>
      </div>
    </div>

    <!-- Разбор: деньги не двигаются второй раз, меняется только классификация -->
    <v-dialog :model-value="!!target" max-width="440" @update:model-value="target = null">
      <v-card rounded="lg" class="po-dialog">
        <div class="po-dialog-title">Чем это оказалось?</div>
        <div class="po-dialog-sub">
          {{ target?.direction === 'IN' ? 'Поступление' : 'Выдача' }}
          {{ target ? formatCurrency(target.amount) : '' }} · {{ target?.account.name }}.
          Деньги уже на счёте — сейчас решается только, куда их отнести.
        </div>

        <div class="po-options">
          <button
            v-for="o in options"
            :key="o.value"
            type="button"
            class="po-option"
            :class="{ 'po-option--on': kind === o.value }"
            @click="kind = o.value"
          >
            <span class="po-option-title">{{ o.title }}</span>
            <span class="po-option-hint">{{ o.hint }}</span>
          </button>
        </div>

        <div class="po-field">
          <label class="po-label">Комментарий</label>
          <input v-model="note" class="po-input" placeholder="Например: закупка расходников" />
        </div>

        <div class="po-actions">
          <button class="po-cancel" @click="target = null">Отмена</button>
          <button class="po-confirm" :disabled="busy" @click="confirm">
            {{ busy ? 'Записываю…' : 'Разобрать' }}
          </button>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.po-card {
  padding: 14px 18px; border-radius: 14px; margin-bottom: 22px;
  border: 1px solid rgba(99, 102, 241, 0.28);
  background: rgba(99, 102, 241, 0.05);
}
.po-head { display: flex; align-items: center; gap: 8px; color: #4f46e5; }
.po-title { font-size: 14px; font-weight: 700; }
.po-count {
  font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 8px;
  background: rgba(99, 102, 241, 0.16);
}
.po-sum { margin-left: auto; font-size: 15px; font-weight: 700; }
.po-hint {
  font-size: 12.5px; line-height: 1.5; margin-top: 5px; max-width: 640px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.po-list { margin-top: 10px; }
.po-row {
  display: flex; align-items: center; gap: 11px;
  padding: 9px 0; border-top: 1px solid rgba(99, 102, 241, 0.16);
}
.po-row:first-child { border-top: none; }
.po-row-icon {
  width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.po-row-icon--in { background: rgba(16, 185, 129, 0.12); color: #047857; }
.po-row-icon--out { background: rgba(var(--v-theme-on-surface), 0.07); color: rgba(var(--v-theme-on-surface), 0.6); }
.po-row-body { flex: 1; min-width: 0; }
.po-row-title {
  font-size: 13.5px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.po-row-sub { display: flex; align-items: center; gap: 6px; }
.po-row-sub-legacy { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }
.po-row-amount {
  font-size: 14px; font-weight: 700; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.po-row-btn {
  padding: 7px 13px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  background: #4f46e5; color: #fff; cursor: pointer; white-space: nowrap;
}
.po-row-btn:hover { background: #4338ca; }

.po-dialog { padding: 22px 24px 18px; }
.po-dialog-title { font-size: 17px; font-weight: 700; }
.po-dialog-sub {
  font-size: 12.5px; line-height: 1.5; margin-top: 5px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.po-options { display: flex; flex-direction: column; gap: 6px; margin-top: 16px; }
.po-option {
  display: flex; flex-direction: column; gap: 1px;
  padding: 10px 13px; border-radius: 10px; text-align: left;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.75); cursor: pointer; transition: all 0.12s;
}
.po-option--on { border-color: #4f46e5; background: rgba(99, 102, 241, 0.07); color: #4f46e5; }
.po-option-title { font-size: 13.5px; font-weight: 600; }
.po-option-hint { font-size: 11.5px; opacity: 0.7; }

.po-field { margin-top: 14px; }
.po-label {
  display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.po-input {
  width: 100%; height: 40px; padding: 0 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 14px; outline: none; color: rgba(var(--v-theme-on-surface), 0.85);
}
.po-input:focus { border-color: #4f46e5; }

.po-actions { display: flex; gap: 10px; margin-top: 18px; }
.po-cancel, .po-confirm {
  flex: 1; padding: 11px 16px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.po-cancel {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500;
}
.po-confirm { background: #4f46e5; color: #fff; }
.po-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
