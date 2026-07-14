<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useIsMobile } from '@/composables/useIsMobile'
import { formatCurrency } from '@/utils/formatters'

// Reusable removal dialog. Two scopes:
//  • scope='stake'  — remove the investor from ONE cashbox (identity kept).
//  • scope='person' — remove the investor across ALL their cashboxes.
// Two modes (radio): exclude (keep history, archive) / full (wipe everything).
// The `unpaid` sub-choice appears only for exclude WHEN there is outstanding
// debt (balanceOwed > 0): keep the debt, or write it off in the partner's favour.
const props = defineProps<{
  modelValue: boolean
  scope: 'stake' | 'person'
  name: string
  cashBoxCount?: number
  balanceOwed: number
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [{ mode: 'full' | 'exclude'; unpaid?: 'keep' | 'writeoff' }]
}>()

const { isMobile } = useIsMobile()

const mode = ref<'full' | 'exclude'>('exclude')
const unpaid = ref<'keep' | 'writeoff'>('keep')

// Reset the choices every time the dialog opens so a previous selection doesn't
// leak into the next investor.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      mode.value = 'exclude'
      unpaid.value = 'keep'
    }
  },
)

const isPerson = computed(() => props.scope === 'person')
const hasDebt = computed(() => props.balanceOwed > 0)
// The unpaid choice is meaningful only for exclude + existing debt.
const showUnpaid = computed(() => mode.value === 'exclude' && hasDebt.value)

const scopeWord = computed(() =>
  isPerson.value
    ? `во всех ${props.cashBoxCount ?? ''} ${pluralCashBoxes(props.cashBoxCount ?? 0)}`.trim()
    : 'из этой кассы',
)

function pluralCashBoxes(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'кассе'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'кассах'
  return 'кассах'
}

const confirmLabel = computed(() =>
  mode.value === 'full' ? 'Удалить полностью' : 'Исключить',
)

const title = computed(() =>
  isPerson.value ? 'Удаление инвестора' : 'Удаление из кассы',
)

function close() {
  emit('update:modelValue', false)
}

