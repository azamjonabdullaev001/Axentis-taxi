<template>
  <div>
    <h2 class="page-title">Настройки цен</h2>



    <div class="section-card">
      <h3>Базовые тарифы</h3>
      <div v-if="loadingSettings" class="loading">Загрузка...</div>
      <div v-else class="settings-form">
        <div class="field-row">
          <div class="field">
            <label>Цена за км (сум)</label>
            <input v-model.number="settings.price_per_km" type="number" min="0" class="form-input" />
          </div>
          <div class="field">
            <label>Плата за ожидание (сум/мин)</label>
            <input v-model.number="settings.price_per_minute_wait" type="number" min="0" class="form-input" />
          </div>
          <div class="field">
            <label>Бесплатных минут ожидания</label>
            <input v-model.number="settings.free_wait_minutes" type="number" min="0" class="form-input" />
          </div>
          <div class="field">
            <label>Сервисный сбор (сум)</label>
            <input v-model.number="settings.service_fee" type="number" min="0" class="form-input" />
          </div>
        </div>

        <div class="field surge-field">
          <label>
            Базовая наценка вне пиков:
            <b>x{{ Number(settings.base_surge_multiplier || 1).toFixed(2) }}</b>
            <span class="surgebadge" :class="baseSurgeClass">{{ baseSurgeLabel }}</span>
            <span class="hint-inline">-- действует когда нет активного расписания</span>
          </label>
          <input
            v-model.number="settings.base_surge_multiplier"
            type="range" min="0.5" max="3.0" step="0.05"
            class="range-input"
          />
          <div class="range-marks">
            <span>x0.5 (скидка)</span>
            <span>x1.0 (норма)</span>
            <span>x3.0 (+200%)</span>
          </div>
        </div>

        <div class="live-surge">
          <span class="live-dot" :class="liveClass"></span>
          Текущий коэффициент прямо сейчас:
          <b :class="liveClass">x{{ Number(settings.surge_multiplier || 1).toFixed(2) }}</b>
          <span class="live-badge" :class="liveClass">{{ liveSurgeLabel }}</span>
          <span class="hint-inline" style="margin-left:8px">(авто-управляется пиковым расписанием)</span>
        </div>

        <div v-if="settingsError" class="error-msg">{{ settingsError }}</div>
        <button class="save-btn" :disabled="savingSettings" @click="saveSettings">
          {{ savingSettings ? 'Сохранение...' : 'Сохранить тарифы' }}
        </button>
        <span v-if="settingsSaved" class="saved-msg">Сохранено!</span>
      </div>
    </div>



    <!-- Hourly surge: Yandex-style 24h grid -->
    <div class="section-card">
      <h3>Почасовая наценка (автоматическая)</h3>
      <p class="hint">
        Задайте коэффициент цены для каждого часа. Например: x1.5 в час-пик, x1.0 в обычное время.
        Система автоматически применяет наценку по расписанию.
      </p>

      <div v-if="loadingHourly" class="loading">Загрузка...</div>
      <div v-else class="hourly-grid">
        <div v-for="h in hourlyData" :key="h.hour" class="hour-row">
          <span class="hour-label">{{ String(h.hour).padStart(2, '0') }}:00</span>
          <input
            v-model.number="h.multiplier"
            type="range" min="0.5" max="3.0" step="0.05"
            class="range-input hour-range"
          />
          <span class="hour-val" :class="hourClass(h.multiplier)">x{{ Number(h.multiplier).toFixed(2) }}</span>
          <span class="hour-badge" :class="hourClass(h.multiplier)">{{ hourLabel(h.multiplier) }}</span>
        </div>
      </div>

      <div class="hour-presets">
        <button class="preset-btn" @click="presetReset">Сбросить все</button>
        <button class="preset-btn" @click="presetMorning">Утренний пик</button>
        <button class="preset-btn" @click="presetEvening">Вечерний пик</button>
      </div>

      <div v-if="hourlyError" class="error-msg">{{ hourlyError }}</div>
      <button class="save-btn" :disabled="savingHourly" @click="saveHourlySurge">
        {{ savingHourly ? 'Сохранение...' : 'Сохранить расписание' }}
      </button>
      <span v-if="hourlySaved" class="saved-msg">Сохранено!</span>
    </div>

    <!-- Legacy peak periods (kept for viewing old data) -->
    <details class="section-card legacy-section">
      <summary class="legacy-title">📈 Старые пиковые периоды (устаревшие)</summary>
      <h3>Пиковые периоды</h3>
      <p class="hint">
        Задайте временное окно, в котором цена автоматически растёт до максимума и затем плавно возвращается к норме.
        Каждая запись = один полный цикл: <b>подъём -&gt; пик -&gt; спад</b>.
      </p>

      <div class="timeline-ex">
        <div class="tl-block tl-rise">Рост<br /><small>rise_min</small></div>
        <div class="tl-block tl-peak">Пик<br /><small>держится</small></div>
        <div class="tl-block tl-fall">Спад<br /><small>fall_min</small></div>
      </div>
      <div class="timeline-labels">
        <span>начало</span>
        <span>начало + рост</span>
        <span>конец - спад</span>
        <span>конец</span>
      </div>

      <div class="schedule-list">
        <div v-if="loadingPeriods" class="loading">Загрузка...</div>
        <div v-else-if="periods.length === 0" class="empty">Нет пиковых периодов</div>
        <div v-for="p in periods" :key="p.id" class="schedule-item">
          <div class="sched-icon">📈</div>
          <div class="sched-info">
            <div class="sched-time">{{ fmtTime(p.start_time) }} → {{ fmtTime(p.end_time) }}</div>
            <div class="sched-details">
              Пик: <b class="up">+{{ Math.round((p.peak_multiplier - 1) * 100) }}%</b>
              (x{{ Number(p.peak_multiplier).toFixed(2) }})
              &nbsp;•&nbsp; рост <b>{{ p.rise_minutes }} мин</b>
              &nbsp;•&nbsp; спад <b>{{ p.fall_minutes }} мин</b>
              &nbsp;•&nbsp; удерживается <b>{{ holdMinutes(p) }} мин</b>
            </div>
          </div>
          <button class="del-btn" @click="deletePeriod(p.id)">🗑</button>
        </div>
      </div>

      <div class="create-schedule">
        <h4>Добавить пиковый период</h4>
        <div class="field-row">
          <div class="field">
            <label>Начало</label>
            <input v-model="newP.start_time" type="time" class="form-input" />
          </div>
          <div class="field">
            <label>Конец</label>
            <input v-model="newP.end_time" type="time" class="form-input" />
          </div>
          <div class="field">
            <label>Макс. наценка (%)</label>
            <div class="input-hint-wrap">
              <input v-model.number="newP.peak_pct" type="number" min="1" max="400" class="form-input" placeholder="напр. 100" />
              <span class="input-hint">= x{{ peakMultiplier.toFixed(2) }}</span>
            </div>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Время роста (мин)</label>
            <input v-model.number="newP.rise_minutes" type="number" min="1" class="form-input" placeholder="напр. 30" />
          </div>
          <div class="field">
            <label>Время спада (мин)</label>
            <input v-model.number="newP.fall_minutes" type="number" min="1" class="form-input" placeholder="напр. 60" />
          </div>
          <div class="field field-info">
            <label>Длит. удержания</label>
            <div class="form-input hold-display" :class="holdOk ? '' : 'hold-err'">
              {{ holdPreview }}
            </div>
          </div>
        </div>

        <div class="preview-bar" v-if="windowMinutes > 0 && holdOk">
          <div class="pb-rise" :style="{ flex: newP.rise_minutes }">{{ newP.rise_minutes }}м</div>
          <div class="pb-peak" :style="{ flex: holdPreviewMins }">{{ holdPreviewMins }}м</div>
          <div class="pb-fall" :style="{ flex: newP.fall_minutes }">{{ newP.fall_minutes }}м</div>
        </div>

        <div v-if="periodError" class="error-msg">{{ periodError }}</div>
        <button class="save-btn" :disabled="savingPeriod || !holdOk" @click="addPeriod">
          {{ savingPeriod ? 'Сохранение...' : 'Добавить период' }}
        </button>
      </div>
    </details>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { adminAPI } from '../services/api'

