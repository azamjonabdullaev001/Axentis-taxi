import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ThemeContext = createContext(null);

export const COLORS = {
  light: {
    primary: '#FFCC00',
    primaryDark: '#E6B800',
    background: '#FFFFFF',
    card: '#F5F5F5',
    text: '#1A1A1A',
    textSecondary: '#666666',
    border: '#E0E0E0',
    white: '#FFFFFF',
    error: '#E53935',
    success: '#43A047',
    shadow: 'rgba(0,0,0,0.1)',
  },
  dark: {
    primary: '#FFCC00',
    primaryDark: '#E6B800',
    background: '#1A1A1A',
    card: '#2A2A2A',
    text: '#FFFFFF',
    textSecondary: '#AAAAAA',
    border: '#3A3A3A',
    white: '#FFFFFF',
    error: '#EF5350',
    success: '#66BB6A',
    shadow: 'rgba(0,0,0,0.3)',
  },
};

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('dark_mode').then((val) => {
      if (val === 'true') setIsDark(true);
    });
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    AsyncStorage.setItem('dark_mode', String(next));
  }

  const colors = isDark ? COLORS.dark : COLORS.light;

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
