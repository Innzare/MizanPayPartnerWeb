<script setup lang="ts">
/**
 * Форма одной денежной операции. Вид приходит из меню, поэтому окно сразу
 * показывает нужные поля: у внесения и у займа они разные.
 *
 * Записи по-прежнему делают те же сервисы, что работали на прежних экранах, —
 * цифры считаются тем же кодом.
 *
 * Назначение операции выбирается до окна, и это принципиально: «снял и
 * положил в сейф» и «снял и потратил на себя» выглядят одинаково, но первое
 * капитал не меняет, а второе уменьшает.
 */
import { computed, ref, watch } from 'vue'
import AccountSelect from '@/components/AccountSelect.vue'
import SelectField from '@/components/SelectField.vue'
import DateField from '@/components/DateField.vue'
import { api } from '@/api/client'
import { useOperationDate } from '@/composables/useOperationDate'
import { isAccountNegative, useAccountingStore, type AccountView } from '@/stores/accounting'
import { useCashBoxesStore } from '@/stores/cashboxes'
import { useSections } from '@/composables/useSections'
import { todayIso } from '@/utils/dateInput'
import { useToast } from '@/composables/useToast'
import { CURRENCY_MASK, parseMasked, formatCurrency } from '@/utils/formatters'
import { OPERATION_KINDS, type OperationKind } from '@/constants/operationKinds'

const props = defineProps<{
  modelValue: boolean
  /**
   * Какая операция. Приходит из меню — форма сразу открывается нужной, без
   * промежуточного шага «выберите вид»: человек уже выбрал его в меню.
   */
  kind: OperationKind
  /** Счёт, с которого открыли форму. */
  accountId?: string | null
  /** Касса, из которой открыли форму (раздел «Пополнения и расходы» по кассе). */
  cashBoxId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'done'): void
}>()

const store = useAccountingStore()
const cashboxes = useCashBoxesStore()
const sections = useSections()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const kind = computed(() => props.kind)
const amount = ref<number | null>(null)
const accountId = ref<string | null>(null)
const toAccountId = ref<string | null>(null)
const cashBoxId = ref<string | null>(null)
const categoryId = ref<string | null>(null)
const note = ref('')
const personName = ref('')
const date = ref('')
const saving = ref(false)
/** Ключ защиты от двойной отправки — живёт одно открытие формы. */
const idemKey = ref('')
const opDate = useOperationDate()

// ── Статьи дохода и расхода ──
interface Category { id: string; name: string; type: 'INCOME' | 'EXPENSE'; color?: string | null }
const categories = ref<Category[]>([])
const newCategory = ref<string | null>(null)
const creatingCategory = ref(false)
async function loadCategories() {
  try {
    categories.value = await api.get<Category[]>('/finance/categories')
  } catch {
    categories.value = []
  }
}
const categoryOptions = computed(() => {
  const type = kind.value === 'INCOME' ? 'INCOME' : 'EXPENSE'
  return categories.value
    .filter((c) => c.type === type)
    .map((c) => ({ value: c.id, label: c.name, color: c.color ?? undefined }))
})
async function addCategory() {
  const name = (newCategory.value ?? '').trim()
  if (!name) return
  creatingCategory.value = true
  try {
    const created = await api.post<Category>('/finance/categories', {
      name,
      type: kind.value === 'INCOME' ? 'INCOME' : 'EXPENSE',
    })
    categories.value.push(created)
    categoryId.value = created.id
    newCategory.value = null
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось добавить статью')
  } finally {
    creatingCategory.value = false
  }
}

