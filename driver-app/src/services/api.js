import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from '../config';

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

export const authAPI = {
  registerDriver: (data) => api.post('/auth/register/driver', data),
  login: (data) => api.post('/auth/login', data),
  getProfile: () => api.get('/profile'),
  updateProfile: (data) => api.put('/profile', data),
};

export const driverAPI = {
  updateLocation: (lat, lng) => api.put('/driver/location', { lat, lng }),
  updateAvailability: (available) => api.put('/driver/availability', { available }),
  acceptOrder: (id) => api.post(`/orders/${id}/accept`),
  declineOrder: (id) => api.post(`/orders/${id}/decline`),
  arrivedAtPickup: (id) => api.post(`/orders/${id}/arrived`),
  startTrip: (id) => api.post(`/orders/${id}/start`),
  completeTrip: (id) => api.post(`/orders/${id}/complete`),
  getHistory: () => api.get('/orders/history'),
};

export default api;
