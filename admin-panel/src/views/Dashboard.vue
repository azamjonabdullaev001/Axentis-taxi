<template>
  <div>
    <h2 class="page-title">Dashboard</h2>
    <div v-if="loading" class="loading">Загрузка...</div>
    <div v-else class="cards">
      <div class="card yellow">
        <div class="card-icon">📦</div>
        <div class="card-label">Всего заказов</div>
        <div class="card-value">{{ stats.totalOrders }}</div>
      </div>
      <div class="card green">
        <div class="card-icon">💵</div>
        <div class="card-label">Общая выручка</div>
        <div class="card-value">{{ formatSum(stats.totalRevenue) }}</div>
      </div>
      <div class="card blue">
        <div class="card-icon">🚖</div>
        <div class="card-label">Активных водителей</div>
        <div class="card-value">{{ stats.activeDrivers }}</div>
      </div>
      <div class="card purple">
        <div class="card-icon">👤</div>
        <div class="card-label">Пассажиров</div>
        <div class="card-value">{{ stats.totalPassengers }}</div>
      </div>
    </div>

    <div class="recent-section">
      <h3>Последние заказы</h3>
      <div v-if="recentOrders.length === 0" class="empty">Нет данных</div>
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
            <td class="id-cell">{{ o.id.slice(0,8) }}...</td>
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
import { ref, onMounted } from 'vue'
import { adminAPI } from '../services/api'

const loading = ref(true)
const stats = ref({ totalOrders: 0, totalRevenue: 0, activeDrivers: 0, totalPassengers: 0 })
const recentOrders = ref([])

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
.loading { color: #888; font-size: 15px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px; margin-bottom: 32px; }
.card {
  background: #fff; border-radius: 18px; padding: 24px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,.07);
  display: flex; flex-direction: column; gap: 8px;
}
.card-icon { font-size: 28px; }
.card-label { font-size: 13px; color: #888; font-weight: 500; }
.card-value { font-size: 26px; font-weight: 800; color: #1a1a1a; }
.card.yellow .card-value { color: #e6b800; }
.card.green .card-value { color: #2ecc71; }
.card.blue .card-value { color: #2196F3; }
.card.purple .card-value { color: #9c27b0; }
.recent-section { background: #fff; border-radius: 18px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,.07); }
.recent-section h3 { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
.empty { color: #aaa; font-size: 14px; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f5f6fa; padding: 10px 12px; text-align: left; color: #666; font-weight: 600; }
.table td { padding: 11px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.id-cell { font-family: monospace; color: #999; }
.badge {
  display: inline-block; padding: 3px 10px; border-radius: 20px;
  font-size: 12px; font-weight: 600;
}
.badge.completed { background: #e8f5e9; color: #2e7d32; }
.badge.cancelled { background: #fce4ec; color: #c62828; }
.badge.in_progress { background: #e3f2fd; color: #1565c0; }
.badge.accepted { background: #fff8e1; color: #f57f17; }
.badge.searching, .badge.pending { background: #f3f4f6; color: #666; }
</style>
