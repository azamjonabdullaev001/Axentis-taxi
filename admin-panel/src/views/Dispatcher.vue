<template>
  <div class="page">
    <div class="page-header">
      <h1>📞 Диспетчерский центр</h1>
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
          <label>Адрес пассажира *</label>
          <div class="address-row">
            <div class="autocomplete-wrap">
              <input
                ref="addrInput"
                v-model="form.pickup_address"
                placeholder="Город, район, улица..."
                autocomplete="off"
                @input="onAddressInput"
                @keydown.down.prevent="highlightNext"
                @keydown.up.prevent="highlightPrev"
                @keydown.enter.prevent="selectHighlighted"
                @blur="hideSuggestionsDelayed"
                @focus="showExisting"
              />
              <ul v-if="suggestions.length > 0 && suggestionsVisible" class="suggestions">
                <li
                  v-for="(s, i) in suggestions"
                  :key="i"
                  :class="{ highlighted: i === highlightIdx }"
                  @mousedown.prevent="selectSuggestion(s)"
                >
                  <span class="sug-icon">📍</span>
                  <span class="sug-text">{{ s.display_name }}</span>
                </li>
              </ul>
            </div>
            <button class="map-btn" title="Выбрать на карте" @click="openMap">
              🗺️
            </button>
          </div>
          <div v-if="geocodeResult" class="geo-result">
            📍 {{ geocodeResult }}
          </div>
        </div>
      </div>

      <div v-if="error" class="error-msg">{{ error }}</div>
      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>

      <button class="submit-btn" :disabled="loading" @click="createOrder">
        {{ loading ? 'Создание...' : '📬 Создать заказ и найти водителя' }}
      </button>
    </div>

    <!-- Map modal -->
    <div v-if="mapOpen" class="map-overlay" @click.self="closeMap">
      <div class="map-modal">
        <div class="map-modal-header">
          <h3>Выберите место на карте</h3>
          <button class="close-modal-btn" @click="closeMap">✕</button>
        </div>
        <div ref="mapContainer" class="map-container"></div>
        <div v-if="mapAddress" class="map-address-bar">
          📍 {{ mapAddress }}
        </div>
        <div class="map-modal-footer">
          <button class="cancel-btn" @click="closeMap">Отмена</button>
          <button class="confirm-btn" :disabled="!mapLat" @click="confirmMapSelection">
            ✓ Подтвердить место
          </button>
        </div>
      </div>
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
            <th>Адрес</th>
            <th>Статус</th>
            <th>Водитель</th>
            <th>Время</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in callOrders" :key="order.id">
            <td><span class="phone">{{ order.passenger_phone }}</span></td>
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
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { adminAPI } from '../services/api'

/* ── state ── */
const loading = ref(false)
const loadingOrders = ref(false)
const error = ref('')
const successMsg = ref('')
const geocodeResult = ref('')
const callOrders = ref([])

const resolvedLat = ref(null)
const resolvedLng = ref(null)

const form = ref({ passenger_phone: '', pickup_address: '' })

/* autocomplete */
const suggestions = ref([])
const suggestionsVisible = ref(false)
const highlightIdx = ref(-1)
const addrInput = ref(null)
let debounceTimer = null

/* map modal */
const mapOpen = ref(false)
const mapContainer = ref(null)
const mapAddress = ref('')
const mapLat = ref(null)
const mapLng = ref(null)
let leafletMap = null
let leafletMarker = null
let leafletLoaded = false

/* ── Nominatim autocomplete ── */
function onAddressInput() {
  clearTimeout(debounceTimer)
  const q = form.value.pickup_address.trim()
  if (q.length < 2) { suggestions.value = []; return }
  debounceTimer = setTimeout(() => searchAddress(q), 350)
}

