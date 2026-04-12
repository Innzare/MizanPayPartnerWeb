<script lang="ts" setup>
import { api } from '@/api/client'
import { formatCurrency } from '@/utils/formatters'
import { useRouter } from 'vue-router'
import { useIsDark } from '@/composables/useIsDark'
import { useToast } from '@/composables/useToast'

const { isDark } = useIsDark()
const toast = useToast()
const router = useRouter()

const step = ref<'upload' | 'mapping' | 'confirm' | 'result'>('upload')
const loading = ref(false)

// Step 1: Upload
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)

// Step 2: Mapping
const headers = ref<string[]>([])
const totalRows = ref(0)
const mapping = ref<Record<string, string>>({})
const paymentColumns = ref<any[]>([])
const preview = ref<any[]>([])

// Payment columns — user-defined
const userPaymentAmountCols = ref<string[]>([])
const userPaymentDateCols = ref<string[]>([])

function togglePaymentAmountCol(header: string) {
  const idx = userPaymentAmountCols.value.indexOf(header)
  if (idx >= 0) userPaymentAmountCols.value.splice(idx, 1)
  else userPaymentAmountCols.value.push(header)
}

function togglePaymentDateCol(header: string) {
  const idx = userPaymentDateCols.value.indexOf(header)
  if (idx >= 0) userPaymentDateCols.value.splice(idx, 1)
  else userPaymentDateCols.value.push(header)
}

// Step 3: Result
const result = ref<{
  imported: number; skipped: number; total: number; errors: string[];
  limitReached?: boolean; remainingSlots?: number | null; maxDeals?: number | null;
} | null>(null)

const FIELD_OPTIONS = [
  { key: 'dealDate', label: 'Дата сделки', icon: 'mdi-calendar' },
  { key: 'clientName', label: 'ФИО клиента', icon: 'mdi-account' },
  { key: 'clientPhone', label: 'Телефон клиента', icon: 'mdi-phone' },
  { key: 'productName', label: 'Название товара', icon: 'mdi-package-variant' },
  { key: 'purchasePrice', label: 'Себестоимость', icon: 'mdi-cash' },
  { key: 'totalPrice', label: 'Цена продажи', icon: 'mdi-cash-multiple' },
  { key: 'downPayment', label: 'Первоначальный взнос', icon: 'mdi-cash-check' },
  { key: 'numberOfPayments', label: 'Срок (мес)', icon: 'mdi-timer-sand' },
  { key: 'markupPercent', label: 'Маржа %', icon: 'mdi-percent' },
  { key: 'markup', label: 'Прибыль', icon: 'mdi-trending-up' },
  { key: 'monthlyPayment', label: 'Ежемесячный платёж', icon: 'mdi-calendar-month' },
  { key: 'remainingAmount', label: 'Остаток долга', icon: 'mdi-scale-balance' },
]

function onFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) {
    selectedFile.value = input.files[0]
  }
}

async function uploadPreview() {
  if (!selectedFile.value) return
  loading.value = true
  try {
    const formData = new FormData()
    formData.append('file', selectedFile.value)

    const token = localStorage.getItem('access_token')
    const API_URL = import.meta.env.VITE_API_URL as string

    const response = await fetch(`${API_URL}/import/preview`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: formData,
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Ошибка' }))
      throw new Error(err.message)
    }

    const data = await response.json()
    headers.value = data.headers
    totalRows.value = data.totalRows
    mapping.value = data.mapping
    paymentColumns.value = data.paymentColumns
    preview.value = data.preview
    step.value = 'mapping'
  } catch (e: any) {
    toast.error(e.message || 'Ошибка загрузки файла')
  } finally {
    loading.value = false
  }
}

