<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

// Yandex Maps JS API грузится глобально из index.html.
declare const ymaps: any

const props = defineProps<{
  address?: string | null
  lat?: number | null
  lng?: number | null
}>()
const emit = defineEmits<{
  (e: 'update:address', v: string): void
  (e: 'update:lat', v: number | null): void
  (e: 'update:lng', v: number | null): void
  (e: 'update:city', v: string): void
}>()

// Центр по умолчанию — Грозный (используется, пока точка не выбрана).
const DEFAULT_CENTER: [number, number] = [43.3169, 45.6981]
// Ограничивающая рамка для подсказок (район Грозного/Чечни), как в Matsal.
const SUGGEST_BOUNDS: [[number, number], [number, number]] = [[43.1, 45.4], [43.5, 46.0]]

const mapId = 'ap-map-' + Math.random().toString(36).slice(2)
const search = ref('')
const suggestions = ref<any[]>([])
const searchLoading = ref(false)
const selectedAddress = ref(props.address ?? '')
const lat = ref<number | null>(props.lat ?? null)
const lng = ref<number | null>(props.lng ?? null)
const available = ref(typeof ymaps !== 'undefined')

let mapInstance: any = null
let placemark: any = null
let searchTimeout: ReturnType<typeof setTimeout> | null = null

function extractCity(geoObject: any): string {
  try {
    const loc = geoObject.getLocalities?.()
    if (loc && loc.length) return loc[0]
    const area = geoObject.getAdministrativeAreas?.()
    if (area && area.length) return area[0]
  } catch { /* ignore */ }
  return ''
}

function commit(geoObject: any | null, coords: [number, number], recenter = false) {
  lat.value = coords[0]
  lng.value = coords[1]
  if (geoObject) {
    selectedAddress.value = geoObject.getAddressLine?.() ?? selectedAddress.value
    const city = extractCity(geoObject)
    if (city) emit('update:city', city)
  }
  emit('update:address', selectedAddress.value)
  emit('update:lat', lat.value)
  emit('update:lng', lng.value)
  // Метка всегда встаёт в новые координаты; центр двигаем только при выборе из поиска,
  // чтобы клик по карте не «прыгал» и не уводил точку клика в центр.
  placemark?.geometry.setCoordinates(coords)
  if (recenter && mapInstance) {
    mapInstance.setCenter(coords, Math.max(mapInstance.getZoom(), 16))
  }
}

function onSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!search.value.trim() || typeof ymaps === 'undefined') { suggestions.value = []; return }
  searchTimeout = setTimeout(() => {
    searchLoading.value = true
    ymaps
      .suggest(search.value, { boundedBy: SUGGEST_BOUNDS })
      .then((items: any[]) => { suggestions.value = items.slice(0, 6) })
      .catch(() => { suggestions.value = [] })
      .finally(() => { searchLoading.value = false })
  }, 350)
}
// Vuetify @input может сработать до обновления v-model — следим за самой ref.
watch(search, onSearchInput)

function selectSuggestion(item: any) {
  search.value = ''
  suggestions.value = []
  if (typeof ymaps === 'undefined') return
  ymaps.geocode(item.value || item.displayName).then((res: any) => {
    const first = res.geoObjects.get(0)
    if (first) commit(first, first.geometry.getCoordinates(), true) // из поиска — центрируем
  })
}

function reverseGeocode(coords: [number, number]) {
  if (typeof ymaps === 'undefined') { commit(null, coords); return }
  ymaps.geocode(coords).then((res: any) => {
    commit(res.geoObjects.get(0) ?? null, coords)
  })
}

function initMap() {
  if (typeof ymaps === 'undefined') { available.value = false; return }
  ymaps.ready(() => {
    const hasPoint = lat.value != null && lng.value != null
    const center: [number, number] = hasPoint ? [lat.value!, lng.value!] : DEFAULT_CENTER
    mapInstance = new ymaps.Map(mapId, { center, zoom: hasPoint ? 16 : 10, controls: ['zoomControl', 'geolocationControl'] })
    placemark = new ymaps.Placemark(center, {}, { preset: 'islands#redDotIcon', draggable: true })
    placemark.events.add('dragend', () => reverseGeocode(placemark.geometry.getCoordinates()))
    mapInstance.geoObjects.add(placemark)
    mapInstance.events.add('click', (e: any) => reverseGeocode(e.get('coords')))
    // Диалог открывается с анимацией — контейнер мог быть 0×0 на момент создания.
    setTimeout(() => mapInstance?.container?.fitToViewport?.(), 350)
  })
}

onMounted(() => nextTick(initMap))
onBeforeUnmount(() => {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (mapInstance) { mapInstance.destroy(); mapInstance = null; placemark = null }
})
</script>

<template>
  <div class="ap">
    <div class="ap-search">
      <v-text-field
        v-model="search"
        variant="outlined" density="comfortable" rounded="lg" hide-details
        placeholder="Начните вводить адрес…"
        prepend-inner-icon="mdi-magnify"
        :loading="searchLoading"
        autocomplete="off"
      />
      <v-list v-if="suggestions.length" class="ap-suggest" density="compact" rounded="lg">
        <v-list-item
          v-for="(item, i) in suggestions" :key="i"
          :title="item.displayName"
          @click="selectSuggestion(item)"
        >
          <template #prepend><v-icon icon="mdi-map-marker-outline" size="18" /></template>
        </v-list-item>
      </v-list>
    </div>

    <div v-if="available" :id="mapId" class="ap-map"></div>
    <div v-else class="ap-nomap">Карта недоступна — введите адрес вручную ниже</div>

    <div v-if="selectedAddress" class="ap-selected">
      <v-icon icon="mdi-map-marker-check-outline" size="16" color="#047857" />
      <span>{{ selectedAddress }}</span>
    </div>
    <div v-else class="ap-hint">Найдите адрес в поиске или отметьте точку на карте</div>
  </div>
</template>

<style scoped>
.ap { position: relative; }
.ap-search { position: relative; margin-bottom: 10px; }
.ap-suggest {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 30; margin-top: 4px;
  max-height: 240px; overflow-y: auto;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  box-shadow: 0 8px 28px rgba(0,0,0,0.18);
}
.ap-map { width: 100%; height: 300px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); }
.ap-nomap { padding: 20px; text-align: center; border: 1px dashed rgba(var(--v-theme-on-surface), 0.2); border-radius: 12px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.55); }
.ap-selected { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.8); }
.ap-hint { margin-top: 8px; font-size: 12.5px; color: rgba(var(--v-theme-on-surface), 0.5); }
</style>
