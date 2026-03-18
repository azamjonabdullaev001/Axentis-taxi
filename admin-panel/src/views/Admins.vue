<template>
  <div>
    <h2 class="page-title">Администраторы</h2>

    <div class="section-card">
      <h3>Список администраторов</h3>
      <div v-if="loading" class="loading">Загрузка...</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Телефон</th>
            <th>Создан</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in admins" :key="a.id">
            <td>{{ a.phone }}</td>
            <td><small>{{ fmtDate(a.created_at) }}</small></td>
            <td>
              <span :class="['badge', a.is_active ? 'active' : 'inactive']">
                {{ a.is_active !== false ? 'Активен' : 'Неактивен' }}
              </span>
            </td>
          </tr>
          <tr v-if="admins.length === 0">
            <td colspan="3" class="empty">Нет данных</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section-card">
      <h3>Добавить администратора</h3>
      <div class="create-form">
        <div class="field-row">
          <div class="field">
            <label>Телефон (до 13 символов)</label>
            <input v-model="form.phone" type="tel" maxlength="13" placeholder="+998XXXXXXXXX" class="form-input" />
          </div>
          <div class="field">
            <label>Пароль (мин. 8 символов)</label>
            <input v-model="form.password" type="password" minlength="8" placeholder="Пароль" class="form-input" />
          </div>
        </div>
        <div class="field token-field">
          <label>
            Токен доступа (ровно 20 символов)
            <span class="token-count" :class="form.access_token.length === 20 ? 'ok' : ''">
              {{ form.access_token.length }}/20
            </span>
          </label>
          <div class="token-row">
            <input
              v-model="form.access_token"
              type="text"
              maxlength="20"
              minlength="20"
              placeholder="20-значный токен"
              class="form-input token-input"
              autocomplete="off"
            />
            <button class="gen-btn" type="button" @click="generateToken">🔀 Генерировать</button>
          </div>
        </div>
        <div v-if="error" class="error-msg">{{ error }}</div>
        <div class="actions">
          <button class="save-btn" :disabled="saving || form.access_token.length !== 20" @click="createAdmin">
            {{ saving ? 'Создание...' : '➕ Создать администратора' }}
          </button>
          <span v-if="created" class="saved-msg">✅ Администратор создан!</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { adminAPI } from '../services/api'

const admins = ref([])
const loading = ref(true)
const form = ref({ phone: '', password: '', access_token: '' })
const saving = ref(false)
const error = ref('')
const created = ref(false)

onMounted(async () => {
  await loadAdmins()
})

async function loadAdmins() {
  loading.value = true
  try {
    const { data } = await adminAPI.getAdmins()
    admins.value = data.admins || []
  } finally {
    loading.value = false
  }
}

function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  form.value.access_token = Array.from({ length: 20 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

async function createAdmin() {
  error.value = ''
  if (!form.value.phone) { error.value = 'Укажите телефон'; return }
  if (form.value.password.length < 8) { error.value = 'Пароль минимум 8 символов'; return }
  if (form.value.access_token.length !== 20) { error.value = 'Токен должен быть ровно 20 символов'; return }
  saving.value = true
  try {
    await adminAPI.createAdmin(form.value)
    form.value = { phone: '', password: '', access_token: '' }
    created.value = true
    setTimeout(() => { created.value = false }, 3000)
    await loadAdmins()
  } catch (e) {
    error.value = e.response?.data?.error || 'Ошибка создания'
  } finally {
    saving.value = false
  }
}

function fmtDate(d) { return d ? new Date(d).toLocaleString('ru-RU') : '—' }
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 800; margin-bottom: 24px; }
.section-card { background: #fff; border-radius: 18px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,.07); margin-bottom: 24px; }
.section-card h3 { font-size: 16px; font-weight: 700; margin-bottom: 18px; }
.loading, .empty { color: #aaa; font-size: 14px; padding: 10px 0; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f5f6fa; padding: 10px 12px; text-align: left; color: #666; font-weight: 600; }
.table td { padding: 11px 12px; border-bottom: 1px solid #f0f0f0; }
.table tr:last-child td { border-bottom: none; }
.badge {
  display: inline-block; padding: 3px 10px; border-radius: 20px;
  font-size: 12px; font-weight: 600;
}
.badge.active { background: #e8f5e9; color: #2e7d32; }
.badge.inactive { background: #f5f5f5; color: #999; }
.create-form { display: flex; flex-direction: column; gap: 18px; }
.field-row { display: flex; flex-wrap: wrap; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 200px; }
.field label { font-size: 13px; color: #666; font-weight: 500; display: flex; align-items: center; gap: 8px; }
.form-input {
  padding: 12px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 14px; outline: none; width: 100%;
}
.form-input:focus { border-color: #FFCC00; }
.token-field { width: 100%; }
.token-row { display: flex; gap: 10px; }
.token-input { flex: 1; }
.token-count { font-size: 12px; color: #aaa; font-weight: 600; }
.token-count.ok { color: #2e7d32; }
.gen-btn {
  padding: 12px 16px; background: #1a1a1a; color: #FFCC00;
  border: none; border-radius: 10px; font-size: 13px;
  font-weight: 700; cursor: pointer; white-space: nowrap;
}
.gen-btn:hover { opacity: .85; }
.error-msg { background: #fce4ec; color: #c62828; padding: 10px 14px; border-radius: 10px; font-size: 14px; }
.actions { display: flex; align-items: center; gap: 14px; }
.save-btn {
  padding: 14px 28px; background: #FFCC00; border: none; border-radius: 12px;
  font-size: 14px; font-weight: 700; cursor: pointer;
}
.save-btn:hover { opacity: .9; }
.save-btn:disabled { opacity: .5; cursor: not-allowed; }
.saved-msg { font-size: 14px; color: #2e7d32; }
</style>
