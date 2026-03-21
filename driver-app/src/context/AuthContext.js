import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authAPI } from '../services/api';
import socket from '../services/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { checkAuth(); }, []);

  async function checkAuth() {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      const userID = await AsyncStorage.getItem('user_id');
      if (token && userID) {
        const { data } = await authAPI.getProfile();
        setUser(data.user);
        setDriver(data.driver || null);
        socket.connect(userID);
      }
    } catch {
      await AsyncStorage.multiRemove(['auth_token', 'user_id']);
    } finally {
      setLoading(false);
    }
  }

  async function login(phone, password) {
    const { data } = await authAPI.login({ phone, password });
    if (data.role !== 'driver') throw new Error('Только для водителей');
    await AsyncStorage.setItem('auth_token', data.token);
    await AsyncStorage.setItem('user_id', data.user_id);
    try {
      const profile = await authAPI.getProfile();
      setUser(profile.data.user);
      setDriver(profile.data.driver || null);
    } catch {
      setUser({ id: data.user_id, role: data.role });
      setDriver(null);
    }
    socket.connect(data.user_id);
    return data;
  }

  async function register(userData) {
    const { data } = await authAPI.registerDriver(userData);
    await AsyncStorage.setItem('auth_token', data.token);
    await AsyncStorage.setItem('user_id', data.user_id);
    try {
      const profile = await authAPI.getProfile();
      setUser(profile.data.user);
      setDriver(profile.data.driver || null);
    } catch {
      setUser({ id: data.user_id, role: data.role });
      setDriver(null);
    }
    socket.connect(data.user_id);
    return data;
  }

  async function logout() {
    await AsyncStorage.multiRemove(['auth_token', 'user_id']);
    socket.disconnect();
    setUser(null);
    setDriver(null);
  }

  return (
    <AuthContext.Provider value={{ user, driver, loading, login, register, logout, setUser, setDriver }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
