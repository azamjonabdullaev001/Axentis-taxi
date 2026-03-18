import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';

export default function LoginScreen({ navigation }) {
  const { colors } = useTheme();
  const { login } = useAuth();
  const [lang] = useState('ru');

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!phone.trim()) { Alert.alert(t(lang,'error'), 'Введите телефон'); return; }
    if (password.length < 8) { Alert.alert(t(lang,'error'), t(lang,'passwordMin')); return; }

    const fullPhone = phone.startsWith('+998') ? phone : `+998${phone}`;
    setLoading(true);
    try {
      await login(fullPhone, password);
    } catch (e) {
      Alert.alert(t(lang,'error'), e.response?.data?.error || 'Неверный телефон или пароль');
    } finally {
      setLoading(false);
    }
  }

  const s = makeStyles(colors);

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.inner}>
        <View style={s.header}>
          <Text style={s.logo}>🚕</Text>
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
        <TextInput
          style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Минимум 8 символов"
          placeholderTextColor={colors.textSecondary}
        />

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
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: { flex: 1, padding: 24, justifyContent: 'center' },
    header: { alignItems: 'center', marginBottom: 40 },
    logo: { fontSize: 64 },
    title: { fontSize: 28, fontWeight: '800', color: colors.primary, marginTop: 8 },
    subtitle: { fontSize: 16, color: colors.textSecondary, marginTop: 4 },
    label: { color: colors.textSecondary, fontSize: 13, marginBottom: 6 },
    phoneRow: { flexDirection: 'row', marginBottom: 16 },
    prefix: {
      backgroundColor: colors.primary, borderRadius: 12,
      paddingHorizontal: 14, justifyContent: 'center', marginRight: 8,
    },
    prefixText: { fontWeight: '700', fontSize: 15, color: '#000' },
    phoneInput: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, backgroundColor: colors.card },
    input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 16 },
    btn: {
      backgroundColor: colors.primary, borderRadius: 14, padding: 16,
      alignItems: 'center', marginTop: 4,
    },
    btnDisabled: { opacity: 0.7 },
    btnText: { fontWeight: '800', fontSize: 16, color: '#000' },
    linkRow: { alignItems: 'center', marginTop: 24 },
    link: { color: colors.textSecondary, fontSize: 14 },
    linkBold: { color: colors.primary, fontWeight: '700' },
  });
}
