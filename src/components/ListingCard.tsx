// Shared marketplace-style property card. Extracted from marketplace.tsx so the
// exact same UI/layout/styling is reused by both the Marketplace screen and the
// Projects screen (project cards render through this component too).
//
// The card reads its display data from a loose `project` object that may be
// either the backend's nested shape (project.media.coverImage, project.pricing,
// project.configuration) OR the app's flattened Project shape — every helper
// falls back across both, so a flat Project can be passed straight through.
import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import {
  MapPin, Building2, Eye, Share2, CheckCircle, Sparkles, Tag, MoreVertical,
} from 'lucide-react-native';
import { MarketplaceListing } from '../lib/api';
import { colors } from '../theme';

/* ── helpers (identical behavior to the former marketplace.tsx inline copy) ── */
export function fmtPrice(n: number): string {
  if (!n) return '—';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(0)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function coverUrl(listing: MarketplaceListing): string | null {
  const p = listing.project as any;
  if (!p) return null;
  const ci = p.media?.coverImage ?? p.coverImage;
  if (!ci) return null;
  return typeof ci === 'string' ? ci : ci.url ?? null;
}

export function getCity(listing: MarketplaceListing): string {
  return (listing.project as any)?.city || '';
}

export function getProjectName(listing: MarketplaceListing): string {
  return (listing.project as any)?.projectName || (listing.project as any)?.name || 'Project';
}

export function getBhk(listing: MarketplaceListing): string[] {
  return (listing.project as any)?.configuration?.bhkOptions ?? (listing.project as any)?.bhkOptions ?? [];
}

export function getProject(listing: MarketplaceListing): any {
  return (listing.project as any) || {};
}

export function getPrice(listing: MarketplaceListing): number {
  const p = getProject(listing);
  return p?.pricing?.startingPrice ?? p?.startingPrice ?? (listing as any)?.expectedValue ?? 0;
}

export function getArea(listing: MarketplaceListing): string {
  const p = getProject(listing);
  return p?.configuration?.carpetAreaRange ?? p?.configuration?.plotSizeRange ??
    p?.carpetAreaRange ?? p?.plotSizeRange ?? '';
}

// Human-readable property label (mirrors web getPropertyLabel)
export function propertyLabel(listing: MarketplaceListing): string {
  const p = getProject(listing);
  if (p?.propertyType) return p.propertyType;
  if (p?.category) return p.category;
  if (p?.projectType === 'plot' || p?.type === 'plot') return 'Plot';
  return 'Apartment';
}

export function getProjectId(listing: MarketplaceListing): string {
  const p = getProject(listing);
  return String(p?._id || p?.id || '');
}

export function getSlug(listing: MarketplaceListing): string {
  return getProject(listing)?.slug || '';
}

// Derive price-per-sqft from starting price and the lower-bound of an area range.
export function pricePerSqFt(listing: MarketplaceListing): string | null {
  const price = getPrice(listing);
  const area = getArea(listing);
  if (!price || !area) return null;
  const lower = area.toLowerCase();
  if (/(acre|hectare|guntha|bigha)/.test(lower)) return null;
  const m = lower.match(/\d[\d,]*/);
  if (!m) return null;
  const sqft = Number(m[0].replace(/,/g, ''));
  if (!sqft || sqft <= 0) return null;
  return `₹${Math.round(price / sqft).toLocaleString('en-IN')}/sqft`;
}

/* ── Rich single-column listing card (matches website) ── */
export default function ListingCard({ l, matchCount, onView, onShare, onMenu }: {
  l: MarketplaceListing; matchCount: number; onView: () => void; onShare: () => void;
  // Optional 3-dot menu (used by the Projects screen). When omitted, no kebab shows.
  onMenu?: () => void;
}) {
  const cover = coverUrl(l);
  const p = getProject(l);
  const bhk = getBhk(l).slice(0, 2);
  const area = getArea(l);
  const price = getPrice(l);
  const perSqft = pricePerSqFt(l);
  const isStd = !!(l as any).isStd; // synthetic card from a published project (not a marketplace listing)
  const isSelling = !isStd && l.listingType === 'selling';
  const hasCommission = !isStd && Number(l.commissionValue) > 0;
  const commLabel = l.commissionType === 'percentage'
    ? `${l.commissionValue}%`
    : `₹${Number(l.commissionValue).toLocaleString('en-IN')}`;

  // "Earn ₹X at Y%" for percentage commissions with a known price.
  const earnLine = (hasCommission && l.commissionType === 'percentage' && price > 0)
    ? `Earn ${fmtPrice((price * Number(l.commissionValue)) / 100)} at ${l.commissionValue}%`
    : null;

  const status = String(p?.projectStatus || '');
  const showStatus = status && status !== 'pre-launch';

  return (
    <View style={mc.card}>
      <View style={mc.top}>
        {/* Image */}
        <View style={mc.imgWrap}>
          {cover ? (
            <Image source={{ uri: cover }} style={mc.img} resizeMode="cover" />
          ) : (
            <View style={[mc.img, mc.noImg]}><Building2 size={26} color={colors.muted} /></View>
          )}
          {/* STD / LISTED / REQ badge */}
          <View style={[mc.badge, { backgroundColor: isStd ? 'rgba(0,0,0,0.6)' : isSelling ? '#10B981' : colors.indigo }]}>
            <Text style={mc.badgeText}>{isStd ? 'STD' : isSelling ? 'LISTED' : 'REQ'}</Text>
          </View>
          {/* commission badge */}
          {hasCommission && (
            <View style={mc.commBadge}>
              <Sparkles size={9} color="#fff" />
              <Text style={mc.commBadgeText}>{commLabel}</Text>
            </View>
          )}
        </View>

        {/* Content */}
        <View style={mc.content}>
          <View style={mc.nameRow}>
            <Text style={mc.name} numberOfLines={1}>{getProjectName(l)}</Text>
            {/* 3-dot menu (Projects screen only) */}
            {onMenu && (
              <Pressable onPress={onMenu} hitSlop={8} style={mc.kebab}>
                <MoreVertical size={18} color={colors.muted2} />
              </Pressable>
            )}
          </View>
          {getCity(l) ? (
            <View style={mc.locRow}>
              <MapPin size={11} color={colors.muted} />
              <Text style={mc.loc} numberOfLines={1}>
                {p?.location ? `${String(p.location).split(',')[0]}, ` : ''}{getCity(l).split(',')[0]}
              </Text>
            </View>
          ) : null}

          {/* BHK + area + type badges */}
          <View style={mc.tagRow}>
            {bhk.length > 0 && (
              <View style={[mc.tag, { backgroundColor: colors.blueBg, borderColor: colors.blueBorder }]}>
                <Text style={[mc.tagText, { color: colors.blueText }]}>{bhk.join(', ')}</Text>
              </View>
            )}
            {area ? (
              <View style={[mc.tag, { backgroundColor: colors.slateBg, borderColor: colors.slateBorder }]}>
                <Text style={[mc.tagText, { color: colors.slateText }]}>{area}</Text>
              </View>
            ) : null}
            <View style={[mc.tag, { backgroundColor: colors.amberBg, borderColor: colors.amberBorder }]}>
              <Text style={[mc.tagText, { color: colors.amberText }]}>{propertyLabel(l)}</Text>
            </View>
          </View>

          {/* Price + per sqft */}
          <View style={mc.priceRow}>
            <Text style={mc.price}>{fmtPrice(price)}</Text>
            {perSqft ? <Text style={mc.perSqft}>{perSqft}</Text> : null}
          </View>

          {/* Live buyer match OR earn line */}
          {matchCount > 0 ? (
            <View style={mc.matchRow}>
              <View style={mc.matchDot} />
              <Text style={mc.matchText}>{matchCount} live {matchCount === 1 ? 'buyer matches' : 'buyers match'} this</Text>
            </View>
          ) : earnLine ? (
            <View style={mc.matchRow}>
              <Tag size={11} color={colors.greenText} />
              <Text style={[mc.matchText, { color: colors.greenText }]}>{earnLine}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Tags row: RERA / Gated / Loan / Status */}
      {(p?.reraApproved || p?.configuration?.gatedCommunity || p?.pricing?.bankLoanAvailable || showStatus) && (
        <View style={mc.chipsRow}>
          {p?.reraApproved && (
            <View style={[mc.chip, { backgroundColor: colors.greenBg, borderColor: colors.greenBorder }]}>
              <CheckCircle size={9} color={colors.greenText} />
              <Text style={[mc.chipText, { color: colors.greenText }]}>RERA</Text>
            </View>
          )}
          {p?.configuration?.gatedCommunity && (
            <View style={[mc.chip, { backgroundColor: colors.purpleBg, borderColor: colors.purpleBorder }]}>
              <Text style={[mc.chipText, { color: colors.purpleText }]}>Gated</Text>
            </View>
          )}
          {p?.pricing?.bankLoanAvailable && (
            <View style={[mc.chip, { backgroundColor: colors.greenBg, borderColor: colors.greenBorder }]}>
              <Text style={[mc.chipText, { color: colors.greenText }]}>Loan</Text>
            </View>
          )}
          {showStatus && (
            <View style={[mc.chip, { backgroundColor: colors.blueBg, borderColor: colors.blueBorder }]}>
              <Text style={[mc.chipText, { color: colors.blueText }]}>
                {status === 'ready-to-move' ? 'Ready' : 'Under Construction'}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Actions */}
      <View style={mc.actions}>
        <Pressable onPress={onView} style={mc.viewBtn}>
          <Eye size={13} color="#fff" />
          <Text style={mc.viewText}>View Project</Text>
        </Pressable>
        <Pressable onPress={onShare} style={mc.shareBtn}>
          <Share2 size={13} color={colors.brand} />
          <Text style={mc.shareText}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

const mc = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  top: { flexDirection: 'row', gap: 12 },
  imgWrap: { width: 104, height: 104, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  img: { width: 104, height: 104 },
  noImg: { backgroundColor: colors.slateBg, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, left: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  badgeText: { fontSize: 8, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  commBadge: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.brand, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  commBadgeText: { fontSize: 8, fontWeight: '800', color: '#fff' },
  content: { flex: 1, gap: 5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 14, fontWeight: '800', color: colors.ink, flex: 1 },
  kebab: { padding: 2, marginRight: -4, marginTop: -2 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  loc: { fontSize: 10.5, color: colors.muted2, fontWeight: '500', flex: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  tagText: { fontSize: 8, fontWeight: '800' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  price: { fontSize: 15, fontWeight: '800', color: colors.brand, letterSpacing: -0.3 },
  perSqft: { fontSize: 9, color: colors.muted, fontWeight: '700' },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  matchDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#3F6212' },
  matchText: { fontSize: 9.5, fontWeight: '800', color: '#3F6212' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  chipText: { fontSize: 8, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  viewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.night, paddingVertical: 9, borderRadius: 9 },
  viewText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#FFF8F0', borderWidth: 1, borderColor: `${colors.brand}33`, paddingVertical: 9, borderRadius: 9 },
  shareText: { color: colors.brand, fontSize: 10.5, fontWeight: '800' },
});
