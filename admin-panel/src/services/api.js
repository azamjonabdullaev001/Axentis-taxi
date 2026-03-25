import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export const adminAPI = {
  login: (d) => api.post('/admin/login', d),
  getOrders: (params) => api.get('/admin/orders', { params }),
  getRevenue: () => api.get('/admin/revenue'),
  getUsers: (role) => api.get('/admin/users', { params: { role } }),
  getPricing: () => api.get('/admin/pricing'),
  updatePricing: (d) => api.put('/admin/pricing', d),
  getSurgeSchedules: () => api.get('/admin/surge-schedules'),
  createSurgeSchedule: (d) => api.post('/admin/surge-schedules', d),
  deleteSurgeSchedule: (id) => api.delete(`/admin/surge-schedules/${id}`),
  getPeakPeriods: () => api.get('/admin/peak-periods'),
  createPeakPeriod: (d) => api.post('/admin/peak-periods', d),
  deletePeakPeriod: (id) => api.delete(`/admin/peak-periods/${id}`),
  getAdmins: () => api.get('/admin/admins'),
  createAdmin: (d) => api.post('/admin/admins', d),
  // Royal Taxi Mode
  getTaxiMode: () => api.get('/admin/taxi-mode'),
  setTaxiMode: (mode) => api.put('/admin/taxi-mode', { mode }),
  createCallOrder: (d) => api.post('/admin/call-orders', d),
}

export default api
