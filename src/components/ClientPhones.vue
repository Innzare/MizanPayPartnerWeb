<script setup lang="ts">
/**
 * Дополнительные номера клиента: жена, работа, сосед.
 *
 * Когда клиент перестаёт брать трубку, звонят именно по ним — до сих пор эти
 * номера жили в тетрадках и в памяти сотрудников. Поэтому здесь не форма ради
 * формы: у каждого номера сразу есть кнопки «позвонить» и WhatsApp.
 *
 * Эти номера НЕ участвуют в склейке клиентов: один рабочий телефон бывает у
 * десятка разных людей. Совпадение с чужим номером — предупреждение, а не
 * запрет: решает человек.
 */
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import PhoneField from '@/components/PhoneField.vue'
import { formatPhone } from '@/utils/formatters'
import { isCompletePhone, phoneDigits } from '@/utils/phone'
import { useToast } from '@/composables/useToast'

interface ExtraPhone {
  id: string
  phone: string
  label?: string | null
  hasWhatsapp: boolean
  order: number
}

const props = withDefaults(
  defineProps<{
    /** Профиль клиента, чьи номера показываем. */
    profileId: string
    /** Номера, если карточка их уже загрузила: тогда лишнего запроса не будет. */
    initial?: ExtraPhone[] | null
    /** Только показать: без добавления и правки. */
    readonly?: boolean
  }>(),
  { readonly: false },
)

const emit = defineEmits<{
  /** Основной номер поменялся местами с дополнительным. */
  (e: 'primary-changed', phone: string): void
  (e: 'changed'): void
}>()

const toast = useToast()

const phones = ref<ExtraPhone[]>([...(props.initial ?? [])])
const loading = ref(false)
const saving = ref(false)
/** Номер, по которому сейчас идёт смена основного: повтор откатил бы обмен. */
const switching = ref<string | null>(null)

/** Форма добавления/правки: открывается только когда нужна. */
const editing = ref<{ id: string | null; phone: string; label: string; hasWhatsapp: boolean } | null>(
  null,
)

/**
 * Номер последнего запроса.
 *
 * Карточку должника переключают строка за строкой: без этого поздний ответ по
 * прошлому клиенту лёг бы поверх нового, и сотрудник позвонил бы по чужому
 * телефону.
 */
let requestId = 0

async function load() {
  const id = ++requestId
  loading.value = true
  try {
    const res = await api.get<ExtraPhone[]>(`/client-profiles/${props.profileId}/phones`)
    if (id !== requestId) return
    phones.value = res
  } catch {
    // Номера — дополнение к карточке: не загрузились, но сама карточка
    // остаётся рабочей.
    if (id === requestId) phones.value = []
  } finally {
    if (id === requestId) loading.value = false
  }
}

// Профиль на странице может смениться (переход между клиентами) — тогда список
// нужно перечитать, иначе покажем номера предыдущего человека.
watch(
  () => props.profileId,
  () => {
    // Сначала очищаем: пока грузятся новые, на экране не должно быть телефонов
    // предыдущего человека.
    phones.value = []
    if (props.initial?.length) phones.value = [...props.initial]
    else load()
  },
)

if (!props.initial) load()

function startAdd() {
  editing.value = { id: null, phone: '', label: '', hasWhatsapp: false }
}

function startEdit(p: ExtraPhone) {
  editing.value = { id: p.id, phone: p.phone, label: p.label ?? '', hasWhatsapp: p.hasWhatsapp }
}

const canSave = computed(() => !!editing.value && isCompletePhone(editing.value.phone))

async function save() {
  if (!editing.value || !canSave.value) return
  saving.value = true
  try {
    const body = {
      phone: editing.value.phone,
      // null, а не undefined: undefined выпадет из JSON, и стёртая метка
      // молча вернулась бы на место.
      label: editing.value.label.trim() || null,
      hasWhatsapp: editing.value.hasWhatsapp,
    }
    const res = editing.value.id
      ? await api.patch<{ phone: ExtraPhone; warnings: { text: string }[] }>(
          `/client-profiles/${props.profileId}/phones/${editing.value.id}`,
          body,
        )
      : await api.post<{ phone: ExtraPhone; warnings: { text: string }[] }>(
          `/client-profiles/${props.profileId}/phones`,
          body,
        )
    // Номер сохранён в любом случае — предупреждение лишь показывает, где он
    // уже встречается: один телефон на семью или на магазин это норма.
    for (const w of res.warnings ?? []) toast.warning(w.text)
    editing.value = null
    await load()
    emit('changed')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось сохранить номер')
  } finally {
    saving.value = false
  }
}

async function remove(p: ExtraPhone) {
  if (!confirm(`Удалить номер ${formatPhone(p.phone)}?`)) return
  try {
    await api.delete(`/client-profiles/${props.profileId}/phones/${p.id}`)
    await load()
    emit('changed')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось удалить номер')
  }
}