// ── Капитал кассы: сколько вложено и сколько можно снять ──
// Те же цифры, что были в окне «Капитал» карточки кассы: без них снятие
// делали бы вслепую — непонятно, уменьшится ли капитал или уйдёт только доход.
interface CapitalInfo {
  investedCapital: number
  withdrawableProfit: number
  availableCapital: number
  /** «Доступно сейчас» с «Баланса»: деньги кассы за вычетом занятых. */
  available: number
  canWithdrawNow: number
  inGoods: number
  lockedAmount: number
  pendingCIPayout: number
}
const capital = ref<CapitalInfo | null>(null)
const isWithdraw = computed(() => kind.value === 'WITHDRAW_OWNER' || kind.value === 'WITHDRAW_PROFIT')
const isProfit = computed(() => kind.value === 'WITHDRAW_PROFIT')
const isCapital = computed(() => kind.value === 'DEPOSIT' || isWithdraw.value)
async function loadCapital() {
  capital.value = null
  if (!isCapital.value || !cashBoxId.value) return
  const box = cashBoxId.value
  try {
    // Те же цифры, что в карточке кассы, одним запросом — и для тех, кто ведёт
    // капитал без права смотреть карточку кассы.
    const res = await store.fetchProfit(box)
    if (cashBoxId.value !== box) return
    const row = res.cashBoxes[0]
    capital.value = row
      ? {
          investedCapital: row.investedCapital,
          withdrawableProfit: row.withdrawableProfit,
          availableCapital: row.availableCapital,
          available: row.available,
          canWithdrawNow: row.canWithdrawNow,
          inGoods: row.inGoods,
          lockedAmount: row.lockedAmount,
          pendingCIPayout: row.pendingCIPayout,
        }
      : null
  } catch {
    // Нет права видеть капитал — операция всё равно проверяется сервером.
    capital.value = null
  }
}
/**
 * Из чего снимается. «Снятие прибыли» — только заработанное. «Снятие
 * капитала» — сначала вложенное, прибыль только если вложенного не хватило.
 * Так же делит сервер; здесь — чтобы человек видел это до «Провести».
 */
const profitPart = computed(() => {
  const a = amount.value ?? 0
  if (isProfit.value) return a
  const fromProfit = Math.max(0, a - Math.max(0, capital.value?.investedCapital ?? 0))
  return Math.min(fromProfit, Math.max(0, capital.value?.withdrawableProfit ?? 0))
})
const capitalPart = computed(() => Math.max(0, (amount.value ?? 0) - profitPart.value))
/** Сколько прибыли можно снять прямо сейчас — та же цифра, что в шапке раздела. */
const profitNow = computed(() => capital.value?.canWithdrawNow ?? 0)
const overProfit = computed(
  () => isProfit.value && !!capital.value && (amount.value ?? 0) > capital.value.withdrawableProfit,
)
/**
 * Предел снятия — «Доступно сейчас», как на «Балансе», а не вся касса: деньги
 * на пунктах приёма или причитающиеся инвесторам на руки не возьмёшь.
 */
const overAvailable = computed(
  () => isWithdraw.value && !!capital.value && (amount.value ?? 0) > Math.max(0, capital.value.available),
)
/** Почему больше снять нельзя — теми же словами, что в шапке раздела. */
const overText = computed(() => {
  const c = capital.value
  if (!c) return ''
  const parts = [`Сейчас доступно только ${formatCurrency(Math.max(0, c.available))}`]
  const why: string[] = []
  if (isProfit.value && c.inGoods > 0) why.push(`${formatCurrency(c.inGoods)} прибыли ещё в товаре`)
  if (isProfit.value && c.lockedAmount > 0) why.push(`${formatCurrency(c.lockedAmount)} заняты (см. «Доступно сейчас» на «Балансе»)`)
  return why.length ? `${parts[0]}: ${why.join(', ')}` : parts[0]
})
const belowReserve = computed(
  () =>
    isWithdraw.value && !!capital.value && capital.value.pendingCIPayout > 0 &&
    capital.value.availableCapital - (amount.value ?? 0) < capital.value.pendingCIPayout,
)
/** Дата — там, где сервер её принимает: доход, расход и перевод. */
const needsDate = computed(() => kind.value === 'EXPENSE' || kind.value === 'INCOME' || kind.value === 'TRANSFER')

