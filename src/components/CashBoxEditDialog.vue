<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import { useSections } from '@/composables/useSections'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useAccountingStore } from '@/stores/accounting'
import type { CashBoxSummary } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useIsMobile } from '@/composables/useIsMobile'

const sections = useSections()
const props = defineProps<{
  modelValue: boolean
  /** Editing? Pass the existing cashbox. Omit to create a new one. */
  cashbox?: CashBoxSummary | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved', box: CashBoxSummary): void
}>()

const store = useCashBoxesStore()
const accounting = useAccountingStore()
const toast = useToast()
const { isDark } = useIsDark()
const { isMobile } = useIsMobile()

const isEdit = computed(() => !!props.cashbox)

const name = ref('')
const color = ref('#3b82f6')
const icon = ref('mdi-wallet-outline')
const initialCapital = ref<number | null>(null)

/**
 * Где будут лежать деньги новой кассы.
 *
 * Касса отвечает «сколько денег», счета — «где они». Разложить капитал сразу
 * дешевле, чем потом искать строку «не разнесено»: партнёр в этот момент как
 * раз держит в голове, что у него в сейфе и что на карте.
 *
 * Заводится только при создании: у существующей кассы счета уже есть, и
 * дублировать их форму здесь незачем.
 */
const layout = ref<Array<{ name: string; type: 'CASH' | 'BANK_CARD'; amount: number | null }>>([])

const laidOut = computed(() =>
  layout.value.reduce((sum, row) => sum + Math.max(0, Math.round(row.amount ?? 0)), 0),
)
const capital = computed(() => Math.max(0, Math.round(initialCapital.value ?? 0)))
/** Остаток капитала, которому не назначили место. */
const layoutRest = computed(() => capital.value - laidOut.value)

function addRow() {
  layout.value.push({
    name: layout.value.length === 0 ? 'Сейф' : '',
    type: layout.value.length === 0 ? 'CASH' : 'BANK_CARD',
    amount: layoutRest.value > 0 ? layoutRest.value : null,
  })
}

function removeRow(i: number) {
  layout.value.splice(i, 1)
}

/** Строку без названия или без суммы просто пропускаем — она ничего не значит. */
const layoutReady = computed(() =>
  layout.value.filter((r) => r.name.trim() && Math.round(r.amount ?? 0) > 0),
)
// Phase 4: does the partner's own capital join the by-capital profit split in
// this cashbox? true = partner invests alongside co-investors; false = partner
// only manages (their cut comes from each CI's commission).
const partnerParticipates = ref(true)
const submitting = ref(false)

// Palette of preset colors + icons — consistent with deal folders
const PRESET_COLORS = [
  '#3b82f6', // blue (default)
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#6366f1', // indigo
  '#84cc16', // lime
  '#737373', // neutral
]

const PRESET_ICONS = [
  'mdi-wallet-outline',
  'mdi-bank-outline',
  'mdi-cash-multiple',
  'mdi-piggy-bank-outline',
  'mdi-safe-square-outline',
  'mdi-account-cash-outline',
  'mdi-credit-card-outline',
  'mdi-handshake-outline',
  'mdi-home-outline',
  'mdi-account-group-outline',
]

// Initialize fields when opening
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    if (props.cashbox) {
      name.value = props.cashbox.name
      color.value = props.cashbox.color
      icon.value = props.cashbox.icon
      initialCapital.value = props.cashbox.initialCapital
      partnerParticipates.value = props.cashbox.partnerParticipatesByCapital ?? true
    } else {
      name.value = ''
      color.value = '#3b82f6'
      icon.value = 'mdi-wallet-outline'
      initialCapital.value = null
      partnerParticipates.value = true
    }
  },
)

