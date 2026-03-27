<template>
  <div>
    <div class="page-header">
      <h2 class="page-title">Пользователи</h2>
      <div class="tabs">
        <button :class="['tab', tab === 'passengers' ? 'active' : '']" @click="tab = 'passengers'">
          👤 Пассажиры ({{ passengers.length }})
        </button>
        <button :class="['tab', tab === 'drivers' ? 'active' : '']" @click="tab = 'drivers'">
          🚖 Водители ({{ drivers.length }})
        </button>
      </div>
    </div>

    <div class="table-card">
      <div class="search-row">
        <input v-model="search" class="search-input" placeholder="Поиск по имени или телефону..." />
      </div>
      <div v-if="loading" class="loading">Загрузка...</div>
      <div v-else-if="filtered.length === 0" class="empty">Нет пользователей</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Имя</th>
            <th>Телефон</th>
            <th v-if="tab === 'drivers'">Машина</th>
            <th v-if="tab === 'drivers'">Статус (онлайн)</th>
            <th>Дата регистрации</th>
            <th>Активен</th>
            <th v-if="tab === 'drivers'"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filtered" :key="u.id">
            <td>
              <div class="name-cell">{{ (u.first_name || '') + ' ' + (u.last_name || '') || '—' }}</div>
            </td>
            <td>{{ u.phone }}</td>
            <td v-if="tab === 'drivers'">
              <span v-if="u.car_number" class="car-badge">{{ u.car_number }}</span>
              <span v-else class="dim">—</span>
            </td>
            <td v-if="tab === 'drivers'">
              <span :class="['dot', u.is_available ? 'online' : 'offline']"></span>
              {{ u.is_available ? 'Доступен' : 'Офлайн' }}
            </td>
            <td><small>{{ fmtDate(u.created_at) }}</small></td>
            <td>
              <span :class="['badge', u.is_active !== false ? 'active' : 'inactive']">
                {{ u.is_active !== false ? 'Да' : 'Нет' }}
              </span>
            </td>
            <td v-if="tab === 'drivers'">
              <router-link v-if="u.driver_id" :to="`/drivers/${u.driver_id}`" class="analytics-btn">📊</router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create driver form (only in drivers tab) -->
    <div v-if="tab === 'drivers'" class="section-card">
      <h3>➕ Добавить водителя</h3>
      <div class="create-form">
        <div class="field-row">
          <div class="field">
            <label>Имя</label>
            <input v-model="driverForm.first_name" class="form-input" placeholder="Имя" />
          </div>
          <div class="field">
            <label>Фамилия</label>
            <input v-model="driverForm.last_name" class="form-input" placeholder="Фамилия" />
          </div>
          <div class="field">
            <label>Телефон (+998...)</label>
            <input v-model="driverForm.phone" class="form-input" placeholder="+998901234567" maxlength="13" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Пароль (мин. 8 символов)</label>
            <input v-model="driverForm.password" type="password" class="form-input" placeholder="Пароль" minlength="8" />
          </div>
          <div class="field">
            <label>Номер авто (напр. 01A123BC)</label>
            <input v-model="driverForm.car_number" class="form-input" placeholder="01A123BC" maxlength="12" />
          </div>
          <div class="field">
            <label>ПИНФЛ (ЖШШИР) — 14 цифр</label>
            <input v-model="driverForm.pinfl" class="form-input" placeholder="14-значный ПИНФЛ" maxlength="14" />
          </div>
        </div>
        <div v-if="driverError" class="error-msg">{{ driverError }}</div>
        <div class="actions">
          <button class="save-btn" :disabled="savingDriver" @click="createDriver">
            {{ savingDriver ? 'Создание...' : '➕ Создать водителя' }}
          </button>
          <div v-if="driverCreated" class="saved-msg">✅ Водитель создан! Код: <b>{{ driverCreated }}</b></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { adminAPI } from '../services/api'

const tab = ref('passengers')
const passengers = ref([])
const drivers = ref([])
const loading = ref(true)
const search = ref('')

// Driver creation
const driverForm = ref({ first_name: '', last_name: '', phone: '', password: '', car_number: '', pinfl: '' })
const savingDriver = ref(false)
const driverError = ref('')
const driverCreated = ref('')

onMounted(async () => {
  await loadUsers()
})