const settings = ref({
  price_per_km: 2000,
  price_per_minute_wait: 500,
  free_wait_minutes: 2,
  service_fee: 2000,
  surge_multiplier: 1.0,
  base_surge_multiplier: 1.0,
  royal_price_per_km: 3000,
})
const loadingSettings = ref(true)
const savingSettings = ref(false)
const settingsError = ref('')
const settingsSaved = ref(false)


const periods = ref([])
const loadingPeriods = ref(true)
const newP = ref({ start_time: '07:00', end_time: '10:00', peak_pct: 100, rise_minutes: 30, fall_minutes: 60 })
const savingPeriod = ref(false)
const periodError = ref('')

// Hourly surge data
const hourlyData = ref([])
const loadingHourly = ref(true)
const savingHourly = ref(false)
const hourlyError = ref('')
const hourlySaved = ref(false)

onMounted(async () => {
  await Promise.all([loadSettings(), loadPeriods(), loadHourlySurge()])
})



async function loadSettings() {
  try {
    const { data } = await adminAPI.getPricing()
    settings.value = { ...settings.value, ...data }
  } finally {
    loadingSettings.value = false
  }
}

async function loadPeriods() {
  try {
    const { data } = await adminAPI.getPeakPeriods()
    periods.value = data.periods || []
  } finally {
    loadingPeriods.value = false
  }
}

