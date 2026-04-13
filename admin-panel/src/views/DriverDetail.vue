<template>
  <div>
    <div class="top-bar">
      <button class="back-btn" @click="$router.back()">← Назад</button>
      <div v-if="info" class="driver-header">
        <img v-if="info.avatar_url && info.avatar_url.startsWith('/')" :src="info.avatar_url" class="driver-avatar" />
        <span v-else class="driver-avatar-placeholder">{{ ((info.first_name || '?')[0]).toUpperCase() }}</span>
        <h2 class="page-title">
          🚗 {{ info.first_name }} {{ info.last_name }}
          <small class="sub">{{ info.phone }} · {{ info.car_number }}</small>
        </h2>
      </div>
    </div>

    <!-- Period selector -->
    <div class="period-bar">
      <button
        v-for="p in periods" :key="p.value"
        :class="['period-btn', selectedPeriod === p.value && 'active']"
        @click="changePeriod(p.value)"
      >{{ p.label }}</button>

      <template v-if="selectedPeriod === 'custom'">
        <input type="date" v-model="dateFrom" class="date-input" @change="load" />
        <span class="sep">—</span>
        <input type="date" v-model="dateTo" class="date-input" @change="load" />
      </template>
    </div>

    <div v-if="loading" class="loading">Загрузка...</div>

    <template v-else-if="info">
      <!-- Summary cards -->
      <div class="cards-row">
        <div class="stat-card">
          <div class="stat-label">Общая выручка</div>
          <div class="stat-value">{{ fmt(info.total_revenue) }} <small>сум</small></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Комиссия компании ({{ info.commission_pct }}%)</div>
          <div class="stat-value red">{{ fmt(info.company_share) }} <small>сум</small></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Заработок водителя</div>
          <div class="stat-value green">{{ fmt(info.driver_earnings) }} <small>сум</small></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Поездок</div>
          <div class="stat-value">{{ info.total_orders }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Баланс</div>
          <div class="stat-value">{{ fmt(info.balance) }} <small>сум</small></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Рефералов привлёк</div>
          <div class="stat-value">{{ info.referral_count }}</div>
        </div>
      </div>

      <!-- Company earnings from this driver (all-time) -->
      <div class="section-card company-earnings">
        <h3>💼 Заработок системы от этого водителя</h3>
        <div class="cards-row">
          <div class="stat-card">
            <div class="stat-label">Комиссия за период</div>
            <div class="stat-value red">{{ fmt(info.company_share) }} <small>сум</small></div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Комиссия за всё время</div>
            <div class="stat-value" style="color: #E65100">{{ fmt(info.total_company_earnings) }} <small>сум</small></div>
          </div>
        </div>
      </div>

      <!-- Progress section -->
      <div class="section-card progress-section">
        <h3>📊 Прогресс водителя</h3>
        <div class="progress-grid">
          <div class="progress-item">
            <div class="progress-header">
              <span class="progress-label">Всего заказов</span>
              <span class="progress-rank">{{ driverRank }}</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar" :style="{ width: orderProgressPct + '%', background: orderProgressColor }"></div>
            </div>
            <div class="progress-footer">
              <span>{{ info.lifetime_trips || info.total_orders || 0 }}</span>
              <span class="progress-pct" :style="{ color: orderProgressColor }">{{ orderProgressPct }}%</span>
              <span>{{ orderMilestone }}</span>
            </div>
          </div>
          <div class="progress-item">
            <div class="progress-header">
              <span class="progress-label">Выручка за период</span>
              <span class="progress-value green-text">{{ fmt(info.total_revenue) }} сум</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar" :style="{ width: revenueProgressPct + '%', background: '#4CAF50' }"></div>
            </div>
            <div class="progress-footer">
              <span>0</span>
              <span class="progress-pct" style="color: #4CAF50">{{ revenueProgressPct }}%</span>
              <span>{{ fmt(revenueMilestone) }}</span>
            </div>
          </div>
          <div class="progress-item">
            <div class="progress-header">
              <span class="progress-label">Комиссия ({{ info.commission_pct }}%)</span>
              <span class="progress-value red-text">{{ fmt(info.company_share) }} сум</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar commission-bar" :style="{ width: commissionBarPct + '%' }"></div>
            </div>
            <div class="progress-footer">
              <span>Водитель: {{ fmt(info.driver_earnings) }}</span>
              <span class="progress-pct" style="color: #e53935">{{ info.commission_pct }}%</span>
              <span>Компания: {{ fmt(info.company_share) }}</span>
            </div>
          </div>
          <div class="progress-item" v-if="info.referral_count > 0">
            <div class="progress-header">
              <span class="progress-label">Привлёк рефералов</span>
              <span class="progress-value" style="color: #FF9800">{{ info.referral_count }}</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar" :style="{ width: Math.min(info.referral_count * 10, 100) + '%', background: '#FF9800' }"></div>
            </div>
            <div class="progress-footer">
              <span>0</span>
              <span class="progress-pct" style="color: #FF9800">{{ Math.min(info.referral_count * 10, 100) }}%</span>
              <span>10</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Referral info -->
      <div class="section-card referral-section">
        <h3>Реферальная информация</h3>
        <div class="ref-grid">
          <div class="ref-item">
            <span class="ref-lbl">Мой реферальный код</span>
            <code class="ref-code">{{ info.referral_code || '—' }}</code>
          </div>
          <div class="ref-item">
            <span class="ref-lbl">Пришёл по коду</span>
            <code v-if="info.referred_by" class="ref-code referred">{{ info.referred_by }}</code>
            <span v-else class="no-ref">Нет</span>
          </div>
          <div class="ref-item">
            <span class="ref-lbl">Тип бонуса</span>
            <span v-if="info.referral_benefit_type === 'commission'" class="badge commission">📉 Снижена комиссия</span>
            <span v-else-if="info.referral_benefit_type === 'bonus'" class="badge bonus">🎁 Еженедельный бонус</span>
            <span v-else class="badge none">Не выбран</span>
          </div>
          <div class="ref-item">
            <span class="ref-lbl">% комиссии</span>
            <b>{{ info.commission_pct }}%</b>
          </div>
          <div class="ref-item">
            <span class="ref-lbl">Дата регистрации</span>
            <span>{{ fmtDate(info.created_at) }}</span>
          </div>
        </div>
      </div>

      <!-- Daily breakdown chart / table -->
      <div class="section-card">
        <h3>📅 Ежедевная статистика</h3>
        <div v-if="info.daily.length === 0" class="empty">Нет поездок за выбранный период</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Поездок</th>
              <th>Выручка</th>
              <th>Комиссия ({{ info.commission_pct }}%)</th>
              <th>Заработок</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in info.daily" :key="d.date">
              <td>{{ fmtDate(d.date) }}</td>
              <td>{{ d.orders }}</td>
              <td>{{ fmt(d.revenue) }} сум</td>
              <td class="red-text">{{ fmt(d.commission) }} сум</td>
              <td class="green-text"><b>{{ fmt(d.revenue - d.commission) }} сум</b></td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td><b>Итого</b></td>
              <td><b>{{ info.total_orders }}</b></td>
              <td><b>{{ fmt(info.total_revenue) }} сум</b></td>
              <td class="red-text"><b>{{ fmt(info.company_share) }} сум</b></td>
              <td class="green-text"><b>{{ fmt(info.driver_earnings) }} сум</b></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { adminAPI } from '../services/api'

const route = useRoute()
const driverID = route.params.id

const info = ref(null)
const loading = ref(true)
const selectedPeriod = ref('week')
const dateFrom = ref('')
const dateTo = ref('')

const periods = [
  { value: 'day',   label: 'Сегодня' },
  { value: 'week',  label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'custom', label: 'Период' },
]

onMounted(() => load())

async function load() {
  loading.value = true
  try {
    const params = { period: selectedPeriod.value }
    if (selectedPeriod.value === 'custom') {
      if (dateFrom.value) params.date_from = dateFrom.value
      if (dateTo.value) params.date_to = dateTo.value
    }
    const { data } = await adminAPI.getDriverAnalytics(driverID, params)
    info.value = data
  } finally {
    loading.value = false
  }
}

function changePeriod(p) {
  selectedPeriod.value = p
  if (p !== 'custom') load()
}

function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') }
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU')
}