async function makePrimary(p: ExtraPhone) {
  if (switching.value) return
  if (!confirm(`Сделать ${formatPhone(p.phone)} основным номером клиента?`)) return
  switching.value = p.id
  try {
    const res = await api.post<{ phone: string }>(
      `/client-profiles/${props.profileId}/phones/${p.id}/primary`,
      {},
    )
    // Старый основной не пропадает — он занимает место этого номера в списке.
    toast.success('Основной номер изменён')
    await load()
    emit('primary-changed', res.phone)
    emit('changed')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось изменить основной номер')
  } finally {
    switching.value = null
  }
}

function callHref(phone: string) {
  return `tel:+${phoneDigits(phone)}`
}
function chatHref(phone: string) {
  return `/broadcasts?chat=${phoneDigits(phone)}`
}
</script>

<template>
  <div class="cph">
    <div class="cph-head">
      <span class="cph-title">Дополнительные номера</span>
      <button v-if="!readonly && !editing" class="cph-add" @click="startAdd">
        <v-icon icon="mdi-plus" size="16" /> Добавить
      </button>
    </div>

    <div v-if="loading" class="cph-empty">Загрузка…</div>

    <div v-else-if="!phones.length && !editing" class="cph-empty">
      <template v-if="readonly">Дополнительных номеров нет</template>
      <template v-else>
        Только основной номер. Добавьте телефон жены, работы или соседа — по ним
        дозваниваются, когда клиент не берёт трубку.
      </template>
    </div>

    <div v-for="p in (loading ? [] : phones)" :key="p.id" class="cph-row">
      <div class="cph-row-main">
        <div class="cph-number">
          {{ formatPhone(p.phone) }}
          <v-icon v-if="p.hasWhatsapp" icon="mdi-whatsapp" size="14" class="cph-wa" />
        </div>
        <div v-if="p.label" class="cph-label">{{ p.label }}</div>
      </div>

      <a :href="callHref(p.phone)" class="cph-act" title="Позвонить">
        <v-icon icon="mdi-phone-outline" size="16" />
      </a>
      <router-link :to="chatHref(p.phone)" class="cph-act" title="Написать в WhatsApp">
        <v-icon icon="mdi-whatsapp" size="16" />
      </router-link>

      <template v-if="!readonly">
        <button
          class="cph-act"
          title="Сделать основным"
          :disabled="!!switching"
          @click="makePrimary(p)"
        >
          <v-icon icon="mdi-star-outline" size="16" />
        </button>
        <button class="cph-act" title="Изменить" @click="startEdit(p)">
          <v-icon icon="mdi-pencil-outline" size="16" />
        </button>
        <button class="cph-act cph-act--danger" title="Удалить" @click="remove(p)">
          <v-icon icon="mdi-close" size="16" />
        </button>
      </template>
    </div>

    <div v-if="editing" class="cph-form">
      <PhoneField v-model="editing.phone" plain autofocus />
      <input
        v-model="editing.label"
        class="cph-input"
        maxlength="40"
        placeholder="Чей номер: жена, работа…"
      />
      <label class="cph-check">
        <input v-model="editing.hasWhatsapp" type="checkbox" />
        <span>Есть WhatsApp</span>
      </label>
      <div class="cph-form-actions">
        <button class="cph-btn cph-btn--ghost" @click="editing = null">Отмена</button>
        <button class="cph-btn" :disabled="!canSave || saving" @click="save">
          {{ saving ? 'Сохранение…' : 'Сохранить' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cph { display: flex; flex-direction: column; gap: 6px; }

.cph-head { display: flex; align-items: center; gap: 8px; }
.cph-title {
  font-size: 12px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.cph-add {
  margin-left: auto; display: flex; align-items: center; gap: 3px;
  border: none; background: transparent; cursor: pointer;
  font-size: 12.5px; font-weight: 600; color: #047857;
}

.cph-empty { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); line-height: 1.45; }

.cph-row {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 8px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.cph-row-main { flex: 1; min-width: 0; }
.cph-number {
  font-size: 13.5px; font-weight: 600; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.cph-wa { color: #25d366; margin-left: 3px; }
.cph-label { font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); }

.cph-act {
  width: 26px; height: 26px; border-radius: 8px; border: none;
  display: flex; align-items: center; justify-content: center;
  background: transparent; cursor: pointer; text-decoration: none;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.cph-act:hover { background: rgba(var(--v-theme-on-surface), 0.06); color: rgba(var(--v-theme-on-surface), 0.85); }
.cph-act--danger:hover { background: rgba(239, 68, 68, 0.1); color: #dc2626; }
.cph-act:disabled { opacity: 0.4; cursor: default; }

.cph-form {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.cph-input {
  width: 100%; height: 38px; padding: 0 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.9); outline: none;
}
.cph-input:focus { border-color: #047857; }
.cph-check {
  display: flex; align-items: center; gap: 7px;
  font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.7); cursor: pointer;
}
.cph-form-actions { display: flex; gap: 8px; justify-content: flex-end; }
.cph-btn {
  height: 32px; padding: 0 14px; border: none; border-radius: 9px;
  background: #047857; color: #fff; font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.cph-btn:disabled { opacity: 0.5; cursor: default; }
.cph-btn--ghost {
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