async function saveSettings() {
  settingsError.value = ''
  savingSettings.value = true
  try {
    await adminAPI.updatePricing({
      price_per_km:          settings.value.price_per_km,
      price_per_minute_wait: settings.value.price_per_minute_wait,
      free_wait_minutes:     settings.value.free_wait_minutes,
      service_fee:           settings.value.service_fee,
      base_surge_multiplier: settings.value.base_surge_multiplier,
    })
    settingsSaved.value = true
    setTimeout(() => { settingsSaved.value = false }, 3000)
  } catch (e) {
    settingsError.value = e.response?.data?.error || 'Ошибка сохранения'
  } finally {
    savingSettings.value = false
  }
}

const peakMultiplier = computed(() => 1 + (newP.value.peak_pct || 0) / 100)

const windowMinutes = computed(() => {
  if (!newP.value.start_time || !newP.value.end_time) return 0
  const [sh, sm] = newP.value.start_time.split(':').map(Number)
  const [eh, em] = newP.value.end_time.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
})

const holdPreviewMins = computed(() =>
  windowMinutes.value - (newP.value.rise_minutes || 0) - (newP.value.fall_minutes || 0)
)

const holdOk = computed(() =>
  windowMinutes.value > 0 &&
  (newP.value.rise_minutes || 0) >= 1 &&
  (newP.value.fall_minutes || 0) >= 1 &&
  holdPreviewMins.value > 0 &&
  (newP.value.peak_pct || 0) > 0
)

const holdPreview = computed(() => {
  if (windowMinutes.value <= 0) return 'конец <= начала'
  if (holdPreviewMins.value <= 0) return `рост + спад > окна (${windowMinutes.value} мин)`
  return `${holdPreviewMins.value} мин на пике`
})

async function addPeriod() {
  periodError.value = ''
  if (!holdOk.value) { periodError.value = 'Проверьте значения'; return }
  savingPeriod.value = true
  try {
    await adminAPI.createPeakPeriod({
      start_time:      newP.value.start_time,
      end_time:        newP.value.end_time,
      peak_multiplier: peakMultiplier.value,
      rise_minutes:    newP.value.rise_minutes,
      fall_minutes:    newP.value.fall_minutes,
    })
    await loadPeriods()
    newP.value = { start_time: '07:00', end_time: '10:00', peak_pct: 100, rise_minutes: 30, fall_minutes: 60 }
  } catch (e) {
    periodError.value = e.response?.data?.error || 'Ошибка'
  } finally {
    savingPeriod.value = false
  }
}

async function deletePeriod(id) {
  if (!confirm('Удалить пиковый период?')) return
  try {
    await adminAPI.deletePeakPeriod(id)
    periods.value = periods.value.filter(p => p.id !== id)
  } catch {}
}

function fmtTime(t) { return t ? t.slice(0, 5) : '' }
function holdMinutes(p) {
  const [sh, sm] = p.start_time.split(':').map(Number)
  const [eh, em] = p.end_time.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm) - p.rise_minutes - p.fall_minutes
}

// Hourly surge functions
async function loadHourlySurge() {
  try {
    const { data } = await adminAPI.getHourlySurge()
    const hours = data.hours || []
    // Ensure all 24 hours exist
    const map = {}
    hours.forEach(h => { map[h.hour] = h.multiplier })
    hourlyData.value = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      multiplier: map[i] != null ? map[i] : 1.0,
    }))
  } catch {
    hourlyData.value = Array.from({ length: 24 }, (_, i) => ({ hour: i, multiplier: 1.0 }))
  } finally {
    loadingHourly.value = false
  }
}

