<script setup lang="ts">
/**
 * Перевод денег между своими счетами — инкассация.
 *
 * Собрали наличные и внесли на карту: денег не стало больше или меньше,
 * изменилось место хранения. Поэтому здесь нет ни категории расхода, ни
 * выбора кассы — только откуда, куда и сколько.
 */
import { computed, ref, watch } from 'vue'
import AccountSelect from '@/components/AccountSelect.vue'
import BankLogo from '@/components/BankLogo.vue'
import { useAccountingStore, type AccountView } from '@/stores/accounting'
import { useToast } from '@/composables/useToast'
import { CURRENCY_MASK, parseMasked, formatCurrency } from '@/utils/formatters'

const props = defineProps<{
  modelValue: boolean
  /** Счёт, с которого открыли окно. */
  fromAccountId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'done'): void
}>()

const store = useAccountingStore()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const fromId = ref<string | null>(null)
const toId = ref<string | null>(null)
const amount = ref<number | null>(null)
const note = ref('')
const saving = ref(false)

const usable = computed(() => store.accounts.filter((a) => !a.disabledAt))
const from = computed<AccountView | null>(() => usable.value.find((a) => a.id === fromId.value) ?? null)

/**
 * Куда можно перевести: только счета той же кассы.
 *
 * Перевод меняет место хранения денег, а не их владельца. Между кассами
 * деньги уехали бы, а капитал касс остался прежним — и сумма счетов каждой
 * перестала бы сходиться с её деньгами.
 */
const targets = computed(() =>
  from.value ? usable.value.filter((a) => a.cashBoxId === from.value!.cashBoxId) : usable.value,
)
const to = computed<AccountView | null>(() => usable.value.find((a) => a.id === toId.value) ?? null)

/** Сколько останется и сколько станет — видно до подтверждения. */
const afterFrom = computed(() =>
  from.value?.balance != null ? from.value.balance - (amount.value ?? 0) : null,
)
const afterTo = computed(() =>
  to.value?.balance != null ? to.value.balance + (amount.value ?? 0) : null,
)

const notEnough = computed(
  () => from.value?.balance != null && (amount.value ?? 0) > from.value.balance,
)

const canSave = computed(
  () => !!fromId.value && !!toId.value && fromId.value !== toId.value && (amount.value ?? 0) > 0 && !notEnough.value,
)

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (!isOpen) return
    if (!store.accounts.length) await store.fetchAccounts()
    // Открыли из меню, без счёта — начинаем с наличных: чаще всего собирают
    // именно их и вносят на карту.
    fromId.value =
      props.fromAccountId ??
      usable.value.find((a) => a.type === 'CASH')?.id ??
      usable.value[0]?.id ??
      null
    // Куда — первый счёт другого вида: наличные обычно вносят на карту.
    const src = usable.value.find((a) => a.id === fromId.value)
    const same = usable.value.filter((a) => a.cashBoxId === src?.cashBoxId)
    toId.value =
      same.find((a) => a.id !== fromId.value && a.type !== src?.type)?.id ??
      same.find((a) => a.id !== fromId.value)?.id ??
      null
    amount.value = null
    note.value = ''
  },
)

// Сменили счёт-источник — получатель из другой кассы больше не годится.
watch(fromId, () => {
  if (toId.value && !targets.value.some((a) => a.id === toId.value)) {
    toId.value = targets.value.find((a) => a.id !== fromId.value)?.id ?? null
  }
})

/** Поменять местами: частая ошибка — выбрать не ту сторону. */
function swap() {
  const a = fromId.value
  fromId.value = toId.value
  toId.value = a
}

function fillAll() {
  if (from.value?.balance != null) amount.value = from.value.balance
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    await store.transfer({
      fromAccountId: fromId.value!,
      toAccountId: toId.value!,
      amount: amount.value!,
      note: note.value.trim() || undefined,
    })
    toast.success('Перевод записан')
    open.value = false
    emit('done')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось перевести')
  } finally {
    saving.value = false
  }
}

