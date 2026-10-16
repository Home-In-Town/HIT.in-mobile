import React from 'react';
import { View, Text, Pressable, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Building2 } from 'lucide-react-native';
import { colors, unitColors } from '../../theme';
import type { OwnerPortfolioProject, UnitStatus } from '../../lib/api';
import { statusMeta } from '../../lib/units';
import { fmtPrice } from '../../lib/groupChat/formatting';

// ── Builder property card ──
// Shown as a horizontal strip inside a company group: the properties that
// builder has published. Three actions, because they answer different questions —
// Details is "what is this property", Open Group is "take me to its discussion",
// Share is "send this to a client".
//
// The cover + body are now a Pressable that opens the SAME detail view as the
// Details button. Before this, the card body was inert: tapping the photo or the
// name did nothing, which read as "card pr click kiya to detail nahi dhikhti".
// `bp.actions` is deliberately left OUTSIDE that Pressable — nesting the two
// buttons inside a pressable parent swallows their own taps.
const BuilderPropertyCard = React.memo(function BuilderPropertyCard({ project, opening, sharing, loadingDetails, onDetails, onOpenGroup, onShare }: {
  project: OwnerPortfolioProject;
  opening: boolean;
  sharing: boolean;
  /** Details is awaiting the project fetch for THIS card — see onDetails below. */
  loadingDetails: boolean;
  onDetails: (project: OwnerPortfolioProject) => void;
  onOpenGroup: (project: OwnerPortfolioProject) => void;
  onShare: (project: OwnerPortfolioProject) => void;
}) {
  const where = [project.location, project.city].filter(Boolean).join(', ');
  const price = project.startingPrice ? fmtPrice(project.startingPrice) : '';
  const bhk = (project.bhkOptions || []).filter(Boolean).join('/');

  return (
    <View style={bp.card}>
      {/* Card body tap opens the property detail sheet (unit grid, gallery,
          brochure, Share). It previously opened the Share sheet directly, which
          hid the grid and media behind an extra step; Share is still one tap
          away in the sheet's header and its "Share Property Link" row. */}
      <Pressable
        onPress={() => onDetails(project)}
        disabled={loadingDetails}
        style={({ pressed }) => [pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={`${project.name}. View details`}
      >
        {project.coverImage ? (
          <Image source={{ uri: project.coverImage }} style={bp.cover} resizeMode="cover" />
        ) : (
          <View style={[bp.cover, bp.coverFallback]}>
            <Building2 size={18} color={colors.greenText} />
          </View>
        )}

        <View style={bp.body}>
          <Text style={bp.name} numberOfLines={1}>{project.name}</Text>
          {!!where && <Text style={bp.meta} numberOfLines={1}>📍 {where}</Text>}
          {!!(price || bhk) && (
            <Text style={bp.price} numberOfLines={1}>
              {[price, bhk].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
      </Pressable>

      {/* Vacant/booked summary from the public portfolio's unitCounts (counts
          only — that endpoint never returns unit-level data). Hidden when the
          project has no grid, so cards without units look as they did.
          It is its own tap target, OUTSIDE the body Pressable (nested
          pressables swallow taps), and opens the detail sheet with the full
          grid — the body tap is Share, so without this the grid would not be
          reachable from a builder group at all. */}
      {project.unitCounts && project.unitCounts.total > 0 ? (
        <Pressable
          onPress={() => onDetails(project)}
          disabled={loadingDetails}
          style={({ pressed }) => [bp.unitRow, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`${project.unitCounts.available} of ${project.unitCounts.total} units vacant. View unit availability`}
        >
          {([
            ['available', project.unitCounts.available],
            ['booked', project.unitCounts.booked],
            ['sold', project.unitCounts.sold],
            ['on-hold', project.unitCounts.onHold],
          ] as [UnitStatus, number][])
            .filter(([st, n]) => n > 0 || st === 'available')
            .map(([st, n]) => (
              <View key={st} style={bp.unitItem}>
                <View style={[bp.unitDot, { backgroundColor: unitColors[st] }]} />
                <Text style={bp.unitText}>{n} {statusMeta(st).label.toLowerCase()}</Text>
              </View>
            ))}
          {loadingDetails ? <ActivityIndicator size="small" color={colors.brand} /> : <Text style={bp.unitMore}>›</Text>}
        </Pressable>
      ) : null}
    </View>
  );
});

// Kept named `bp` so the JSX body above is byte-identical to what it was inside
// GroupChatEmbedded.tsx. Only the card's own keys came across; the strip
// container keys (strip, stripHead, stripTitle, stripCount, stripRow, stripEmpty)
// still have parent readers and stayed behind, as did the six keys that were
// already dead before this move (actions, btn, btnGhost, btnSolid, btnText,
// btnIcon) - deleting those is a later phase, not this extraction.
const bp = StyleSheet.create({
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 8 },
  unitMore: { fontSize: 14, color: colors.brand, fontWeight: '700' },
  unitItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  unitDot: { width: 8, height: 8, borderRadius: 2 },
  unitText: { fontSize: 10, color: colors.muted2 },
  card: {
    width: 186,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cover: { width: '100%', height: 84, backgroundColor: '#DCFCE7' },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 9, paddingTop: 7, gap: 1 },
  name: { fontSize: 12, fontWeight: '800', color: colors.ink },
  meta: { fontSize: 10, color: colors.muted2 },
  price: { fontSize: 11, fontWeight: '800', color: colors.greenText, marginTop: 1 },
});

export default BuilderPropertyCard;
