<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { vMaska } from 'maska/vue'
import { useCoInvestors } from '@/composables/useCoInvestors'
import { useToast } from '@/composables/useToast'
import { useIsMobile } from '@/composables/useIsMobile'
import { useCashBoxesStore, type CashBoxSummary } from '@/stores/cashboxes'
import { PHONE_MASK, CURRENCY_MASK, parseMasked, formatCurrency } from '@/utils/formatters'
import type { PayoutSchedule } from '@/types'

// Full PERSON editor. Loads the person's whole profile by id, then lets the
// partner edit the identity (name / phone / payout schedule) AND every cashbox
// stake (capital / share mode / rate), plus attach new cashboxes — mirroring
// the multi-block CREATE dialog. Reused by:
//  • list  (index.vue)      → ⋮ → «Редактировать»
//  • profile (person/[id])  → «Редактировать»
// Deletion is NOT handled here — that lives in dedicated dialogs.
const props = defineProps<{
  modelValue: boolean
  personId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  saved: []
}>()

const { fetchPerson, updatePerson, updateStake, addStake } = useCoInvestors()
const cashboxesStore = useCashBoxesStore()
const toast = useToast()
const { isMobile } = useIsMobile()

const PERCENT_PRESETS = [10, 20, 25, 30, 40, 50]
const FEE_PRESETS = [0, 20, 30, 50]
const COST_FEE_PRESETS = [5, 7.5, 10, 12.5]

// Share-mode options for the dropdown (cost-fee first, as everywhere).
const SHARE_TYPE_OPTIONS = [
  { value: 'COST_FEE' as const, label: 'Комиссия от закупки', icon: 'mdi-tag-outline' },
  { value: 'FIXED' as const, label: 'Фиксированный %', icon: 'mdi-percent-outline' },
  { value: 'WEIGHT' as const, label: 'По вкладу', icon: 'mdi-scale-balance' },
]

const PAYOUT_OPTIONS = [
  { value: 'MONTHLY' as const, label: 'Ежемесячно', icon: 'mdi-calendar-month' },
  { value: 'QUARTERLY' as const, label: 'Раз в квартал', icon: 'mdi-calendar-multiple' },
  { value: 'SEMIANNUAL' as const, label: 'Раз в полгода', icon: 'mdi-calendar-range' },
  { value: 'ANNUAL' as const, label: 'Раз в год', icon: 'mdi-calendar-clock' },
]

type ShareType = 'FIXED' | 'WEIGHT' | 'COST_FEE'

// One editable cashbox block. Existing stakes carry a `stakeId` + `baseCapital`
// (the historical baseline used to compute the delta on save). New blocks have
// `stakeId: null` and are created via addStake.
type StakeBlock = {
  stakeId: string | null
  cashBoxId: string
  cashBoxName: string
  cashBoxColor: string
  cashBoxIcon?: string
  capital: number
  baseCapital: number
  shareType: ShareType
  profitPercent: number
  managementFeePct: number
  costFeeDefaultRatePct: number | null
}

const loading = ref(false)
const saving = ref(false)

// ── Person section ──
const pName = ref('')
const pPhone = ref('')
const pSchedule = ref<PayoutSchedule>('MONTHLY')
const pNextPayout = ref('') // YYYY-MM-DD or ''
// Приватность: показывать ли долю партнёра инвестору в публичном кабинете.
const pShowPartnerShare = ref(false)

// ── Cashbox blocks (existing + newly added) ──
const blocks = ref<StakeBlock[]>([])
// Cashboxes the person already participates in (existing blocks) — excluded
// from the «add cashbox» picker.
const usedCashBoxIds = ref<Set<string>>(new Set())

function shareTypeOf(s: { costFeeMode?: boolean; profitPercent: number | null }): ShareType {
  if (s.costFeeMode) return 'COST_FEE'
  if (s.profitPercent != null && s.profitPercent > 0) return 'FIXED'
  return 'WEIGHT'
}
function shareTypeOption(v: ShareType) {
  return SHARE_TYPE_OPTIONS.find((o) => o.value === v) ?? SHARE_TYPE_OPTIONS[0]
}

