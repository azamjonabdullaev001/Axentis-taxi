<template>
  <div class="login-page">
    <div class="login-card">
      <div class="logo">🚕</div>
      <h1>Axentis Taxi</h1>
      <p class="subtitle">Панель администратора</p>

      <form @submit.prevent="handleLogin">
        <div class="field">
          <label>Номер телефона</label>
          <input
            v-model="form.phone"
            type="tel"
            placeholder="+998XXXXXXXXX"
            maxlength="13"
            required
            autocomplete="username"
          />
        </div>

        <div class="field">
          <label>Пароль</label>
          <input
            v-model="form.password"
            type="password"
            placeholder="Пароль"
            required
            autocomplete="current-password"
          />
        </div>

        <!-- Token field hidden for the superadmin account -->
        <div class="field" v-if="!isSuperadmin">
          <label>Токен доступа (20 символов)</label>
          <input
            v-model="form.access_token"
            type="text"
            placeholder="20-значный токен"
            maxlength="20"
            :minlength="isSuperadmin ? 0 : 20"
            :required="!isSuperadmin"
            autocomplete="off"
          />
          <small class="hint">{{ form.access_token.length }}/20</small>
        </div>

        <div v-if="error" class="error-msg">{{ error }}</div>

        <button type="submit" :disabled="loading" class="login-btn">
          <span v-if="!loading">Войти</span>
          <span v-else class="spinner">⏳</span>
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { adminAPI } from '../services/api'

const SUPERADMIN_PHONE = '+998914751330'

const router = useRouter()
const form = ref({ phone: '', password: '', access_token: '' })
const loading = ref(false)
const error = ref('')

const isSuperadmin = computed(() =>
  form.value.phone.replace(/\s/g, '') === SUPERADMIN_PHONE
)

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    const payload = {
      phone: form.value.phone,
      password: form.value.password,
      access_token: isSuperadmin.value ? '' : form.value.access_token,
    }
    const { data } = await adminAPI.login(payload)
    localStorage.setItem('admin_token', data.token)
    router.push('/dashboard')
  } catch (e) {
    error.value = e.response?.data?.error || 'Неверные данные'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.login-card {
  background: #fff;
  border-radius: 24px;
  padding: 40px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  text-align: center;
}
.logo { font-size: 56px; margin-bottom: 8px; }
h1 { font-size: 26px; font-weight: 800; color: #1a1a1a; margin-bottom: 4px; }
.subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
.field {
  text-align: left;
  margin-bottom: 18px;
}
.field label {
  display: block;
  font-size: 13px;
  color: #666;
  margin-bottom: 6px;
  font-weight: 500;
}
.field input {
  width: 100%;
  padding: 14px;
  border: 1.5px solid #e0e0e0;
  border-radius: 12px;
  font-size: 15px;
  outline: none;
  transition: border-color .2s;
}
.field input:focus { border-color: #FFCC00; }
.hint { font-size: 12px; color: #999; margin-top: 4px; display: block; }
.error-msg {
  background: #FFF3F3; color: #E53935;
  border-radius: 10px; padding: 12px;
  font-size: 14px; margin-bottom: 16px;
}
.login-btn {
  width: 100%;
  padding: 16px;
  background: #FFCC00;
  border: none;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  transition: opacity .2s;
}
.login-btn:hover { opacity: .9; }
.login-btn:disabled { opacity: .6; cursor: not-allowed; }
</style>
