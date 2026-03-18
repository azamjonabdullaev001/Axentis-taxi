import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ThemeContext = createContext(null);

export const COLORS = {
  light: {
    primary: '#FFCC00', background: '#FFFFFF', card: '#F5F5F5',
    text: '#1A1A1A', textSecondary: '#666', border: '#E0E0E0',
    error: '#E53935', success: '#43A047',
  },
  dark: {
    primary: '#FFCC00', background: '#1A1A1A', card: '#2A2A2A',
    text: '#FFFFFF', textSecondary: '#AAAAAA', border: '#3A3A3A',
    error: '#EF5350', success: '#66BB6A',
  },
};

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true); // Drivers prefer dark by default

  useEffect(() => {
    AsyncStorage.getItem('dark_mode').then((v) => {
      if (v !== null) setIsDark(v === 'true');
    });
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    AsyncStorage.setItem('dark_mode', String(next));
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, colors: isDark ? COLORS.dark : COLORS.light }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() { return useContext(ThemeContext); }