// Load the full profile and build the editable blocks whenever the dialog opens.
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    loading.value = true
    try {
      const [detail] = await Promise.all([
        fetchPerson(props.personId),
        cashboxesStore.items.length === 0 ? cashboxesStore.fetchAll() : Promise.resolve(),
      ])
      pName.value = detail.person.name
      pPhone.value = detail.person.phone || ''
      pSchedule.value = detail.person.payoutSchedule || 'MONTHLY'
      pNextPayout.value = detail.person.nextPayoutDate
        ? new Date(detail.person.nextPayoutDate).toISOString().slice(0, 10)
        : ''
      pShowPartnerShare.value = !!detail.person.showPartnerShareToInvestor

      blocks.value = detail.stakes.map((s) => ({
        stakeId: s.id,
        cashBoxId: s.cashBox.id,
        cashBoxName: s.cashBox.name,
        cashBoxColor: s.cashBox.color,
        cashBoxIcon: s.cashBox.icon,
        capital: s.capital,
        baseCapital: s.capital,
        shareType: shareTypeOf(s),
        profitPercent: s.profitPercent != null && s.profitPercent > 0 ? s.profitPercent : 30,
        managementFeePct: s.managementFeePct ?? 0,
        costFeeDefaultRatePct: s.costFeeDefaultRatePct ?? null,
      }))
      usedCashBoxIds.value = new Set(detail.stakes.map((s) => s.cashBox.id))
    } catch (e: any) {
      toast.error(e.message || 'Не удалось загрузить инвестора')
      close()
    } finally {
      loading.value = false
    }
  },
  // `immediate` so it also fires when the dialog is mounted ALREADY open — the
  // list mounts it (`v-if="editPerson"`) in the same tick it sets modelValue,
  // so there's no false→true transition to catch otherwise (fields stayed empty).
  { immediate: true },
)

// Cashboxes the person can still be added to (not archived, not already used).
const availableCashBoxes = computed<CashBoxSummary[]>(() =>
  cashboxesStore.items.filter((b) => !b.archivedAt && !usedCashBoxIds.value.has(b.id)),
)

function isCashBoxSelected(id: string) {
  return blocks.value.some((b) => b.cashBoxId === id)
}

// Toggle a NEW cashbox block on/off. Existing stakes stay in `usedCashBoxIds`
// and are never offered here, so this only ever adds/removes fresh blocks.
function toggleCashBox(b: CashBoxSummary) {
  const idx = blocks.value.findIndex((x) => x.cashBoxId === b.id && x.stakeId === null)
  if (idx >= 0) {
    blocks.value.splice(idx, 1)
  } else {
    blocks.value.push({
      stakeId: null,
      cashBoxId: b.id,
      cashBoxName: b.name,
      cashBoxColor: b.color,
      cashBoxIcon: b.icon,
      capital: 0,
      baseCapital: 0,
      shareType: 'WEIGHT',
      profitPercent: 30,
      managementFeePct: 0,
      costFeeDefaultRatePct: null,
    })
  }
}

function removeNewBlock(block: StakeBlock) {
  const idx = blocks.value.indexOf(block)
  if (idx >= 0) blocks.value.splice(idx, 1)
}

function close() {
  emit('update:modelValue', false)
}

function validate(): boolean {
  if (!pName.value.trim()) {
    toast.error('Укажите имя')
    return false
  }
  for (const b of blocks.value) {
    if (b.capital <= 0) {
      toast.error(`Укажите капитал для кассы «${b.cashBoxName}»`)
      return false
    }
    if (b.shareType === 'FIXED' && (b.profitPercent <= 0 || b.profitPercent >= 100)) {
      toast.error('Процент от 1 до 99')
      return false
    }
    if (
      b.shareType === 'COST_FEE' &&
      b.costFeeDefaultRatePct != null &&
      (b.costFeeDefaultRatePct < 0 || b.costFeeDefaultRatePct > 100)
    ) {
      toast.error('Ставка от 0 до 100')
      return false
    }
  }
  return true
}