// ── Деление с инвесторами ──
// Расход может уменьшать прибыль месяца, которую делят с инвесторам.
const affectsInvestors = ref(false)
const showAffects = computed(() => kind.value === 'EXPENSE' && sections.visible('coInvestors'))
// Расход «из прибыли» (по умолчанию, как всегда было) или «из капитала» —
// тогда он уменьшает ваш капитал в делении; доход — «в прибыль» / «в капитал».
const fromCapital = ref(false)
const showFromCapital = computed(() => (kind.value === 'EXPENSE' || kind.value === 'INCOME') && sections.visible('coInvestors'))
// Пополнение — «приносит прибыль с», снятие капитала — «не приносит прибыль
// с». По умолчанию — сегодня: деньги работают сразу.
const effectiveDay = ref('')
const showEffective = computed(() => (kind.value === 'DEPOSIT' || kind.value === 'WITHDRAW_OWNER') && sections.visible('coInvestors'))
/** Доля партнёра в пуле «по вкладу» до → после на день вступления. */
const sharePrev = ref<{ before: number; after: number } | null>(null)
let shareTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => [showEffective.value, amount.value, effectiveDay.value, cashBoxId.value] as const,
  ([show, a, day, box]) => {
    sharePrev.value = null
    if (shareTimer) clearTimeout(shareTimer)
    if (!show || !box || !(Number(a) > 0)) return
    shareTimer = setTimeout(async () => {
      try {
        // Снятие «на себя» проводится из капитала — превью с тем же источником.
        const q = new URLSearchParams({
          amount: String(a), kind: kind.value === 'DEPOSIT' ? 'in' : 'out',
          ...(kind.value === 'WITHDRAW_OWNER' ? { source: 'capital' } : {}), ...(day ? { day } : {}),
        })
        sharePrev.value = await api.get(`/cashboxes/${box}/capital/share-preview?${q}`)
      } catch { sharePrev.value = null }
    }, 350)
  },
)

const current = computed(() => OPERATION_KINDS.find((k) => k.kind === kind.value) ?? null)
/** Перевод — единственный вид с двумя счетами. */
const needsTarget = computed(() => kind.value === 'TRANSFER')

const usable = computed(() => store.accounts.filter((a) => !a.disabledAt))

/**
 * Счета выбранной кассы: деньги кассы лежат на её счетах, и предлагать чужие
 * нельзя — иначе сумма кассы разойдётся с суммой её счетов.
 *
 * У перевода касса не спрашивается: там как раз перекладывают деньги между
 * сейфами, и оба конца могут принадлежать разным кассам.
 */
const cashBoxOptions = computed(() =>
  cashboxes.items
    .filter((b) => !b.archivedAt)
    .map((b) => ({ value: b.id, label: b.name, hint: b.isDefault ? 'основная' : undefined, color: b.color })),
)

const forCashBox = computed(() =>
  needsTarget.value || !cashBoxId.value
    ? usable.value
    : usable.value.filter((a) => a.cashBoxId === cashBoxId.value),
)
const from = computed<AccountView | null>(() => usable.value.find((a) => a.id === accountId.value) ?? null)

/**
 * Остаток счёта после списания. Уйти в минус можно — как и кассе: расход мог
 * уже случиться, а приход ещё не записан. Но это видно до нажатия, потому что
 * чаще всего это опечатка в сумме или не тот счёт.
 */
const afterFrom = computed(() =>
  current.value?.direction !== 'in' && from.value?.balance != null && (amount.value ?? 0) > 0
    ? from.value.balance - (amount.value ?? 0)
    : null,
)
const goesNegative = computed(() => afterFrom.value !== null && Math.round(afterFrom.value) < 0)

