<script setup lang="ts">
/**
 * Выбор счёта — своим списком, а не системным `select`.
 *
 * Счёт узнают по логотипу банка: сотрудник ищет глазами нужную карту, а не
 * читает «С3 · Карта Сбер». В системном выпадающем списке картинку показать
 * нельзя, поэтому список свой — один на все окна, где выбирают счёт, чтобы
 * перевод, доход и оплата выглядели одинаково.
 */
import { computed } from 'vue'
import { useAnchoredMenu } from '@/composables/useAnchoredMenu'
import BankLogo from '@/components/BankLogo.vue'
import { formatCurrency } from '@/utils/formatters'
import { useAccountingStore, type AccountView } from '@/stores/accounting'

const props = withDefaults(
  defineProps<{
    modelValue: string | null
    items: AccountView[]
    /** Что показать, когда счёт не выбран. */
    placeholder?: string
    /** Этот счёт выбрать нельзя — обычно вторая сторона перевода. */
    excludeId?: string | null
    /** Пункт «не выбирать» с этой подписью: остаётся `null`. */
    emptyLabel?: string | null
    disabled?: boolean
    /**
     * Компактный вид — для строк разделения платежа, где поле стоит в ряд с
     * суммой. Обычный вид повторяет поля форм: 44 px, та же рамка и радиус.
     *
     * Оформление задаётся здесь, а не классом снаружи: стили окон объявлены
     * scoped и до кнопки внутри этого компонента всё равно не дошли бы, а
     * выбор счёта во всех окнах должен выглядеть одинаково.
     */
    compact?: boolean
  }>(),
  { placeholder: 'Выберите счёт', emptyLabel: null },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string | null): void }>()

const { open, anchor: root, menu, pos, flipped, toggle: toggleMenu, close } = useAnchoredMenu()

const current = computed(() => props.items.find((a) => a.id === props.modelValue) ?? null)

function accentOf(a: AccountView): string {
  return a.bank?.color || a.color || '#047857'
}

/**
 * Разделение по видам денег — как в списке счетов на «Балансе».
 *
 * Наличные, карты и магазины-партнёры это разные деньги: в длинном списке без
 * границ сотрудник промахивается мимо нужного вида, особенно когда у карты и
 * сейфа похожие названия.
 */
const GROUPS: Array<{ type: AccountView['type']; title: string; icon: string }> = [
  { type: 'CASH', title: 'Наличные', icon: 'mdi-cash' },
  { type: 'BANK_CARD', title: 'Банки', icon: 'mdi-credit-card-outline' },
  { type: 'PAYMENT_POINT', title: 'Пункты приёма', icon: 'mdi-store-outline' },
]

const groups = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    // Недоступные — в конец своей группы: выбирать их можно, но предлагать
    // первыми незачем. Порядок тот же, что в списке счетов «Баланса», чтобы
    // карты не искали каждый раз на новом месте.
    items: props.items
      .filter((a) => a.type === g.type)
      .slice()
      .sort((x, y) => Number(!!unavailable(x)) - Number(!!unavailable(y))),
  })).filter((g) => g.items.length > 0),
)

/** Пока вид один, заголовок только занимает место. */
const showGroupTitles = computed(() => groups.value.length > 1)

/**
 * Почему система сама не кладёт деньги на этот счёт: отключён или лимит выбран.
 *
 * Выбрать его всё равно можно — банк проводит перевод и после того, как лимит
 * выбран, а отключённая карта остаётся картой, на которую клиент мог перевести.
 * Запрещать это в кабинете значит спорить с реальностью; наше дело — сказать
 * об этом прямо, чтобы деньги записали осознанно.
 *
 * Обороты лежат отдельно от счетов и грузятся не на каждом экране: не
 * загружены — пометки про лимит просто нет, выбор от этого не меняется.
 */
const accounting = useAccountingStore()
function unavailable(a: AccountView): string | null {
  if (a.disabledAt) return 'недоступна'
  return accounting.limits.find((l) => l.id === a.id)?.limits.full ? 'лимит исчерпан' : null
}

function pick(id: string | null) {
  emit('update:modelValue', id)
  close()
}
</script>

