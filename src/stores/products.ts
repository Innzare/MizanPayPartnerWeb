import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Product } from '@/types'
import { MOCK_PRODUCTS } from '@/constants/mock/products'

export const useProductsStore = defineStore('products', () => {
  const products = ref<Product[]>([...MOCK_PRODUCTS])
  const isLoading = ref(false)

  const investorProducts = computed(() =>
    products.value.filter((p) => p.investorId === 'investor-1')
  )

  const availableProducts = computed(() =>
    investorProducts.value.filter((p) => p.isAvailable)
  )

  const hiddenProducts = computed(() =>
    investorProducts.value.filter((p) => !p.isAvailable)
  )

  function getProduct(id: string) {
    return products.value.find((p) => p.id === id)
  }

  function toggleAvailability(id: string) {
    const product = products.value.find((p) => p.id === id)
    if (product) {
      product.isAvailable = !product.isAvailable
    }
  }

  function updateProduct(id: string, updates: Partial<Product>) {
    const product = products.value.find((p) => p.id === id)
    if (product) {
      Object.assign(product, updates)
    }
  }

  function createProduct(data: Omit<Product, 'id' | 'createdAt'>) {
    const newProduct: Product = {
      ...data,
      id: 'prod-' + Date.now(),
      createdAt: new Date().toISOString(),
    }
    products.value.unshift(newProduct)
    return newProduct
  }

  return {
    products, isLoading, investorProducts, availableProducts, hiddenProducts,
    getProduct, toggleAvailability, updateProduct, createProduct,
  }
})
