<template>
  <div class="at-page" :class="{ dark: isDark }">
    <!-- Hero / Hawl banner -->
    <v-card rounded="lg" elevation="0" class="hero-card mb-5">
      <div class="hero-grid">
        <div class="hero-text">
          <div class="hero-eyebrow">
            <v-icon icon="mdi-mosque" size="14" />
            Закят
          </div>
          <h1 class="hero-title">Расчёт и учёт закята</h1>
          <p class="hero-desc">
            Закят — обязательная ежегодная милостыня, один из пяти столпов ислама. Платится в размере 2.5%
            с накоплений, превышающих нисаб, по истечении лунного года (хаула).
          </p>
        </div>

        <div class="hero-stats">
          <div class="hero-stat">
            <div class="hero-stat-label">Нисаб ({{ settings?.nisabBase === 'GOLD' ? '85 г золота' : '595 г серебра' }})</div>
            <div class="hero-stat-value">{{ formatRub(settings?.nisabValue ?? 0) }}</div>
          </div>
          <div class="hero-stat" v-if="settings?.daysUntilHawl != null">
            <div class="hero-stat-label">До дня закята</div>
            <div class="hero-stat-value">
              {{ settings.daysUntilHawl > 0 ? settings.daysUntilHawl : 0 }}
              <span class="hero-stat-unit">{{ pluralizeRu(settings.daysUntilHawl, 'день', 'дня', 'дней') }}</span>
            </div>
          </div>
          <div class="hero-stat" v-else>
            <div class="hero-stat-label">Дата начала хаула</div>
            <button class="hero-stat-action" @click="tab = 'settings'">Указать дату</button>
          </div>
        </div>
      </div>
    </v-card>

    <!-- Tabs -->
    <div class="tab-pills mb-5">
      <button class="tab-pill" :class="{ active: tab === 'calc' }" @click="tab = 'calc'">
        <v-icon icon="mdi-calculator-variant" size="16" />
        Калькулятор
      </button>
      <button class="tab-pill" :class="{ active: tab === 'history' }" @click="tab = 'history'">
        <v-icon icon="mdi-history" size="16" />
        История ({{ payments.length }})
      </button>
      <button class="tab-pill" :class="{ active: tab === 'settings' }" @click="tab = 'settings'">
        <v-icon icon="mdi-cog-outline" size="16" />
        Настройки
      </button>
      <button class="tab-pill" :class="{ active: tab === 'faq' }" @click="tab = 'faq'">
        <v-icon icon="mdi-book-open-page-variant-outline" size="16" />
        Что такое закят
      </button>
    </div>

    <!-- ── Calculator tab ── -->
    <div v-if="tab === 'calc'">
      <v-row dense>
        <v-col cols="12" lg="8">
          <v-card rounded="lg" elevation="0" border class="pa-5">
            <h2 class="section-title mb-4">Расчёт закята</h2>

            <!-- Auto-pulled assets -->
            <div class="block-title">Из системы</div>
            <div class="asset-rows mb-5">
              <div class="asset-row">
                <div>
                  <div class="asset-name">Свободный капитал</div>
                  <div class="asset-hint">Не вложенный в активные продажи</div>
                </div>
                <div class="asset-value">{{ formatRub(calculation?.auto.freeCapital ?? 0) }}</div>
              </div>
              <div class="asset-row">
                <div>
                  <div class="asset-name">Капитал в активных продажах</div>
                  <div class="asset-hint">{{ calculation?.auto.activeDealsCount ?? 0 }} активных</div>
                </div>
                <div class="asset-value">{{ formatRub(calculation?.auto.capitalInDeals ?? 0) }}</div>
              </div>
              <div class="asset-row">
                <div>
                  <div class="asset-name">Ожидаемые поступления</div>
                  <div class="asset-hint">Долги клиентов по активным продажам</div>
                </div>
                <div class="asset-value">{{ formatRub(calculation?.auto.expectedReturns ?? 0) }}</div>
              </div>
              <div class="asset-row asset-row--total">
                <div class="asset-name">Итого из системы</div>
                <div class="asset-value">{{ formatRub(calculation?.auto.totalAuto ?? 0) }}</div>
              </div>
            </div>

            <!-- Manual assets -->
            <div class="block-title">Дополнительные активы</div>
            <v-row dense class="mt-2">
              <v-col cols="12" sm="6">
                <v-text-field
                  label="Наличные деньги"
                  :model-value="manual.cash"
                  @update:model-value="(v) => updateManual('cash', v)"
                  type="number"
                  suffix="₽"
                  density="comfortable"
                  variant="outlined"
                  hide-details
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  label="На банковских счетах"
                  :model-value="manual.bank"
                  @update:model-value="(v) => updateManual('bank', v)"
                  type="number"
                  suffix="₽"
                  density="comfortable"
                  variant="outlined"
                  hide-details
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  label="Золото"
                  :model-value="manual.goldGrams"
                  @update:model-value="(v) => updateManual('goldGrams', v)"
                  type="number"
                  suffix="г"
                  density="comfortable"
                  variant="outlined"
                  hide-details
                  :hint="manual.goldGrams ? `≈ ${formatRub((+manual.goldGrams) * (settings?.goldPricePerGram ?? 0))}` : ''"
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  label="Серебро"
                  :model-value="manual.silverGrams"
                  @update:model-value="(v) => updateManual('silverGrams', v)"
                  type="number"
                  suffix="г"
                  density="comfortable"
                  variant="outlined"
                  hide-details
                  :hint="manual.silverGrams ? `≈ ${formatRub((+manual.silverGrams) * (settings?.silverPricePerGram ?? 0))}` : ''"
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  label="Товары для продажи"
                  :model-value="manual.tradeGoods"
                  @update:model-value="(v) => updateManual('tradeGoods', v)"
                  type="number"
                  suffix="₽"
                  density="comfortable"
                  variant="outlined"
                  hide-details
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  label="Другие инвестиции"
                  :model-value="manual.otherInvestments"
                  @update:model-value="(v) => updateManual('otherInvestments', v)"
                  type="number"
                  suffix="₽"
                  density="comfortable"
                  variant="outlined"
                  hide-details
                />
              </v-col>
              <v-col cols="12">
                <v-text-field
                  label="Личные долги (вычитаются)"
                  :model-value="manual.personalDebts"
                  @update:model-value="(v) => updateManual('personalDebts', v)"
                  type="number"
                  suffix="₽"
                  density="comfortable"
                  variant="outlined"
                  hint="Что должны вы — вычитается из облагаемой базы"
                  persistent-hint
                />
              </v-col>
            </v-row>
          </v-card>
        </v-col>

        <!-- Right side: result -->
        <v-col cols="12" lg="4">
          <v-card rounded="lg" elevation="0" class="result-card position-sticky" style="top: 80px;">
            <div class="result-header">
              <v-icon icon="mdi-hand-coin-outline" size="22" />
              <span>Сумма закята</span>
            </div>
            <div class="result-body">
              <div class="result-amount">{{ formatRub(calculation?.zakatAmount ?? 0) }}</div>
              <div class="result-meta" v-if="calculation && !calculation.meetsNisab">
                Облагаемая база <strong>{{ formatRub(calculation.taxableBase) }}</strong> ниже нисаба
                <strong>{{ formatRub(calculation.nisab.value) }}</strong> — закят не обязателен.
              </div>
              <div class="result-meta" v-else-if="calculation">
                <div class="d-flex justify-space-between mb-1">
                  <span>Облагаемая база</span>
                  <strong>{{ formatRub(calculation.taxableBase) }}</strong>
                </div>
                <div class="d-flex justify-space-between mb-1">
                  <span>Нисаб</span>
                  <strong>{{ formatRub(calculation.nisab.value) }}</strong>
                </div>
                <div class="d-flex justify-space-between">
                  <span>Ставка</span>
                  <strong>{{ Math.round(calculation.rate * 1000) / 10 }}%</strong>
                </div>
              </div>

              <v-btn
                v-if="calculation && calculation.meetsNisab"
                color="primary"
                block
                size="large"
                class="mt-4"
                prepend-icon="mdi-content-save-outline"
                :loading="saving"
                @click="onSavePayment"
              >
                Зафиксировать выплату
              </v-btn>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <!-- ── History tab ── -->
    <div v-else-if="tab === 'history'">
      <v-card rounded="lg" elevation="0" border class="pa-5">
        <h2 class="section-title mb-4">История выплат</h2>
        <div v-if="payments.length === 0" class="empty-state">
          <v-icon icon="mdi-history" size="40" class="empty-icon" />
          <div class="empty-title">Пока нет записей</div>
          <div class="empty-desc">После расчёта в калькуляторе вы сможете зафиксировать выплату — она появится здесь.</div>
        </div>
        <div v-else class="history-list">
          <div v-for="p in payments" :key="p.id" class="history-item">
            <div class="history-icon"><v-icon icon="mdi-hand-coin" size="22" /></div>
            <div class="history-info">
              <div class="history-amount">{{ formatRub(p.zakatAmount) }}</div>
              <div class="history-meta">
                Расчёт {{ formatDate(p.calculationDate) }}
                <template v-if="p.paidAt"> · Выплачено {{ formatDate(p.paidAt) }}</template>
              </div>
              <div v-if="p.recipientCategory || p.recipientNote" class="history-recipient">
                <span v-if="p.recipientCategory">{{ recipientLabel(p.recipientCategory) }}</span>
                <span v-if="p.recipientCategory && p.recipientNote"> · </span>
                <span v-if="p.recipientNote">{{ p.recipientNote }}</span>
              </div>
            </div>
            <button class="icon-btn" title="Удалить" @click="onDeletePayment(p.id)">
              <v-icon icon="mdi-delete-outline" size="18" />
            </button>
          </div>
        </div>
      </v-card>
    </div>

    <!-- ── Settings tab ── -->
    <div v-else-if="tab === 'settings'">
      <v-card rounded="lg" elevation="0" border class="pa-5" style="max-width: 720px;">
        <h2 class="section-title mb-4">Настройки закята</h2>

        <v-row dense>
          <v-col cols="12" md="6">
            <v-text-field
              label="Дата начала хаула"
              :model-value="hawlInputDate"
              @update:model-value="onHawlChange"
              type="date"
              density="comfortable"
              variant="outlined"
              hint="Когда вы впервые достигли нисаба или дата прошлой выплаты"
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              label="База нисаба"
              :model-value="settings?.nisabBase"
              @update:model-value="(v) => updateSettings({ nisabBase: v })"
              :items="[
                { value: 'GOLD', title: 'Золото (85 г)' },
                { value: 'SILVER', title: 'Серебро (595 г)' },
              ]"
              item-title="title"
              item-value="value"
              density="comfortable"
              variant="outlined"
              hint="По шафиитам и большинству — золото; по ханафитам — серебро (мягче для бедных)"
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              label="Цена золота за грамм"
              :model-value="settings?.goldPricePerGram"
              @update:model-value="(v) => updateSettings({ goldPricePerGram: +v })"
              type="number"
              suffix="₽"
              density="comfortable"
              variant="outlined"
              hint="Текущий курс 999-й пробы"
              persistent-hint
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              label="Цена серебра за грамм"
              :model-value="settings?.silverPricePerGram"
              @update:model-value="(v) => updateSettings({ silverPricePerGram: +v })"
              type="number"
              suffix="₽"
              density="comfortable"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12">
            <v-switch
              :model-value="settings?.remindersEnabled"
              @update:model-value="(v) => updateSettings({ remindersEnabled: v })"
              label="Напоминать о приближающемся хауле"
              hint="Уведомления за 30, 7 и 1 день до даты выплаты"
              persistent-hint
              color="primary"
              density="comfortable"
            />
          </v-col>
        </v-row>
      </v-card>
    </div>

    <!-- ── FAQ tab ── -->
    <div v-else-if="tab === 'faq'">
      <v-row dense>
        <v-col cols="12" md="6" v-for="(item, i) in faqItems" :key="i">
          <v-card rounded="lg" elevation="0" border class="pa-5 faq-card" :style="{ borderColor: item.color + '30' }">
            <div class="faq-icon" :style="{ background: item.color + '15', color: item.color }">
              <v-icon :icon="item.icon" size="22" />
            </div>
            <h3 class="faq-title">{{ item.title }}</h3>
            <p class="faq-text" v-html="item.body" />
          </v-card>
        </v-col>
      </v-row>
    </div>
  </div>

  <!-- Save payment dialog -->
  <v-dialog v-model="saveDialog" max-width="520">
    <v-card rounded="lg" class="pa-6">
      <h3 class="text-h6 font-weight-bold mb-2">Зафиксировать выплату</h3>
      <p class="text-body-2 text-medium-emphasis mb-4">
        Сумма закята: <strong>{{ formatRub(calculation?.zakatAmount ?? 0) }}</strong>
      </p>

      <v-text-field
        label="Дата выплаты"
        v-model="saveForm.paidAt"
        type="date"
        density="comfortable"
        variant="outlined"
        class="mb-3"
      />
      <v-select
        label="Категория получателя"
        v-model="saveForm.recipientCategory"
        :items="recipientItems"
        item-title="label"
        item-value="value"
        density="comfortable"
        variant="outlined"
        clearable
        class="mb-3"
      />
      <v-text-field
        label="Заметка (кому, как — опционально)"
        v-model="saveForm.recipientNote"
        density="comfortable"
        variant="outlined"
      />

      <div class="d-flex ga-3 mt-2">
        <v-btn variant="text" block @click="saveDialog = false">Отмена</v-btn>
        <v-btn color="primary" block :loading="saving" @click="onConfirmSave">Сохранить</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useToast } from '@/composables/useToast'
