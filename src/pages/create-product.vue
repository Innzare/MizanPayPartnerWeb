<script lang="ts" setup>
import { useProductsStore } from '@/stores/products'
import { formatCurrency } from '@/utils/formatters'
import { CATEGORIES } from '@/constants/categories'
import { CITIES } from '@/constants/cities'
import { useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'
import { api } from '@/api/client'

const { isDark } = useIsDark()
const toast = useToast()
const productsStore = useProductsStore()
const router = useRouter()

const step = ref(1)
const steps = [
  { num: 1, title: 'Детали', icon: 'mdi-text-box-outline' },
  { num: 2, title: 'Условия', icon: 'mdi-percent' },
  { num: 3, title: 'Обзор', icon: 'mdi-check-decagram' },
]

// Step 1: Details
const title = ref('')
const description = ref('')
const category = ref('')
const city = ref('')
const photoFiles = ref<File[]>([])
const photoPreviewUrls = ref<string[]>([])
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const hasPhotos = computed(() => photoFiles.value.length > 0)

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) {
    addFiles(Array.from(input.files))
  }
  if (fileInput.value) fileInput.value.value = ''
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (files) {
    addFiles(Array.from(files).filter(f => f.type.startsWith('image/')))
  }
}

function addFiles(files: File[]) {
  const remaining = 8 - photoFiles.value.length
  const toAdd = files.slice(0, remaining)
  for (const file of toAdd) {
    photoFiles.value.push(file)
    photoPreviewUrls.value.push(URL.createObjectURL(file))
  }
}

function removePhoto(index: number) {
  URL.revokeObjectURL(photoPreviewUrls.value[index])
  photoFiles.value.splice(index, 1)
  photoPreviewUrls.value.splice(index, 1)
}

// Step 2: Terms
const price = ref<number | null>(null)
const markupPercent = ref(15)
const minDownPaymentPercent = ref(10)
const minTermMonths = ref(6)
const maxTermMonths = ref(24)

const markupOptions = [10, 15, 20, 25]
const downPaymentOptions = [10, 15, 20, 30]
const termOptionsMin = [3, 6, 9, 12]
const termOptionsMax = [6, 9, 12, 18, 24, 36]

// Preview
const totalPrice = computed(() => (price.value || 0) * (1 + markupPercent.value / 100))
const markupAmount = computed(() => (price.value || 0) * markupPercent.value / 100)
const minDownPayment = computed(() => totalPrice.value * minDownPaymentPercent.value / 100)
const monthlyPaymentPreview = computed(() => {
  const remaining = totalPrice.value - minDownPayment.value
  return maxTermMonths.value > 0 ? remaining / maxTermMonths.value : 0
})

// Validation
const step1Valid = computed(() => !!title.value && !!category.value && !!city.value)
const step2Valid = computed(() => (price.value ?? 0) > 0)

function nextStep() { if (step.value < 3) step.value++ }
function prevStep() { if (step.value > 1) step.value-- }

function canProceed() {
  if (step.value === 1) return step1Valid.value
  if (step.value === 2) return step2Valid.value
  return true
}

const submitting = ref(false)

async function submitProduct() {
  try {
    submitting.value = true
    let urls: string[] = []
    if (photoFiles.value.length > 0) {
      urls = await api.uploadMultiple(photoFiles.value, 'products')
    }
    await productsStore.createProduct({
      title: title.value,
      description: description.value || undefined,
      category: category.value,
      photos: urls.length ? urls : undefined,
      price: price.value || 0,
      minTermMonths: minTermMonths.value,
      maxTermMonths: maxTermMonths.value,
      minDownPaymentPercent: minDownPaymentPercent.value,
      city: city.value,
    })
    toast.success('Товар создан')
    router.push('/products')
  } catch (e: any) {
    toast.error(e.message || 'Ошибка создания товара')
  } finally {
    submitting.value = false
  }
}

function getCategoryLabel(catId: string) {
  return CATEGORIES.find(c => c.id === catId)?.label || catId
}

