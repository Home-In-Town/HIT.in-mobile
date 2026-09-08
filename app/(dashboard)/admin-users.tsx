import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Shield, CheckCircle, ChevronDown } from 'lucide-react-native';
import { adminApi } from '../../src/lib/api';
import { useToast } from '../../src/components/Toast';
import MenuButton from '../../src/components/MenuButton';
import { colors } from '../../src/theme';

const ROLES = ['admin', 'builder', 'captain', 'agent', 'employee', 'user', 'unassigned'];
const ROLE_C: Record<string, string> = {
  admin: colors.redText, builder: colors.brand, captain: colors.purpleText,
  agent: colors.blueText, employee: colors.greenText, user: colors.slateText, unassigned: colors.muted,
};

export default function AdminUsersScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [roleFilter, setRoleFilter] = useState('all');
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.getUsers(roleFilter !== 'all' ? roleFilter : undefined);
      setUsers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [roleFilter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const changeRole = async (userId: string, newRole: string) => {
    setActing(userId);
    try {
      await adminApi.setRole(userId, newRole);
      setUsers(prev => prev.map(u => (u._id === userId || u.id === userId) ? { ...u, role: newRole } : u));
      toast.show('Role updated', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setActing(null);
      setExpanded(null);
    }
  };

  const toggleVerify = async (userId: string, current: boolean) => {
    setActing(userId);
    try {
      await adminApi.setVerified(userId, !current);
      setUsers(prev => prev.map(u => (u._id === userId || u.id === userId) ? { ...u, isVerified: !current } : u));
      toast.show(!current ? 'Verified ✓' : 'Unverified', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setActing(null);
    }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MenuButton />
          <View>
            <Text style={s.title}>User Management</Text>
            <Text style={s.sub}>{users.length} users</Text>
          </View>
        </View>
      </View>

      {/* Role filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {['all', ...ROLES].map(r => (
          <Pressable key={r} onPress={() => setRoleFilter(r)} style={[s.pill, roleFilter === r && s.pillActive]}>
            <Text style={[s.pillText, roleFilter === r && s.pillTextActive]}>{r}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
        >
          {users.length === 0 ? (
            <View style={s.empty}><Shield size={32} color={colors.muted} /><Text style={s.emptyText}>No users found</Text></View>
          ) : users.map(u => {
            const uid = u._id || u.id || '';
            const isExpanded = expanded === uid;
            return (
              <View key={uid} style={s.card}>
                <View style={s.cardTop}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{(u.name || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.userName}>{u.name}</Text>
                    <Text style={s.userPhone}>{u.phone}</Text>
                  </View>
                  <View style={[s.roleBadge, { backgroundColor: `${ROLE_C[u.role] || colors.muted}15` }]}>
                    <Text style={[s.roleText, { color: ROLE_C[u.role] || colors.muted }]}>{u.role}</Text>
                  </View>
                </View>

                {/* Action row */}
                <View style={s.actionRow}>
                  {/* Verify toggle */}
                  <Pressable
                    onPress={() => toggleVerify(uid, !!u.isVerified)}
                    disabled={acting === uid}
                    style={[s.actionBtn, u.isVerified ? s.btnGreen : s.btnSlate]}
                  >
                    <CheckCircle size={13} color={u.isVerified ? colors.greenText : colors.slateText} />
                    <Text style={[s.actionBtnText, { color: u.isVerified ? colors.greenText : colors.slateText }]}>
                      {u.isVerified ? 'Verified' : 'Verify'}
                    </Text>
                  </Pressable>

                  {/* Change role */}
                  <Pressable
                    onPress={() => setExpanded(isExpanded ? null : uid)}
                    style={[s.actionBtn, s.btnBrand]}
                  >
                    <Shield size={13} color={colors.brand} />
                    <Text style={[s.actionBtnText, { color: colors.brand }]}>Role</Text>
                    <ChevronDown size={12} color={colors.brand} />
                  </Pressable>
                </View>

                {/* Role picker dropdown */}
                {isExpanded && (
                  <View style={s.roleDropdown}>
                    {ROLES.map(r => (
                      <Pressable
                        key={r}
                        onPress={() => changeRole(uid, r)}
                        disabled={acting === uid || u.role === r}
                        style={[s.roleOption, u.role === r && s.roleOptionActive]}
                      >
                        <Text style={[s.roleOptionText, { color: ROLE_C[r] || colors.muted }]}>{r}</Text>
                        {u.role === r && <CheckCircle size={14} color={colors.brand} />}
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 21, fontWeight: 'bold', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  filterScroll: { marginTop: 10, marginBottom: 4 },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  pillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  pillText: { fontSize: 11, fontWeight: '600', color: colors.muted2 },
  pillTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 14, color: colors.muted },
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  userName: { fontSize: 13, fontWeight: '700', color: colors.ink },
  userPhone: { fontSize: 11, color: colors.muted2 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 10, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  actionBtnText: { fontSize: 11, fontWeight: '700' },
  btnGreen: { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
  btnSlate: { backgroundColor: colors.slateBg, borderColor: colors.slateBorder },
  btnBrand: { backgroundColor: colors.brandTint, borderColor: `${colors.brand}40` },
  roleDropdown: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, gap: 2 },
  roleOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 4 },
  roleOptionActive: { backgroundColor: colors.brandTint, borderRadius: 8, paddingHorizontal: 8 },
  roleOptionText: { fontSize: 12, fontWeight: '600' },
});
