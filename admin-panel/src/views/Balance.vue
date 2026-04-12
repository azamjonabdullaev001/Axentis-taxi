<template>
  <div class="balance-page">
    <h2>💰 Баланс водителей</h2>

    <!-- Summary cards -->
    <div class="summary-cards">
      <div class="card">
        <div class="card-label">Всего водителей</div>
        <div class="card-value">{{ drivers.length }}</div>
      </div>
      <div class="card warning">
        <div class="card-label">Баланс ≤ 0</div>
        <div class="card-value">{{ zeroBalanceCount }}</div>
      </div>
      <div class="card success">
        <div class="card-label">Освобождённые</div>
        <div class="card-value">{{ exemptCount }}</div>
      </div>
      <div class="card">
        <div class="card-label">Общий баланс</div>
        <div class="card-value">{{ formatSum(totalBalance) }}</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button :class="{ active: tab === 'drivers' }" @click="tab = 'drivers'">Водители</button>
      <button :class="{ active: tab === 'transactions' }" @click="tab = 'transactions'; loadTransactions()">История операций</button>
    </div>

    <!-- Drivers tab -->
    <div v-if="tab === 'drivers'" class="drivers-section">
      <div class="search-bar">
        <input v-model="search" placeholder="Поиск по имени или телефону..." class="search-input" />
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Водитель</th>
            <th>Телефон</th>
            <th>Баланс</th>
            <th>Статус</th>
            <th>Освобождён</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in filteredDrivers" :key="d.driver_id">
            <td>{{ d.name }}</td>
            <td>{{ d.phone }}</td>
            <td :class="{ negative: d.balance <= 0 }">{{ formatSum(d.balance) }}</td>
            <td>
              <span class="badge" :class="d.is_available ? 'online' : 'offline'">
                {{ d.is_available ? 'В сети' : 'Офлайн' }}
              </span>
            </td>
            <td>
              <label class="toggle">
                <input type="checkbox" :checked="d.exempt" @change="toggleExempt(d)" />
                <span class="slider"></span>
              </label>
            </td>
            <td>
              <button class="btn-topup" @click="openTopUp(d)">Пополнить</button>
              <button class="btn-history" @click="openDriverHistory(d)">История</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Transactions tab -->
    <div v-if="tab === 'transactions'" class="transactions-section">
      <table class="data-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Водитель</th>
            <th>Тип</th>
            <th>Сумма</th>
            <th>Описание</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tx in transactions" :key="tx.id">
            <td>{{ formatDate(tx.created_at) }}</td>
            <td>{{ tx.driver_name }} ({{ tx.driver_phone }})</td>
            <td>
              <span class="badge" :class="txTypeClass(tx.tx_type)">{{ txTypeLabel(tx.tx_type) }}</span>
            </td>
            <td :class="{ negative: tx.amount < 0, positive: tx.amount > 0 }">
              {{ tx.amount > 0 ? '+' : '' }}{{ formatSum(tx.amount) }}
            </td>
            <td>{{ tx.description }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Top-up modal -->
    <div v-if="topUpModal" class="modal-overlay" @click.self="topUpModal = null">
      <div class="modal">
        <h3>Пополнение баланса</h3>
        <p>{{ topUpModal.name }} ({{ topUpModal.phone }})</p>
        <p>Текущий баланс: <strong :class="{ negative: topUpModal.balance <= 0 }">{{ formatSum(topUpModal.balance) }}</strong></p>
        <div class="form-group">
          <label>Сумма пополнения</label>
          <input v-model.number="topUpAmount" type="number" min="1000" step="1000" placeholder="Сумма" class="form-input" />
        </div>
        <div class="form-group">
          <label>Описание (необязательно)</label>
          <input v-model="topUpDescription" type="text" placeholder="Причина пополнения" class="form-input" />
        </div>
        <div class="quick-amounts">
          <button v-for="amt in [10000, 50000, 100000, 200000, 500000]" :key="amt" @click="topUpAmount = amt" class="quick-btn">
            {{ formatSum(amt) }}
          </button>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="topUpModal = null">Отмена</button>
          <button class="btn-confirm" @click="submitTopUp" :disabled="!topUpAmount || topUpAmount <= 0">Пополнить</button>
        </div>
      </div>
    </div>

    <!-- Driver history modal -->
    <div v-if="historyModal" class="modal-overlay" @click.self="historyModal = null">
      <div class="modal wide">
        <h3>История операций — {{ historyModal.name }}</h3>
        <table class="data-table">
          <thead>
            <tr><th>Дата</th><th>Тип</th><th>Сумма</th><th>Описание</th></tr>
          </thead>
          <tbody>
            <tr v-for="tx in driverTransactions" :key="tx.id">
              <td>{{ formatDate(tx.created_at) }}</td>
              <td><span class="badge" :class="txTypeClass(tx.tx_type)">{{ txTypeLabel(tx.tx_type) }}</span></td>
              <td :class="{ negative: tx.amount < 0, positive: tx.amount > 0 }">{{ tx.amount > 0 ? '+' : '' }}{{ formatSum(tx.amount) }}</td>
              <td>{{ tx.description }}</td>
            </tr>
          </tbody>
        </table>
        <div class="modal-actions"><button class="btn-cancel" @click="historyModal = null">Закрыть</button></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { adminAPI } from '../services/api'

const tab = ref('drivers')
const drivers = ref([])
const transactions = ref([])
const driverTransactions = ref([])
const search = ref('')

const topUpModal = ref(null)
const topUpAmount = ref(50000)
const topUpDescription = ref('')
const historyModal = ref(null)

const zeroBalanceCount = computed(() => drivers.value.filter(d => d.balance <= 0 && !d.exempt).length)
const exemptCount = computed(() => drivers.value.filter(d => d.exempt).length)
const totalBalance = computed(() => drivers.value.reduce((s, d) => s + d.balance, 0))

const filteredDrivers = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return drivers.value
  return drivers.value.filter(d => d.name.toLowerCase().includes(q) || d.phone.includes(q))
})