async function confirmImport() {
  if (!selectedFile.value) return
  loading.value = true
  try {
    const formData = new FormData()
    formData.append('file', selectedFile.value)
    formData.append('mapping', JSON.stringify(mapping.value))
    if (userPaymentAmountCols.value.length) {
      formData.append('paymentAmountColumns', JSON.stringify(userPaymentAmountCols.value))
    }
    if (userPaymentDateCols.value.length) {
      formData.append('paymentDateColumns', JSON.stringify(userPaymentDateCols.value))
    }

    const token = localStorage.getItem('access_token')
    const API_URL = import.meta.env.VITE_API_URL as string

    const response = await fetch(`${API_URL}/import/confirm`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: formData,
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Ошибка' }))
      throw new Error(err.message)
    }

    result.value = await response.json()
    step.value = 'result'
    if (result.value!.limitReached) {
      toast.warning(`Импортировано ${result.value!.imported} из ${result.value!.total} сделок — достигнут лимит плана`)
    } else {
      toast.success(`Импортировано ${result.value!.imported} сделок`)
    }
  } catch (e: any) {
    toast.error(e.message || 'Ошибка импорта')
  } finally {
    loading.value = false
  }
}

function getUnmappedHeaders() {
  const mapped = new Set(Object.values(mapping.value))
  const paymentCols = new Set([
    ...paymentColumns.value.map((p: any) => p.header),
    ...userPaymentAmountCols.value,
    ...userPaymentDateCols.value,
  ])
  return headers.value.filter(h => !mapped.has(h) && !paymentCols.has(h))
}

function getMappedFieldLabel(key: string) {
  return FIELD_OPTIONS.find(f => f.key === key)?.label || key
}

const mappedCount = computed(() => Object.keys(mapping.value).length)
</script>

