<script setup lang="ts">
/**
 * Карточка долга: с кем, касса, сколько взяли/дали, вернули и осталось — и
 * вся история выдач и возвратов по датам.
 *
 * Здесь же вернуть частями или целиком и взять ещё у того же человека
 * (10 000 + 20 000 = один долг на 30 000). У каждой строки истории — кнопки
 * «изменить» и «удалить» последней колонкой; удаление — своим окном. Долг
 * целиком удаляется кнопкой в строке таблицы «Временных», не отсюда.
 * Деньги правятся честно: прежнее движение по счёту гасится встречной
 * записью, история счёта сохраняется. Строки закрытого месяца не правятся.
 */
import { computed, ref, watch } from 'vue'
import LiabilityMovementDialog, { type LiabilityMovementMode } from '@/components/LiabilityMovementDialog.vue'
import LiabilityEditDialog, { type LiabilityInfo } from '@/components/LiabilityEditDialog.vue'
import LiabilityConvertDialog from '@/components/LiabilityConvertDialog.vue'
import { useAccountingStore, type LiabilityCard, type LiabilityMovementView } from '@/stores/accounting'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useConfirmDelete } from '@/composables/useConfirmDelete'
import { formatCurrency, formatDate, formatDateShortYear } from '@/utils/formatters'

const props = defineProps<{ liabilityId: string | null }>()
const emit = defineEmits<{ (e: 'update:liabilityId', v: string | null): void; (e: 'changed'): void }>()

const store = useAccountingStore()
const auth = useAuthStore()
const toast = useToast()
const { confirmDelete } = useConfirmDelete()

/** Вернуть и взять ещё — движение денег, как и запись долга. */
const canMove = computed(() => auth.can('finance.capital'))
/** Исправить и удалить — отдельное право, по умолчанию у владельца. */
const canEdit = computed(() => auth.can('accounting.temporary.edit'))

const card = ref<LiabilityCard | null>(null)
const loading = ref(false)

async function load() {
  if (!props.liabilityId) return
  loading.value = true
  try {
    card.value = await store.fetchLiability(props.liabilityId)
  } catch (e: any) {
    toast.error(e, 'Не удалось открыть долг')
    close()
  } finally {
    loading.value = false
  }
}

watch(
  () => props.liabilityId,
  (id) => {
    card.value = null
    if (id) void load()
  },
)

function close() {
  emit('update:liabilityId', null)
}

const borrowed = computed(() => card.value?.direction === 'BORROWED')
const pct = computed(() => {
  const c = card.value
  return c?.principal ? Math.min(100, Math.round((c.repaid / c.principal) * 100)) : 0
})

/** Чем стала перенесённая часть — подпись в истории. */
const CONVERT_KIND_TITLE: Record<string, string> = {
  EXPENSE: 'расход по бизнесу',
  OTHER_EXPENSE: 'иной расход',
  WITHDRAW_PROFIT: 'снятие прибыли',
  WITHDRAW_OWNER: 'снятие капитала',
}

function movementTitle(m: LiabilityMovementView): string {
  if (m.kind === 'CONVERT') return 'Перенесено в основные'
  if (m.kind === 'REPAY') return borrowed.value ? 'Вернули' : 'Нам вернули'
  if ((m.issueNo ?? 1) > 1) return borrowed.value ? 'Взяли ещё' : 'Дали ещё'
  return borrowed.value ? 'Взяли' : 'Дали'
}
/** Деньги пришли на счёт (+) или ушли (−). */
function movementIn(m: LiabilityMovementView): boolean {
  return (m.kind === 'ISSUE') === borrowed.value
}

// ── Выдача, возврат, правка строки ──
const showMovement = ref(false)
const movementMode = ref<LiabilityMovementMode>('repay')
const movementRow = ref<LiabilityMovementView | null>(null)
function openMovement(mode: LiabilityMovementMode, m: LiabilityMovementView | null = null) {
  movementMode.value = mode
  movementRow.value = m
  showMovement.value = true
}
async function afterChange() {
  emit('changed')
  await load()
}

// ── Перенос части долга «дали» в основные ──
const showConvert = ref(false)
/** Перенесено в основные — сводка показывает «вернули деньгами» отдельно. */
const converted = computed(() => card.value?.converted ?? 0)