async function saveHourlySurge() {
  hourlyError.value = ''
  savingHourly.value = true
  try {
    await adminAPI.updateHourlySurge({ hours: hourlyData.value })
    hourlySaved.value = true
    setTimeout(() => { hourlySaved.value = false }, 3000)
  } catch (e) {
    hourlyError.value = e.response?.data?.error || 'Ошибка сохранения'
  } finally {
    savingHourly.value = false
  }
}

function presetReset() {
  hourlyData.value.forEach(h => { h.multiplier = 1.0 })
}
function presetMorning() {
  hourlyData.value.forEach(h => {
    if (h.hour >= 7 && h.hour <= 9) h.multiplier = 1.5
    else h.multiplier = 1.0
  })
}
function presetEvening() {
  hourlyData.value.forEach(h => {
    if (h.hour >= 17 && h.hour <= 19) h.multiplier = 1.5
    else h.multiplier = 1.0
  })
}

function hourClass(m) {
  if (m > 1.5) return 'surge-high'
  if (m > 1) return 'surge-medium'
  if (m < 1) return 'surge-low'
  return 'surge-normal'
}
function hourLabel(m) {
  if (m < 1) return `-${Math.round((1 - m) * 100)}%`
  if (m === 1) return 'Норма'
  return `+${Math.round((m - 1) * 100)}%`
}

const baseSurgeLabel = computed(() => {
  const m = settings.value.base_surge_multiplier || 1
  if (m < 1) return `-${Math.round((1 - m) * 100)}%`
  if (m === 1) return 'Норма'
  return `+${Math.round((m - 1) * 100)}%`
})
const baseSurgeClass = computed(() => {
  const m = settings.value.base_surge_multiplier || 1
  if (m > 1.3) return 'high'
  if (m > 1) return 'medium'
  if (m < 1) return 'low'
  return 'normal'
})