async function searchAddress(q) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=7&countrycodes=uz&addressdetails=1&accept-language=ru`
    const res = await fetch(url, { headers: { 'User-Agent': 'AxentisTaxiAdmin/1.0' } })
    const data = await res.json()
    suggestions.value = data
    suggestionsVisible.value = data.length > 0
    highlightIdx.value = -1
  } catch {
    suggestions.value = []
  }
}

function selectSuggestion(s) {
  form.value.pickup_address = s.display_name
  resolvedLat.value = parseFloat(s.lat)
  resolvedLng.value = parseFloat(s.lon)
  geocodeResult.value = s.display_name
  suggestions.value = []
  suggestionsVisible.value = false
}

function highlightNext() {
  if (highlightIdx.value < suggestions.value.length - 1) highlightIdx.value++
}
function highlightPrev() {
  if (highlightIdx.value > 0) highlightIdx.value--
}
function selectHighlighted() {
  if (highlightIdx.value >= 0 && suggestions.value[highlightIdx.value]) {
    selectSuggestion(suggestions.value[highlightIdx.value])
  }
}
function hideSuggestionsDelayed() {
  setTimeout(() => { suggestionsVisible.value = false }, 200)
}
function showExisting() {
  if (suggestions.value.length) suggestionsVisible.value = true
}

/* ── Leaflet map ── */
async function loadLeaflet() {
  if (leafletLoaded) return
  // CSS
  if (!document.querySelector('link[href*="leaflet"]')) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
  }
  // JS
  if (!window.L) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
  }
  leafletLoaded = true
}

async function openMap() {
  mapOpen.value = true
  mapAddress.value = ''
  mapLat.value = resolvedLat.value
  mapLng.value = resolvedLng.value

  await loadLeaflet()
  await nextTick()
  // Small delay for DOM
  setTimeout(initMap, 100)
}

function initMap() {
  if (!mapContainer.value || !window.L) return
  const L = window.L

  const center = (mapLat.value && mapLng.value)
    ? [mapLat.value, mapLng.value]
    : [40.78, 72.34] // Andijan default

  leafletMap = L.map(mapContainer.value).setView(center, 13)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OSM',
    maxZoom: 19,
  }).addTo(leafletMap)

  if (mapLat.value && mapLng.value) {
    leafletMarker = L.marker([mapLat.value, mapLng.value]).addTo(leafletMap)
    reverseGeocode(mapLat.value, mapLng.value)
  }

  leafletMap.on('click', (e) => {
    const { lat, lng } = e.latlng
    mapLat.value = lat
    mapLng.value = lng
    if (leafletMarker) leafletMarker.setLatLng([lat, lng])
    else leafletMarker = L.marker([lat, lng]).addTo(leafletMap)
    reverseGeocode(lat, lng)
  })
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru`
    const res = await fetch(url, { headers: { 'User-Agent': 'AxentisTaxiAdmin/1.0' } })
    const data = await res.json()
    mapAddress.value = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    mapAddress.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

function confirmMapSelection() {
  resolvedLat.value = mapLat.value
  resolvedLng.value = mapLng.value
  form.value.pickup_address = mapAddress.value
  geocodeResult.value = mapAddress.value
  closeMap()
}

function closeMap() {
  mapOpen.value = false
  if (leafletMap) { leafletMap.remove(); leafletMap = null; leafletMarker = null }
}

