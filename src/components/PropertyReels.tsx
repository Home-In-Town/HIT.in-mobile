// Property Reels — vertical snap-scroll project cards.
// Used on the home screen for admin / builder / captain.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Dimensions, Image,
  Pressable, ActivityIndicator, Platform,
} from 'react-native';
import { MapPin, IndianRupee, Home, CheckCircle, Building2, Zap, Users, Share2 } from 'lucide-react-native';
import { projectsApi, projectsApiExtended, Project } from '../lib/api';
import { ShareModal } from './ShareActions';
import { colors } from '../theme';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');
const CARD_H = Math.min(SCREEN_H * 0.65, 500);

interface Props {
  onProjectPress?: (p: Project) => void;
}

function fmtPrice(n: number): string {
  if (!n) return '—';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(0)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function coverUrl(p: Project): string | null {
  if (!p.coverImage) return null;
  if (typeof p.coverImage === 'string') return p.coverImage;
  return (p.coverImage as any).url ?? null;
}

const STATUS_C: Record<string, string> = {
  'pre-launch': colors.amberText,
  'under-construction': colors.blueText,
  'ready': colors.greenText,
};

export default function PropertyReels({ onProjectPress }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [shareProject, setShareProject] = useState<Project | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await projectsApi.getAllPublic();
      const ps = list as unknown as Project[];
      setProjects(ps);

      // Fire match-counts in background
      const ids = ps.map(p => (p as any).id || (p as any)._id).filter(Boolean);
      if (ids.length > 0) {
        projectsApiExtended.matchCounts(ids).then(setMatchCounts).catch(() => {});
      }
    } catch {
      // silently fail — not critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  if (projects.length === 0) {
    return (
      <View style={s.center}>
        <Building2 size={36} color={colors.muted} />
        <Text style={s.emptyText}>No projects yet</Text>
      </View>
    );
  }

  return (
    <>
      <FlatList
      data={projects}
      keyExtractor={p => (p as any).id || (p as any)._id || Math.random().toString()}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      snapToInterval={CARD_H + 16}
      decelerationRate="fast"
      contentContainerStyle={{ gap: 16, paddingHorizontal: 16, paddingBottom: 24 }}
      renderItem={({ item: p }) => {
        const cover = coverUrl(p);
        const matchN = matchCounts[(p as any).id || (p as any)._id] || 0;
        return (
          <Pressable
            style={[s.card, { height: CARD_H }]}
            onPress={() => onProjectPress?.(p)}
          >            {/* Cover image */}
            {cover ? (
              <Image source={{ uri: cover }} style={s.cardImg} resizeMode="cover" />
            ) : (
              <View style={[s.cardImg, s.noImg]}>
                <Building2 size={40} color={colors.muted} />
              </View>
            )}

            {/* Gradient overlay content */}
            <View style={s.overlay}>
              {/* Top row — status + match signal */}
              <View style={s.topRow}>
                <View style={[s.statusBadge, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
                  <Text style={[s.statusText, { color: STATUS_C[p.projectStatus] || '#fff' }]}>
                    {p.projectStatus?.replace('-', ' ').toUpperCase() || 'LISTING'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  {matchN > 0 && (
                    <View style={s.matchBadge}>
                      <View style={s.matchPulse} />
                      <Zap size={10} color={colors.greenText} />
                      <Text style={s.matchText}>{matchN} buyer{matchN !== 1 ? 's' : ''} match</Text>
                    </View>
                  )}
                  <Pressable
                    onPress={e => { e.stopPropagation?.(); setShareProject(p); }}
                    style={s.shareBtnOverlay}
                  >
                    <Share2 size={14} color="#fff" />
                  </Pressable>
                </View>
              </View>

              {/* Bottom info */}
              <View style={s.bottomInfo}>
                <Text style={s.cardName} numberOfLines={2}>{p.name}</Text>

                <View style={s.infoRow}>
                  <MapPin size={13} color="rgba(255,255,255,0.8)" />
                  <Text style={s.infoText}>{p.city}{p.location ? ` · ${p.location}` : ''}</Text>
                </View>

                <View style={s.priceRow}>
                  <Text style={s.priceText}>Starting {fmtPrice(p.startingPrice)}</Text>
                  {p.pricePerSqFt ? <Text style={s.priceSubText}>  ₹{p.pricePerSqFt}/sqft</Text> : null}
                </View>

                {/* Tags row */}
                <View style={s.tagsRow}>
                  {p.bhkOptions?.slice(0, 3).map(b => (
                    <View key={b} style={s.tag}><Text style={s.tagText}>{b}</Text></View>
                  ))}
                  {p.reraApproved && <View style={s.tag}><CheckCircle size={10} color="#fff" /><Text style={s.tagText}> RERA</Text></View>}
                  {p.bankLoanAvailable && <View style={s.tag}><Text style={s.tagText}>Loan ✓</Text></View>}
                  {p.gatedCommunity && <View style={s.tag}><Home size={10} color="#fff" /><Text style={s.tagText}> Gated</Text></View>}
                </View>
              </View>
            </View>
          </Pressable>
        );
      }}
    />
    <ShareModal project={shareProject} onClose={() => setShareProject(null)} />
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, color: colors.muted },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.night,
  },
  cardImg: {
    ...StyleSheet.absoluteFillObject,
  },
  noImg: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.slateBg,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'space-between',
    padding: 16,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  matchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.greenBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  matchPulse: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.green,
  },
  matchText: { fontSize: 9, fontWeight: '700', color: colors.greenText },
  bottomInfo: { gap: 6 },
  cardName: { fontSize: 21, fontWeight: 'bold', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  infoText: { fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  priceText: { fontSize: 17, fontWeight: 'bold', color: '#fff' },
  priceSubText: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  tagText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  shareBtnOverlay: {
    padding: 7, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
});