const needsCategory = computed(() => kind.value === 'EXPENSE' || kind.value === 'INCOME')
const isPending = computed(() => kind.value === 'PENDING_IN' || kind.value === 'PENDING_OUT')
const isLoan = computed(() => kind.value === 'BORROW' || kind.value === 'LEND')

const canSave = computed(() => {
  if (!kind.value || (amount.value ?? 0) <= 0 || overAvailable.value || overProfit.value) return false
  // Без имени второй стороны долг через месяц не восстановить по памяти.
  if (isLoan.value && !personName.value.trim()) return false
  if (needsTarget.value) return !!accountId.value && !!toAccountId.value && accountId.value !== toAccountId.value
  return true
})

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (!isOpen) return
    amount.value = null
    accountId.value = props.accountId ?? null
    toAccountId.value = null
    categoryId.value = null
    newCategory.value = null
    note.value = ''
    personName.value = ''
    date.value = ''
    affectsInvestors.value = false
    fromCapital.value = false
    effectiveDay.value = kind.value === 'DEPOSIT' || kind.value === 'WITHDRAW_OWNER' ? todayIso() : ''
    idemKey.value = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (!store.accounts.length) await store.fetchAccounts().catch(() => {})
    if (!cashboxes.items.length) await cashboxes.fetchAll().catch(() => {})
    cashBoxId.value =
      (props.cashBoxId && cashboxes.items.some((b) => b.id === props.cashBoxId) ? props.cashBoxId : null) ??
      cashboxes.items.find((b) => b.isDefault)?.id ?? cashboxes.items[0]?.id ?? null
    if (needsCategory.value && !categories.value.length) void loadCategories()
    void loadCapital()
  },
)