<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Header -->
    <div class="page-header">
      <div class="d-flex align-center ga-3">
        <div class="page-icon-wrap">
          <v-icon icon="mdi-file-upload-outline" size="22" />
        </div>
        <div>
          <div class="page-title">Импорт сделок</div>
          <div class="page-subtitle">Загрузите Excel-файл с вашими сделками</div>
        </div>
      </div>
    </div>

    <!-- Step: Upload -->
    <div v-if="step === 'upload'">

      <!-- Guide -->
      <div class="guide-banner mb-5">
        <div class="guide-banner-header">
          <div class="guide-banner-icon">
            <v-icon icon="mdi-lightbulb-on-outline" size="24" />
          </div>
          <div>
            <div class="guide-banner-title">Подготовьте файл для импорта</div>
            <div class="guide-banner-subtitle">Следуйте рекомендациям для максимально точного переноса данных</div>
          </div>
        </div>

        <div class="guide-grid">
          <div class="guide-card">
            <div class="guide-card-num">1</div>
            <div class="guide-card-title">Заголовки в первой строке</div>
            <div class="guide-card-desc">Названия колонок должны быть в первой строке. Система распознает их автоматически, но вы сможете скорректировать.</div>
          </div>
          <div class="guide-card">
            <div class="guide-card-num">2</div>
            <div class="guide-card-title">Данные о клиенте</div>
            <div class="guide-card-desc">ФИО и номер телефона клиента. Клиенты с одинаковым именем и телефоном будут объединены.</div>
          </div>
          <div class="guide-card">
            <div class="guide-card-num">3</div>
            <div class="guide-card-title">Финансовые данные</div>
            <div class="guide-card-desc">Себестоимость, цена продажи, первоначальный взнос, срок рассрочки в месяцах, дата заключения сделки.</div>
          </div>
          <div class="guide-card">
            <div class="guide-card-num">4</div>
            <div class="guide-card-title">История платежей</div>
            <div class="guide-card-desc">Каждый оплаченный платёж — в отдельной колонке. На следующем шаге вы укажете какие колонки содержат платежи.</div>
          </div>
        </div>

        <div class="guide-example">
          <div class="guide-example-title">
            <v-icon icon="mdi-table" size="16" />
            Идеальная структура файла
          </div>
          <div class="guide-example-table">
            <table>
              <thead>
                <tr>
                  <th>Дата сделки</th>
                  <th>ФИО клиента</th>
                  <th>Телефон</th>
                  <th>Товар</th>
                  <th>Себестоимость</th>
                  <th>Цена продажи</th>
                  <th>Первоначальный взнос</th>
                  <th>Срок (мес)</th>
                  <th>Дата первого платежа</th>
                  <th>Платёж 1</th>
                  <th>Платёж 2</th>
                  <th>Платёж 3</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>15.01.2025</td>
                  <td>Хасанов Ахмед Русланович</td>
                  <td>+7 999 123 45 67</td>
                  <td>iPhone 15 Pro Max</td>
                  <td>110 000</td>
                  <td>143 000</td>
                  <td>30 000</td>
                  <td>6</td>
                  <td>15.02.2025</td>
                  <td>18 833</td>
                  <td>18 833</td>
                  <td></td>
                </tr>
                <tr>
                  <td>20.02.2025</td>
                  <td>Магомадов Муса Исаевич</td>
                  <td>+7 928 000 00 00</td>
                  <td>Samsung S24 Ultra</td>
                  <td>95 000</td>
                  <td>118 750</td>
                  <td>0</td>
                  <td>4</td>
                  <td>20.03.2025</td>
                  <td>29 687</td>
                  <td></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="guide-example-notes">
            <div class="guide-note"><v-icon icon="mdi-check" size="14" color="primary" /> Даты — в любом формате (ДД.ММ.ГГГГ, ГГГГ-ММ-ДД)</div>
            <div class="guide-note"><v-icon icon="mdi-check" size="14" color="primary" /> Суммы — числа, можно с пробелами или знаком ₽</div>
            <div class="guide-note"><v-icon icon="mdi-check" size="14" color="primary" /> Пустые колонки платежей = платёж ещё не оплачен</div>
            <div class="guide-note"><v-icon icon="mdi-check" size="14" color="primary" /> Первоначальный взнос 0 = сделка без взноса</div>
          </div>
        </div>
      </div>

      <v-card rounded="lg" elevation="0" border class="pa-8" style="text-align: center;">
        <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" hidden @change="onFileSelect" />

        <div v-if="!selectedFile" class="upload-zone" @click="fileInput?.click()">
          <div class="upload-icon">
            <v-icon icon="mdi-file-excel-outline" size="48" />
          </div>
          <div class="upload-title">Выберите файл Excel</div>
          <div class="upload-desc">Поддерживаются форматы .xlsx, .xls и .csv</div>
          <button class="btn-primary mt-4">
            <v-icon icon="mdi-upload" size="18" />
            Выбрать файл
          </button>
        </div>

        <div v-else class="selected-file">
          <div class="selected-file-icon">
            <v-icon icon="mdi-file-check" size="32" color="primary" />
          </div>
          <div class="selected-file-name">{{ selectedFile.name }}</div>
          <div class="selected-file-size">{{ (selectedFile.size / 1024).toFixed(0) }} КБ</div>
          <div class="d-flex ga-3 mt-4 justify-center">
            <button class="btn-secondary" @click="selectedFile = null; if (fileInput) fileInput.value = ''">
              Заменить
            </button>
            <button class="btn-primary" :disabled="loading" @click="uploadPreview">
              <v-progress-circular v-if="loading" indeterminate size="16" width="2" color="white" class="mr-1" />
              {{ loading ? 'Анализ...' : 'Продолжить' }}
            </button>
          </div>
        </div>
      </v-card>

    </div>

    <!-- Step: Mapping -->
    <div v-if="step === 'mapping'" class="step-content">
      <div class="mapping-header">
        <div>
          <span class="text-h6 font-weight-bold">Сопоставление колонок</span>
          <div class="text-caption text-medium-emphasis">
            Найдено {{ totalRows }} строк · {{ headers.length }} колонок · {{ mappedCount }} сопоставлено
            <span v-if="paymentColumns.length"> · {{ paymentColumns.length }} колонок платежей</span>
          </div>
        </div>
        <div class="d-flex ga-2">
          <button class="btn-secondary" @click="step = 'upload'">Назад</button>
          <button class="btn-primary" @click="step = 'confirm'">
            Далее
            <v-icon icon="mdi-arrow-right" size="18" />
          </button>
        </div>
      </div>

      <!-- Mapping grid -->
      <v-card rounded="lg" elevation="0" border class="pa-5 mb-4">
        <div class="mapping-grid">
          <div v-for="field in FIELD_OPTIONS" :key="field.key" class="mapping-row">
            <div class="mapping-field">
              <v-icon :icon="field.icon" size="16" class="mr-2" style="opacity: 0.5;" />
              <span>{{ field.label }}</span>
            </div>
            <v-icon icon="mdi-arrow-right" size="16" style="opacity: 0.3;" />
            <select
              v-model="mapping[field.key]"
              class="mapping-select"
              :class="{ 'mapping-select--empty': !mapping[field.key] }"
            >
              <option value="">— Не выбрано —</option>
              <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
            </select>
          </div>
        </div>
      </v-card>

      <!-- Payment columns info -->
      <div v-if="paymentColumns.length" class="info-banner info-banner--success mb-4">
        <v-icon icon="mdi-check-circle" size="18" />
        <span>Обнаружено {{ paymentColumns.length }} колонок с платежами — они будут импортированы автоматически.</span>
      </div>

      <!-- Payment columns mapping -->
      <v-card rounded="lg" elevation="0" border class="pa-5 mb-4">
        <div class="d-flex align-center ga-2 mb-3">
          <v-icon icon="mdi-cash-multiple" size="18" style="opacity: 0.5;" />
          <span class="font-weight-bold" style="font-size: 14px;">Колонки платежей</span>
        </div>

        <div class="text-caption text-medium-emphasis mb-3">
          Выберите колонки которые содержат суммы оплаченных платежей. Порядок важен — первая выбранная = 1-й платёж.
        </div>

        <div class="text-body-2 font-weight-medium mb-2">Суммы платежей</div>
        <div class="d-flex flex-wrap ga-2 mb-4">
          <button
            v-for="h in getUnmappedHeaders().concat(userPaymentAmountCols)" :key="'amt-' + h"
            class="payment-col-chip"
            :class="{ active: userPaymentAmountCols.includes(h) }"
            @click="togglePaymentAmountCol(h)"
          >
            {{ h }}
            <span v-if="userPaymentAmountCols.includes(h)" class="payment-col-num">{{ userPaymentAmountCols.indexOf(h) + 1 }}</span>
          </button>
        </div>

        <div class="text-body-2 font-weight-medium mb-2">Даты платежей <span class="text-medium-emphasis">(необязательно)</span></div>
        <div class="d-flex flex-wrap ga-2">
          <button
            v-for="h in getUnmappedHeaders().concat(userPaymentDateCols)" :key="'dt-' + h"
            class="payment-col-chip"
            :class="{ active: userPaymentDateCols.includes(h) }"
            @click="togglePaymentDateCol(h)"
          >
            {{ h }}
            <span v-if="userPaymentDateCols.includes(h)" class="payment-col-num">{{ userPaymentDateCols.indexOf(h) + 1 }}</span>
          </button>
        </div>

        <div v-if="userPaymentAmountCols.length" class="info-banner info-banner--success mt-3">
          <v-icon icon="mdi-check-circle" size="16" />
          <span>Выбрано {{ userPaymentAmountCols.length }} колонок с суммами платежей</span>
        </div>
      </v-card>

      <!-- Unmapped columns -->
      <div v-if="getUnmappedHeaders().length" class="info-banner mb-4">
        <v-icon icon="mdi-information-outline" size="18" />
        <span>Не распознаны: {{ getUnmappedHeaders().join(', ') }}</span>
      </div>
    </div>

    <!-- Step: Confirm -->
    <div v-if="step === 'confirm'" class="step-content">
      <div class="mapping-header">
        <div>
          <span class="text-h6 font-weight-bold">Предварительный просмотр</span>
          <div class="text-caption text-medium-emphasis">Первые {{ preview.length }} из {{ totalRows }} строк</div>
        </div>
        <div class="d-flex ga-2">
          <button class="btn-secondary" @click="step = 'mapping'">Назад</button>
          <button class="btn-primary btn-primary--success" :disabled="loading" @click="confirmImport">
            <v-progress-circular v-if="loading" indeterminate size="16" width="2" color="white" class="mr-1" />
            <v-icon v-else icon="mdi-check" size="18" />
            {{ loading ? 'Импорт...' : `Импортировать ${totalRows} сделок` }}
          </button>
        </div>
      </div>

      <div class="preview-cards">
        <v-card v-for="(row, i) in preview" :key="i" rounded="lg" elevation="0" border class="pa-4 mb-3">
          <div class="preview-row-header">
            <span class="preview-row-num">#{{ i + 1 }}</span>
            <span class="preview-row-name">{{ row.mapped.clientName || '—' }}</span>
            <span class="preview-row-product">{{ row.mapped.productName || '—' }}</span>
          </div>
          <div class="preview-details">
            <div v-if="row.mapped.totalPrice" class="preview-detail">
              <span class="preview-detail-label">Цена</span>
              <span class="preview-detail-value">{{ formatCurrency(row.mapped.totalPrice) }}</span>
            </div>
            <div v-if="row.mapped.downPayment" class="preview-detail">
              <span class="preview-detail-label">Взнос</span>
              <span class="preview-detail-value">{{ formatCurrency(row.mapped.downPayment) }}</span>
            </div>
            <div v-if="row.mapped.numberOfPayments" class="preview-detail">
              <span class="preview-detail-label">Срок</span>
              <span class="preview-detail-value">{{ row.mapped.numberOfPayments }} мес</span>
            </div>
            <div v-if="row.mapped.dealDate" class="preview-detail">
              <span class="preview-detail-label">Дата</span>
              <span class="preview-detail-value">{{ row.mapped.dealDate }}</span>
            </div>
          </div>
        </v-card>
      </div>
    </div>

    <!-- Step: Result -->
    <div v-if="step === 'result' && result" class="step-content">
      <v-card rounded="lg" elevation="0" border class="pa-8 text-center">
        <div class="result-icon">
          <v-icon :icon="result.limitReached ? 'mdi-alert-circle' : 'mdi-check-circle'" size="56" :color="result.limitReached ? 'warning' : 'primary'" />
        </div>
        <div class="text-h5 font-weight-bold mt-4">
          {{ result.limitReached ? 'Импорт частично завершён' : 'Импорт завершён' }}
        </div>

        <!-- Limit warning -->
        <div v-if="result.limitReached" class="result-limit-banner">
          <v-icon icon="mdi-crown" size="18" />
          <div>
            <div class="result-limit-title">Достигнут лимит плана</div>
            <div class="result-limit-text">
              Импортировано {{ result.imported }} из {{ result.total }} сделок.
              Максимум активных сделок по вашему плану — {{ result.maxDeals }}.
            </div>
          </div>
          <button class="result-limit-btn" @click="router.push({ path: '/settings', query: { tab: 'subscription' } })">
            Улучшить план
          </button>
        </div>

        <div class="result-stats">
          <div class="result-stat">
            <div class="result-stat-value" style="color: #047857;">{{ result.imported }}</div>
            <div class="result-stat-label">Импортировано</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-value" style="color: #f59e0b;">{{ result.skipped }}</div>
            <div class="result-stat-label">Пропущено</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-value">{{ result.total }}</div>
            <div class="result-stat-label">Всего строк</div>
          </div>
          <div v-if="result.limitReached" class="result-stat">
            <div class="result-stat-value" style="color: #ef4444;">{{ result.total - result.imported - result.skipped }}</div>
            <div class="result-stat-label">Не импортировано (лимит)</div>
          </div>
        </div>

        <div v-if="result.errors.length" class="result-errors">
          <div class="result-errors-title">
            <v-icon icon="mdi-alert-circle-outline" size="16" />
            Ошибки ({{ result.errors.length }})
          </div>
          <div v-for="(err, i) in result.errors" :key="i" class="result-error">{{ err }}</div>
        </div>

        <button class="btn-primary mt-6" @click="router.push('/deals')">
          <v-icon icon="mdi-arrow-right" size="18" />
          Перейти к сделкам
        </button>
      </v-card>
    </div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 24px;
}
.page-icon-wrap {
  width: 44px; height: 44px; min-width: 44px; border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
}
.page-title { font-size: 18px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.page-subtitle { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45); }

