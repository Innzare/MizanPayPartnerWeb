<script lang="ts" setup>
import { useProductsStore } from '@/stores/products'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { getCategoryLabel, CATEGORIES } from '@/constants/categories'
import { useRouter } from 'vue-router'

const productsStore = useProductsStore()
const router = useRouter()

onMounted(() => {
  productsStore.fetchProducts()
})

const tab = ref(0)
const search = ref('')
const categoryFilter = ref<string | null>(null)

const tabFilters = [
  { label: 'Все', key: 'all' },
  { label: 'Активные', key: 'available' },
  { label: 'Скрытые', key: 'hidden' },
]

const displayedProducts = computed(() => {
  let products = tab.value === 0
    ? productsStore.investorProducts
    : tab.value === 1
    ? productsStore.availableProducts
    : productsStore.hiddenProducts

  if (categoryFilter.value) {
    products = products.filter(p => p.category === categoryFilter.value)
  }

  if (search.value) {
    const s = search.value.toLowerCase()
    products = products.filter(
      p => p.title.toLowerCase().includes(s) ||
        p.description?.toLowerCase().includes(s) ||
        p.city.toLowerCase().includes(s)
    )
  }
  return products
})

const stats = computed(() => {
  const all = productsStore.investorProducts
  const totalValue = all.reduce((s, p) => s + p.price, 0)
  const cities = new Set(all.map(p => p.city))
  const categories = new Set(all.map(p => p.category))
  return {
    total: all.length,
    active: productsStore.availableProducts.length,
    hidden: productsStore.hiddenProducts.length,
    totalValue,
    cities: cities.size,
    categories: categories.size,
  }
})

function toggleAvailability(e: Event, productId: string) {
  e.stopPropagation()
  productsStore.toggleAvailability(productId)
}

function openProduct(productId: string) {
  router.push(`/products/${productId}`)
}
</script>

<template>
  <div class="at-page">
    <!-- Stats -->
    <div class="stats-row mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
          <v-icon icon="mdi-package-variant-closed" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">Всего товаров</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-check-circle-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.active }}</div>
          <div class="stat-label">Активных</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
          <v-icon icon="mdi-currency-usd" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ formatCurrency(stats.totalValue) }}</div>
          <div class="stat-label">Общая стоимость</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(139, 92, 246, 0.1); color: #8b5cf6;">
          <v-icon icon="mdi-map-marker-outline" size="20" />
        </div>
        <div>
          <div class="stat-value">{{ stats.cities }}</div>
          <div class="stat-label">Городов</div>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="d-flex flex-wrap ga-2 align-center mb-4">
      <div class="d-flex ga-2">
        <button
          v-for="(f, i) in tabFilters"
          :key="f.key"
          class="tab-btn"
          :class="{ active: tab === i }"
          @click="tab = i"
        >
          {{ f.label }}
          <span class="tab-count">{{
            i === 0 ? stats.total : i === 1 ? stats.active : stats.hidden
          }}</span>
        </button>
      </div>

      <v-spacer class="d-none d-md-block" />

      <div class="filter-input-wrap" style="max-width: 260px; min-width: 140px;">
        <v-icon icon="mdi-magnify" size="18" class="filter-input-icon" />
        <input
          v-model="search"
          type="text"
          placeholder="Поиск..."
          class="filter-input"
        />
      </div>

      <button class="btn-primary" @click="router.push('/create-product')">
        <v-icon icon="mdi-plus" size="16" />
        Добавить
      </button>
    </div>

    <!-- Category chips -->
    <div class="d-flex flex-wrap ga-2 mb-4">
      <button
        class="cat-chip"
        :class="{ active: !categoryFilter }"
        @click="categoryFilter = null"
      >
        Все категории
      </button>
      <button
        v-for="cat in CATEGORIES"
        :key="cat.id"
        class="cat-chip"
        :class="{ active: categoryFilter === cat.id }"
        @click="categoryFilter = categoryFilter === cat.id ? null : cat.id"
      >
        <v-icon :icon="cat.icon" size="14" />
        {{ cat.label }}
      </button>
    </div>

    <!-- Products grid -->
    <div v-if="displayedProducts.length" class="products-grid">
      <div
        v-for="product in displayedProducts"
        :key="product.id"
        class="product-card"
        :class="{ 'product-card--hidden': !product.isAvailable }"
        @click="openProduct(product.id)"
      >
        <div class="product-img-wrap">
          <v-img :src="product.photos[0]" height="180" cover class="product-img" />
          <div class="product-img-overlay" />

          <!-- Badges -->
          <div class="product-badges">
            <div v-if="!product.isAvailable" class="product-badge product-badge--warning">
              <v-icon icon="mdi-eye-off" size="12" />
              Скрыт
            </div>
          </div>

          <!-- Quick action -->
          <button
            class="product-toggle"
            :title="product.isAvailable ? 'Скрыть' : 'Опубликовать'"
            @click="toggleAvailability($event, product.id)"
          >
            <v-icon :icon="product.isAvailable ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" size="18" />
          </button>
        </div>

        <div class="product-body">
          <div class="product-category">
            <v-icon :icon="CATEGORIES.find(c => c.id === product.category)?.icon || 'mdi-tag'" size="13" />
            {{ getCategoryLabel(product.category) }}
          </div>

          <div class="product-title">{{ product.title }}</div>

          <div v-if="product.description" class="product-desc">{{ product.description }}</div>

          <div class="product-price">{{ formatCurrency(product.price) }}</div>

          <div class="product-meta">
            <div class="product-meta-item">
              <v-icon icon="mdi-calendar-range" size="13" />
              {{ product.minTermMonths }}–{{ product.maxTermMonths }} мес
            </div>
            <div class="product-meta-item">
              <v-icon icon="mdi-percent" size="13" />
              от {{ product.minDownPaymentPercent }}%
            </div>
            <div class="product-meta-item">
              <v-icon icon="mdi-map-marker" size="13" />
              {{ product.city }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <div class="empty-state-icon">
        <v-icon icon="mdi-package-variant-closed" size="32" />
      </div>
      <div class="empty-state-title">Нет товаров</div>
      <div class="empty-state-text">
        {{ search || categoryFilter ? 'Попробуйте изменить фильтры' : 'Добавьте свой первый товар в каталог' }}
      </div>
      <button v-if="!search && !categoryFilter" class="btn-primary mt-4" @click="router.push('/create-product')">
        <v-icon icon="mdi-plus" size="16" />
        Добавить товар
      </button>
    </div>

    <!-- Mobile FAB -->
    <button class="fab d-sm-none" @click="router.push('/create-product')">
      <v-icon icon="mdi-plus" size="24" />
    </button>
  </div>
</template>

<style scoped>
/* Stats */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1024px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .stats-row { grid-template-columns: 1fr; } }

