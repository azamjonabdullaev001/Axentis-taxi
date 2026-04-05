<template>
  <div>
    <h2 class="page-title">Dashboard</h2>

    <!-- Skeleton loader -->
    <div v-if="loading" class="cards">
      <div v-for="i in 4" :key="i" class="card">
        <div class="sk sk-icon"></div>
        <div class="sk sk-label"></div>
        <div class="sk sk-value"></div>
      </div>
    </div>

    <!-- Stats cards -->
    <div v-else class="cards">
      <div class="card">
        <div class="card-icon-wrap" style="background:#fff8e1">
          <svg viewBox="0 0 24 24" fill="none" stroke="#e6a800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
        </div>
        <div class="card-label">Всего заказов</div>
        <div class="card-value">{{ stats.totalOrders }}</div>
      </div>
      <div class="card">
        <div class="card-icon-wrap" style="background:#e8f5e9">
          <svg viewBox="0 0 24 24" fill="none" stroke="#2e7d32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        </div>
        <div class="card-label">Общая выручка</div>
        <div class="card-value" style="color:#2e7d32">{{ formatSum(stats.totalRevenue) }}</div>
      </div>
      <div class="card">
        <div class="card-icon-wrap" style="background:#e3f2fd">
          <svg viewBox="0 0 24 24" fill="none" stroke="#1565c0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
        </div>
        <div class="card-label">Активных водителей</div>
        <div class="card-value" style="color:#1565c0">{{ stats.activeDrivers }}</div>
      </div>
      <div class="card">
        <div class="card-icon-wrap" style="background:#f3e5f5">
          <svg viewBox="0 0 24 24" fill="none" stroke="#6a1b9a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
        </div>
        <div class="card-label">Пассажиров</div>
        <div class="card-value" style="color:#6a1b9a">{{ stats.totalPassengers }}</div>
      </div>
    </div>

    <!-- Orders per day chart -->
    <div v-if="!loading && chartData.labels.length > 1" class="section-card chart-section">
      <div class="section-header">
        <h3>Заказы по дням</h3>
        <span class="section-badge">последние 14 дней</span>
      </div>
      <Line :data="chartData" :options="chartOptions" style="max-height:220px" />
    </div>

    <!-- Recent orders table -->
    <div class="recent-section">
      <div class="section-header">
        <h3>Последние заказы</h3>
        <span class="section-badge">{{ recentOrders.length }} записей</span>
      </div>

      <!-- Skeleton table -->
      <template v-if="loading">
        <div v-for="i in 5" :key="i" class="sk-row">
          <div class="sk sk-cell-sm"></div>
          <div class="sk sk-cell-md"></div>
          <div class="sk sk-cell-lg"></div>
          <div class="sk sk-cell-sm"></div>
          <div class="sk sk-cell-sm"></div>
        </div>
      </template>

      <div v-else-if="recentOrders.length === 0" class="empty">Нет данных</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Пассажир</th>
            <th>Маршрут</th>
            <th>Сумма</th>
            <th>Статус</th>
            <th>Время</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in recentOrders" :key="o.id">
            <td class="id-cell">{{ o.id.slice(0,8) }}…</td>
            <td>{{ o.passenger_name || '—' }}<br><small>{{ o.passenger_phone || '—' }}</small></td>
            <td><small>{{ o.pickup_address || coordStr(o.pickup_lat, o.pickup_lng) }}</small> →<br><small>{{ o.dest_address || coordStr(o.dest_lat, o.dest_lng) }}</small></td>
            <td>{{ formatSum(o.total_price) }}</td>
            <td><span :class="['badge', o.status]">{{ statusLabel(o.status) }}</span></td>
            <td><small>{{ formatDate(o.created_at) }}</small></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Line } from 'vue-chartjs'
import { Chart as ChartJS, Title, Tooltip, Legend, LineElement, PointElement, CategoryScale, LinearScale, Filler } from 'chart.js'
import { adminAPI } from '../services/api'

ChartJS.register(Title, Tooltip, Legend, LineElement, PointElement, CategoryScale, LinearScale, Filler)

const loading = ref(true)
const stats = ref({ totalOrders: 0, totalRevenue: 0, activeDrivers: 0, totalPassengers: 0 })
const recentOrders = ref([])
const allOrders = ref([])

