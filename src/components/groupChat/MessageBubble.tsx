import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Image, Linking } from 'react-native';
import {
  Building2, MapPin, BadgeCheck, CheckCircle2, ChevronDown, ChevronUp, FileText,
} from 'lucide-react-native';
import type { GroupMessage, InventoryCard } from '../../lib/api';
import { colors } from '../../theme';
import { useToast } from '../Toast';
import { messageClock, fmtPrice } from '../../lib/groupChat/formatting';
import { isProjectSummaryMessage } from '../../lib/groupChat/messages';
import { unitStatusMeta } from '../../lib/groupChat/unitSummaries';
import type { UnitDayGroup } from '../../lib/groupChat/unitSummaries';
import Tag from './Tag';
import CardActions from './CardActions';
import GroupMatchCard from './GroupMatchCard';

// ── Message bubble ──
// Memoised: without this, every keystroke in the composer (whose state lives in
// GroupChatEmbedded) re-rendered every visible bubble in the thread.
const MessageBubble = React.memo(function MessageBubble({ 
  msg, meId, onInterested, onPropertyViewDetails, onPropertyCall, onJoinPropertyGroup, onPreviewMatch, onDeleteMessage, canModerate, projectId, highlighted,
  unitDay, unitDayExpanded, setExpandedUnitDates
}: {
  msg: GroupMessage; 
  meId: string; 
  onInterested: (projectId: string, messageId: string) => void;
  onPropertyViewDetails: (projectId: string, fallback?: InventoryCard, sourceMessageId?: string) => void;
  onPropertyCall: (projectId: string, fallbackNumber?: string, posterPhone?: string) => void;
  onJoinPropertyGroup: (projectId: string) => void;
  onPreviewMatch: (match: any) => void;
  onDeleteMessage: (msg: GroupMessage) => void;
  /** True when this user may remove other people's media in this room. */
  canModerate: boolean;
  projectId: string;
  highlighted: boolean;
  /**
   * This message's day group, present ONLY on the first unit_update of a local
   * day; every later one gets undefined and renders nothing. Built once by the
   * parent (buildUnitDayGroups), never derived here — see the parent's memo.
   */
  unitDay?: UnitDayGroup;
  /** Whether this bubble's own day is expanded. A boolean, not the whole Set. */
  unitDayExpanded: boolean;
  /** Toggle a date's expanded state (a useState setter, so already stable). */
  setExpandedUnitDates: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  // Toast context moved inside MessageBubble to avoid breaking memo on every
  // parent render. The ToastProvider returns { show, success, error } where
  // each method is stable (useCallback), but the wrapper object is created
  // fresh each render, so passing it as a prop broke memoization.
  const toast = useToast();
  const isMe = msg.sender.id === meId;

  if (msg.messageType === 'system') {
    // Was `msg.content?.startsWith('📋 Project:')`, which matched nothing — the
    // server's first line is `📋 <projectName>`. See isProjectSummaryMessage for
    // why BOTH the flag and the `^📋` fallback are needed, and for the list of
    // system messages that deliberately keep rendering.
    if (isProjectSummaryMessage(msg)) return null;
    return <Text style={mbs.system}>{msg.content}</Text>;
  }

  // Unit status auto-message (server posts it on every PATCH that changes a
  // status). Without this branch it fell through to a plain text bubble that
  // One compact summary pill per local day of unit updates, tap to expand.
  //
  // Previous behaviour, in two layers of wrong:
  //  1. Before the summaries, EVERY unit_update drew its own pill — 20 updates
  //     meant 20 pills ("A101 · Booked", "A102 · Vacant", …) flooding the thread.
  //  2. The first summary attempt then computed the grouping HERE: each bubble
  //     filtered the whole `messages` array to find its day-mates and to decide
  //     whether it was that day's first. That is O(n²) over the thread, redone on
  //     every render of every memoised bubble, so one composer keystroke re-ran
  //     the lot. It also keyed on UTC dates — see localDateKey.
  // The grouping now arrives as a prop from one memo in the parent.
  //
  // The `&& msg.unitUpdate` conjunct stays (design review #3): a malformed
  // unit_update with no payload must keep falling through to a plain text bubble
  // rather than being swallowed here.
  if (msg.messageType === 'unit_update' && msg.unitUpdate) {
    // No group means this is not the day's first update; it is already counted in
    // that day's pill. Same visible result as the old `isFirst` check, without
    // the scan.
    if (!unitDay) return null;

    return (
      <View style={mbs.unitDaySummary}>
        {/* Summary pill */}
        <Pressable
          onPress={() => {
            setExpandedUnitDates(prev => {
              const next = new Set(prev);
              if (next.has(unitDay.dateKey)) next.delete(unitDay.dateKey);
              else next.add(unitDay.dateKey);
              return next;
            });
          }}
          style={mbs.unitDayPill}
          accessibilityRole="button"
          accessibilityLabel={`Unit updates for ${unitDay.dateLabel}. Tap to ${unitDayExpanded ? 'collapse' : 'expand'}`}
        >
          <Text style={mbs.unitDayLabel}>{unitDay.dateLabel}:</Text>
          <View style={mbs.unitDayStats}>
            {unitDay.segments.map(p => (
              <View key={p.key} style={mbs.unitDaySeg}>
                <View style={[mbs.unitDot, { backgroundColor: p.color, marginRight: 4 }]} />
                <Text style={mbs.unitDayStatText}>
                  <Text style={{ fontWeight: '700' }}>{p.count}</Text> {p.label}
                </Text>
              </View>
            ))}
          </View>
          {/* marginLeft here, not a `gap` on the pill — see mbs.unitDayPill. */}
          {unitDayExpanded
            ? <ChevronUp size={16} color={colors.muted} style={{ marginLeft: 6 }} />
            : <ChevronDown size={16} color={colors.muted} style={{ marginLeft: 6 }} />}
        </Pressable>
        
        {/* Expanded list */}
        {unitDayExpanded && (
          <View style={mbs.unitDayExpanded}>
            {unitDay.items.map((m, i) => {
              const u = m.unitUpdate!;
              // unitStatusMeta, not statusMeta: an unknown status key must show
              // its own name, not be relabelled "Vacant" (design review #8).
              const meta = unitStatusMeta(u.toStatus);
              return (
                <Pressable
                  key={`${m.id}-${i}`}
                  onPress={() => u.project && onPropertyViewDetails(u.project)}
                  style={mbs.unitExpandedItem}
                  accessibilityRole="button"
                >
                  <View style={[mbs.unitDot, { backgroundColor: meta.color }]} />
                  <Text style={mbs.unitExpandedText} numberOfLines={1}>
                    <Text style={{ fontWeight: '700' }}>{u.label}</Text>
                    {' · '}
                    <Text style={{ fontWeight: '700', color: meta.color }}>{meta.label}</Text>
                    {u.updatedByName ? ` · by ${u.updatedByName}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    );
  }

  // Site visit arrival / completion, posted BY THE SERVER when an agent's phone
  // crosses the project geofence and again once they have dwelled there.
  //
  // Previous behaviour: the collaborator's build had the CLIENT post this as
  // `messageType: 'text'` with an emoji blob in `content`. That could not be
  // styled, filtered or counted, and any client could forge it. The snapshot now
  // comes from the server (GroupMessage.siteVisit), so the card cannot be faked
  // and stays readable after the lead is renamed or the project edited.
  //
  // Same `&& msg.siteVisit` conjunct as unit_update above: a malformed payload
  // must keep falling through to a plain text bubble rather than vanishing here.
  if (msg.messageType === 'site_visit' && msg.siteVisit) {
    const sv = msg.siteVisit;
    const done = sv.kind === 'completed';
    // Palette per the established card spec: white card on colors.line with
    // brand-orange accents. Completion keeps the green tick because, like the
    // status pills, it carries meaning — the visit actually happened.
    const accent = done ? colors.greenText : colors.brand;
    const when = messageClock(done ? (sv.completedAt || msg.createdAt) : (sv.arrivedAt || msg.createdAt));

    return (
      <View style={[mbs.cardWrap, { alignSelf: 'center' }]}>
        <Pressable
          onPress={() => sv.project && onPropertyViewDetails(sv.project)}
          style={mbs.visitCard}
          accessibilityRole="button"
          accessibilityLabel={`${done ? 'Site visit completed' : 'Arrived'} at ${sv.projectName || 'the site'}. Tap to open the project.`}
        >
          <View style={mbs.visitHeaderRow}>
            {done
              ? <CheckCircle2 size={15} color={accent} />
              : <MapPin size={15} color={accent} />}
            <Text style={[mbs.visitTag, { color: accent }]} numberOfLines={1}>
              {done ? 'Site visit completed' : 'Arrived on site'}
            </Text>
            {when ? <Text style={mbs.visitClock}>{when}</Text> : null}
          </View>

          <Text style={mbs.visitProject} numberOfLines={1}>{sv.projectName || 'the site'}</Text>
          <Text style={mbs.visitSub} numberOfLines={2}>
            {`with ${sv.leadName || 'a client'}`}
            {sv.performedByName ? ` · by ${sv.performedByName}` : ''}
          </Text>

          {/* `dwellMinutes` is undefined when the server never measured a dwell,
              which is NOT the same as a 0-minute visit — so the line is omitted
              rather than printing "0 min on site". */}
          {done && typeof sv.dwellMinutes === 'number' ? (
            <Text style={[mbs.visitDwell, { color: accent }]}>{`${sv.dwellMinutes} min on site`}</Text>
          ) : null}
        </Pressable>
      </View>
    );
  }

  // Project announcement. GroupMessage has supported this type on the server for
  // a while, but MessageBubble had NO branch, so an announcement rendered as a
  // stray grey text bubble. site_visit is deliberately not being left in the same
  // state, so the gap is closed in the same change.
  //
  // Minimal and honest: the snapshot carries far more (cover image, price, BHK,
  // RERA, builder identity) but only the title, location and a tap-through are
  // drawn, rather than inventing a richer card than anyone asked for.
  if (msg.messageType === 'project_announcement' && msg.projectAnnouncement) {
    const pa = msg.projectAnnouncement;
    const where = [pa.location, pa.city].filter(Boolean).join(', ');

    return (
      <View style={[mbs.cardWrap, { alignSelf: 'center' }]}>
        <Pressable
          onPress={() => pa.project && onPropertyViewDetails(pa.project)}
          style={mbs.visitCard}
          accessibilityRole="button"
          accessibilityLabel={`Project ${pa.projectName || 'announcement'}. Tap to open the project.`}
        >
          <View style={mbs.visitHeaderRow}>
            <Building2 size={15} color={colors.brand} />
            <Text style={[mbs.visitTag, { color: colors.brand }]} numberOfLines={1}>New project</Text>
            <Text style={mbs.visitClock}>{messageClock(msg.createdAt)}</Text>
          </View>
          <Text style={mbs.visitProject} numberOfLines={1}>{pa.projectName || 'Project'}</Text>
          {where ? <Text style={mbs.visitSub} numberOfLines={1}>{where}</Text> : null}
        </Pressable>
      </View>
    );
  }

  if (msg.messageType === 'inventory_card' && msg.inventoryCard) {
    const inv = msg.inventoryCard;
    // AI Match Found card — posted from the private AI Assist for the whole group.
    // This is a matching RESULT, so it carries the same two actions as a match
    // row. It previously returned with no actions at all, which meant a shared
    // match could be seen but not opened or joined. No Call: these cards are
    // posted by the sharer, not the property owner, so there is no poster phone.
    if (inv.aiMatch) {
      const matchRef = inv.project;
      const matchProjectId = typeof matchRef === 'string'
        ? matchRef
        : String(matchRef?._id || matchRef?.id || projectId || '');

      return (
        <View style={[mbs.cardWrap, { alignSelf: 'flex-start' }]}>
          <View style={[mbs.card, { backgroundColor: colors.brandTint, borderColor: `${colors.brand}55` }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[mbs.cardTag, { color: colors.brand }]}>🎯 AI Match Found · {msg.sender.name}</Text>
              {inv.score ? <Text style={[mbs.cardTag, { color: colors.brand }]}>{Math.round(inv.score)}%</Text> : null}
            </View>
            <Text style={mbs.cardMain}>{inv.projectName || 'Project'}</Text>
            {(inv.area || inv.city) ? <Text style={mbs.cardSub}>📍 {[inv.area, inv.city].filter(Boolean).join(', ')}</Text> : null}

            <CardActions
              tone="brand"
              actions={[
                { key: 'details', label: 'View Details', icon: 'details', ghost: true, onPress: () => onPropertyViewDetails(matchProjectId, inv) },
                { key: 'join', label: 'Join Group', icon: 'join', onPress: () => onJoinPropertyGroup(matchProjectId) },
              ]}
            />
          </View>
        </View>
      );
    }

    
    // Compact universal-group inventory card. All values below come from the
    // stored card/project — no raw AI questionnaire and no role-based guesses.
    const senderName = msg.sender.name || 'Unknown';
    const isVerified = msg.sender.isVerified === true ||
      msg.sender.verificationStatus?.builder === 'verified';

    // Highlight animation for auto-scroll-to-message
    // Lazy initialization ensures Animated.Value is created only once, not on
    // every render. The previous pattern (useRef(new Animated.Value(0)).current)
    // ran the initializer every time the component rendered.
    const highlightAnimRef = useRef<Animated.Value | null>(null);
    if (!highlightAnimRef.current) {
      highlightAnimRef.current = new Animated.Value(0);
    }
    const highlightAnim = highlightAnimRef.current;

    useEffect(() => {
      // Only animate when highlighted becomes true. Without this guard, the
      // animation would restart whenever highlighted changed (even false→false),
      // or if a different message was highlighted mid-animation, causing a flash.
      if (highlighted) {
        Animated.sequence([
          Animated.timing(highlightAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
          Animated.timing(highlightAnim, { toValue: 1, duration: 1900, useNativeDriver: false }),
          Animated.timing(highlightAnim, { toValue: 0, duration: 300, useNativeDriver: false }),
        ]).start();
      }
    }, [highlighted, highlightAnim]);

    const bgColor = highlightAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['rgba(254, 243, 199, 0)', 'rgba(254, 243, 199, 1)'],
    });

    // Actions must use the card's stable project id. Falling back to the active
    // room project made every universal-room card use an empty id, and made every
    // project-room card act on the room project even when it represented
    // something else.
    const projectRef = inv.project;
    const cardProjectId = typeof projectRef === 'string'
      ? projectRef
      : String(projectRef?._id || projectRef?.id || projectId || '');

    // Populated project (present on cards that reference a real project) gives
    // the card a cover image and a reliable name.
    const projObj = typeof projectRef === 'object' && projectRef ? projectRef : undefined;
    const coverUrl = projObj?.media?.coverImage?.url || '';
    const title = inv.projectName || projObj?.projectName || 'Property';

    const price = inv.priceRange?.min ? fmtPrice(inv.priceRange.min * 100000) : '';
    const priceMax = inv.priceRange?.max ? fmtPrice(inv.priceRange.max * 100000) : '';
    const priceText = price && priceMax && priceMax !== price ? `${price} – ${priceMax}` : price;

    // Older cards sometimes stored "1000 sqft" in `area` even though the schema
    // called that field a locality. Detect it so the UI puts it on the details
    // line instead of rendering "📍 1000 sqft, Nagpur".
    const areaLooksLikeSize = !!inv.area && /\d[\d,.]*\s*(?:sq\.?\s*ft|sqft|acre)/i.test(inv.area);
    const locality = areaLooksLikeSize ? '' : (inv.area || '');
    const location = [locality, inv.city].filter(Boolean).join(', ');
    const areaText = inv.carpetAreaRange || (areaLooksLikeSize ? inv.area : '');
    const bhk = inv.bhkOptions?.filter(Boolean).join(' / ') || '';
    const propertyType = inv.propertyType || '';

    // Single money line — "₹5.0 Cr | 500 sqft | Flat" — matching the agreed card
    // spec. filter(Boolean) is what keeps a card with only a price from rendering
    // a trailing "|". Cards that pre-date the propertyType/area snapshots fall
    // back to their BHK data rather than fabricating "Flat".
    const moneyParts = [priceText, areaText, propertyType || bhk].filter(Boolean);

    const possessionLabel = inv.possessionStatus === 'ready' ? 'Ready' :
      inv.possessionStatus === '6months' ? '6 Months' :
      inv.possessionStatus === '1year' ? '1 Year' :
      inv.possessionStatus === '2year+' ? '2+ Years' :
      inv.possessionStatus ? String(inv.possessionStatus).replace(/[-_]/g, ' ') : '';

    const urgencyLabel = inv.urgency === 'urgent' ? 'Urgent' :
      inv.urgency === 'very_urgent' ? 'Very Urgent' : 'Normal Urgency';

    const extraTags = [
      inv.bankLoanAvailable ? '🏦 Loan' : '',
      inv.commissionPercent ? `💼 ${inv.commissionPercent}%` : '',
    ].filter(Boolean);

    // The whole card is the tap target and opens the property's own group.
    // It used to carry three buttons (View Details / Join Group / Call); the
    // product now wants one card, one action. Details (grid, gallery, brochure)
    // and the project's Call number are one tap away inside that group. A card
    // not linked to a real project has no group to open, so it falls back to
    // its own detail view instead of a dead tap.
    const openCard = () => {
      if (cardProjectId) onJoinPropertyGroup(cardProjectId);
      else onPropertyViewDetails('', inv, msg.id);
    };

    return (
      <Pressable
        onPress={openCard}
        style={({ pressed }) => [mbs.cardWrap, { alignSelf: 'flex-start' }, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={cardProjectId ? `${title}. Open property group` : `${title}. View details`}
      >
        <Animated.View style={[mbs.propertyCard, { backgroundColor: bgColor }]}>
          {/* Top strip: label + who posted it */}
          <View style={mbs.propertyHeaderRow}>
            <View style={mbs.propertyLabelPill}>
              <Building2 size={11} color={colors.brand} />
              <Text style={mbs.propertyLabel}>Inventory</Text>
            </View>
            <View style={mbs.propertySenderWrap}>
              <Text style={mbs.propertySender} numberOfLines={1}>{senderName}</Text>
              {isVerified && <BadgeCheck size={12} color={colors.greenText} />}
            </View>
          </View>

          {/* Hero row: cover thumb + title / location / price. The title and
              price were missing entirely before, which is why cards looked empty
              when a locality was all the card had. */}
          <View style={mbs.propertyBody}>
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={mbs.propertyThumb} resizeMode="cover" />
            ) : (
              <View style={[mbs.propertyThumb, mbs.propertyThumbFallback]}>
                <Building2 size={20} color={colors.brand} />
              </View>
            )}

            <View style={mbs.propertyInfo}>
              <Text style={mbs.propertyTitle} numberOfLines={1}>{title}</Text>

              {!!location && (
                <View style={mbs.propertyLine}>
                  <MapPin size={11} color={colors.muted2} />
                  <Text style={mbs.propertyLocation} numberOfLines={1}>{location}</Text>
                </View>
              )}

              {moneyParts.length > 0 && (
                <Text style={mbs.propertyMoney} numberOfLines={1}>💰 {moneyParts.join(' | ')}</Text>
              )}
            </View>
          </View>

          {!!inv.description && (
            <Text style={mbs.propertyDesc} numberOfLines={2}>{inv.description}</Text>
          )}

          {/* [Ready] [Normal Urgency] [Loan] [Commission] */}
          <View style={mbs.propertyTagsRow}>
            {!!possessionLabel && (
              <View style={[mbs.propertyTag, mbs.propertyTagPossession]}>
                <Text style={[mbs.propertyTagText, { color: colors.greenText }]}>{possessionLabel}</Text>
              </View>
            )}
            <View style={[mbs.propertyTag, mbs.propertyTagUrgency]}>
              <Text style={[mbs.propertyTagText, { color: '#92400E' }]}>{urgencyLabel}</Text>
            </View>
            {extraTags.map(t => (
              <View key={t} style={[mbs.propertyTag, mbs.propertyTagPlain]}>
                <Text style={[mbs.propertyTagText, { color: colors.slateText }]}>{t}</Text>
              </View>
            ))}
          </View>

          {/* No action row: the card itself opens the project group (openCard). */}
          {!!messageClock(msg.createdAt) && (
            <Text style={mbs.propertyTime}>{messageClock(msg.createdAt)}</Text>
          )}
        </Animated.View>
      </Pressable>
    );
  }

  if (msg.messageType === 'requirement_card' && msg.requirementCard) {
    const req = msg.requirementCard;
    const matches = msg.matchResults || [];
    return (
      <View style={[mbs.cardWrap, { alignSelf: 'flex-start', gap: 6 }]}>
        <View style={[mbs.card, { backgroundColor: '#FFF8F0', borderColor: `${colors.brand}44` }]}>
          <Text style={[mbs.cardTag, { color: colors.brand }]}>🔍 Requirement · {msg.sender.name}
            {req.urgency === 'urgent' ? '  ⚡ URGENT' : req.urgency === 'very_urgent' ? '  🔥 VERY URGENT' : ''}
          </Text>
          <Text style={mbs.cardMain}>{req.bhkType} · ₹{req.budget}L · {req.area}</Text>
          <View style={mbs.tagRow}>
            {req.city ? <Tag text={req.city} /> : null}
            <Tag text={`🕐 ${req.possessionNeeded}`} />
            {req.loanRequired && <Tag text="🏦 Loan" />}
          </View>
          {req.clientNotes ? <Text style={mbs.cardNote}>📝 {req.clientNotes}</Text> : null}
        </View>

        {matches.length > 0 && (
          <View style={mbs.matchBox}>
            <Text style={mbs.matchTitle}>⚡ {matches.length} Matches Found</Text>
            {matches.map((m: any, i: number) => (
              <GroupMatchCard
                key={String(m?.project?._id || m?.project || i)}
                match={m}
                requirement={req}
                messageId={msg.id}
                onJoin={onJoinPropertyGroup}
                onPreview={onPreviewMatch}
                onInterested={onInterested}
              />
            ))}
          </View>
        )}
      </View>
    );
  }

  // Own media can always be removed; other people's only by a room owner or an
  // admin/captain. Matches the server, so a long-press never leads to a 403.
  const canDelete = isMe || canModerate;

  // image attachment
  if (msg.messageType === 'image' && msg.content) {
    return (
      <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        <View style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem, { padding: 4 }]}>
          {!isMe && <Text style={[mbs.textSender, { marginHorizontal: 6, marginTop: 4 }]}>{msg.sender.name} · {msg.sender.role}</Text>}
          <Pressable
            onPress={() => Linking.openURL(msg.content)}
            onLongPress={canDelete ? () => onDeleteMessage(msg) : undefined}
            delayLongPress={400}
            accessibilityHint={canDelete ? 'Long press to delete' : undefined}
          >
            <Image source={{ uri: msg.content }} style={mbs.attachImage} resizeMode="cover" />
          </Pressable>
          {canDelete && <Text style={mbs.deleteHint}>Hold to delete</Text>}
        </View>
      </View>
    );
  }

  // file attachment
  if (msg.messageType === 'file' && msg.content) {
    const urlName = decodeURIComponent(String(msg.content).split('/').pop() || 'File').split('?')[0];
    const fileName = msg.attachment?.name || urlName;
    return (
      <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        <View style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem]}>
          {!isMe && <Text style={mbs.textSender}>{msg.sender.name} · {msg.sender.role}</Text>}
          <Pressable
            onPress={() => Linking.openURL(msg.content)}
            onLongPress={canDelete ? () => onDeleteMessage(msg) : undefined}
            delayLongPress={400}
            style={mbs.fileRow}
            accessibilityHint={canDelete ? 'Long press to delete' : undefined}
          >
            <FileText size={18} color={isMe ? '#fff' : colors.brand} />
            <Text style={[mbs.fileName, { color: isMe ? '#fff' : colors.ink }]} numberOfLines={1}>{fileName}</Text>
          </Pressable>
          {canDelete && (
            <Text style={[mbs.deleteHint, { color: isMe ? 'rgba(255,255,255,0.7)' : colors.muted }]}>
              Hold to delete
            </Text>
          )}
        </View>
      </View>
    );
  }

  // text — long-press to delete, matching the image/file pattern already above.
  // Previously text messages had NO delete option, which meant only media could
  // be removed. This unifies the interaction: any message type can now be
  // long-pressed by its sender or a moderator.
  return (
    <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
      <Pressable
        onLongPress={canDelete ? () => onDeleteMessage(msg) : undefined}
        delayLongPress={400}
        style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem]}
        accessibilityHint={canDelete ? 'Long press to delete' : undefined}
      >
        {!isMe && <Text style={mbs.textSender}>{msg.sender.name} · {msg.sender.role}</Text>}
        <Text style={[mbs.textContent, { color: isMe ? '#fff' : colors.ink }]}>{msg.content}</Text>
        {canDelete && (
          <Text style={[mbs.deleteHint, { color: isMe ? 'rgba(255,255,255,0.7)' : colors.muted }]}>
            Hold to delete
          </Text>
        )}
      </Pressable>
    </View>
  );
});

// Kept the object name `mbs` so none of the 100+ style sites in the body
// above changed when this moved out of GroupChatEmbedded.tsx. Every key here
// has its only readers inside MessageBubble, so the block is module-local
// rather than shared.
const mbs = StyleSheet.create({
  system: { textAlign: 'center', fontSize: 10, color: colors.muted2, backgroundColor: colors.slateBg, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  // `unitPill` / `unitPillText` used to sit here. They styled the ONE pill per
  // unit_update message; those became one summary pill per day, which left both
  // keys unused. `unitDot` stays — it is shared by the summary segments AND the
  // expanded rows, so it must not be resized for one of them.
  unitDot: { width: 10, height: 10, borderRadius: 5 },
  cardWrap: { width: '92%', maxWidth: 380, minWidth: 0 },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 4 },
  cardTag: { fontSize: 10, fontWeight: '800' },
  cardMain: { fontSize: 13, fontWeight: '800', color: colors.ink },
  cardSub: { fontSize: 11, color: colors.muted2 },
  cardNote: { fontSize: 10.5, color: colors.muted, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 3 },
  // Compact universal-group inventory card styles
  // Same surface as the AI Assist match card: a white card on a neutral border,
  // with brand accents. The card used to be green end to end, which read as a
  // status colour on a card that carries no status.
  propertyCard: {
    width: '100%',
    minWidth: 0,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 6,
  },
  propertyHeaderRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  propertyLabelPill: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.brandTint,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  propertyLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.brand,
    letterSpacing: 0.2,
  },
  propertySenderWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
  },
  propertySender: {
    flexShrink: 1,
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.muted2,
  },
  // Hero row: cover thumbnail beside the title block.
  propertyBody: {
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  propertyThumb: {
    width: 62,
    height: 62,
    borderRadius: 10,
    backgroundColor: colors.brandTint,
  },
  propertyThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
  propertyInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  propertyTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.ink,
  },
  propertyLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 0,
  },
  propertyLocation: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted2,
  },
  // Single "💰 price | area | type" line, per the agreed card spec.
  propertyMoney: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.greenText,
    marginTop: 2,
  },
  propertyDesc: {
    fontSize: 10.5,
    color: colors.muted2,
    lineHeight: 15,
  },
  propertyTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  propertyTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  // Status pills stay coloured — they carry meaning. Softened to a tinted pill
  // so they read as a badge on the white card instead of a solid block.
  propertyTagPossession: {
    backgroundColor: colors.greenBg,
    borderWidth: 1,
    borderColor: colors.greenBorder,
  },
  propertyTagUrgency: {
    backgroundColor: '#FEF3C7',
  },
  propertyTagPlain: {
    backgroundColor: colors.slateBg,
  },
  propertyTagText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: colors.white,
  },
  // `propertyActions` / `propertyActionBtn` lived here and styled the icon-only
  // second action row on the inventory card. That row is gone (see the comment in
  // the inventory_card branch), so the styles went with it rather than being left
  // behind for someone to re-render the duplicate row from.
  propertyTime: {
    alignSelf: 'flex-end',
    fontSize: 8.5,
    color: colors.muted,
    marginTop: -1,
  },
  matchBox: { backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33`, borderRadius: 16, padding: 10, gap: 8 },
  matchTitle: { fontSize: 11, fontWeight: '800', color: colors.brand },
  textBubble: { maxWidth: '75%', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16 },
  textMe: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  textThem: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  textSender: { fontSize: 9, fontWeight: '800', color: colors.brand, marginBottom: 2 },
  textContent: { fontSize: 13, lineHeight: 20 },
  attachImage: { width: 200, height: 200, borderRadius: 12 },
  // Long-press is invisible without a hint, so the affordance is spelled out.
  deleteHint: { fontSize: 8, color: colors.muted, textAlign: 'center', marginTop: 3, marginBottom: 1 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  fileName: { fontSize: 12.5, fontWeight: '600', maxWidth: 180 },
  // Unit update daily summary pills — one collapsible pill per local day
  // ("Aaj: 3 Booked · 2 Vacant"), replacing one pill per unit_update message.
  //
  // DEFECT FIX, and the reason the counts text was INVISIBLE: `unitDayStats` had
  // `flex: 1`. In Yoga `flex: 1` implies `flexBasis: 0%`, and this row sits
  // inside the auto-width `unitDayPill`, under the width-`auto` `unitDaySummary`
  // — a content-sized subtree with no free space to distribute. So the row was
  // laid out at WIDTH 0: the text collapsed to nothing (hence no "3 Booked ·
  // 2 Vacant" on screen) while the fixed-size `unitDot`s kept painting and spilled
  // outside the pill. It is now content-sized with `flexShrink: 1`.
  //
  // Every `gap` in this subtree is also gone, replaced by explicit margins: `gap`
  // has produced exactly this class of layout bug on this RN version, twice in
  // this file.
  //
  // Compacted per the user's "chhota karo": smaller padding and radius, one step
  // down in font size, and no elevation — a drop shadow on a wrapping row is part
  // of what made it read as a floating box rather than a chat pill. Palette is
  // unchanged: white pill on colors.line, with status colour carried only by the
  // dots.
  unitDaySummary: { 
    alignSelf: 'center', 
    maxWidth: '90%', 
    marginVertical: 6 
  },
  unitDayPill: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 10, 
    paddingVertical: 6, 
    backgroundColor: colors.white, 
    borderWidth: 1, 
    borderColor: colors.line, 
    borderRadius: 14,
  },
  unitDayLabel: { 
    fontSize: 11, 
    fontWeight: '800', 
    color: colors.ink,
    marginRight: 6,
  },
  unitDayStats: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    alignItems: 'center', 
    flexShrink: 1,
  },
  unitDaySeg: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    marginVertical: 1,
  },
  unitDayStatText: { 
    // Lets a long segment wrap instead of pushing the chevron out of the pill.
    flexShrink: 1,
    fontSize: 10.5, 
    color: colors.muted2 
  },
  unitDayExpanded: { 
    marginTop: 6, 
    paddingLeft: 8 
  },
  unitExpandedItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 8, 
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    backgroundColor: colors.cream, 
    borderRadius: 12,
    // Was `gap: 4` on the parent `unitDayExpanded`; moved here as a margin for
    // the same reason the pill dropped its gaps.
    marginBottom: 4,
  },
  unitExpandedText: { 
    flex: 1, 
    fontSize: 11, 
    color: colors.ink 
  },
  // Site visit + project announcement cards. One surface for both: a compact
  // white card on colors.line, centred like the unit-day pill because both are
  // SERVER events about the room, not something a member said. Colour comes only
  // from the leading icon and the accent text.
  //
  // Explicit margins, no `gap`: `gap` inside a centred content-sized subtree has
  // produced a layout bug twice in this file (see unitDayPill).
  visitCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  visitHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  visitTag: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginLeft: 5,
  },
  visitClock: {
    // Pushed to the right edge without flex on the text itself, so a long tag
    // wraps/truncates instead of squeezing the clock to zero width.
    marginLeft: 'auto',
    paddingLeft: 8,
    fontSize: 9.5,
    color: colors.muted,
  },
  visitProject: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.ink,
    marginTop: 4,
  },
  visitSub: {
    fontSize: 11,
    color: colors.muted2,
    marginTop: 1,
  },
  visitDwell: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
});

export default MessageBubble;