import { useIsDark } from '@/composables/useIsDark'
import { useZakat, RECIPIENT_LABELS, type ManualAssets, type RecipientCategory } from '@/composables/useZakat'

const { isDark } = useIsDark()
const { show: showToast } = useToast()

const {
  settings, calculation, payments, saving,
  fetchSettings, updateSettings: doUpdateSettings, calculate, fetchPayments,
  createPayment, deletePayment,
} = useZakat()

const tab = ref<'calc' | 'history' | 'settings' | 'faq'>('calc')

const manual = reactive<ManualAssets>({
  cash: 0,
  bank: 0,
  goldGrams: 0,
  silverGrams: 0,
  tradeGoods: 0,
  otherInvestments: 0,
  personalDebts: 0,
})

let calcDebounce: ReturnType<typeof setTimeout> | null = null
function recalculate() {
  if (calcDebounce) clearTimeout(calcDebounce)
  calcDebounce = setTimeout(() => {
    calculate({ manualAssets: { ...manual } }).catch(() => {})
  }, 350)
}

function updateManual(key: keyof ManualAssets, val: any) {
  ;(manual as any)[key] = val == null || val === '' ? 0 : Number(val)
  recalculate()
}

async function updateSettings(patch: any) {
  try {
    await doUpdateSettings(patch)
    recalculate()
  } catch (e: any) {
    showToast(e.message || 'Не удалось сохранить', 'error')
  }
}