.step-content { max-width: 900px; }

/* Upload zone */
.upload-zone {
  padding: 48px 24px; cursor: pointer;
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 16px; transition: all 0.2s;
}
.upload-zone:hover {
  border-color: #047857; background: rgba(4, 120, 87, 0.02);
}
.upload-icon {
  width: 80px; height: 80px; border-radius: 20px; margin: 0 auto 16px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center;
}
.upload-title { font-size: 18px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); margin-bottom: 4px; }
.upload-desc { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45); }

.selected-file { padding: 24px; }
.selected-file-icon { margin-bottom: 12px; }
.selected-file-name { font-size: 16px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); }
.selected-file-size { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }

/* Mapping */
.mapping-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20px; flex-wrap: wrap; gap: 12px;
}
.mapping-grid { display: flex; flex-direction: column; gap: 10px; }
.mapping-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 0; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.04);
}
.mapping-row:last-child { border-bottom: none; }
.mapping-field {
  display: flex; align-items: center;
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  width: 200px; flex-shrink: 0;
}
.mapping-select {
  flex: 1; height: 38px; padding: 0 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px; font-size: 13px; color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.03);
  outline: none;
}
.mapping-select--empty { color: rgba(var(--v-theme-on-surface), 0.35); }
.mapping-select:focus {
  border-color: #047857;
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.08);
}

