// Full project details popup — opens from the Projects list (grid + list views).
// Shows cover, gallery, pricing, configuration, amenities, RERA and status.

import React from 'react';
import {
  Modal, View, Text, ScrollView, Pressable, Image, StyleSheet, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X, MapPin, IndianRupee, BedDouble, Ruler, CheckCircle,
  Building2, Layers, Compass, Landmark,
} from 'lucide-react-native';
import { Project } from '../lib/api';
import { colors } from '../theme';

const { width: SCREEN_W } = Dimensions.get('window');

function fmtPrice(n?: number): string {
  if (!n) return 'POA';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function coverOf(p: Project): string | null {
  if (!p.coverImage) return null;
  return typeof p.coverImage === 'string' ? p.coverImage : (p.coverImage as any).url ?? null;
}

function urlOf(m: any): string | null {
  if (!m) return null;
  return typeof m === 'string' ? m : m.url ?? null;
}

function statusLabel(s: string): string {
  if (s === 'ready-to-move' || s === 'ready') return 'Ready to Move';
  if (s === 'under-construction') return 'Under Construction';
  if (s === 'pre-launch') return 'Pre Launch';
  return s;
}

function propertyLabel(p: Project): string {
  if (p.propertyType) return p.propertyType;
  if (p.category) return p.category;
  if (p.type === 'plot') return 'Plot';
  return 'Apartment';
}

export default function ProjectDetailsModal({ project, onClose }: {
  project: Project | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!project) return null;

  const cover = coverOf(project);
  const gallery = (project.galleryImages || []).map(urlOf).filter(Boolean) as string[];

  return (
    <Modal visible={!!project} animationType="slide" transparent onRequestClose={onClose}>
      <View style={m.overlay}>
        <Pressable style={m.backdropTouch} onPress={onClose} />
        <View style={m.sheet}>
          {/* Grabber + close */}
          <View style={m.topBar}>
            <View style={m.grabber} />
            <Pressable onPress={onClose} hitSlop={10} style={m.closeBtn}>
              <X size={20} color={colors.ink} />
            </Pressable>
          </View>

          <ScrollView
            style={m.scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          >
            {/* Cover */}
            {cover ? (
              <Image source={{ uri: cover }} style={m.cover} resizeMode="cover" />
            ) : (
              <View style={[m.cover, m.noCover]}><Building2 size={36} color={colors.muted} /></View>
            )}

            <View style={m.pad}>
              {/* Title + location */}
              <Text style={m.name}>{project.name}</Text>
              <View style={m.locRow}>
                <MapPin size={14} color={colors.brand} />
                <Text style={m.loc}>{project.location ? `${project.location}, ` : ''}{project.city}</Text>
              </View>

              {/* Badges */}
              <View style={m.badgeRow}>
                <View style={[m.badge, project.isPublished ? m.badgeLive : m.badgeDraft]}>
                  <Text style={[m.badgeText, { color: project.isPublished ? colors.greenText : colors.muted2 }]}>
                    {project.isPublished ? 'Published' : 'Draft'}
                  </Text>
                </View>
                <View style={[m.badge, m.badgeNeutral]}>
                  <Text style={[m.badgeText, { color: colors.blueText }]}>{statusLabel(project.projectStatus)}</Text>
                </View>
                {project.reraApproved && (
                  <View style={[m.badge, m.badgeRera]}>
                    <CheckCircle size={11} color={colors.brand} />
                    <Text style={[m.badgeText, { color: colors.brand }]}>RERA</Text>
                  </View>
                )}
              </View>

              {/* Price highlight */}
              <View style={m.priceCard}>
                <IndianRupee size={18} color={colors.brand} />
                <View>
                  <Text style={m.priceLabel}>Starting Price</Text>
                  <Text style={m.priceValue}>{fmtPrice(project.startingPrice)}</Text>
                </View>
                {project.pricePerSqFt ? (
                  <View style={m.pricePerSqft}>
                    <Text style={m.priceLabel}>Per sq ft</Text>
                    <Text style={m.priceValueSmall}>₹{project.pricePerSqFt.toLocaleString('en-IN')}</Text>
                  </View>
                ) : null}
              </View>

              {/* Key details grid */}
              <Text style={m.sectionTitle}>Overview</Text>
              <View style={m.grid}>
                <Detail icon={<Building2 size={15} color={colors.brand} />} label="Property Type" value={propertyLabel(project)} />
                <Detail icon={<Layers size={15} color={colors.brand} />} label="Status" value={statusLabel(project.projectStatus)} />
                {project.bhkOptions?.length ? (
                  <Detail icon={<BedDouble size={15} color={colors.brand} />} label="Configuration" value={project.bhkOptions.join(', ')} />
                ) : null}
                {project.carpetAreaRange ? (
                  <Detail icon={<Ruler size={15} color={colors.brand} />} label="Carpet Area" value={project.carpetAreaRange} />
                ) : null}
                {project.gatedCommunity ? (
                  <Detail icon={<Compass size={15} color={colors.brand} />} label="Community" value="Gated Community" />
                ) : null}
                {project.reraNumber ? (
                  <Detail icon={<Landmark size={15} color={colors.brand} />} label="RERA No." value={project.reraNumber} />
                ) : null}
                <Detail icon={<IndianRupee size={15} color={colors.brand} />} label="Bank Loan" value={project.bankLoanAvailable ? 'Available' : 'Not available'} />
              </View>

              {/* Amenities */}
              {project.amenities?.length ? (
                <>
                  <Text style={m.sectionTitle}>Amenities</Text>
                  <View style={m.chipsWrap}>
                    {project.amenities.map((a) => (
                      <View key={a} style={m.amenityChip}>
                        <Text style={m.amenityText}>{a}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {/* Gallery */}
              {gallery.length ? (
                <>
                  <Text style={m.sectionTitle}>Gallery</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                    {gallery.map((g, i) => (
                      <Image key={i} source={{ uri: g }} style={m.galleryImg} resizeMode="cover" />
                    ))}
                  </ScrollView>
                </>
              ) : null}

              {/* Owner */}
              {project.owner?.name ? (
                <>
                  <Text style={m.sectionTitle}>Listed By</Text>
                  <View style={m.ownerRow}>
                    <View style={m.ownerAvatar}><Text style={m.ownerInitial}>{project.owner.name.charAt(0).toUpperCase()}</Text></View>
                    <View>
                      <Text style={m.ownerName}>{project.owner.name}</Text>
                      <Text style={m.ownerRole}>{project.owner.companyName || project.owner.role}</Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={m.detailBox}>
      <View style={m.detailHead}>{icon}<Text style={m.detailLabel}>{label}</Text></View>
      <Text style={m.detailValue}>{value}</Text>
    </View>
  );
}

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '90%', overflow: 'hidden' },
  scroll: { flex: 1 },
  topBar: { paddingTop: 10, paddingBottom: 4, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line },
  closeBtn: { position: 'absolute', right: 14, top: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  cover: { width: '100%', height: 200 },
  noCover: { backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  pad: { padding: 18 },
  name: { fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  loc: { fontSize: 13, color: colors.muted2, fontWeight: '600' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  badgeLive: { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
  badgeDraft: { backgroundColor: colors.cream, borderColor: colors.line },
  badgeNeutral: { backgroundColor: colors.blueBg, borderColor: colors.blueBorder },
  badgeRera: { backgroundColor: colors.brandTint, borderColor: `${colors.brand}33` },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },
  priceCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 14, marginTop: 16 },
  priceLabel: { fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 0.5, textTransform: 'uppercase' },
  priceValue: { fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  priceValueSmall: { fontSize: 15, fontWeight: '800', color: colors.ink },
  pricePerSqft: { marginLeft: 'auto', alignItems: 'flex-end' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 22, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detailBox: { width: (SCREEN_W - 18 * 2 - 10) / 2, backgroundColor: colors.cream, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 12 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  detailLabel: { fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 0.5, textTransform: 'uppercase' },
  detailValue: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenityChip: { backgroundColor: colors.brandTint, borderWidth: 1, borderColor: `${colors.brand}22`, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  amenityText: { fontSize: 12, fontWeight: '700', color: colors.brand },
  galleryImg: { width: 160, height: 110, borderRadius: 12, backgroundColor: colors.cream },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ownerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ownerInitial: { color: '#fff', fontSize: 18, fontWeight: '800' },
  ownerName: { fontSize: 15, fontWeight: '800', color: colors.ink },
  ownerRole: { fontSize: 12, color: colors.muted2, fontWeight: '600', marginTop: 1, textTransform: 'capitalize' },
});
