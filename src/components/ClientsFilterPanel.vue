<script setup lang="ts">
/**
 * Панель фильтров раздела «Клиенты».
 *
 * Та же панель, что в остальных списках (общее оформление —
 * `styles/filter-panel.css`). Условия здесь про состояние договоров человека:
 * есть ли просрочка, остались ли действующие, из реестра ли он.
 */
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useClientCities } from '@/composables/useClientCities'
import { api } from '@/api/client'
import type { ClientsFilterState } from '@/composables/useClientsFilters'

const props = defineProps<{
  modelValue: boolean
  state: ClientsFilterState
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
    state: (s.hasOverdue ? 1 : 0) + (s.hasActive ? 1 : 0) + (s.noActive ? 1 : 0) + (s.withProfile ? 1 : 0),
    product: (s.product.trim() ? 1 : 0) + (s.cities.length ? 1 : 0),
  }
})

function clearSection(name: string) {
  const s = props.state
  if (name === 'state') {
    s.hasOverdue = false
    s.hasActive = false
    s.noActive = false
    s.withProfile = false
  }
  if (name === 'product') { s.product = ''; s.cities = [] }
}

function toggle(list: string[], value: string) {
  const i = list.indexOf(value)
  if (i >= 0) list.splice(i, 1)
  else list.push(value)
}

/** «Есть действующие» и «нет действующих» исключают друг друга. */
function toggleActive(key: 'hasActive' | 'noActive') {
  const s = props.state
  const next = !s[key]
  s.hasActive = false
  s.noActive = false
  s[key] = next
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

        <!-- Состояние договоров -->
        <section class="fp-section" :class="{ 'fp-section--on': counts.state }">
          <div class="fp-section-head">
            <v-icon icon="mdi-account-check-outline" size="15" class="fp-section-icon" />
            <span class="fp-section-title">Состояние договоров</span>
            <span v-if="counts.state" class="fp-section-count">{{ counts.state }}</span>
            <button v-if="counts.state" type="button" class="fp-section-clear" @click="clearSection('state')">
              Сбросить
            </button>
          </div>
          <div class="fp-chips">
            <button
              type="button"
              class="fp-chip"
              :class="{ 'fp-chip--on': state.hasOverdue }"
              @click="state.hasOverdue = !state.hasOverdue"
            >С просрочкой</button>
            <button
              type="button"
              class="fp-chip"
              :class="{ 'fp-chip--on': state.hasActive }"
              @click="toggleActive('hasActive')"
            >Есть действующие</button>
            <button
              type="button"
              class="fp-chip"
              :class="{ 'fp-chip--on': state.noActive }"
              @click="toggleActive('noActive')"
            >Всё погашено</button>
            <!-- У сделок из импорта профиля может не быть: человек есть, а
                 карточки в реестре нет. -->
            <button
              type="button"
              class="fp-chip"
              :class="{ 'fp-chip--on': state.withProfile }"
              @click="state.withProfile = !state.withProfile"
            >Только из реестра</button>
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
          <input v-model="state.product" class="fp-input" placeholder="Название товара" list="cf-product-list" />
          <datalist id="cf-product-list">
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