function formatSum(v) {
  return Math.round(v).toLocaleString('ru-RU') + ' сум'
}
function formatDate(d) {
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function txTypeLabel(t) {
  const map = { top_up: 'Пополнение', commission: 'Комиссия', bonus: 'Бонус', admin_adjustment: 'Корректировка' }
  return map[t] || t
}
function txTypeClass(t) {
  const map = { top_up: 'topup', commission: 'commission', bonus: 'bonus', admin_adjustment: 'adjustment' }
  return map[t] || ''
}

async function loadDrivers() {
  try {
    const { data } = await adminAPI.getDriverBalances()
    drivers.value = data.drivers || []
  } catch (e) { console.error(e) }
}

async function loadTransactions(driverId) {
  try {
    const { data } = await adminAPI.getBalanceTransactions(driverId)
    if (driverId) {
      driverTransactions.value = data.transactions || []
    } else {
      transactions.value = data.transactions || []
    }
  } catch (e) { console.error(e) }
}

function openTopUp(d) {
  topUpModal.value = d
  topUpAmount.value = 50000
  topUpDescription.value = ''
}

async function submitTopUp() {
  if (!topUpModal.value || !topUpAmount.value || topUpAmount.value <= 0) return
  try {
    const { data } = await adminAPI.topUpDriverBalance(topUpModal.value.driver_id, topUpAmount.value, topUpDescription.value)
    const d = drivers.value.find(x => x.driver_id === topUpModal.value.driver_id)
    if (d) d.balance = data.new_balance
    topUpModal.value = null
  } catch (e) {
    alert('Ошибка пополнения: ' + (e.response?.data?.error || e.message))
  }
}

async function toggleExempt(d) {
  try {
    await adminAPI.setDriverExempt(d.driver_id, !d.exempt)
    d.exempt = !d.exempt
  } catch (e) {
    alert('Ошибка: ' + (e.response?.data?.error || e.message))
  }
}

async function openDriverHistory(d) {
  historyModal.value = d
  await loadTransactions(d.driver_id)
}

onMounted(loadDrivers)
</script>

<style scoped>
.balance-page { padding: 28px 32px; max-width: 1200px; }
.balance-page h2 { margin: 0 0 24px; font-size: 22px; }

.summary-cards { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.card {
  background: #fff; border-radius: 14px; padding: 18px 24px; flex: 1; min-width: 160px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.card-label { font-size: 13px; color: #888; margin-bottom: 6px; }
.card-value { font-size: 24px; font-weight: 700; }
.card.warning .card-value { color: #e53935; }
.card.success .card-value { color: #43a047; }

.tabs { display: flex; gap: 0; margin-bottom: 20px; border-bottom: 2px solid #eee; }
.tabs button {
  padding: 10px 24px; background: none; border: none; font-size: 15px; cursor: pointer;
  border-bottom: 3px solid transparent; color: #666; font-weight: 600;
}
.tabs button.active { color: #1a1a1a; border-color: #FFCC00; }

.search-bar { margin-bottom: 16px; }
.search-input {
  width: 100%; max-width: 400px; padding: 10px 16px; border: 1px solid #ddd; border-radius: 10px;
  font-size: 14px; outline: none;
}
.search-input:focus { border-color: #FFCC00; }

.data-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.data-table th, .data-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
.data-table th { background: #fafafa; font-weight: 600; color: #555; font-size: 13px; }

.negative { color: #e53935; font-weight: 600; }
.positive { color: #43a047; font-weight: 600; }

.badge {
  display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;
}
.badge.online { background: #e8f5e9; color: #2e7d32; }
.badge.offline { background: #f5f5f5; color: #999; }
.badge.topup { background: #e8f5e9; color: #2e7d32; }
.badge.commission { background: #fbe9e7; color: #c62828; }
.badge.bonus { background: #fff8e1; color: #f9a825; }
.badge.adjustment { background: #e3f2fd; color: #1565c0; }

.toggle { position: relative; display: inline-block; width: 44px; height: 24px; }
.toggle input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute; cursor: pointer; inset: 0; background: #ccc; border-radius: 24px; transition: 0.3s;
}
.slider:before {
  content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px;
  background: #fff; border-radius: 50%; transition: 0.3s;
}
.toggle input:checked + .slider { background: #FFCC00; }
.toggle input:checked + .slider:before { transform: translateX(20px); }

.btn-topup {
  padding: 6px 14px; border: none; background: #FFCC00; color: #1a1a1a; border-radius: 8px;
  font-weight: 600; font-size: 13px; cursor: pointer; margin-right: 6px;
}
.btn-topup:hover { background: #ffd633; }
.btn-history {
  padding: 6px 14px; border: 1px solid #ddd; background: #fff; color: #555; border-radius: 8px;
  font-size: 13px; cursor: pointer;
}
.btn-history:hover { background: #f5f5f5; }

.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal {
  background: #fff; border-radius: 16px; padding: 28px 32px; width: 440px; max-width: 90vw; max-height: 85vh; overflow-y: auto;
}
.modal.wide { width: 700px; }
.modal h3 { margin: 0 0 16px; font-size: 18px; }
.modal p { margin: 4px 0; font-size: 14px; color: #555; }

.form-group { margin: 16px 0; }
.form-group label { display: block; font-size: 13px; color: #555; margin-bottom: 6px; }
.form-input {
  width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 10px; font-size: 15px; outline: none;
}
.form-input:focus { border-color: #FFCC00; }

.quick-amounts { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 20px; }
.quick-btn {
  padding: 6px 14px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa; cursor: pointer;
  font-size: 13px; font-weight: 500;
}
.quick-btn:hover { border-color: #FFCC00; background: #fffde7; }

.modal-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px; }
.btn-cancel { padding: 10px 24px; border: 1px solid #ddd; background: #fff; border-radius: 10px; cursor: pointer; font-size: 14px; }
.btn-confirm {
  padding: 10px 24px; border: none; background: #FFCC00; color: #1a1a1a; border-radius: 10px;
  font-weight: 700; cursor: pointer; font-size: 14px;
}
.btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