const hawlInputDate = computed(() => settings.value?.hawlStartDate?.slice(0, 10) ?? '')
function onHawlChange(val: any) {
  const iso = val ? new Date(val).toISOString() : null
  updateSettings({ hawlStartDate: iso })
}

// Save payment dialog
const saveDialog = ref(false)
const saveForm = reactive<{
  paidAt: string
  recipientCategory: RecipientCategory | null
  recipientNote: string
}>({ paidAt: new Date().toISOString().slice(0, 10), recipientCategory: null, recipientNote: '' })

const recipientItems = Object.entries(RECIPIENT_LABELS).map(([value, label]) => ({ value, label }))

function onSavePayment() {
  saveForm.paidAt = new Date().toISOString().slice(0, 10)
  saveForm.recipientCategory = null
  saveForm.recipientNote = ''
  saveDialog.value = true
}

async function onConfirmSave() {
  if (!calculation.value) return
  try {
    await createPayment({
      breakdown: calculation.value,
      zakatAmount: calculation.value.zakatAmount,
      paidAt: saveForm.paidAt ? new Date(saveForm.paidAt).toISOString() : undefined,
      recipientCategory: saveForm.recipientCategory ?? undefined,
      recipientNote: saveForm.recipientNote || undefined,
    })
    saveDialog.value = false
    showToast('Выплата зафиксирована', 'success')
    tab.value = 'history'
  } catch (e: any) {
    showToast(e.message || 'Не удалось сохранить', 'error')
  }
}

