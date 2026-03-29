<template>
  <div class="page">
    <div class="page-header">
      <h1>📞 Диспетчерский центр</h1>
    </div>

    <!-- ═══════ 1. Create call order form ═══════ -->
    <div class="card form-card">
      <h2>Новый звонковый заказ</h2>
      <div class="form-grid">
        <div class="form-group">
          <label>Телефон клиента *</label>
          <div class="phone-input-wrap">
            <span class="phone-prefix">+998</span>
            <input
              v-model="phoneDigits"
              placeholder="XX XXX XX XX"
              type="tel"
              maxlength="9"
              @input="onPhoneInput"
              @blur="onPhoneBlur"
            />
          </div>
          <!-- Address history suggestions -->
          <div v-if="phoneAddresses.length > 0" class="phone-history">
            <div class="phone-history-label">📋 Прошлые адреса:</div>
            <div
              v-for="(a, i) in phoneAddresses"
              :key="i"
              class="phone-history-item"
              @click="selectPhoneAddress(a)"
            >
              📌 {{ a.address }}
            </div>
          </div>
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
              <ul v-if="(regionHits.length > 0 || suggestions.length > 0) && suggestionsVisible" class="suggestions">
                <li v-if="regionHits.length" class="sug-group-label">🇺🇿 Регионы Узбекистана</li>
                <li
                  v-for="(r, ri) in regionHits"
                  :key="'r'+ri"
                  :class="{ highlighted: ri === highlightIdx }"
                  @mousedown.prevent="selectRegionHit(r)"
                >
                  <span class="sug-icon">📌</span>
                  <span class="sug-text">
                    <strong>{{ r.name }}</strong>
                    <span class="sug-path">{{ r.region }} → {{ r.district }}</span>
                  </span>
                </li>
                <li v-if="suggestions.length" class="sug-group-label">🌍 OpenStreetMap</li>
                <li
                  v-for="(s, i) in suggestions"
                  :key="'n'+i"
                  :class="{ highlighted: (regionHits.length + i) === highlightIdx }"
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
        <div class="form-group">
          <label>Доп. информация (ориентир)</label>
          <input v-model="form.additional_info" placeholder="возле магазина Аббас, ул. Амуртимур 12..." />
        </div>
      </div>

      <div v-if="error" class="error-msg">{{ error }}</div>
      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>

      <button class="submit-btn" :disabled="loading" @click="createOrder">
        {{ loading ? 'Создание...' : '📬 Создать заказ и найти водителя' }}
      </button>
    </div>

    <!-- ═══════ 2. Online drivers map ═══════ -->
    <div class="card">
      <div class="drivers-header">
        <h2>� Онлайн водители <span v-if="onlineDrivers.length" class="driver-count">({{ onlineDrivers.length }})</span></h2>
        <button class="refresh-btn" @click="loadOnlineDrivers()">🔄 Обновить</button>
      </div>

      <div v-if="loadingDrivers" class="loading">Загрузка карты...</div>

      <div v-show="!loadingDrivers" class="drivers-map-wrap">
        <div ref="driversMapContainer" class="drivers-map-container"></div>

        <!-- No drivers overlay -->
        <div v-if="!loadingDrivers && onlineDrivers.length === 0" class="map-empty-overlay">
          🚕 Нет онлайн водителей
        </div>

        <!-- Driver info popup (floats over map, bottom-left) -->
        <transition name="popup-slide">
          <div v-if="activeDriver" class="driver-popup">
            <div class="driver-popup-header">
              <div class="drv-popup-avatar">
                <img v-if="activeDriver.avatar_url" :src="avatarSrc(activeDriver.avatar_url)" @error="$event.target.style.display='none'" />
                <div v-else class="drv-popup-avatar-ph">{{ activeDriver.first_name?.charAt(0) || '?' }}</div>
              </div>
              <div class="drv-popup-info">
                <div class="drv-popup-name">{{ activeDriver.first_name }} {{ activeDriver.last_name }}</div>
                <div class="drv-popup-meta">🚗 {{ activeDriver.car_number }} · {{ activeDriver.phone }}</div>
                <span :class="['drv-popup-status', activeDriver.is_available ? 'free' : 'busy']">
                  {{ activeDriver.is_available ? '✅ Свободен' : '🚖 Занят' }}
                </span>
              </div>
              <button class="drv-popup-close" @click="activeDriver = null">✕</button>
            </div>
            <div v-if="activeDriver.has_order" class="drv-popup-order">
              <div class="drv-prow"><b>Статус:</b> {{ orderStatusLabel(activeDriver.order_status) }}</div>
              <div class="drv-prow"><b>Пассажир:</b> {{ activeDriver.passenger_phone }}</div>
              <div v-if="activeDriver.pickup_address" class="drv-prow"><b>Откуда:</b> {{ activeDriver.pickup_address }}</div>
              <div v-if="activeDriver.destination_address" class="drv-prow"><b>Куда:</b> {{ activeDriver.destination_address }}</div>
              <button class="drv-route-btn" @click="showRouteOnMap(activeDriver)">🗺️ Показать маршрут</button>
            </div>
            <div v-else class="drv-popup-free">Водитель свободен, заказа нет.</div>
          </div>
        </transition>

        <!-- Route clear button -->
        <button v-if="routeActive" class="route-clear-btn" @click="clearRouteOverlays">✕ Скрыть маршрут</button>
      </div>
    </div>

    <!-- Map modal (address picker) -->
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

    <!-- ═══════ 3. Recent call orders ═══════ -->
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
            <th>Доп. инфо</th>
            <th>Статус</th>
            <th>Водитель</th>
            <th>Время</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in callOrders" :key="order.id">
            <td><span class="phone">{{ order.passenger_phone }}</span></td>
            <td>{{ order.pickup_address || '—' }}</td>
            <td>{{ order.additional_info || '—' }}</td>
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
import { searchLocations } from '../data/uzbekistan-regions'

