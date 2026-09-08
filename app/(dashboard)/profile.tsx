import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable,
  StyleSheet, ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogOut, Save, Edit3, Star, Calendar, Shield } from 'lucide-react-native';
import { useAuth } from '../../src/lib/authContext';
import { usersApi, analyticsApi } from '../../src/lib/api';
import { useToast } from '../../src/components/Toast';
import { colors } from '../../src/theme';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator', builder: 'Builder', agent: 'Agent',
  captain: 'Captain', employee: 'Employee', user: 'Investor', unassigned: 'Unassigned',
};

const ROLE_COLOR: Record<string, string> = {
  admin: '#EF4444', builder: colors.brand, captain: colors.purple,
  agent: colors.blue, employee: colors.green, user: colors.slate, unassigned: colors.muted,
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, setUser, logout } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [companyName, setCompanyName] = useState(user?.companyName ?? '');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stats, setStats] = useState({ totalVisits: 0, uniqueLeads: 0 });

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const fresh = await usersApi.getMe();
        if (!active) return;
        setUser(fresh);
        setName(fresh.name ?? '');
        setEmail(fresh.email ?? '');
        setCompanyName(fresh.companyName ?? '');
      } catch { /* keep context data */ }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (['admin', 'builder'].includes(user?.role ?? '')) {
      analyticsApi.ownerAnalytics()
        .then((d: any) => setStats({ totalVisits: d?.totalVisits ?? 0, uniqueLeads: d?.uniqueLeads ?? 0 }))
        .catch(() => {});
    }
  }, [user?.role]);

  const dirty = name.trim() !== (user?.name ?? '') || email.trim() !== (user?.email ?? '') || companyName.trim() !== (user?.companyName ?? '');

  const handleSave = async () => {
    if (!name.trim()) { toast.show('Name cannot be empty', 'error'); return; }
    setSaving(true);
    try {
      const updated = await usersApi.updateProfile({ name: name.trim(), email: email.trim() || undefined, companyName: companyName.trim() || undefined });
      setUser(updated);
      setEditing(false);
      toast.show('Profile updated ✓', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Failed to update', 'error');
    } finally { setSaving(false); }
  };

  const role = user?.role ?? 'user';
  const roleColor = ROLE_COLOR[role] || colors.muted;
  const initial = (user?.name || '?').charAt(0).toUpperCase();
  const joined = user && (user as any).createdAt ? new Date((user as any).createdAt).getFullYear() : null;
  const hasStats = ['admin', 'builder'].includes(role);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Dark hero banner */}
      <View style={s.hero}>
        {/* bg pattern */}
        <View style={s.heroDot1} /><View style={s.heroDot2} />

        {/* Top row: sign out */}
        <View style={s.heroTop}>
          <Text style={s.heroTopLabel}>My Profile</Text>
          <Pressable onPress={logout} style={s.signOutBtn}>
            <LogOut size={14} color="#fff" />
            <Text style={s.signOutText}>Sign Out</Text>
          </Pressable>
        </View>

        {/* Avatar + identity */}
        <View style={s.heroBody}>
          {/* Avatar */}
          <View style={s.avatarWrap}>
            {user?.businessLogoUrl ? (
              <Image source={{ uri: user.businessLogoUrl }} style={s.avatarImg} />
            ) : (
              <View style={s.avatarFallback}>
                <Text style={s.avatarLetter}>{initial}</Text>
              </View>
            )}
            <View style={[s.roleDot, { backgroundColor: roleColor }]} />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={s.heroName} numberOfLines={1}>{user?.name || 'Unknown'}</Text>
            <View style={[s.roleBadge, { backgroundColor: `${roleColor}25` }]}>
              <Shield size={10} color={roleColor} />
              <Text style={[s.roleBadgeText, { color: roleColor }]}>{ROLE_LABEL[role] || role}</Text>
            </View>
            {user?.phone && <Text style={s.heroPhone}>{user.phone}</Text>}
          </View>

          {/* Edit button */}
          <Pressable onPress={() => setEditing(e => !e)} style={[s.editBtn, editing && s.editBtnActive]}>
            <Edit3 size={14} color={editing ? colors.brand : 'rgba(255,255,255,0.7)'} />
          </Pressable>
        </View>

        {/* Stats row (admin/builder only) */}
        {hasStats && (
          <View style={s.heroStats}>
            <View style={s.heroStat}>
              <Text style={s.heroStatNum}>{stats.totalVisits.toLocaleString()}</Text>
              <Text style={s.heroStatLabel}>Page Views</Text>
            </View>
            <View style={s.heroStatDivider} />
            <View style={s.heroStat}>
              <Text style={s.heroStatNum}>{stats.uniqueLeads.toLocaleString()}</Text>
              <Text style={s.heroStatLabel}>Leads</Text>
            </View>
            {joined && (
              <>
                <View style={s.heroStatDivider} />
                <View style={s.heroStat}>
                  <Text style={s.heroStatNum}>{joined}</Text>
                  <Text style={s.heroStatLabel}>Joined</Text>
                </View>
              </>
            )}
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}>
        {/* Edit form — shown when editing */}
        {editing && (
          <View style={s.formCard}>
            <Text style={s.sectionLabel}>Edit Profile</Text>

            {[
              { label: 'Full Name *', value: name, onChange: setName, placeholder: 'Your name' },
              { label: 'Email', value: email, onChange: setEmail, placeholder: 'you@example.com', keyboardType: 'email-address' as const },
              { label: 'Company Name', value: companyName, onChange: setCompanyName, placeholder: 'Optional' },
            ].map(f => (
              <View key={f.label} style={s.fieldWrap}>
                <Text style={s.fieldLabel}>{f.label}</Text>
                <TextInput
                  value={f.value} onChangeText={f.onChange}
                  placeholder={f.placeholder} placeholderTextColor={colors.muted}
                  autoCapitalize={f.keyboardType === 'email-address' ? 'none' : 'words'}
                  keyboardType={f.keyboardType}
                  style={s.input}
                />
              </View>
            ))}

            {/* Phone read-only */}
            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>Phone (cannot be changed)</Text>
              <View style={[s.input, s.inputDisabled]}>
                <Text style={{ color: colors.muted2 }}>{user?.phone || '—'}</Text>
              </View>
            </View>

            <Pressable onPress={handleSave} disabled={!dirty || saving}
              style={[s.saveBtn, (!dirty || saving) && { opacity: 0.5 }]}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Save size={15} color="#fff" />
                  <Text style={s.saveBtnText}>Save Changes</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* Account details card */}
        <View style={s.detailsCard}>
          <Text style={s.sectionLabel}>Account Details</Text>
          {[
            { label: 'Name',    value: user?.name || '—' },
            { label: 'Phone',   value: user?.phone || '—' },
            { label: 'Email',   value: user?.email || '—' },
            { label: 'Company', value: user?.companyName || '—' },
            { label: 'Role',    value: ROLE_LABEL[role] || role },
          ].map(d => (
            <View key={d.label} style={s.detailRow}>
              <Text style={s.detailLabel}>{d.label}</Text>
              <Text style={s.detailValue} numberOfLines={1}>{d.value}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },

  // Hero
  hero: { backgroundColor: '#1C1917', paddingHorizontal: 20, paddingBottom: 18, overflow: 'hidden', position: 'relative' },
  heroDot1: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: `${colors.brand}18`, top: -50, right: -20 },
  heroDot2: { position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: '#ffffff06', bottom: 0, left: -10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, marginBottom: 14 },
  heroTopLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textTransform: 'uppercase' },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  signOutText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  heroBody: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  avatarWrap: { position: 'relative' },
  avatarFallback: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  avatarImg: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  avatarLetter: { color: '#fff', fontSize: 25, fontWeight: '800' },
  roleDot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, bottom: 0, right: 0, borderWidth: 2, borderColor: '#1C1917' },
  heroName: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 5 },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  roleBadgeText: { fontSize: 10, fontWeight: '700' },
  heroPhone: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  editBtn: { padding: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  editBtnActive: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  heroStats: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  heroStat: { flex: 1, alignItems: 'center', gap: 2 },
  heroStatNum: { fontSize: 17, fontWeight: '800', color: '#fff' },
  heroStatLabel: { fontSize: 8, color: 'rgba(255,255,255,0.4)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  heroStatDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.12)' },

  // Form
  formCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 12 },
  sectionLabel: { fontSize: 10, fontWeight: '800', color: colors.muted2, textTransform: 'uppercase', letterSpacing: 0.8 },
  fieldWrap: { gap: 5 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.ink },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, color: colors.ink, backgroundColor: colors.cream },
  inputDisabled: { backgroundColor: colors.slateBg, justifyContent: 'center' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.brand, paddingVertical: 14, borderRadius: 12 },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  // Details
  detailsCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 0 },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line },
  detailLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  detailValue: { fontSize: 12, fontWeight: '700', color: colors.ink, maxWidth: '60%' },
});
