import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Phone, Lock, User, Mail, ArrowRight, ShieldCheck } from 'lucide-react-native';
import { authApi, employeeApi } from '../src/lib/api';
import { useAuth } from '../src/lib/authContext';
import { useToast } from '../src/components/Toast';
import { colors } from '../src/theme';

type Screen = 'login' | 'register' | 'forgot-phone' | 'otp' | 'reset-mpin';

const MUTED = colors.muted;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { checkAuth } = useAuth();
  const toast = useToast();

  const [screen, setScreen] = useState<Screen>('login');
  const [loading, setLoading] = useState(false);

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mpin, setMpin] = useState('');
  const [confirmMpin, setConfirmMpin] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [role, setRole] = useState<'user' | 'employee' | 'captain'>('user');
  const [companyName, setCompanyName] = useState('');
  const [isResetFlow, setIsResetFlow] = useState(false);
  const [forgotPhone, setForgotPhone] = useState('');

  const formatPhone = (p: string) => (p.startsWith('+') ? p : `+91${p}`);
  const validatePhone = (p: string) => /^(?:\+91)?[6-9]\d{9}$/.test(p);
  const validateMpin = (m: string) => /^\d{4,6}$/.test(m);

  const resetFields = () => {
    setMpin(''); setConfirmMpin(''); setOtpCode(''); setName(''); setEmail(''); setCompanyName('');
  };

  const onLogin = async () => {
    if (!validatePhone(phone)) return toast.error('Enter a valid phone number (e.g. 9970119846)');
    if (!validateMpin(mpin)) return toast.error('MPIN should be 4-6 digits');
    try {
      setLoading(true);
      const formatted = formatPhone(phone);
      const { user } = await authApi.login(formatted, mpin);
      if (user.role === 'employee') {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          toast.error('Location permission is mandatory for field workforce.');
          setLoading(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        await employeeApi.submitLocation(pos.coords.latitude, pos.coords.longitude);
      }
      toast.success('Welcome back!');
      await checkAuth();
      router.replace('/(dashboard)/crm');
    } catch (e: any) {
      toast.error(e?.message || 'Invalid phone or MPIN');
      setLoading(false);
    }
  };

  const onRegister = async () => {
    if (!name.trim()) return toast.error('Name is required');
    if (!validatePhone(phone)) return toast.error('Enter a valid phone number');
    if (!validateMpin(mpin)) return toast.error('MPIN should be 4-6 digits');
    if (mpin !== confirmMpin) return toast.error('MPINs do not match');
    if (role === 'captain' && !companyName.trim()) return toast.error('Company name is required for captain');
    try {
      setLoading(true);
      const formatted = formatPhone(phone);
      setPhone(formatted);
      const res = await authApi.register({
        name, phone: formatted, mpin, email, role,
        ...(role === 'captain' && { companyName: companyName.trim() }),
      });
      if ((res as any).bypassed) {
        toast.success('Registered successfully!');
        await checkAuth();
        router.replace('/(dashboard)/crm');
        return;
      }
      toast.success('OTP sent successfully');
      setIsResetFlow(false);
      setScreen('otp');
    } catch (e: any) {
      toast.error(e?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const onForgot = async () => {
    if (!validatePhone(forgotPhone)) return toast.error('Enter a valid registered phone number');
    try {
      setLoading(true);
      const formatted = formatPhone(forgotPhone);
      setForgotPhone(formatted);
      await authApi.forgotMpin(formatted);
      setIsResetFlow(true);
      setScreen('otp');
      toast.success('OTP sent for verification');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const onOtp = async () => {
    if (otpCode.length < 6) return toast.error('Enter a valid 6-digit OTP');
    try {
      setLoading(true);
      if (isResetFlow) {
        setScreen('reset-mpin');
      } else {
        await authApi.verifyOtp(phone, otpCode);
        toast.success('Verification successful!');
        await checkAuth();
        router.replace('/(dashboard)/crm');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  const onReset = async () => {
    if (!validateMpin(mpin)) return toast.error('New MPIN should be 4-6 digits');
    if (mpin !== confirmMpin) return toast.error('MPINs do not match');
    try {
      setLoading(true);
      await authApi.resetMpin(forgotPhone, otpCode, mpin);
      toast.success('MPIN reset successful! Please login.');
      resetFields();
      setForgotPhone('');
      setIsResetFlow(false);
      setScreen('login');
    } catch (e: any) {
      toast.error(e?.message || 'Reset failed');
      if (e?.message?.toLowerCase?.().includes('otp')) setScreen('otp');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.cream }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: insets.top + 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo header */}
        <View style={s.logoHeader}>
          <View style={s.logoRow}>
            <View style={s.logoBox}>
              <Text style={s.logoLetter}>H</Text>
            </View>
            <View>
              <Text style={s.logoTitle}>HomeInTown</Text>
              <Text style={s.logoSub}>SALES INTELLIGENCE</Text>
            </View>
          </View>
        </View>

        {/* Card */}
        <View style={s.card}>

          {/* LOGIN */}
          {screen === 'login' && (
            <View style={{ gap: 20 }}>
              <View style={s.centerGap}>
                <Text style={s.h1}>Welcome</Text>
                <Text style={s.subtext}>Enter your credentials to continue</Text>
              </View>

              <Field icon={<Phone size={20} color={MUTED} />}>
                <TextInput placeholder="Mobile Number" placeholderTextColor={MUTED} keyboardType="phone-pad" value={phone} onChangeText={setPhone} style={[s.input, { fontSize: 18, fontFamily: 'monospace' }]} />
              </Field>

              <Field icon={<Lock size={20} color={MUTED} />}>
                <TextInput placeholder="Enter MPIN" placeholderTextColor={MUTED} secureTextEntry maxLength={6} keyboardType="number-pad" value={mpin} onChangeText={setMpin} style={[s.input, { fontSize: 20 }]} />
              </Field>

              <PrimaryButton loading={loading} onPress={onLogin} label="Login" icon={<ArrowRight size={20} color="#fff" />} />

              <View style={s.rowBetween}>
                <Pressable onPress={() => { resetFields(); setForgotPhone(''); setScreen('forgot-phone'); }}>
                  <Text style={s.linkBrand}>Forgot MPIN?</Text>
                </Pressable>
                <Pressable onPress={() => { resetFields(); setScreen('register'); }}>
                  <Text style={s.linkBrand}>New User? Register</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* REGISTER */}
          {screen === 'register' && (
            <View style={{ gap: 16 }}>
              <View style={[s.centerGap, { marginBottom: 4 }]}>
                <Text style={s.h2}>Create Account</Text>
                <Text style={s.subtext}>Join HomeInTown Intelligence</Text>
              </View>

              <Field icon={<User size={20} color={MUTED} />}>
                <TextInput placeholder="Full Name" placeholderTextColor={MUTED} value={name} onChangeText={setName} style={s.input} />
              </Field>
              <Field icon={<Phone size={20} color={MUTED} />}>
                <TextInput placeholder="Mobile Number" placeholderTextColor={MUTED} keyboardType="phone-pad" value={phone} onChangeText={setPhone} style={[s.input, { fontFamily: 'monospace' }]} />
              </Field>
              <Field icon={<Mail size={20} color={MUTED} />}>
                <TextInput placeholder="Email (Optional)" placeholderTextColor={MUTED} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} style={s.input} />
              </Field>

              {/* Role */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([['user', 'Investor'], ['employee', 'Field'], ['captain', 'Builder']] as const).map(([r, label]) => {
                  const active = role === r;
                  return (
                    <Pressable key={r} onPress={() => setRole(r)} style={[s.roleBtn, active ? s.roleBtnActive : s.roleBtnInactive]}>
                      <Text style={[s.roleBtnText, { color: active ? colors.brand : colors.muted }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {role === 'captain' && (
                <View style={s.companyField}>
                  <TextInput placeholder="Company Name *" placeholderTextColor={MUTED} value={companyName} onChangeText={setCompanyName} style={[s.input, { paddingVertical: 14 }]} />
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field icon={<Lock size={16} color={MUTED} />} compact>
                    <TextInput placeholder="Set MPIN" placeholderTextColor={MUTED} secureTextEntry maxLength={6} keyboardType="number-pad" value={mpin} onChangeText={setMpin} style={[s.input, { fontSize: 14 }]} />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field icon={<Lock size={16} color={MUTED} />} compact>
                    <TextInput placeholder="Confirm" placeholderTextColor={MUTED} secureTextEntry maxLength={6} keyboardType="number-pad" value={confirmMpin} onChangeText={setConfirmMpin} style={[s.input, { fontSize: 14 }]} />
                  </Field>
                </View>
              </View>

              <PrimaryButton loading={loading} onPress={onRegister} label="Register" />
              <Pressable onPress={() => { resetFields(); setScreen('login'); }} style={{ alignItems: 'center' }}>
                <Text style={s.mutedSm}>Already have an account? <Text style={s.linkBrandInline}>Login</Text></Text>
              </Pressable>
            </View>
          )}

          {/* FORGOT PHONE */}
          {screen === 'forgot-phone' && (
            <View style={{ gap: 24 }}>
              <View style={s.centerGap}>
                <View style={s.iconCircle}><Lock size={40} color={colors.brand} /></View>
                <Text style={s.h2}>Forgot MPIN</Text>
                <Text style={s.subtext}>Enter your registered phone number</Text>
              </View>
              <Field icon={<Phone size={20} color={MUTED} />}>
                <TextInput placeholder="Mobile Number" placeholderTextColor={MUTED} keyboardType="phone-pad" value={forgotPhone} onChangeText={setForgotPhone} style={[s.input, { fontSize: 18, fontFamily: 'monospace' }]} />
              </Field>
              <PrimaryButton loading={loading} onPress={onForgot} label="Send OTP" icon={<ArrowRight size={20} color="#fff" />} />
              <Pressable onPress={() => setScreen('login')} style={{ alignItems: 'center' }}>
                <Text style={s.mutedSm}>Back to <Text style={s.linkBrandInline}>Login</Text></Text>
              </Pressable>
            </View>
          )}

          {/* OTP */}
          {screen === 'otp' && (
            <View style={{ gap: 32 }}>
              <View style={s.centerGap}>
                <View style={s.iconCircle}>{isResetFlow ? <Lock size={40} color={colors.brand} /> : <ShieldCheck size={40} color={colors.brand} />}</View>
                <Text style={s.h1}>{isResetFlow ? 'Reset MPIN' : 'Verify Phone'}</Text>
                <Text style={s.subtext}>{isResetFlow ? 'Enter OTP sent to' : 'Sent to'} <Text style={s.boldMono}>{isResetFlow ? forgotPhone : phone}</Text></Text>
              </View>
              <View>
                <Text style={[s.mutedSm, { marginBottom: 8, paddingLeft: 4 }]}>6-Digit OTP Code</Text>
                <TextInput
                  placeholder="000000"
                  placeholderTextColor={MUTED}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={otpCode}
                  onChangeText={(t) => setOtpCode(t.replace(/\D/g, ''))}
                  style={[s.otpInput, { letterSpacing: otpCode ? 12 : 0 }]}
                />
              </View>
              <PrimaryButton loading={loading} onPress={onOtp} label={isResetFlow ? 'Next' : 'Verify & Sign Up'} />
              <View style={[s.rowBetween, { paddingHorizontal: 8 }]}>
                <Pressable onPress={() => setScreen(isResetFlow ? 'forgot-phone' : 'register')}>
                  <Text style={s.mutedSm}>Resend Code</Text>
                </Pressable>
                <Pressable onPress={() => { setIsResetFlow(false); resetFields(); setScreen('login'); }}>
                  <Text style={s.linkBrand}>Back to Login</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* RESET MPIN */}
          {screen === 'reset-mpin' && (
            <View style={{ gap: 32 }}>
              <View style={s.centerGap}>
                <View style={s.iconCircle}><Lock size={40} color={colors.brand} /></View>
                <Text style={s.h1}>New MPIN</Text>
                <Text style={[s.subtext, { textAlign: 'center' }]}>Create a new MPIN for <Text style={s.boldMono}>{forgotPhone}</Text></Text>
              </View>
              <View style={{ gap: 16 }}>
                <Field icon={<Lock size={20} color={MUTED} />}>
                  <TextInput placeholder="Enter New MPIN" placeholderTextColor={MUTED} secureTextEntry maxLength={6} keyboardType="number-pad" value={mpin} onChangeText={setMpin} style={[s.input, { fontSize: 20 }]} />
                </Field>
                <Field icon={<Lock size={20} color={MUTED} />}>
                  <TextInput placeholder="Confirm New MPIN" placeholderTextColor={MUTED} secureTextEntry maxLength={6} keyboardType="number-pad" value={confirmMpin} onChangeText={setConfirmMpin} style={[s.input, { fontSize: 20 }]} />
                </Field>
              </View>
              <PrimaryButton loading={loading} onPress={onReset} label="Save New MPIN" />
              <Pressable onPress={() => setScreen('otp')} style={{ alignItems: 'center' }}>
                <Text style={s.mutedSm}>Back to OTP</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Reusable input field with left icon ──
function Field({ icon, children, compact }: { icon: React.ReactNode; children: React.ReactNode; compact?: boolean }) {
  return (
    <View style={[s.field, compact && { paddingVertical: 2 }]}>
      <View style={{ marginRight: 12 }}>{icon}</View>
      {children}
    </View>
  );
}

// ── Primary amber button ──
function PrimaryButton({ loading, onPress, label, icon }: { loading?: boolean; onPress: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} disabled={loading} style={[s.primaryBtn, { opacity: loading ? 0.6 : 1 }]}>
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          <Text style={s.primaryBtnText}>{label}</Text>
          {icon}
        </>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  logoHeader: { alignItems: 'center', marginBottom: 24 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoBox: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  logoLetter: { color: '#fff', fontWeight: 'bold', fontSize: 20 },
  logoTitle: { fontSize: 20, fontWeight: 'bold', color: colors.ink },
  logoSub: { fontSize: 10, fontWeight: 'bold', color: colors.brand, letterSpacing: 2 },
  card: {
    width: '100%', maxWidth: 448, alignSelf: 'center', padding: 24, borderRadius: 24,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line,
    shadowColor: colors.brand, shadowOpacity: 0.05, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 3,
  },
  centerGap: { alignItems: 'center', gap: 8 },
  h1: { fontSize: 34, fontWeight: 'bold', color: colors.ink },
  h2: { fontSize: 28, fontWeight: 'bold', color: colors.ink },
  subtext: { color: colors.muted2 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 16 },
  input: { flex: 1, color: colors.ink, paddingVertical: 14 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  linkBrand: { color: colors.brand, fontSize: 14, fontWeight: 'bold' },
  linkBrandInline: { color: colors.brand, fontWeight: 'bold' },
  mutedSm: { color: colors.muted, fontSize: 14 },
  boldMono: { color: colors.ink, fontWeight: 'bold', fontFamily: 'monospace' },
  roleBtn: { flex: 1, paddingVertical: 12, borderRadius: 16, borderWidth: 2, alignItems: 'center' },
  roleBtnActive: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  roleBtnInactive: { borderColor: colors.line },
  roleBtnText: { fontWeight: 'bold', fontSize: 12 },
  companyField: { borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  iconCircle: { width: 80, height: 80, backgroundColor: colors.brandTint, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand + '33' },
  otpInput: { width: '100%', backgroundColor: colors.cream, borderWidth: 2, borderColor: colors.line, borderRadius: 16, paddingVertical: 20, textAlign: 'center', fontSize: 34, fontWeight: 'bold', color: colors.brand },
  primaryBtn: {
    width: '100%', backgroundColor: colors.brand, borderRadius: 16, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: colors.brand, shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  primaryBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
