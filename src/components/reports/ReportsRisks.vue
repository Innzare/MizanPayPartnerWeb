<script setup lang="ts">
import { computed } from 'vue'
import { formatCurrency } from '@/utils/formatters'
import type { ReportsRisks } from '@/types/reports'

const props = defineProps<{ data: ReportsRisks }>()

const hasOverdue = computed(() => props.data.overdueAmount > 0)

/** Чем дольше просрочка, тем тревожнее цвет корзины. */
const BUCKET_COLOR: Record<string, string> = {
  '1–7': '#10b981',
  '8–30': '#f59e0b',
  '31–60': '#f97316',
  '60+': '#ef4444',
}
const BUCKET_HINT: Record<string, string> = {
  '1–7': 'свежая — обычно платят сами',
  '8–30': 'стоит напомнить',
  '31–60': 'нужна работа с клиентом',
  '60+': 'высокий риск невозврата',
}

const maxBucket = computed(() => Math.max(...props.data.buckets.map((b) => b.amount), 1))
</script>

<template>
  <v-card rounded="lg" elevation="0" border class="pa-5 mb-6">
    <div class="rp-block-title">Просрочка</div>
    <div class="rp-block-sub">Состояние на сегодня — сколько денег задерживают клиенты</div>

    <div v-if="!hasOverdue" class="rk-clean">
      <v-icon icon="mdi-check-circle-outline" size="22" color="#10b981" />
      <div>
        <div class="rk-clean-title">Просрочки нет</div>
        <div class="rk-clean-sub">Все платежи по выбранным сделкам приходят в срок</div>
      </div>
    </div>

    <template v-else>
      <div class="rk-top">
        <div class="rk-main">
          <div class="rk-main-value">{{ formatCurrency(data.overdueAmount) }}</div>
          <div class="rk-main-label">
            задерживают по {{ data.overduePaymentsCount }} платежам
          </div>
        </div>
        <div class="rk-side">
          <div class="rk-side-item">
            <b>{{ data.overdueDealsCount }}</b>
            <span>сделок с долгом<template v-if="data.problemDealsSharePct != null"> · {{ data.problemDealsSharePct }}% активных</template></span>
          </div>
          <div class="rk-side-item">
            <b>{{ data.avgOverdueDays ?? '—' }} дн.</b>
            <span>средняя задержка · до {{ data.maxOverdueDays }} дн.</span>
          </div>
        </div>
      </div>

      <!-- Разбивка по давности: свежая просрочка и застарелая требуют разного -->
      <div class="rk-buckets">
        <div class="rk-buckets-title">Насколько давно просрочено</div>
        <div v-for="b in data.buckets" :key="b.label" class="rk-bucket">
          <div class="rk-bucket-head">
            <span class="rk-bucket-days" :style="{ color: BUCKET_COLOR[b.label] }">
              {{ b.label }} дн.
            </span>
            <span class="rk-bucket-hint">{{ BUCKET_HINT[b.label] }}</span>
            <span class="rk-bucket-sum">{{ formatCurrency(b.amount) }}</span>
          </div>
          <div class="rk-bucket-track">
            <div
              class="rk-bucket-fill"
              :style="{ width: Math.round((b.amount / maxBucket) * 100) + '%', background: BUCKET_COLOR[b.label] }"
            />
          </div>
        </div>
      </div>

      <div v-if="data.topDebtors.length" class="rk-debtors">
        <div class="rk-buckets-title">Кто больше всех должен</div>
        <div v-for="d in data.topDebtors" :key="d.name" class="rk-debtor">
          <span class="rk-debtor-name">{{ d.name }}</span>
          <span class="rk-debtor-meta">{{ d.maxDays }} дн.<template v-if="d.dealsCount > 1"> · {{ d.dealsCount }} сделки</template></span>
          <span class="rk-debtor-sum">{{ formatCurrency(d.amount) }}</span>
        </div>
      </div>
    </template>
  </v-card>
</template>

<style scoped>
.rp-block-title { font-size: 15px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.rp-block-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.45); margin-top: 2px; }

.rk-clean {
  display: flex; align-items: center; gap: 12px;
  margin-top: 14px; padding: 16px;
  border-radius: 12px;
  background: rgba(16, 185, 129, 0.07);
}
.rk-clean-title { font-size: 14px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.rk-clean-sub { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.5); }

.rk-top {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 16px;
  margin-top: 16px; padding: 14px 16px;
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.07);
}
.rk-main-value {
  font-size: 26px; font-weight: 800; color: #f59e0b;
  letter-spacing: -0.02em; line-height: 1.1;
}
.rk-main-label { font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.55); margin-top: 3px; }
.rk-side { display: flex; flex-wrap: wrap; gap: 20px; }
.rk-side-item { display: flex; flex-direction: column; gap: 1px; }
.rk-side-item b { font-size: 16px; font-weight: 700; color: rgba(var(--v-theme-on-surface), 0.85); }
.rk-side-item span { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.45); }

.rk-buckets, .rk-debtors {
  margin-top: 18px; padding-top: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.09);
}
.rk-buckets-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: rgba(var(--v-theme-on-surface), 0.42);
  margin-bottom: 10px;
}
.rk-bucket + .rk-bucket { margin-top: 12px; }
.rk-bucket-head {
  display: flex; align-items: baseline; gap: 8px;
  margin-bottom: 5px;
}
.rk-bucket-days { font-size: 13px; font-weight: 700; white-space: nowrap; }
.rk-bucket-hint {
  font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.42);
  flex: 1; min-width: 0;
}
.rk-bucket-sum {
  font-size: 13px; font-weight: 700; white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.rk-bucket-track {
  height: 7px; border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  overflow: hidden;
}
.rk-bucket-fill { height: 100%; border-radius: 4px; }

.rk-debtor {
  display: flex; align-items: baseline; gap: 10px;
  padding: 8px 2px;
}
.rk-debtor + .rk-debtor { box-shadow: inset 0 1px 0 rgba(var(--v-theme-on-surface), 0.05); }
.rk-debtor-name {
  font-size: 13px; font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rk-debtor-meta { font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.42); white-space: nowrap; }
.rk-debtor-sum {
  font-size: 13px; font-weight: 700; white-space: nowrap;
  color: #f59e0b;
}

@media (max-width: 600px) {
  .rk-main-value { font-size: 22px; }
}
</style>
