<script setup lang="ts">
/**
 * Статьи дохода и расхода: аренда, зарплата, реклама…
 *
 * Раньше управлялись кнопкой «Категории» в карточке кассы. Ручные операции
 * переехали в «Бухгалтерию → Пополнения и расходы» — статьи вместе с ними.
 */
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import { useToast } from '@/composables/useToast'

interface Category {
  id: string
  name: string
  type: 'INCOME' | 'EXPENSE'
  color?: string | null
  _count?: { transactions: number }
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'changed'): void
}>()

const toast = useToast()
const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const categories = ref<Category[]>([])
const loading = ref(false)
/** Новая статья: тип и название. */
const adding = ref<'INCOME' | 'EXPENSE' | null>(null)
const newName = ref('')
/** Переименование: id и новое название. */
const editingId = ref<string | null>(null)
const editName = ref('')
const deletingId = ref<string | null>(null)

const groups = computed(() => [
  { type: 'EXPENSE' as const, title: 'Расходы', items: categories.value.filter((c) => c.type === 'EXPENSE') },
  { type: 'INCOME' as const, title: 'Доходы', items: categories.value.filter((c) => c.type === 'INCOME') },
])

async function load() {
  loading.value = true
  try {
    categories.value = await api.get<Category[]>('/finance/categories')
  } catch (e: any) {
    toast.error(e, 'Не удалось загрузить статьи')
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (v) => {
  if (!v) return
  adding.value = null
  editingId.value = null
  deletingId.value = null
  void load()
})

async function add() {
  if (!adding.value || !newName.value.trim()) return
  try {
    await api.post('/finance/categories', { name: newName.value.trim(), type: adding.value })
    adding.value = null
    newName.value = ''
    await load()
    emit('changed')
  } catch (e: any) {
    toast.error(e, 'Не удалось добавить статью')
  }
}

function startEdit(c: Category) {
  editingId.value = c.id
  editName.value = c.name
}

async function saveEdit() {
  if (!editingId.value || !editName.value.trim()) return
  try {
    await api.patch(`/finance/categories/${editingId.value}`, { name: editName.value.trim() })
    editingId.value = null
    await load()
    emit('changed')
  } catch (e: any) {
    toast.error(e, 'Не удалось переименовать')
  }
}

async function remove(id: string) {
  try {
    await api.delete(`/finance/categories/${id}`)
    deletingId.value = null
    await load()
    emit('changed')
  } catch (e: any) {
    toast.error(e, 'Не удалось удалить статью')
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="480" scrollable>
    <v-card rounded="lg" class="cd-card">
      <div class="cd-head">
        <div class="cd-title">Статьи дохода и расхода</div>
        <div class="cd-sub">По ним группируются ручные операции в отчётах</div>
      </div>

      <div class="cd-body">
        <div v-if="loading && !categories.length" class="cd-loading">
          <v-progress-circular indeterminate size="22" color="primary" />
        </div>
        <div v-for="g in groups" :key="g.type" class="cd-group">
          <div class="cd-group-head">
            <span>{{ g.title }}</span>
            <button v-if="adding !== g.type" type="button" class="cd-link" @click="adding = g.type; newName = ''">+ Добавить</button>
          </div>
          <div v-if="adding === g.type" class="cd-row cd-row--edit">
            <input v-clear v-model="newName" class="cd-input" placeholder="Название статьи" @keydown.enter.prevent="add" />
            <button type="button" class="cd-btn" :disabled="!newName.trim()" @click="add">Добавить</button>
            <button type="button" class="cd-icon" title="Отмена" @click="adding = null"><v-icon icon="mdi-close" size="16" /></button>
          </div>
          <div v-for="c in g.items" :key="c.id" class="cd-row">
            <template v-if="editingId === c.id">
              <input v-clear v-model="editName" class="cd-input" @keydown.enter.prevent="saveEdit" />
              <button type="button" class="cd-btn" :disabled="!editName.trim()" @click="saveEdit">Сохранить</button>
              <button type="button" class="cd-icon" title="Отмена" @click="editingId = null"><v-icon icon="mdi-close" size="16" /></button>
            </template>
            <template v-else-if="deletingId === c.id">
              <span class="cd-name">Удалить «{{ c.name }}»? Операции останутся без статьи</span>
              <button type="button" class="cd-btn cd-btn--danger" @click="remove(c.id)">Удалить</button>
              <button type="button" class="cd-icon" title="Отмена" @click="deletingId = null"><v-icon icon="mdi-close" size="16" /></button>
            </template>
            <template v-else>
              <span class="cd-dot" :style="{ background: c.color || (c.type === 'INCOME' ? '#10b981' : '#ef4444') }" />
              <span class="cd-name">{{ c.name }}</span>
              <span class="cd-count">{{ c._count?.transactions ?? 0 }} оп.</span>
              <button type="button" class="cd-icon" title="Переименовать" @click="startEdit(c)"><v-icon icon="mdi-pencil-outline" size="15" /></button>
              <button type="button" class="cd-icon cd-icon--danger" title="Удалить" @click="deletingId = c.id"><v-icon icon="mdi-delete-outline" size="15" /></button>
            </template>
          </div>
          <div v-if="!g.items.length && adding !== g.type" class="cd-empty">Статей пока нет</div>
        </div>
      </div>

      <div class="cd-actions">
        <button class="cd-close" @click="open = false">Закрыть</button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.cd-card { display: flex; flex-direction: column; max-height: 88vh; }
.cd-head { padding: 20px 24px 14px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
.cd-title { font-size: 17px; font-weight: 700; }
.cd-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 3px; }
.cd-body { padding: 8px 24px 12px; overflow-y: auto; flex: 1; }
.cd-loading { display: flex; justify-content: center; padding: 20px; }
.cd-group { margin-top: 12px; }
.cd-group-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
  color: rgba(var(--v-theme-on-surface), 0.45); padding: 6px 0;
}
.cd-link { border: none; background: none; cursor: pointer; font-size: 12.5px; font-weight: 600; color: #047857; text-transform: none; letter-spacing: 0; }
.cd-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 4px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06); font-size: 13.5px;
}
.cd-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.cd-name { flex: 1; min-width: 0; }
.cd-count { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); }
.cd-input {
  flex: 1; min-width: 0; padding: 8px 12px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14); font-size: 13.5px; outline: none;
  background: rgba(var(--v-theme-on-surface), 0.02); color: rgba(var(--v-theme-on-surface), 0.85);
}
.cd-input:focus { border-color: #047857; }
.cd-btn { padding: 7px 12px; border-radius: 9px; border: none; background: #047857; color: #fff; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.cd-btn:disabled { opacity: 0.5; cursor: default; }
.cd-btn--danger { background: #dc2626; }
.cd-icon {
  width: 30px; height: 30px; border-radius: 8px; border: none; cursor: pointer; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  background: none; color: rgba(var(--v-theme-on-surface), 0.5);
}
.cd-icon:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.cd-icon--danger:hover { color: #dc2626; }
.cd-empty { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.4); padding: 6px 4px; }
.cd-actions { padding: 14px 24px 18px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08); }
.cd-close {
  width: 100%; padding: 11px 16px; border-radius: 10px; border: none; cursor: pointer;
  background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.7); font-size: 14px;
}
</style>
