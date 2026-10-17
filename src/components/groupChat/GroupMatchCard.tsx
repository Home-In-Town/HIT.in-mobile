import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme';
import { fmtPrice } from '../../lib/groupChat/formatting';
import { matchReason } from '../../lib/groupChat/messages';
import { activityLabel } from '../../lib/groupChat/rooms';
import type { MatchGroupInfo } from '../../lib/groupChat/rooms';
import CardActions from './CardActions';

// ── Group match card ──
// Shown for every matching result. A match advertises the property's GROUP, not
// just the property, because the point of a match is to get the user into the
// room where that inventory is discussed. The previous version was a plain
// property row with an Interested button, which gave no reason for the match and
// no way in.
//
// "N Flats available" from the agreed spec is deliberately absent: there is no
// unit-count field on Project yet, so the line shows the starting price only
// rather than inventing a number.
const GroupMatchCard = React.memo(function GroupMatchCard({
  match, requirement, messageId, onJoin, onPreview, onInterested,
}: {
  match: any;
  requirement: any;
  messageId: string;
  onJoin: (projectId: string) => void;
  onPreview: (match: any) => void;
  onInterested: (projectId: string, messageId: string) => void;
}) {
  const project = match?.project || {};
  const projectId = String(project._id || project.id || '');
  const group: MatchGroupInfo | null = match?.group || null;

  const score = Math.round(Number(match?.score) || 0);
  const scoreColor = score >= 75 ? colors.greenText : score >= 50 ? colors.brand : colors.muted2;

  // Fall back to the project name when the property has no group yet, so the
  // card still reads sensibly instead of showing an empty title.
  const title = group?.name || `${project.projectName || 'Property'} Group`;
  const where = [project.location, project.city].filter(Boolean).join(', ');

  const metaParts = [
    where,
    group?.membersCount ? `${group.membersCount} Members` : '',
    activityLabel(group?.lastActivity),
  ].filter(Boolean);

  const builderName = project.owner?.name || project.owner?.companyName || '';
  const startingPrice = project.pricing?.startingPrice
    ? `from ${fmtPrice(project.pricing.startingPrice)}`
    : '';
  const builderParts = [
    builderName ? `Builder: ${builderName}` : '',
    startingPrice,
  ].filter(Boolean);

  const reason = matchReason(requirement);

  return (
    <View style={mbs.matchCard}>
      <View style={mbs.matchCardHead}>
        <View style={[mbs.matchScorePill, { backgroundColor: `${scoreColor}1A`, borderColor: `${scoreColor}55` }]}>
          <Text style={[mbs.matchScorePillText, { color: scoreColor }]}>{score}% MATCH</Text>
        </View>
        <Text style={mbs.matchCardTitle} numberOfLines={1}>{title}</Text>
      </View>

      {metaParts.length > 0 && (
        <Text style={mbs.matchCardLine} numberOfLines={1}>📍 {metaParts.join(' | ')}</Text>
      )}

      {builderParts.length > 0 && (
        <Text style={mbs.matchCardLine} numberOfLines={1}>🏢 {builderParts.join(' | ')}</Text>
      )}

      {!!reason && (
        <Text style={mbs.matchCardReason} numberOfLines={2}>💡 Match Reason: {reason}</Text>
      )}

      {/* Join Group and Preview Info are the spec's two actions. Interested is
          kept because it is the only path that opens a deal room with the
          builder — dropping it would remove that flow from the group entirely. */}
      <CardActions
        tone="brand"
        actions={[
          { key: 'join', label: 'Join Group', icon: 'join', onPress: () => onJoin(projectId) },
          { key: 'preview', label: 'Preview Info', icon: 'details', ghost: true, onPress: () => onPreview(match) },
          { key: 'interested', label: 'Interested', icon: 'interested', onPress: () => onInterested(projectId, messageId) },
        ]}
      />
    </View>
  );
});

// Kept the object name `mbs` so the JSX body above is unchanged from when this
// lived in GroupChatEmbedded.tsx. These seven keys had no reader outside this
// component, so they are module-local. `matchBox` / `matchTitle` stay with
// MessageBubble: they style the wrapper around the LIST of match cards, not a
// card.
const mbs = StyleSheet.create({
  // Group match card — one per matching result.
  matchCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: `${colors.brand}33`, padding: 10, gap: 4 },
  matchCardHead: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  matchScorePill: { flexShrink: 0, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  matchScorePillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.2 },
  matchCardTitle: { flexShrink: 1, fontSize: 13, fontWeight: '800', color: colors.ink },
  matchCardLine: { fontSize: 10.5, color: colors.muted2, lineHeight: 15 },
  matchCardReason: { fontSize: 10.5, fontWeight: '700', color: colors.brand, lineHeight: 15, marginTop: 1 },
});

export default GroupMatchCard;