// Сменили кассу — цифры капитала другие.
watch(cashBoxId, () => { if (props.modelValue) void loadCapital() })

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    // Деньги без назначения идут в буфер: движение по счёту создаётся сразу,
    // а классификация появится при разборе.
    if (isPending.value) {
      if (!accountId.value) {
        toast.error('Выберите счёт: деньги двигались с конкретного места')
        saving.value = false
        return
      }
      await store.createPending({
        direction: kind.value === 'PENDING_IN' ? 'IN' : 'OUT',
        amount: amount.value!,
        accountId: accountId.value,
        note: note.value.trim() || undefined,
        personName: personName.value.trim() || undefined,
      })
      toast.success('Записано — разберёте позже')
      open.value = false
      emit('done')
      return
    }

    // Долги: деньги двигаются, но собственный капитал не растёт.
    if (isLoan.value) {
      await store.createLiability({
        direction: kind.value === 'BORROW' ? 'BORROWED' : 'LENT',
        personName: personName.value.trim(),
        amount: amount.value!,
        accountId: accountId.value,
        note: note.value.trim() || undefined,
      })
      toast.success(kind.value === 'BORROW' ? 'Долг записан' : 'Записано: дали в долг')
      open.value = false
      emit('done')
      return
    }

    await store.createOperation({
      kind: kind.value as 'DEPOSIT' | 'WITHDRAW_OWNER' | 'WITHDRAW_PROFIT' | 'EXPENSE' | 'INCOME' | 'TRANSFER',
      amount: amount.value!,
      accountId: accountId.value,
      toAccountId: needsTarget.value ? toAccountId.value : null,
      cashBoxId: needsTarget.value ? null : cashBoxId.value,
      categoryId: needsCategory.value ? categoryId.value : null,
      date: needsDate.value && date.value ? date.value : undefined,
      note: note.value.trim() || undefined,
      ...(isCapital.value ? { idemKey: idemKey.value } : {}),
      ...(showEffective.value && effectiveDay.value ? { effectiveFrom: effectiveDay.value } : {}),
      ...(showAffects.value ? { affectsInvestors: affectsInvestors.value } : {}),
      ...(showFromCapital.value ? { fromCapital: fromCapital.value } : {}),
    })
    toast.success(isProfit.value ? 'Прибыль снята' : 'Операция проведена')
    open.value = false
    emit('done')
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось провести операцию')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="500" scrollable>
    <v-card rounded="lg" class="op-card">
      <div class="op-head">
        <div class="op-title">{{ current?.title ?? 'Операция' }}</div>
        <div class="op-sub">{{ current?.hint }}</div>
      </div>

      <div class="op-body">
        <template v-if="current">
          <div class="op-field">
            <label class="op-label">Сумма</label>
            <div class="op-suffix-wrap">
              <input
                :value="amount || ''"
                v-maska="CURRENCY_MASK"
                type="text"
                inputmode="numeric"
                class="op-input"
                :class="{ 'op-input--bad': goesNegative || overProfit || overAvailable }"
                @maska="(e: any) => amount = parseMasked(e)"
              />
              <span class="op-suffix">₽</span>
            </div>
            <div v-if="overProfit" class="op-error">
              Заработано и не снято только {{ formatCurrency(capital!.withdrawableProfit) }}
            </div>
            <div v-else-if="overAvailable" class="op-error">
              {{ overText }}
            </div>
            <!-- Не запрет, а предупреждение: показываем и вместе с ошибками кассы. -->
            <div v-if="goesNegative" class="op-error">
              <v-icon icon="mdi-alert-circle" size="14" />
              <template v-if="isAccountNegative(from)">
                Счёт «{{ from!.name }}» уже в минусе ({{ formatCurrency(from!.balance!) }}) — станет {{ formatCurrency(afterFrom!) }}
              </template>
              <template v-else>
                На счёте «{{ from!.name }}» {{ formatCurrency(from!.balance!) }} — счёт уйдёт в минус на {{ formatCurrency(-afterFrom!) }}
              </template>
            </div>
            <button
              v-if="isProfit && capital && profitNow > 0"
              type="button"
              class="op-max"
              @click="amount = profitNow"
            >Снять всю доступную прибыль ({{ formatCurrency(profitNow) }})</button>
            <button
              v-else-if="kind === 'WITHDRAW_OWNER' && capital && Math.min(capital.investedCapital, capital.available) > 0"
              type="button"
              class="op-max"
              @click="amount = Math.min(capital.investedCapital, capital.available)"
            >Снять весь вложенный капитал ({{ formatCurrency(Math.min(capital.investedCapital, capital.available)) }})</button>
          </div>

          <!-- Капитал кассы: сколько вложено, сколько заработано и сколько денег
               в кассе сейчас. Без них снятие делали бы вслепую. -->
          <div v-if="isCapital && capital" class="op-cap">
            <div class="op-cap-item" :class="{ 'op-cap-item--main': isProfit }">
              <span>{{ isProfit ? 'Можно снять сейчас' : 'Прибыль к снятию' }}</span>
              <strong>{{ formatCurrency(isProfit ? capital.canWithdrawNow : capital.withdrawableProfit) }}</strong>
            </div>
            <div class="op-cap-item" :class="{ 'op-cap-item--main': !isProfit && (kind === 'WITHDRAW_OWNER' || kind === 'DEPOSIT') }">
              <span>{{ isProfit ? 'Заработано и не снято' : 'Вложено' }}</span>
              <strong>{{ formatCurrency(isProfit ? capital.withdrawableProfit : capital.investedCapital) }}</strong>
            </div>
            <div class="op-cap-item">
              <span>Доступно сейчас</span><strong>{{ formatCurrency(capital.available) }}</strong>
            </div>
          </div>

          <!-- Касса стоит выше счёта: она отвечает, чьи это деньги, и от неё
               зависит, из каких счетов вообще можно выбирать. -->
          <div v-if="!needsTarget && cashBoxOptions.length > 1" class="op-field">
            <label class="op-label">{{ isCapital ? 'Касса' : 'Чьи деньги' }}</label>
            <SelectField v-model="cashBoxId" :options="cashBoxOptions" />
          </div>

          <div class="op-field">
            <label class="op-label">{{ needsTarget ? 'Откуда' : current?.direction === 'in' ? 'На какой счёт' : 'С какого счёта' }}</label>
            <AccountSelect
              v-model="accountId"
              :items="forCashBox"
              :exclude-id="needsTarget ? toAccountId : null"
              empty-label="Определить автоматически"
            />
          </div>

          <div v-if="needsTarget" class="op-field">
            <label class="op-label">Куда</label>
            <AccountSelect
              v-model="toAccountId"
              :items="usable"
              :exclude-id="accountId"
            />
          </div>

          <div v-if="kind === 'PENDING_OUT' || isLoan" class="op-field">
            <label class="op-label">
              {{ isLoan ? (kind === 'BORROW' ? 'Чьи деньги' : 'У кого деньги') : 'За кем числятся деньги' }}
            </label>
            <input v-model="personName" class="op-input" placeholder="Например: Ахмед (брат)" />
            <div class="op-hint">Через месяц по памяти это уже не восстановить</div>
          </div>

          <div v-if="needsCategory" class="op-field">
            <label class="op-label">Статья</label>
            <SelectField
              v-model="categoryId"
              :options="categoryOptions"
              empty-label="Без статьи"
              placeholder="Без статьи"
            />
            <div v-if="newCategory === null" class="op-hint">
              <button type="button" class="op-link" @click="newCategory = ''">+ Новая статья</button>
            </div>
            <div v-else class="op-newcat">
              <input
                v-model="newCategory"
                class="op-input"
                placeholder="Например: Аренда"
                @keydown.enter.prevent="addCategory"
              />
              <button type="button" class="op-newcat-btn" :disabled="creatingCategory || !newCategory?.trim()" @click="addCategory">
                Добавить
              </button>
            </div>
          </div>

          <!-- Капитал партнёра действует в долях со своей даты (по умолчанию — сразу) -->
          <div v-if="showEffective" class="op-field">
            <label class="op-label">{{ kind === 'DEPOSIT' ? 'Приносит прибыль с' : 'Не приносит прибыль с' }}</label>
            <!-- Вклад не работает раньше, чем пришли деньги (сервер отвечает 400) -->
            <DateField v-model="effectiveDay" :min="kind === 'DEPOSIT' ? todayIso() : null" plain />
            <div class="op-hint">
              {{ kind === 'DEPOSIT'
                ? 'С этой даты деньги участвуют в делении прибыли с инвесторами. По умолчанию — сразу.'
                : 'С этой даты снятый капитал не участвует в делении с инвесторами.' }}
            </div>
            <div v-if="sharePrev" class="op-share">
              Ваша доля в пуле «по вкладу»: <b>{{ sharePrev.before }}%</b> → <b>{{ sharePrev.after }}%</b>
            </div>
          </div>

          <!-- Откуда расход / куда доход: из прибыли (как всегда) или из капитала -->
          <div v-if="showFromCapital" class="op-field">
            <label class="op-label">{{ kind === 'INCOME' ? 'Куда идёт доход' : 'Откуда расход' }}</label>
            <div class="op-seg">
              <button type="button" class="op-seg-btn" :class="{ 'op-seg-btn--on': !fromCapital }" @click="fromCapital = false">
                {{ kind === 'INCOME' ? 'В прибыль' : 'Из прибыли' }}
              </button>
              <button type="button" class="op-seg-btn" :class="{ 'op-seg-btn--on': fromCapital }" @click="fromCapital = true">
                {{ kind === 'INCOME' ? 'В капитал' : 'Из капитала' }}
              </button>
            </div>
            <div class="op-hint">
              {{ fromCapital
                ? (kind === 'INCOME'
                  ? 'Увеличит ваш капитал в кассе — ваша доля в делении прибыли с инвесторами вырастет с даты операции.'
                  : 'Уменьшит ваш капитал в кассе — ваша доля в делении прибыли с инвесторами уменьшится с даты операции.')
                : 'Ваш капитал в делении с инвесторами не меняется.' }}
            </div>
          </div>

          <label v-if="showAffects" class="op-check">
            <input v-model="affectsInvestors" type="checkbox" />
            <span>
              <b>Затрагивает инвесторов</b>
              <span class="op-hint">Расход уменьшит прибыль месяца до деления с инвесторами (кроме «комиссии от закупки»). Месяц пересчитается.</span>
            </span>
          </label>

          <div v-if="needsDate" class="op-field">
            <label class="op-label">Дата</label>
            <!-- Пусто — сегодня. Границы — те же, что у оплаты: сотрудник не
                 проведёт расход закрытым месяцем. -->
            <DateField v-model="date" :min="opDate.minDate.value" :max="opDate.maxDate.value" plain />
          </div>

          <div class="op-field">
            <label class="op-label">Комментарий</label>
            <input v-model="note" class="op-input" :placeholder="isWithdraw ? 'Например: на личные нужды' : 'Например: аренда за август'" />
          </div>

          <!-- Что произойдёт с капиталом. Пишем прямо: это то самое место,
               где ошибка в назначении искажает прибыль. -->
          <div class="op-effect" :class="`op-effect--${current?.direction}`">
            <v-icon
              :icon="current?.direction === 'move' ? 'mdi-information-outline' : current?.direction === 'in' ? 'mdi-trending-up' : 'mdi-trending-down'"
              size="16"
            />
            <span v-if="kind === 'TRANSFER'">Капитал не изменится — меняется только место хранения</span>
            <span v-else-if="kind === 'DEPOSIT'">Вложенный капитал вырастет на сумму операции</span>
            <span v-else-if="isProfit">
              Снимается только заработанное — вложенный капитал не тронут
            </span>
            <span v-else-if="kind === 'WITHDRAW_OWNER' && capital && (amount ?? 0) > 0">
              <template v-if="profitPart === 0">Вложенный капитал уменьшится на сумму снятия — прибыль не тронута</template>
              <template v-else>
                Вложенного не хватает: из капитала {{ formatCurrency(capitalPart) }}, из прибыли
                {{ formatCurrency(profitPart) }}
              </template>
            </span>
            <span v-else-if="kind === 'WITHDRAW_OWNER'">Вложенный капитал уменьшится — прибыль не тронута</span>
            <span v-else-if="kind === 'EXPENSE'">Расход уменьшит деньги кассы</span>
            <span v-else-if="kind === 'BORROW'">
              Деньги появятся на счёте, но собственный капитал не вырастет —
              они чужие и в прибыли не участвуют
            </span>
            <span v-else-if="kind === 'LEND'">
              Деньги уйдут со счёта, но это не расход — их вернут
            </span>
            <span v-else-if="isPending">
              Остаток счёта изменится сразу, а на прибыль это пока не влияет —
              до разбора неизвестно, чем операция была
            </span>
            <span v-else>Доход увеличит деньги кассы</span>
          </div>
          <!-- Не запрещаем — только предупреждаем, как прежнее окно кассы. -->
          <div v-if="belowReserve" class="op-effect op-effect--out">
            <v-icon icon="mdi-account-cash-outline" size="16" />
            <span>
              После снятия в кассе останется меньше, чем причитается инвесторам
              ({{ formatCurrency(capital!.pendingCIPayout) }}). Сначала выплатите дивиденды.
            </span>
          </div>
        </template>
      </div>

      <div class="op-actions">
        <button class="op-cancel" @click="open = false">Отмена</button>
        <button class="op-confirm" :class="{ 'op-confirm--warn': goesNegative }" :disabled="!canSave || saving" @click="save">
          {{ saving ? 'Провожу…' : goesNegative ? 'Провести в минус' : 'Провести' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.op-card { display: flex; flex-direction: column; max-height: 88vh; }
.op-head {
  padding: 20px 24px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.op-title { font-size: 17px; font-weight: 700; }
.op-sub { font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 3px; }
.op-body { padding: 16px 24px 8px; overflow-y: auto; flex: 1; }
.op-actions {
  display: flex; gap: 10px; padding: 14px 24px 18px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.op-field { margin-top: 14px; }
.op-label {
  display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.op-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  font-size: 14px; outline: none; color: rgba(var(--v-theme-on-surface), 0.85);
}
.op-input:focus { border-color: #047857; }
.op-input--bad { border-color: #dc2626; }
.op-hint { display: block; font-size: 12px; line-height: 1.4; margin-top: 4px; color: rgba(var(--v-theme-on-surface), 0.55); }
.op-check {
  display: flex; align-items: flex-start; gap: 9px; margin-top: 14px; cursor: pointer;
  padding: 10px 12px; border-radius: 10px; font-size: 13.5px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.op-check input { margin-top: 3px; }
.op-seg { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.05); }
.op-seg-btn {
  flex: 1; padding: 8px 10px; border-radius: 8px; border: none; cursor: pointer;
  font-size: 13.5px; font-weight: 500; background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6); transition: background 0.15s, color 0.15s;
}
.op-seg-btn--on { background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.92); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
.op-share {
  margin-top: 8px; padding: 8px 10px; border-radius: 9px; font-size: 13px;
  background: rgba(79, 70, 229, 0.07); border: 1px solid rgba(79, 70, 229, 0.18);
}
.op-error {
  display: flex; align-items: flex-start; gap: 5px;
  font-size: 12px; line-height: 1.4; color: #dc2626; margin-top: 5px;
}
.op-error .v-icon { margin-top: 1px; flex: none; }
.op-hint {
  font-size: 11.5px; line-height: 1.4; margin-top: 5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.op-suffix-wrap { position: relative; }
.op-suffix-wrap .op-input { padding-right: 34px; }
.op-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600; pointer-events: none;
  color: rgba(var(--v-theme-on-surface), 0.35);
}

.op-effect {
  display: flex; align-items: center; gap: 8px;
  margin-top: 16px; padding: 10px 13px; border-radius: 10px;
  font-size: 12.5px; line-height: 1.4;
}
.op-effect--in { background: rgba(16, 185, 129, 0.1); color: #047857; }
.op-effect--out { background: rgba(245, 158, 11, 0.12); color: #b45309; }
.op-effect--move { background: rgba(var(--v-theme-on-surface), 0.05); color: rgba(var(--v-theme-on-surface), 0.6); }

.op-max {
  margin-top: 6px; padding: 0; border: none; background: none; cursor: pointer;
  font-size: 12.5px; font-weight: 600; color: #047857;
}
.op-cap {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
  margin-top: 12px; padding: 10px 12px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.035);
}
.op-cap-item { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
.op-cap-item strong { font-size: 13.5px; color: rgba(var(--v-theme-on-surface), 0.85); font-variant-numeric: tabular-nums; }
.op-cap-item--main strong { color: #047857; }
.op-link {
  padding: 0; border: none; background: none; cursor: pointer;
  font-size: 12.5px; font-weight: 600; color: #047857;
}
.op-newcat { display: flex; gap: 8px; margin-top: 8px; }
.op-newcat-btn {
  flex: none; padding: 0 14px; border-radius: 10px; border: none; cursor: pointer;
  background: #047857; color: #fff; font-size: 13px; font-weight: 600;
}
.op-newcat-btn:disabled { opacity: 0.5; cursor: default; }

.op-cancel, .op-confirm {
  flex: 1; padding: 11px 16px; border-radius: 10px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.op-cancel {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7); font-weight: 500;
}
.op-confirm { background: #047857; color: #fff; }
.op-confirm--warn { background: #d97706; }
.op-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
