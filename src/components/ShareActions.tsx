// ShareActions — bottom sheet with share link, QR code, and open brochure.
// QR is rendered inline with react-native-qrcode-svg (pure JS, no native module).

import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet,
  ActivityIndicator, Linking, Share, ScrollView,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { X, Link2, QrCode, FileText, Download, ExternalLink } from 'lucide-react-native';
import { shareApi, Project } from '../lib/api';
import { useToast } from './Toast';
import { colors } from '../theme';

interface Props {
  project: Project | null;
  onClose: () => void;
}

function getVisitUrl(project: Project): string {
  if (project.slug) return `https://homeintown.in/visit/${project.slug}`;
  return `https://homeintown.in`;
}

export default function ShareActions({ project, onClose }: Props) {
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [openingBrochure, setOpeningBrochure] = useState(false);
  const [showQr, setShowQr] = useState(false);

  // Resolve shareable URL on mount
  useEffect(() => {
    if (!project) return;
    const base = getVisitUrl(project);

    // Try generating a tracked token; fall back to plain URL
    shareApi.generateToken(project.id, 'link')
      .then(res => setUrl(res.shareUrl || base))
      .catch(() => setUrl(base))
      .finally(() => setLoadingUrl(false));
  }, [project?.id]);

  if (!project) return null;

  const handleShare = async () => {
    if (!url) return;
    setSharing(true);
    try {
      await Share.share({
        message: `Check out ${project.name} on HomeInTown — ${url}`,
        url,
        title: project.name,
      });
    } catch (e: any) {
      if (e?.message !== 'The user did not share') {
        toast.show(e?.message || 'Failed to share', 'error');
      }
    } finally {
      setSharing(false);
    }
  };

  const handleBrochure = async () => {
    if (openingBrochure) return;
    setOpeningBrochure(true);
    try {
      let brochureUrl: string | null = null;

      // 1. Try project's brochure field
      if (project.brochureUrl) {
        brochureUrl = typeof project.brochureUrl === 'string'
          ? project.brochureUrl
          : (project.brochureUrl as any).url ?? null;
      }

      // 2. Generate a PDF share token as fallback
      if (!brochureUrl) {
        const res = await shareApi.generateToken(project.id, 'pdf');
        brochureUrl = res.shareUrl || null;
      }

      if (brochureUrl) {
        await Linking.openURL(brochureUrl);
        toast.show('Opening brochure…', 'success');
      } else {
        toast.show('No brochure available for this project', 'error');
      }
      onClose();
    } catch (e: any) {
      toast.show(e?.message || 'Failed to open brochure', 'error');
    } finally {
      setOpeningBrochure(false);
    }
  };

  return (
    <View style={s.sheet}>
      <View style={s.handle} />

      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Share</Text>
          <Text style={s.subtitle} numberOfLines={1}>{project.name}</Text>
        </View>
        <Pressable onPress={onClose} style={s.closeBtn}>
          <X size={17} color={colors.ink} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>

        {/* ── QR Code Section ── */}
        <View style={s.qrSection}>
          <Pressable
            onPress={() => setShowQr(v => !v)}
            style={s.qrToggle}
          >
            <QrCode size={18} color={colors.brand} />
            <Text style={s.qrToggleText}>
              {showQr ? 'Hide QR Code' : 'Show QR Code'}
            </Text>
            <Text style={s.qrToggleChevron}>{showQr ? '▲' : '▼'}</Text>
          </Pressable>

          {showQr && (
            <View style={s.qrBox}>
              {loadingUrl ? (
                <View style={s.qrLoading}>
                  <ActivityIndicator color={colors.brand} />
                  <Text style={s.qrLoadingText}>Generating link…</Text>
                </View>
              ) : url ? (
                <View style={s.qrContent}>
                  {/* QR code */}
                  <View style={s.qrCodeWrap}>
                    <QRCode
                      value={url}
                      size={180}
                      color={colors.night}
                      backgroundColor={colors.white}
                      logo={undefined}
                      logoSize={36}
                      logoBackgroundColor={colors.white}
                      quietZone={8}
                    />
                  </View>

                  {/* URL text */}
                  <Text style={s.qrUrl} numberOfLines={2}>{url}</Text>

                  {/* Open in browser */}
                  <Pressable
                    onPress={() => Linking.openURL(url!)}
                    style={s.openLinkBtn}
                  >
                    <ExternalLink size={13} color={colors.brand} />
                    <Text style={s.openLinkText}>Open in browser</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', paddingVertical: 12 }}>
                  Could not generate QR
                </Text>
              )}
            </View>
          )}
        </View>

        {/* ── Action rows ── */}
        <View style={s.actions}>
          {/* Share Link */}
          <Pressable
            onPress={handleShare}
            disabled={!url || sharing}
            style={[s.actionRow, (!url || sharing) && { opacity: 0.5 }]}
          >
            <View style={[s.actionIcon, { backgroundColor: `${colors.brand}15` }]}>
              {sharing
                ? <ActivityIndicator size="small" color={colors.brand} />
                : <Link2 size={20} color={colors.brand} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.actionLabel}>Share Link</Text>
              <Text style={s.actionSub}>Send via WhatsApp, email or any app</Text>
            </View>
          </Pressable>

          {/* Brochure */}
          <Pressable
            onPress={handleBrochure}
            disabled={openingBrochure}
            style={[s.actionRow, { borderBottomWidth: 0 }, openingBrochure && { opacity: 0.5 }]}
          >
            <View style={[s.actionIcon, { backgroundColor: '#FEF2F2' }]}>
              {openingBrochure
                ? <ActivityIndicator size="small" color={colors.red} />
                : <FileText size={20} color={colors.red} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.actionLabel}>Open Brochure</Text>
              <Text style={s.actionSub}>View or download PDF brochure</Text>
            </View>
          </Pressable>
        </View>

      </ScrollView>
    </View>
  );
}

