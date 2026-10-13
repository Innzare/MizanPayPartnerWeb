<script setup lang="ts">
/**
 * Подтверждение удаления кассы.
 *
 * Удалить можно только пустую кассу: без сделок, инвесторов и остатка —
 * это проверяет сервер. Окно заранее говорит, если сделки есть, и просит
 * набрать слово: удаление не отменить.
 */
import { computed, ref, watch } from 'vue'
import { useCashBoxesStore, type CashBoxSummary } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'

const WORD = 'УДАЛИТЬ'

const props = defineProps<{ modelValue: boolean; cashbox: CashBoxSummary }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'deleted'): void
}>()

const store = useCashBoxesStore()
const toast = useToast()
const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const confirmation = ref('')
const running = ref(false)
const error = ref('')

const dealsCount = computed(() => props.cashbox.dealsCount ?? 0)
const ready = computed(() => dealsCount.value === 0 && confirmation.value.trim().toUpperCase() === WORD)

watch(open, (v) => {
  if (v) return
  confirmation.value = ''
  error.value = ''
})

async function run() {
  if (!ready.value || running.value) return
  running.value = true
  error.value = ''
  try {
    await store.remove(props.cashbox.id)
    toast.success(`Касса «${props.cashbox.name}» удалена`)
    open.value = false
    emit('deleted')
  } catch (e: any) {
    // Остаток или инвесторы в кассе — ответ сервера показываем в самом окне.
    error.value = e?.message || 'Не удалось удалить кассу'
  } finally {
    running.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="460" :persistent="running">
    <v-card rounded="lg" class="dd-card">
      <div class="dd-head">
        <div class="dd-icon"><v-icon icon="mdi-delete-outline" size="22" /></div>
        <div>
          <div class="dd-title">Удалить кассу «{{ cashbox.name }}»</div>
          <div class="dd-sub">Касса исчезнет из списка вместе со своими операциями</div>
        </div>
      </div>

      <div v-if="dealsCount > 0" class="dd-block">
        В кассе {{ dealsCount.toLocaleString('ru-RU') }}
        {{ dealsCount % 10 === 1 && dealsCount % 100 !== 11 ? 'сделка' : 'сделок' }}.
        Перенесите их в другую кассу или очистите кассу — потом её можно будет удалить.
      </div>

      <template v-else>
        <div class="dd-note">
          <v-icon icon="mdi-alert-outline" size="16" />
          <span>
            Удалить можно только пустую кассу: без сделок, без инвесторов и с нулевым остатком.
            Вернуть кассу будет нельзя.
          </span>
        </div>

        <div class="dd-field">
          <label class="dd-label">Введите слово <b>{{ WORD }}</b></label>
          <input
            v-model="confirmation"
            class="dd-input"
            :placeholder="WORD"
            autocomplete="off"
            spellcheck="false"
            @keyup.enter="run"
          />
        </div>
      </template>

      <div v-if="error" class="dd-error">{{ error }}</div>

      <div class="dd-actions">
        <button class="dd-btn dd-btn--ghost" :disabled="running" @click="open = false">
          {{ dealsCount > 0 ? 'Понятно' : 'Отмена' }}
        </button>
        <button v-if="dealsCount === 0" class="dd-btn dd-btn--danger" :disabled="!ready || running" @click="run">
          <v-progress-circular v-if="running" indeterminate size="15" width="2" color="white" />
          {{ running ? 'Удаляем…' : 'Удалить кассу' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.dd-card { padding: 20px; }
.dd-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.dd-icon {
  width: 40px; height: 40px; border-radius: 11px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(239, 68, 68, 0.1); color: #dc2626;
}
.dd-title { font-size: 16px; font-weight: 700; }
.dd-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 2px; }
.dd-block {
  padding: 12px 14px; border-radius: 10px; margin-bottom: 4px;
  background: rgba(245, 158, 11, 0.1); color: #92400e;
  font-size: 13px; line-height: 1.5;
}
.dd-note {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 10px 12px; border-radius: 10px; margin-bottom: 14px;
  background: rgba(239, 68, 68, 0.08); color: #b91c1c;
  font-size: 12.5px; line-height: 1.45;
}
.dd-field { margin-bottom: 6px; }
.dd-label { display: block; font-size: 12.5px; margin-bottom: 5px; color: rgba(var(--v-theme-on-surface), 0.6); }
.dd-input {
  width: 100%; height: 42px; padding: 0 13px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 10px; background: rgb(var(--v-theme-surface));
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9); outline: none;
}
.dd-input:focus { border-color: #dc2626; }
.dd-error { margin-top: 10px; font-size: 12.5px; color: #dc2626; line-height: 1.45; }
.dd-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
.dd-btn {
  display: flex; align-items: center; gap: 7px;
  height: 40px; padding: 0 16px; border: none; border-radius: 10px;
  font-size: 13.5px; font-weight: 600; cursor: pointer;
}
.dd-btn:disabled { opacity: 0.5; cursor: default; }
.dd-btn--ghost { background: transparent; color: rgba(var(--v-theme-on-surface), 0.6); border: 1px solid rgba(var(--v-theme-on-surface), 0.12); }
.dd-btn--danger { background: #dc2626; color: #fff; }
</style>
