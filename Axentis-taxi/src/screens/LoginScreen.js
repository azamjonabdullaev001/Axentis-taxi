import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';
import { getAPIErrorMessage } from '../services/api';

export default function LoginScreen({ navigation }) {
  const { colors } = useTheme();
  const { login } = useAuth();
  const [lang] = useState('ru');

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  async function handleLogin() {
    if (!phone.trim()) { Alert.alert(t(lang,'error'), 'Введите телефон'); return; }
    if (password.length < 8) { Alert.alert(t(lang,'error'), t(lang,'passwordMin')); return; }

    const fullPhone = phone.startsWith('+998') ? phone : `+998${phone}`;
    setLoading(true);
    try {
      await login(fullPhone, password);
    } catch (e) {
      Alert.alert(t(lang,'error'), getAPIErrorMessage(e, 'Неверный телефон или пароль'));
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
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 24 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <View style={[s.inner, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={s.header}>
          <View style={s.logoCircle}>
            <Ionicons name="car-sport" size={38} color="#000" />
          </View>
          <Text style={s.title}>Axentis Taxi</Text>
          <Text style={s.subtitle}>{t(lang,'login')}</Text>
        </View>

        <Text style={s.label}>{t(lang,'phone')}</Text>
        <View style={s.phoneRow}>
          <View style={s.prefix}><Text style={s.prefixText}>+998</Text></View>
          <TextInput
            style={[s.phoneInput, { color: colors.text, borderColor: colors.border }]}
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/[^0-9]/g,''))}
            keyboardType="phone-pad"
            maxLength={9}
            placeholder="90 123 45 67"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <Text style={s.label}>{t(lang,'password')}</Text>
        <View style={[s.passwordWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <TextInput
            style={[s.passwordInput, { color: colors.text }]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!passwordVisible}
            placeholder="Минимум 8 символов"
            placeholderTextColor={colors.textSecondary}
          />
          <TouchableOpacity style={s.eyeBtn} onPress={() => setPasswordVisible((value) => !value)}>
            <Ionicons
              name={passwordVisible ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]}
          onPress={handleLogin} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={s.btnText}>{t(lang,'login')}</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={s.linkRow} onPress={() => navigation.navigate('Register')}>
          <Text style={s.link}>{t(lang,'noAccount')} <Text style={s.linkBold}>{t(lang,'register')}</Text></Text>
        </TouchableOpacity>
      </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flexGrow: 1 },
    inner: { flexGrow: 1, padding: 24, paddingBottom: 48 },
    header: { alignItems: 'center', marginBottom: 40 },
    logoCircle: {
      width: 88, height: 88, borderRadius: 44,
      backgroundColor: colors.primary,
      justifyContent: 'center', alignItems: 'center',
      marginBottom: 20,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.45,
      shadowRadius: 18,
      elevation: 14,
    },
    title: { fontSize: 28, fontWeight: '800', color: colors.text, marginBottom: 4 },
    subtitle: { fontSize: 15, color: colors.textSecondary },
    label: { color: colors.textSecondary, fontSize: 13, marginBottom: 6, fontWeight: '500' },
    phoneRow: { flexDirection: 'row', marginBottom: 16 },
    prefix: {
      backgroundColor: colors.primary, borderRadius: 12,
      paddingHorizontal: 14, justifyContent: 'center', marginRight: 8,
    },
    prefixText: { fontWeight: '700', fontSize: 15, color: '#000' },
    phoneInput: { flex: 1, borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 15, backgroundColor: colors.card },
    passwordWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, marginBottom: 16 },
    passwordInput: { flex: 1, padding: 14, fontSize: 15 },
    eyeBtn: { paddingHorizontal: 14, paddingVertical: 12 },
    btn: {
      backgroundColor: colors.primary, borderRadius: 14, padding: 16,
      alignItems: 'center', marginTop: 4,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 8,
    },
    btnDisabled: { opacity: 0.7 },
    btnText: { fontWeight: '800', fontSize: 16, color: '#000' },
    linkRow: { alignItems: 'center', marginTop: 24 },
    link: { color: colors.textSecondary, fontSize: 14 },
    linkBold: { color: colors.primary, fontWeight: '700' },
  });
}
