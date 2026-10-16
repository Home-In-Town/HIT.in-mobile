// Role Distribution — the admin-only user list where roles are changed.
//
// This is the screen the sidebar used to call "Users". It kept the list, the
// role badges and the Verify toggle, but three things about it were wrong:
//  - every filter pill refetched the whole list with `?role=`, when the array is
//    already everyone and can be filtered in memory;
//  - a failed load toasted and then rendered "No users found", which lied about
//    why the list was empty;
//  - there was no search, no way to see the role spread, and no guard against an
//    admin demoting themselves or the last remaining admin — either of which
//    permanently closes the admin surface, because the server has no such guard.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator,
  RefreshControl, TextInput, FlatList, Modal, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Shield, CheckCircle, Search, AlertTriangle } from 'lucide-react-native';
import { adminApi, AdminUser, AdminUserRole } from '../../src/lib/api';
import {
  ROLE_ORDER, matchesUserSearch, roleDistribution, phoneKey,
  duplicatePhoneKeys, roleChangeBlock, roleChangeConsequence,
} from '../../src/lib/adminUsers';
import { useAuth } from '../../src/lib/authContext';
import { useToast } from '../../src/components/Toast';
import MenuButton from '../../src/components/MenuButton';
import { colors } from '../../src/theme';

const ROLE_C: Record<string, string> = {
  admin: colors.redText, builder: colors.brand, captain: colors.purpleText,
  agent: colors.blueText, employee: colors.greenText, user: colors.slateText, unassigned: colors.muted,
};