// ── Modal wrapper ──────────────────────────────────────────
export function ShareModal({ project, onClose }: Props) {
  return (
    <Modal
      visible={!!project}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.container}>
        <ShareActions project={project} onClose={onClose} />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  // Modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  container: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14, shadowRadius: 16, elevation: 24,
    maxHeight: '85%',
  },

  // Sheet
  sheet: { paddingBottom: 12 },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.line,
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  title: { fontSize: 16, fontWeight: '800', color: colors.ink },
  subtitle: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  closeBtn: {
    padding: 7, borderRadius: 8, backgroundColor: colors.slateBg,
  },

  // QR section
  qrSection: {
    marginHorizontal: 16, marginTop: 14,
    borderRadius: 16, borderWidth: 1, borderColor: colors.line,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  qrToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14,
    backgroundColor: colors.white,
  },
  qrToggleText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.ink },
  qrToggleChevron: { fontSize: 10, color: colors.muted },
  qrBox: {
    borderTopWidth: 1, borderTopColor: colors.line,
    backgroundColor: colors.cream,
  },
  qrLoading: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 8 },
  qrLoadingText: { fontSize: 11, color: colors.muted },
  qrContent: { alignItems: 'center', paddingVertical: 20, gap: 12 },
  qrCodeWrap: {
    padding: 14, borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.line,
    shadowColor: colors.brand,
    shadowOpacity: 0.06, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  qrUrl: {
    fontSize: 10, color: colors.muted2,
    textAlign: 'center', paddingHorizontal: 24,
    lineHeight: 16,
  },
  openLinkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.brandTint,
    borderWidth: 1, borderColor: colors.brand,
  },
  openLinkText: { fontSize: 11, fontWeight: '700', color: colors.brand },

  // Actions
  actions: { paddingHorizontal: 16, paddingTop: 14 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  actionIcon: {
    width: 44, height: 44, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  actionSub: { fontSize: 11, color: colors.muted2, marginTop: 2 },
});
