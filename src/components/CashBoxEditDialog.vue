<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import { useSections } from '@/composables/useSections'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useAccountingStore } from '@/stores/accounting'
import type { CashBoxSummary } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useIsMobile } from '@/composables/useIsMobile'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'

const sections = useSections()
const props = defineProps<{
  modelValue: boolean
  /** Editing? Pass the existing cashbox. Omit to create a new one. */
  cashbox?: CashBoxSummary | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved', box: CashBoxSummary): void
  /** Владелец попросил очистить кассу — подтверждение открывает страница. */
  (e: 'reset'): void
  /** Попросили удалить кассу — подтверждение открывает страница. */
  (e: 'delete'): void
}>()

const store = useCashBoxesStore()
const accounting = useAccountingStore()
const toast = useToast()
const { isDark } = useIsDark()
const { isMobile } = useIsMobile()

const isEdit = computed(() => !!props.cashbox)
const auth = useAuthStore()

// Очистка кассы — в глубине окна изменения, а не на виду: показываем только
// владельцу и только если в кассе есть что стирать.
const hasContent = ref(false)
async function loadContent() {
  hasContent.value = false
  if (!props.cashbox || !auth.isOwner) return
  try {
    const p = await api.get<Record<string, number>>(`/cashboxes/${props.cashbox.id}/reset/preview`)
    hasContent.value = (p.deals ?? 0) + (p.journal ?? 0) + (p.transactions ?? 0) > 0
  } catch {
    hasContent.value = false
  }
}
function askReset() {
  emit('update:modelValue', false)
  emit('reset')
}
// Удаление — тоже здесь, а не на виду. Основную кассу удалить нельзя.
const canDelete = computed(() => !!props.cashbox && !props.cashbox.isDefault && auth.can('cashboxes.delete'))
function askDelete() {
  emit('update:modelValue', false)
  emit('delete')
}

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
// Ваша прибыль прошлых месяцев, оставшаяся в кассе, работает
// как ваш капитал (авто-реинвест). Выключено — в доле только внесённое вами.
const partnerAutoReinvest = ref(false)
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
      initialCapital.value = null
      partnerAutoReinvest.value = props.cashbox.partnerAutoReinvest ?? false
      loadContent()
    } else {
      hasContent.value = false
      name.value = ''
      color.value = '#3b82f6'
      icon.value = 'mdi-wallet-outline'
      initialCapital.value = null
      partnerAutoReinvest.value = false
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
    // Деньги при создании — первая запись истории вашего капитала; у
    // существующей кассы капитал меняется операциями, а не этим окном.
    const payload = {
      name: trimmed,
      color: color.value,
      icon: icon.value,
      ...(isEdit.value ? {} : { initialCapital: initialCapital.value ?? 0 }),
      partnerAutoReinvest: partnerAutoReinvest.value,
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
        toast.error(e, 'Касса создана, но счета завести не удалось')
      }
    }

    toast.success(isEdit.value ? 'Касса обновлена' : 'Касса создана')
    emit('saved', box)
    emit('update:modelValue', false)
  } catch (e: any) {
    toast.error(e, 'Не удалось сохранить')
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
    <v-card rounded="lg" :class="{ 'cb-dialog': true, dark: isDark, full: isMobile }">
      <div class="cb-header">
        <div class="cb-header-icon" :style="{ background: color + '22', color }">
          <v-icon :icon="icon" size="22" />
        </div>
        <div class="cb-header-text">
          <div class="cb-title">{{ isEdit ? 'Изменить кассу' : 'Новая касса' }}</div>
          <div class="cb-subtitle">
            {{ isEdit ? 'Поменяйте название, цвет и иконку' : 'Создайте отдельный кошелёк' }}
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

        <div v-if="!isEdit" class="cb-field">
          <label class="cb-label">Сколько денег вносите сейчас</label>
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
            Станет первой записью вашего капитала в кассе. Дальше вносите и снимайте деньги операциями
            «Внести деньги» и «Снять» — у каждой видно, с какого числа она меняет вашу долю.
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

        <!-- Ваша прибыль как капитал — по желанию, по умолчанию выключено. Без
             раздела инвесторов делить не с кем — переключатель не показываем. -->
        <div v-if="sections.visible('coInvestors')" class="cb-field">
          <label class="cb-label">Ваша прибыль в кассе</label>
          <label class="cb-switch">
            <v-switch v-model="partnerAutoReinvest" color="primary" density="compact" hide-details inset />
            <span>
              <b>Работает как ваш капитал</b>
              <span class="cb-hint cb-hint--inline">
                Невыплаченная вами прибыль прошлых месяцев увеличивает вашу долю при делении с инвесторами
                «по вкладу». Выключено — доля считается только от ваших денег в кассе.
              </span>
            </span>
          </label>
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

        <div v-if="isEdit && (hasContent || canDelete)" class="cb-danger-zone">
          <div v-if="hasContent" class="cb-danger">
            <div class="cb-danger-text">
              <div class="cb-danger-title">Очистить кассу</div>
              <div class="cb-danger-sub">Удалит сделки, платежи и операции этой кассы. Сама касса останется</div>
            </div>
            <button type="button" class="cb-danger-btn" :disabled="submitting" @click="askReset">Очистить…</button>
          </div>
          <div v-if="canDelete" class="cb-danger">
            <div class="cb-danger-text">
              <div class="cb-danger-title">Удалить кассу</div>
              <div class="cb-danger-sub">Только пустую: без сделок, инвесторов и остатка</div>
            </div>
            <button type="button" class="cb-danger-btn" :disabled="submitting" @click="askDelete">Удалить…</button>
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
/*
 * Окно скроллится внутри себя, а не целиком.
 *
 * Полей здесь много — название, капитал, участие, цвет, иконка, — и при
 * прокрутке всего окна кнопки «Отмена» и «Сохранить» уезжали за нижний край:
 * чтобы сохранить кассу, приходилось доматывать до конца. Теперь прокручивается
 * только середина, а шапка и кнопки остаются на месте.
 */
.cb-dialog {
  background: #fff;
  display: flex; flex-direction: column;
  max-height: 88vh;
  overflow: hidden;
}
.cb-dialog.full { height: 100%; max-height: 100%; }
.cb-dialog > .cb-header,
.cb-dialog > .cb-footer { flex: none; }
.cb-dialog.dark { background: rgb(var(--v-theme-surface-elevated)); }

/* На весь экран (мобильный) ограничение по высоте не нужно — окно и так во
   весь экран, а 88vh оставили бы под ним пустую полосу. */
@media (max-width: 599px) {
  .cb-dialog { max-height: 100%; height: 100%; }
}

/* Header */
/* Шапка не уезжает вместе с содержимым. */
.cb-header {
  flex: none;
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
  /* Прокручивается только эта часть — шапка и кнопки закреплены. */
  flex: 1 1 auto; overflow-y: auto; min-height: 0;
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
.cb-switch {
  display: flex; align-items: flex-start; gap: 10px; cursor: pointer;
  padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  font-size: 13px;
}
.cb-switch :deep(.v-switch) { flex: none; margin-top: -4px; }
.cb-hint--inline { display: block; margin-top: 3px; }
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
.cb-label--sub { display: block; margin-top: 12px; }
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
.cb-danger-zone { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
.cb-danger {
  display: flex; align-items: center; gap: 12px; justify-content: space-between;
  padding: 12px 14px; border-radius: 12px;
  border: 1px solid rgba(239, 68, 68, 0.25);
}
.cb-danger-title { font-size: 13.5px; font-weight: 600; color: #dc2626; }
.cb-danger-sub { font-size: 12px; margin-top: 2px; color: #737373; }
.cb-dialog.dark .cb-danger-sub { color: rgba(var(--v-theme-on-surface), 0.6); }
.cb-danger-btn {
  flex: none; height: 34px; padding: 0 14px; border-radius: 9px; cursor: pointer;
  border: 1px solid rgba(239, 68, 68, 0.4); background: transparent;
  color: #dc2626; font-size: 13px; font-weight: 600;
}
.cb-danger-btn:hover:not(:disabled) { background: rgba(239, 68, 68, 0.08); }
.cb-danger-btn:disabled { opacity: 0.5; cursor: default; }
.cb-footer {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 14px 20px;
  border-top: 1px solid #f0f0f0;
  /* Кнопки всегда на виду: sticky держит их у нижнего края и в тех браузерах,
     где flex-раскладка окна ведёт себя иначе. */
  position: sticky; bottom: 0; z-index: 1;
  flex: none;
  background: inherit;
  /* Мягкая тень вверх: видно, что под кнопками содержимое продолжается. */
  box-shadow: 0 -6px 14px rgba(15, 23, 42, 0.05);
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
