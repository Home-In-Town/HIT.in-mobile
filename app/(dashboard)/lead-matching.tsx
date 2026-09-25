// AI Lead Matching Hub — 4-tab container
// Tabs: Groups (GroupChat), Chats (Chat), Assistant (AI slot-filling), Leads/Stats (admin)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Users, MessageSquare, BarChart2, X } from 'lucide-react-native';
import { leadMatchingApi } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useToast } from '../../src/components/Toast';
import { colors } from '../../src/theme';

// We import the full screens as components and render them inside tabs.
// This avoids duplicating navigation logic.
import GroupChatEmbedded from '../../src/components/GroupChatEmbedded';
import ChatEmbedded from '../../src/components/ChatEmbedded';
import MenuButton from '../../src/components/MenuButton';

type Tab = 'groups' | 'chats' | 'assistant' | 'leads';

// Imperative triggers exposed by the embedded AI Lead Matching group.
type GroupActions = {
  post: () => void;
  matching: () => void;
  resetToLanding: () => void;
};

const CONF_COLOR = (c: number) => c >= 0.8 ? colors.greenText : c >= 0.5 ? colors.amberText : colors.redText;
const CONF_BG    = (c: number) => c >= 0.8 ? colors.greenBg  : c >= 0.5 ? colors.amberBg  : colors.redBg;

// Note: an `AssistantTab` wrapper used to live here. It was dead — the hub renders
// GroupChatEmbedded (which hosts the assistant inline) or ChatEmbedded, never a
// standalone AiAssistant — so it has been removed along with its imports.

// ── Leads Tab (admin only) ─────────────────────────────────
function LeadsTab() {
  const toast = useToast();
  const [leads, setLeads] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [leadsTab, setLeadsTab] = useState<'list' | 'stats'>('list');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    // allSettled, not all: /stats is admin-only and 403s for builders, while
    // /leads succeeds for them. Promise.all rejected on the stats 403 and threw
    // away the leads that HAD loaded, so every builder saw "Failed to load" and
    // an empty list. Each result is now applied independently.
    let alive = true;
    Promise.allSettled([
      leadMatchingApi.getLeads({ limit: 30 }),
      leadMatchingApi.getStats(),
    ]).then(([leadsRes, statsRes]) => {
      if (!alive) return;
      if (leadsRes.status === 'fulfilled') {
        setLeads(leadsRes.value.leads || []);
      } else {
        toast.show('Failed to load leads', 'error');
      }
      // Stats are admin-only; a 403 here is expected for builders and must not
      // surface as an error.
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
      setLoading(false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatus = async (id: string, status: string) => {
    setUpdating(id);
    try {
      await leadMatchingApi.updateStatus(id, status);
      setLeads(prev => prev.map(l => l._id === id ? { ...l, status } : l));
      toast.show('Updated', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Failed', 'error');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.brand} size="large" /></View>;

  return (
    <View style={{ flex: 1 }}>
      {/* Stats is admin-only on the backend, so only offer the tab when we
          actually have stats — otherwise selecting it silently fell through to
          rendering the leads list, which looked broken. */}
      <View style={lt.tabs}>
        {(stats ? (['list', 'stats'] as const) : (['list'] as const)).map(t => (
          <Pressable key={t} onPress={() => setLeadsTab(t)} style={[lt.tabBtn, leadsTab === t && lt.tabBtnActive]}>
            <Text style={[lt.tabText, leadsTab === t && lt.tabTextActive]}>{t === 'list' ? 'Extracted Leads' : 'Stats'}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}>
        {leadsTab === 'stats' && stats ? (
          <View style={{ gap: 12 }}>
            <View style={lt.statsRow}>
              {[['Total', stats.total], ['Matched', stats.withMatches], ['Rate', stats.matchRate]].map(([k, v]) => (
                <View key={k as string} style={lt.statCard}>
                  <Text style={lt.statNum}>{v}</Text>
                  <Text style={lt.statLbl}>{k}</Text>
                </View>
              ))}
            </View>
            {stats.byStatus && Object.entries(stats.byStatus).map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Text style={{ fontSize: 12, color: colors.muted2, textTransform: 'capitalize' }}>{k}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>{v as number}</Text>
              </View>
            ))}
          </View>
        ) : (
          leads.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 60 }}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>No extracted leads yet</Text>
            </View>
          ) : leads.map(l => {
            const conf = l.extractionConfidence || 0;
            return (
              <View key={l._id} style={lt.card}>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <View style={[{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }, { backgroundColor: CONF_BG(conf) }]}>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: CONF_COLOR(conf) }}>{Math.round(conf * 100)}% conf</Text>
                  </View>
                  <View style={{ backgroundColor: colors.indigoBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: colors.indigoText }}>{l.intent || ''}</Text>
                  </View>
                  <Text style={{ fontSize: 10, color: colors.muted, fontStyle: 'italic' }}>{l.source}</Text>
                </View>
                <Text style={{ fontSize: 12, color: colors.muted2, marginBottom: 6 }} numberOfLines={2}>{l.originalText}</Text>
                {l.params && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                    {l.params.bhkType && <Chip label={l.params.bhkType} />}
                    {l.params.city && <Chip label={l.params.city} />}
                    {l.params.budget && <Chip label={`₹${l.params.budget}L`} />}
                  </View>
                )}
                {l.status === 'auto_detected' && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable onPress={() => handleStatus(l._id, 'confirmed')} disabled={updating === l._id}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.greenBg, borderWidth: 1, borderColor: colors.greenBorder, alignItems: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.greenText }}>Confirm</Text>
                    </Pressable>
                    <Pressable onPress={() => handleStatus(l._id, 'rejected')} disabled={updating === l._id}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.redBg, borderWidth: 1, borderColor: colors.redBorder, alignItems: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.redText }}>Reject</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const lt = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.white },
  tabBtn: { flex: 1, paddingVertical: 11, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: colors.brand },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.muted2 },
  tabTextActive: { color: colors.brand },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 14, alignItems: 'center' },
  statNum: { fontSize: 19, fontWeight: 'bold', color: colors.ink },
  statLbl: { fontSize: 10, color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14 },
});

