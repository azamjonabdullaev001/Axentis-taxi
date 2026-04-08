import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';
import { getAPIErrorMessage } from '../services/api';

export default function RegisterScreen({ navigation }) {
  const { colors } = useTheme();
  const { register } = useAuth();
  const [lang] = useState('ru');

  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '',
    password: '', confirm_password: '',
  });
  const [loading, setLoading] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const insets = useSafeAreaInsets();

  function setField(key, val) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  async function handleRegister() {
    if (!form.first_name.trim()) { Alert.alert(t(lang,'error'), 'Введите имя'); return; }
    if (!form.last_name.trim()) { Alert.alert(t(lang,'error'), 'Введите фамилию'); return; }
    if (!form.phone.trim()) { Alert.alert(t(lang,'error'), 'Введите телефон'); return; }
    if (form.password.length < 8) { Alert.alert(t(lang,'error'), t(lang,'passwordMin')); return; }
    if (form.password !== form.confirm_password) {
      Alert.alert(t(lang,'error'), t(lang,'passwordMismatch'));
      return;
    }

    const phone = form.phone.startsWith('+998') ? form.phone : `+998${form.phone}`;

    setLoading(true);
    try {
      await register({ ...form, phone });
    } catch (e) {
      Alert.alert(t(lang,'error'), getAPIErrorMessage(e, 'Ошибка регистрации'));
    } finally {
      setLoading(false);
    }
  }

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.container}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 40 + insets.bottom }]} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <View style={s.logoOuter}>
              <View style={s.logoCircle}>
                <Ionicons name="car-sport" size={36} color="#000" />
              </View>
            </View>
            <Text style={s.title}>Axentis Taxi</Text>
            <Text style={s.subtitle}>{t(lang,'register')}</Text>
          </View>

          <View style={s.card}>
            <Text style={s.label}>{t(lang,'firstName')}</Text>
            <TextInput
              style={s.input}
              value={form.first_name}
              onChangeText={(v) => setField('first_name', v)}
              placeholderTextColor="#505068"
            />

            <Text style={s.label}>{t(lang,'lastName')}</Text>
            <TextInput
              style={s.input}
              value={form.last_name}
              onChangeText={(v) => setField('last_name', v)}
              placeholderTextColor="#505068"
            />

            <Text style={s.label}>{t(lang,'phone')}</Text>
            <View style={s.phoneRow}>
              <View style={s.prefix}>
                <Text style={s.prefixText}>+998</Text>
              </View>
              <TextInput
                style={s.phoneInput}
                value={form.phone.replace('+998','')}
                onChangeText={(v) => setField('phone', v.replace(/[^0-9]/g,''))}
                keyboardType="phone-pad"
                maxLength={9}
                placeholder="90 123 45 67"
                placeholderTextColor="#505068"
              />
            </View>

            <Text style={s.label}>{t(lang,'password')}</Text>
            <View style={s.passwordWrap}>
              <TextInput
                style={s.passwordInput}
                value={form.password}
                onChangeText={(v) => setField('password', v)}
                secureTextEntry={!passwordVisible}
                placeholder="Минимум 8 символов"
                placeholderTextColor="#505068"
              />
              <TouchableOpacity style={s.eyeBtn} onPress={() => setPasswordVisible((v) => !v)}>
                <Ionicons name={passwordVisible ? 'eye-outline' : 'eye-off-outline'} size={20} color="#6B6B80" />
              </TouchableOpacity>
            </View>

            <Text style={s.label}>{t(lang,'confirmPassword')}</Text>
            <View style={s.passwordWrap}>
              <TextInput
                style={s.passwordInput}
                value={form.confirm_password}
                onChangeText={(v) => setField('confirm_password', v)}
                secureTextEntry={!confirmPasswordVisible}
                placeholder="Минимум 8 символов"
                placeholderTextColor="#505068"
              />
              <TouchableOpacity style={s.eyeBtn} onPress={() => setConfirmPasswordVisible((v) => !v)}>
                <Ionicons name={confirmPasswordVisible ? 'eye-outline' : 'eye-off-outline'} size={20} color="#6B6B80" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator color="#000" />
                : <Text style={s.btnText}>{t(lang,'register')}</Text>}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.linkRow} onPress={() => navigation.navigate('Login')}>
            <Text style={s.link}>{t(lang,'haveAccount')} <Text style={s.linkBold}>{t(lang,'login')}</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0B0B11' },
    scroll: { flexGrow: 1, paddingHorizontal: 24 },
    header: { alignItems: 'center', marginTop: 32, marginBottom: 28 },
    logoOuter: {
      width: 96, height: 96, borderRadius: 48,
      borderWidth: 2, borderColor: 'rgba(255,204,0,0.15)',
      justifyContent: 'center', alignItems: 'center',
      marginBottom: 16,
    },
    logoCircle: {
      width: 78, height: 78, borderRadius: 39,
      backgroundColor: colors.primary,
      justifyContent: 'center', alignItems: 'center',
      shadowColor: '#FFCC00',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 18,
      elevation: 14,
    },
    title: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.8, marginBottom: 4 },
    subtitle: { fontSize: 14, color: '#6E6E82', fontWeight: '500' },
    card: {
      backgroundColor: '#12121A',
      borderRadius: 20,
      padding: 22,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.05)',
    },
    label: { color: '#8A8A9E', fontSize: 13, marginBottom: 8, fontWeight: '600', letterSpacing: 0.2 },
    input: {
      borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 14,
      paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#FFFFFF',
      backgroundColor: '#1A1A26', marginBottom: 18,
    },
    phoneRow: { flexDirection: 'row', marginBottom: 18 },
    prefix: {
      backgroundColor: colors.primary, borderRadius: 14,
      paddingHorizontal: 16, justifyContent: 'center', marginRight: 10,
      shadowColor: '#FFCC00',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 4,
    },
    prefixText: { fontWeight: '800', fontSize: 15, color: '#000' },
    phoneInput: {
      flex: 1, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 14,
      paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, backgroundColor: '#1A1A26', color: '#FFFFFF',
    },
    passwordWrap: {
      flexDirection: 'row', alignItems: 'center',
      borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 14,
      marginBottom: 18, backgroundColor: '#1A1A26',
    },
    passwordInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#FFFFFF' },
    eyeBtn: { paddingHorizontal: 14, paddingVertical: 12 },
    btn: {
      backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16,
      alignItems: 'center', marginTop: 4,
      shadowColor: '#FFCC00',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 10,
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { fontWeight: '800', fontSize: 16, color: '#000', letterSpacing: 0.5 },
    linkRow: { alignItems: 'center', marginTop: 24 },
    link: { color: '#6E6E82', fontSize: 14 },
    linkBold: { color: colors.primary, fontWeight: '700' },
  });
}
