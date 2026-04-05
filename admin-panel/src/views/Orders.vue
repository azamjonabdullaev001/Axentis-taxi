<template>
  <div>
    <div class="page-header">
      <h2 class="page-title">История заказов</h2>
      <div class="filters">
        <select v-model="filterStatus" class="select-input">
          <option value="">Все статусы</option>
          <option value="completed">Завершённый</option>
          <option value="cancelled">Отменённый</option>
          <option value="in_progress">В пути</option>
          <option value="accepted">Принят</option>
          <option value="searching">Поиск</option>
          <option value="pending">Ожидание</option>
        </select>
        <input v-model="search" class="text-input" placeholder="Поиск по имени или телефону..." />
      </div>
    </div>

    <div class="table-card">
      <template v-if="loading">
        <div v-for="i in 8" :key="i" class="sk-row">
          <div class="sk sk-cell-sm"></div>
          <div class="sk sk-cell-md"></div>
          <div class="sk sk-cell-md"></div>
          <div class="sk sk-cell-sm"></div>
          <div class="sk sk-cell-lg"></div>
          <div class="sk sk-cell-lg"></div>
          <div class="sk sk-cell-sm"></div>
        </div>
      </template>
      <div v-else-if="filtered.length === 0" class="empty">Нет заказов</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Пассажир</th>
              <th>Водитель</th>
              <th>Машина</th>
              <th>Откуда</th>
              <th>Куда</th>
              <th>Км</th>
              <th>Осн.</th>
              <th>Ожид.</th>
              <th>Сервис</th>
              <th>Итого</th>
              <th>Цен.коэф.</th>
              <th>Статус</th>
              <th>Создан</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in filtered" :key="o.id">
              <td class="mono">{{ o.id.slice(0,8) }}</td>
              <td>
                <div class="user-cell">{{ o.passenger_name || '—' }}</div>
                <small>{{ o.passenger_phone || '—' }}</small>
              </td>
              <td>
                <div class="user-cell">{{ o.driver_name || '—' }}</div>
                <small>{{ o.driver_phone || '—' }}</small>
              </td>
              <td><span class="car-badge">{{ o.car_number || '—' }}</span></td>
              <td><small>{{ coordOrAddr(o.pickup_address, o.pickup_lat, o.pickup_lng) }}</small></td>
              <td><small>{{ coordOrAddr(o.destination_address, o.dest_lat, o.dest_lng) }}</small></td>
              <td>{{ o.distance_km ? Number(o.distance_km).toFixed(2) : '—' }}</td>
              <td>{{ fmt(o.base_price) }}</td>
              <td>{{ fmt(o.waiting_fee) }}</td>
              <td>{{ fmt(o.service_fee) }}</td>
              <td class="bold">{{ fmt(o.total_price) }}</td>
              <td>{{ o.surge_multiplier ? `×${Number(o.surge_multiplier).toFixed(2)}` : '×1.00' }}</td>
              <td><span :class="['badge', o.status]">{{ statusLabel(o.status) }}</span></td>
              <td><small>{{ fmtDate(o.created_at) }}</small></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { adminAPI } from '../services/api'

const orders = ref([])
const loading = ref(true)
const filterStatus = ref('')
const search = ref('')

onMounted(async () => {
  try {
    const { data } = await adminAPI.getOrders()
    orders.value = data.orders || []
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  let list = orders.value
  if (filterStatus.value) list = list.filter(o => o.status === filterStatus.value)
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    list = list.filter(o =>
      (o.passenger_name || '').toLowerCase().includes(q) ||
      (o.passenger_phone || '').includes(q) ||
      (o.driver_name || '').toLowerCase().includes(q) ||
      (o.driver_phone || '').includes(q) ||
      (o.car_number || '').toLowerCase().includes(q)
    )
  }
  return list
})

function fmt(v) { return v ? Number(v).toLocaleString('ru-RU') + ' с' : '—' }
function fmtDate(d) { return d ? new Date(d).toLocaleString('ru-RU') : '—' }
function coordOrAddr(addr, lat, lng) {
  if (addr) return addr
  if (lat && lng) return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`
  return '—'
}
function statusLabel(s) {
  const m = { pending:'Ожидание', searching:'Поиск', accepted:'Принят', arrived:'На месте', in_progress:'В пути', completed:'Завершён', cancelled:'Отменён' }
  return m[s] || s
}
</script>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 22px; }
.page-title { font-size: 22px; font-weight: 800; color: #1a1a1a; }
.filters { display: flex; gap: 10px; }
.select-input, .text-input {
  padding: 10px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 14px; outline: none;
}
.select-input:focus, .text-input:focus { border-color: #FFCC00; }
.text-input { min-width: 240px; }
.table-card { background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 1px 8px rgba(0,0,0,.06); }
.table-wrap { overflow-x: auto; }
.empty { color: #aaa; font-size: 14px; padding: 20px 0; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; white-space: nowrap; }
.table th { background: #f8f9fb; padding: 10px 10px; text-align: left; color: #666; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; }
.table td { padding: 10px; border-bottom: 1px solid #f5f5f5; vertical-align: middle; }
.table tr:hover td { background: #fafafa; }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.sk { background: linear-gradient(90deg, #f0f0f0 25%, #e4e4e4 50%, #f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 6px; }
.sk-row { display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid #f5f5f5; align-items: center; }
.sk-cell-sm  { height: 13px; width: 60px; }
.sk-cell-md  { height: 13px; width: 110px; }
.sk-cell-lg  { height: 13px; width: 160px; }
.table tr:last-child td { border-bottom: none; }
.mono { font-family: monospace; color: #999; }
.user-cell { font-weight: 600; font-size: 13px; color: #1a1a1a; }
.car-badge {
  display: inline-block; background: #1a1a1a; color: #FFCC00;
  border-radius: 6px; padding: 2px 8px; font-family: monospace; font-size: 12px;
}
.bold { font-weight: 700; }
.badge {
  display: inline-block; padding: 3px 10px; border-radius: 20px;
  font-size: 12px; font-weight: 600;
}
.badge.completed { background: #e8f5e9; color: #2e7d32; }
.badge.cancelled { background: #fce4ec; color: #c62828; }
.badge.in_progress { background: #e3f2fd; color: #1565c0; }
.badge.accepted, .badge.arrived { background: #fff8e1; color: #f57f17; }
.badge.searching, .badge.pending { background: #f3f4f6; color: #666; }
</style>
