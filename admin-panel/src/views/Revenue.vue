<template>
  <div>
    <h2 class="page-title">Выручка</h2>
    <div v-if="loading" class="loading">Загрузка...</div>
    <div v-else>
      <div class="cards">
        <div class="card">
          <div class="card-label">Общая выручка</div>
          <div class="card-value">{{ fmt(data.total_revenue) }}</div>
        </div>
        <div class="card">
          <div class="card-label">Наша доля ({{ sharePercent }}%)</div>
          <div class="card-value green">{{ fmt(ourShare) }}</div>
        </div>
        <div class="card">
          <div class="card-label">Всего заказов</div>
          <div class="card-value">{{ data.total_orders || 0 }}</div>
        </div>
        <div class="card">
          <div class="card-label">Выплачено водителям</div>
          <div class="card-value yellow">{{ fmt(driverShare) }}</div>
        </div>
      </div>

      <div class="share-section">
        <div class="section-card">
          <h3>Настройка доли сервиса</h3>
          <div class="share-row">
            <span class="share-label">Доля сервиса: <b>{{ sharePercent }}%</b></span>
            <input
              type="range" v-model.number="sharePercent"
              min="0" max="15" step="1"
              class="range-input"
            />
            <div class="range-marks">
              <span>0%</span><span>5%</span><span>10%</span><span>15%</span>
            </div>
          </div>
          <div class="share-calc">
            <div class="calc-row">
              <span>Общая выручка</span><span>{{ fmt(data.total_revenue) }}</span>
            </div>
            <div class="calc-row green">
              <span>Наша доля ({{ sharePercent }}%)</span><span>{{ fmt(ourShare) }}</span>
            </div>
            <div class="calc-row yellow">
              <span>Водителям ({{ 100 - sharePercent }}%)</span><span>{{ fmt(driverShare) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="chart-section">
        <div class="section-card">
          <h3>Последние 7 дней</h3>
          <div v-if="chartData.labels.length === 0" class="empty">Нет данных для графика</div>
          <Bar v-else :data="chartData" :options="chartOptions" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js'
import { adminAPI } from '../services/api'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

const data = ref({})
const loading = ref(true)
const sharePercent = ref(10)

onMounted(async () => {
  try {
    const { data: d } = await adminAPI.getRevenue()
    data.value = d
  } finally {
    loading.value = false
  }
})

const ourShare = computed(() => (data.value.total_revenue || 0) * sharePercent.value / 100)
const driverShare = computed(() => (data.value.total_revenue || 0) - ourShare.value)

const chartData = computed(() => {
  const daily = data.value.daily_revenue || []
  return {
    labels: daily.map(d => d.date),
    datasets: [{
      label: 'Выручка (сум)',
      data: daily.map(d => d.revenue),
      backgroundColor: '#FFCC00',
      borderRadius: 8,
    }]
  }
})
const chartOptions = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: { y: { beginAtZero: true } }
}

function fmt(v) { return Number(v || 0).toLocaleString('ru-RU') + ' сум' }
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 800; margin-bottom: 24px; }
.loading { color: #888; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px; margin-bottom: 28px; }
.card {
  background: #fff; border-radius: 18px; padding: 24px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,.07);
}
.card-label { font-size: 13px; color: #888; margin-bottom: 6px; }
.card-value { font-size: 24px; font-weight: 800; color: #1a1a1a; }
.card-value.green { color: #2e7d32; }
.card-value.yellow { color: #e6b800; }
.share-section, .chart-section { margin-bottom: 24px; }
.section-card { background: #fff; border-radius: 18px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,.07); }
.section-card h3 { font-size: 16px; font-weight: 700; margin-bottom: 18px; }
.share-row { display: flex; flex-direction: column; gap: 8px; }
.share-label { font-size: 15px; font-weight: 600; }
.range-input { width: 100%; accent-color: #FFCC00; height: 8px; }
.range-marks { display: flex; justify-content: space-between; font-size: 12px; color: #aaa; margin-top: 4px; }
.share-calc { margin-top: 20px; border: 1.5px solid #f0f0f0; border-radius: 12px; overflow: hidden; }
.calc-row { display: flex; justify-content: space-between; padding: 13px 16px; font-size: 14px; border-bottom: 1px solid #f0f0f0; }
.calc-row:last-child { border-bottom: none; }
.calc-row.green { color: #2e7d32; font-weight: 700; }
.calc-row.yellow { color: #b8860b; font-weight: 700; }
.empty { color: #aaa; font-size: 14px; }
</style>