async function onDeletePayment(id: string) {
  if (!confirm('Удалить эту запись?')) return
  try {
    await deletePayment(id)
    showToast('Запись удалена', 'success')
  } catch (e: any) {
    showToast(e.message || 'Не удалось удалить', 'error')
  }
}

// Helpers
function formatRub(v: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽'
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU')
}
function recipientLabel(c: RecipientCategory) {
  return RECIPIENT_LABELS[c]
}
function pluralizeRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

// FAQ content
const faqItems = [
  {
    icon: 'mdi-help-circle-outline',
    color: '#047857',
    title: 'Что такое закят',
    body: 'Закят — обязательный ежегодный «налог очищения» для мусульман. Один из пяти столпов ислама. Выплачивается с накоплений, превышающих нисаб, в размере <strong>2.5%</strong>. Исламский год — лунный, ≈ 354 дня.',
  },
  {
    icon: 'mdi-account-check-outline',
    color: '#3b82f6',
    title: 'Кто обязан платить',
    body: 'Каждый мусульманин (мужчина или женщина), достигший совершеннолетия, в здравом уме, чьи накопления превышают нисаб и удерживаются в течение полного лунного года (хаула).',
  },
  {
    icon: 'mdi-cash-multiple',
    color: '#f59e0b',
    title: 'Что облагается',
    body: 'Деньги (наличные, на счетах), <strong>дебиторская задолженность</strong> (если уверены в возврате), товары для продажи, золото и серебро. Свободный капитал и ожидаемые поступления — основа расчёта для предпринимателей.',
  },
  {
    icon: 'mdi-cancel',
    color: '#ef4444',
    title: 'Что не облагается',
    body: 'Личное жильё, машина для личного пользования, одежда, инструменты для работы. Личные долги (что вы должны другим) — вычитаются из облагаемой базы.',
  },
  {
    icon: 'mdi-scale-balance',
    color: '#8b5cf6',
    title: 'Нисаб',
    body: 'Минимальный порог. Эквивалент <strong>85 г золота</strong> (по шафиитам) или <strong>595 г серебра</strong> (по ханафитам). Если ваши накопления ниже — закят не обязателен.',
  },
  {
    icon: 'mdi-hand-heart-outline',
    color: '#06b6d4',
    title: 'Кому раздавать',
    body: '8 категорий получателей по аяту 60 суры «Ат-Тауба»: нуждающиеся, бедные, сборщики закята, те, чьи сердца склоняются к исламу, освобождение пленников, должники, на пути Аллаха, путники в нужде.',
  },
]