const liveSurgeLabel = computed(() => {
  const m = settings.value.surge_multiplier || 1
  if (m < 1) return `-${Math.round((1 - m) * 100)}%`
  if (m === 1) return 'Норма'
  return `+${Math.round((m - 1) * 100)}%`
})
const liveClass = computed(() => {
  const m = settings.value.surge_multiplier || 1
  if (m > 1.5) return 'live-high'
  if (m > 1) return 'live-medium'
  if (m < 1) return 'live-low'
  return 'live-normal'
})
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 800; margin-bottom: 24px; }
.section-card { background: #fff; border-radius: 18px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,.07); margin-bottom: 24px; }

.section-card h3 { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
.hint { font-size: 13px; color: #888; margin-bottom: 18px; }
.hint-inline { font-size: 12px; color: #aaa; margin-left: 6px; }

.loading, .empty { color: #aaa; font-size: 14px; padding: 10px 0; }
.settings-form { display: flex; flex-direction: column; gap: 18px; }
.field-row { display: flex; flex-wrap: wrap; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; min-width: 160px; flex: 1; }
.field label { font-size: 13px; color: #666; font-weight: 500; }
.form-input { padding: 12px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px; font-size: 14px; outline: none; width: 100%; box-sizing: border-box; }
.form-input:focus { border-color: #FFCC00; }
.surge-field .form-input { padding: 0; border: none; }
.range-input { width: 100%; accent-color: #FFCC00; }
.range-marks { display: flex; justify-content: space-between; font-size: 12px; color: #aaa; margin-top: 4px; }
.surgebadge, .live-badge { display: inline-block; margin-left: 8px; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; }
.surgebadge.high, .live-badge.live-high { background: #fce4ec; color: #c62828; }
.surgebadge.medium, .live-badge.live-medium { background: #fff8e1; color: #f57f17; }
.surgebadge.low, .live-badge.live-low { background: #e3f2fd; color: #1565c0; }
.surgebadge.normal, .live-badge.live-normal { background: #e8f5e9; color: #2e7d32; }
.live-surge { background: #f8f9fa; border-radius: 12px; padding: 12px 16px; font-size: 14px; color: #555; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.live-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; background: #ccc; display: inline-block; }
.live-dot.live-high { background: #ef5350; }
.live-dot.live-medium { background: #ff9800; }
.live-dot.live-low { background: #2196f3; }
.live-dot.live-normal { background: #4caf50; }
b.live-high { color: #c62828; }
b.live-medium { color: #f57f17; }
b.live-low { color: #1565c0; }
b.live-normal { color: #2e7d32; }
.error-msg { background: #fce4ec; color: #c62828; padding: 10px 14px; border-radius: 10px; font-size: 14px; }
.save-btn { padding: 14px 28px; background: #FFCC00; border: none; border-radius: 12px; font-size: 14px; font-weight: 700; cursor: pointer; width: fit-content; }
.save-btn:hover { opacity: .9; }
.save-btn:disabled { opacity: .6; cursor: not-allowed; }
.saved-msg { font-size: 14px; color: #2e7d32; margin-left: 14px; }
.timeline-ex { display: flex; gap: 4px; margin-bottom: 4px; border-radius: 10px; overflow: hidden; }
.tl-block { flex: 1; padding: 8px 6px; text-align: center; font-size: 12px; font-weight: 600; }
.tl-rise { background: #e3f2fd; color: #1565c0; }
.tl-peak { background: #fce4ec; color: #b71c1c; }
.tl-fall { background: #e8f5e9; color: #2e7d32; }
.timeline-labels { display: flex; justify-content: space-between; font-size: 11px; color: #bbb; margin-bottom: 20px; }
.schedule-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
.schedule-item { display: flex; align-items: center; gap: 12px; background: #f5f6fa; border-radius: 12px; padding: 14px 18px; }
.sched-icon { font-size: 22px; }
.sched-info { flex: 1; }
.sched-time { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.sched-details { font-size: 13px; color: #666; }
.up { color: #c62828; }
.del-btn { background: none; border: none; cursor: pointer; font-size: 18px; padding: 4px; }
.del-btn:hover { opacity: .7; }
.create-schedule h4 { font-size: 14px; font-weight: 700; margin-bottom: 14px; color: #555; }
.input-hint-wrap { display: flex; align-items: center; gap: 8px; }
.input-hint { font-size: 13px; color: #888; white-space: nowrap; }
.field-info .form-input { background: #f8f9fa; color: #555; cursor: default; }
.hold-display { font-size: 13px; font-weight: 600; color: #2e7d32; }
.hold-err { color: #c62828 !important; }
.preview-bar { display: flex; border-radius: 8px; overflow: hidden; height: 28px; margin-bottom: 14px; margin-top: 4px; font-size: 11px; font-weight: 700; }
.pb-rise { background: #bbdefb; color: #1565c0; display: flex; align-items: center; justify-content: center; min-width: 20px; }
.pb-peak { background: #ef9a9a; color: #b71c1c; display: flex; align-items: center; justify-content: center; min-width: 20px; }
.pb-fall { background: #c8e6c9; color: #2e7d32; display: flex; align-items: center; justify-content: center; min-width: 20px; }

/* Hourly surge grid */
.hourly-grid { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
.hour-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.hour-label { width: 50px; font-size: 13px; font-weight: 700; color: #555; }
.hour-range { flex: 1; }
.hour-val { width: 48px; font-size: 13px; font-weight: 700; text-align: right; }
.hour-badge { display: inline-block; width: 60px; text-align: center; padding: 2px 6px; border-radius: 12px; font-size: 11px; font-weight: 700; }
.surge-high { color: #c62828; }
.surge-medium { color: #f57f17; }
.surge-low { color: #1565c0; }
.surge-normal { color: #2e7d32; }
.hour-badge.surge-high { background: #fce4ec; }
.hour-badge.surge-medium { background: #fff8e1; }
.hour-badge.surge-low { background: #e3f2fd; }
.hour-badge.surge-normal { background: #e8f5e9; }
.hour-presets { display: flex; gap: 8px; margin-bottom: 14px; }
.preset-btn { padding: 8px 16px; border: 1.5px solid #e0e0e0; border-radius: 10px; font-size: 13px; font-weight: 600; background: #f8f9fa; cursor: pointer; }
.preset-btn:hover { background: #e8e8e8; }

/* Legacy section */
.legacy-section { cursor: pointer; }
.legacy-title { font-size: 14px; font-weight: 600; color: #888; padding: 8px 0; }
</style>
