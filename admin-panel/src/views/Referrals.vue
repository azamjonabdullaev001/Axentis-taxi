<template>
  <div>
    <h2 class="page-title">🎁 Рефералдар / Бонуслар</h2>

    <!-- Referral Settings -->
    <div class="section-card">
      <h3>Настройки реферальной программы</h3>
      <div v-if="loadingSettings" class="loading">Загрузка...</div>
      <div v-else class="settings-form">
        <div class="field-row">
          <div class="field">
            <label>Стандартная комиссия (%)</label>
            <input v-model.number="settings.default_commission_pct" type="number" min="0" max="50" step="0.5" class="form-input" />
          </div>
          <div class="field">
            <label>Сниженная комиссия (%) — для рефералов</label>
            <input v-model.number="settings.reduced_commission_pct" type="number" min="0" max="50" step="0.5" class="form-input" />
          </div>
          <div class="field">
            <label>Еженедельный бонус (сум)</label>
            <input v-model.number="settings.weekly_bonus_amount" type="number" min="0" step="1000" class="form-input" />
          </div>
        </div>
        <div v-if="settingsError" class="error-msg">{{ settingsError }}</div>
        <div class="actions">
          <button class="save-btn" :disabled="savingSettings" @click="saveSettings">
            {{ savingSettings ? 'Сохранение...' : '💾 Сохранить настройки' }}
          </button>
          <span v-if="settingsSaved" class="saved-msg">✅ Сохранено!</span>
        </div>
        <div class="hint">
          ⚡ Водитель выбирает тип реферального бонуса при вводе кода:<br>
          <b>Комиссия</b> — платит {{ settings.reduced_commission_pct }}% вместо {{ settings.default_commission_pct }}%&nbsp;&nbsp;|&nbsp;&nbsp;
          <b>Бонус</b> — получает {{ Number(settings.weekly_bonus_amount).toLocaleString('ru-RU') }} сум каждую неделю
        </div>
      </div>
    </div>

    <!-- Referrals table -->
    <div class="section-card">
      <div class="card-header">
        <h3>Водители с реферальным кодом</h3>
        <input v-model="search" class="search-input" placeholder="🔍 Поиск по имени, телефону, коду..." />
      </div>
      <div v-if="loadingList" class="loading">Загрузка...</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Водитель</th>
            <th>Телефон</th>
            <th>Авто</th>
            <th>Мой код</th>
            <th>Реферал от</th>
            <th>Тип бонуса</th>
            <th>Баланс</th>
            <th>Дата рег.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id">
            <td><b>{{ r.first_name }} {{ r.last_name }}</b></td>
            <td>{{ r.phone }}</td>
            <td>{{ r.car_number }}</td>
            <td>
              <code class="ref-code">{{ r.referral_code || '—' }}</code>
            </td>
            <td>
              <code v-if="r.referred_by" class="ref-code referred">{{ r.referred_by }}</code>
              <span v-else class="no-ref">—</span>
            </td>
            <td>
              <span v-if="r.referral_benefit_type === 'commission'" class="badge commission">📉 Комиссия</span>
              <span v-else-if="r.referral_benefit_type === 'bonus'" class="badge bonus">🎁 Бонус</span>
              <span v-else class="badge none">—</span>
            </td>
            <td>{{ Number(r.balance || 0).toLocaleString('ru-RU') }} сум</td>
            <td><small>{{ fmtDate(r.created_at) }}</small></td>
            <td>
              <router-link :to="`/drivers/${r.id}`" class="details-btn">📊 Аналитика</router-link>
            </td>
          </tr>
          <tr v-if="filtered.length === 0">
            <td colspan="9" class="empty">Нет данных</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { adminAPI } from '../services/api'

const settings = ref({ default_commission_pct: 8, reduced_commission_pct: 6, weekly_bonus_amount: 10000 })
const loadingSettings = ref(true)
const savingSettings = ref(false)
const settingsError = ref('')
const settingsSaved = ref(false)

const list = ref([])
const loadingList = ref(true)
const search = ref('')

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return list.value
  return list.value.filter((r) =>
    `${r.first_name} ${r.last_name} ${r.phone} ${r.referral_code} ${r.referred_by}`.toLowerCase().includes(q)
  )
})

onMounted(async () => {
  await Promise.all([loadSettings(), loadList()])
})

async function loadSettings() {
  loadingSettings.value = true
  try {
    const { data } = await adminAPI.getReferralSettings()
    settings.value = {
      default_commission_pct: data.default_commission_pct,
      reduced_commission_pct: data.reduced_commission_pct,
      weekly_bonus_amount: data.weekly_bonus_amount,
    }
  } finally {
    loadingSettings.value = false
  }
}

async function loadList() {
  loadingList.value = true
  try {
    const { data } = await adminAPI.getReferrals()
    list.value = data.referrals || []
  } finally {
    loadingList.value = false
  }
}

async function saveSettings() {
  settingsError.value = ''
  savingSettings.value = true
  try {
    await adminAPI.updateReferralSettings(settings.value)
    settingsSaved.value = true
    setTimeout(() => { settingsSaved.value = false }, 3000)
  } catch (e) {
    settingsError.value = e.response?.data?.error || 'Ошибка сохранения'
  } finally {
    savingSettings.value = false
  }
}

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('ru-RU') : '—' }
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 800; margin-bottom: 24px; }
.section-card { background: #fff; border-radius: 18px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,.07); margin-bottom: 24px; }
.section-card h3 { font-size: 16px; font-weight: 700; margin-bottom: 18px; }
.loading, .empty { color: #aaa; font-size: 14px; padding: 10px 0; }
.settings-form { display: flex; flex-direction: column; gap: 18px; }
.field-row { display: flex; flex-wrap: wrap; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 180px; }
.field label { font-size: 13px; color: #666; font-weight: 500; }
.form-input {
  padding: 12px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 14px; outline: none; width: 100%;
}
.form-input:focus { border-color: #FFCC00; }
.hint { font-size: 13px; color: #888; background: #fafafa; border-radius: 10px; padding: 12px 16px; line-height: 1.7; }
.error-msg { background: #fce4ec; color: #c62828; padding: 10px 14px; border-radius: 10px; font-size: 14px; }
.actions { display: flex; align-items: center; gap: 14px; }
.save-btn {
  padding: 13px 26px; background: #FFCC00; border: none; border-radius: 12px;
  font-size: 14px; font-weight: 700; cursor: pointer;
}
.save-btn:hover { opacity: .9; }
.save-btn:disabled { opacity: .5; cursor: not-allowed; }
.saved-msg { font-size: 14px; color: #2e7d32; }

.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.card-header h3 { margin: 0; }
.search-input {
  padding: 9px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 13px; outline: none; width: 280px;
}
.search-input:focus { border-color: #FFCC00; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f5f6fa; padding: 10px 12px; text-align: left; color: #666; font-weight: 600; }
.table td { padding: 11px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.ref-code { background: #fff3cd; color: #856404; padding: 3px 8px; border-radius: 6px; font-size: 13px; font-family: monospace; letter-spacing: 2px; }
.ref-code.referred { background: #e8f5e9; color: #2e7d32; }
.no-ref { color: #ccc; }
.badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
.badge.commission { background: #e3f2fd; color: #1565c0; }
.badge.bonus { background: #f3e5f5; color: #7b1fa2; }
.badge.none { background: #f5f5f5; color: #999; }
.details-btn {
  display: inline-block; padding: 5px 12px; background: #1a1a1a; color: #FFCC00;
  border-radius: 8px; font-size: 12px; font-weight: 700; text-decoration: none;
}
.details-btn:hover { opacity: .8; }
</style>
