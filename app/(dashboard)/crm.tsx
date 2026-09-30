// Home Dashboard.
// Top navbar (menu + logo + upload) → dark welcome card (greeting + views/leads,
// AI tab only) → the AI Leads / CRM / Project switcher, which swaps between three
// embedded screens: LeadMatchingHub, CrmLeadsScreen and the PropertyMap.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Menu, Plus, Zap, ShoppingBag, BarChart3,
} from 'lucide-react-native';
import {
  crmBridgeApi, CrmAnalytics, analyticsApi,
} from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useSidebar } from '../../src/lib/sidebarContext';
import { colors } from '../../src/theme';
// Reused screens rendered as embedded tab content (no duplication).
import CrmLeadsScreen from './crm-leads';
import LeadMatchingHub from './lead-matching';
import PropertyMap from '../../src/components/PropertyMap';

// 'marketplace' is the Project segment. The name is historical — the segment was
// a marketplace before it became the map — and is left alone because renaming it
// would touch every reference for no behavioural gain.
type OverviewTab = 'ai' | 'crm' | 'marketplace';

// One segment of the AI Leads / CRM / Project switcher.
//
// The three segments sit inside a single connected pill (s.tabPill), so the
// active one reads as a filled pill within a light track rather than as three
// separate cards. The fill is an absolutely-positioned layer whose opacity is
// animated: that keeps the transition smooth while guaranteeing all three
// segments stay exactly the same height and perfectly aligned (a scale/translate
// animation would push the active segment out of the shared container).
function SectionTab({ active, icon, label, badge, onPress }: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: boolean;
  onPress: () => void;
}) {
  const anim = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: active ? 1 : 0,
      duration: 170,
      useNativeDriver: true,
    }).start();
  }, [active, anim]);

  return (
    <Pressable
      style={s.segment}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Animated.View pointerEvents="none" style={[s.segmentFill, { opacity: anim }]} />
      <View style={s.segmentInner}>
        <View style={s.segmentIcon}>
          {icon}
          {badge && <View style={s.hotDotInline} />}
        </View>
        <Text style={[s.segmentLabel, active && s.segmentLabelActive]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function greetingText(): string {
  const h = new Date().getHours();
  if (h < 12) return 'GOOD MORNING';
  if (h < 17) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

export default function HomeDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { openSidebar } = useSidebar();

  const [analytics, setAnalytics] = useState<CrmAnalytics | null>(null);
  const [stats, setStats] = useState({ views: 0, leads: 0 });
  const [loading, setLoading] = useState(true);
  // Active Overview tab — AI Lead Matching is the default view.
  const [tab, setTab] = useState<OverviewTab>('ai');
  // True while an AI Lead Matching conversation is active → hide the welcome banner.
  const [chatActive, setChatActive] = useState(false);
  // Bumped on every "AI Leads" tap so the hub returns to its default landing page.
  const [aiResetKey, setAiResetKey] = useState(0);

  // Agents can also list/upload projects (backend ProjectController.create allows
  // builder/agent/admin/captain), so include 'agent' here to match permissions.
  const canUpload = ['admin', 'builder', 'captain', 'agent'].includes(user?.role ?? '');

  // Two requests, both for the chrome this screen owns: the welcome card's
  // views/leads totals and the CRM segment's hot-lead dot. The tab contents fetch
  // their own data.
  //
  // This used to also pull the full public project list and then a match count
  // for every project in it — a second copy of a list the Project tab fetches
  // anyway — to feed a property-reels section that had been switched off with
  // `{false && ...}`. Both requests went out on every dashboard open.
  const load = useCallback(async () => {
    try {
      const [overview, crm] = await Promise.allSettled([
        analyticsApi.overview(),
        crmBridgeApi.getAnalytics(),
      ]);

      if (overview.status === 'fulfilled' && Array.isArray(overview.value)) {
        const views = overview.value.reduce((s: number, p: any) => s + (p.totalVisits || 0), 0);
        const leads = overview.value.reduce((s: number, p: any) => s + (p.uniqueLeads || 0), 0);
        setStats({ views, leads });
      }

      if (crm.status === 'fulfilled') setAnalytics(crm.value);
    } catch { /* silent — the banner just shows placeholders */ }
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const crmHot = analytics?.hot ?? 0;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Top Navbar ── */}
      <View style={s.navbar}>
        <View style={s.navLeft}>
          <Pressable onPress={openSidebar} hitSlop={8} style={s.menuBtn}>
            <Menu size={22} color={colors.ink} />
          </Pressable>
          <View style={s.logoBox}><Text style={s.logoLetter}>H</Text></View>
          <Text style={s.brandName}>HomeInTown</Text>
        </View>
        {canUpload && (
          <Pressable style={s.uploadBtn} onPress={() => router.push('/(dashboard)/add-project' as any)}>
            <Plus size={14} color="#fff" strokeWidth={2.5} />
            <Text style={s.uploadText}>Upload</Text>
          </Pressable>
        )}
      </View>

      {/* ── Welcome Banner (only on AI tab, hidden once a chat is active) ── */}
      {tab === 'ai' && !chatActive && (
        <View style={s.welcomeCard}>
          <View style={s.welcomeGlow} />
          <View style={s.welcomeInner}>
            <View>
              <Text style={s.greeting}>{greetingText()}</Text>
              <Text style={s.welcomeName}>{user?.name || 'Welcome'}</Text>
            </View>
            <View style={s.welcomeStats}>
              <View style={s.welcomeStat}>
                <Text style={s.welcomeStatNum}>{loading ? '—' : stats.views}</Text>
                <Text style={s.welcomeStatLabel}>VIEWS</Text>
              </View>
              <View style={s.welcomeStat}>
                <Text style={s.welcomeStatNum}>{loading ? '—' : stats.leads}</Text>
                <Text style={s.welcomeStatLabel}>LEADS</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ── Tab Switcher (always visible): AI Leads · CRM · Project ──
          A single connected pill: light track, active segment filled brand. */}
      <View style={s.tabRow}>
        <View style={s.tabPill} accessibilityRole="tablist">
          <SectionTab
            active={tab === 'ai'}
            // Always bump the reset signal — tapping "AI Leads" should land on the
            // default page whether we're switching to it or already on it.
            onPress={() => { setTab('ai'); setAiResetKey((k) => k + 1); }}
            icon={<Zap size={14} color={tab === 'ai' ? '#fff' : colors.muted2} />}
            label="AI Leads"
          />
          <SectionTab
            active={tab === 'crm'}
            onPress={() => setTab('crm')}
            icon={<BarChart3 size={14} color={tab === 'crm' ? '#fff' : colors.muted2} />}
            label="CRM"
            badge={crmHot > 0}
          />
          <SectionTab
            active={tab === 'marketplace'}
            onPress={() => setTab('marketplace')}
            icon={<ShoppingBag size={14} color={tab === 'marketplace' ? '#fff' : colors.muted2} />}
            label="Project"
          />
        </View>
      </View>

      {/* ── CRM tab ── */}
      {tab === 'crm' && (
        <View style={{ flex: 1 }}>
          <CrmLeadsScreen embedded />
        </View>
      )}

      {/* ── Project tab: full Google-map property view ── */}
      {tab === 'marketplace' && (
        <View style={{ flex: 1 }}>
          <PropertyMap isAdmin={user?.role === 'admin'} />
        </View>
      )}

      {/* ── AI Lead Matching tab: the AI Lead Matching hub (banner is now above) ── */}
      {tab === 'ai' && (
        <View style={{ flex: 1 }}>
          {/* The actual AI Lead Matching feature (AI Lead Matching / Groups / Chats) */}
          <View style={{ flex: 1 }}>
            <LeadMatchingHub embedded onChatActiveChange={setChatActive} resetSignal={aiResetKey} />
          </View>
        </View>
      )}

    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },

  // Navbar
  navbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  navLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuBtn: { padding: 2 },
  logoBox: { width: 26, height: 26, borderRadius: 7, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  logoLetter: { color: '#fff', fontWeight: '800', fontSize: 12 },
  brandName: { fontSize: 14, fontWeight: '800', color: colors.ink },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  uploadText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Welcome card
  welcomeCard: {
    marginHorizontal: 12, marginTop: 12,
    borderRadius: 18, backgroundColor: '#1C1917',
    padding: 16, overflow: 'hidden', position: 'relative',
  },
  welcomeGlow: { position: 'absolute', width: 130, height: 130, borderRadius: 65, backgroundColor: `${colors.brand}22`, top: -50, right: -30 },
  welcomeInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { color: colors.brand, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  welcomeName: { color: '#fff', fontSize: 21, fontWeight: '800', marginTop: 3 },
  welcomeStats: { flexDirection: 'row', gap: 18 },
  welcomeStat: { alignItems: 'center' },
  welcomeStatNum: { color: '#fff', fontSize: 19, fontWeight: '800' },
  welcomeStatLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 8, fontWeight: '800', letterSpacing: 0.6, marginTop: 1 },

  // CRM "hot lead" badge, overlaid on that segment's icon.
  hotDotInline: { position: 'absolute', top: -3, right: -4, width: 7, height: 7, borderRadius: 4, backgroundColor: '#EF4444', borderWidth: 1, borderColor: colors.white },

  // ── Section switcher: one connected pill ──────────────────────────────────
  // tabRow is the full-width band that sits on the page background; tabPill is
  // the actual connected container holding the three segments.
  tabRow: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.cream },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandTint,          // light warm track
    borderWidth: 1,
    borderColor: `${colors.brand}22`,
    borderRadius: 999,
    padding: 4,                                  // inset so the active fill floats inside
  },
  // Equal, fixed height on every segment keeps the three perfectly aligned.
  segment: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Animated active fill. Absolute so it never affects layout.
  segmentFill: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: colors.brand,
    borderRadius: 999,
  },
  segmentInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  segmentIcon: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  segmentLabel: { fontSize: 12, fontWeight: '800', color: colors.muted2 },
  segmentLabelActive: { color: '#fff' },

});
