import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ThemeContext = createContext(null);

export const COLORS = {
  light: {
    primary: '#FFCC00', background: '#F2F2F7', card: '#FFFFFF',
    text: '#1C1C1E', textSecondary: '#6C6C70', border: '#E5E5EA',
    error: '#FF3B30', success: '#34C759',
    shadow: 'rgba(0,0,0,0.08)', surface: '#FFFFFF', divider: '#E5E5EA',
  },
  dark: {
    primary: '#FFCC00', background: '#000000', card: '#1C1C1E',
    text: '#FFFFFF', textSecondary: '#8E8E93', border: '#38383A',
    error: '#FF453A', success: '#30D158',
    shadow: 'rgba(0,0,0,0.5)', surface: '#2C2C2E', divider: '#38383A',
  },
};

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true); // Drivers prefer dark by default
  const [lang, setLangState] = useState('ru');

  useEffect(() => {
    AsyncStorage.getItem('dark_mode').then((v) => {
      if (v !== null) setIsDark(v === 'true');
    });
    AsyncStorage.getItem('language').then((l) => {
      if (l) setLangState(l);
    });
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    AsyncStorage.setItem('dark_mode', String(next));
  }

  function setLang(code) {
    setLangState(code);
    AsyncStorage.setItem('language', code);
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, colors: isDark ? COLORS.dark : COLORS.light, lang, setLang }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() { return useContext(ThemeContext); }