function accentOf(a: AccountView): string {
  return a.bank?.color || a.color || '#047857'
}
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card rounded="lg" class="tr-card">
      <div class="tr-title">Перевод между счетами</div>
      <div class="tr-sub">
        Деньги не приходят и не уходят из бизнеса — меняется только место,
        где они лежат. На капитал и доходы это не влияет.
      </div>

      <!-- Откуда -->
      <div class="tr-field">
        <label class="tr-label">Откуда</label>
        <AccountSelect v-model="fromId" :items="usable" :exclude-id="toId" />
      </div>

      <div class="tr-swap-row">
        <button type="button" class="tr-swap" title="Поменять местами" @click="swap">
          <v-icon icon="mdi-swap-vertical" size="18" />
        </button>
      </div>

      <!-- Куда -->
      <div class="tr-field">
        <label class="tr-label">Куда</label>
        <AccountSelect v-model="toId" :items="targets" :exclude-id="fromId" />
      </div>

      <!-- Сумма -->
      <div class="tr-field">
        <label class="tr-label">Сумма</label>
        <div class="tr-amount-row">
          <div class="tr-suffix-wrap">
            <input
              :value="amount || ''"
              v-maska="CURRENCY_MASK"
              type="text"
              inputmode="numeric"
              class="tr-input"
              :class="{ 'tr-input--bad': notEnough }"
              @maska="(e: any) => amount = parseMasked(e)"
            />
            <span class="tr-suffix">₽</span>
          </div>
          <button v-if="from?.balance" type="button" class="tr-all" @click="fillAll">Всё</button>
        </div>
        <div v-if="notEnough" class="tr-error">
          На счёте только {{ formatCurrency(from!.balance!) }}
        </div>
      </div>

      <!-- Что станет с остатками -->
      <div v-if="from && to && (amount ?? 0) > 0 && !notEnough" class="tr-preview">
        <!-- Перед подтверждением перевода счета показываются логотипами: так
             ошибку «не та карта» видно до нажатия, а не после. -->
        <div class="tr-preview-side">
          <BankLogo :bank-name="from.bank?.name" :color="accentOf(from)" :fallback="from.code" :size="26" />
          <span class="tr-preview-val">{{ afterFrom !== null ? formatCurrency(afterFrom) : '—' }}</span>
        </div>
        <v-icon icon="mdi-arrow-right" size="16" class="tr-preview-arrow" />
        <div class="tr-preview-side">
          <BankLogo :bank-name="to.bank?.name" :color="accentOf(to)" :fallback="to.code" :size="26" />
          <span class="tr-preview-val">{{ afterTo !== null ? formatCurrency(afterTo) : '—' }}</span>
        </div>
      </div>

      <div class="tr-field">
        <label class="tr-label">Комментарий</label>
        <input v-model="note" class="tr-input" placeholder="Инкассация за неделю" />
      </div>

      <div class="tr-actions">
        <button class="tr-cancel" @click="open = false">Отмена</button>
        <button class="tr-confirm" :disabled="!canSave || saving" @click="save">
          {{ saving ? 'Перевожу…' : 'Перевести' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.tr-card { padding: 22px 24px 18px; }
.tr-title { font-size: 17px; font-weight: 700; }
.tr-sub {
  font-size: 12.5px; line-height: 1.5; margin-top: 5px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.tr-field { margin-top: 16px; }
.tr-label {
  display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.tr-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.tr-input:focus { border-color: #047857; }
.tr-input--bad { border-color: #dc2626; }
.tr-error { font-size: 12px; color: #dc2626; margin-top: 5px; }

.tr-swap-row { display: flex; justify-content: center; margin: 8px 0 -8px; }
.tr-swap {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.5); cursor: pointer;
}
.tr-swap:hover { color: #047857; border-color: rgba(4, 120, 87, 0.4); }

.tr-amount-row { display: flex; gap: 8px; align-items: center; }
.tr-suffix-wrap { position: relative; flex: 1; }
.tr-suffix-wrap .tr-input { padding-right: 34px; }
.tr-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600; pointer-events: none;
  color: rgba(var(--v-theme-on-surface), 0.35);
}
.tr-all {
  padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7); cursor: pointer;
}
.tr-all:hover { background: rgba(var(--v-theme-on-surface), 0.1); }

.tr-preview {
  display: flex; align-items: center; justify-content: center; gap: 16px;
  margin-top: 14px; padding: 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.tr-preview-side { display: flex; align-items: center; gap: 8px; }
.tr-code {
  min-width: 30px; height: 24px; padding: 0 7px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  font-size: 11.5px; font-weight: 800;
}
.tr-preview-val { font-size: 14px; font-weight: 700; }
.tr-preview-arrow { color: rgba(var(--v-theme-on-surface), 0.3); }

.tr-actions { display: flex; gap: 10px; margin-top: 20px; }
.tr-cancel, .tr-confirm {
  flex: 1; padding: 11px 16px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.tr-cancel {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500;
}
.tr-confirm { background: #047857; color: #fff; }
.tr-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