// Common share-mode payload shared by updateStake / addStake.
function sharePayload(b: StakeBlock) {
  return {
    profitPercent: b.shareType === 'FIXED' ? Number(b.profitPercent) : null,
    managementFeePct: b.shareType === 'WEIGHT' ? Number(b.managementFeePct || 0) : 0,
    costFeeMode: b.shareType === 'COST_FEE',
    costFeeDefaultRatePct:
      b.shareType === 'COST_FEE' && b.costFeeDefaultRatePct != null
        ? Number(b.costFeeDefaultRatePct)
        : null,
  }
}

async function save() {
  if (!validate()) return

  saving.value = true
  try {
    const tasks: Promise<unknown>[] = [
      updatePerson(props.personId, {
        name: pName.value.trim(),
        phone: pPhone.value.trim() || undefined,
        payoutSchedule: pSchedule.value,
        nextPayoutDate: pNextPayout.value ? new Date(pNextPayout.value).toISOString() : null,
        showPartnerShareToInvestor: pShowPartnerShare.value,
      }),
    ]

    for (const b of blocks.value) {
      if (b.stakeId) {
        // Existing stake. Backend expects `capital` = the NEW ABSOLUTE value and
        // computes the journal delta itself (new − current baseline). Send it
        // only when actually changed, to avoid a no-op capital adjustment.
        const capitalChanged = Number(b.capital) !== Number(b.baseCapital)
        tasks.push(
          updateStake(b.stakeId, {
            ...(capitalChanged ? { capital: Number(b.capital) } : {}),
            ...sharePayload(b),
          }),
        )
      } else {
        // New stake for this person in a not-yet-used cashbox.
        tasks.push(
          addStake(props.personId, {
            cashBoxId: b.cashBoxId,
            capital: Number(b.capital),
            payoutSchedule: pSchedule.value,
            ...sharePayload(b),
          }),
        )
      }
    }

    await Promise.all(tasks)
    toast.success('Изменения сохранены')
    emit('saved')
    close()
  } catch (e: any) {
    toast.error(e.message || 'Не удалось сохранить')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    persistent
    :fullscreen="isMobile"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card rounded="lg" class="ced-card">
      <div class="ced-header">
        <span class="ced-title">Редактировать</span>
        <button class="ced-close" :disabled="saving" @click="close">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div v-if="loading" class="d-flex justify-center align-center" style="min-height: 240px;">
        <v-progress-circular indeterminate color="primary" size="36" />
      </div>

      <div v-else class="ced-scroll">
        <!-- ── Инвестор ── -->
        <div class="ced-section-title mt-5">Инвестор</div>

        <div class="ced-field mb-4">
          <label class="ced-label">Имя <span style="color: #ef4444;">*</span></label>
          <input v-model="pName" type="text" class="ced-input" placeholder="Фамилия Имя" />
        </div>

        <div class="ced-field mb-4">
          <label class="ced-label">Телефон</label>
          <input
            v-model="pPhone"
            v-maska="PHONE_MASK"
            type="tel"
            class="ced-input"
            placeholder="+7 (___) ___-__-__"
          />
        </div>

        <div class="ced-field mb-2">
          <label class="ced-label">Периодичность выплат</label>
          <div class="ced-payout-grid">
            <button
              v-for="opt in PAYOUT_OPTIONS"
              :key="opt.value"
              type="button"
              class="ced-payout-option"
              :class="{ 'ced-payout-option--active': pSchedule === opt.value }"
              @click="pSchedule = opt.value"
            >
              <v-icon :icon="opt.icon" size="16" />
              <span>{{ opt.label }}</span>
            </button>
          </div>
        </div>

        <div class="ced-field mt-4">
          <label class="ced-label">Следующая выплата</label>
          <input v-model="pNextPayout" type="date" class="ced-input" />
        </div>

        <!-- Приватность: показывать ли долю партнёра инвестору в кабинете по ссылке -->
        <div class="ced-share-toggle mt-4" @click="pShowPartnerShare = !pShowPartnerShare">
          <div class="ced-share-toggle-text">
            <div class="ced-share-toggle-title">Показывать мою долю инвестору</div>
            <div class="ced-share-toggle-sub">В кабинете по ссылке инвестор увидит, сколько с каждой сделки получаете вы</div>
          </div>
          <v-switch
            v-model="pShowPartnerShare"
            color="primary"
            hide-details
            density="compact"
            inset
            @click.stop
          />
        </div>

        <!-- ── Кассы ── -->
        <div class="ced-divider" />
        <div class="ced-section-title">Кассы</div>

        <!-- Add-cashbox picker — pinned above the per-cashbox blocks so it
             stays reachable while the blocks scroll below it. -->
        <div v-if="availableCashBoxes.length" class="ced-field ced-cb-sticky">
          <label class="ced-label">Добавить кассу</label>
          <div class="ced-cb-multi">
            <button
              v-for="b in availableCashBoxes"
              :key="b.id"
              type="button"
              class="ced-cb-tag"
              :class="{ 'ced-cb-tag--active': isCashBoxSelected(b.id) }"
              :style="isCashBoxSelected(b.id) ? { borderColor: b.color, color: b.color, background: b.color + '14' } : {}"
              @click="toggleCashBox(b)"
            >
              <v-icon :icon="isCashBoxSelected(b.id) ? 'mdi-check-circle' : b.icon" size="15" :style="{ color: b.color }" />
              {{ b.name }}
            </button>
          </div>
          <div class="ced-field-hint">Параметры (капитал, доля) задаются в блоке кассы ниже.</div>
        </div>

        <div v-if="blocks.length === 0" class="ced-empty">
          Инвестор пока не участвует ни в одной кассе — добавьте кассу выше.
        </div>

        <!-- One block per stake (existing + newly added) -->
        <div v-for="block in blocks" :key="block.stakeId ?? 'new-' + block.cashBoxId" class="ced-cb-block mb-4">
          <div class="ced-cb-block-head">
            <span class="ced-cb-block-icon" :style="{ color: block.cashBoxColor }">
              <v-icon :icon="block.cashBoxIcon || 'mdi-wallet-outline'" size="16" />
            </span>
            <span class="ced-cb-block-name">{{ block.cashBoxName }}</span>
            <span v-if="!block.stakeId" class="ced-cb-block-badge">Новая</span>
            <button
              v-if="!block.stakeId"
              type="button"
              class="ced-cb-block-remove"
              title="Убрать кассу"
              @click="removeNewBlock(block)"
            >
              <v-icon icon="mdi-close" size="16" />
            </button>
          </div>

          <!-- Capital -->
          <div class="ced-field mb-3">
            <label class="ced-label">Капитал <span style="color: #ef4444;">*</span></label>
            <div class="ced-input-wrap">
              <input
                :value="block.capital || ''"
                v-maska="CURRENCY_MASK"
                @maska="(e: any) => block.capital = parseMasked(e)"
                type="text"
                inputmode="numeric"
                class="ced-input"
                placeholder="0"
              />
              <span class="ced-suffix">₽</span>
            </div>
            <div v-if="block.stakeId && block.capital !== block.baseCapital" class="ced-field-hint">
              Текущее значение: {{ formatCurrency(block.baseCapital) }}
            </div>
          </div>

          <!-- Share mode (cost-fee first, as everywhere) -->
          <div class="ced-field mb-3">
            <label class="ced-label">Способ деления прибыли</label>
            <v-menu :close-on-content-click="true" offset="4">
              <template #activator="{ props: menuProps }">
                <button type="button" class="ced-mode-picker" v-bind="menuProps">
                  <v-icon :icon="shareTypeOption(block.shareType).icon" size="18" />
                  <span class="ced-mode-picker-name">{{ shareTypeOption(block.shareType).label }}</span>
                  <v-icon icon="mdi-chevron-down" size="18" />
                </button>
              </template>
              <div class="ced-mode-menu">
                <button
                  v-for="opt in SHARE_TYPE_OPTIONS"
                  :key="opt.value"
                  type="button"
                  class="ced-mode-menu-item"
                  :class="{ 'ced-mode-menu-item--active': block.shareType === opt.value }"
                  @click="block.shareType = opt.value"
                >
                  <v-icon :icon="opt.icon" size="18" />
                  <span class="ced-mode-picker-name">{{ opt.label }}</span>
                  <v-icon v-if="block.shareType === opt.value" icon="mdi-check" size="16" />
                </button>
              </div>
            </v-menu>
          </div>

          <!-- Cost-fee rate -->
          <div v-if="block.shareType === 'COST_FEE'" class="ced-field mb-1">
            <label class="ced-label">Ставка по умолчанию, % от закупки</label>
            <div class="ced-presets mb-2">
              <button
                v-for="p in COST_FEE_PRESETS"
                :key="p"
                class="ced-preset"
                :class="{ 'ced-preset--active': block.costFeeDefaultRatePct === p }"
                @click="block.costFeeDefaultRatePct = p"
              >{{ p }}%</button>
            </div>
            <div class="ced-input-wrap">
              <input v-model.number="block.costFeeDefaultRatePct" type="number" class="ced-input" placeholder="напр. 5" min="0" max="100" />
              <span class="ced-suffix">%</span>
            </div>
          </div>

          <!-- Fixed percent -->
          <div v-if="block.shareType === 'FIXED'" class="ced-field mb-1">
            <label class="ced-label">Процент от прибыли <span style="color: #ef4444;">*</span></label>
            <div class="ced-presets mb-2">
              <button
                v-for="p in PERCENT_PRESETS"
                :key="p"
                class="ced-preset"
                :class="{ 'ced-preset--active': block.profitPercent === p }"
                @click="block.profitPercent = p"
              >{{ p }}%</button>
            </div>
            <div class="ced-input-wrap">
              <input v-model.number="block.profitPercent" type="number" class="ced-input" placeholder="30" min="1" max="99" />
              <span class="ced-suffix">%</span>
            </div>
          </div>

          <!-- Partner commission -->
          <div v-if="block.shareType === 'WEIGHT'" class="ced-field mb-1">
            <label class="ced-label">Комиссия партнёра</label>
            <div class="ced-presets mb-2">
              <button
                v-for="p in FEE_PRESETS"
                :key="p"
                class="ced-preset"
                :class="{ 'ced-preset--active': block.managementFeePct === p }"
                @click="block.managementFeePct = p"
              >{{ p }}%</button>
            </div>
            <div class="ced-input-wrap">
              <input v-model.number="block.managementFeePct" type="number" class="ced-input" placeholder="0" min="0" max="100" />
              <span class="ced-suffix">%</span>
            </div>
          </div>
        </div>

      </div>

      <div class="ced-actions">
        <button class="ced-btn ced-btn--ghost" :disabled="saving" @click="close">Отмена</button>
        <button class="ced-btn ced-btn--primary" :disabled="saving || loading" @click="save">
          <v-progress-circular v-if="saving" indeterminate size="16" width="2" color="white" class="mr-2" />
          Сохранить
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.ced-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.ced-title { font-size: 17px; font-weight: 700; }
.ced-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.ced-close:disabled { opacity: 0.5; cursor: default; }

.ced-section-title {
  font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
  color: rgba(var(--v-theme-on-surface), 0.5); margin-bottom: 12px;
}
.ced-divider { height: 1px; background: rgba(var(--v-theme-on-surface), 0.08); margin: 20px 0; }
.ced-empty {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5);
  padding: 12px 0 8px;
}

.ced-label {
  display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.ced-field-hint { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 6px; }
.ced-share-toggle {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  cursor: pointer;
}
.ced-share-toggle:hover { background: rgba(var(--v-theme-on-surface), 0.02); }
.ced-share-toggle-text { flex: 1; min-width: 0; }
.ced-share-toggle-title { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }
.ced-share-toggle-sub { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px; }
.ced-input-wrap { position: relative; display: flex; align-items: center; }
.ced-input {
  width: 100%; padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface)); font-size: 14px;
  color: rgba(var(--v-theme-on-surface), 0.95); outline: none;
  box-sizing: border-box; font-family: inherit;
}
.ced-input:focus { border-color: #6366f1; }
.ced-input-wrap .ced-input { padding-right: 36px; }
.ced-suffix {
  position: absolute; right: 12px; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.5); pointer-events: none;
}

