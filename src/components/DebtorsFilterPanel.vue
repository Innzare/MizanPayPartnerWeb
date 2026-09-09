<script setup lang="ts">
/**
 * Панель фильтров раздела «Должники».
 *
 * Та же панель, что в сделках и платежах (общее оформление —
 * `styles/filter-panel.css`). Состав условий свой: здесь отбирают по глубине
 * просрочки — на сколько дней и на какую сумму.
 */
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useClientCities } from '@/composables/useClientCities'
import ClientPicker from '@/components/ClientPicker.vue'
import { api } from '@/api/client'
import { CURRENCY_MASK, parseMasked } from '@/utils/formatters'
import type { DebtorsFilterState } from '@/composables/useDebtorsFilters'

const props = defineProps<{
  modelValue: boolean
  state: DebtorsFilterState
  activeCount: number
  presets: Array<{ id: string; name: string }>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'reset'): void
  (e: 'save-preset', name: string): void
  (e: 'apply-preset', id: string): void
  (e: 'remove-preset', id: string): void
}>()

const auth = useAuthStore()
const { cities, fetchCities } = useClientCities()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const canViewClients = computed(() => auth.can('clients.view'))
const cityOptions = computed(() => cities.value.map((c: any) => c.city ?? c))

const presetName = ref('')
const productOptions = ref<string[]>([])
const loaded = ref(false)

watch(open, (v) => {
  if (!v || loaded.value) return
  loaded.value = true
  if (canViewClients.value) void fetchCities()
  api.get<string[]>('/deals/products').then((r) => { productOptions.value = r }).catch(() => {})
})

const counts = computed(() => {
  const s = props.state
  return {
    overdue: s.overdueFrom != null || s.overdueTo != null ? 1 : 0,
    days: s.daysFrom != null || s.daysTo != null ? 1 : 0,
    remaining: s.remainingFrom != null || s.remainingTo != null ? 1 : 0,
    product: (s.product.trim() ? 1 : 0) + (s.cities.length ? 1 : 0),
    client: s.clientKey ? 1 : 0,
  }
})

function clearSection(name: string) {
  const s = props.state
  if (name === 'overdue') { s.overdueFrom = null; s.overdueTo = null }
  if (name === 'days') { s.daysFrom = null; s.daysTo = null }
  if (name === 'remaining') { s.remainingFrom = null; s.remainingTo = null }
  if (name === 'product') { s.product = ''; s.cities = [] }
  if (name === 'client') s.clientKey = ''
}

function toggle(list: string[], value: string) {
  const i = list.indexOf(value)
  if (i >= 0) list.splice(i, 1)
  else list.push(value)
}

function setNum(key: keyof DebtorsFilterState, raw: unknown) {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/\D/g, ''))
  ;(props.state as any)[key] = Number.isFinite(n) && String(raw ?? '') !== '' ? n : null
}

const clientPickerId = computed(() => {
  const k = props.state.clientKey
  return k.startsWith('cp:') ? k.slice(3) : null
})

function onClientPicked(id: string | null) {
  props.state.clientKey = id ? `cp:${id}` : ''
}

function savePreset() {
  const name = presetName.value.trim()
  if (!name) return
  emit('save-preset', name)
  presetName.value = ''
}

function removePreset(p: { id: string; name: string }) {
  if (!confirm(`Удалить набор «${p.name}»?`)) return
  emit('remove-preset', p.id)
}
</script>

