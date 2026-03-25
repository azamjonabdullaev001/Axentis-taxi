import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE, BACKEND_HOST } from '../config';

/** Build a full URL for a server-stored avatar path like /uploads/avatars/abc.jpg */
export function buildAvatarUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `http://${BACKEND_HOST}${path}`;
}

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      AsyncStorage.removeItem('auth_token');
    }
    return Promise.reject(error);
  }
);

export function getAPIErrorMessage(error, fallback = 'Ошибка запроса') {
  if (error.response?.data?.error) {
    return error.response.data.error;
  }
  if (error.code === 'ECONNABORTED') {
    return 'Сервер не ответил вовремя';
  }
  if (error.request) {
    return `Нет соединения с сервером: ${API_BASE}`;
  }
  return error.message || fallback;
}

export const authAPI = {
  registerPassenger: (data) => api.post('/auth/register/passenger', data),
  login: (data) => api.post('/auth/login', data),
  getProfile: () => api.get('/profile'),
  updateProfile: (data) => api.put('/profile', data),
  uploadAvatar: (formData) => api.post('/upload/avatar', formData),
  savePushToken: (push_token) => api.put('/push-token', { push_token }),
};

export const orderAPI = {
  createOrder: (data) => api.post('/orders', data),
  getOrder: (id) => api.get(`/orders/${id}`),
  getHistory: () => api.get('/orders/history'),
  cancelOrder: (id) => api.post(`/orders/${id}/cancel`),
  updateOrderDistance: (id, drivenKm) => api.put(`/orders/${id}/distance`, { driven_km: drivenKm }),
  rateDriver: (id, rating) => api.post(`/orders/${id}/rate`, { rating }),
  getAvailableDrivers: () => api.get('/drivers/locations'),
  updatePassengerLocation: (lat, lng, heading = null) => api.put('/passenger/location', { lat, lng, heading }),
  updatePassengerLocationSharing: (share_live_location) => api.put('/passenger/location-sharing', { share_live_location }),
  getPricingSettings: () => api.get('/pricing/settings'),
  getTaxiMode: () => api.get('/taxi-mode'),
};

export default api;