/* ── state ── */
const loading = ref(false)
const loadingOrders = ref(false)
const loadingDrivers = ref(false)
const error = ref('')
const successMsg = ref('')
const geocodeResult = ref('')
const callOrders = ref([])
const onlineDrivers = ref([])
const activeDriver = ref(null)
const routeActive = ref(false)

const resolvedLat = ref(null)
const resolvedLng = ref(null)

const phoneDigits = ref('')
const phoneAddresses = ref([])
let phoneDebounce = null

const form = ref({ pickup_address: '', additional_info: '' })

/* autocomplete */
const suggestions = ref([])
const regionHits = ref([])
const suggestionsVisible = ref(false)
const highlightIdx = ref(-1)
const addrInput = ref(null)
let debounceTimer = null

/* map modal (address picker) */
const mapOpen = ref(false)
const mapContainer = ref(null)
const mapAddress = ref('')
const mapLat = ref(null)
const mapLng = ref(null)
let addrPickerMap = null
let addrPickerMarker = null

/* drivers map – Leaflet + OSM (free, no key) */
const driversMapContainer = ref(null)
let driversMap = null
let driverMarkers = {}
let routePolyline = null
let routeMarkers = []
let driversMapFitted = false

/* Leaflet single-load (CSS + JS) */
let leafletPromise = null
function loadLeaflet() {
  if (window.L) return Promise.resolve()
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.setAttribute('data-leaflet', '1')
      document.head.appendChild(link)
    }
    const s = document.createElement('script')
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
  return leafletPromise
}

/* auto-refresh */
let ordersInterval = null
let driversInterval = null

/* ── Phone input ── */
function onPhoneInput() {
  phoneDigits.value = phoneDigits.value.replace(/\D/g, '').slice(0, 9)
  clearTimeout(phoneDebounce)
  if (phoneDigits.value.length >= 9) {
    phoneDebounce = setTimeout(lookupPhoneHistory, 300)
  } else {
    phoneAddresses.value = []
  }
}

function onPhoneBlur() {
  if (phoneDigits.value.length >= 9) lookupPhoneHistory()
}

async function lookupPhoneHistory() {
  const full = '+998' + phoneDigits.value
  try {
    const { data } = await adminAPI.getPhoneHistory(full)
    phoneAddresses.value = data.addresses || []
  } catch {
    phoneAddresses.value = []
  }
}

function selectPhoneAddress(a) {
  form.value.pickup_address = a.address
  resolvedLat.value = a.lat
  resolvedLng.value = a.lng
  geocodeResult.value = a.address
  phoneAddresses.value = []
}

