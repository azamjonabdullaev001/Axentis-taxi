<template>
  <div>
    <h2 class="page-title">Настройки цен</h2>

    <!-- Base pricing -->
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

        <!-- Base surge multiplier -->
        <div class="field surge-field">
          <label>
            Базовая наценка вне пиков:
            <b>×{{ Number(settings.base_surge_multiplier || 1).toFixed(2) }}</b>
            <span class="surgebadge" :class="baseSurgeClass">{{ baseSurgeLabel }}</span>
            <span class="hint-inline">— действует когда нет активного расписания</span>
          </label>
          <input
            v-model.number="settings.base_surge_multiplier"
            type="range" min="0.5" max="3.0" step="0.05"
            class="range-input"
          />
          <div class="range-marks">
            <span>×0.5 (скидка)</span>
            <span>×1.0 (норма)</span>
            <span>×3.0 (+200%)</span>
          </div>
        </div>

        <!-- Live surge indicator -->
        <div class="live-surge">
          <span class="live-dot" :class="liveClass"></span>
          Текущий коэффициент прямо сейчас:
          <b :class="liveClass">×{{ Number(settings.surge_multiplier || 1).toFixed(2) }}</b>
          <span class="live-badge" :class="liveClass">{{ liveSurgeLabel }}</span>
          <span class="hint-inline" style="margin-left:8px">
            (авто-управляется пиковым расписанием)
          </span>
        </div>

        <div v-if="settingsError" class="error-msg">{{ settingsError }}</div>
        <button class="save-btn" :disabled="savingSettings" @click="saveSettings">
          {{ savingSettings ? 'Сохранение...' : '💾 Сохранить тарифы' }}
        </button>
        <span v-if="settingsSaved" class="saved-msg">✅ Сохранено!</span>
      </div>
    </div>

    <!-- Peak periods -->
    <div class="section-card">
      <h3>Пиковые периоды</h3>
      <p class="hint">
        Задайте временной окно, в котором цена автоматически растёт до максимума и затем плавно возвращается к норме.
        Каждая запись = один полный цикл: <b>подъём → пик → спад</b>.
      </p>

      <!-- Timeline explanation -->
      <div class="timeline-ex">
        <div class="tl-block tl-rise">↑ Рост<br><small>rise_min</small></div>
        <div class="tl-block tl-peak">⬛ Пик<br><small>держится</small></div>
        <div class="tl-block tl-fall">↓ Спад<br><small>fall_min</small></div>
      </div>
      <div class="timeline-labels">
        <span>начало</span>
        <span>начало + рост</span>
        <span>конец − спад</span>
        <span>конец</span>
      </div>

      <!-- List -->
      <div class="schedule-list">
        <div v-if="loadingPeriods" class="loading">Загрузка...</div>
        <div v-else-if="periods.length === 0" class="empty">Нет пиковых периодов</div>
        <div v-for="p in periods" :key="p.id" class="schedule-item">
          <div class="sched-icon">📈</div>
          <div class="sched-info">
            <div class="sched-time">{{ fmtTime(p.start_time) }} → {{ fmtTime(p.end_time) }}</div>
            <div class="sched-details">
              Пик: <b class="up">+{{ Math.round((p.peak_multiplier - 1) * 100) }}%</b>
              (×{{ Number(p.peak_multiplier).toFixed(2) }})
              &nbsp;•&nbsp; ↑ рост <b>{{ p.rise_minutes }} мин</b>
              &nbsp;•&nbsp; ↓ спад <b>{{ p.fall_minutes }} мин</b>
              &nbsp;•&nbsp; удерживается <b>{{ holdMinutes(p) }} мин</b>
            </div>
          </div>
          <button class="del-btn" @click="deletePeriod(p.id)">🗑</button>
        </div>
      </div>

      <!-- Add form -->
      <div class="create-schedule">
        <h4>➕ Добавить пиковый период</h4>
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
              <span class="input-hint">= ×{{ peakMultiplier.toFixed(2) }}</span>
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

        <!-- Mini preview -->
        <div class="preview-bar" v-if="windowMinutes > 0 && holdOk">
          <div class="pb-rise" :style="{ flex: newP.rise_minutes }">↑{{ newP.rise_minutes }}м</div>
          <div class="pb-peak" :style="{ flex: holdPreviewMins }">⬛{{ holdPreviewMins }}м</div>
          <div class="pb-fall" :style="{ flex: newP.fall_minutes }">↓{{ newP.fall_minutes }}м</div>
        </div>

        <div v-if="periodError" class="error-msg">{{ periodError }}</div>
        <button class="save-btn" :disabled="savingPeriod || !holdOk" @click="addPeriod">
          {{ savingPeriod ? 'Сохранение...' : '➕ Добавить период' }}
        </button>
      </div>
    </div>
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

