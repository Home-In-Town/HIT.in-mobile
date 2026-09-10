import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, TextInput,
  RefreshControl, Modal, Image, FlatList, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ShoppingBag, Plus, Search, Tag, X,
  MapPin, Building2, Filter, Eye, Share2, CheckCircle, Sparkles,
} from 'lucide-react-native';
import { marketplaceApi, MarketplaceListing, projectsApi, projectsApiExtended, Project } from '../../src/lib/api';
import { useAuth } from '../../src/lib/authContext';
import { useToast } from '../../src/components/Toast';
import { SkeletonCard } from '../../src/components/Skeleton';
import EmptyState from '../../src/components/EmptyState';
import MenuButton from '../../src/components/MenuButton';
import { ShareModal } from '../../src/components/ShareActions';
import { colors } from '../../src/theme';

// Convert a marketplace listing's project into the Project shape ShareModal needs.
function listingToProject(l: MarketplaceListing): Project {
  const p = (l.project as any) || {};
  const ci = p?.media?.coverImage ?? p?.coverImage;
  return {
    id: String(p?.id || p?._id || ''),
    name: p?.projectName || p?.name || 'Project',
    type: p?.projectType || p?.type || 'flat',
    city: p?.city || '',
    location: p?.location || '',
    startingPrice: p?.pricing?.startingPrice ?? p?.startingPrice ?? 0,
    bhkOptions: p?.configuration?.bhkOptions ?? p?.bhkOptions ?? [],
    reraApproved: p?.reraApproved ?? false,
    projectStatus: p?.projectStatus || 'pre-launch',
    bankLoanAvailable: p?.pricing?.bankLoanAvailable ?? false,
    gatedCommunity: p?.configuration?.gatedCommunity ?? false,
    isPublished: true,
    slug: p?.slug,
    coverImage: ci ?? null,
    amenities: p?.amenities ?? [],
  } as Project;
}