function getCategoryIcon(catId: string) {
  return CATEGORIES.find(c => c.id === catId)?.icon || 'mdi-tag'
}
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Custom stepper header -->
    <div class="stepper-header">
      <div
        v-for="(s, i) in steps"
        :key="s.num"
        class="stepper-step"
        :class="{
          'stepper-step--active': step === s.num,
          'stepper-step--done': step > s.num,
          'stepper-step--upcoming': step < s.num,
        }"
        @click="s.num < step ? step = s.num : undefined"
      >
        <div class="stepper-dot">
          <v-icon v-if="step > s.num" icon="mdi-check" size="16" />
          <v-icon v-else :icon="s.icon" size="16" />
        </div>
        <span class="stepper-label">{{ s.title }}</span>
        <div v-if="i < steps.length - 1" class="stepper-line" :class="{ done: step > s.num }" />
      </div>
    </div>

    <!-- Step 1: Details -->
    <div v-if="step === 1" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap">
          <v-icon icon="mdi-text-box-outline" size="22" />
        </div>
        <div>
          <div class="step-title">Информация о товаре</div>
          <div class="step-subtitle">Заполните карточку товара для каталога</div>
        </div>
      </div>

      <v-row>
        <v-col cols="12" lg="7">
          <v-card rounded="lg" elevation="0" border class="pa-5">
            <div class="form-grid">
              <div class="form-field">
                <label class="field-label">Название товара <span class="required">*</span></label>
                <input
                  v-model="title"
                  type="text"
                  class="field-input"
                  placeholder="Например: Samsung Galaxy S24 Ultra 512GB"
                />
              </div>

              <div class="form-field">
                <label class="field-label">Описание</label>
                <textarea
                  v-model="description"
                  class="field-input field-textarea"
                  placeholder="Подробное описание товара для покупателей..."
                  rows="3"
                />
              </div>

              <div class="form-field">
                <label class="field-label">Категория <span class="required">*</span></label>
                <div class="category-grid">
                  <button
                    v-for="cat in CATEGORIES"
                    :key="cat.id"
                    class="category-option"
                    :class="{ active: category === cat.id }"
                    @click="category = cat.id"
                  >
                    <v-icon :icon="cat.icon" size="20" />
                    <span>{{ cat.label }}</span>
                  </button>
                </div>
              </div>

              <div class="form-field">
                <label class="field-label">Город <span class="required">*</span></label>
                <select v-model="city" class="field-input field-select">
                  <option value="" disabled>Выберите город</option>
                  <option v-for="c in CITIES" :key="c" :value="c">{{ c }}</option>
                </select>
              </div>

              <div class="form-field">
                <label class="field-label">Фото товара <span class="text-medium-emphasis">({{ photoFiles.length }}/8)</span></label>
                <div
                  class="upload-zone"
                  :class="{ 'upload-zone--drag': isDragging }"
                  @dragenter.prevent="isDragging = true"
                  @dragover.prevent="isDragging = true"
                  @dragleave.prevent="isDragging = false"
                  @drop.prevent="handleDrop"
                  @click="photoFiles.length < 8 && fileInput?.click()"
                >
                  <input
                    ref="fileInput"
                    type="file"
                    accept="image/*"
                    multiple
                    style="display: none"
                    @change="handleFileSelect"
                  />
                  <v-icon icon="mdi-cloud-upload-outline" size="28" class="upload-icon" />
                  <span class="upload-text">Перетащите фото сюда или нажмите для выбора</span>
                  <span class="upload-hint">JPG, PNG, WebP · до 5 МБ · максимум 8 фото</span>
                </div>
                <div v-if="photoFiles.length" class="photo-grid mt-3">
                  <div v-for="(file, idx) in photoFiles" :key="idx" class="photo-grid-item">
                    <v-img :src="photoPreviewUrls[idx]" height="80" cover class="photo-grid-img" />
                    <button class="photo-grid-remove" @click.stop="removePhoto(idx)" title="Удалить">
                      <v-icon icon="mdi-close" size="14" />
                    </button>
                    <div class="photo-grid-name">{{ file.name }}</div>
                  </div>
                </div>
              </div>
            </div>
          </v-card>
        </v-col>

        <!-- Photo preview -->
        <v-col cols="12" lg="5">
          <div class="photo-preview-card">
            <v-img
              v-if="hasPhotos"
              :src="photoPreviewUrls[0]"
              height="240"
              cover
              class="photo-preview-img"
            />
            <div v-else class="photo-preview-placeholder">
              <v-icon icon="mdi-image-outline" size="48" />
              <span>Фото не выбрано</span>
            </div>
            <div class="photo-preview-overlay">
              <div v-if="title" class="photo-preview-title">{{ title }}</div>
              <div v-if="category" class="photo-preview-category">
                <v-icon :icon="getCategoryIcon(category)" size="12" />
                {{ getCategoryLabel(category) }}
              </div>
            </div>
            <div class="photo-preview-badge">Превью</div>
          </div>
        </v-col>
      </v-row>
    </div>

    <!-- Step 2: Terms -->
    <div v-if="step === 2" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap">
          <v-icon icon="mdi-percent" size="22" />
        </div>
        <div>
          <div class="step-title">Условия рассрочки</div>
          <div class="step-subtitle">Настройте параметры, которые увидят покупатели</div>
        </div>
      </div>

      <v-row>
        <v-col cols="12" lg="7">
          <v-card rounded="lg" elevation="0" border class="pa-5">
            <div class="form-grid">
              <div class="form-field">
                <label class="field-label">Цена товара <span class="required">*</span></label>
                <div class="input-with-suffix">
                  <input
                    v-model.number="price"
                    type="number"
                    class="field-input"
                    placeholder="0"
                  />
                  <span class="input-suffix">₽</span>
                </div>
              </div>

              <div class="form-field">
                <label class="field-label">Наценка</label>
                <div class="chip-group">
                  <button
                    v-for="opt in markupOptions"
                    :key="opt"
                    class="chip-option"
                    :class="{ active: markupPercent === opt }"
                    @click="markupPercent = opt"
                  >
                    {{ opt }}%
                  </button>
                </div>
                <div class="input-with-suffix mt-2">
                  <input v-model.number="markupPercent" type="number" class="field-input" placeholder="15" min="1" />
                  <span class="input-suffix">%</span>
                </div>
              </div>

              <div class="form-field">
                <label class="field-label">Мин. первоначальный взнос</label>
                <div class="chip-group">
                  <button
                    v-for="opt in downPaymentOptions"
                    :key="opt"
                    class="chip-option"
                    :class="{ active: minDownPaymentPercent === opt }"
                    @click="minDownPaymentPercent = opt"
                  >
                    {{ opt }}%
                  </button>
                </div>
                <div class="input-with-suffix mt-2">
                  <input v-model.number="minDownPaymentPercent" type="number" class="field-input" placeholder="10" min="1" max="100" />
                  <span class="input-suffix">%</span>
                </div>
              </div>

              <div class="form-field">
                <label class="field-label">Срок рассрочки</label>
                <div class="term-range">
                  <div class="term-range-side">
                    <span class="term-range-label">От</span>
                    <div class="chip-group">
                      <button
                        v-for="opt in termOptionsMin"
                        :key="opt"
                        class="chip-option chip-option--sm"
                        :class="{ active: minTermMonths === opt }"
                        @click="minTermMonths = opt"
                      >
                        {{ opt }}
                      </button>
                    </div>
                    <div class="input-with-suffix mt-2">
                      <input v-model.number="minTermMonths" type="number" class="field-input" placeholder="6" min="1" />
                      <span class="input-suffix">мес</span>
                    </div>
                  </div>
                  <div class="term-range-divider">—</div>
                  <div class="term-range-side">
                    <span class="term-range-label">До</span>
                    <div class="chip-group">
                      <button
                        v-for="opt in termOptionsMax"
                        :key="opt"
                        class="chip-option chip-option--sm"
                        :class="{ active: maxTermMonths === opt }"
                        @click="maxTermMonths = opt"
                      >
                        {{ opt }}
                      </button>
                    </div>
                    <div class="input-with-suffix mt-2">
                      <input v-model.number="maxTermMonths" type="number" class="field-input" placeholder="24" min="1" />
                      <span class="input-suffix">мес</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </v-card>
        </v-col>

        <!-- Buyer preview -->
        <v-col cols="12" lg="5">
          <div class="preview-card">
            <div class="preview-header">
              <v-icon icon="mdi-eye" size="18" />
              <span>Как увидит покупатель</span>
            </div>

            <div class="preview-row">
              <span>Цена товара</span>
              <span class="preview-value">{{ formatCurrency(price || 0) }}</span>
            </div>
            <div class="preview-row">
              <span>Наценка {{ markupPercent }}%</span>
              <span class="preview-value" style="color: #047857;">+{{ formatCurrency(markupAmount) }}</span>
            </div>
            <div class="preview-divider" />
            <div class="preview-row preview-row--total">
              <span>Итого</span>
              <span>{{ formatCurrency(totalPrice) }}</span>
            </div>
            <div class="preview-row">
              <span>Взнос от {{ minDownPaymentPercent }}%</span>
              <span class="preview-value">{{ formatCurrency(minDownPayment) }}</span>
            </div>
            <div class="preview-divider" />
            <div class="preview-row preview-row--highlight">
              <span>от</span>
              <span>{{ formatCurrency(monthlyPaymentPreview) }}/мес</span>
            </div>
            <div class="preview-footer">
              {{ minTermMonths }}–{{ maxTermMonths }} мес · Взнос от {{ minDownPaymentPercent }}%
            </div>
          </div>
        </v-col>
      </v-row>
    </div>

    <!-- Step 3: Review -->
    <div v-if="step === 3" class="step-content">
      <div class="step-title-row">
        <div class="step-icon-wrap" style="background: rgba(4, 120, 87, 0.1); color: #047857;">
          <v-icon icon="mdi-check-decagram" size="22" />
        </div>
        <div>
          <div class="step-title">Обзор товара</div>
          <div class="step-subtitle">Проверьте данные перед публикацией</div>
        </div>
      </div>

      <div class="review-grid">
        <!-- Product -->
        <v-card rounded="lg" elevation="0" border class="pa-5">
          <div class="review-section-header">
            <v-icon icon="mdi-text-box-outline" size="18" />
            <span>Товар</span>
          </div>
          <div class="review-rows">
            <div class="review-row">
              <span class="review-label">Название</span>
              <span class="review-value">{{ title }}</span>
            </div>
            <div class="review-row">
              <span class="review-label">Категория</span>
              <span class="review-value">
                <v-icon :icon="getCategoryIcon(category)" size="14" class="mr-1" />
                {{ getCategoryLabel(category) }}
              </span>
            </div>
            <div class="review-row">
              <span class="review-label">Город</span>
              <span class="review-value">{{ city }}</span>
            </div>
            <div v-if="description" class="review-row">
              <span class="review-label">Описание</span>
              <span class="review-value review-value--wrap">{{ description }}</span>
            </div>
          </div>
        </v-card>

        <!-- Terms -->
        <v-card rounded="lg" elevation="0" border class="pa-5">
          <div class="review-section-header">
            <v-icon icon="mdi-percent" size="18" />
            <span>Условия</span>
          </div>
          <div class="review-rows">
            <div class="review-row">
              <span class="review-label">Цена</span>
              <span class="review-value">{{ formatCurrency(price || 0) }}</span>
            </div>
            <div class="review-row">
              <span class="review-label">Наценка</span>
              <span class="review-value" style="color: #047857;">+{{ formatCurrency(markupAmount) }} ({{ markupPercent }}%)</span>
            </div>
            <div class="review-row review-row--bold">
              <span class="review-label">Итого</span>
              <span class="review-value">{{ formatCurrency(totalPrice) }}</span>
            </div>
            <div class="review-row">
              <span class="review-label">Мин. взнос</span>
              <span class="review-value">{{ minDownPaymentPercent }}% ({{ formatCurrency(minDownPayment) }})</span>
            </div>
            <div class="review-row">
              <span class="review-label">Срок</span>
              <span class="review-value">{{ minTermMonths }}–{{ maxTermMonths }} мес</span>
            </div>
            <div class="review-row review-row--bold">
              <span class="review-label">от</span>
              <span class="review-value" style="color: #047857;">{{ formatCurrency(monthlyPaymentPreview) }}/мес</span>
            </div>
          </div>
        </v-card>

        <!-- Photo -->
        <v-card rounded="lg" elevation="0" border class="pa-5">
          <div class="review-section-header">
            <v-icon icon="mdi-image" size="18" />
            <span>Фото</span>
          </div>
          <div v-if="hasPhotos" class="photo-grid">
            <div v-for="(url, idx) in photoPreviewUrls" :key="idx" class="photo-grid-item">
              <v-img :src="url" height="80" cover class="photo-grid-img" />
            </div>
          </div>
          <div v-else class="photo-preview-placeholder photo-preview-placeholder--sm">
            <v-icon icon="mdi-image-outline" size="36" />
            <span>Нет фото</span>
          </div>
        </v-card>
      </div>

      <div class="info-banner info-banner--success mt-4">
        <v-icon icon="mdi-store-check" size="18" />
        <span>Товар появится в каталоге. Покупатели смогут подать заявку на рассрочку.</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="step-actions">
      <button v-if="step > 1" class="btn-secondary" @click="prevStep">
        <v-icon icon="mdi-arrow-left" size="18" />
        Назад
      </button>
      <div v-else />
      <button v-if="step < 3" class="btn-primary" :disabled="!canProceed()" @click="nextStep">
        Далее
        <v-icon icon="mdi-arrow-right" size="18" />
      </button>
      <button v-else class="btn-primary btn-primary--success" @click="submitProduct">
        <v-icon icon="mdi-check" size="18" />
        Опубликовать товар
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Stepper header */
.stepper-header {
  display: flex; align-items: center;
  padding: 16px 0; margin-bottom: 24px;
  gap: 0;
}
.stepper-step {
  display: flex; align-items: center; gap: 8px;
  position: relative; flex-shrink: 0;
  cursor: default;
}
.stepper-step--done { cursor: pointer; }
.stepper-dot {
  width: 36px; height: 36px; min-width: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.35);
  transition: all 0.2s;
}
.stepper-step--active .stepper-dot {
  background: #047857; color: #fff;
  box-shadow: 0 2px 8px rgba(4, 120, 87, 0.25);
}
.stepper-step--done .stepper-dot {
  background: rgba(4, 120, 87, 0.12); color: #047857;
}
.stepper-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
  white-space: nowrap;
}
.stepper-step--active .stepper-label {
  color: rgba(var(--v-theme-on-surface), 0.85); font-weight: 600;
}
.stepper-step--done .stepper-label { color: #047857; }
.stepper-line {
  width: 32px; min-width: 24px; height: 2px; flex-shrink: 1; flex-grow: 1;
  background: rgba(var(--v-theme-on-surface), 0.1);
  margin: 0 8px; border-radius: 1px;
  transition: background 0.2s;
}
.stepper-line.done { background: rgba(4, 120, 87, 0.3); }

@media (max-width: 700px) {
  .stepper-label { display: none; }
  .stepper-line { width: 16px; min-width: 12px; margin: 0 4px; }
  .stepper-header { justify-content: center; }
}

/* Step content */
.step-content { margin-bottom: 20px; }
.step-title-row {
  display: flex; align-items: center; gap: 14px; margin-bottom: 20px;
}
.step-icon-wrap {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
}
.step-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.step-subtitle {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Form */
.form-grid {
  display: flex; flex-direction: column; gap: 20px;
}
.form-field { display: flex; flex-direction: column; gap: 6px; }
.field-label {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.required { color: #ef4444; }
.field-input {
  width: 100%; height: 44px; padding: 0 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px; font-size: 14px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.03);
  outline: none; transition: all 0.15s;
}
.field-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.3); }
.field-input:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 8%, transparent);
}
.field-textarea { height: auto; padding: 12px 14px; resize: vertical; }
.field-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M3 5l3 3 3-3'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 36px;
}