onMounted(async () => {
  try {
    const [ordersRes, revenueRes, usersRes] = await Promise.all([
      adminAPI.getOrders(),
      adminAPI.getRevenue(),
      adminAPI.getUsers()
    ])
    const orders = ordersRes.data.orders || []
    const revenue = revenueRes.data
    const allUsers = (usersRes.data.users || [])
    allOrders.value = orders
    stats.value = {
      totalOrders: orders.length,
      totalRevenue: revenue.total_revenue || 0,
      activeDrivers: allUsers.filter(u => u.role === 'driver' && u.is_available).length,
      totalPassengers: allUsers.filter(u => u.role === 'passenger').length
    }
    recentOrders.value = orders.slice(0, 10)
  } finally {
    loading.value = false
  }
})

// Build last-14-days order count chart from loaded orders
const chartData = computed(() => {
  const days = []
  const counts = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push(d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }))
    const count = allOrders.value.filter(o => o.created_at && o.created_at.slice(0, 10) === key).length
    counts.push(count)
  }
  return {
    labels: days,
    datasets: [{
      label: 'Заказы',
      data: counts,
      borderColor: '#FFCC00',
      backgroundColor: 'rgba(255,204,0,0.1)',
      borderWidth: 2.5,
      pointBackgroundColor: '#FFCC00',
      pointRadius: 4,
      tension: 0.4,
      fill: true,
    }]
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#999' } },
    y: { beginAtZero: true, grid: { color: '#f0f0f0' }, ticks: { stepSize: 1, font: { size: 11 }, color: '#999' } },
  },
}

function formatSum(v) { return Number(v || 0).toLocaleString('ru-RU') + ' сум' }
function coordStr(lat, lng) { return lat && lng ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : '—' }
function statusLabel(s) {
  const m = { pending:'Ожидание', searching:'Поиск', accepted:'Принят', arrived:'На месте', in_progress:'В пути', completed:'Завершён', cancelled:'Отменён' }
  return m[s] || s
}
function formatDate(d) { return d ? new Date(d).toLocaleString('ru-RU') : '—' }
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 800; color: #1a1a1a; margin-bottom: 24px; }

/* ── Skeleton ── */
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.sk {
  background: linear-gradient(90deg, #f0f0f0 25%, #e4e4e4 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 8px;
}
.sk-icon  { width: 40px; height: 40px; border-radius: 10px; }
.sk-label { width: 80px; height: 13px; margin-top: 8px; }
.sk-value { width: 110px; height: 28px; margin-top: 6px; }
.sk-row   { display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
.sk-cell-sm  { height: 14px; width: 70px;  border-radius: 6px; }
.sk-cell-md  { height: 14px; width: 130px; border-radius: 6px; }
.sk-cell-lg  { height: 14px; width: 200px; border-radius: 6px; }

/* ── Cards ── */
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px; margin-bottom: 24px; }
.card {
  background: #fff; border-radius: 16px; padding: 22px 20px;
  box-shadow: 0 1px 8px rgba(0,0,0,.06);
  display: flex; flex-direction: column; gap: 10px;
  border-left: 4px solid transparent;
}
.card-icon-wrap {
  width: 40px; height: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.card-icon-wrap svg { width: 20px; height: 20px; }
.card-label { font-size: 12px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }
.card-value { font-size: 28px; font-weight: 800; color: #1a1a1a; line-height: 1; }

/* ── Chart section ── */
.chart-section { margin-bottom: 24px; }
.section-card { background: #fff; border-radius: 16px; padding: 22px; box-shadow: 0 1px 8px rgba(0,0,0,.06); }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.section-header h3 { font-size: 15px; font-weight: 700; color: #1a1a1a; margin: 0; }
.section-badge { font-size: 12px; color: #999; background: #f5f5f5; padding: 3px 10px; border-radius: 20px; }

/* ── Recent orders ── */
.recent-section { background: #fff; border-radius: 16px; padding: 22px; box-shadow: 0 1px 8px rgba(0,0,0,.06); }
.empty { color: #aaa; font-size: 14px; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f8f9fb; padding: 10px 12px; text-align: left; color: #666; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; }
.table td { padding: 11px 12px; border-bottom: 1px solid #f5f5f5; vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.table tr:hover td { background: #fafafa; }
.id-cell { font-family: monospace; color: #bbb; font-size: 12px; }
.badge {
  display: inline-block; padding: 3px 10px; border-radius: 20px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.2px;
}
.badge.completed  { background: #e8f5e9; color: #2e7d32; }
.badge.cancelled  { background: #fce4ec; color: #c62828; }
.badge.in_progress { background: #e3f2fd; color: #1565c0; }
.badge.accepted   { background: #fff8e1; color: #f57f17; }
.badge.arrived    { background: #fff3e0; color: #e65100; }
.badge.searching, .badge.pending { background: #f3f4f6; color: #666; }
</style>
