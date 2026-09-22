// Full property detail screen — opened from the map (pin/card tap).
// Ported from homeintown_ai-mobile's PropertyDetailScreen, adapted to this
// app's theme, lucide icons, and expo-router. Receives the property as a
// serialized `data` param.
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, Pressable,
  Dimensions, Linking, FlatList, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { MapProperty } from '../../src/lib/mapProperties';
import { colors } from '../../src/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function formatPrice(value?: number): string {
  if (!value) return 'Price on Request';
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(0)} L`;
  return `₹${value.toLocaleString('en-IN')}`;
}

export default function PropertyDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ data?: string }>();

  let property: MapProperty | null = null;
  try { property = params.data ? (JSON.parse(params.data) as MapProperty) : null; } catch { property = null; }

  const [activeSlide, setActiveSlide] = useState(0);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const allImages = property ? [property.image, ...(property.galleryImages || [])].filter(Boolean) : [];

  useEffect(() => {
    if (allImages.length <= 1) return;
    const interval = setInterval(() => {
      const next = (activeSlide + 1) % allImages.length;
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
      setActiveSlide(next);
    }, 3000);
    return () => clearInterval(interval);
  }, [activeSlide, allImages.length]);

  if (!property) {
    return (
      <View style={[s.container, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: colors.muted2 }}>Property not found.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}><Text style={{ color: colors.brand, fontWeight: '700' }}>Go back</Text></Pressable>
      </View>
    );
  }

  const p = property;

  const getBreakdown = () => {
    if (!p.startingPrice) return null;
    const base = p.startingPrice;
    const isUC = p.projectStatus !== 'ready-to-move';
    const bd = p.priceBreakdown;
    const fmt = (n?: number) => (!n ? null : n >= 10000000 ? `₹${(n / 10000000).toFixed(2)} Cr` : `₹${(n / 100000).toFixed(1)} L`);
    if (bd && bd.totalPrice) {
      return {
        base: fmt(bd.basePrice || base) || formatPrice(base),
        gst: fmt(bd.gst), gstRate: `${bd.gstPercentage || 5}%`,
        stamp: fmt(bd.stampDuty), stampRate: `${bd.stampDutyPercentage || 5.5}%`,
        reg: fmt(bd.registration), regRate: `${bd.registrationPercentage || 1}%`,
        legalCharges: fmt(bd.legalCharges), maintenanceDeposit: fmt(bd.maintenanceDeposit),
        total: fmt(bd.totalPrice)!, isUC,
      };
    }
    const gst = isUC ? Math.round(base * 0.05) : 0;
    const stamp = Math.round(base * 0.055);
    const reg = Math.round(base * 0.01);
    return {
      base: formatPrice(base), gst: gst > 0 ? formatPrice(gst) : null, gstRate: isUC ? '5%' : '0%',
      stamp: formatPrice(stamp), stampRate: '~5.5%', reg: formatPrice(reg), regRate: '~1%',
      legalCharges: null as string | null, maintenanceDeposit: null as string | null,
      total: formatPrice(base + gst + stamp + reg), isUC,
    };
  };
  const breakdown = getBreakdown();

  const handleCall = () => { if (p.cta?.callNumber) Linking.openURL(`tel:${p.cta.callNumber}`); };
  const handleWhatsApp = () => { if (p.cta?.whatsappNumber) Linking.openURL(`https://wa.me/91${p.cta.whatsappNumber}`); };
  const handleBookVisit = () => {
    if (p.cta?.whatsappNumber) {
      const msg = encodeURIComponent(`Hi, I'm interested in ${p.property_name}. I'd like to book a site visit.`);
      Linking.openURL(`https://wa.me/91${p.cta.whatsappNumber}?text=${msg}`);
    }
  };

  const statusBadge = (() => {
    switch (p.projectStatus) {
      case 'ready-to-move': return { label: '✅ READY TO MOVE', bg: colors.greenBg, color: colors.greenText };
      case 'pre-launch': return { label: '🔔 PRE-LAUNCH', bg: colors.blueBg, color: colors.blueText };
      default: return { label: '🏗️ UNDER CONSTRUCTION', bg: colors.amberBg, color: colors.amberText };
    }
  })();

  return (
    <View style={s.container}>
      {/* Sticky header */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <View style={s.headerLeft}>
          <Pressable style={s.backBtn} onPress={() => router.back()}><ArrowLeft size={20} color={colors.ink} /></Pressable>
        </View>
        <View style={s.headerCta}>
          {p.cta?.callNumber && <Pressable style={s.headerCtaBtn} onPress={handleCall}><Text style={s.headerCtaBtnText}>📞 Call</Text></Pressable>}
          {p.cta?.whatsappNumber && <Pressable style={[s.headerCtaBtn, s.headerCtaOutline]} onPress={handleWhatsApp}><Text style={s.headerCtaOutlineText}>WhatsApp</Text></Pressable>}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Status */}
        {p.projectStatus && (
          <View style={s.badgeRow}>
            <View style={[s.statusBadge, { backgroundColor: statusBadge.bg }]}>
              <Text style={[s.statusBadgeText, { color: statusBadge.color }]}>{statusBadge.label}</Text>
            </View>
          </View>
        )}

        {/* Name */}
        <View style={s.nameSection}>
          <Text style={s.propertyName}>{p.property_name}</Text>
          {p.builder ? <Text style={s.builderName}>By {p.builder}</Text> : null}
        </View>

        {/* Location */}
        <View style={s.locationRow}>
          <Text style={s.locationIcon}>📍</Text>
          <Text style={s.locationText}>
            {p.location?.toUpperCase()}{p.city ? `, ${p.city.toUpperCase()}` : ''}
          </Text>
        </View>

        {p.bhkOptions && p.bhkOptions.length > 0 && (
          <Text style={s.bhkText}>{p.bhkOptions.join(' · ')}</Text>
        )}

        {/* Price */}
        <View style={s.priceSection}>
          <View>
            <Text style={s.priceLabel}>Price starting from</Text>
            <Text style={s.priceValue}>{formatPrice(p.startingPrice)}<Text style={s.priceOnwards}> onwards</Text></Text>
            {p.pricePerSqFt ? <Text style={s.priceSqft}>₹{p.pricePerSqFt.toLocaleString('en-IN')}/sq.ft</Text> : null}
          </View>
          {p.carpetAreaRange && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.areaValue}>{p.carpetAreaRange.split('-').pop()?.trim() || p.carpetAreaRange}</Text>
              <Text style={s.areaLabel}>SQFT CARPET</Text>
            </View>
          )}
        </View>

        {/* Breakdown toggle */}
        <Pressable style={s.breakdownToggle} onPress={() => setShowBreakdown(!showBreakdown)}>
          <Text style={s.breakdownToggleText}>{showBreakdown ? '▲' : '▼'} See price details</Text>
        </Pressable>
        {showBreakdown && breakdown && (
          <View style={s.breakdownCard}>
            <View style={s.bdRow}><Text style={s.bdLabel}>Base Price</Text><Text style={s.bdValue}>{breakdown.base}</Text></View>
            {breakdown.gst ? (
              <View style={s.bdRow}><Text style={s.bdLabel}>GST ({breakdown.gstRate})</Text><Text style={s.bdValue}>{breakdown.gst}</Text></View>
            ) : (
              <View style={s.bdRow}><Text style={s.bdLabel}>GST</Text><Text style={[s.bdValue, { color: colors.greenText }]}>Exempt ✓</Text></View>
            )}
            <View style={s.bdRow}><Text style={s.bdLabel}>Stamp Duty ({breakdown.stampRate})</Text><Text style={s.bdValue}>{breakdown.stamp}</Text></View>
            <View style={s.bdRow}><Text style={s.bdLabel}>Registration ({breakdown.regRate})</Text><Text style={s.bdValue}>{breakdown.reg}</Text></View>
            {breakdown.legalCharges && <View style={s.bdRow}><Text style={s.bdLabel}>Legal Charges</Text><Text style={s.bdValue}>{breakdown.legalCharges}</Text></View>}
            {breakdown.maintenanceDeposit && <View style={s.bdRow}><Text style={s.bdLabel}>Maintenance Deposit</Text><Text style={s.bdValue}>{breakdown.maintenanceDeposit}</Text></View>}
            <View style={[s.bdRow, s.bdTotal]}><Text style={s.bdTotalLabel}>Total (approx)</Text><Text style={s.bdTotalValue}>{breakdown.total}</Text></View>
            <Text style={s.bdDisclaimer}>* Approximate charges. Consult builder for exact costs.</Text>
          </View>
        )}

        {/* RERA */}
        {p.reraApproved && p.reraNumber && (
          <View style={s.reraBadge}><Text style={s.reraBadgeText}>✅ RERA: P{p.reraNumber}</Text></View>
        )}

        {/* Image carousel */}
        {allImages.length > 0 && (
          <View style={s.carousel}>
            <FlatList
              ref={flatListRef}
              data={allImages}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setActiveSlide(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
              onScrollToIndexFailed={() => {}}
              renderItem={({ item }) => <Image source={{ uri: item }} style={s.carouselImage} resizeMode="cover" />}
              keyExtractor={(_, i) => `img-${i}`}
            />
            <View style={s.imageCounter}><Text style={s.imageCounterText}>{activeSlide + 1}/{allImages.length}</Text></View>
            <View style={s.sitePhotoBadge}><Text style={s.sitePhotoBadgeText}>Actual Site Photo</Text></View>
            {allImages.length > 1 && (
              <View style={s.dotsRow}>{allImages.map((_, i) => <View key={`dot-${i}`} style={[s.dot, i === activeSlide && s.dotActive]} />)}</View>
            )}
          </View>
        )}

        {/* CTA row */}
        <View style={s.ctaRow}>
          {p.cta?.callNumber && <Pressable style={s.ctaBtn} onPress={handleCall}><Text style={s.ctaBtnText}>📞 Call</Text></Pressable>}
          {p.cta?.whatsappNumber && <Pressable style={[s.ctaBtn, s.ctaWhatsapp]} onPress={handleWhatsApp}><Text style={s.ctaWhatsappText}>💬 WhatsApp</Text></Pressable>}
          <Pressable style={[s.ctaBtn, s.ctaBook]} onPress={handleBookVisit}><Text style={s.ctaBookText}>{p.cta?.buttonText || 'Book Visit'}</Text></Pressable>
        </View>

        {/* Amenities */}
        {p.amenities.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Top Facilities</Text>
            <View style={s.amenitiesGrid}>
              {p.amenities.slice(0, 12).map((a, i) => (
                <View key={`am-${i}`} style={s.amenityChip}><Text style={s.amenityText}>{a}</Text></View>
              ))}
            </View>
          </View>
        )}

        {/* Config */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{p.type === 'plot' ? 'Plot Details' : 'Flat Details'}</Text>
          <View style={s.configGrid}>
            {p.bhkOptions && p.bhkOptions.length > 0 && <ConfigItem label="BHK Options" value={p.bhkOptions.join(', ')} />}
            {p.carpetAreaRange && <ConfigItem label="Carpet Area" value={p.carpetAreaRange} />}
            {p.floorRange && <ConfigItem label="Floors" value={p.floorRange} />}
            {p.plotSizeRange && <ConfigItem label="Plot Size" value={p.plotSizeRange} />}
            {p.facingOptions && p.facingOptions.length > 0 && <ConfigItem label="Facing" value={p.facingOptions.join(', ')} />}
            {p.gatedCommunity !== undefined && <ConfigItem label="Gated Community" value={p.gatedCommunity ? 'Yes ✓' : 'No'} />}
            {p.bankLoanAvailable !== undefined && <ConfigItem label="Bank Loan" value={p.bankLoanAvailable ? 'Available ✓' : 'N/A'} />}
          </View>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.configItem}>
      <Text style={s.configLabel}>{label}</Text>
      <Text style={s.configValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, paddingHorizontal: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  headerLogo: { flexDirection: 'row', alignItems: 'baseline' },
  headerLogoText: { fontSize: 13, fontWeight: '900', color: colors.greenText },
  headerLogoAi: { fontSize: 13, fontWeight: '900', color: colors.ink },
  headerCta: { flexDirection: 'row', gap: 8 },
  headerCtaBtn: { backgroundColor: colors.greenText, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  headerCtaBtnText: { fontSize: 11, fontWeight: '500', color: '#fff' },
  headerCtaOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.greenText },
  headerCtaOutlineText: { fontSize: 11, fontWeight: '500', color: colors.greenText },

  badgeRow: { paddingHorizontal: 20, paddingTop: 16 },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  statusBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  nameSection: { paddingHorizontal: 20, paddingTop: 12 },
  propertyName: { fontSize: 28, fontWeight: '900', color: colors.ink, textTransform: 'uppercase', lineHeight: 34 },
  builderName: { fontSize: 13, color: colors.muted2, marginTop: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 8, gap: 4 },
  locationIcon: { fontSize: 12, marginTop: 2 },
  locationText: { fontSize: 11, color: colors.muted2, textTransform: 'uppercase' },
  bhkText: { paddingHorizontal: 20, paddingTop: 12, fontSize: 13, fontWeight: '600', color: colors.ink },

  priceSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 16 },
  priceLabel: { fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  priceValue: { fontSize: 28, fontWeight: '900', color: colors.ink },
  priceOnwards: { fontSize: 13, fontWeight: '400', color: colors.muted2 },
  priceSqft: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  areaValue: { fontSize: 22, fontWeight: '700', color: colors.ink },
  areaLabel: { fontSize: 10, color: colors.muted, textTransform: 'uppercase' },

  breakdownToggle: { paddingHorizontal: 20, paddingTop: 12 },
  breakdownToggleText: { fontSize: 11, color: colors.blue },
  breakdownCard: { marginHorizontal: 20, marginTop: 8, backgroundColor: colors.cream, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.line },
  bdRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  bdLabel: { fontSize: 11, color: colors.muted2 },
  bdValue: { fontSize: 11, fontWeight: '600', color: colors.ink },
  bdTotal: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 4, paddingTop: 8 },
  bdTotalLabel: { fontSize: 11, fontWeight: '700', color: colors.ink },
  bdTotalValue: { fontSize: 11, fontWeight: '700', color: colors.greenText },
  bdDisclaimer: { fontSize: 9, color: colors.muted, marginTop: 8 },

  reraBadge: { alignSelf: 'flex-start', marginHorizontal: 20, marginTop: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.greenBg, borderWidth: 1, borderColor: colors.greenBorder, borderRadius: 6 },
  reraBadgeText: { fontSize: 11, color: colors.greenText, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  carousel: { position: 'relative', marginTop: 16, height: 220 },
  carouselImage: { width: SCREEN_WIDTH, height: 220 },
  imageCounter: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  imageCounterText: { fontSize: 10, color: '#fff' },
  sitePhotoBadge: { position: 'absolute', bottom: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  sitePhotoBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },
  dotsRow: { position: 'absolute', bottom: 12, right: 12, flexDirection: 'row', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: '#fff' },

  ctaRow: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 16, gap: 8 },
  ctaBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  ctaBtnText: { fontSize: 11, fontWeight: '500', color: colors.ink },
  ctaWhatsapp: { backgroundColor: colors.green, borderColor: colors.green },
  ctaWhatsappText: { fontSize: 11, fontWeight: '500', color: '#fff' },
  ctaBook: { backgroundColor: colors.red, borderColor: colors.red },
  ctaBookText: { fontSize: 11, fontWeight: '500', color: '#fff' },

  section: { paddingHorizontal: 20, paddingTop: 20 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  amenitiesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenityChip: { backgroundColor: colors.cream, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  amenityText: { fontSize: 11, color: colors.ink },
  configGrid: { backgroundColor: colors.cream, borderRadius: 12, padding: 16 },
  configItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.line },
  configLabel: { fontSize: 11, color: colors.muted },
  configValue: { fontSize: 13, fontWeight: '500', color: colors.ink },
});