/* ── Nominatim autocomplete ── */
function onAddressInput() {
  clearTimeout(debounceTimer)
  const q = form.value.pickup_address.trim()
  if (q.length < 1) { suggestions.value = []; regionHits.value = []; return }
  regionHits.value = searchLocations(q, 8)
  if (regionHits.value.length > 0) {
    suggestionsVisible.value = true
    highlightIdx.value = -1
  }
  if (q.length >= 2) {
    debounceTimer = setTimeout(() => searchAddress(q), 350)
  } else {
    suggestions.value = []
  }
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

function selectRegionHit(r) {
  form.value.pickup_address = r.fullPath
  resolvedLat.value = r.lat
  resolvedLng.value = r.lng
  geocodeResult.value = r.fullPath
  regionHits.value = []
  suggestions.value = []
  suggestionsVisible.value = false
}

function selectSuggestion(s) {
  form.value.pickup_address = s.display_name
  resolvedLat.value = parseFloat(s.lat)
  resolvedLng.value = parseFloat(s.lon)
  geocodeResult.value = s.display_name
  regionHits.value = []
  suggestions.value = []
  suggestionsVisible.value = false
}

function highlightNext() {
  const total = regionHits.value.length + suggestions.value.length
  if (highlightIdx.value < total - 1) highlightIdx.value++
}
function highlightPrev() {
  if (highlightIdx.value > 0) highlightIdx.value--
}
function selectHighlighted() {
  const rLen = regionHits.value.length
  if (highlightIdx.value >= 0 && highlightIdx.value < rLen) {
    selectRegionHit(regionHits.value[highlightIdx.value])
  } else if (highlightIdx.value >= rLen) {
    const ni = highlightIdx.value - rLen
    if (suggestions.value[ni]) selectSuggestion(suggestions.value[ni])
  }
}
function hideSuggestionsDelayed() {
  setTimeout(() => { suggestionsVisible.value = false }, 200)
}
function showExisting() {
  if (suggestions.value.length || regionHits.value.length) suggestionsVisible.value = true
}

/* ── Leaflet address picker ── */
async function openMap() {
  mapOpen.value = true
  mapAddress.value = ''
  mapLat.value = resolvedLat.value
  mapLng.value = resolvedLng.value
  await loadLeaflet()
  await nextTick()
  setTimeout(initAddressMap, 80)
}

function initAddressMap() {
  if (!mapContainer.value || !window.L) return
  const L = window.L
  const center = (mapLat.value && mapLng.value) ? [mapLat.value, mapLng.value] : [40.78, 72.34]
  addrPickerMap = L.map(mapContainer.value).setView(center, 14)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>', maxZoom: 19,
  }).addTo(addrPickerMap)
  if (mapLat.value && mapLng.value) {
    addrPickerMarker = L.marker(center, { draggable: true }).addTo(addrPickerMap)
    addrPickerMarker.on('dragend', (e) => {
      const { lat, lng } = e.target.getLatLng()
      mapLat.value = lat; mapLng.value = lng
      reverseGeocodeAddr(lat, lng)
    })
    reverseGeocodeAddr(mapLat.value, mapLng.value)
  }
  addrPickerMap.on('click', (e) => {
    const { lat, lng } = e.latlng
    mapLat.value = lat; mapLng.value = lng
    if (addrPickerMarker) addrPickerMarker.setLatLng([lat, lng])
    else {
      addrPickerMarker = L.marker([lat, lng], { draggable: true }).addTo(addrPickerMap)
      addrPickerMarker.on('dragend', (ev) => {
        const ll = ev.target.getLatLng()
        mapLat.value = ll.lat; mapLng.value = ll.lng
        reverseGeocodeAddr(ll.lat, ll.lng)
      })
    }
    reverseGeocodeAddr(lat, lng)
  })
}

async function reverseGeocodeAddr(lat, lng) {
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
  if (addrPickerMap) { addrPickerMap.remove(); addrPickerMap = null; addrPickerMarker = null }
}

/* ── Orders ── */
async function loadOrders(silent = false) {
  if (!silent) loadingOrders.value = true
  try {
    const { data } = await adminAPI.getOrders()
    callOrders.value = (data.orders || []).filter((o) => o.order_type === 'call')
  } catch {
    if (!silent) callOrders.value = []
  } finally {
    if (!silent) loadingOrders.value = false
  }
}