.ced-payout-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.ced-payout-option {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 12px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.ced-payout-option:hover { border-color: #6366f1; color: #6366f1; }
.ced-payout-option--active { border-color: #6366f1; background: rgba(99, 102, 241, 0.08); color: #6366f1; font-weight: 600; }

/* Per-cashbox block */
.ced-cb-block {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px; padding: 14px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.ced-cb-block-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.ced-cb-block-icon { display: inline-flex; }
.ced-cb-block-name { flex: 1; font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.ced-cb-block-badge {
  font-size: 11px; font-weight: 700; color: #6366f1;
  padding: 2px 8px; border-radius: 8px; background: rgba(99, 102, 241, 0.1);
}
.ced-cb-block-remove {
  width: 28px; height: 28px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.ced-cb-block-remove:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; }

.ced-mode-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
@media (max-width: 500px) { .ced-mode-grid { grid-template-columns: 1fr; } }
.ced-mode-card {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 8px; border-radius: 10px; cursor: pointer; text-align: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.7);
  transition: all 0.15s;
}
.ced-mode-card--active { border-color: #6366f1; background: rgba(99, 102, 241, 0.08); color: #6366f1; }
.ced-mode-name { font-size: 12px; font-weight: 600; }

/* Mode dropdown (v-menu picker, matches other dialog fields) */
.ced-mode-picker {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface)); font-size: 14px; font-family: inherit;
  color: rgba(var(--v-theme-on-surface), 0.95); text-align: left;
}
.ced-mode-picker:hover { border-color: rgba(99, 102, 241, 0.4); }
.ced-mode-picker-name { flex: 1; }
.ced-mode-menu {
  padding: 6px; min-width: 240px; border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
}
.ced-mode-menu-item {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 9px 10px; border-radius: 8px; cursor: pointer; border: none;
  background: transparent; font-size: 14px; font-family: inherit;
  color: rgba(var(--v-theme-on-surface), 0.9); text-align: left;
}
.ced-mode-menu-item + .ced-mode-menu-item { margin-top: 6px; }
.ced-mode-menu-item:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.ced-mode-menu-item--active { background: rgba(99, 102, 241, 0.1); color: #6366f1; }

.ced-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.ced-preset {
  padding: 6px 12px; border-radius: 8px; font-size: 13px; cursor: pointer;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.7);
}
.ced-preset--active { border-color: #6366f1; background: rgba(99, 102, 241, 0.1); color: #6366f1; }

/* Add-cashbox multi picker */
.ced-cb-multi { display: flex; flex-wrap: wrap; gap: 6px; }
.ced-cb-tag {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 999px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.ced-cb-tag:hover { border-color: rgba(99, 102, 241, 0.4); }
.ced-cb-tag--active { font-weight: 700; }

.ced-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 14px 20px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

/* Scrollable body with a pinned «Добавить кассу» picker: header + footer stay
   put, the picker sticks above the per-cashbox blocks while they scroll. */
.ced-card { display: flex; flex-direction: column; max-height: 90vh; }
.ced-scroll {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  padding: 0 20px 20px;
}
.ced-cb-sticky {
  position: sticky; top: 0; z-index: 3;
  background: rgb(var(--v-theme-surface));
  margin: 0 -20px 16px; padding: 12px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
@media (max-width: 599px) {
  .ced-card { max-height: 100%; height: 100%; }
}
.ced-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent; transition: all 0.15s; font-family: inherit;
}
.ced-btn:disabled { opacity: 0.6; cursor: default; }
.ced-btn--ghost {
  background: transparent; border-color: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.ced-btn--ghost:not(:disabled):hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.ced-btn--primary { background: #6366f1; color: #fff; }
.ced-btn--primary:not(:disabled):hover { background: #4f46e5; }
</style>
