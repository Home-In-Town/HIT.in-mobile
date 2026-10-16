import React from 'react';
import { View, Text, Pressable, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Building2 } from 'lucide-react-native';
import { colors } from '../../theme';
import { fmtCooldownLeft } from '../../lib/groupChat/formatting';
import { propertyCardShared } from './sharedStyles';

// ─── Compact posted-property card (with expand toggle) ──────────────────────
// Marketplace-style property card for the Post view.
// - Draft (not yet posted): shows "Post to Group" (green) + "View Property".
// - Posted: shows a "LISTED" badge; "Post to Group" is faded/disabled during the
//   8h cooldown (shows remaining time), then re-enables.
function PostCard({ item, posted, cooldownLeftMs, posting, onPost, onView }: {
  item: { title?: string; subtitle?: string; price?: string; tags?: string[]; image?: string; fields?: Array<{ label: string; value: string }> };
  posted: boolean;
  cooldownLeftMs: number;
  posting: boolean;
  onPost: () => void;
  onView: () => void;
}) {
  const inCooldown = cooldownLeftMs > 0;
  const postDisabled = posting || inCooldown;
  return (
    <View style={pd.card}>
      <View style={pd.cardTop}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={pd.cardThumb} resizeMode="cover" />
        ) : (
          <View style={propertyCardShared.cardIcon}><Building2 size={22} color={colors.brand} /></View>
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[pd.badge, { backgroundColor: posted ? `${colors.greenText}18` : `${colors.brand}18` }]}>
              <Text style={[pd.badgeText, { color: posted ? colors.greenText : colors.brand }]}>{posted ? 'LISTED' : 'READY'}</Text>
            </View>
            <Text style={pd.cardTitle} numberOfLines={1}>{item.title || 'Property'}</Text>
          </View>
          {item.subtitle ? <Text style={pd.cardLoc} numberOfLines={1}>📍 {item.subtitle}</Text> : null}
        </View>
        {item.price ? <Text style={propertyCardShared.cardPrice}>{item.price}</Text> : null}
      </View>

      {/* Tags row (BHK / area / type) */}
      {item.tags && item.tags.length > 0 && (
        <View style={pd.tagsRow}>
          {item.tags.slice(0, 3).map((t, i) => (
            <View key={i} style={pd.tag}><Text style={pd.tagText} numberOfLines={1}>{t}</Text></View>
          ))}
        </View>
      )}

      {/* Actions: Post to Group + View Property */}
      <View style={pd.actionsRow}>
        <Pressable
          onPress={onPost}
          disabled={postDisabled}
          style={[pd.postBtn, postDisabled && pd.postBtnDim]}
        >
          {posting
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={pd.postBtnText}>{inCooldown ? `Posted · ${fmtCooldownLeft(cooldownLeftMs)}` : 'Post to Group 📢'}</Text>}
        </Pressable>
        <Pressable onPress={onView} style={pd.viewBtn}>
          <Text style={pd.viewBtnText}>View Property</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Kept named `pd` so the JSX body above is byte-identical to what it was inside
// GroupChatEmbedded.tsx. Each of these 16 keys was measured at exactly one
// reference, all of them in this component. cardIcon and cardPrice are NOT here:
// the parent's View Property detail sheet reads them too, so they live in
// sharedStyles.ts and are read through propertyCardShared above.
const pd = StyleSheet.create({
  card: { backgroundColor: colors.cream, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardThumb: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.line },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  cardLoc: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  // tags row (BHK / area / type)
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tagText: { fontSize: 10, fontWeight: '700', color: colors.muted2, maxWidth: 140 },
  // actions row (Post to Group + View Property)
  actionsRow: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  postBtn: { flex: 1, backgroundColor: colors.green, borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  postBtnDim: { opacity: 0.45 },
  postBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  viewBtn: { flex: 1, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}55`, borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  viewBtnText: { color: colors.brand, fontSize: 12.5, fontWeight: '800' },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.3 },
});

export default PostCard;