.stat-card {
  display: flex; align-items: center; gap: 12px;
  padding: 16px; border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
}
.stat-icon {
  width: 40px; height: 40px; min-width: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.stat-value {
  font-size: 18px; font-weight: 700; line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.stat-label {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Tab buttons */
.tab-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 20px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.tab-btn:hover { background: rgba(var(--v-theme-primary), 0.08); color: rgb(var(--v-theme-primary)); }
.tab-btn.active { background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); font-weight: 600; }
.tab-count {
  font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  line-height: 18px; min-width: 20px; text-align: center;
}
.tab-btn.active .tab-count {
  background: rgba(var(--v-theme-primary), 0.15); color: rgb(var(--v-theme-primary));
}

/* Filter input */
.filter-input-wrap { position: relative; flex: 1; }
.filter-input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: #9ca3af; pointer-events: none;
}
.filter-input {
  width: 100%; height: 40px; padding: 0 16px 0 38px;
  border: 1px solid #e4e4e7; border-radius: 10px;
  background: #f4f4f5; font-size: 14px; color: inherit;
  outline: none; transition: all 0.15s ease;
}
.filter-input::placeholder { color: #9ca3af; }
.filter-input:focus {
  border-color: #047857; background: #fff;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}

/* Category chips */
.cat-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.cat-chip:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.cat-chip.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}

/* Products grid */
.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

/* Product card */
.product-card {
  border-radius: 14px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 1);
  cursor: pointer; transition: all 0.2s;
}
.product-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.25);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}
.product-card--hidden {
  opacity: 0.7;
}
.product-card--hidden:hover {
  opacity: 1;
}

.product-img-wrap {
  position: relative; overflow: hidden;
}
.product-img :deep(.v-img__img) {
  transition: transform 0.3s ease;
}
.product-card:hover .product-img :deep(.v-img__img) {
  transform: scale(1.05);
}
.product-img-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.15) 0%, transparent 50%);
  pointer-events: none;
}

.product-badges {
  position: absolute; top: 10px; left: 10px;
  display: flex; gap: 6px;
}
.product-badge {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 600;
  backdrop-filter: blur(8px);
}
.product-badge--warning {
  background: rgba(245, 158, 11, 0.9); color: #fff;
}

.product-toggle {
  position: absolute; top: 10px; right: 10px;
  width: 34px; height: 34px; border-radius: 8px;
  background: rgba(0,0,0,0.4); border: none;
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
  opacity: 0;
}
.product-card:hover .product-toggle {
  opacity: 1;
}
.product-toggle:hover {
  background: rgba(0,0,0,0.6);
}

.product-body {
  padding: 14px 16px 16px;
}

.product-category {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 6px;
}

.product-title {
  font-size: 15px; font-weight: 700; line-height: 1.3;
  color: rgba(var(--v-theme-on-surface), 0.9);
  margin-bottom: 4px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}

.product-desc {
  font-size: 12px; line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 10px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}

.product-price {
  font-size: 20px; font-weight: 800;
  color: #047857;
  margin-bottom: 10px;
}

.product-meta {
  display: flex; flex-wrap: wrap; gap: 4px 12px;
}
.product-meta-item {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Button */
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 40px; padding: 0 18px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.btn-primary:hover { background: #065f46; }

/* Empty state */
.empty-state {
  text-align: center; padding: 48px 16px;
}
.empty-state-icon {
  width: 64px; height: 64px; border-radius: 16px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 16px;
}
.empty-state-title {
  font-size: 16px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 6px;
}
.empty-state-text {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* FAB */
.fab {
  position: fixed; bottom: 24px; right: 24px; z-index: 5;
  width: 56px; height: 56px; border-radius: 16px; border: none;
  background: #047857; color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; box-shadow: 0 4px 16px rgba(4, 120, 87, 0.3);
  transition: all 0.15s;
}
.fab:hover { background: #065f46; transform: scale(1.05); }

/* Dark mode */
:global(.dark) .stat-card { background: #1e1e2e; border-color: #2e2e42; }
:global(.dark) .product-card { background: #1e1e2e; border-color: #2e2e42; }
:global(.dark) .filter-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
:global(.dark) .filter-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
</style>