<template>
  <div ref="root" class="as">
    <button
      type="button"
      class="as-btn"
      :class="{ 'as-btn--open': open, 'as-btn--compact': compact }"
      :disabled="disabled"
      @click="toggleMenu(disabled)"
    >
      <BankLogo
        v-if="current"
        :bank-name="current.bank?.name"
        :color="accentOf(current)"
        :fallback="current.code"
        :size="24"
      />
      <span class="as-label" :class="{ 'as-label--dim': !current }">
        <template v-if="current">
          {{ current.name }}
          <span v-if="unavailable(current)" class="as-full">{{ unavailable(current) }}</span>
          <span class="as-label-sub">
            {{ current.code }}<template v-if="current.balance !== null"> · {{ formatCurrency(current.balance) }}</template>
          </span>
        </template>
        <template v-else>{{ placeholder }}</template>
      </span>
      <v-icon icon="mdi-chevron-down" size="18" class="as-caret" :class="{ 'as-caret--rot': open }" />
    </button>

    <!-- Список рисуется поверх страницы: внутри окна оплаты он уезжал под
         его нижний край, и до счетов приходилось долистывать. -->
    <Teleport to="body">
      <Transition name="menu-pop">
      <div
        v-if="open"
        ref="menu"
        class="as-menu"
        :class="{ 'menu-pop--up': flipped }"
        :style="{ top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px' }"
      >
        <button
          v-if="emptyLabel"
          type="button"
          class="as-item"
          :class="{ 'as-item--on': modelValue === null }"
          @click="pick(null)"
        >
          <span class="as-item-ico"><v-icon icon="mdi-auto-fix" size="15" /></span>
          <span class="as-item-body">
            <span class="as-item-title">{{ emptyLabel }}</span>
            <span class="as-item-hint">счёт кассы или счёт по умолчанию</span>
          </span>
        </button>

        <template v-for="g in groups" :key="g.type">
          <div v-if="showGroupTitles" class="as-group">
            <v-icon :icon="g.icon" size="13" />
            {{ g.title }}
          </div>
          <button
            v-for="a in g.items"
            :key="a.id"
            type="button"
            class="as-item"
            :class="{ 'as-item--on': a.id === modelValue }"
            :disabled="a.id === excludeId"
            @click="pick(a.id)"
          >
            <BankLogo :bank-name="a.bank?.name" :color="accentOf(a)" :fallback="a.code" :size="26" />
            <span class="as-item-body">
              <span class="as-item-title">
                {{ a.name }}
                <span v-if="unavailable(a)" class="as-full">{{ unavailable(a) }}</span>
              </span>
              <span class="as-item-hint">
                {{ a.code }}<template v-if="a.bank"> · {{ a.bank.name }}</template>
              </span>
            </span>
            <span v-if="a.balance !== null" class="as-item-balance">{{ formatCurrency(a.balance) }}</span>
          </button>
        </template>
      </div>
    </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.as { position: relative; }

.as-btn {
  width: 100%; height: 44px; padding: 0 12px;
  display: flex; align-items: center; gap: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.85);
  text-align: left; cursor: pointer; transition: border-color 0.15s;
}
.as-btn--compact { height: 36px; padding: 0 10px; font-size: 13px; border-radius: 8px; }
.as-btn:disabled { opacity: 0.6; cursor: default; }
.as-btn:hover:not(:disabled) { border-color: rgba(var(--v-theme-on-surface), 0.22); }
.as-btn--open { border-color: #047857; }

.as-label {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.as-label--dim { color: rgba(var(--v-theme-on-surface), 0.45); }
.as-label-sub { color: rgba(var(--v-theme-on-surface), 0.45); font-size: 12px; }
.as-caret { flex: none; color: rgba(var(--v-theme-on-surface), 0.4); transition: transform 0.15s; }
.as-caret--rot { transform: rotate(180deg); }

/* Список поверх формы: раскрытый перечень счетов не должен раздвигать окно —
   иначе кнопки под ним прыгают. */
.as-menu {
  /* Живёт в конце страницы, поэтому позиционируется от окна и должен быть
     выше модалок Vuetify (у них z-index 2400). */
  position: fixed; z-index: 2500;
  max-height: 300px; overflow-y: auto;
  padding: 5px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
}

/* Подзаголовок вида денег: тот же приём, что в списке счетов на «Балансе». */
.as-group {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px 4px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.as-group:first-child { padding-top: 4px; }

/* Высота одинаковая у всех пунктов: у счёта — логотип и две строки, у
   «автоматически» — кружок и подпись, поэтому фиксируем минимум. */
.as-item {
  width: 100%; min-height: 46px;
  display: flex; align-items: center; gap: 9px;
  margin-bottom: 2px;
  padding: 7px 8px; border: none; border-radius: 9px; background: transparent;
  text-align: left; cursor: pointer;
}
.as-item:hover:not(:disabled) { background: rgba(var(--v-theme-on-surface), 0.05); }
.as-item--on { background: rgba(4, 120, 87, 0.08); }
.as-item:disabled { opacity: 0.4; cursor: default; }
.as-item-ico {
  width: 26px; height: 26px; border-radius: 8px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.as-item-body { flex: 1; min-width: 0; }
.as-item-title {
  display: block; font-size: 13.5px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.as-item-hint { display: block; font-size: 11.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
/* Счёт выбрать можно — пометка предупреждает, а не запрещает. */
.as-full {
  display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 5px;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.01em; white-space: nowrap;
  background: rgba(239, 68, 68, 0.13); color: #dc2626;
}
.as-item-balance {
  font-size: 12.5px; font-weight: 600; white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.as-item:last-child { margin-bottom: 0; }
</style>