/* Preview */
.preview-row-header {
  display: flex; align-items: center; gap: 12px; margin-bottom: 10px;
}
.preview-row-num {
  width: 28px; height: 28px; border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.preview-row-name { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); }
.preview-row-product { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45); }
.preview-details { display: flex; gap: 16px; flex-wrap: wrap; }
.preview-detail { display: flex; flex-direction: column; gap: 2px; }
.preview-detail-label { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.4); }
.preview-detail-value { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.8); }

/* Result */
.result-icon { margin-bottom: 8px; }
.result-limit-banner {
  display: flex; align-items: center; gap: 12px; text-align: left;
  margin: 16px 0 0; padding: 14px 18px; border-radius: 12px;
  background: rgba(232, 185, 49, 0.08);
  border: 1px solid rgba(232, 185, 49, 0.25);
}
.result-limit-banner > .v-icon { color: #e8b931; flex-shrink: 0; }
.result-limit-title {
  font-size: 13px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.result-limit-text {
  font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5);
  line-height: 1.4; margin-top: 2px;
}
.result-limit-btn {
  flex-shrink: 0; padding: 6px 14px; border-radius: 8px; border: none;
  background: #e8b931; color: #fff;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
}
.result-limit-btn:hover { background: #d4a82a; }
.result-stats {
  display: flex; gap: 32px; justify-content: center; margin: 24px 0;
}
.result-stat { text-align: center; }
.result-stat-value { font-size: 32px; font-weight: 800; }
.result-stat-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }
.result-errors {
  text-align: left; margin-top: 20px; padding: 16px; border-radius: 12px;
  background: rgba(239, 68, 68, 0.04); border: 1px solid rgba(239, 68, 68, 0.12);
}
.result-errors-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; color: #ef4444; margin-bottom: 8px;
}
.result-error { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); padding: 2px 0; }

