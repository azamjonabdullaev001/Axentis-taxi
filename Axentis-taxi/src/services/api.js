import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from '../config';

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

export const authAPI = {
  registerPassenger: (data) => api.post('/auth/register/passenger', data),
  login: (data) => api.post('/auth/login', data),
  getProfile: () => api.get('/profile'),
  updateProfile: (data) => api.put('/profile', data),
};

export const orderAPI = {
  createOrder: (data) => api.post('/orders', data),
  getOrder: (id) => api.get(`/orders/${id}`),
  getHistory: () => api.get('/orders/history'),
  cancelOrder: (id) => api.post(`/orders/${id}/cancel`),
};

export default api;
