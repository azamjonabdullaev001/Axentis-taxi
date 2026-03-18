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
          </tr>
        </tbody>
      </table>
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

onMounted(async () => {
  try {
    const { data } = await adminAPI.getUsers()
    const all = data.users || []
    passengers.value = all.filter(u => u.role === 'passenger')
    drivers.value = all.filter(u => u.role === 'driver')
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  const list = tab.value === 'passengers' ? passengers.value : drivers.value
  if (!search.value.trim()) return list
  const q = search.value.toLowerCase()
  return list.filter(u =>
    ((u.first_name || '') + ' ' + (u.last_name || '')).toLowerCase().includes(q) ||
    (u.phone || '').includes(q)
  )
})

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
.table-card { background: #fff; border-radius: 18px; padding: 20px; box-shadow: 0 2px 12px rgba(0,0,0,.07); }
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
</style>