/* Buttons */
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

/* Info banner */
.info-banner {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 16px; border-radius: 10px;
  background: rgba(59, 130, 246, 0.06);
  color: #3b82f6; font-size: 13px;
  border: 1px solid rgba(59, 130, 246, 0.12);
}
.info-banner--success {
  background: rgba(4, 120, 87, 0.06);
  color: #047857; border-color: rgba(4, 120, 87, 0.12);
}

/* Dark */
/* Guide banner */
.guide-banner {
  border-radius: 16px; padding: 24px;
  background: #fff;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.guide-banner-header {
  display: flex; align-items: center; gap: 14px; margin-bottom: 24px;
}
.guide-banner-icon {
  width: 48px; height: 48px; min-width: 48px; border-radius: 14px;
  background: rgba(245, 158, 11, 0.1); color: #f59e0b;
  display: flex; align-items: center; justify-content: center;
}
.guide-banner-title {
  font-size: 18px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.guide-banner-subtitle {
  font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px;
}

.guide-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px;
}
@media (max-width: 700px) { .guide-grid { grid-template-columns: 1fr; } }

.guide-card {
  padding: 16px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.guide-card-num {
  width: 28px; height: 28px; border-radius: 8px;
  background: rgba(4, 120, 87, 0.08); color: #047857;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; margin-bottom: 10px;
}
.guide-card-title {
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.8); margin-bottom: 4px;
}
.guide-card-desc {
  font-size: 13px; line-height: 1.6;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.guide-example {
  padding: 18px; border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.guide-example-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-bottom: 14px;
}
.guide-example-table { overflow-x: auto; margin-bottom: 14px; }
.guide-example-table table {
  width: 100%; border-collapse: collapse;
  font-size: 12px; white-space: nowrap;
}
.guide-example-table th {
  padding: 8px 12px; text-align: left;
  background: rgba(4, 120, 87, 0.06); color: #047857;
  font-weight: 600; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.guide-example-table td {
  padding: 8px 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.04);
}
.guide-example-notes {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;
}
@media (max-width: 700px) { .guide-example-notes { grid-template-columns: 1fr; } }
.guide-note {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  padding: 8px 12px; border-radius: 8px;
  background: rgba(4, 120, 87, 0.04);
  border: 1px solid rgba(4, 120, 87, 0.08);
}
.dark .guide-note { background: rgba(4, 120, 87, 0.06); border-color: rgba(4, 120, 87, 0.12); }

.dark .guide-banner { background: #1a1a2e; border-color: #2e2e42; }
.dark .guide-card { background: #1e1e2e; border-color: #2e2e42; }
.dark .guide-example { background: #1e1e2e; border-color: #2e2e42; }
.dark .guide-example-table th { background: rgba(4, 120, 87, 0.1); }

.dark .upload-zone { border-color: #2e2e42; }
.dark .upload-zone:hover { border-color: #047857; background: rgba(4, 120, 87, 0.04); }

/* Payment column chips */
.payment-col-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 8px; border: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 12px; font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: all 0.15s;
}
.payment-col-chip:hover {
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.payment-col-chip.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.payment-col-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  color: #fff; font-size: 10px; font-weight: 700;
}
.dark .payment-col-chip { background: #252538; }
.dark .payment-col-chip.active { background: rgba(4, 120, 87, 0.15); }
.dark .mapping-select { background: #252538; border-color: #2e2e42; color: #e4e4e7; }
.dark .mapping-select--empty { color: #666; }
.dark .mapping-select:focus { border-color: #047857; }
</style>