// ── С кем, срок, заметка — своё окно ──
const editInfo = ref<LiabilityInfo | null>(null)

// ── Удаление строки истории ──
const issues = computed(() => (card.value?.movements ?? []).filter((m) => m.kind === 'ISSUE'))

/**
 * Удаление переноса удаляет и его расход или снятие — нужны те же права, что
 * на их создание (сервер проверяет так же).
 */
function canDeleteConvert(m: LiabilityMovementView): boolean {
  if (m.kind !== 'CONVERT') return true
  const expense = m.convertKind === 'EXPENSE' || m.convertKind === 'OTHER_EXPENSE'
  return auth.can('finance.capital') && (!expense || auth.can('finance.transactions'))
}

/** Выдачу нельзя удалить, если без неё «выдано» станет меньше возвращённого. */
function deleteBlocked(m: LiabilityMovementView): string | null {
  const c = card.value
  if (!c || m.kind !== 'ISSUE') return null
  if (c.principal - m.amount < c.repaid) {
    return `Уже вернули ${formatCurrency(c.repaid)} — сначала удалите возвраты`
  }
  return null
}

async function removeMovement(m: LiabilityMovementView) {
  const c = card.value
  if (!c) return
  let text: string
  if (m.kind === 'CONVERT') {
    text = `Перенос ${formatCurrency(m.amount)} от ${formatDate(m.date)} удалится вместе с операцией «${CONVERT_KIND_TITLE[m.convertKind ?? ''] ?? 'расход'}» в «Пополнениях и расходах» — останется вернуть ${formatCurrency(c.left + m.amount)}.`
  } else if (m.kind === 'REPAY') {
    text = `Возврат ${formatCurrency(m.amount)} от ${formatDate(m.date)} удалится — останется вернуть ${formatCurrency(c.left + m.amount)}.`
  } else if (issues.value.length === 1) {
    text = `Это единственная выдача — долг ${c.personName} удалится целиком.`
  } else {
    text = `Выдача ${formatCurrency(m.amount)} от ${formatDate(m.date)} удалится — по долгу останется ${formatCurrency(c.principal - m.amount)}.`
  }
  const ok = await confirmDelete({
    title: m.kind === 'CONVERT' ? 'Удалить перенос?' : m.kind === 'REPAY' ? 'Удалить возврат?' : 'Удалить выдачу?',
    text: `${text}\nЗапись останется в истории счёта и в журнале действий.`,
  })
  if (!ok) return
  try {
    const res = await store.deleteLiabilityMovement(c.id, m.id)
    if (res?.deletedLiability) {
      toast.success('Долг удалён')
      emit('changed')
      close()
      return
    }
    toast.success(m.kind === 'CONVERT' ? 'Перенос удалён' : m.kind === 'REPAY' ? 'Возврат удалён' : 'Выдача удалена')
    await afterChange()
  } catch (e: any) {
    toast.error(e, 'Не удалось удалить')
  }
}
</script>

