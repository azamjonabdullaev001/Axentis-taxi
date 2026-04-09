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
  getHourlySurge: () => api.get('/admin/hourly-surge'),
  updateHourlySurge: (d) => api.put('/admin/hourly-surge', d),
  getAdmins: () => api.get('/admin/admins'),
  createAdmin: (d) => api.post('/admin/admins', d),
  // Royal Taxi Mode
  getTaxiMode: () => api.get('/admin/taxi-mode'),
  setTaxiMode: (mode) => api.put('/admin/taxi-mode', { mode }),
  createCallOrder: (d) => api.post('/admin/call-orders', d),
  // Driver management
  createDriver: (d) => api.post('/admin/drivers', d),
  getPendingDrivers: () => api.get('/admin/drivers/pending'),
  approveDriver: (id, comment = '') => api.post(`/admin/drivers/${id}/approve`, { comment }),
  rejectDriver: (id, comment) => api.post(`/admin/drivers/${id}/reject`, { comment }),
  getDriverAnalytics: (id, params) => api.get(`/admin/drivers/${id}/analytics`, { params }),
  getDriversWithDetails: () => api.get('/admin/users', { params: { role: 'driver' } }),
  getOnlineDrivers: () => api.get('/admin/drivers/online'),
  getPhoneHistory: (phone) => api.get('/admin/phone-history', { params: { phone } }),
  // User management
  banUser: (id, duration, reason) => api.post(`/admin/users/${id}/ban`, { duration, reason }),
  unbanUser: (id) => api.post(`/admin/users/${id}/unban`),
  deleteUser: (id) => api.delete(`/admin/users/${id}`),
  // Referral program
  getReferralSettings: () => api.get('/admin/referral-settings'),
  updateReferralSettings: (d) => api.put('/admin/referral-settings', d),
  getReferrals: () => api.get('/admin/referrals'),
  // Bonus system
  getBonusSettings: () => api.get('/admin/bonus-settings'),
  updateBonusSettings: (d) => api.put('/admin/bonus-settings', d),
  getBonusEvents: () => api.get('/admin/bonus-events'),
}

export default api