function confirm() {
  emit('confirm', {
    mode: mode.value,
    // Only forward `unpaid` when it actually applies.
    unpaid: showUnpaid.value ? unpaid.value : undefined,
  })
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    persistent
    :fullscreen="isMobile"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card rounded="lg">
      <div class="rd-header">
        <span class="rd-title">{{ title }}</span>
        <button class="rd-close" :disabled="loading" @click="close">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="pa-5">
        <div class="rd-lead mb-4">
          <template v-if="isPerson">
            Инвестор <strong>{{ name }}</strong> будет удалён {{ scopeWord }}. Выберите, что
            сделать с историей.
          </template>
          <template v-else>
            Инвестор <strong>{{ name }}</strong> будет удалён {{ scopeWord }}. Личность
            сохранится и остаётся в других кассах. Выберите, что сделать с историей.
          </template>
        </div>

        <!-- Mode selection -->
        <div class="rd-options mb-4">
          <button
            type="button"
            class="rd-option"
            :class="{ 'rd-option--active': mode === 'exclude' }"
            @click="mode = 'exclude'"
          >
            <span class="rd-radio" :class="{ 'rd-radio--on': mode === 'exclude' }" />
            <span class="rd-option-body">
              <span class="rd-option-name">Исключить, сохранить историю</span>
              <span class="rd-option-desc">
                Инвестор перестанет участвовать в новых сделках, капитал вернётся из пула.
                Все начисления и выплаты останутся в кассе, стейк уйдёт в архив.
              </span>
            </span>
          </button>

          <button
            type="button"
            class="rd-option rd-option--danger"
            :class="{ 'rd-option--active': mode === 'full' }"
            @click="mode = 'full'"
          >
            <span class="rd-radio rd-radio--danger" :class="{ 'rd-radio--on': mode === 'full' }" />
            <span class="rd-option-body">
              <span class="rd-option-name">Удалить полностью со всей историей</span>
              <span class="rd-option-desc">
                Все записи инвестора будут стёрты — капитал, начисления и выплаты дивидендов.
                Баланс кассы пересчитается. Необратимо.
              </span>
            </span>
          </button>
        </div>

        <!-- Unpaid debt handling (exclude + debt only) -->
        <div v-if="showUnpaid" class="rd-sub mb-4">
          <div class="rd-sub-title">Долг «к выплате» {{ formatCurrency(balanceOwed) }}</div>
          <button
            type="button"
            class="rd-option rd-option--sm"
            :class="{ 'rd-option--active': unpaid === 'keep' }"
            @click="unpaid = 'keep'"
          >
            <span class="rd-radio" :class="{ 'rd-radio--on': unpaid === 'keep' }" />
            <span class="rd-option-body">
              <span class="rd-option-name">Оставить долг {{ formatCurrency(balanceOwed) }}</span>
              <span class="rd-option-desc">Партнёр ещё должен выплатить эту сумму инвестору.</span>
            </span>
          </button>
          <button
            type="button"
            class="rd-option rd-option--sm"
            :class="{ 'rd-option--active': unpaid === 'writeoff' }"
            @click="unpaid = 'writeoff'"
          >
            <span class="rd-radio" :class="{ 'rd-radio--on': unpaid === 'writeoff' }" />
            <span class="rd-option-body">
              <span class="rd-option-name">Списать {{ formatCurrency(balanceOwed) }} в пользу партнёра</span>
              <span class="rd-option-desc">Долг обнулится, выплачивать инвестору не нужно.</span>
            </span>
          </button>
        </div>

        <!-- Dynamic warning block -->
        <div class="rd-warning" :class="{ 'rd-warning--danger': mode === 'full' }">
          <v-icon :icon="mode === 'full' ? 'mdi-alert-octagon-outline' : 'mdi-alert-outline'" size="18" />
          <div class="rd-warning-body">
            <template v-if="mode === 'full'">
              <strong>Необратимое удаление.</strong>
              Капитал вернётся из пула, вся история {{ isPerson ? scopeWord : 'кассы' }} будет стёрта
              (капитал, начисления, выплаты), баланс кассы пересчитается.
            </template>
            <template v-else>
              Капитал вернётся из пула, история сохранится{{ isPerson ? ` (${scopeWord})` : '' }},
              стейк уйдёт в архив и пропадёт из активных списков.
              <template v-if="showUnpaid && unpaid === 'writeoff'">
                Долг {{ formatCurrency(balanceOwed) }} будет списан в пользу партнёра.
              </template>
              <template v-else-if="showUnpaid">
                Долг {{ formatCurrency(balanceOwed) }} останется к выплате.
              </template>
            </template>
          </div>
        </div>
      </div>

      <div class="rd-actions">
        <button class="rd-btn rd-btn--ghost" :disabled="loading" @click="close">Отмена</button>
        <button class="rd-btn rd-btn--danger" :disabled="loading" @click="confirm">
          <v-progress-circular v-if="loading" indeterminate size="14" width="2" color="white" class="mr-2" />
          {{ confirmLabel }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.rd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.rd-title { font-size: 17px; font-weight: 700; }
.rd-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.rd-close:disabled { opacity: 0.5; cursor: default; }

.rd-lead { font-size: 14px; line-height: 1.5; color: rgba(var(--v-theme-on-surface), 0.75); }

.rd-options { display: flex; flex-direction: column; gap: 10px; }
.rd-option {
  display: flex; align-items: flex-start; gap: 12px; text-align: left;
  padding: 14px 16px; border-radius: 12px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); transition: all 0.15s;
}
.rd-option--sm { padding: 12px 14px; }
.rd-option:hover { border-color: rgba(var(--v-theme-on-surface), 0.24); }
.rd-option--active { border-color: #6366f1; background: rgba(99, 102, 241, 0.06); }
.rd-option--danger.rd-option--active { border-color: #ef4444; background: rgba(239, 68, 68, 0.06); }

.rd-radio {
  width: 18px; height: 18px; min-width: 18px; margin-top: 1px;
  border-radius: 50%; border: 2px solid rgba(var(--v-theme-on-surface), 0.3);
  position: relative; transition: all 0.15s;
}
.rd-radio--on { border-color: #6366f1; }
.rd-radio--on::after {
  content: ''; position: absolute; inset: 3px; border-radius: 50%; background: #6366f1;
}
.rd-radio--danger.rd-radio--on { border-color: #ef4444; }
.rd-radio--danger.rd-radio--on::after { background: #ef4444; }

.rd-option-body { display: flex; flex-direction: column; gap: 4px; }
.rd-option-name { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.95); }
.rd-option-desc { font-size: 12px; line-height: 1.45; color: rgba(var(--v-theme-on-surface), 0.55); }

.rd-sub {
  padding: 12px 14px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  display: flex; flex-direction: column; gap: 8px;
}
.rd-sub-title { font-size: 12px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.7); }

.rd-warning {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.28);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.rd-warning :deep(.v-icon) { color: #f59e0b; flex-shrink: 0; margin-top: 1px; }
.rd-warning--danger {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
}
.rd-warning--danger :deep(.v-icon) { color: #ef4444; }
.rd-warning-body { flex: 1; }

.rd-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 14px 20px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.rd-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent; transition: all 0.15s;
}
.rd-btn:disabled { opacity: 0.6; cursor: default; }
.rd-btn--ghost {
  background: transparent; border-color: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.rd-btn--ghost:not(:disabled):hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.rd-btn--danger { background: #ef4444; color: #fff; }
.rd-btn--danger:not(:disabled):hover { background: #dc2626; }
</style>