async function createOrder() {
  error.value = ''
  successMsg.value = ''

  const digits = phoneDigits.value.replace(/\D/g, '')
  if (digits.length < 9) { error.value = 'Введите 9 цифр номера телефона'; return }
  if (!form.value.pickup_address.trim()) { error.value = 'Введите адрес пассажира'; return }

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
      passenger_phone: '+998' + digits,
      pickup_lat: resolvedLat.value,
      pickup_lng: resolvedLng.value,
      pickup_address: form.value.pickup_address.trim(),
      destination_lat: 0,
      destination_lng: 0,
      destination_address: '',
      distance_km: 0,
      additional_info: form.value.additional_info.trim(),
    })
    successMsg.value = `✅ Заказ создан. Ищем водителя рядом с «${form.value.pickup_address}»...`
    phoneDigits.value = ''
    phoneAddresses.value = []
    form.value = { pickup_address: '', additional_info: '' }
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

/* ── Online drivers ── */
async function loadOnlineDrivers(silent = false) {
  if (!silent && !driversMap) loadingDrivers.value = true
  try {
    const { data } = await adminAPI.getOnlineDrivers()
    onlineDrivers.value = data.drivers || []
    loadingDrivers.value = false
    await nextTick()
    await renderDriversMap()
  } catch {
    if (!silent) onlineDrivers.value = []
    loadingDrivers.value = false
  }
}

/* Top-down car icon using car-photo.png with status dot */
function carIconHtml(isAvailable) {
  const dot = isAvailable ? '#22c55e' : '#f97316'
  return `<div style="
    position:relative;width:44px;height:44px;
    filter:drop-shadow(0 3px 6px rgba(0,0,0,0.4));
  ">
    <img src="/car-photo.png" style="width:44px;height:44px;object-fit:contain;display:block;" />
    <span style="
      position:absolute;bottom:0;right:0;
      width:13px;height:13px;border-radius:50%;
      background:${dot};border:2.5px solid #fff;
      box-shadow:0 1px 3px rgba(0,0,0,0.35);
    "></span>
  </div>`
}

async function renderDriversMap() {
  if (!driversMapContainer.value) return
  await loadLeaflet()
  const L = window.L
  if (!L) return

  /* Init map once */
  if (!driversMap) {
    driversMap = L.map(driversMapContainer.value, { zoomControl: true }).setView([40.78, 72.34], 7)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(driversMap)
  }

  const currentIds = new Set(onlineDrivers.value.map(d => String(d.user_id)))

  /* Remove stale markers */
  for (const id of Object.keys(driverMarkers)) {
    if (!currentIds.has(id)) {
      driversMap.removeLayer(driverMarkers[id])
      delete driverMarkers[id]
    }
  }

  const bounds = []
  onlineDrivers.value.forEach(d => {
    const id = String(d.user_id)
    const icon = L.divIcon({
      className: '',
      html: carIconHtml(d.is_available),
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      tooltipAnchor: [0, -26],
    })
    if (driverMarkers[id]) {
      /* Update in-place — zero flicker */
      driverMarkers[id].setLatLng([d.lat, d.lng])
      driverMarkers[id].setIcon(icon)
      driverMarkers[id]._driverData = d
    } else {
      const marker = L.marker([d.lat, d.lng], { icon })
        .addTo(driversMap)
        .bindTooltip(`${d.first_name} ${d.last_name} · ${d.car_number}`,
          { direction: 'top', offset: [0, -32], className: 'driver-tooltip' })
      marker._driverData = d
      marker.on('click', () => {
        activeDriver.value = marker._driverData
        driversMap.panTo([d.lat, d.lng])
      })
      driverMarkers[id] = marker
    }
    bounds.push([d.lat, d.lng])
  })

  /* Auto-fit only on very first render */
  if (bounds.length > 0 && !driversMapFitted) {
    driversMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
    driversMapFitted = true
  }
}

function clearRouteOverlays() {
  if (routePolyline) { driversMap.removeLayer(routePolyline); routePolyline = null }
  routeMarkers.forEach(m => driversMap.removeLayer(m))
  routeMarkers = []
  routeActive.value = false
}