// Progress computations
const milestones = [10, 50, 100, 250, 500, 1000, 2500, 5000]
const ranks = {
  0: '🆕 Новичок', 10: '🔰 Активный', 50: '🚗 Водитель', 100: '⭐ Опытный',
  250: '🥉 Эксперт', 500: '🥈 Мастер', 1000: '🥇 Профи', 2500: '🏆 Легенда', 5000: '👑 Легенда+'
}

const trips = computed(() => info.value?.lifetime_trips || info.value?.total_orders || 0)
const orderMilestone = computed(() => milestones.find(m => trips.value < m) || milestones[milestones.length - 1])
const prevMilestone = computed(() => {
  const idx = milestones.indexOf(orderMilestone.value)
  return idx > 0 ? milestones[idx - 1] : 0
})
const orderProgressPct = computed(() => {
  if (orderMilestone.value <= prevMilestone.value) return 100
  return Math.min(Math.round((trips.value - prevMilestone.value) / (orderMilestone.value - prevMilestone.value) * 100), 100)
})
const orderProgressColor = computed(() => {
  if (trips.value >= 1000) return '#FFD700'
  if (trips.value >= 500) return '#4CAF50'
  if (trips.value >= 100) return '#2196F3'
  return '#FF9800'
})
const driverRank = computed(() => {
  const t = trips.value
  const keys = Object.keys(ranks).map(Number).sort((a, b) => b - a)
  for (const k of keys) { if (t >= k) return ranks[k] }
  return ranks[0]
})

