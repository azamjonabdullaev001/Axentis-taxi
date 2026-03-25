<template>
  <div class="page">
    <div class="page-header">
      <h1>📞 Диспетчерский центр</h1>
      <div class="mode-badge" :class="taxiMode === 'royal' ? 'royal' : 'yandex'">
        Режим: {{ taxiMode === 'royal' ? '👑 Royal' : '🚖 Yandex' }}
      </div>
    </div>

    <!-- Create call order form -->
    <div class="card form-card">
      <h2>Новый звонковый заказ</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>Телефон клиента *</label>
          <input v-model="form.passenger_phone" placeholder="+998XXXXXXXXX" type="tel" />
        </div>
        <div class="form-group">
          <label>Адрес посадки *</label>
          <div class="address-row">
            <input
              v-model="form.pickup_address"
              placeholder="Введите адрес или название места..."
              @keyup.enter="geocodeAddress"
            />
            <button class="geo-btn" :disabled="geocoding" @click="geocodeAddress">
              {{ geocoding ? '...' : '🔍' }}
            </button>
          </div>
          <div v-if="geocodeResult" class="geo-result">
            📍 {{ geocodeResult }}
          </div>
          <div v-if="geocodeError" class="geo-error">{{ geocodeError }}</div>
        </div>
      </div>

      <div v-if="error" class="error-msg">{{ error }}</div>
      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>

      <button class="submit-btn" :disabled="loading" @click="createOrder">
        {{ loading ? 'Создание...' : '📬 Создать заказ и найти водителя' }}
      </button>
    </div>

    <!-- Recent call orders -->
    <div class="card">
      <div class="orders-header">
        <h2>Последние звонковые заказы</h2>
        <button class="refresh-btn" @click="loadOrders">🔄 Обновить</button>
      </div>

      <div v-if="loadingOrders" class="loading">Загрузка...</div>

      <div v-else-if="callOrders.length === 0" class="empty">
        Нет звонковых заказов
      </div>

      <table v-else class="orders-table">
        <thead>
          <tr>
            <th>Клиент</th>
            <th>Адрес посадки</th>
            <th>Статус</th>
            <th>Водитель</th>
            <th>Время</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in callOrders" :key="order.id">
            <td>
              <span class="phone">{{ order.passenger_phone }}</span>
            </td>
            <td>{{ order.pickup_address || '—' }}</td>
            <td><span :class="['status-badge', order.status]">{{ statusLabel(order.status) }}</span></td>
            <td>{{ order.driver_name || '—' }}</td>
            <td>{{ formatTime(order.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { adminAPI } from '../services/api'

const taxiMode = ref('yandex')
const loading = ref(false)
const loadingOrders = ref(false)
const geocoding = ref(false)
const error = ref('')
const successMsg = ref('')
const geocodeResult = ref('')
const geocodeError = ref('')
const callOrders = ref([])

// Resolved lat/lng from Nominatim (hidden from user)
const resolvedLat = ref(null)
const resolvedLng = ref(null)

const form = ref({
  passenger_phone: '',
  pickup_address: '',
})

async function geocodeAddress() {
  const addr = form.value.pickup_address.trim()
  if (!addr) return
  geocoding.value = true
  geocodeResult.value = ''
  geocodeError.value = ''
  resolvedLat.value = null
  resolvedLng.value = null
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1&addressdetails=1`
    const res = await fetch(url, { headers: { 'Accept-Language': 'ru', 'User-Agent': 'AxentisTaxiAdmin/1.0' } })
    const data = await res.json()
    if (data.length > 0) {
      resolvedLat.value = parseFloat(data[0].lat)
      resolvedLng.value = parseFloat(data[0].lon)
      geocodeResult.value = data[0].display_name
    } else {
      geocodeError.value = 'Адрес не найден. Попробуйте другой ввод.'
    }
  } catch {
    geocodeError.value = 'Ошибка геокодирования. Проверьте соединение.'
  } finally {
    geocoding.value = false
  }
}

async function loadMode() {
  try {
    const { data } = await adminAPI.getTaxiMode()
    taxiMode.value = data.mode || 'yandex'
  } catch {}
}

async function loadOrders() {
  loadingOrders.value = true
  try {
    const { data } = await adminAPI.getOrders()
    callOrders.value = (data.orders || []).filter((o) => o.order_type === 'call')
  } catch {
    callOrders.value = []
  } finally {
    loadingOrders.value = false
  }
}

async function createOrder() {
  error.value = ''
  successMsg.value = ''

  if (!form.value.passenger_phone.trim()) {
    error.value = 'Введите телефон клиента'
    return
  }
  if (!form.value.pickup_address.trim()) {
    error.value = 'Введите адрес посадки'
    return
  }

  // Auto-geocode if not done yet
  if (!resolvedLat.value || !resolvedLng.value) {
    await geocodeAddress()
    if (!resolvedLat.value || !resolvedLng.value) {
      error.value = geocodeError.value || 'Не удалось определить координаты адреса. Уточните адрес.'
      return
    }
  }

  loading.value = true
  try {
    const payload = {
      passenger_phone: form.value.passenger_phone.trim(),
      pickup_lat: resolvedLat.value,
      pickup_lng: resolvedLng.value,
      pickup_address: form.value.pickup_address.trim(),
      destination_lat: 0,
      destination_lng: 0,
      destination_address: '',
      distance_km: 0,
    }
    const { data } = await adminAPI.createCallOrder(payload)
    successMsg.value = `✅ Заказ создан. Ищем водителя рядом с «${form.value.pickup_address}»...`
    form.value = { passenger_phone: '', pickup_address: '' }
    resolvedLat.value = null
    resolvedLng.value = null
    geocodeResult.value = ''
    loadOrders()
  } catch (e) {
    error.value = e.response?.data?.error || 'Ошибка создания заказа'
  } finally {
    loading.value = false
  }
}

function statusLabel(s) {
  const map = {
    searching: '🔍 Поиск',
    accepted: '✅ Принят',
    arrived: '📍 Прибыл',
    in_progress: '🚖 В пути',
    completed: '✔️ Завершён',
    cancelled: '❌ Отменён',
  }
  return map[s] || s
}

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

onMounted(() => {
  loadMode()
  loadOrders()
})
</script>

<style scoped>
.page { padding: 28px 32px; max-width: 900px; margin: 0 auto; }
.page-header {
  display: flex; align-items: center; gap: 16px;
  margin-bottom: 24px;
}
.page-header h1 { margin: 0; font-size: 24px; font-weight: 800; }
.mode-badge {
  padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700;
}
.mode-badge.royal { background: #fff3cd; color: #856404; }
.mode-badge.yandex { background: #e3f2fd; color: #1565c0; }

.card { background: #fff; border-radius: 16px; padding: 24px; margin-bottom: 24px; box-shadow: 0 2px 12px rgba(0,0,0,.07); }
.form-card h2, .card h2 { margin: 0 0 20px; font-size: 18px; font-weight: 700; }

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 12px; font-weight: 600; color: #555; }
.form-group input {
  padding: 12px 14px;
  border: 1.5px solid #e0e0e0;
  border-radius: 10px;
  font-size: 14px;
  outline: none;
  transition: border-color .2s;
  width: 100%;
  box-sizing: border-box;
}
.form-group input:focus { border-color: #FFCC00; }

.address-row { display: flex; gap: 8px; }
.address-row input { flex: 1; }
.geo-btn {
  padding: 10px 14px; border-radius: 10px;
  border: 1.5px solid #e0e0e0; background: #f5f5f5;
  cursor: pointer; font-size: 16px; white-space: nowrap;
}
.geo-btn:hover:not(:disabled) { background: #eee; }
.geo-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.geo-result { font-size: 12px; color: #2e7d32; background: #e8f5e9; padding: 6px 10px; border-radius: 8px; }
.geo-error { font-size: 12px; color: #c62828; }

.error-msg { color: #c62828; background: #ffebee; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
.success-msg { color: #2e7d32; background: #e8f5e9; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }

.submit-btn {
  background: #FFCC00; color: #1a1a1a;
  border: none; border-radius: 12px;
  padding: 14px 28px; font-size: 15px; font-weight: 700;
  cursor: pointer; transition: opacity .2s;
}
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.submit-btn:hover:not(:disabled) { opacity: 0.88; }

.orders-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.orders-header h2 { margin: 0; font-size: 18px; font-weight: 700; }
.refresh-btn {
  background: #f5f5f5; border: 1px solid #ddd; border-radius: 8px;
  padding: 8px 14px; font-size: 13px; cursor: pointer;
}
.refresh-btn:hover { background: #eee; }

.loading, .empty { text-align: center; color: #888; padding: 32px; }

.orders-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.orders-table th {
  text-align: left; padding: 10px 12px;
  background: #f8f8f8; border-bottom: 2px solid #eee;
  font-size: 12px; color: #666; font-weight: 600;
}
.orders-table td {
  padding: 12px 12px; border-bottom: 1px solid #f0f0f0;
  vertical-align: middle;
}
.phone { font-weight: 600; }

.status-badge {
  display: inline-block; padding: 4px 10px;
  border-radius: 20px; font-size: 11px; font-weight: 600;
}
.status-badge.searching { background: #e3f2fd; color: #1565c0; }
.status-badge.accepted { background: #e8f5e9; color: #2e7d32; }
.status-badge.arrived { background: #f3e5f5; color: #6a1b9a; }
.status-badge.in_progress { background: #fff8e1; color: #e65100; }
.status-badge.completed { background: #e8f5e9; color: #1b5e20; }
.status-badge.cancelled { background: #ffebee; color: #b71c1c; }
</style>