<template>
  <v-dialog :model-value="!!liabilityId" max-width="620" scrollable @update:model-value="close">
    <v-card rounded="lg" class="lc-dialog">
      <div v-if="loading && !card" class="lc-loading">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <template v-else-if="card">
        <!-- Шапка: кто, касса, состояние -->
        <div class="lc-head">
          <div class="lc-head-main">
            <div class="lc-kicker">
              {{ borrowed ? 'Взяли в долг · должны вернуть мы' : 'Дали в долг · должны вернуть нам' }}
            </div>
            <!-- Название — главным, человек — ниже; без названия — человек. -->
            <div class="lc-title">{{ card.title || card.personName }}</div>
            <div class="lc-meta">
              <span v-if="card.title">{{ card.personName }}</span>
              <span v-if="card.cashBox">Касса «{{ card.cashBox.name }}»</span>
              <span v-if="card.dueDate">вернуть до {{ formatDate(card.dueDate) }}</span>
              <span v-if="card.note" class="lc-note">{{ card.note }}</span>
            </div>
          </div>
          <!-- Изменить (название, с кем, срок, комментарий) — значком в шапке. -->
          <button v-if="canEdit" class="lc-x" title="Изменить" @click="editInfo = card">
            <v-icon icon="mdi-pencil-outline" size="19" />
          </button>
          <button class="lc-x" title="Закрыть" @click="close"><v-icon icon="mdi-close" size="20" /></button>
        </div>

        <div class="lc-body">
          <div class="lc-sums">
            <div>
              <div class="lc-sum-label">{{ borrowed ? 'Взяли' : 'Дали' }}</div>
              <div class="lc-sum">{{ formatCurrency(card.principal) }}</div>
            </div>
            <div>
              <div class="lc-sum-label">{{ converted > 0 ? 'Вернули деньгами' : 'Вернули' }}</div>
              <div class="lc-sum">{{ formatCurrency(card.repaidCash ?? card.repaid) }}</div>
            </div>
            <div v-if="converted > 0">
              <div class="lc-sum-label">Перенесено</div>
              <div class="lc-sum">{{ formatCurrency(converted) }}</div>
            </div>
            <div>
              <div class="lc-sum-label">Осталось</div>
              <div class="lc-sum" :class="{ 'lc-sum--open': card.left > 0 }">{{ formatCurrency(card.left) }}</div>
            </div>
          </div>
          <div class="lc-progress"><div class="lc-progress-fill" :style="{ width: pct + '%' }" /></div>
          <div class="lc-state">
            <span v-if="card.status === 'CLOSED'" class="lc-badge lc-badge--done">возвращено полностью</span>
            <span v-else-if="card.overdue" class="lc-badge lc-badge--bad">срок возврата прошёл</span>
          </div>

          <div class="lc-actions">
            <button v-if="canMove && card.left > 0" class="lc-btn lc-btn--main" @click="openMovement('repay')">
              <v-icon icon="mdi-keyboard-return" size="16" />
              {{ borrowed ? 'Вернуть' : 'Принять возврат' }}
            </button>
            <!-- Часть долга «дали» партнёр забирает себе — расходом или снятием. -->
            <button v-if="canMove && !borrowed && card.left > 0" class="lc-btn" @click="showConvert = true">
              <v-icon icon="mdi-arrow-right-bold-box-outline" size="16" />
              Перенести в основные
            </button>
            <button v-if="canMove" class="lc-btn" @click="openMovement('issue')">
              <v-icon icon="mdi-plus" size="16" />
              {{ borrowed ? 'Взять ещё' : 'Дать ещё' }}
            </button>
          </div>

          <!-- История: каждая выдача и каждый возврат; действия — последней колонкой -->
          <div class="lc-hist-head">История</div>
          <div class="lc-hist">
            <div v-for="m in card.movements" :key="m.id" class="lc-row">
              <div class="lc-row-date" :title="formatDate(m.date)">{{ formatDateShortYear(m.date) }}</div>
              <div class="lc-row-main">
                <div class="lc-row-title">
                  {{ movementTitle(m) }}
                  <v-icon v-if="m.locked" icon="mdi-lock-outline" size="13" class="lc-lock" title="Месяц кассы закрыт — строку не изменить" />
                </div>
                <div class="lc-row-sub">
                  <span v-if="m.kind === 'CONVERT'">{{ CONVERT_KIND_TITLE[m.convertKind ?? ''] ?? 'расход' }} · </span>
                  <span v-if="m.account">{{ m.account.name }}</span>
                  <span v-else>счёт не указан</span>
                  <span v-if="m.note"> · {{ m.note }}</span>
                  <span v-if="m.actorName"> · {{ m.actorName }}</span>
                </div>
              </div>
              <!-- Перенос деньгами не двигался — сумма без знака и цвета. -->
              <div v-if="m.kind === 'CONVERT'" class="lc-row-sum lc-neutral">{{ formatCurrency(m.amount) }}</div>
              <div v-else class="lc-row-sum" :class="movementIn(m) ? 'lc-in' : 'lc-out'">
                {{ movementIn(m) ? '+' : '−' }}{{ formatCurrency(m.amount) }}
              </div>
              <div class="lc-row-act">
                <div v-if="canEdit && !m.locked && canDeleteConvert(m)" class="row-actions">
                  <!-- Перенос не правится — только удалить и перенести заново. -->
                  <button v-if="m.kind !== 'CONVERT'" class="row-action-btn" title="Изменить" @click="openMovement('edit', m)">
                    <v-icon icon="mdi-pencil-outline" size="16" />
                  </button>
                  <button
                    class="row-action-btn row-action-btn--delete"
                    :title="deleteBlocked(m) ?? 'Удалить'"
                    :disabled="!!deleteBlocked(m)"
                    @click="removeMovement(m)"
                  >
                    <v-icon icon="mdi-trash-can-outline" size="16" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </v-card>

    <LiabilityMovementDialog
      v-model="showMovement"
      :card="card"
      :mode="movementMode"
      :movement="movementRow"
      @done="afterChange"
    />
    <LiabilityEditDialog v-model:liability="editInfo" @done="afterChange" />
    <LiabilityConvertDialog v-model="showConvert" :card="card" @done="afterChange" />
  </v-dialog>