function Chip({ label }: { label: string }) {
  return (
    <View style={{ backgroundColor: colors.slateBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: colors.slateBorder }}>
      <Text style={{ fontSize: 10, fontWeight: '600', color: colors.slateText }}>{label}</Text>
    </View>
  );
}

// ── Main Hub ─────────────────────────────────────────────────
export default function LeadMatchingHub({
  embedded = false,
  onChatActiveChange,
  resetSignal = 0,
}: {
  embedded?: boolean;
  onChatActiveChange?: (active: boolean) => void;
  // Incremented by the parent each time the "AI Leads" section button is tapped.
  // Every change returns this hub to its default landing view.
  resetSignal?: number;
} = {}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  // 'assistant' = the AI Lead Matching group chat (default). 'groups' / 'chats'
  // switch the content pane. My Post / Matching are actions that live on the
  // assistant chat itself, not in this hub's navigation.
  const [tab, setTab] = useState<'chats' | 'assistant' | 'groups'>('assistant');
  const [showLeads, setShowLeads] = useState(false);
  // Post / Matching triggers exposed by the embedded assistant group.
  const groupActionsRef = useRef<GroupActions | null>(null);
  // Stable identity so the child's onActionsReady effect doesn't re-run each render.
  const handleActionsReady = useCallback((a: GroupActions) => {
    groupActionsRef.current = a;
  }, []);

  // Tapping the "AI Leads" section button returns to the default landing page —
  // the same view the app opens on — instead of dropping the user back into a
  // half-finished conversation. Skips the initial mount (resetSignal 0).
  React.useEffect(() => {
    if (!resetSignal) return;
    setTab('assistant');
    setShowLeads(false);
    groupActionsRef.current?.resetToLanding();
  }, [resetSignal]);
  // When a group room is opened, hide the header + top tab bar for a
  // full-screen chat experience (matches the website behavior).
  const [groupOpen, setGroupOpen] = useState(false);
  const isAdmin = ['admin', 'builder'].includes(user?.role ?? '');

  // Report "chat active" to the parent (Overview) so it can hide the welcome
  // banner. The AI Lead Matching section IS the group chat, so this is always
  // true — `tab` was in the deps but changed nothing, so it only re-fired.
  React.useEffect(() => {
    onChatActiveChange?.(true);
  }, [onChatActiveChange]);

  // Sub-row under the AI Leads section: Groups · Chats.
  // Only the two pane switchers live here. My Post / Matching are actions on the
  // assistant chat, not navigation, so they sit in the chat's own action row
  // (GroupChatEmbedded) where they originally were — keeping them here made a
  // 4-item bar that mixed navigation with actions.
  const SUB = [
    { key: 'groups', label: 'Groups', icon: Users,         kind: 'pane' as const },
    { key: 'chats',  label: 'Chats',  icon: MessageSquare, kind: 'pane' as const },
  ];

  // Keep the tab bar visible on the AI Lead Matching section (it IS the primary
  // section). Only hide chrome when a room is opened from the separate Groups tab.
  const chromeHidden = tab === 'groups' && groupOpen;

  return (
    <View style={[hub.root, { paddingTop: (chromeHidden || embedded) ? 0 : insets.top }]}>
      {/* Header + tab bar hidden while a group is open */}
      {!chromeHidden && (
        <>
          {/* Own header hidden when embedded (Overview provides the navbar) */}
          {!embedded && (
            <View style={hub.header}>
              <MenuButton />
              <View style={{ flex: 1 }} />
              {isAdmin && (
                <Pressable onPress={() => setShowLeads(true)} style={hub.leadsBtn}>
                  <BarChart2 size={15} color={colors.brand} />
                  <Text style={hub.leadsBtnText}>Leads</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Sub-row: Groups · Chats */}
          <View style={hub.subBar}>
            {SUB.map(item => {
              const Icon = item.icon;
              const active =
                (item.key === 'groups' && tab === 'groups') ||
                (item.key === 'chats' && tab === 'chats');
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setTab(item.key as 'groups' | 'chats')}
                  style={[hub.subTab, active && hub.subTabActive]}
                >
                  <Icon size={15} color={active ? colors.brand : colors.muted2} />
                  <Text style={[hub.subTabText, active && hub.subTabTextActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* Content: the AI Lead Matching group chat is the base view (headerless —
          this hub's sub-row replaces its header). 'chats' / 'groups' swap panes. */}
      <View style={{ flex: 1 }}>
        {tab === 'chats' ? (
          <ChatEmbedded />
        ) : tab === 'groups' ? (
          // Distinct `key` per pane is REQUIRED, not cosmetic. Both branches
          // render GroupChatEmbedded at the same position in the same parent, so
          // React reconciled them as one component and merely swapped props —
          // meaning all internal state (aiMode, activeRoom, messages, drafts)
          // survived the tab switch. That let an AI Assist conversation started in
          // the AI Leads pane stay live after switching to Groups and opening a
          // property group, so the assistant's greeting and Buy/Sell/Rent intent
          // chips rendered inside an ordinary group. Separate keys force a clean
          // unmount/mount of each pane.
          <GroupChatEmbedded
            key="groups-pane"
            onRoomOpenChange={setGroupOpen}
            topInset={embedded ? 0 : insets.top}
          />
        ) : (
          <GroupChatEmbedded
            key="assistant-pane"
            onRoomOpenChange={setGroupOpen}
            topInset={0}
            autoOpenUniversal
            hideThreadBack
            headerless
            onActionsReady={handleActionsReady}
          />
        )}
      </View>

      {/* Leads overlay (opened from the top button) */}
      <Modal visible={showLeads} animationType="slide" onRequestClose={() => setShowLeads(false)}>
        <View style={{ flex: 1, backgroundColor: colors.cream, paddingTop: insets.top }}>
          <View style={hub.header}>
            <Text style={hub.headerTitle}>Extracted Leads</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => setShowLeads(false)} style={hub.closeBtn}>
              <X size={20} color={colors.ink} />
            </Pressable>
          </View>
          <LeadsTab />
        </View>
      </Modal>
    </View>
  );
}

const hub = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.white },
  headerTitle: { fontSize: 19, fontWeight: '800', color: colors.ink },
  // Sub-row (Groups · Chats)
  subBar: { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  subTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  subTabActive: { borderBottomColor: colors.brand },
  subTabText: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  subTabTextActive: { color: colors.brand, fontWeight: '800' },
  leadsBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.brand },
  leadsBtnText: { fontSize: 11.5, fontWeight: '800', color: colors.brand },
  closeBtn: { padding: 6, borderRadius: 10, backgroundColor: colors.slateBg },
});