.input-with-suffix { position: relative; }
.input-suffix {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  pointer-events: none;
}
.input-with-suffix .field-input { padding-right: 36px; }

/* Category grid */
.category-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px;
}
.category-option {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 12px 8px; border-radius: 10px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 11px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.category-option:hover {
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
}
.category-option.active {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.3);
}

/* Chip group */
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
.chip-option {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 8px 16px; border-radius: 20px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.chip-option:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.chip-option.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary)); font-weight: 600;
}
.chip-option--sm { padding: 6px 14px; font-size: 12px; }

/* Term range */
.term-range {
  display: flex; align-items: center; gap: 12px;
}
.term-range-side { flex: 1; }
.term-range-label {
  font-size: 11px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.35);
  text-transform: uppercase;
  margin-bottom: 6px; display: block;
}
.term-range-divider {
  font-size: 16px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.2);
  margin-top: 14px;
}

/* Upload zone */
.upload-zone {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 24px 16px; border-radius: 12px;
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  cursor: pointer; transition: all 0.2s;
  min-height: 100px;
}
.upload-zone:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.03);
}
.upload-zone--drag {
  border-color: #047857; background: rgba(4, 120, 87, 0.06);
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.1);
}
.upload-zone--has-file {
  padding: 12px; cursor: default;
  border-style: solid; border-color: rgba(var(--v-theme-on-surface), 0.08);
}
.upload-icon { color: rgba(var(--v-theme-on-surface), 0.25); margin-bottom: 6px; }
.upload-text {
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.upload-hint {
  font-size: 11px; margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.3);
}
.upload-file-info {
  display: flex; align-items: center; gap: 12px; width: 100%;
}
.upload-thumb { border-radius: 8px; flex-shrink: 0; }
.upload-file-details {
  display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;
}
.upload-file-name {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.upload-file-size {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4);
}
.upload-remove {
  width: 32px; height: 32px; min-width: 32px; border-radius: 8px;
  border: none; background: rgba(239, 68, 68, 0.08);
  color: #ef4444; cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.upload-remove:hover { background: rgba(239, 68, 68, 0.15); }
.upload-or {
  display: flex; align-items: center; gap: 12px; margin: 10px 0;
}
.upload-or-line {
  flex: 1; height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.upload-or-text {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.25);
}

/* Photo preview */
.photo-preview-card {
  position: relative; border-radius: 14px; overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  position: sticky; top: 80px;
}
.photo-preview-img { display: block; }
.photo-preview-placeholder {
  height: 240px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  color: rgba(var(--v-theme-on-surface), 0.2);
  font-size: 13px; font-weight: 500;
}
.photo-preview-placeholder--sm { height: 180px; border-radius: 12px; }
.photo-preview-overlay {
  position: absolute; bottom: 0; left: 0; right: 0;
  padding: 20px 16px 16px;
  background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%);
}
.photo-preview-title {
  font-size: 16px; font-weight: 700; color: #fff; line-height: 1.3;
}
.photo-preview-category {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 6px; padding: 3px 10px; border-radius: 6px;
  background: rgba(255,255,255,0.15); backdrop-filter: blur(4px);
  font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.9);
}
.photo-preview-badge {
  position: absolute; top: 10px; right: 10px;
  padding: 3px 10px; border-radius: 6px;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
  font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.7);
  text-transform: uppercase; letter-spacing: 0.05em;
}

