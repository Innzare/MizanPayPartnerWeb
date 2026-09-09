<script setup lang="ts">
/**
 * Телефоны человека одним полем формы: основной и дополнительные.
 *
 * Дополнительные номера — это жена, работа, сосед: по ним звонят, когда сам
 * клиент не берёт трубку. Раньше их заводили отдельным блоком в карточке уже
 * созданного клиента: сотрудник заполнял форму, сохранял, искал карточку и
 * только там добавлял второй номер. Здесь они там же, где основной — под ним,
 * кнопкой «Добавить ещё номер», и уезжают на сервер вместе с формой.
 *
 * Компонент ничего не сохраняет сам: наружу отдаётся основной номер и черновики
 * дополнительных. Что с ними делать — решает форма (создать вместе с клиентом
 * или разложить на добавить/изменить/удалить при сохранении профиля).
 */
import { computed } from 'vue'
import PhoneField from '@/components/PhoneField.vue'

/** Черновик номера: `id` есть только у тех, что уже сохранены на сервере. */
export interface PhoneDraft {
  id?: string | null
  phone: string
  label: string
  hasWhatsapp?: boolean
}

const props = withDefaults(
  defineProps<{
    /** Основной номер клиента, E.164. */
    primary: string
    /** Дополнительные номера. */
    extras: PhoneDraft[]
    /**
     * Сколько номеров всего можно держать, включая основной. Пять — предел
     * разумного: дальше это уже не «как ещё дозвониться», а свалка.
     */
    max?: number
    disabled?: boolean
    /** Подпись основного поля — у поручителя она своя. */
    label?: string
    required?: boolean
    /**
     * Оформление основного поля: `plain` — фирменные инпуты модалок,
     * `outlined` — поля Vuetify, как в карточке клиента. Дополнительные номера
     * в обоих случаях оформлены одинаково: это блоки, а не строки формы.
     */
    fieldStyle?: 'plain' | 'outlined'
    /** Подпись под основным номером — у клиента это его идентификатор. */
    hint?: string
  }>(),
  { max: 5, disabled: false, label: 'Телефон', required: true, fieldStyle: 'plain', hint: '' },
)

const emit = defineEmits<{
  (e: 'update:primary', v: string): void
  (e: 'update:extras', v: PhoneDraft[]): void
}>()

/** Сколько номеров ещё можно добавить: основной занимает одно место. */
const left = computed(() => Math.max(0, props.max - 1 - props.extras.length))

function patch(i: number, part: Partial<PhoneDraft>) {
  const next = props.extras.map((p, idx) => (idx === i ? { ...p, ...part } : p))
  emit('update:extras', next)
}

function add() {
  if (!left.value || props.disabled) return
  emit('update:extras', [...props.extras, { id: null, phone: '', label: '', hasWhatsapp: false }])
}

function remove(i: number) {
  emit('update:extras', props.extras.filter((_, idx) => idx !== i))
}

/**
 * Сделать этот номер основным.
 *
 * Номера меняются местами: прежний основной остаётся в списке, иначе он просто
 * исчез бы из карточки — а по нему всё ещё могут звонить. Метку строки
 * очищаем: она описывала прежний номер («жена»), к новому она не относится.
 */
function makePrimary(i: number) {
  const row = props.extras[i]
  if (!row || props.disabled || !row.phone) return
  const old = props.primary
  emit('update:primary', row.phone)
  emit(
    'update:extras',
    props.extras.map((p, idx) => (idx === i ? { ...p, phone: old, label: '' } : p)),
  )
}
</script>