async function loadUsers() {
  loading.value = true
  try {
    const [passRes, drvRes] = await Promise.all([
      adminAPI.getUsers('passenger'),
      adminAPI.getDriversWithDetails(),
    ])
    passengers.value = passRes.data.users || []
    drivers.value = drvRes.data.users || []
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => {
  const list = tab.value === 'passengers' ? passengers.value : drivers.value
  if (!search.value.trim()) return list
  const q = search.value.toLowerCase()
  return list.filter(u =>
    ((u.first_name || '') + ' ' + (u.last_name || '')).toLowerCase().includes(q) ||
    (u.phone || '').includes(q)
  )
})

async function createDriver() {
  driverError.value = ''
  driverCreated.value = ''
  if (!driverForm.value.first_name) { driverError.value = 'Введите имя'; return }
  if (!driverForm.value.last_name) { driverError.value = 'Введите фамилию'; return }
  if (!driverForm.value.phone) { driverError.value = 'Введите телефон'; return }
  if (driverForm.value.password.length < 8) { driverError.value = 'Пароль минимум 8 символов'; return }
  if (!driverForm.value.car_number) { driverError.value = 'Введите номер авто'; return }
  savingDriver.value = true
  try {
    const { data } = await adminAPI.createDriver(driverForm.value)
    driverCreated.value = data.referral_code || 'создан'
    driverForm.value = { first_name: '', last_name: '', phone: '', password: '', car_number: '', pinfl: '' }
    await loadUsers()
  } catch (e) {
    driverError.value = e.response?.data?.error || 'Ошибка создания'
  } finally {
    savingDriver.value = false
  }
}

function fmtDate(d) { return d ? new Date(d).toLocaleString('ru-RU') : '—' }
</script>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 22px; }
.page-title { font-size: 22px; font-weight: 800; color: #1a1a1a; }
.tabs { display: flex; gap: 8px; }
.tab {
  padding: 10px 20px; border: 1.5px solid #e0e0e0; background: #fff;
  border-radius: 10px; font-size: 14px; cursor: pointer; font-weight: 500;
  transition: all .15s;
}
.tab.active { background: #FFCC00; border-color: #FFCC00; font-weight: 700; }
.tab:hover:not(.active) { background: #f5f6fa; }
.table-card { background: #fff; border-radius: 18px; padding: 20px; box-shadow: 0 2px 12px rgba(0,0,0,.07); margin-bottom: 24px; }
.section-card { background: #fff; border-radius: 18px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,.07); margin-bottom: 24px; }
.section-card h3 { font-size: 16px; font-weight: 700; margin-bottom: 18px; }
.search-row { margin-bottom: 16px; }
.search-input {
  width: 100%; max-width: 340px; padding: 10px 14px;
  border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 14px; outline: none;
}
.search-input:focus { border-color: #FFCC00; }
.loading, .empty { color: #aaa; font-size: 14px; padding: 16px 0; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f5f6fa; padding: 10px 12px; text-align: left; color: #666; font-weight: 600; }
.table td { padding: 11px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.name-cell { font-weight: 600; color: #1a1a1a; }
.car-badge {
  display: inline-block; background: #1a1a1a; color: #FFCC00;
  border-radius: 6px; padding: 2px 8px; font-family: monospace; font-size: 12px;
}
.dim { color: #ccc; }
.dot {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 50%; margin-right: 6px; vertical-align: middle;
}
.dot.online { background: #2ecc71; }
.dot.offline { background: #ccc; }
.badge {
  display: inline-block; padding: 3px 10px; border-radius: 20px;
  font-size: 12px; font-weight: 600;
}
.badge.active { background: #e8f5e9; color: #2e7d32; }
.badge.inactive { background: #f5f5f5; color: #999; }
.analytics-btn {
  display: inline-block; padding: 4px 10px; background: #1a1a1a; color: #FFCC00;
  border-radius: 8px; font-size: 13px; text-decoration: none;
}
.analytics-btn:hover { opacity: .8; }

/* Driver creation form */
.create-form { display: flex; flex-direction: column; gap: 18px; }
.field-row { display: flex; flex-wrap: wrap; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 180px; }
.field label { font-size: 13px; color: #666; font-weight: 500; }
.form-input {
  padding: 12px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 14px; outline: none; width: 100%;
}
.form-input:focus { border-color: #FFCC00; }
.error-msg { background: #fce4ec; color: #c62828; padding: 10px 14px; border-radius: 10px; font-size: 14px; }
.actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.save-btn {
  padding: 14px 28px; background: #FFCC00; border: none; border-radius: 12px;
  font-size: 14px; font-weight: 700; cursor: pointer;
}
.save-btn:hover { opacity: .9; }
.save-btn:disabled { opacity: .5; cursor: not-allowed; }
.saved-msg { font-size: 14px; color: #2e7d32; }
</style>
