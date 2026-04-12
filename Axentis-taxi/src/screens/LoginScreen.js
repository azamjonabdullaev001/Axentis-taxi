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
  const { colors, lang } = useTheme();
  const { login } = useAuth();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  async function handleLogin() {
    if (!phone.trim()) { Alert.alert(t(lang,'error'), t(lang,'enterPhone')); return; }
    if (password.length < 8) { Alert.alert(t(lang,'error'), t(lang,'passwordMin')); return; }

    const fullPhone = phone.startsWith('+998') ? phone : `+998${phone}`;
    setLoading(true);
    try {
      await login(fullPhone, password);
    } catch (e) {
      Alert.alert(t(lang,'error'), getAPIErrorMessage(e, t(lang,'wrongCredentials')));
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
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 32 + insets.bottom }]} keyboardShouldPersistTaps="handled">
          <View style={s.inner}>
            <View style={s.header}>
              <View style={s.logoOuter}>
                <View style={s.logoCircle}>
                  <Ionicons name="car-sport" size={40} color="#000" />
                </View>
              </View>
              <Text style={s.title}>Axentis Taxi</Text>
              <Text style={s.subtitle}>{t(lang,'login')}</Text>
            </View>

            <View style={s.card}>
              <Text style={s.label}>{t(lang,'phone')}</Text>
              <View style={s.phoneRow}>
                <View style={s.prefix}><Text style={s.prefixText}>+998</Text></View>
                <TextInput
                  style={s.phoneInput}
                  value={phone}
                  onChangeText={(v) => setPhone(v.replace(/[^0-9]/g,''))}
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
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!passwordVisible}
                  placeholder="Минимум 8 символов"
                  placeholderTextColor="#505068"
                />
                <TouchableOpacity style={s.eyeBtn} onPress={() => setPasswordVisible((v) => !v)}>
                  <Ionicons
                    name={passwordVisible ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color="#6B6B80"
                  />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[s.btn, loading && s.btnDisabled]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={s.btnText}>{t(lang,'login')}</Text>}
              </TouchableOpacity>
            </View>

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
    container: { flex: 1, backgroundColor: '#0B0B11' },
    scroll: { flexGrow: 1 },
    inner: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center' },
    header: { alignItems: 'center', marginBottom: 40 },
    logoOuter: {
      width: 110, height: 110, borderRadius: 55,
      borderWidth: 2, borderColor: 'rgba(255,204,0,0.15)',
      justifyContent: 'center', alignItems: 'center',
      marginBottom: 20,
    },
    logoCircle: {
      width: 92, height: 92, borderRadius: 46,
      backgroundColor: colors.primary,
      justifyContent: 'center', alignItems: 'center',
      shadowColor: '#FFCC00',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.45,
      shadowRadius: 24,
      elevation: 18,
    },
    title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.8, marginBottom: 4 },
    subtitle: { fontSize: 14, color: '#6E6E82', fontWeight: '500', letterSpacing: 0.3 },
    card: {
      backgroundColor: '#12121A',
      borderRadius: 20,
      padding: 22,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.05)',
    },
    label: { color: '#8A8A9E', fontSize: 13, marginBottom: 8, fontWeight: '600', letterSpacing: 0.2 },
    phoneRow: { flexDirection: 'row', marginBottom: 20 },
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
      marginBottom: 24, backgroundColor: '#1A1A26',
    },
    passwordInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#FFFFFF' },
    eyeBtn: { paddingHorizontal: 14, paddingVertical: 12 },
    btn: {
      backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16,
      alignItems: 'center',
      shadowColor: '#FFCC00',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 10,
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { fontWeight: '800', fontSize: 16, color: '#000', letterSpacing: 0.5 },
    linkRow: { alignItems: 'center', marginTop: 28 },
    link: { color: '#6E6E82', fontSize: 14 },
    linkBold: { color: colors.primary, fontWeight: '700' },
  });
}