<template>
  <div class="plf">
    <div class="form-field">
      <template v-if="fieldStyle === 'plain'">
        <label class="field-label">
          {{ label }} <span v-if="required" class="required">*</span>
        </label>
        <PhoneField
          :model-value="primary"
          plain
          :disabled="disabled"
          @update:model-value="emit('update:primary', $event)"
        />
      </template>
      <PhoneField
        v-else
        :model-value="primary"
        :label="required ? `${label} *` : label"
        density="compact"
        :disabled="disabled"
        @update:model-value="emit('update:primary', $event)"
      />
      <div v-if="hint" class="plf-hint">{{ hint }}</div>
    </div>

    <div v-for="(p, i) in extras" :key="i" class="plf-row">
      <div class="plf-row-head">
        <span class="plf-row-title">Дополнительный номер {{ i + 1 }}</span>
        <button
          v-if="p.phone"
          type="button"
          class="plf-mini"
          title="Сделать основным — номера поменяются местами"
          :disabled="disabled"
          @click="makePrimary(i)"
        >
          <v-icon icon="mdi-star-outline" size="15" />
          Сделать основным
        </button>
        <button
          type="button"
          class="plf-mini plf-mini--danger"
          title="Удалить номер"
          :disabled="disabled"
          @click="remove(i)"
        >
          <v-icon icon="mdi-close" size="15" />
        </button>
      </div>

      <PhoneField
        :model-value="p.phone"
        plain
        :disabled="disabled"
        @update:model-value="patch(i, { phone: $event })"
      />

      <!-- Чей это номер — важнее самого номера: через полгода «ещё один
           телефон» без подписи не говорит ничего. -->
      <input
        :value="p.label"
        type="text"
        class="plf-input"
        maxlength="40"
        placeholder="Чей номер: жена, работа, сосед…"
        :disabled="disabled"
        @input="patch(i, { label: ($event.target as HTMLInputElement).value })"
      />

      <label class="plf-check">
        <input
          type="checkbox"
          :checked="p.hasWhatsapp"
          :disabled="disabled"
          @change="patch(i, { hasWhatsapp: ($event.target as HTMLInputElement).checked })"
        />
        <span>Есть WhatsApp</span>
      </label>
    </div>

    <button
      v-if="left > 0 && !disabled"
      type="button"
      class="plf-add"
      @click="add"
    >
      <v-icon icon="mdi-plus" size="16" />
      Добавить ещё номер
      <span class="plf-add-hint">можно ещё {{ left }}</span>
    </button>
    <div v-else-if="!disabled" class="plf-limit">
      Больше {{ max }} номеров на одного человека не храним
    </div>
  </div>
</template>

<style scoped>
.plf { display: flex; flex-direction: column; }

.plf-hint {
  margin: 4px 0 10px;
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Оформление подписи и инпута повторяет формы-модалки: компонент вставляют и
   в них, и в карточку клиента, а стили там объявлены scoped. */
.field-label {
  display: block; font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6); margin-bottom: 4px;
}
.field-label .required { color: #ef4444; }
.form-field { margin-bottom: 12px; }

.plf-row {
  display: flex; flex-direction: column; gap: 8px;
  margin-bottom: 10px; padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.plf-row-head { display: flex; align-items: center; gap: 8px; }
.plf-row-title {
  flex: 1; min-width: 0;
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.plf-mini {
  display: inline-flex; align-items: center; gap: 4px;
  height: 26px; padding: 0 8px; border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; cursor: pointer;
  font-size: 12px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.plf-mini:hover:not(:disabled) { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.plf-mini--danger:hover:not(:disabled) {
  border-color: rgba(220, 38, 38, 0.35); color: #dc2626; background: rgba(220, 38, 38, 0.06);
}
.plf-mini:disabled { opacity: 0.5; cursor: default; }

.plf-input {
  width: 100%; height: 38px; padding: 0 12px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 13.5px; outline: none; transition: border-color 0.15s;
}
.plf-input:focus { border-color: rgba(4, 120, 87, 0.5); }

.plf-check {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.65); cursor: pointer;
}
.plf-check input { width: 15px; height: 15px; accent-color: #047857; cursor: pointer; }

.plf-add {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 12px; margin-bottom: 12px;
  border-radius: 9px; border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
  background: transparent; cursor: pointer;
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.plf-add:hover { border-color: rgba(4, 120, 87, 0.5); color: #047857; }
.plf-add-hint { font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.4); }

.plf-limit {
  margin-bottom: 12px; font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
</style>
