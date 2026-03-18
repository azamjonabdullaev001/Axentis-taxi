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