onMounted(async () => {
  await fetchSettings()
  await fetchPayments()
  recalculate()
})

watch(() => tab.value, (t) => {
  if (t === 'history') fetchPayments().catch(() => {})
})
</script>

<style scoped>
/* Hero */
.hero-card {
  overflow: hidden;
  background: linear-gradient(135deg, rgba(4, 120, 87, 0.04), rgba(4, 120, 87, 0.0));
  border: 1px solid rgba(4, 120, 87, 0.12);
}
.dark .hero-card {
  background: linear-gradient(135deg, rgba(74, 222, 128, 0.06), rgba(74, 222, 128, 0));
  border-color: rgba(74, 222, 128, 0.15);
}
.hero-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}
@media (max-width: 1024px) {
  .hero-grid { grid-template-columns: 1fr; }
}
.hero-text { padding: 24px 28px; }
.hero-eyebrow {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  color: rgb(4, 120, 87); background: rgba(4, 120, 87, 0.10);
  padding: 4px 10px; border-radius: 999px; margin-bottom: 12px;
}
.dark .hero-eyebrow { color: rgb(74, 222, 128); background: rgba(74, 222, 128, 0.10); }
.hero-title { font-size: 22px; font-weight: 700; line-height: 1.3; margin-bottom: 6px; color: rgba(var(--v-theme-on-surface), 0.95); }
.hero-desc { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.6); line-height: 1.55; margin: 0; }

