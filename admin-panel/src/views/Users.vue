<template>
  <div>
    <div class="page-header">
      <h2 class="page-title">Users</h2>
      <div class="tabs">
        <button :class="['tab', tab === 'passengers' ? 'active' : '']" @click="tab = 'passengers'">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Passengers ({{ passengers.length }})
        </button>
        <button :class="['tab', tab === 'drivers' ? 'active' : '']" @click="tab = 'drivers'">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
          Drivers ({{ drivers.length }})
        </button>
      </div>
    </div>

    <div class="table-card">
      <div class="search-row">
        <input v-model="search" class="search-input" placeholder="Search by name or phone..." />
      </div>
      <template v-if="loading">
        <div v-for="i in 6" :key="i" class="sk-row">
          <div class="sk sk-cell-md"></div>
          <div class="sk sk-cell-sm"></div>
          <div class="sk sk-cell-sm"></div>
          <div class="sk sk-cell-sm"></div>
        </div>
      </template>
      <div v-else-if="filtered.length === 0" class="empty">No users</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th v-if="tab === 'drivers'">Car</th>
            <th v-if="tab === 'drivers'">Online</th>
            <th v-if="tab === 'drivers'">Verification</th>
            <th>Created</th>
            <th>Active</th>
            <th v-if="tab === 'drivers'"></th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filtered" :key="u.id">
            <td>
              <div class="name-cell">
                <img v-if="u.avatar_url && u.avatar_url.startsWith('/')" :src="u.avatar_url" class="user-avatar" />
                <span v-else class="avatar-placeholder">{{ ((u.first_name || '?')[0]).toUpperCase() }}</span>
                {{ (u.first_name || '') + ' ' + (u.last_name || '') || '-' }}
              </div>
            </td>
            <td>{{ u.phone }}</td>
            <td v-if="tab === 'drivers'">
              <span v-if="u.car_number" class="car-badge">{{ u.car_number }}</span>
              <span v-else class="dim">-</span>
            </td>
            <td v-if="tab === 'drivers'">
              <span :class="['dot', u.is_available ? 'online' : 'offline']"></span>
              {{ u.is_available ? 'Available' : 'Offline' }}
            </td>
            <td v-if="tab === 'drivers'">
              <span :class="['badge', statusClass(u.registration_status)]">{{ statusLabel(u.registration_status) }}</span>
            </td>
            <td><small>{{ fmtDate(u.created_at) }}</small></td>
            <td>
              <span :class="['badge', u.is_active !== false ? 'active' : 'inactive']">
                {{ u.is_active !== false ? 'Yes' : 'No' }}
              </span>
            </td>
            <td v-if="tab === 'drivers'">
              <router-link v-if="u.driver_id" :to="`/drivers/${u.driver_id}`" class="analytics-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                Analytics
              </router-link>
            </td>
            <td>
              <div class="action-btns">
                <button v-if="u.is_active !== false" class="ban-btn" :disabled="processingId === u.id" @click="showBanDialog(u)">🚫 Ban</button>
                <button v-else class="unban-btn" :disabled="processingId === u.id" @click="unbanUser(u)">✅ Unban</button>
                <button class="delete-btn" :disabled="processingId === u.id" @click="deleteUser(u)">🗑 Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="tab === 'drivers'" class="section-card">
      <h3>Add driver manually</h3>
      <div class="create-form">
        <div class="field-row">
          <div class="field">
            <label>First name</label>
            <input v-model="driverForm.first_name" class="form-input" placeholder="First name" />
          </div>
          <div class="field">
            <label>Last name</label>
            <input v-model="driverForm.last_name" class="form-input" placeholder="Last name" />
          </div>
          <div class="field">
            <label>Phone (+998...)</label>
            <input v-model="driverForm.phone" class="form-input" placeholder="+998901234567" maxlength="13" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Password (min 8 chars)</label>
            <input v-model="driverForm.password" type="password" class="form-input" placeholder="Password" minlength="8" />
          </div>
          <div class="field">
            <label>Car number (e.g. 01A123BC)</label>
            <input v-model="driverForm.car_number" class="form-input" placeholder="01A123BC" maxlength="12" />
          </div>
        </div>
        <div v-if="driverError" class="error-msg">{{ driverError }}</div>
        <div class="actions">
          <button class="save-btn" :disabled="savingDriver" @click="createDriver">
            {{ savingDriver ? 'Creating...' : 'Create driver' }}
          </button>
          <div v-if="driverCreated" class="saved-msg">Driver created. Code: <b>{{ driverCreated }}</b></div>
        </div>
      </div>
    </div>

    <div v-if="tab === 'drivers'" class="section-card">
      <h3>Pending driver registrations ({{ pendingDrivers.length }})</h3>
      <div v-if="pendingLoading" class="loading">Loading...</div>
      <div v-else-if="pendingDrivers.length === 0" class="empty">No pending registrations</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Driver</th>
            <th>Phone</th>
            <th>Car</th>
            <th>Documents</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in pendingDrivers" :key="d.driver_id">
            <td>{{ d.first_name }} {{ d.last_name }}</td>
            <td>{{ d.phone }}</td>
            <td><span class="car-badge">{{ d.car_number || '-' }}</span></td>
            <td>
              <div class="doc-links">
                <a v-if="d.selfie_url" :href="d.selfie_url" target="_blank">Selfie</a>
                <a v-if="d.license_front_url" :href="d.license_front_url" target="_blank">License front</a>
                <a v-if="d.license_back_url" :href="d.license_back_url" target="_blank">License back</a>
                <a v-if="d.id_document_url" :href="d.id_document_url" target="_blank">Passport/ID</a>
              </div>
            </td>
            <td><small>{{ fmtDate(d.created_at) }}</small></td>
            <td>
              <div class="actions">
                <button class="save-btn" :disabled="processingId === d.driver_id" @click="approveDriver(d)">Approve</button>
                <button class="reject-btn" :disabled="processingId === d.driver_id" @click="rejectDriver(d)">Reject</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- Ban dialog -->
    <div v-if="banDialogUser" class="modal-overlay" @click.self="banDialogUser = null">
      <div class="modal-card">
        <h3>Ban user: {{ banDialogUser.first_name }} {{ banDialogUser.last_name }}</h3>
        <div class="field">
          <label>Duration</label>
          <select v-model="banDuration" class="form-input">
            <option value="1h">1 hour</option>
            <option value="24h">24 hours</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="forever">Permanent</option>
          </select>
        </div>
        <div class="field">
          <label>Reason (optional)</label>
          <input v-model="banReason" class="form-input" placeholder="Spam, abuse, etc." />
        </div>
        <div class="actions" style="margin-top:12px">
          <button class="ban-btn" :disabled="banning" @click="confirmBan">{{ banning ? 'Banning...' : 'Confirm ban' }}</button>
          <button class="cancel-btn" @click="banDialogUser = null">Cancel</button>
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
const pendingDrivers = ref([])
const pendingLoading = ref(false)
const processingId = ref('')
const loading = ref(true)
const search = ref('')