</template>

<style scoped>
.lc-dialog { overflow: hidden; }
.lc-loading { display: flex; justify-content: center; align-items: center; min-height: 220px; }
.lc-head { display: flex; align-items: flex-start; gap: 12px; padding: 20px 22px 0; }
.lc-head-main { flex: 1; min-width: 0; }
.lc-kicker { font-size: 12px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.5); }
.lc-title { font-size: 19px; font-weight: 700; margin-top: 2px; overflow-wrap: anywhere; }
.lc-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); }
.lc-note { color: rgba(var(--v-theme-on-surface), 0.45); }
.lc-x {
  width: 34px; height: 34px; border-radius: 9px; border: none; background: none; cursor: pointer; flex: none;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.lc-x:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
.lc-x + .lc-x { margin-left: -8px; }
.lc-body { padding: 14px 22px 20px; overflow-y: auto; }

.lc-sums { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; }
.lc-sum-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }
.lc-sum { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
.lc-sum--open { color: #b45309; }
.lc-progress { height: 4px; border-radius: 2px; margin-top: 12px; background: rgba(var(--v-theme-on-surface), 0.08); }
.lc-progress-fill { height: 100%; border-radius: 2px; background: #047857; opacity: 0.75; }
.lc-state { margin-top: 8px; min-height: 4px; }
.lc-badge { padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; }
.lc-badge--done { background: rgba(4, 120, 87, 0.1); color: #047857; }
.lc-badge--bad { background: rgba(220, 38, 38, 0.1); color: #dc2626; }

.lc-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.lc-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 38px; padding: 0 14px; border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.lc-btn:hover:not(:disabled) { border-color: rgba(4, 120, 87, 0.4); color: #047857; }
.lc-btn:disabled { opacity: 0.55; cursor: default; }
.lc-btn--main { background: #047857; border-color: #047857; color: #fff; }
.lc-btn--main:hover:not(:disabled) { background: #036b4e; border-color: #036b4e; color: #fff; }

.lc-hist-head {
  margin-top: 18px; padding-bottom: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
  text-transform: uppercase; color: rgba(var(--v-theme-on-surface), 0.42);
}
.lc-row {
  display: grid; grid-template-columns: 92px 1fr auto 72px; align-items: center; gap: 10px;
  padding: 10px 0; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.lc-row-date { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); font-variant-numeric: tabular-nums; }
.lc-row-main { min-width: 0; }
.lc-row-title { font-size: 13.5px; font-weight: 600; display: flex; align-items: center; gap: 5px; }
.lc-lock { color: rgba(var(--v-theme-on-surface), 0.4); }
.lc-row-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-row-sum { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
.lc-in { color: #047857; }
.lc-out { color: #b45309; }
.lc-neutral { color: rgba(var(--v-theme-on-surface), 0.6); }
.lc-row-act { display: flex; justify-content: flex-end; }

@media (max-width: 600px) {
  .lc-head { padding: 16px 16px 0; }
  .lc-body { padding: 12px 16px 18px; }
  .lc-sum { font-size: 15px; }
  .lc-actions .lc-btn { flex: 1 1 auto; }
  .lc-row { grid-template-columns: 1fr auto; row-gap: 2px; }
  .lc-row-date { grid-column: 1; }
  .lc-row-sum { grid-column: 2; grid-row: 1 / span 2; }
  .lc-row-main { grid-column: 1; }
  .lc-row-act { grid-column: 1 / -1; justify-content: flex-start; }
  .lc-row-act:empty { display: none; }
}
</style>