/* ── Orders ── */
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

  if (!form.value.passenger_phone.trim()) { error.value = 'Введите телефон клиента'; return }
  if (!form.value.pickup_address.trim()) { error.value = 'Введите адрес пассажира'; return }

  // Auto-geocode if not resolved yet
  if (!resolvedLat.value || !resolvedLng.value) {
    await searchAndResolveFirst()
    if (!resolvedLat.value || !resolvedLng.value) {
      error.value = 'Не удалось определить координаты. Уточните адрес или выберите на карте.'
      return
    }
  }

  loading.value = true
  try {
    await adminAPI.createCallOrder({
      passenger_phone: form.value.passenger_phone.trim(),
      pickup_lat: resolvedLat.value,
      pickup_lng: resolvedLng.value,
      pickup_address: form.value.pickup_address.trim(),
      destination_lat: 0,
      destination_lng: 0,
      destination_address: '',
      distance_km: 0,
    })
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

async function searchAndResolveFirst() {
  const q = form.value.pickup_address.trim()
  if (!q) return
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=uz&accept-language=ru`
    const res = await fetch(url, { headers: { 'User-Agent': 'AxentisTaxiAdmin/1.0' } })
    const data = await res.json()
    if (data.length > 0) {
      resolvedLat.value = parseFloat(data[0].lat)
      resolvedLng.value = parseFloat(data[0].lon)
      geocodeResult.value = data[0].display_name
    }
  } catch {}
}

function statusLabel(s) {
  const map = {
    searching: '🔍 Поиск', accepted: '✅ Принят', arrived: '📍 Прибыл',
    in_progress: '🚖 В пути', completed: '✔️ Завершён', cancelled: '❌ Отменён',
  }
  return map[s] || s
}
function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => { loadOrders() })
onBeforeUnmount(() => { clearTimeout(debounceTimer); if (leafletMap) leafletMap.remove() })
</script>

<style scoped>
.page { padding: 28px 32px; max-width: 900px; margin: 0 auto; }
.page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.page-header h1 { margin: 0; font-size: 24px; font-weight: 800; }

.card { background: #fff; border-radius: 16px; padding: 24px; margin-bottom: 24px; box-shadow: 0 2px 12px rgba(0,0,0,.07); }
.form-card h2, .card h2 { margin: 0 0 20px; font-size: 18px; font-weight: 700; }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 12px; font-weight: 600; color: #555; }
.form-group input {
  padding: 12px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 14px; outline: none; transition: border-color .2s;
  width: 100%; box-sizing: border-box;
}
.form-group input:focus { border-color: #FFCC00; }

.address-row { display: flex; gap: 8px; }
.autocomplete-wrap { position: relative; flex: 1; }
.autocomplete-wrap input { width: 100%; }

.suggestions {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 100;
  background: #fff; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px;
  max-height: 240px; overflow-y: auto; list-style: none; margin: 0; padding: 0;
  box-shadow: 0 6px 20px rgba(0,0,0,.12);
}
.suggestions li {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 14px; cursor: pointer; font-size: 13px;
  border-bottom: 1px solid #f5f5f5; transition: background .15s;
}
.suggestions li:hover, .suggestions li.highlighted { background: #fff9e0; }
.sug-icon { flex-shrink: 0; }
.sug-text { line-height: 1.4; }

.map-btn {
  padding: 10px 14px; border-radius: 10px;
  border: 1.5px solid #e0e0e0; background: #f5f5f5;
  cursor: pointer; font-size: 18px; white-space: nowrap;
  transition: background .2s;
}
.map-btn:hover { background: #fff3cd; border-color: #FFCC00; }

.geo-result { font-size: 12px; color: #2e7d32; background: #e8f5e9; padding: 6px 10px; border-radius: 8px; margin-top: 6px; }
.error-msg { color: #c62828; background: #ffebee; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
.success-msg { color: #2e7d32; background: #e8f5e9; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }

.submit-btn {
  background: #FFCC00; color: #1a1a1a; border: none; border-radius: 12px;
  padding: 14px 28px; font-size: 15px; font-weight: 700;
  cursor: pointer; transition: opacity .2s;
}
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.submit-btn:hover:not(:disabled) { opacity: 0.88; }

/* ── Map modal ── */
.map-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.5); display: flex; justify-content: center; align-items: center;
}
.map-modal {
  width: 780px; max-width: 94vw; background: #fff; border-radius: 16px;
  overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 10px 40px rgba(0,0,0,.2);
}
.map-modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #eee;
}
.map-modal-header h3 { margin: 0; font-size: 16px; font-weight: 700; }
.close-modal-btn {
  background: none; border: none; font-size: 20px; cursor: pointer; color: #666;
  padding: 4px 8px; border-radius: 8px;
}
.close-modal-btn:hover { background: #f5f5f5; }
.map-container { height: 440px; width: 100%; }
.map-address-bar {
  padding: 10px 20px; background: #f9f9f9; border-top: 1px solid #eee;
  font-size: 13px; color: #333;
}
.map-modal-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 14px 20px; border-top: 1px solid #eee;
}
.cancel-btn {
  padding: 10px 20px; border-radius: 10px; border: 1px solid #ddd;
  background: #f5f5f5; cursor: pointer; font-size: 14px;
}
.cancel-btn:hover { background: #eee; }
.confirm-btn {
  padding: 10px 20px; border-radius: 10px; border: none;
  background: #FFCC00; color: #1a1a1a; font-size: 14px; font-weight: 700;
  cursor: pointer; transition: opacity .2s;
}
.confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.confirm-btn:hover:not(:disabled) { opacity: 0.88; }

/* ── Orders table ── */
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
.orders-table td { padding: 12px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
.phone { font-weight: 600; }
.status-badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
.status-badge.searching { background: #e3f2fd; color: #1565c0; }
.status-badge.accepted { background: #e8f5e9; color: #2e7d32; }
.status-badge.arrived { background: #f3e5f5; color: #6a1b9a; }
.status-badge.in_progress { background: #fff8e1; color: #e65100; }
.status-badge.completed { background: #e8f5e9; color: #1b5e20; }
.status-badge.cancelled { background: #ffebee; color: #b71c1c; }
</style>