function pinIcon(color, letter) {
  const L = window.L
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 42" width="30" height="42">
    <path d="M15 0C8.37 0 3 5.37 3 12c0 9 12 30 12 30s12-21 12-30C27 5.37 21.63 0 15 0z"
          fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="15" cy="12" r="6" fill="#fff"/>
    <text x="15" y="16" text-anchor="middle" font-size="8" font-weight="900"
          fill="${color}" font-family="Arial">${letter}</text>
  </svg>`
  return L.divIcon({
    className: '', html: svg,
    iconSize: [30, 42], iconAnchor: [15, 42], tooltipAnchor: [0, -44],
  })
}

function showRouteOnMap(driver) {
  if (!driversMap || !window.L) return
  clearRouteOverlays()
  const L = window.L
  const points = []

  if (driver.pickup_lat && driver.pickup_lng) {
    const pos = [driver.pickup_lat, driver.pickup_lng]
    points.push(pos)
    const m = L.marker(pos, { icon: pinIcon('#16a34a', 'A') })
      .addTo(driversMap)
      .bindTooltip('Старт: ' + (driver.pickup_address || ''), { direction: 'top' })
    routeMarkers.push(m)
  }

  /* Driver current position as midpoint */
  points.push([driver.lat, driver.lng])

  if (driver.destination_lat && driver.destination_lng &&
      driver.destination_lat !== 0 && driver.order_status === 'in_progress') {
    const pos = [driver.destination_lat, driver.destination_lng]
    points.push(pos)
    const m = L.marker(pos, { icon: pinIcon('#dc2626', 'B') })
      .addTo(driversMap)
      .bindTooltip('Финиш: ' + (driver.destination_address || ''), { direction: 'top' })
    routeMarkers.push(m)
  }

  if (points.length >= 2) {
    routePolyline = L.polyline(points, {
      color: '#1d4ed8', weight: 5, opacity: 0.9,
      dashArray: null,
    }).addTo(driversMap)
    routeActive.value = true
    driversMap.fitBounds(points, { padding: [50, 50] })
  }
  activeDriver.value = null
}

function avatarSrc(url) {
  if (!url) return ''
  if (url.startsWith('http')) return url
  const base = import.meta.env.VITE_API_URL || '/api/v1'
  return base.replace(/\/api\/v1$/, '') + url
}

function orderStatusLabel(s) {
  const map = { accepted: 'Принят', arrived: 'Прибыл', in_progress: 'В пути' }
  return map[s] || s
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

onMounted(() => {
  loadOrders()
  loadOnlineDrivers()
  ordersInterval = setInterval(() => loadOrders(true), 10000)
  driversInterval = setInterval(() => loadOnlineDrivers(true), 20000)
})
onBeforeUnmount(() => {
  clearTimeout(debounceTimer)
  clearTimeout(phoneDebounce)
  clearInterval(ordersInterval)
  clearInterval(driversInterval)
  if (driversMap) { driversMap.remove(); driversMap = null }
  if (addrPickerMap) { addrPickerMap.remove(); addrPickerMap = null }
})
</script>

<style scoped>
.page { padding: 28px 32px; max-width: 1000px; margin: 0 auto; }
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

/* Phone input with fixed prefix */
.phone-input-wrap {
  display: flex; align-items: center;
  border: 1.5px solid #e0e0e0; border-radius: 10px;
  overflow: hidden; transition: border-color .2s;
}
.phone-input-wrap:focus-within { border-color: #FFCC00; }
.phone-prefix {
  padding: 12px 10px 12px 14px; font-size: 14px; font-weight: 700;
  color: #333; background: #f8f8f8; white-space: nowrap;
  border-right: 1px solid #e0e0e0; user-select: none;
}
.phone-input-wrap input {
  border: none !important; border-radius: 0 !important;
  padding: 12px 14px; flex: 1; font-size: 14px;
  outline: none;
}

/* Phone address history */
.phone-history {
  background: #fffde7; border: 1px solid #fff9c4; border-radius: 10px;
  padding: 8px 10px; margin-top: 4px;
}
.phone-history-label { font-size: 11px; font-weight: 600; color: #666; margin-bottom: 4px; }
.phone-history-item {
  padding: 6px 8px; border-radius: 6px; cursor: pointer;
  font-size: 13px; transition: background .15s;
}
.phone-history-item:hover { background: #fff3cd; }

.address-row { display: flex; gap: 8px; }
.autocomplete-wrap { position: relative; flex: 1; }
.autocomplete-wrap input { width: 100%; }

.suggestions {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 100;
  background: #fff; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px;
  max-height: 340px; overflow-y: auto; list-style: none; margin: 0; padding: 0;
  box-shadow: 0 6px 20px rgba(0,0,0,.12);
}
.suggestions li {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 14px; cursor: pointer; font-size: 13px;
  border-bottom: 1px solid #f5f5f5; transition: background .15s;
}
.suggestions li:hover, .suggestions li.highlighted { background: #fff9e0; }
.sug-icon { flex-shrink: 0; }
.sug-text { line-height: 1.4; display: flex; flex-direction: column; }
.sug-path { font-size: 11px; color: #888; margin-top: 2px; }
.sug-group-label {
  font-size: 11px; font-weight: 700; color: #999; padding: 6px 14px;
  background: #fafafa; cursor: default; border-bottom: 1px solid #f0f0f0;
  pointer-events: none;
}

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

/* ── Drivers map ── */
.drivers-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.driver-count { font-size: 14px; font-weight: 400; color: #888; }
.drivers-map-wrap { position: relative; margin-bottom: 4px; isolation: isolate; }
.drivers-map-container { height: 480px; width: 100%; border-radius: 12px; overflow: hidden; }
.map-empty-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.75); color: #888;
  font-size: 15px; font-weight: 500; border-radius: 12px;
  pointer-events: none;
}

/* ── Driver info popup (floats over map) ── */
.driver-popup {
  position: absolute; bottom: 16px; left: 16px; z-index: 1000;
  width: 300px; background: #fff; border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18); overflow: hidden;
}
.driver-popup-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 14px 10px; border-bottom: 1px solid #f0f0f0; position: relative;
}
.drv-popup-avatar { flex-shrink: 0; }
.drv-popup-avatar img { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #eee; }
.drv-popup-avatar-ph {
  width: 44px; height: 44px; border-radius: 50%;
  background: #FFCC00; color: #1a1a1a;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700;
}
.drv-popup-info { flex: 1; min-width: 0; }
.drv-popup-name { font-size: 14px; font-weight: 700; line-height: 1.2; }
.drv-popup-meta { font-size: 12px; color: #666; margin-top: 2px; }
.drv-popup-status {
  display: inline-block; margin-top: 4px;
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px;
}
.drv-popup-status.free { background: #dcfce7; color: #166534; }
.drv-popup-status.busy { background: #fff7ed; color: #c2410c; }
.drv-popup-close {
  position: absolute; top: 8px; right: 8px;
  background: #f5f5f5; border: none; border-radius: 50%;
  width: 26px; height: 26px; cursor: pointer; font-size: 13px; color: #555;
  display: flex; align-items: center; justify-content: center;
}
.drv-popup-close:hover { background: #eee; }
.drv-popup-order { padding: 12px 14px 14px; }
.drv-prow { font-size: 12px; margin-bottom: 5px; color: #444; }
.drv-prow b { color: #111; }
.drv-route-btn {
  margin-top: 10px; width: 100%; padding: 10px; border-radius: 10px; border: none;
  background: #1d4ed8; color: #fff; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: opacity .2s;
}
.drv-route-btn:hover { opacity: 0.87; }
.drv-popup-free { padding: 12px 14px; font-size: 13px; color: #888; }

/* Route clear button */
.route-clear-btn {
  position: absolute; top: 12px; right: 12px; z-index: 10;
  padding: 8px 16px; border-radius: 20px; border: none;
  background: rgba(255,255,255,0.96); color: #dc2626;
  font-size: 13px; font-weight: 700; cursor: pointer;
  box-shadow: 0 2px 10px rgba(0,0,0,0.15); transition: background .2s;
}
.route-clear-btn:hover { background: #fff5f5; }

/* Popup animation */
.popup-slide-enter-active, .popup-slide-leave-active { transition: all .2s ease; }
.popup-slide-enter-from, .popup-slide-leave-to { opacity: 0; transform: translateY(10px); }

/* Leaflet driver tooltip */
:global(.driver-tooltip) {
  background: #1a1a1a; color: #fff; border: none;
  font-size: 12px; font-weight: 600; border-radius: 6px;
  padding: 4px 10px; box-shadow: 0 2px 8px rgba(0,0,0,.25);
}
:global(.driver-tooltip::before) { border-top-color: #1a1a1a; }

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
