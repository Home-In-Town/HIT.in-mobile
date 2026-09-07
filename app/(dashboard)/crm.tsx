// Home Dashboard — matches homeintown.in mobile dashboard exactly.
// Top navbar (menu + logo + upload) → dark welcome card (greeting + views/leads)
// → quick actions (AI Lead Matching / Marketplace) → property reels
// → bottom bar (CRM / Team). Tapping "CRM" opens the CRM leads view.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Image,
  RefreshControl, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Menu, Plus, Zap, ShoppingBag, MapPin, Eye, Share2,
  BarChart3, Users, Building2,
} from 'lucide-react-native';
import {
  crmBridgeApi, CrmAnalytics, analyticsApi,
  projectsApiExtended, Project,
} from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useSidebar } from '../../src/lib/sidebarContext';
import { ShareModal } from '../../src/components/ShareActions';
import { SkeletonCard } from '../../src/components/Skeleton';
import { colors } from '../../src/theme';

function fmtPrice(n: number): string {
  if (!n) return '—';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} Lac`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function pricePerSqFt(price: number, area?: string): string | null {
  if (!price || !area) return null;
  // area like "800 - 1500 sq ft" — take first number
  const m = area.match(/(\d[\d,]*)/);
  if (!m) return null;
  const sqft = Number(m[1].replace(/,/g, ''));
  if (!sqft) return null;
  return `₹${Math.round(price / sqft).toLocaleString('en-IN')}/sqft`;
}

function coverUrl(p: Project): string | null {
  if (!p.coverImage) return null;
  return typeof p.coverImage === 'string' ? p.coverImage : (p.coverImage as any).url ?? null;
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shareProject, setShareProject] = useState<Project | null>(null);

  const canUpload = ['admin', 'builder', 'captain'].includes(user?.role ?? '');

  const load = useCallback(async () => {
    try {
      const [pubProjects, overview, crm] = await Promise.allSettled([
        projectsApiExtended.getAllPublic(),
        analyticsApi.overview(),
        crmBridgeApi.getAnalytics(),
      ]);

      // All public projects (properly shaped Project[])
      const list = (pubProjects.status === 'fulfilled' ? pubProjects.value : []) as Project[];
      setProjects(list);

      // Analytics totals
      if (overview.status === 'fulfilled' && Array.isArray(overview.value)) {
        const views = overview.value.reduce((s: number, p: any) => s + (p.totalVisits || 0), 0);
        const leads = overview.value.reduce((s: number, p: any) => s + (p.uniqueLeads || 0), 0);
        setStats({ views, leads });
      }

      // CRM analytics (for hot badge)
      if (crm.status === 'fulfilled') setAnalytics(crm.value);

      // Match counts
      const ids = list.map((p: Project) => p.id).filter(Boolean);
      if (ids.length) {
        projectsApiExtended.matchCounts(ids).then(setMatchCounts).catch(() => {});
      }
    } catch { /* silent */ }
    finally {
      setLoading(false);
      setRefreshing(false);
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

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        {/* ── Dark Welcome Card ── */}
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

        {/* ── Quick Actions ── */}
        <View style={s.quickRow}>
          <Pressable
            style={s.quickCard}
            onPress={() => router.push('/(dashboard)/lead-matching' as any)}
          >
            <View style={s.quickIcon}><Zap size={18} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.quickTitle}>AI Lead Matching</Text>
              <Text style={s.quickSub}>MATCH & CONNECT</Text>
            </View>
          </Pressable>
          <Pressable
            style={s.quickCard}
            onPress={() => router.push('/(dashboard)/marketplace' as any)}
          >
            <View style={s.quickIcon}><ShoppingBag size={18} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.quickTitle}>Marketplace</Text>
              <Text style={s.quickSub}>SELL & EARN</Text>
            </View>
          </Pressable>
        </View>

        {/* ── Property Reels ── */}
        <View style={{ paddingHorizontal: 12, paddingTop: 12, gap: 12 }}>
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : projects.length === 0 ? (
            <View style={s.emptyReels}>
              <Building2 size={30} color={colors.muted} />
              <Text style={s.emptyText}>No properties to show</Text>
            </View>
          ) : (
            projects.map(p => {
              const cover = coverUrl(p);
              const ppsf = pricePerSqFt(p.startingPrice, p.carpetAreaRange);
              const matchN = matchCounts[(p as any).id] || 0;
              return (
                <View key={p.id} style={s.reelCard}>
                  {/* Image */}
                  <View style={s.reelImgWrap}>
                    {cover ? (
                      <Image source={{ uri: cover }} style={s.reelImg} resizeMode="cover" />
                    ) : (
                      <View style={[s.reelImg, s.reelNoImg]}>
                        <Text style={{ fontSize: 26, color: colors.muted, fontWeight: '800' }}>₹</Text>
                      </View>
                    )}
                    <View style={s.reelTypeBadge}>
                      <Text style={s.reelTypeText}>{(p.type || 'FLAT').toUpperCase()}</Text>
                    </View>
                  </View>

                  {/* Content */}
                  <View style={s.reelContent}>
                    {/* Name + price */}
                    <View>
                      <Text style={s.reelName} numberOfLines={1}>{p.name}</Text>
                      <Text style={s.reelPrice}>{fmtPrice(p.startingPrice)}</Text>
                    </View>

                    {/* Location + rate */}
                    <View style={s.reelLocRow}>
                      <View style={s.reelLocLeft}>
                        <MapPin size={12} color={colors.muted} />
                        <Text style={s.reelLoc} numberOfLines={1}>
                          {p.location ? `${p.location.split(',')[0]}, ` : ''}{(p.city || '').split(',')[0]}
                        </Text>
                      </View>
                      {ppsf && <Text style={s.reelRate}>{ppsf}</Text>}
                    </View>

                    {/* Match signal */}
                    {matchN > 0 && (
                      <View style={s.matchRow}>
                        <View style={s.matchDot} />
                        <Text style={s.matchText}>
                          {matchN} live {matchN === 1 ? 'buyer matches' : 'buyers match'} this
                        </Text>
                      </View>
                    )}

                    {/* Tags */}
                    <View style={s.tagsRow}>
                      {p.bhkOptions?.length > 0 && (
                        <View style={[s.tag, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                          <Text style={[s.tagText, { color: '#1D4ED8' }]}>{p.bhkOptions.slice(0, 2).join(', ')}</Text>
                        </View>
                      )}
                      {p.carpetAreaRange ? (
                        <View style={[s.tag, { backgroundColor: colors.slateBg, borderColor: colors.slateBorder }]}>
                          <Text style={[s.tagText, { color: colors.slateText }]}>{p.carpetAreaRange}</Text>
                        </View>
                      ) : null}
                      {p.projectStatus && p.projectStatus !== 'pre-launch' && (
                        <View style={[s.tag, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>
                          <Text style={[s.tagText, { color: '#C2410C' }]}>
                            {p.projectStatus === 'ready' ? 'Ready' : 'UC'}
                          </Text>
                        </View>
                      )}
                      {p.reraApproved && (
                        <View style={[s.tag, { backgroundColor: colors.greenBg, borderColor: colors.greenBorder }]}>
                          <Text style={[s.tagText, { color: colors.greenText }]}>RERA</Text>
                        </View>
                      )}
                    </View>

                    {/* Actions */}
                    <View style={s.reelActions}>
                      <Pressable
                        style={s.viewBtn}
                        onPress={() => p.slug && Linking.openURL(`https://homeintown.in/visit/${p.slug}`)}
                      >
                        <Eye size={13} color="#fff" />
                        <Text style={s.viewBtnText}>View Details</Text>
                      </Pressable>
                      <Pressable style={s.shareBtn} onPress={() => setShareProject(p)}>
                        <Share2 size={13} color={colors.brand} />
                        <Text style={s.shareBtnText}>Share</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* ── Fixed Bottom Bar ── */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable style={s.bottomItem} onPress={() => router.push('/(dashboard)/crm-leads' as any)}>
          <View style={s.bottomIcon}>
            <BarChart3 size={19} color={colors.brand} />
            {crmHot > 0 && <View style={s.hotDot} />}
          </View>
          <View>
            <Text style={s.bottomTitle}>CRM</Text>
            <Text style={s.bottomSub}>PIPELINE</Text>
          </View>
        </Pressable>
        <Pressable style={s.bottomItem} onPress={() => Linking.openURL('https://www.oneemployee.in/')}>
          <View style={s.bottomIcon}>
            <Users size={19} color={colors.brand} />
          </View>
          <View>
            <Text style={s.bottomTitle}>Team</Text>
            <Text style={s.bottomSub}>ONE EMPLOYEE</Text>
          </View>
        </Pressable>
      </View>

      {/* Share sheet */}
      <ShareModal project={shareProject} onClose={() => setShareProject(null)} />
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
  logoLetter: { color: '#fff', fontWeight: '800', fontSize: 13 },
  brandName: { fontSize: 15, fontWeight: '800', color: colors.ink },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  uploadText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Welcome card
  welcomeCard: {
    marginHorizontal: 12, marginTop: 12,
    borderRadius: 18, backgroundColor: '#1C1917',
    padding: 16, overflow: 'hidden', position: 'relative',
  },
  welcomeGlow: { position: 'absolute', width: 130, height: 130, borderRadius: 65, backgroundColor: `${colors.brand}22`, top: -50, right: -30 },
  welcomeInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { color: colors.brand, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  welcomeName: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 3 },
  welcomeStats: { flexDirection: 'row', gap: 18 },
  welcomeStat: { alignItems: 'center' },
  welcomeStatNum: { color: '#fff', fontSize: 20, fontWeight: '800' },
  welcomeStatLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 8, fontWeight: '800', letterSpacing: 0.6, marginTop: 1 },

  // Quick actions
  quickRow: { flexDirection: 'row', gap: 10, marginHorizontal: 12, marginTop: 12 },
  quickCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12,
  },
  quickIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: `${colors.brand}15`, alignItems: 'center', justifyContent: 'center' },
  quickTitle: { fontSize: 13, fontWeight: '800', color: colors.ink },
  quickSub: { fontSize: 8.5, color: colors.muted, fontWeight: '700', letterSpacing: 0.4, marginTop: 2 },

  // Reels
  emptyReels: { alignItems: 'center', paddingVertical: 50, gap: 10 },
  emptyText: { fontSize: 14, color: colors.muted },
  reelCard: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderRadius: 16, borderWidth: 1, borderColor: colors.line,
    overflow: 'hidden', height: 168,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  reelImgWrap: { width: 120, height: 168, position: 'relative' },
  reelImg: { width: 120, height: 168 },
  reelNoImg: { width: 120, height: 168, backgroundColor: colors.slateBg, alignItems: 'center', justifyContent: 'center' },
  reelTypeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  reelTypeText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  reelContent: { flex: 1, padding: 12, justifyContent: 'space-between', gap: 6 },
  reelName: { fontSize: 14, fontWeight: '800', color: colors.ink },
  reelPrice: { fontSize: 14, fontWeight: '800', color: colors.brand, marginTop: 2 },
  reelLocRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  reelLocLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  reelLoc: { fontSize: 11, color: colors.muted2, fontWeight: '500', flex: 1 },
  reelRate: { fontSize: 10, color: colors.muted, fontWeight: '700' },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  matchDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#3F6212' },
  matchText: { fontSize: 10, fontWeight: '700', color: '#3F6212' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  tagText: { fontSize: 8.5, fontWeight: '800' },
  reelActions: { flexDirection: 'row', gap: 6 },
  viewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#1C1917', paddingVertical: 8, borderRadius: 8 },
  viewBtnText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#FFF8F0', borderWidth: 1, borderColor: `${colors.brand}33`, paddingVertical: 8, borderRadius: 8 },
  shareBtnText: { color: colors.brand, fontSize: 10, fontWeight: '800' },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 8,
    backgroundColor: colors.white,
    borderTopWidth: 1, borderTopColor: colors.line,
    paddingHorizontal: 12, paddingTop: 8,
  },
  bottomItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 6 },
  bottomIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: `${colors.brand}15`, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  hotDot: { position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', borderWidth: 1, borderColor: colors.white },
  bottomTitle: { fontSize: 13, fontWeight: '800', color: colors.ink },
  bottomSub: { fontSize: 8.5, color: colors.muted, fontWeight: '700', letterSpacing: 0.4, marginTop: 1 },
});
