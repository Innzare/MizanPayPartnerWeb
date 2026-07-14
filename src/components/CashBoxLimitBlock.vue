<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCashBoxesStore, type CashBoxSummary } from '@/stores/cashboxes'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { PLAN_LABELS } from '@/types'

// Shown at the top of the cashboxes page whenever the partner has more active
// cashboxes than their plan allows (e.g. after a downgrade). Lets them pick
// which ones stay active — the rest go read-only ("only view") on the backend.
const props = defineProps<{ boxes: CashBoxSummary[] }>()
const emit = defineEmits<{ (e: 'saved'): void }>()

const router = useRouter()
const toast = useToast()
const store = useCashBoxesStore()
const authStore = useAuthStore()

// Only non-archived cashboxes count toward the limit and can be picked here.
const selectable = computed(() => props.boxes.filter((b) => !b.archivedAt))
const maxCashBoxes = computed(() => authStore.user?.planLimits?.maxCashBoxes ?? -1)
const planLabel = computed(() =>
  authStore.user?.subscriptionPlan ? PLAN_LABELS[authStore.user.subscriptionPlan] : '—',
)

const activeCount = computed(() => selectable.value.filter((b) => !b.lockedAt).length)
const lockedCount = computed(() => selectable.value.filter((b) => b.lockedAt).length)

// Pre-select the currently active cashboxes. Reset the selection whenever the
// underlying list changes (e.g. after a save the server returns fresh state).
const selected = ref<Set<string>>(new Set())
watch(
  selectable,
  (boxes) => {
    selected.value = new Set(boxes.filter((b) => !b.lockedAt).map((b) => b.id))
  },
  { immediate: true },
)

const limitReached = computed(
  () => maxCashBoxes.value !== -1 && selected.value.size >= maxCashBoxes.value,
)

function isSelected(id: string) {
  return selected.value.has(id)
}

function toggle(box: CashBoxSummary) {
  const next = new Set(selected.value)
  if (next.has(box.id)) {
    next.delete(box.id)
  } else {
    if (maxCashBoxes.value !== -1 && next.size >= maxCashBoxes.value) {
      toast.warning(`Можно оставить активными не больше ${maxCashBoxes.value} касс. Сначала снимите отметку с другой.`)
      return
    }
    next.add(box.id)
  }
  selected.value = next
}

const saving = ref(false)
async function save() {
  if (selected.value.size === 0) {
    toast.error('Оставьте активной хотя бы одну кассу')
    return
  }
  if (maxCashBoxes.value !== -1 && selected.value.size > maxCashBoxes.value) {
    toast.error(`Слишком много активных касс — максимум ${maxCashBoxes.value}`)
    return
  }
  saving.value = true
  try {
    await store.setActive([...selected.value])
    toast.success('Выбор активных касс сохранён')
    emit('saved')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось сохранить выбор')
  } finally {
    saving.value = false
  }
}

function goToSubscription() {
  router.push({ path: '/settings', query: { tab: 'subscription' } })
}
</script>

<template>
  <div class="cbl-block">
    <div class="cbl-head">
      <div class="cbl-icon">
        <v-icon icon="mdi-lock-alert-outline" size="22" />
      </div>
      <div class="cbl-head-text">
        <div class="cbl-title">Превышен лимит касс тарифа</div>
        <div class="cbl-subtitle">
          Ваш тариф ({{ planLabel }}) позволяет
          {{ maxCashBoxes === -1 ? '∞' : maxCashBoxes }} касс.
          Сейчас активны {{ activeCount }}, ещё {{ lockedCount }} в режиме только-просмотр.
          Выберите, какие кассы оставить активными — в остальных нельзя создавать новые
          сделки (но можно закрывать текущие: платежи, выплаты).
        </div>
      </div>
      <button class="cbl-upgrade" @click="goToSubscription">
        <v-icon icon="mdi-arrow-up-bold-circle-outline" size="16" />
        Повысить тариф
      </button>
    </div>

    <div class="cbl-picker">
      <button
        v-for="box in selectable"
        :key="box.id"
        type="button"
        class="cbl-item"
        :class="{ 'cbl-item--on': isSelected(box.id), 'cbl-item--disabled': !isSelected(box.id) && limitReached }"
        @click="toggle(box)"
      >
        <span class="cbl-check" :class="{ 'cbl-check--on': isSelected(box.id) }">
          <v-icon v-if="isSelected(box.id)" icon="mdi-check" size="14" />
        </span>
        <span class="cbl-item-icon" :style="{ background: box.color + '20', color: box.color }">
          <v-icon :icon="box.icon" size="16" />
        </span>
        <span class="cbl-item-name">{{ box.name }}</span>
        <span v-if="box.lockedAt" class="cbl-item-tag">
          <v-icon icon="mdi-lock-outline" size="12" />
          только просмотр
        </span>
      </button>
    </div>

    <div class="cbl-footer">
      <div class="cbl-counter" :class="{ 'cbl-counter--full': limitReached }">
        Выбрано {{ selected.size }}<template v-if="maxCashBoxes !== -1"> / {{ maxCashBoxes }}</template>
      </div>
      <button class="cbl-save" :disabled="saving" @click="save">
        <v-progress-circular v-if="saving" indeterminate size="16" width="2" color="#fff" class="mr-1" />
        Сохранить выбор
      </button>
    </div>
  </div>