/* ── helpers ── */
function fmtPrice(n: number): string {
  if (!n) return '—';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(0)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function coverUrl(listing: MarketplaceListing): string | null {
  const p = listing.project as any;
  if (!p) return null;
  const ci = p.media?.coverImage ?? p.coverImage;
  if (!ci) return null;
  return typeof ci === 'string' ? ci : ci.url ?? null;
}

function getCity(listing: MarketplaceListing): string {
  return (listing.project as any)?.city || '';
}

function getProjectName(listing: MarketplaceListing): string {
  return (listing.project as any)?.projectName || (listing.project as any)?.name || 'Project';
}

function getBhk(listing: MarketplaceListing): string[] {
  return (listing.project as any)?.configuration?.bhkOptions ?? (listing.project as any)?.bhkOptions ?? [];
}

function getProject(listing: MarketplaceListing): any {
  return (listing.project as any) || {};
}

function getPrice(listing: MarketplaceListing): number {
  const p = getProject(listing);
  return p?.pricing?.startingPrice ?? p?.startingPrice ?? (listing as any)?.expectedValue ?? 0;
}

function getArea(listing: MarketplaceListing): string {
  const p = getProject(listing);
  return p?.configuration?.carpetAreaRange ?? p?.configuration?.plotSizeRange ??
    p?.carpetAreaRange ?? p?.plotSizeRange ?? '';
}

// Human-readable property label (mirrors web getPropertyLabel)
function propertyLabel(listing: MarketplaceListing): string {
  const p = getProject(listing);
  if (p?.propertyType) return p.propertyType;
  if (p?.category) return p.category;
  if (p?.projectType === 'plot' || p?.type === 'plot') return 'Plot';
  return 'Apartment';
}

function getProjectId(listing: MarketplaceListing): string {
  const p = getProject(listing);
  return String(p?._id || p?.id || '');
}

function getSlug(listing: MarketplaceListing): string {
  return getProject(listing)?.slug || '';
}

// Derive price-per-sqft from starting price and the lower-bound of an area range.
function pricePerSqFt(listing: MarketplaceListing): string | null {
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

const STATUS_C: Record<string, { bg: string; text: string }> = {
  Active: { bg: colors.greenBg, text: colors.greenText },
  Paused: { bg: colors.amberBg, text: colors.amberText },
  Sold:   { bg: colors.blueBg,  text: colors.blueText },
  Closed: { bg: colors.slateBg, text: colors.slateText },
};

/* ── Listing Detail Sheet ── */
function ListingDetailSheet({ listing, onClose }: { listing: MarketplaceListing | null; onClose: () => void }) {
  if (!listing) return null;
  const cover = coverUrl(listing);
  const bhk = getBhk(listing);
  const sc = STATUS_C[listing.status] || STATUS_C.Active;
  const price = (listing.project as any)?.pricing?.startingPrice ?? 0;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.cream }}>
        {/* Cover image */}
        {cover ? (
          <Image source={{ uri: cover }} style={ds.cover} resizeMode="cover" />
        ) : (
          <View style={[ds.cover, ds.noImg]}>
            <Building2 size={40} color={colors.muted} />
          </View>
        )}

        {/* Close btn */}
        <Pressable onPress={onClose} style={ds.closeBtn}>
          <X size={18} color={colors.ink} />
        </Pressable>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
          {/* Header */}
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[ds.typeBadge, { backgroundColor: listing.listingType === 'selling' ? colors.greenBg : colors.blueBg }]}>
                <Text style={{ fontSize: 9, fontWeight: '800', color: listing.listingType === 'selling' ? colors.greenText : colors.blueText }}>
                  {listing.listingType.toUpperCase()}
                </Text>
              </View>
              <View style={[ds.statusBadge, { backgroundColor: sc.bg }]}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: sc.text }}>{listing.status}</Text>
              </View>
            </View>
            <Text style={ds.projectName}>{getProjectName(listing)}</Text>
            {getCity(listing) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MapPin size={13} color={colors.muted} />
                <Text style={ds.city}>{getCity(listing)}</Text>
              </View>
            ) : null}
          </View>

          {/* BHK chips */}
          {bhk.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {bhk.map(b => (
                <View key={b} style={ds.chip}>
                  <Text style={ds.chipText}>{b}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Price + commission */}
          <View style={ds.priceRow}>
            <View>
              <Text style={ds.priceLabel}>Starting Price</Text>
              <Text style={ds.priceVal}>{fmtPrice(price)}</Text>
            </View>
            <View style={ds.commBox}>
              <Tag size={14} color={colors.brand} />
              <View>
                <Text style={ds.commLabel}>Commission</Text>
                <Text style={ds.commVal}>
                  {listing.commissionValue}{listing.commissionType === 'percentage' ? '%' : ''} {listing.commissionType}
                </Text>
              </View>
            </View>
          </View>

          {/* Description */}
          {listing.description ? (
            <View style={ds.descCard}>
              <Text style={ds.descLabel}>Description</Text>
              <Text style={ds.descText}>{listing.description}</Text>
            </View>
          ) : null}

          {/* Listed by */}
          <View style={ds.listedByRow}>
            <View style={ds.listedByAvatar}>
              <Text style={ds.listedByAvatarText}>
                {(listing.listedBy?.name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View>
              <Text style={ds.listedByName}>{listing.listedBy?.name || '—'}</Text>
              <Text style={ds.listedByRole}>{listing.listedBy?.companyName || listing.listedBy?.role || ''}</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const ds = StyleSheet.create({
  cover: { width: '100%', height: 220 },
  noImg: { backgroundColor: colors.slateBg, alignItems: 'center', justifyContent: 'center' },
  closeBtn: {
    position: 'absolute', top: 12, right: 12,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  projectName: { fontSize: 21, fontWeight: '800', color: colors.ink },
  city: { fontSize: 12, color: colors.muted2 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.slateBg, borderWidth: 1, borderColor: colors.slateBorder },
  chipText: { fontSize: 11, fontWeight: '600', color: colors.slateText },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14 },
  priceLabel: { fontSize: 10, color: colors.muted, fontWeight: '600' },
  priceVal: { fontSize: 19, fontWeight: '800', color: colors.ink, marginTop: 2 },
  commBox: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commLabel: { fontSize: 10, color: colors.muted, fontWeight: '600' },
  commVal: { fontSize: 15, fontWeight: '800', color: colors.brand, marginTop: 2 },
  descCard: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 6 },
  descLabel: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  descText: { fontSize: 13, color: colors.ink, lineHeight: 20 },
  listedByRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12 },
  listedByAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  listedByAvatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  listedByName: { fontSize: 13, fontWeight: '700', color: colors.ink },
  listedByRole: { fontSize: 11, color: colors.muted2 },
});

/* ── Create Listing Modal ── */
function CreateModal({ onClose, onCreated, projects }: { onClose: () => void; onCreated: () => void; projects: { id: string; name: string }[] }) {
  const toast = useToast();
  const [form, setForm] = useState({ projectId: '', listingType: 'selling' as 'selling' | 'buying', commissionType: 'percentage' as 'percentage' | 'fixed', commissionValue: '', description: '' });
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!form.commissionValue) { toast.show('Commission required', 'error'); return; }
    setCreating(true);
    try {
      await marketplaceApi.createListing({ project: form.projectId || undefined, listingType: form.listingType, commissionType: form.commissionType, commissionValue: Number(form.commissionValue), description: form.description });
      toast.show('Listing created!', 'success');
      onCreated();
      onClose();
    } catch (e: any) { toast.show(e?.message || 'Failed', 'error'); }
    finally { setCreating(false); }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.cream }}>
        <View style={cm.header}>
          <Text style={cm.title}>New Listing</Text>
          <Pressable onPress={onClose}><X size={22} color={colors.ink} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          {/* Type toggle */}
          <View style={cm.section}>
            <Text style={cm.label}>Listing Type</Text>
            <View style={cm.toggleRow}>
              {(['selling', 'buying'] as const).map(t => (
                <Pressable key={t} onPress={() => setForm(f => ({ ...f, listingType: t }))}
                  style={[cm.toggleBtn, form.listingType === t && cm.toggleBtnActive]}>
                  <Text style={[cm.toggleText, form.listingType === t && cm.toggleTextActive]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Project picker */}
          {projects.length > 0 && (
            <View style={cm.section}>
              <Text style={cm.label}>Project (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                <Pressable onPress={() => setForm(f => ({ ...f, projectId: '' }))}
                  style={[cm.projChip, !form.projectId && cm.projChipActive]}>
                  <Text style={[cm.projChipText, !form.projectId && { color: colors.brand }]}>None</Text>
                </Pressable>
                {projects.map(p => (
                  <Pressable key={p.id} onPress={() => setForm(f => ({ ...f, projectId: p.id }))}
                    style={[cm.projChip, form.projectId === p.id && cm.projChipActive]}>
                    <Text style={[cm.projChipText, form.projectId === p.id && { color: colors.brand }]} numberOfLines={1}>{p.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Commission type */}
          <View style={cm.section}>
            <Text style={cm.label}>Commission Type</Text>
            <View style={cm.toggleRow}>
              {(['percentage', 'fixed'] as const).map(t => (
                <Pressable key={t} onPress={() => setForm(f => ({ ...f, commissionType: t }))}
                  style={[cm.toggleBtn, form.commissionType === t && cm.toggleBtnActive]}>
                  <Text style={[cm.toggleText, form.commissionType === t && cm.toggleTextActive]}>
                    {t === 'percentage' ? '% Percentage' : '₹ Fixed Amount'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Commission value */}
          <View style={cm.section}>
            <Text style={cm.label}>Commission Value *</Text>
            <TextInput value={form.commissionValue} onChangeText={v => setForm(f => ({ ...f, commissionValue: v }))}
              keyboardType="numeric" placeholder={form.commissionType === 'percentage' ? 'e.g. 2 (for 2%)' : 'Amount in ₹'}
              placeholderTextColor={colors.muted} style={cm.input} />
          </View>

          {/* Description */}
          <View style={cm.section}>
            <Text style={cm.label}>Description</Text>
            <TextInput value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))}
              multiline placeholder="Short description..." placeholderTextColor={colors.muted}
              style={[cm.input, { height: 80, textAlignVertical: 'top' }]} />
          </View>

          <Pressable onPress={handleCreate} disabled={creating} style={[cm.createBtn, creating && { opacity: 0.6 }]}>
            {creating ? <ActivityIndicator color="#fff" /> : <Text style={cm.createBtnText}>Create Listing</Text>}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const cm = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink },
  section: { gap: 8 },
  label: { fontSize: 12, fontWeight: '700', color: colors.ink },
  toggleRow: { flexDirection: 'row', gap: 10 },
  toggleBtn: { flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', backgroundColor: colors.white },
  toggleBtnActive: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  toggleText: { fontSize: 12, fontWeight: '600', color: colors.muted2 },
  toggleTextActive: { color: colors.brand },
  projChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, maxWidth: 140 },
  projChipActive: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  projChipText: { fontSize: 11, fontWeight: '600', color: colors.muted2 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, color: colors.ink, backgroundColor: colors.white },
  createBtn: { backgroundColor: colors.brand, paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});

/* ── Rich single-column listing card (matches website) ── */
function ListingCard({ l, matchCount, onView, onShare }: {
  l: MarketplaceListing; matchCount: number; onView: () => void; onShare: () => void;
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
          <Text style={mc.name} numberOfLines={1}>{getProjectName(l)}</Text>
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
  name: { fontSize: 14, fontWeight: '800', color: colors.ink },
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

/* ── Requirement row (SELL view — buyer wants) ── */
function RequirementRow({ l, onView }: { l: MarketplaceListing; onView: () => void }) {
  const price = getPrice(l);
  const commLabel = l.commissionValue
    ? (l.commissionType === 'percentage' ? `${l.commissionValue}%` : `₹${Number(l.commissionValue).toLocaleString('en-IN')}`)
    : null;
  return (
    <Pressable onPress={onView} style={rr.row}>
      <View style={rr.icon}><MessageSquareIcon /></View>
      <View style={{ flex: 1 }}>
        <Text style={rr.name} numberOfLines={1}>{getProjectName(l)}</Text>
        {l.description ? <Text style={rr.desc} numberOfLines={1}>{l.description.replace(/^TARGET LOCATION:\s*/, '')}</Text> : null}
        {l.listedBy?.name ? <Text style={rr.by}>by {l.listedBy.name}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        {price > 0 ? <Text style={rr.price}>{fmtPrice(price)}</Text> : null}
        {commLabel ? <View style={rr.comm}><Text style={rr.commText}>{commLabel}</Text></View> : null}
      </View>
    </Pressable>
  );
}

function MessageSquareIcon() {
  return <Tag size={18} color={colors.brand} />;
}

const rr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  desc: { fontSize: 10.5, color: colors.muted2, marginTop: 2 },
  by: { fontSize: 9.5, color: colors.muted, marginTop: 2, fontWeight: '600' },
  price: { fontSize: 14, fontWeight: '800', color: colors.brand },
  comm: { backgroundColor: colors.brand, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  commText: { fontSize: 9, fontWeight: '800', color: '#fff' },
});

/* ── Main Screen ── */
export default function MarketplaceScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<'browse' | 'mine' | 'admin'>('browse');
  const [view, setView] = useState<'All' | 'Buy' | 'Sell'>('All');
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [mine, setMine] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [shareProject, setShareProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});

  // Filters state
  const [cityFilter, setCityFilter] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');

  const canCreate = ['admin', 'builder', 'captain'].includes(user?.role ?? '');

  const load = useCallback(async () => {
    try {
      const [all, own, published] = await Promise.all([
        marketplaceApi.getListings(),
        marketplaceApi.getMyListings(),
        projectsApiExtended.getAllPublic().catch(() => []),
      ]);

      // Project ids already covered by a selling listing → don't duplicate as STD.
      const listedProjectIds = new Set(
        all.filter(l => l.listingType === 'selling')
          .map(l => String((l.project as any)?.id || (l.project as any)?._id || ''))
          .filter(Boolean)
      );

      // Turn each published (unlisted) project into a synthetic STD card so the
      // Browse tab shows all inventory — exactly like the website.
      const stdCards: MarketplaceListing[] = (published as any[])
        .filter(p => !listedProjectIds.has(String(p.id || p._id || '')))
        .map(p => ({
          id: `std_${p.id || p._id}`,
          isStd: true,
          project: {
            id: String(p.id || p._id || ''),
            projectName: p.name || p.projectName || 'Project',
            city: p.city,
            location: p.location,
            slug: p.slug,
            projectStatus: p.projectStatus,
            reraApproved: p.reraApproved,
            propertyType: p.propertyType,
            category: p.category,
            projectType: p.type,
            pricing: { startingPrice: p.startingPrice, bankLoanAvailable: p.bankLoanAvailable },
            configuration: {
              bhkOptions: p.bhkOptions,
              carpetAreaRange: p.carpetAreaRange,
              gatedCommunity: p.gatedCommunity,
            },
            media: { coverImage: typeof p.coverImage === 'string' ? { url: p.coverImage } : p.coverImage },
          },
          listedBy: { id: '', name: p?.owner?.name || '', companyName: p?.owner?.companyName, role: p?.owner?.role || '' },
          listingType: 'selling',
          commissionType: 'percentage',
          commissionValue: 0,
          description: '',
          status: 'Active',
        } as any));

      // Real listings first, then STD projects.
      setListings([...all, ...stdCards]);
      setMine(own);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to load', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (showCreate) {
      projectsApi.getAllPublic().then(ps => {
        setProjects((ps as any[]).map((p: any) => ({ id: p.id || p._id || '', name: p.name || '' })));
      }).catch(() => {});
    }
  }, [showCreate]);

  const source = tab === 'browse' ? listings : tab === 'admin' ? listings : mine;

  const filtered = source.filter(l => {
    const matchSearch = !search || getProjectName(l).toLowerCase().includes(search.toLowerCase()) || getCity(l).toLowerCase().includes(search.toLowerCase());
    // ALL = selling/standard listings; BUY = selling; SELL = buying requirements
    const matchView =
      view === 'All' ? l.listingType !== 'buying' :
      view === 'Buy' ? l.listingType === 'selling' :
      l.listingType === 'buying';
    const matchCity = !cityFilter || getCity(l).toLowerCase().includes(cityFilter.toLowerCase());
    const price = getPrice(l);
    const matchBudgetMin = !budgetMin || price >= Number(budgetMin) * 100000;
    const matchBudgetMax = !budgetMax || price <= Number(budgetMax) * 100000;
    return matchSearch && matchView && matchCity && matchBudgetMin && matchBudgetMax;
  });

  const activeFilterCount = [cityFilter, budgetMin, budgetMax].filter(Boolean).length;

  // Fetch "N live buyers match" counts for the visible project listings.
  useEffect(() => {
    const ids = Array.from(new Set(
      filtered.map(l => getProjectId(l)).filter(Boolean)
    ));
    if (ids.length === 0) return;
    let cancelled = false;
    projectsApiExtended.matchCounts(ids)
      .then(counts => { if (!cancelled) setMatchCounts(prev => ({ ...prev, ...counts })); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, mine, tab, view]);

  // Open the full share sheet (Copy link, QR, brochure/PDF) for a listing's project.
  const shareListing = (l: MarketplaceListing) => setShareProject(listingToProject(l));

  return (
    <View style={[m.root, { paddingTop: embedded ? 0 : insets.top }]}>
      {/* Top bar — hidden when embedded (Overview provides the navbar).
          When embedded we still show a small create action row. */}
      {embedded ? (
        canCreate ? (
          <View style={m.embedActionRow}>
            <Pressable onPress={() => setShowCreate(true)} style={m.createBtn}>
              <Plus size={14} color="#fff" />
              <Text style={m.createBtnText}>+ List</Text>
            </Pressable>
          </View>
        ) : null
      ) : (
        <View style={m.topBar}>
          <MenuButton />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={m.title}>Marketplace</Text>
            <Text style={m.subtitle}>Browse verified listings and opportunities</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>
      )}

      {/* Website-style tab row: Browse | My Listings | Admin + Create Listing button (only when NOT embedded, since embedded already shows the List button above) */}
      <View style={m.tabsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={m.tabsScroll}>
          {(['browse', 'mine', ...(canCreate ? ['admin'] : [])] as const).map(t => (
            <Pressable key={t} onPress={() => setTab(t as any)} style={[m.tabBtn, tab === t && m.tabBtnActive]}>
              <Text style={[m.tabText, tab === t && m.tabTextActive]}>
                {t === 'browse' ? 'Browse' : t === 'mine' ? 'My Listings' : 'Admin'}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {canCreate && !embedded && (
          <Pressable onPress={() => setShowCreate(true)} style={m.createBtn}>
            <Plus size={14} color="#fff" />
            <Text style={m.createBtnText}>+ List</Text>
          </Pressable>
        )}
      </View>

      {/* Listing list — segment + search scroll WITH the cards (ListHeaderComponent) */}
      {loading ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
        </ScrollView>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={l => l.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ paddingTop: 10, gap: 10 }}>
              {/* ALL / BUY / SELL segmented view — website style */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 0 }}>
                <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 3 }}>
                  {(['All', 'Buy', 'Sell'] as const).map(v => (
                    <Pressable key={v} onPress={() => setView(v)} style={[{ flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' as const }, view === v && { backgroundColor: colors.brandTint }]}>
                      <Text style={[{ fontSize: 10, fontWeight: '800' as const, color: colors.muted, letterSpacing: 1 }, view === v && { color: colors.brand }]}>{v.toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={() => setShowFilters(f => !f)}
                  style={[{ padding: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, position: 'relative' as const }, activeFilterCount > 0 && { borderColor: colors.brand, backgroundColor: colors.brandTint }]}>
                  <Filter size={15} color={activeFilterCount > 0 ? colors.brand : colors.muted2} />
                  {activeFilterCount > 0 && (
                    <View style={m.filterBadge}><Text style={m.filterBadgeText}>{activeFilterCount}</Text></View>
                  )}
                </Pressable>
              </View>

              {/* Search */}
              <View style={m.searchRow}>
                <Search size={15} color={colors.muted} />
                <TextInput value={search} onChangeText={setSearch} placeholder="Search by name, locality..."
                  placeholderTextColor={colors.muted} style={m.searchInput} />
                {search ? <Pressable onPress={() => setSearch('')}><X size={15} color={colors.muted} /></Pressable> : null}
              </View>

              {/* Expandable advanced filters */}
              {showFilters && (
                <View style={m.filtersBox}>
                  <View style={m.filterRow}>
                    <View style={m.filterField}>
                      <Text style={m.filterLabel}>City</Text>
                      <TextInput value={cityFilter} onChangeText={setCityFilter} placeholder="e.g. Pune"
                        placeholderTextColor={colors.muted} style={m.filterInput} />
                    </View>
                    <View style={m.filterField}>
                      <Text style={m.filterLabel}>Min (L)</Text>
                      <TextInput value={budgetMin} onChangeText={setBudgetMin} placeholder="30"
                        keyboardType="numeric" placeholderTextColor={colors.muted} style={m.filterInput} />
                    </View>
                    <View style={m.filterField}>
                      <Text style={m.filterLabel}>Max (L)</Text>
                      <TextInput value={budgetMax} onChangeText={setBudgetMax} placeholder="200"
                        keyboardType="numeric" placeholderTextColor={colors.muted} style={m.filterInput} />
                    </View>
                  </View>
                  {activeFilterCount > 0 && (
                    <Pressable onPress={() => { setCityFilter(''); setBudgetMin(''); setBudgetMax(''); }} style={m.clearBtn}>
                      <Text style={m.clearBtnText}>Clear filters</Text>
                    </Pressable>
                  )}
                </View>
              )}

              <Text style={{ fontSize: 10.5, color: colors.muted2, fontWeight: '500', marginBottom: 4 }}>
                {view === 'Sell' ? 'Live buyer requirements you can fulfil.' : 'Discover all prime real estate projects in your region.'}
              </Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          ListEmptyComponent={
            <EmptyState
              icon={<ShoppingBag size={28} color={colors.muted} />}
              title="No listings found"
              subtitle="Try changing filters or create a new listing."
              actionLabel={canCreate ? 'Create Listing' : undefined}
              onAction={canCreate ? () => setShowCreate(true) : undefined}
            />
          }
          renderItem={({ item: l }) =>
            view === 'Sell' ? (
              <RequirementRow l={l} onView={() => setSelectedListing(l)} />
            ) : (
              <ListingCard
                l={l}
                matchCount={matchCounts[getProjectId(l)] || 0}
                onView={() => setSelectedListing(l)}
                onShare={() => shareListing(l)}
              />
            )
          }
        />
      )}

      {/* Listing detail */}
      {selectedListing && (
        <ListingDetailSheet listing={selectedListing} onClose={() => setSelectedListing(null)} />
      )}

      {/* Create listing */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={load}
          projects={projects}
        />
      )}

      {/* Share sheet (Copy link, QR, brochure/PDF) */}
      {shareProject && (
        <ShareModal project={shareProject} onClose={() => setShareProject(null)} />
      )}
    </View>
  );
}

const m = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  embedActionRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 21, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 9.5, color: colors.muted, fontWeight: '600', marginTop: 1 },
  // Website-style tab row
  tabsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line, paddingRight: 12 },
  tabsScroll: { gap: 0, paddingLeft: 4 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.white },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 11, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: colors.brand },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.muted2 },
  tabTextActive: { color: colors.brand, fontWeight: '800' },
  // Create Listing CTA button (website style orange)
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 11.5 },
  filterBadge: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { fontSize: 8, fontWeight: '800', color: '#fff' },
  searchWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 13, color: colors.ink },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  pillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  pillText: { fontSize: 11, fontWeight: '600', color: colors.muted2 },
  pillTextActive: { color: '#fff' },
  filtersBox: { backgroundColor: colors.white, marginHorizontal: 16, marginBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterField: { flex: 1, gap: 4 },
  filterLabel: { fontSize: 10, fontWeight: '700', color: colors.muted2 },
  filterInput: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12, color: colors.ink, backgroundColor: colors.cream },
  clearBtn: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.slateBg },
  clearBtnText: { fontSize: 11, fontWeight: '600', color: colors.slateText },
  // Cards (2-column grid)
  card: { flex: 1, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardImg: { width: '100%', height: 110 },
  noImg: { backgroundColor: colors.slateBg, alignItems: 'center', justifyContent: 'center' },
  typeBadgeOverlay: { position: 'absolute', top: 8, left: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  cardBody: { padding: 10, gap: 4 },
  cardName: { fontSize: 12, fontWeight: '700', color: colors.ink },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  cityText: { fontSize: 10, color: colors.muted2 },
  bhkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  bhkChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.slateBg },
  bhkText: { fontSize: 9, fontWeight: '600', color: colors.slateText },
  price: { fontSize: 12, fontWeight: '800', color: colors.brand },
  commRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  commText: { fontSize: 10, fontWeight: '700', color: colors.brand, flex: 1 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusTxt: { fontSize: 9, fontWeight: '700' },
});
