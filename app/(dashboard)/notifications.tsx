import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell, CheckCheck, TrendingUp, MessageSquare, ShoppingBag,
  Zap, Users, Star, Settings, AlertCircle,
} from 'lucide-react-native';
import { notificationsApi, AppNotification } from '../../src/lib/api';
import { SkeletonRow } from '../../src/components/Skeleton';
import EmptyState from '../../src/components/EmptyState';
import MenuButton from '../../src/components/MenuButton';
import { colors } from '../../src/theme';

/* ── Type config ── */
const TYPE_CONFIG: Record<string, { icon: React.ReactNode; bg: string; accent: string; label: string }> = {
  lead_stage_change:  { icon: <TrendingUp size={16} color={colors.blueText} />,   bg: colors.blueBg,   accent: colors.blueText,   label: 'Lead Update' },
  lead_assigned:      { icon: <Users size={16} color={colors.indigoText} />,       bg: colors.indigoBg, accent: colors.indigoText,  label: 'Lead Assigned' },
  lead_follow_up:     { icon: <AlertCircle size={16} color={colors.amberText} />, bg: colors.amberBg,  accent: colors.amberText,   label: 'Follow-up' },
  new_chat_message:   { icon: <MessageSquare size={16} color={colors.cyanText} />, bg: colors.cyanBg,  accent: colors.cyanText,   label: 'Message' },
  marketplace_action: { icon: <ShoppingBag size={16} color={colors.purpleText} />, bg: colors.purpleBg, accent: colors.purpleText, label: 'Marketplace' },
  commission_update:  { icon: <Star size={16} color={colors.greenText} />,         bg: colors.greenBg, accent: colors.greenText,   label: 'Commission' },
  new_listing:        { icon: <ShoppingBag size={16} color={colors.pinkText} />,   bg: colors.pinkBg,  accent: colors.pinkText,    label: 'New Listing' },
  lead_match:         { icon: <Zap size={16} color={colors.brand} />,              bg: colors.brandTint, accent: colors.brand,     label: 'Lead Match' },
  system:             { icon: <Settings size={16} color={colors.slateText} />,     bg: colors.slateBg,  accent: colors.slateText,  label: 'System' },
};

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] || TYPE_CONFIG.system;
}

/* ── Time helpers ── */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/* ── Group notifications by date ── */
function groupByDate(items: AppNotification[]): { label: string; items: AppNotification[] }[] {
  const map = new Map<string, AppNotification[]>();
  items.forEach(n => {
    const lbl = dateLabel(n.createdAt);
    if (!map.has(lbl)) map.set(lbl, []);
    map.get(lbl)!.push(n);
  });
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await notificationsApi.list({ limit: 50 });
      setItems(res.notifications);
      setUnread(res.unreadCount);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePress = async (n: AppNotification) => {
    if (n.read) return;
    setItems(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    setUnread(u => Math.max(0, u - 1));
    notificationsApi.markRead(n.id).catch(() => {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read: false } : x));
      setUnread(u => u + 1);
    });
  };

  const handleMarkAll = async () => {
    if (markingAll || unread === 0) return;
    setMarkingAll(true);
    const prev = items;
    setItems(list => list.map(x => ({ ...x, read: true })));
    setUnread(0);
    notificationsApi.markAllRead().catch(() => { setItems(prev); }).finally(() => setMarkingAll(false));
  };

  const groups = groupByDate(items);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <MenuButton />
          <View>
            <Text style={s.title}>Notifications</Text>
            <Text style={s.sub}>{unread > 0 ? `${unread} unread` : 'All caught up'}</Text>
          </View>
        </View>
        <Pressable onPress={handleMarkAll} disabled={unread === 0 || markingAll}
          style={[s.markAllBtn, unread === 0 && { opacity: 0.4 }]}>
          <CheckCheck size={15} color={unread === 0 ? colors.muted : colors.brand} />
          <Text style={[s.markAllText, { color: unread === 0 ? colors.muted : colors.brand }]}>Mark all</Text>
        </Pressable>
      </View>

      {loading ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          {[0,1,2,3,4].map(i => <SkeletonRow key={i} />)}
        </ScrollView>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell size={28} color={colors.muted} />}
          title="No notifications yet"
          subtitle="Lead updates, messages and marketplace activity will show up here."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
        >
          {groups.map(group => (
            <View key={group.label}>
              {/* Date group header */}
              <View style={s.groupHeader}>
                <View style={s.groupLine} />
                <Text style={s.groupLabel}>{group.label}</Text>
                <View style={s.groupLine} />
              </View>

              {/* Notifications in group */}
              <View style={s.groupItems}>
                {group.items.map(n => {
                  const cfg = getTypeConfig(n.type);
                  return (
                    <Pressable key={n.id} onPress={() => handlePress(n)}
                      style={[s.card, !n.read && s.cardUnread]}>

                      {/* Type icon */}
                      <View style={[s.iconBox, { backgroundColor: cfg.bg }]}>
                        {cfg.icon}
                      </View>

                      {/* Content */}
                      <View style={{ flex: 1 }}>
                        <View style={s.cardTop}>
                          <View style={[s.typePill, { backgroundColor: `${cfg.accent}15` }]}>
                            <Text style={[s.typeText, { color: cfg.accent }]}>{cfg.label}</Text>
                          </View>
                          <Text style={s.timeText}>{timeAgo(n.createdAt)}</Text>
                        </View>
                        <Text style={[s.cardTitle, !n.read && { fontWeight: '700' }]} numberOfLines={1}>
                          {n.title || 'Notification'}
                        </Text>
                        {n.message ? (
                          <Text style={s.cardMsg} numberOfLines={2}>{n.message}</Text>
                        ) : null}
                      </View>

                      {/* Unread dot */}
                      {!n.read && <View style={[s.unreadDot, { backgroundColor: cfg.accent }]} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 21, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 11, color: colors.muted, marginTop: 1 },
  markAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.line },
  markAllText: { fontSize: 11, fontWeight: '700' },

  // Date group
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  groupLine: { flex: 1, height: 1, backgroundColor: colors.line },
  groupLabel: { fontSize: 10, fontWeight: '700', color: colors.muted2, textTransform: 'uppercase', letterSpacing: 0.6 },
  groupItems: { paddingHorizontal: 16, gap: 8 },

  // Card
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 13 },
  cardUnread: { backgroundColor: '#FAFAF8', borderColor: `${colors.brand}30` },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  typePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: 9, fontWeight: '700' },
  timeText: { fontSize: 9, color: colors.muted },
  cardTitle: { fontSize: 12, fontWeight: '600', color: colors.ink },
  cardMsg: { fontSize: 11, color: colors.muted2, marginTop: 2, lineHeight: 17 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
});