<template>
  <v-dialog
    v-model="open"
    transition="dialog-right-transition"
    width="380"
    class="fp-dialog"
    scrim="rgba(0,0,0,0.3)"
  >
    <div class="fp-drawer">
      <div class="fp-head">
        <div class="fp-title">
          Фильтры
          <span v-if="activeCount" class="fp-count">{{ activeCount }}</span>
        </div>
        <button class="fp-close" @click="open = false">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="fp-body">
        <!-- Наборы -->
        <section v-if="presets.length || activeCount" class="fp-section">
          <div class="fp-section-head">
            <v-icon icon="mdi-bookmark-multiple-outline" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Наборы</span>
            <v-tooltip location="bottom end" max-width="260">
              <template #activator="{ props: tp }">
                <v-icon v-bind="tp" icon="mdi-information-outline" size="15" class="fp-section-info" />
              </template>
              <span>
                Сохранённый набор — выбранные сейчас фильтры под своим названием.
                Наборы хранятся в этом браузере.
              </span>
            </v-tooltip>
          </div>
          <div v-if="presets.length" class="fp-presets">
            <span v-for="p in presets" :key="p.id" class="fp-saved">
              <button type="button" class="fp-saved-apply" @click="emit('apply-preset', p.id)">
                {{ p.name }}
              </button>
              <button type="button" class="fp-saved-del" title="Удалить набор" @click="removePreset(p)">
                <v-icon icon="mdi-close" size="12" />
              </button>
            </span>
          </div>
          <div v-if="activeCount" class="fp-row">
            <input v-model="presetName" class="fp-input" placeholder="Название набора" @keyup.enter="savePreset" />
            <button class="fp-preset" :disabled="!presetName.trim()" @click="savePreset">Сохранить</button>
          </div>
        </section>

        <!-- Сумма просрочки -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.overdue }">
          <div class="fp-section-head">
            <v-icon icon="mdi-cash-remove" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Сумма просрочки</span>
            <span v-if="counts.overdue" class="fp-section-count">1</span>
            <button v-if="counts.overdue" type="button" class="fp-section-clear" @click="clearSection('overdue')">
              Сбросить
            </button>
          </div>
          <div class="fp-row">
            <input :value="state.overdueFrom ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="от"
              @maska="(e: any) => setNum('overdueFrom', parseMasked(e))" />
            <input :value="state.overdueTo ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="до"
              @maska="(e: any) => setNum('overdueTo', parseMasked(e))" />
          </div>
        </section>

        <!-- Дней просрочки -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.days }">
          <div class="fp-section-head">
            <v-icon icon="mdi-calendar-alert" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Дней просрочки</span>
            <span v-if="counts.days" class="fp-section-count">1</span>
            <button v-if="counts.days" type="button" class="fp-section-clear" @click="clearSection('days')">
              Сбросить
            </button>
          </div>
          <!-- Порог «с какого дня считать должником» задан в настройках раздела;
               здесь — точечный отбор внутри уже отобранных. -->
          <div class="fp-row">
            <input :value="state.daysFrom ?? ''" type="number" min="0" class="fp-input" placeholder="от"
              @input="(e: any) => setNum('daysFrom', e.target.value)" />
            <input :value="state.daysTo ?? ''" type="number" min="0" class="fp-input" placeholder="до"
              @input="(e: any) => setNum('daysTo', e.target.value)" />
          </div>
        </section>

        <!-- Остаток долга -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.remaining }">
          <div class="fp-section-head">
            <v-icon icon="mdi-numeric" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Остаток долга</span>
            <span v-if="counts.remaining" class="fp-section-count">1</span>
            <button v-if="counts.remaining" type="button" class="fp-section-clear" @click="clearSection('remaining')">
              Сбросить
            </button>
          </div>
          <div class="fp-row">
            <input :value="state.remainingFrom ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="от"
              @maska="(e: any) => setNum('remainingFrom', parseMasked(e))" />
            <input :value="state.remainingTo ?? ''" v-maska="CURRENCY_MASK" class="fp-input" placeholder="до"
              @maska="(e: any) => setNum('remainingTo', parseMasked(e))" />
          </div>
        </section>

        <!-- Товар и город -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.product }">
          <div class="fp-section-head">
            <v-icon icon="mdi-package-variant-closed" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Товар и город</span>
            <span v-if="counts.product" class="fp-section-count">{{ counts.product }}</span>
            <button v-if="counts.product" type="button" class="fp-section-clear" @click="clearSection('product')">
              Сбросить
            </button>
          </div>
          <input v-model="state.product" class="fp-input" placeholder="Название товара" list="df-product-list" />
          <datalist id="df-product-list">
            <option v-for="p in productOptions" :key="p" :value="p" />
          </datalist>
          <div v-if="canViewClients && cityOptions.length" class="fp-chips fp-cities">
            <button
              v-for="c in cityOptions"
              :key="c"
              type="button"
              class="fp-chip"
              :class="{ 'fp-chip--on': state.cities.includes(c) }"
              @click="toggle(state.cities, c)"
            >{{ c }}</button>
          </div>
        </section>

        <!-- Клиент -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.client }">
          <div class="fp-section-head">
            <v-icon icon="mdi-account-outline" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Клиент</span>
            <span v-if="counts.client" class="fp-section-count">1</span>
            <button v-if="counts.client" type="button" class="fp-section-clear" @click="clearSection('client')">
              Сбросить
            </button>
          </div>
          <ClientPicker
            :model-value="clientPickerId"
            label="Выбрать клиента"
            @update:model-value="onClientPicked"
          />
        </section>
      </div>

      <div class="fp-actions">
        <button class="fp-reset" :disabled="!activeCount" @click="emit('reset')">Сбросить всё</button>
        <button class="fp-apply" @click="open = false">Готово</button>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
/* Оформление панели — в общем файле styles/filter-panel.css. */
</style>
