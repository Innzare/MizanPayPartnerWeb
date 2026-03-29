import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Product } from '@/types'
import { api } from '@/api/client'

export const useProductsStore = defineStore('products', () => {
  const products = ref<Product[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const investorProducts = computed(() => products.value)

  const availableProducts = computed(() =>
    products.value.filter((p) => p.isAvailable)
  )

  const hiddenProducts = computed(() =>
    products.value.filter((p) => !p.isAvailable)
  )

  function getProduct(id: string) {
    return products.value.find((p) => p.id === id)
  }

  async function fetchProducts() {
    isLoading.value = true
    error.value = null
    try {
      products.value = await api.get<Product[]>('/products/my')
    } catch (e: any) {
      error.value = e.message || 'Не удалось загрузить товары'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function fetchProduct(id: string) {
    isLoading.value = true
    error.value = null
    try {
      const product = await api.get<Product>(`/products/${id}`)
      const idx = products.value.findIndex((p) => p.id === id)
      if (idx !== -1) {
        products.value[idx] = product
      } else {
        products.value.push(product)
      }
      return product
    } catch (e: any) {
      error.value = e.message || 'Не удалось загрузить товар'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function toggleAvailability(id: string) {
    const product = products.value.find((p) => p.id === id)
    if (!product) return

    const previousState = product.isAvailable
    product.isAvailable = !product.isAvailable

    try {
      await api.patch<Product>(`/products/${id}/toggle`)
    } catch (e: any) {
      product.isAvailable = previousState
      error.value = e.message || 'Не удалось изменить видимость'
      throw e
    }
  }

  async function updateProduct(id: string, updates: Partial<Product>) {
    const product = products.value.find((p) => p.id === id)
    if (!product) return

    const previousState = { ...product }

    Object.assign(product, updates)

    try {
      const updated = await api.patch<Product>(`/products/${id}`, updates)
      Object.assign(product, updated)
    } catch (e: any) {
      Object.assign(product, previousState)
      error.value = e.message || 'Не удалось обновить товар'
      throw e
    }
  }

  async function createProduct(data: {
    title: string
    description?: string
    category: string
    photos?: string[]
    price: number
    minTermMonths: number
    maxTermMonths: number
    minDownPaymentPercent: number
    city: string
  }) {
    isLoading.value = true
    error.value = null
    try {
      const newProduct = await api.post<Product>('/products', data)
      products.value.unshift(newProduct)
      return newProduct
    } catch (e: any) {
      error.value = e.message || 'Не удалось создать товар'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function deleteProduct(id: string) {
    const idx = products.value.findIndex((p) => p.id === id)
    if (idx === -1) return

    const [removed] = products.value.splice(idx, 1)

    try {
      await api.delete(`/products/${id}`)
    } catch (e: any) {
      if (removed) products.value.splice(idx, 0, removed)
      error.value = e.message || 'Не удалось удалить товар'
      throw e
    }
  }

  return {
    products, isLoading, error, investorProducts, availableProducts, hiddenProducts,
    getProduct, fetchProducts, fetchProduct, toggleAvailability, updateProduct, createProduct, deleteProduct,
  }
})