</template>

<style scoped>
.cbl-block {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 16px;
  padding: 20px 22px;
  margin-bottom: 24px;
}
.cbl-head { display: flex; align-items: flex-start; gap: 14px; }
.cbl-icon {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(245, 158, 11, 0.15); color: #b45309;
}
.cbl-head-text { flex: 1; min-width: 0; }
.cbl-title { font-size: 16px; font-weight: 800; color: #92400e; }
.cbl-subtitle { font-size: 13px; line-height: 1.5; color: #a16207; margin-top: 4px; }
.cbl-upgrade {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 36px; padding: 0 14px; border-radius: 9px;
  background: #b45309; color: #fff; border: none;
  font-size: 12.5px; font-weight: 700; cursor: pointer; transition: background 0.15s;
}
.cbl-upgrade:hover { background: #92400e; }

.cbl-picker {
  display: flex; flex-wrap: wrap; gap: 8px;
  margin-top: 16px;
}
.cbl-item {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.6);
  border: 1.5px solid rgba(245, 158, 11, 0.25);
  cursor: pointer; transition: all 0.15s; text-align: left;
}
.cbl-item--on { background: #fff; border-color: #047857; }
.cbl-item--disabled { opacity: 0.5; cursor: not-allowed; }
.cbl-check {
  width: 20px; height: 20px; border-radius: 6px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px solid rgba(0, 0, 0, 0.2); color: #fff; background: transparent;
}
.cbl-check--on { background: #047857; border-color: #047857; }
.cbl-item-icon {
  width: 26px; height: 26px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.cbl-item-name { font-size: 13px; font-weight: 600; color: #1c1c1e; }
.cbl-item-tag {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10.5px; font-weight: 700; color: #b45309;
  background: rgba(245, 158, 11, 0.15); padding: 2px 7px; border-radius: 6px;
}

.cbl-footer {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 16px;
}
.cbl-counter { font-size: 12.5px; font-weight: 700; color: #a16207; }
.cbl-counter--full { color: #047857; }
.cbl-save {
  display: inline-flex; align-items: center; justify-content: center;
  height: 38px; padding: 0 20px; border-radius: 10px;
  background: #047857; color: #fff; border: none;
  font-size: 13px; font-weight: 700; cursor: pointer; transition: background 0.15s;
}
.cbl-save:hover:not(:disabled) { background: #065f46; }
.cbl-save:disabled { opacity: 0.7; cursor: default; }

/* Dark */
:global(.cb-page.dark) .cbl-block { background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); }
:global(.cb-page.dark) .cbl-title { color: #fbbf24; }
:global(.cb-page.dark) .cbl-subtitle { color: #d4a24e; }
:global(.cb-page.dark) .cbl-item { background: rgba(255, 255, 255, 0.05); }
:global(.cb-page.dark) .cbl-item--on { background: #1c1c1e; }
:global(.cb-page.dark) .cbl-item-name { color: #f5f5f5; }

@media (max-width: 599px) {
  .cbl-head { flex-wrap: wrap; }
  .cbl-upgrade { width: 100%; justify-content: center; margin-top: 4px; }
  .cbl-footer { flex-direction: column; align-items: stretch; gap: 10px; }
  .cbl-save { width: 100%; }
}
</style>
