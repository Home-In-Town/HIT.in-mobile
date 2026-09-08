// Settings screen — account, profile, notifications and app info.
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ChevronLeft, User, Bell, Shield, HelpCircle, FileText, Info,
  ChevronRight, LogOut,
} from 'lucide-react-native';
import { useAuth } from '../../src/lib/authContext';
import { colors } from '../../src/theme';

function Row({ icon, label, sub, onPress, danger }: {
  icon: React.ReactNode; label: string; sub?: string; onPress?: () => void; danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={s.row}>
      <View style={[s.rowIcon, danger && { backgroundColor: colors.redBg }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, danger && { color: colors.red }]}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      {!danger && <ChevronRight size={18} color={colors.muted} />}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={s.backBtn}>
          <ChevronLeft size={24} color={colors.ink} />
        </Pressable>
        <Text style={s.title}>Settings</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: insets.bottom + 24 }}>
        {/* Profile card */}
        <Pressable onPress={() => router.push('/(dashboard)/profile' as any)} style={s.profileCard}>
          <View style={s.avatar}><Text style={s.avatarText}>{(user?.name || '?').charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName} numberOfLines={1}>{user?.name || 'User'}</Text>
            <Text style={s.profileRole}>{(user?.role || '').charAt(0).toUpperCase() + (user?.role || '').slice(1)}</Text>
          </View>
          <ChevronRight size={18} color={colors.muted} />
        </Pressable>

        {/* Account */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>ACCOUNT</Text>
          <View style={s.card}>
            <Row icon={<User size={17} color={colors.brand} />} label="Edit Profile" sub="Name, email, company" onPress={() => router.push('/(dashboard)/profile' as any)} />
            <View style={s.divider} />
            <Row icon={<Bell size={17} color={colors.brand} />} label="Notifications" sub="View your alerts" onPress={() => router.push('/(dashboard)/notifications' as any)} />
          </View>
        </View>

        {/* Support & Legal */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>SUPPORT & LEGAL</Text>
          <View style={s.card}>
            <Row icon={<HelpCircle size={17} color={colors.brand} />} label="Help & Support" sub="homeintown.in" onPress={() => Linking.openURL('https://homeintown.in')} />
            <View style={s.divider} />
            <Row icon={<Shield size={17} color={colors.brand} />} label="Privacy Policy" onPress={() => Linking.openURL('https://homeintown.in/privacy')} />
            <View style={s.divider} />
            <Row icon={<FileText size={17} color={colors.brand} />} label="Terms of Service" onPress={() => Linking.openURL('https://homeintown.in/terms')} />
          </View>
        </View>

        {/* About */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>ABOUT</Text>
          <View style={s.card}>
            <Row icon={<Info size={17} color={colors.brand} />} label="App Version" sub="1.0.0" />
          </View>
        </View>

        {/* Sign out */}
        <Pressable onPress={() => logout()} style={[s.card, s.signOutRow]}>
          <View style={[s.rowIcon, { backgroundColor: colors.redBg }]}><LogOut size={17} color={colors.red} /></View>
          <Text style={s.signOutText}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  backBtn: { padding: 2 },
  title: { fontSize: 16, fontWeight: '800', color: colors.ink },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  profileName: { fontSize: 15, fontWeight: '800', color: colors.ink },
  profileRole: { fontSize: 11.5, color: colors.brand, fontWeight: '700', marginTop: 1 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 9.5, fontWeight: '800', color: colors.muted, letterSpacing: 1, paddingLeft: 4 },
  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  rowSub: { fontSize: 10.5, color: colors.muted2, marginTop: 1 },
  divider: { height: 1, backgroundColor: colors.line, marginLeft: 60 },
  signOutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  signOutText: { fontSize: 13.5, fontWeight: '800', color: colors.red },
});