const driverForm = ref({ first_name: '', last_name: '', phone: '', password: '', car_number: '' })
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
    await loadPendingDrivers()
  } finally {
    loading.value = false
  }
}

async function loadPendingDrivers() {
  pendingLoading.value = true
  try {
    const { data } = await adminAPI.getPendingDrivers()
    pendingDrivers.value = data.drivers || []
  } finally {
    pendingLoading.value = false
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
  if (!driverForm.value.first_name) { driverError.value = 'Enter first name'; return }
  if (!driverForm.value.last_name) { driverError.value = 'Enter last name'; return }
  if (!driverForm.value.phone) { driverError.value = 'Enter phone'; return }
  if (driverForm.value.password.length < 8) { driverError.value = 'Password min 8 chars'; return }
  if (!driverForm.value.car_number) { driverError.value = 'Enter car number'; return }
  savingDriver.value = true
  try {
    const { data } = await adminAPI.createDriver(driverForm.value)
    driverCreated.value = data.referral_code || 'created'
    driverForm.value = { first_name: '', last_name: '', phone: '', password: '', car_number: '' }
    await loadUsers()
  } catch (e) {
    driverError.value = e.response?.data?.error || 'Creation failed'
  } finally {
    savingDriver.value = false
  }
}

async function approveDriver(driver) {
  processingId.value = driver.driver_id
  try {
    await adminAPI.approveDriver(driver.driver_id)
    await loadUsers()
  } catch (e) {
    alert(e.response?.data?.error || 'Approve failed')
  } finally {
    processingId.value = ''
  }
}

async function rejectDriver(driver) {
  const comment = window.prompt('Rejection reason (required):', '')
  if (!comment || !comment.trim()) return
  processingId.value = driver.driver_id
  try {
    await adminAPI.rejectDriver(driver.driver_id, comment.trim())
    await loadUsers()
  } catch (e) {
    alert(e.response?.data?.error || 'Reject failed')
  } finally {
    processingId.value = ''
  }
}

function statusLabel(status) {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return 'Pending'
}

function statusClass(status) {
  if (status === 'approved') return 'approved'
  if (status === 'rejected') return 'rejected'
  return 'pending'
}

function fmtDate(d) { return d ? new Date(d).toLocaleString('ru-RU') : '-' }

/* ── Ban / Unban / Delete ── */
const banDialogUser = ref(null)
const banDuration = ref('24h')
const banReason = ref('')
const banning = ref(false)

function showBanDialog(u) {
  banDialogUser.value = u
  banDuration.value = '24h'
  banReason.value = ''
}

async function confirmBan() {
  if (!banDialogUser.value) return
  banning.value = true
  processingId.value = banDialogUser.value.id
  try {
    await adminAPI.banUser(banDialogUser.value.id, banDuration.value, banReason.value)
    banDialogUser.value = null
    await loadUsers()
  } catch (e) {
    alert(e.response?.data?.error || 'Ban failed')
  } finally {
    banning.value = false
    processingId.value = ''
  }
}

async function unbanUser(u) {
  if (!confirm(`Unban ${u.first_name || ''} ${u.last_name || ''}?`)) return
  processingId.value = u.id
  try {
    await adminAPI.unbanUser(u.id)
    await loadUsers()
  } catch (e) {
    alert(e.response?.data?.error || 'Unban failed')
  } finally {
    processingId.value = ''
  }
}

async function deleteUser(u) {
  if (!confirm(`DELETE user ${u.first_name || ''} ${u.last_name || ''} (${u.phone})? This is irreversible!`)) return
  processingId.value = u.id
  try {
    await adminAPI.deleteUser(u.id)
    await loadUsers()
  } catch (e) {
    alert(e.response?.data?.error || 'Delete failed')
  } finally {
    processingId.value = ''
  }
}
</script>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 22px; }
.page-title { font-size: 22px; font-weight: 800; color: #1a1a1a; }
.tabs { display: flex; gap: 8px; }
.tab {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 18px; border: 1.5px solid #e0e0e0; background: #fff;
  border-radius: 10px; font-size: 13.5px; cursor: pointer; font-weight: 500;
  transition: all .15s;
}
.tab.active { background: #FFCC00; border-color: #FFCC00; font-weight: 700; }
.tab:hover:not(.active) { background: #f5f6fa; }
.table-card { background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 1px 8px rgba(0,0,0,.06); margin-bottom: 24px; }
.section-card { background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 1px 8px rgba(0,0,0,.06); margin-bottom: 24px; }
.section-card h3 { font-size: 15px; font-weight: 700; margin-bottom: 18px; }
.search-row { margin-bottom: 16px; }
.search-input {
  width: 100%; max-width: 340px; padding: 10px 14px;
  border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 14px; outline: none;
}
.search-input:focus { border-color: #FFCC00; }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.sk { background: linear-gradient(90deg, #f0f0f0 25%, #e4e4e4 50%, #f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 6px; }
.sk-row { display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid #f5f5f5; align-items: center; }
.sk-cell-sm  { height: 13px; width: 80px; }
.sk-cell-md  { height: 13px; width: 140px; }
.loading, .empty { color: #aaa; font-size: 14px; padding: 16px 0; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f8f9fb; padding: 10px 12px; text-align: left; color: #666; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; }
.table td { padding: 11px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.name-cell { font-weight: 600; color: #1a1a1a; display: flex; align-items: center; gap: 10px; }
.user-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid #FFCC00; }
.avatar-placeholder {
  width: 36px; height: 36px; border-radius: 50%; background: #FFCC00; color: #1a1a1a;
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 14px; flex-shrink: 0;
}
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
.badge.pending { background: #fff8e1; color: #8a6d1f; }
.badge.approved { background: #e8f5e9; color: #2e7d32; }
.badge.rejected { background: #fdecea; color: #b3261e; }
.analytics-btn {
  display: inline-block; padding: 4px 10px; background: #1a1a1a; color: #FFCC00;
  border-radius: 8px; font-size: 13px; text-decoration: none;
}
.analytics-btn:hover { opacity: .8; }
.doc-links { display: flex; gap: 8px; flex-wrap: wrap; }
.doc-links a { font-size: 12px; text-decoration: none; color: #1565c0; font-weight: 600; }
.doc-links a:hover { text-decoration: underline; }

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
.reject-btn {
  padding: 14px 20px; background: #fff; border: 1px solid #ef4444; color: #ef4444;
  border-radius: 12px; font-size: 14px; font-weight: 700; cursor: pointer;
}
.reject-btn:disabled { opacity: .5; cursor: not-allowed; }
.saved-msg { font-size: 14px; color: #2e7d32; }

/* ── Ban / Delete action buttons ── */
.action-btns { display: flex; gap: 6px; align-items: center; }
.ban-btn {
  padding: 5px 12px; background: #ff9800; color: #fff; border: none;
  border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.ban-btn:hover { background: #e68a00; }
.ban-btn:disabled { opacity: .5; cursor: not-allowed; }
.unban-btn {
  padding: 5px 12px; background: #4caf50; color: #fff; border: none;
  border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.unban-btn:hover { background: #388e3c; }
.unban-btn:disabled { opacity: .5; cursor: not-allowed; }
.delete-btn {
  padding: 5px 12px; background: #ef4444; color: #fff; border: none;
  border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.delete-btn:hover { background: #c62828; }
.delete-btn:disabled { opacity: .5; cursor: not-allowed; }
.cancel-btn {
  padding: 10px 20px; background: #eee; border: none; border-radius: 10px;
  font-size: 14px; cursor: pointer;
}

/* ── Modal overlay ── */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal-card {
  background: #fff; border-radius: 16px; padding: 28px; min-width: 360px;
  box-shadow: 0 8px 32px rgba(0,0,0,.18);
}
.modal-card h3 { margin-bottom: 16px; font-size: 16px; }
</style>