export default function AdminUsersScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [acting, setActing] = useState<string | null>(null);
  // The one piece of picker state. `visible` is derived from it, so there is no
  // second modal and nothing to sequence.
  const [pickerUser, setPickerUser] = useState<AdminUser | null>(null);

  // No `?role=` and no filter dependency: one fetch, then every filter is a
  // client-side derive. PREVIOUS BEHAVIOUR: `load` depended on `roleFilter`, so
  // each pill tap hit the API again for a subset of a list already in memory.
  const load = useCallback(async () => {
    try {
      const data = await adminApi.getUsers();
      setUsers(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load users');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const { distribution, dupeKeys } = useMemo(() => ({
    distribution: roleDistribution(users),
    dupeKeys: duplicatePhoneKeys(users),
  }), [users]);

  const filtered = useMemo(
    () => users.filter(u =>
      (roleFilter === 'all' || String(u.role ?? '').trim().toLowerCase() === roleFilter) &&
      matchesUserSearch(u, search)),
    [users, roleFilter, search],
  );

  const applyRole = async (target: AdminUser, role: AdminUserRole) => {
    const uid = target.id || target._id || '';
    setActing(uid);
    try {
      const updated = await adminApi.setRole(uid, role);
      // Patch the server's answer into local state by id, so the row badge AND
      // the distribution chips recompute with no refetch. Falls back to the
      // requested role if the response omits it.
      setUsers(prev => prev.map(u => ((u.id || u._id) === uid ? { ...u, ...updated, role: updated?.role || role } : u)));
      toast.show('Role updated', 'success');
      setPickerUser(null);
    } catch (e: any) {
      // Never a silent catch, and the picker stays open so the admin can retry
      // without finding the row again.
      toast.show(e?.message || 'Could not change role', 'error');
    } finally {
      setActing(null);
    }
  };

  const pickRole = (role: AdminUserRole) => {
    const target = pickerUser;
    if (!target) return;

    // Hard blocks are refusals: the API is not called at all.
    const block = roleChangeBlock({
      target,
      currentUserId: me?.id || '',
      adminCount: distribution.admin || 0,
    });
    if (block) { toast.show(block, 'error'); return; }

    const consequence = roleChangeConsequence(target.role, role);
    if (!consequence) { setPickerUser(null); return; }

    Alert.alert(consequence.title, consequence.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Change role', style: 'destructive', onPress: () => { applyRole(target, role); } },
    ]);
  };

  const toggleVerify = async (userId: string, current: boolean) => {
    setActing(userId);
    try {
      await adminApi.setVerified(userId, !current);
      setUsers(prev => prev.map(u => ((u._id === userId || u.id === userId) ? { ...u, isVerified: !current } : u)));
      toast.show(!current ? 'Verified ✓' : 'Unverified', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setActing(null);
    }
  };

  const chips: { key: string; label: string; count: number }[] = [
    { key: 'all', label: 'all', count: users.length },
    ...ROLE_ORDER.map(r => ({ key: r as string, label: r as string, count: distribution[r] || 0 })),
    // Any role value outside the seven, so a stray one is visible instead of
    // hiding inside a list that no chip reaches.
    ...Object.keys(distribution)
      .filter(k => !(ROLE_ORDER as readonly string[]).includes(k))
      .map(k => ({ key: k, label: k, count: distribution[k] })),
  ];

  const renderRow = ({ item: u }: { item: AdminUser }) => {
    const uid = u.id || u._id || '';
    const isDupe = dupeKeys.has(phoneKey(u.phone));
    const isMe = !!me?.id && uid === me.id;
    return (
      <View style={s.card}>
        <Pressable style={s.cardTop} onPress={() => setPickerUser(u)}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{(u.name || '?').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.userName}>{u.name}{isMe ? ' (you)' : ''}</Text>
            {/* Phone is never optional here: duplicate accounts differ only by
                its format (9970119846 vs +919970119846 are two records). */}
            <Text style={s.userPhone}>{u.phone}</Text>
            {isDupe && (
              <View style={s.dupeRow}>
                <AlertTriangle size={11} color={colors.amberText} />
                <Text style={s.dupeText}>duplicate number</Text>
              </View>
            )}
          </View>
          <View style={[s.roleBadge, { backgroundColor: `${ROLE_C[u.role] || colors.muted}15` }]}>
            <Text style={[s.roleText, { color: ROLE_C[u.role] || colors.muted }]}>{u.role}</Text>
          </View>
        </Pressable>

        <View style={s.actionRow}>
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

          <Pressable onPress={() => setPickerUser(u)} disabled={acting === uid} style={[s.actionBtn, s.btnBrand]}>
            <Shield size={13} color={colors.brand} />
            <Text style={[s.actionBtnText, { color: colors.brand }]}>Change role</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MenuButton />
          <View>
            <Text style={s.title}>Role Distribution</Text>
            <Text style={s.sub}>{users.length} users</Text>
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={s.searchWrap}>
          <Search size={15} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, phone, company or email..."
            placeholderTextColor={colors.muted}
            style={s.searchInput}
          />
        </View>
      </View>

      {/* Distribution chips — counts derived from the loaded array; a tap only
          filters in memory, it never refetches with ?role=. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {chips.map(c => (
          <Pressable key={c.key} onPress={() => setRoleFilter(c.key)} style={[s.pill, roleFilter === c.key && s.pillActive]}>
            <Text style={[s.pillText, roleFilter === c.key && s.pillTextActive]}>{c.label} {c.count}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : error ? (
        // An error must never render as "no users" — that was the old lie.
        <View style={s.center}>
          <Text style={s.emptyText}>{error}</Text>
          <Pressable style={s.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={u => u.id || u._id || ''}
          renderItem={renderRow}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Shield size={32} color={colors.muted} />
              <Text style={s.emptyText}>
                {users.length === 0 ? 'No users found' : 'No user matches this search'}
              </Text>
            </View>
          }
        />
      )}

      {/* EXACTLY ONE Modal on this screen, and its body is driven straight off
          pickerUser. No modal-from-modal and no setTimeout sequencing: that
          combination is what made the projects screen's Assign buttons look
          dead on Android (a modal mounted on top of a dismissing modal does not
          reliably appear). */}
      <Modal
        visible={!!pickerUser}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerUser(null)}
      >
        <Pressable style={s.overlay} onPress={() => setPickerUser(null)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <Text style={s.sheetTitle}>{pickerUser?.name || 'User'}</Text>
            <Text style={s.sheetSub}>Current role: {pickerUser?.role}</Text>
            {ROLE_ORDER.map(r => {
              const current = String(pickerUser?.role ?? '').trim().toLowerCase() === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => pickRole(r)}
                  disabled={current || !!acting}
                  style={[s.roleOption, current && s.roleOptionActive]}
                >
                  <Text style={[s.roleOptionText, { color: ROLE_C[r] || colors.muted }]}>{r}</Text>
                  {current && <CheckCircle size={14} color={colors.brand} />}
                </Pressable>
              );
            })}
            {!!acting && <ActivityIndicator color={colors.brand} style={{ marginTop: 8 }} />}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 21, fontWeight: 'bold', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
  searchInput: { flex: 1, fontSize: 13, color: colors.ink },
  filterScroll: { marginTop: 10, marginBottom: 4, flexGrow: 0 },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  pillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  pillText: { fontSize: 11, fontWeight: '600', color: colors.muted2 },
  pillTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.brand },
  retryText: { fontSize: 12.5, fontWeight: '700', color: colors.brand },
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  userName: { fontSize: 13, fontWeight: '700', color: colors.ink },
  userPhone: { fontSize: 11, color: colors.muted2 },
  dupeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  dupeText: { fontSize: 10, fontWeight: '700', color: colors.amberText },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 10, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  actionBtnText: { fontSize: 11, fontWeight: '700' },
  btnGreen: { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
  btnSlate: { backgroundColor: colors.slateBg, borderColor: colors.slateBorder },
  btnBrand: { backgroundColor: colors.brandTint, borderColor: `${colors.brand}40` },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, gap: 2, maxHeight: '75%' },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  sheetSub: { fontSize: 12, color: colors.muted2, marginBottom: 8 },
  roleOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10 },
  roleOptionActive: { backgroundColor: colors.brandTint },
  roleOptionText: { fontSize: 13, fontWeight: '700' },
});