const revenueMilestones = [500000, 2000000, 5000000, 10000000, 50000000, 100000000]
const revenueMilestone = computed(() => revenueMilestones.find(m => (info.value?.total_revenue || 0) < m) || revenueMilestones[revenueMilestones.length - 1])
const revenueProgressPct = computed(() => Math.min(Math.round((info.value?.total_revenue || 0) / revenueMilestone.value * 100), 100))
const commissionBarPct = computed(() => info.value?.commission_pct || 10)
</script>

<style scoped>
.top-bar { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
.driver-header { display: flex; align-items: center; gap: 14px; }
.driver-avatar { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; border: 3px solid #FFCC00; }
.driver-avatar-placeholder {
  width: 52px; height: 52px; border-radius: 50%; background: #FFCC00; color: #1a1a1a;
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 20px; flex-shrink: 0;
}
.back-btn {
  padding: 8px 16px; background: #1a1a1a; color: #FFCC00;
  border: none; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer;
}
.back-btn:hover { opacity: .8; }
.page-title { font-size: 20px; font-weight: 800; margin: 0; }
.page-title small { font-size: 13px; font-weight: 400; color: #888; margin-left: 10px; }

.period-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
.period-btn {
  padding: 8px 16px; background: #f5f6fa; border: 1.5px solid #e0e0e0;
  border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer;
}
.period-btn.active { background: #FFCC00; border-color: #FFCC00; }
.period-btn:hover:not(.active) { background: #ffe; }
.date-input { padding: 8px 12px; border: 1.5px solid #e0e0e0; border-radius: 10px; font-size: 13px; outline: none; }
.date-input:focus { border-color: #FFCC00; }
.sep { color: #aaa; font-size: 16px; }

.loading { color: #aaa; font-size: 14px; padding: 40px; text-align: center; }
.cards-row { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; }
.stat-card {
  flex: 1; min-width: 140px; background: #fff; border-radius: 16px;
  padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,.07);
}
.stat-label { font-size: 12px; color: #888; margin-bottom: 8px; }
.stat-value { font-size: 22px; font-weight: 800; }
.stat-value.red { color: #e53935; }
.stat-value.green { color: #43a047; }
.stat-value small { font-size: 13px; font-weight: 400; color: #aaa; }

.section-card { background: #fff; border-radius: 18px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,.07); margin-bottom: 24px; }
.section-card h3 { font-size: 16px; font-weight: 700; margin-bottom: 18px; }
.empty { color: #aaa; font-size: 14px; }

.referral-section {}
.ref-grid { display: flex; flex-wrap: wrap; gap: 20px; }
.ref-item { display: flex; flex-direction: column; gap: 4px; }
.ref-lbl { font-size: 12px; color: #888; }
.ref-code { background: #fff3cd; color: #856404; padding: 4px 10px; border-radius: 8px; font-size: 15px; font-family: monospace; letter-spacing: 3px; font-weight: 700; }
.ref-code.referred { background: #e8f5e9; color: #2e7d32; }
.no-ref { color: #ccc; font-size: 14px; }
.badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
.badge.commission { background: #e3f2fd; color: #1565c0; }
.badge.bonus { background: #f3e5f5; color: #7b1fa2; }
.badge.none { background: #f5f5f5; color: #999; }

.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f5f6fa; padding: 10px 12px; text-align: left; color: #666; font-weight: 600; }
.table td { padding: 11px 12px; border-bottom: 1px solid #f0f0f0; }
.table tfoot td { border-top: 2px solid #eee; border-bottom: none; }
.red-text { color: #e53935; }
.green-text { color: #43a047; }
.total-row td { font-size: 14px; }

.progress-section { }
.progress-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
.progress-item { background: #f8f9fc; border-radius: 14px; padding: 18px; }
.progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.progress-label { font-size: 13px; color: #666; font-weight: 600; }
.progress-rank { font-size: 13px; font-weight: 700; }
.progress-value { font-size: 15px; font-weight: 800; }
.progress-bar-wrap { height: 10px; background: #e0e0e0; border-radius: 5px; overflow: hidden; margin-bottom: 8px; }
.progress-bar { height: 100%; border-radius: 5px; transition: width 0.6s ease; min-width: 2px; }
.commission-bar { background: linear-gradient(90deg, #e53935, #ff7043); }
.progress-footer { display: flex; justify-content: space-between; font-size: 11px; color: #999; }
.progress-pct { font-weight: 700; font-size: 12px; }
</style>