/* Preview card */
.preview-card {
  padding: 20px; border-radius: 14px;
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.06) 0%, rgba(4, 120, 87, 0.02) 100%);
  border: 1px solid rgba(4, 120, 87, 0.12);
  position: sticky; top: 80px;
}
.preview-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700;
  color: #047857; margin-bottom: 16px;
}
.preview-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 0; font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.preview-value { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); }
.preview-row--total {
  font-weight: 700; font-size: 15px;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.preview-row--total span:last-child { color: #047857; }
.preview-row--highlight {
  font-weight: 700; font-size: 16px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  padding: 8px 0;
}
.preview-row--highlight span:last-child { color: #047857; }
.preview-divider {
  height: 1px; margin: 8px 0;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.preview-footer {
  text-align: center; margin-top: 12px; padding-top: 12px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.1);
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Review */
.review-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;
}
.review-section-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 16px; padding-bottom: 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.review-rows { display: flex; flex-direction: column; gap: 10px; }
.review-row {
  display: flex; justify-content: space-between; align-items: center;
}
.review-label {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45);
}
.review-value {
  font-size: 14px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
  text-align: right;
}
.review-value--wrap { max-width: 60%; text-align: right; }
.review-row--bold .review-label { font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.65); }
.review-row--bold .review-value { font-size: 15px; }

/* Info banner */
.info-banner {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 14px 16px; border-radius: 10px;
  background: rgba(59, 130, 246, 0.06);
  color: #3b82f6; font-size: 13px;
  border: 1px solid rgba(59, 130, 246, 0.12);
}
.info-banner--success {
  background: rgba(4, 120, 87, 0.06);
  color: #047857;
  border-color: rgba(4, 120, 87, 0.12);
}

/* Actions */
.step-actions {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 8px;
}
.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px; padding: 0 24px; border-radius: 10px; border: none;
  background: #047857; color: #fff;
  font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.btn-primary:hover { background: #065f46; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary--success { background: #047857; }
.btn-secondary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 44px; padding: 0 24px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent; color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.btn-secondary:hover { background: rgba(var(--v-theme-on-surface), 0.04); }

/* Dark mode */
.dark .field-input { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .field-input:focus {
  border-color: #047857; background: #1e1e2e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #047857 15%, transparent);
}
.dark .preview-card { background: linear-gradient(135deg, rgba(4, 120, 87, 0.1) 0%, rgba(4, 120, 87, 0.04) 100%); border-color: rgba(4, 120, 87, 0.2); }
.dark .category-option { background: #252538; }
.dark .photo-preview-placeholder { background: #1e1e2e; color: #3e3e52; }
.dark .upload-zone { background: #1e1e2e; border-color: #2e2e42; }
.dark .upload-zone:hover { background: rgba(4, 120, 87, 0.06); border-color: rgba(4, 120, 87, 0.3); }
.dark .upload-zone--has-file { background: #252538; border-color: #2e2e42; }
.dark .photo-preview-card { border-color: #2e2e42; }
</style>
