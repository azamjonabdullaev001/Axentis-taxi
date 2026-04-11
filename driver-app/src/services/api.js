import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE, BACKEND_HOST } from '../config';

/** Build a full URL for a server-stored avatar path like /uploads/avatars/abc.jpg */
export function buildAvatarUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `http://${BACKEND_HOST}${path}`;
}

const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) AsyncStorage.removeItem('auth_token');
    return Promise.reject(err);
  }
);

export function getAPIErrorMessage(error, fallback = 'Ошибка запроса') {
  if (error.response?.data?.error) return error.response.data.error;
  if (error.code === 'ECONNABORTED') return 'Сервер не ответил вовремя';
  if (error.request) return `Нет соединения с сервером: ${API_BASE}`;
  return error.message || fallback;
}

export const authAPI = {
  registerDriver: (data) => {
    const formData = new FormData();
    formData.append('first_name', data.first_name || '');
    formData.append('last_name', data.last_name || '');
    formData.append('phone', data.phone || '');
    formData.append('password', data.password || '');
    formData.append('confirm_password', data.confirm_password || '');
    formData.append('car_number', data.car_number || '');
    if (data.car_brand) formData.append('car_brand', data.car_brand);
    if (data.referred_by) formData.append('referred_by', data.referred_by);

    ['selfie', 'license_front', 'license_back', 'id_document', 'id_document_back'].forEach((key) => {
      const f = data[key];
      if (f?.uri) {
        formData.append(key, {
          uri: f.uri,
          name: f.name || `${key}.jpg`,
          type: f.type || 'image/jpeg',
        });
      }
    });

    return api.post('/auth/register/driver', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  login: (data) => api.post('/auth/login', data),
  getProfile: () => api.get('/profile'),
  updateProfile: (data) => api.put('/profile', data),
  uploadAvatar: (formData) => api.post('/upload/avatar', formData),
  savePushToken: (push_token) => api.put('/push-token', { push_token }),
};

export const driverAPI = {
  updateLocation: (lat, lng, heading = null) => api.put('/driver/location', { lat, lng, heading }),
  updateAvailability: (available) => api.put('/driver/availability', { available }),
  acceptOrder: (id) => api.post(`/orders/${id}/accept`),
  declineOrder: (id) => api.post(`/orders/${id}/decline`),
  arrivedAtPickup: (id) => api.post(`/orders/${id}/arrived`),
  startTrip: (id) => api.post(`/orders/${id}/start`),
  completeTrip: (id) => api.post(`/orders/${id}/complete`),
  updateOrderDistance: (id, driven_km) => api.put(`/orders/${id}/distance`, { driven_km }),
  getHistory: () => api.get('/orders/history'),
  getDriverRatings: () => api.get('/driver/ratings'),
  applyReferral: (referral_code, benefit_type) =>
    api.post('/referral/apply', { referral_code, benefit_type }),
  getBonusHistory: () => api.get('/driver/bonus-history'),
};

export const friendsAPI = {
  searchDriver: (phone) => api.get('/drivers/search', { params: { phone } }),
  sendRequest: (recipient_driver_id) =>
    api.post('/driver/friends/request', { recipient_driver_id }),
  acceptRequest: (id) => api.put(`/driver/friends/${id}/accept`),
  declineRequest: (id) => api.delete(`/driver/friends/${id}/decline`),
  getFriends: () => api.get('/driver/friends'),
  getPendingRequests: () => api.get('/driver/friends/requests'),
  transferOrder: (order_id, friend_driver_id) =>
    api.post(`/orders/${order_id}/transfer`, { friend_driver_id }),
};

export default api;
