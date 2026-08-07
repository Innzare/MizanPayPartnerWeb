<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'
import SupplierDetail from '@/components/SupplierDetail.vue'

const route = useRoute()
const id = computed(() => (route.params as Record<string, string>).id)
</script>

<template>
  <SupplierDetail :key="id" :id="id" />
</template>
