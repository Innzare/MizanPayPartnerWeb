<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

declare const ymaps: any

const props = defineProps<{
  modelValue: boolean
  name?: string
  address?: string | null
  lat?: number | null
  lng?: number | null
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const mapId = 'sup-map-' + Math.random().toString(36).slice(2)
const available = ref(typeof ymaps !== 'undefined')
let mapInstance: any = null

function destroy() {
  if (mapInstance) { mapInstance.destroy(); mapInstance = null }
}

function initMap() {
  if (typeof ymaps === 'undefined' || props.lat == null || props.lng == null) { available.value = false; return }
  available.value = true
  ymaps.ready(() => {
    destroy()
    const coords: [number, number] = [props.lat!, props.lng!]
    mapInstance = new ymaps.Map(mapId, { center: coords, zoom: 16, controls: ['zoomControl', 'fullscreenControl'] })
    const placemark = new ymaps.Placemark(coords, { balloonContent: props.address ?? '' }, { preset: 'islands#redDotIcon' })
    mapInstance.geoObjects.add(placemark)
    setTimeout(() => mapInstance?.container?.fitToViewport?.(), 300)
  })
}

watch(() => props.modelValue, (open) => {
  if (open) nextTick(initMap)
  else destroy()
})

onBeforeUnmount(destroy)
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="640" @update:model-value="emit('update:modelValue', $event)">
    <v-card rounded="lg">
      <v-card-title class="d-flex align-center ga-2 pt-4">
        <v-icon icon="mdi-map-marker" color="primary" />
        <span class="text-truncate">{{ name || 'Адрес партнёра' }}</span>
      </v-card-title>
      <v-card-text>
        <div v-if="address" class="smd-address">{{ address }}</div>
        <div v-if="available" :id="mapId" class="smd-map"></div>
        <div v-else class="smd-nomap">Карта недоступна</div>
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">Закрыть</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.smd-address { font-size: 14px; margin-bottom: 12px; color: rgba(var(--v-theme-on-surface), 0.85); }
.smd-map { width: 100%; height: 380px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); }
.smd-nomap { padding: 40px; text-align: center; color: rgba(var(--v-theme-on-surface), 0.5); }
</style>
