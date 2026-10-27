<script setup lang="ts">
/**
 * Долг: с кем, срок возврата, комментарий. Денег не двигает — суммы правятся
 * по строкам истории в карточке долга. Удаление — отдельной кнопкой в строке
 * таблицы со своим окном.
 */
import { ref, watch } from 'vue'
import DateField from '@/components/DateField.vue'
import { useAccountingStore } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { dateToIso } from '@/utils/dateInput'

export interface LiabilityInfo {
  id: string
  direction: 'BORROWED' | 'LENT'
  personName: string
  title?: string | null
  dueDate: string | null
  note: string | null
}

const props = defineProps<{ liability: LiabilityInfo | null }>()
const emit = defineEmits<{ (e: 'update:liability', v: LiabilityInfo | null): void; (e: 'done'): void }>()

const store = useAccountingStore()
const toast = useToast()

const name = ref('')
const opTitle = ref('')
const due = ref('')
const note = ref('')
const saving = ref(false)

watch(
  () => props.liability,
  (l) => {
    if (!l) return
    name.value = l.personName
    opTitle.value = l.title ?? ''
    due.value = l.dueDate ? dateToIso(new Date(l.dueDate)) : ''
    note.value = l.note ?? ''
  },
)

function close() {
  emit('update:liability', null)
}

async function save() {
  const l = props.liability
  if (!l || !name.value.trim()) return
  saving.value = true
  try {
    await store.updateLiability(l.id, {
      personName: name.value.trim(),
      title: opTitle.value.trim() || null,
      dueDate: due.value || null,
      note: note.value.trim() || null,
    })
    toast.success('Сохранено')
    close()
    emit('done')
  } catch (e: any) {
    toast.error(e, 'Не удалось сохранить')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog :model-value="!!liability" max-width="440" @update:model-value="close">
    <v-card v-if="liability" rounded="lg" class="le-dialog">
      <div class="le-title">Изменить операцию</div>
      <div class="le-sub">Суммы выдач и возвратов правятся в истории долга.</div>

      <div class="le-field">
        <label class="le-label">Название</label>
        <input v-clear v-model="opTitle" class="le-input" maxlength="120" placeholder="Например: на закупку телефонов" />
      </div>
      <div class="le-field">
        <label class="le-label">{{ liability.direction === 'BORROWED' ? 'Чьи деньги' : 'У кого деньги' }}</label>
        <input v-clear v-model="name" class="le-input" />
      </div>
      <div class="le-field">
        <label class="le-label">Вернуть до</label>
        <DateField v-model="due" plain />
      </div>
      <div class="le-field">
        <label class="le-label">Комментарий</label>
        <textarea v-clear v-model="note" class="le-input le-textarea" rows="2" />
      </div>

      <div class="le-actions">
        <button class="le-cancel" @click="close">Отмена</button>
        <button class="le-confirm" :disabled="saving || !name.trim()" @click="save">{{ saving ? 'Сохраняю…' : 'Сохранить' }}</button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.le-dialog { padding: 22px 24px 18px; }
.le-title { font-size: 17px; font-weight: 700; }
.le-sub { font-size: 12.5px; line-height: 1.5; margin-top: 5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.le-field { margin-top: 14px; }
.le-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: rgba(var(--v-theme-on-surface), 0.6); }
.le-input {
  width: 100%; height: 42px; padding: 0 14px; border-radius: 10px; outline: none;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12); background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9);
}
.le-input:focus { border-color: #047857; }
/* Комментарий — многострочный, как везде в кабинете. */
.le-textarea { display: block; height: auto; min-height: 64px; padding: 10px 14px; line-height: 1.45; resize: vertical; font-family: inherit; }
.le-actions { display: flex; gap: 10px; margin-top: 18px; }
.le-cancel, .le-confirm { flex: 1; padding: 11px 16px; border-radius: 10px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; }
.le-cancel { background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500; }
.le-confirm { background: #047857; color: #fff; }
.le-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