async function handleSave() {
  const trimmed = name.value.trim()
  if (!trimmed) {
    toast.error('Введите название кассы')
    return
  }
  // Разложить больше, чем есть в кассе, нельзя: сумма счетов обязана
  // сходиться с её деньгами.
  if (!isEdit.value && layoutRest.value < 0) {
    toast.error('По счетам разложено больше, чем капитал кассы')
    return
  }

  submitting.value = true
  try {
    const payload = {
      name: trimmed,
      color: color.value,
      icon: icon.value,
      initialCapital: initialCapital.value ?? 0,
      partnerParticipatesByCapital: partnerParticipates.value,
    }
    const box = props.cashbox
      ? await store.update(props.cashbox.id, payload)
      : await store.create(payload)

    // Счета заводим после кассы: до её создания их не к чему привязать.
    // Ошибка здесь не отменяет кассу — она уже есть, а счета партнёр добавит
    // в «Бухгалтерии»; поэтому говорим об этом отдельно, а не общим отказом.
    if (!isEdit.value && layoutReady.value.length && box?.id) {
      try {
        for (const row of layoutReady.value) {
          await accounting.createAccount({
            name: row.name.trim(),
            type: row.type,
            cashBoxId: box.id,
            openingBalance: Math.round(row.amount ?? 0),
          })
        }
      } catch (e: any) {
        toast.error(e?.message || 'Касса создана, но счета завести не удалось')
      }
    }

    toast.success(isEdit.value ? 'Касса обновлена' : 'Касса создана')
    emit('saved', box)
    emit('update:modelValue', false)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось сохранить')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="(v) => emit('update:modelValue', v)"
    max-width="520"
    persistent
    :fullscreen="isMobile"
  >
    <v-card rounded="lg" :class="{ 'cb-dialog': true, dark: isDark }">
      <div class="cb-header">
        <div class="cb-header-icon" :style="{ background: color + '22', color }">
          <v-icon :icon="icon" size="22" />
        </div>
        <div class="cb-header-text">
          <div class="cb-title">{{ isEdit ? 'Изменить кассу' : 'Новая касса' }}</div>
          <div class="cb-subtitle">
            {{ isEdit ? 'Поменяйте название, цвет, иконку или капитал' : 'Создайте отдельный кошелёк' }}
          </div>
        </div>
        <button class="cb-close" @click="emit('update:modelValue', false)">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="cb-body">
        <!-- Live preview -->
        <div class="cb-preview" :style="{ borderColor: color + '40', background: color + '08' }">
          <div class="cb-preview-icon" :style="{ background: color + '20', color }">
            <v-icon :icon="icon" size="20" />
          </div>
          <div class="cb-preview-text">
            <div class="cb-preview-name">{{ name.trim() || 'Название кассы' }}</div>
            <div class="cb-preview-meta">
              Начальный капитал · {{ (initialCapital ?? 0).toLocaleString('ru-RU') }} ₽
            </div>
          </div>
        </div>

        <!-- Fields -->
        <div class="cb-field">
          <label class="cb-label">Название *</label>
          <v-text-field
            v-model="name"
            placeholder="Например: Семейная или Касса с Мусой"
            variant="outlined"
            density="compact"
            hide-details
            maxlength="50"
            :class="{ 'cb-input': true, dark: isDark }"
          />
        </div>

        <div class="cb-field">
          <label class="cb-label">Начальный капитал</label>
          <v-text-field
            :model-value="initialCapital === null ? '' : initialCapital.toLocaleString('ru-RU')"
            @update:model-value="(v: string) => initialCapital = parseInt(String(v).replace(/\D/g, ''), 10) || null"
            placeholder="0"
            variant="outlined"
            density="compact"
            hide-details
            suffix="₽"
            :class="{ 'cb-input': true, dark: isDark }"
          />
          <div class="cb-hint">
            Сумма с которой начинает работать касса. Если касса для конкретного партнёра — введите ту сумму, что он внёс.
          </div>
        </div>

        <!-- Где будут лежать эти деньги. Только при создании: у существующей
             кассы счета уже заведены в «Бухгалтерии». -->
        <div v-if="!isEdit && capital > 0" class="cb-field">
          <label class="cb-label">Где будут лежать эти деньги</label>

          <div v-for="(row, i) in layout" :key="i" class="cb-lay-row">
            <v-text-field
              v-model="row.name"
              placeholder="Сейф, Карта Сбер"
              variant="outlined"
              density="compact"
              hide-details
              :class="{ 'cb-input cb-lay-name': true, dark: isDark }"
            />
            <select v-model="row.type" class="cb-lay-type" :class="{ dark: isDark }">
              <option value="CASH">Наличные</option>
              <option value="BANK_CARD">Карта</option>
            </select>
            <v-text-field
              :model-value="row.amount === null ? '' : row.amount.toLocaleString('ru-RU')"
              @update:model-value="(v: string) => row.amount = parseInt(String(v).replace(/\D/g, ''), 10) || null"
              placeholder="0"
              variant="outlined"
              density="compact"
              hide-details
              suffix="₽"
              :class="{ 'cb-input cb-lay-sum': true, dark: isDark }"
            />
            <button class="cb-lay-del" title="Убрать" @click="removeRow(i)">
              <v-icon icon="mdi-close" size="16" />
            </button>
          </div>

          <div class="cb-lay-foot">
            <button class="cb-lay-add" @click="addRow">
              <v-icon icon="mdi-plus" size="15" />
              {{ layout.length ? 'Ещё счёт' : 'Указать счета' }}
            </button>
            <span v-if="layout.length" class="cb-lay-rest" :class="{ 'cb-lay-rest--over': layoutRest < 0 }">
              <template v-if="layoutRest > 0">
                Не разнесено: {{ layoutRest.toLocaleString('ru-RU') }} ₽
              </template>
              <template v-else-if="layoutRest < 0">
                Разложено больше капитала на {{ (-layoutRest).toLocaleString('ru-RU') }} ₽
              </template>
              <template v-else>Всё разложено</template>
            </span>
          </div>

          <div class="cb-hint">
            Необязательно: что не разложите, останется строкой «не разнесено» в «Бухгалтерии».
          </div>
        </div>

        <!-- Участие капитала в делёже прибыли. Без со-инвесторов делить не с
             кем: переключатель занимал половину диалога и пугал предупреждением
             про инвесторов, которых у партнёра нет. Поле продолжает уходить на
             сервер со значением по умолчанию — данные не меняются. -->
        <div v-if="sections.visible('coInvestors')" class="cb-field">
          <label class="cb-label">Ваше участие капиталом</label>
          <div class="cb-part-toggle">
            <button
              type="button"
              class="cb-part-opt"
              :class="{ active: partnerParticipates }"
              @click="partnerParticipates = true"
            >
              <v-icon icon="mdi-handshake" size="18" />
              <span class="cb-part-name">Вкладываю капитал</span>
              <span class="cb-part-sub">Мой капитал участвует в делёже по вкладу</span>
            </button>
            <button
              type="button"
              class="cb-part-opt"
              :class="{ active: !partnerParticipates }"
              @click="partnerParticipates = false"
            >
              <v-icon icon="mdi-briefcase-outline" size="18" />
              <span class="cb-part-name">Только управляю</span>
              <span class="cb-part-sub">Мой капитал не входит в делёж по вкладу</span>
            </button>
          </div>
          <div class="cb-hint">
            Переключатель влияет только на то, участвует ли <b>ваш</b> капитал в делёже «по вкладу».
            «Вкладываю капитал» — ваш начальный капитал считается ещё одним вкладом в пуле, и вы получаете
            по нему свою долю. «Только управляю» — ваш капитал в пул не входит, вся доля «по вкладу» у инвесторов.
            <br />
            Комиссия задаётся отдельно у каждого инвестора «по вкладу» и работает в <b>обоих</b> режимах —
            вы забираете её с доли инвестора независимо от этого переключателя.
          </div>
          <div v-if="partnerParticipates && !(initialCapital && initialCapital > 0)" class="cb-warn">
            <v-icon icon="mdi-alert-outline" size="14" />
            Начальный капитал кассы — 0. При «Вкладываю капитал» ваш вклад в делёж по вкладу тоже 0,
            поэтому вся прибыль «по вкладу» уйдёт инвесторам. Укажите ваш капитал выше или переключитесь на «Только управляю».
          </div>
        </div>

        <div class="cb-field">
          <label class="cb-label">Цвет</label>
          <div class="cb-palette">
            <button
              v-for="c in PRESET_COLORS"
              :key="c"
              class="cb-swatch"
              :class="{ active: color === c }"
              :style="{ background: c }"
              @click="color = c"
            >
              <v-icon v-if="color === c" icon="mdi-check" size="14" color="#fff" />
            </button>
          </div>
        </div>

        <div class="cb-field">
          <label class="cb-label">Иконка</label>
          <div class="cb-icons">
            <button
              v-for="ic in PRESET_ICONS"
              :key="ic"
              class="cb-icon-btn"
              :class="{ active: icon === ic }"
              :style="icon === ic ? { background: color + '20', color, borderColor: color + '60' } : {}"
              @click="icon = ic"
            >
              <v-icon :icon="ic" size="20" />
            </button>
          </div>
        </div>
      </div>

      <div class="cb-footer">
        <button class="cb-btn cb-btn--ghost" @click="emit('update:modelValue', false)" :disabled="submitting">
          Отмена
        </button>
        <button class="cb-btn cb-btn--primary" :disabled="submitting" @click="handleSave">
          <v-progress-circular v-if="submitting" indeterminate size="16" width="2" color="white" />
          <span v-else>{{ isEdit ? 'Сохранить' : 'Создать' }}</span>
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.cb-dialog { background: #fff; }
.cb-dialog.dark { background: rgb(var(--v-theme-surface-elevated)); }

/* Header */
.cb-header {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 20px;
  border-bottom: 1px solid #f0f0f0;
}
.cb-dialog.dark .cb-header { border-bottom-color: rgb(var(--v-theme-surface-elevated)); }

.cb-header-icon {
  width: 42px; height: 42px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.cb-header-text { flex: 1; min-width: 0; }
.cb-title { font-size: 16px; font-weight: 700; color: #111; }
.cb-subtitle { font-size: 12px; color: #737373; margin-top: 2px; }
.cb-dialog.dark .cb-title { color: rgba(var(--v-theme-on-surface), 0.92); }
.cb-dialog.dark .cb-subtitle { color: rgba(var(--v-theme-on-surface), 0.65); }

.cb-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: transparent; color: #737373; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.cb-close:hover { background: #f5f5f5; color: #111; }
.cb-dialog.dark .cb-close:hover { background: rgb(var(--v-theme-surface-elevated)); color: rgba(var(--v-theme-on-surface), 0.92); }

/* Body */
.cb-body {
  padding: 20px;
  display: flex; flex-direction: column; gap: 18px;
}

.cb-preview {
  display: flex; align-items: center; gap: 12px;
  padding: 14px; border-radius: 12px;
  border: 1px solid;
}
.cb-preview-icon {
  width: 38px; height: 38px; border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
}
.cb-preview-name { font-size: 14px; font-weight: 700; color: #111; }
.cb-preview-meta { font-size: 11px; color: #737373; margin-top: 2px; }
.cb-dialog.dark .cb-preview-name { color: rgba(var(--v-theme-on-surface), 0.92); }
.cb-dialog.dark .cb-preview-meta { color: rgba(var(--v-theme-on-surface), 0.65); }

/* Fields */
.cb-field { display: flex; flex-direction: column; gap: 6px; }
.cb-label {
  font-size: 12px; font-weight: 600; color: #525252;
  text-transform: uppercase; letter-spacing: 0.4px;
}
.cb-dialog.dark .cb-label { color: rgba(var(--v-theme-on-surface), 0.65); }

/* Раскладка капитала по счетам: строка «название · вид · сумма». */
.cb-lay-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.cb-lay-name { flex: 1 1 auto; min-width: 0; }
.cb-lay-sum { flex: 0 0 140px; }
.cb-lay-type {
  flex: 0 0 118px; height: 40px; padding: 0 10px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.18);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.85); font-size: 13px; cursor: pointer;
}
.cb-lay-del {
  flex: none; width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.4); cursor: pointer;
}
.cb-lay-del:hover { background: rgba(var(--v-theme-on-surface), 0.06); color: #dc2626; }
.cb-lay-foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
.cb-lay-add {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 11px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
  color: rgba(var(--v-theme-on-surface), 0.6); cursor: pointer;
}
.cb-lay-add:hover { border-color: #047857; color: #047857; }
.cb-lay-rest { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.cb-lay-rest--over { color: #b45309; font-weight: 600; }

.cb-hint { font-size: 11px; color: #737373; line-height: 1.4; }
.cb-dialog.dark .cb-hint { color: rgba(var(--v-theme-on-surface), 0.5); }

/* Partner participation toggle */
.cb-part-toggle { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cb-part-opt {
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
  padding: 10px 12px; border-radius: 10px;
  border: 1.5px solid #e5e5e5; background: transparent;
  cursor: pointer; text-align: left; transition: all 0.15s;
  color: #525252;
}
.cb-part-opt:hover { border-color: #a3a3a3; }
.cb-part-opt.active { border-color: #047857; background: rgba(4, 120, 87, 0.06); color: #047857; }
.cb-part-name { font-size: 13px; font-weight: 700; }
.cb-part-sub { font-size: 11px; color: #737373; line-height: 1.3; }
.cb-part-opt.active .cb-part-sub { color: #047857; }
.cb-dialog.dark .cb-part-opt { border-color: rgb(var(--v-theme-surface-elevated)); color: rgba(var(--v-theme-on-surface), 0.65); }
.cb-dialog.dark .cb-part-opt.active { border-color: #047857; color: #10b981; }
.cb-warn {
  display: flex; align-items: flex-start; gap: 6px;
  margin-top: 8px; padding: 8px 10px; border-radius: 8px;
  background: rgba(245, 158, 11, 0.1); color: #b45309;
  font-size: 11px; line-height: 1.4;
}
.cb-dialog.dark .cb-warn { color: #fbbf24; }

/* Color palette */
.cb-palette {
  display: flex; gap: 8px; flex-wrap: wrap;
}
.cb-swatch {
  width: 32px; height: 32px; border-radius: 10px;
  border: 2px solid transparent;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s;
}
.cb-swatch:hover { transform: scale(1.08); }
.cb-swatch.active {
  border-color: #fff;
  box-shadow: 0 0 0 2px currentColor;
}

/* Icon picker */
.cb-icons {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;
}
.cb-icon-btn {
  height: 44px; border-radius: 10px;
  border: 1.5px solid #e5e5e5;
  background: transparent; color: #525252;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.cb-icon-btn:hover { border-color: #a3a3a3; color: #111; }
.cb-dialog.dark .cb-icon-btn { border-color: rgb(var(--v-theme-surface-elevated)); color: rgba(var(--v-theme-on-surface), 0.65); }
.cb-dialog.dark .cb-icon-btn:hover { border-color: rgba(var(--v-theme-on-surface), 0.38); color: rgba(var(--v-theme-on-surface), 0.92); }

/* Footer */
.cb-footer {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 14px 20px;
  border-top: 1px solid #f0f0f0;
}
.cb-dialog.dark .cb-footer { border-top-color: rgb(var(--v-theme-surface-elevated)); }

.cb-btn {
  height: 40px; padding: 0 18px; border-radius: 10px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: none; transition: all 0.15s;
}
.cb-btn:disabled { opacity: 0.5; cursor: default; }
.cb-btn--ghost { background: transparent; color: #525252; }
.cb-btn--ghost:hover:not(:disabled) { background: #f5f5f5; }
.cb-dialog.dark .cb-btn--ghost { color: rgba(var(--v-theme-on-surface), 0.65); }
.cb-dialog.dark .cb-btn--ghost:hover:not(:disabled) { background: rgb(var(--v-theme-surface-elevated)); }

.cb-btn--primary { background: #047857; color: #fff; }
.cb-btn--primary:hover:not(:disabled) { background: #065f46; }
</style>