onMounted(async () => {
  await Promise.all([loadSettings(), loadPeriods()])
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

// Computed: peak multiplier from percentage input
const peakMultiplier = computed(() => 1 + (newP.value.peak_pct || 0) / 100)

// Window duration in minutes
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
  if (windowMinutes.value <= 0) return 'конец ≤ начало'
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

// Helpers
function fmtTime(t) { return t ? t.slice(0, 5) : '' }
function holdMinutes(p) {
  const [sh, sm] = p.start_time.split(':').map(Number)
  const [eh, em] = p.end_time.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm) - p.rise_minutes - p.fall_minutes
}

// Labels/classes for base_surge_multiplier
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

// Labels/classes for live surge_multiplier
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
.form-input {
  padding: 12px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 14px; outline: none; width: 100%; box-sizing: border-box;
}
.form-input:focus { border-color: #FFCC00; }
.surge-field .form-input { padding: 0; border: none; }
.range-input { width: 100%; accent-color: #FFCC00; }
.range-marks { display: flex; justify-content: space-between; font-size: 12px; color: #aaa; margin-top: 4px; }
.surgebadge, .live-badge {
  display: inline-block; margin-left: 8px; padding: 2px 10px;
  border-radius: 20px; font-size: 12px; font-weight: 700;
}
.surgebadge.high, .live-badge.live-high { background: #fce4ec; color: #c62828; }
.surgebadge.medium, .live-badge.live-medium { background: #fff8e1; color: #f57f17; }
.surgebadge.low, .live-badge.live-low { background: #e3f2fd; color: #1565c0; }
.surgebadge.normal, .live-badge.live-normal { background: #e8f5e9; color: #2e7d32; }

/* Live surge row */
.live-surge {
  background: #f8f9fa; border-radius: 12px; padding: 12px 16px;
  font-size: 14px; color: #555; display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
}
.live-dot {
  width: 10px; height: 10px; border-radius: 50%; margin-right: 6px;
  background: #ccc; display: inline-block;
}
.live-dot.live-high { background: #ef5350; box-shadow: 0 0 6px #ef5350aa; }
.live-dot.live-medium { background: #ff9800; }
.live-dot.live-low { background: #2196f3; }
.live-dot.live-normal { background: #4caf50; }
b.live-high { color: #c62828; }
b.live-medium { color: #f57f17; }
b.live-low { color: #1565c0; }
b.live-normal { color: #2e7d32; }

.error-msg { background: #fce4ec; color: #c62828; padding: 10px 14px; border-radius: 10px; font-size: 14px; }
.save-btn {
  padding: 14px 28px; background: #FFCC00; border: none; border-radius: 12px;
  font-size: 14px; font-weight: 700; cursor: pointer; width: fit-content;
}
.save-btn:hover { opacity: .9; }
.save-btn:disabled { opacity: .6; cursor: not-allowed; }
.saved-msg { font-size: 14px; color: #2e7d32; margin-left: 14px; }

/* Timeline explanation */
.timeline-ex {
  display: flex; gap: 4px; margin-bottom: 4px; border-radius: 10px; overflow: hidden;
}
.tl-block {
  flex: 1; padding: 8px 6px; text-align: center; font-size: 12px; font-weight: 600;
}
.tl-rise { background: #e3f2fd; color: #1565c0; }
.tl-peak { background: #fce4ec; color: #b71c1c; }
.tl-fall { background: #e8f5e9; color: #2e7d32; }
.timeline-labels {
  display: flex; justify-content: space-between;
  font-size: 11px; color: #bbb; margin-bottom: 20px;
}

/* Period list */
.schedule-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
.schedule-item {
  display: flex; align-items: center; gap: 12px;
  background: #f5f6fa; border-radius: 12px; padding: 14px 18px;
}
.sched-icon { font-size: 22px; }
.sched-info { flex: 1; }
.sched-time { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.sched-details { font-size: 13px; color: #666; }
.up { color: #c62828; }
.del-btn { background: none; border: none; cursor: pointer; font-size: 18px; padding: 4px; }
.del-btn:hover { opacity: .7; }

/* Add form */
.create-schedule h4 { font-size: 14px; font-weight: 700; margin-bottom: 14px; color: #555; }
.input-hint-wrap { position: relative; display: flex; align-items: center; gap: 8px; }
.input-hint { font-size: 13px; color: #888; white-space: nowrap; }
.field-info .form-input { background: #f8f9fa; color: #555; cursor: default; }
.hold-display { font-size: 13px; font-weight: 600; color: #2e7d32; }
.hold-err { color: #c62828 !important; }

/* Preview bar */
.preview-bar {
  display: flex; border-radius: 8px; overflow: hidden; height: 28px;
  margin-bottom: 14px; margin-top: 4px; font-size: 11px; font-weight: 700;
}
.pb-rise { background: #bbdefb; color: #1565c0; display: flex; align-items: center; justify-content: center; min-width: 20px; }
.pb-peak { background: #ef9a9a; color: #b71c1c; display: flex; align-items: center; justify-content: center; min-width: 20px; }
.pb-fall { background: #c8e6c9; color: #2e7d32; display: flex; align-items: center; justify-content: center; min-width: 20px; }
</style>


    <!-- Base pricing -->
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
            Коэффициент спроса: 
            <b>×{{ Number(settings.surge_multiplier).toFixed(2) }}</b>
            <span class="surgebadge" :class="surgeClass">{{ surgeLabel }}</span>
          </label>
          <input
            v-model.number="settings.surge_multiplier"
            type="range" min="0.25" max="3.5" step="0.05"
            class="range-input"
          />
          <div class="range-marks">
            <span>-75% (×0.25)</span>
            <span>Норма (×1.0)</span>
            <span>+250% (×3.5)</span>
          </div>
        </div>

        <div v-if="settingsError" class="error-msg">{{ settingsError }}</div>
        <button class="save-btn" :disabled="savingSettings" @click="saveSettings">
          {{ savingSettings ? 'Сохранение...' : '💾 Сохранить тарифы' }}
        </button>
        <span v-if="settingsSaved" class="saved-msg">✅ Сохранено!</span>
      </div>
    </div>

    <!-- Surge schedules -->
    <div class="section-card">
      <h3>Расписание изменения спроса</h3>
      <p class="hint">Постепенное автоматическое изменение коэффициента в заданное время.</p>

      <div class="schedule-list">
        <div v-if="loadingSchedules" class="loading">Загрузка...</div>
        <div v-else-if="schedules.length === 0" class="empty">Нет расписаний</div>
        <div v-for="s in schedules" :key="s.id" class="schedule-item">
          <div class="sched-info">
            <div class="sched-time">🕐 {{ s.start_time }}</div>
            <div class="sched-details">
              Длительность: <b>{{ s.duration_minutes }} мин</b> •
              Направление: <b :class="s.direction === 'up' ? 'up' : 'down'">{{ s.direction === 'up' ? '↑ рост' : '↓ снижение' }}</b> •
              Цель: <b>×{{ Number(s.target_multiplier).toFixed(2) }}</b>
            </div>
          </div>
          <button class="del-btn" @click="deleteSchedule(s.id)">🗑</button>
        </div>
      </div>

      <div class="create-schedule">
        <h4>Добавить расписание</h4>
        <div class="field-row">
          <div class="field">
            <label>Время начала (ЧЧ:ММ)</label>
            <input v-model="newSched.start_time" type="time" class="form-input" />
          </div>
          <div class="field">
            <label>Длительность (мин, 10–120)</label>
            <input v-model.number="newSched.duration_minutes" type="number" min="10" max="120" class="form-input" />
          </div>
          <div class="field">
            <label>Направление</label>
            <select v-model="newSched.direction" class="form-input">
              <option value="up">↑ Рост</option>
              <option value="down">↓ Снижение</option>
            </select>
          </div>
          <div class="field">
            <label>Целевой коэффициент (×{{ Number(newSched.target_multiplier).toFixed(2) }})</label>
            <input
              v-model.number="newSched.target_multiplier"
              type="range" min="0.25" max="3.5" step="0.05"
              class="range-input"
            />
          </div>
        </div>
        <div v-if="schedError" class="error-msg">{{ schedError }}</div>
        <button class="save-btn" :disabled="savingSched" @click="addSchedule">
          {{ savingSched ? 'Добавление...' : '➕ Добавить' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { adminAPI } from '../services/api'

const settings = ref({ price_per_km: 2000, price_per_minute_wait: 500, free_wait_minutes: 2, service_fee: 2000, surge_multiplier: 1.0 })
const loadingSettings = ref(true)
const savingSettings = ref(false)
const settingsError = ref('')
const settingsSaved = ref(false)

const schedules = ref([])
const loadingSchedules = ref(true)
const newSched = ref({ start_time: '08:00', duration_minutes: 30, direction: 'up', target_multiplier: 1.5 })
const savingSched = ref(false)
const schedError = ref('')

onMounted(async () => {
  await Promise.all([loadSettings(), loadSchedules()])
})

async function loadSettings() {
  try {
    const { data } = await adminAPI.getPricing()
    settings.value = { ...settings.value, ...data }
  } finally {
    loadingSettings.value = false
  }
}

async function loadSchedules() {
  try {
    const { data } = await adminAPI.getSurgeSchedules()
    schedules.value = data.schedules || []
  } finally {
    loadingSchedules.value = false
  }
}

async function saveSettings() {
  settingsError.value = ''
  const m = settings.value.surge_multiplier
  if (m < 0.25 || m > 3.5) { settingsError.value = 'Коэффициент должен быть от 0.25 до 3.5'; return }
  savingSettings.value = true
  try {
    await adminAPI.updatePricing(settings.value)
    settingsSaved.value = true
    setTimeout(() => { settingsSaved.value = false }, 3000)
  } catch (e) {
    settingsError.value = e.response?.data?.error || 'Ошибка сохранения'
  } finally {
    savingSettings.value = false
  }
}

async function addSchedule() {
  schedError.value = ''
  if (!newSched.value.start_time) { schedError.value = 'Укажите время'; return }
  if (newSched.value.duration_minutes < 10 || newSched.value.duration_minutes > 120) {
    schedError.value = 'Длительность: 10–120 мин'; return
  }
  savingSched.value = true
  try {
    await adminAPI.createSurgeSchedule(newSched.value)
    await loadSchedules()
    newSched.value = { start_time: '08:00', duration_minutes: 30, direction: 'up', target_multiplier: 1.5 }
  } catch (e) {
    schedError.value = e.response?.data?.error || 'Ошибка'
  } finally {
    savingSched.value = false
  }
}

async function deleteSchedule(id) {
  if (!confirm('Удалить расписание?')) return
  try {
    await adminAPI.deleteSurgeSchedule(id)
    schedules.value = schedules.value.filter(s => s.id !== id)
  } catch {}
}

const surgeLabel = computed(() => {
  const m = settings.value.surge_multiplier
  if (m < 1) return `-${Math.round((1 - m) * 100)}%`
  if (m === 1) return 'Норма'
  return `+${Math.round((m - 1) * 100)}%`
})
const surgeClass = computed(() => {
  const m = settings.value.surge_multiplier
  if (m > 1.5) return 'high'
  if (m > 1) return 'medium'
  if (m < 1) return 'low'
  return 'normal'
})
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 800; margin-bottom: 24px; }
.section-card { background: #fff; border-radius: 18px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,.07); margin-bottom: 24px; }
.section-card h3 { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
.hint { font-size: 13px; color: #888; margin-bottom: 18px; }
.loading, .empty { color: #aaa; font-size: 14px; padding: 10px 0; }
.settings-form { display: flex; flex-direction: column; gap: 18px; }
.field-row { display: flex; flex-wrap: wrap; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; min-width: 180px; flex: 1; }
.field label { font-size: 13px; color: #666; font-weight: 500; }
.form-input {
  padding: 12px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 14px; outline: none; width: 100%;
}
.form-input:focus { border-color: #FFCC00; }
.surge-field .form-input { padding: 0; border: none; }
.range-input { width: 100%; accent-color: #FFCC00; }
.range-marks { display: flex; justify-content: space-between; font-size: 12px; color: #aaa; margin-top: 4px; }
.surgebadge {
  display: inline-block; margin-left: 10px; padding: 2px 10px;
  border-radius: 20px; font-size: 12px; font-weight: 700;
}
.surgebadge.high { background: #fce4ec; color: #c62828; }
.surgebadge.medium { background: #fff8e1; color: #f57f17; }
.surgebadge.low { background: #e3f2fd; color: #1565c0; }
.surgebadge.normal { background: #e8f5e9; color: #2e7d32; }
.error-msg { background: #fce4ec; color: #c62828; padding: 10px 14px; border-radius: 10px; font-size: 14px; }
.save-btn {
  padding: 14px 28px; background: #FFCC00; border: none; border-radius: 12px;
  font-size: 14px; font-weight: 700; cursor: pointer; width: fit-content;
}
.save-btn:hover { opacity: .9; }
.save-btn:disabled { opacity: .6; cursor: not-allowed; }
.saved-msg { font-size: 14px; color: #2e7d32; margin-left: 14px; }
.schedule-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
.schedule-item {
  display: flex; align-items: center; justify-content: space-between;
  background: #f5f6fa; border-radius: 12px; padding: 14px 18px;
}
.sched-time { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.sched-details { font-size: 13px; color: #666; }
.up { color: #c62828; }
.down { color: #1565c0; }
.del-btn { background: none; border: none; cursor: pointer; font-size: 18px; padding: 4px; }
.del-btn:hover { opacity: .7; }
.create-schedule h4 { font-size: 14px; font-weight: 700; margin-bottom: 14px; color: #555; }
</style>