.hero-stats {
  padding: 24px 28px;
  display: flex; flex-direction: column; gap: 16px; justify-content: center;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
@media (max-width: 1024px) {
  .hero-stats { border-left: none; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06); }
}
.hero-stat-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-bottom: 4px; }
.hero-stat-value { font-size: 22px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.hero-stat-unit { font-size: 14px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.5); margin-left: 4px; }
.hero-stat-action {
  font-size: 13px; font-weight: 600; color: rgb(4, 120, 87); background: none; border: none;
  cursor: pointer; padding: 0;
}

/* Tabs */
.tab-pills {
  display: inline-flex;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 12px;
  padding: 4px;
  gap: 2px;
  flex-wrap: wrap;
}
.dark .tab-pills { background: #1e1e2e; border-color: #2e2e42; }
.tab-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px; border: none; background: transparent;
  font-size: 13px; font-weight: 500; color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer; transition: background 0.15s, color 0.15s;
}
.tab-pill:hover:not(.active) { background: rgba(var(--v-theme-on-surface), 0.04); color: rgba(var(--v-theme-on-surface), 0.85); }
.tab-pill.active {
  background: rgb(var(--v-theme-surface)); color: rgba(var(--v-theme-on-surface), 0.95);
  font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.dark .tab-pill.active { background: #2a2a3e; }

.section-title { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.9); }
.block-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.5); margin-bottom: 8px;
}

/* Asset rows */
.asset-rows {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 10px; overflow: hidden;
}
.asset-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.asset-row:last-child { border-bottom: none; }
.asset-row--total { background: rgba(var(--v-theme-primary), 0.04); }
.asset-row--total .asset-name { font-weight: 700; }
.asset-row--total .asset-value { font-weight: 700; color: rgb(var(--v-theme-primary)); }
.asset-name { font-size: 14px; color: rgba(var(--v-theme-on-surface), 0.9); }
.asset-hint { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }
.asset-value { font-size: 14px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.9); }

/* Result card */
.result-card {
  background: linear-gradient(135deg, rgb(4, 120, 87), rgb(6, 95, 70));
  color: white;
  overflow: hidden;
}
.result-header {
  padding: 16px 20px;
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}
.result-body { padding: 24px 20px; }
.result-amount { font-size: 32px; font-weight: 800; margin-bottom: 16px; line-height: 1.1; }
.result-meta { font-size: 13px; opacity: 0.95; line-height: 1.5; }

/* History */
.history-list { display: flex; flex-direction: column; gap: 10px; }
.history-item {
  display: flex; align-items: center; gap: 14px;
  padding: 14px; border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.history-icon {
  width: 42px; height: 42px; border-radius: 10px;
  background: rgba(4, 120, 87, 0.10); color: rgb(4, 120, 87);
  display: flex; align-items: center; justify-content: center;
}
.history-info { flex: 1; min-width: 0; }
.history-amount { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); }
.history-meta { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); margin-top: 2px; }
.history-recipient { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.6); margin-top: 4px; }
.icon-btn {
  background: none; border: none; cursor: pointer;
  width: 32px; height: 32px; border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover { background: rgba(239, 68, 68, 0.10); color: rgb(239, 68, 68); }

/* Empty state */
.empty-state { text-align: center; padding: 40px 24px; }
.empty-icon { color: rgba(var(--v-theme-on-surface), 0.3); margin-bottom: 12px; }
.empty-title { font-size: 15px; font-weight: 600; color: rgba(var(--v-theme-on-surface), 0.85); margin-bottom: 4px; }
.empty-desc { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.5); }

/* FAQ */
.faq-card { height: 100%; }
.faq-icon {
  width: 40px; height: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; margin-bottom: 12px;
}
.faq-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.95); margin-bottom: 6px; }
.faq-text { font-size: 13px; color: rgba(var(--v-theme-on-surface), 0.65); line-height: 1.55; margin: 0; }
</style>
