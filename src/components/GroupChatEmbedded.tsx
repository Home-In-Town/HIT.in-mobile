// AI Lead Matching — Group Chat (full port of the website group-chat).
// Room list → open a room → full-screen thread with:
//   • one 3-dot menu: Share link, Download PDF, Download QR, Download Gallery,
//     and Exit Group (Delete Group instead, for the owner)
//   • bottom composer: Text / Requirement / Inventory (role-gated)
//   • requirement cards render their auto-match results + "Interested" button
//
// When a room is open we call onRoomOpenChange(true) so the hub hides its top tabs.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, SectionList, Pressable, StyleSheet, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform, Modal, ScrollView, Switch, Alert, Share,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { Image, Linking } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  Users, Plus, Globe, ChevronLeft, Send, X, MoreVertical, Building2,
  Link as LinkIcon, FileText, QrCode, Image as ImageIcon, LogOut, Trash2,
  Search, MapPin, Check, Camera, Paperclip, Sparkles, ChevronDown, ChevronUp, Clock,
  Phone, Eye, UserPlus, BadgeCheck,
} from 'lucide-react-native';
import { groupChatApi, shareApi, mediaApi, leadMatchingApi, projectsApiExtended, GroupRoom, GroupMessage, InventoryCard } from '../lib/api';
import AiAssistant, { AiAssistantApi, AiPostDraft, InventoryMatchCard, aiOwnsInput } from './AiAssistant';
import { postedListStorage, disappearStorage } from '../lib/storage';
import { useAuth } from '../lib/authContext';
import { useSocket } from '../hooks/useSocket';
import { useToast } from './Toast';
import { colors } from '../theme';

const ROOM_ICON: Record<string, string> = { project: '🏗', area: '📍', universal: '🌐' };

function timeStr(iso: string) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function messageClock(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function fmtPrice(v: number): string {
  if (!v) return '—';
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(0)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

// Display name override: the universal / "HIT Community" room shows as "AI Lead Matching".
/** Stable no-op, so passing one as a prop doesn't change identity each render. */
const noop = () => {};

function roomDisplayName(room?: GroupRoom | null): string {
  if (!room) return '';
  if (room.isUniversal || /hit community/i.test(room.name)) return 'AI Lead Matching';
  return room.name;
}

/**
 * One-line summary shown under a group name. Property groups lead with the
 * linked property's location, price and configuration; area groups fall back to
 * their locality.
 */
/**
 * Row text split across two lines. One long ' · '-joined string pushed the
 * price and configuration off the end of a narrow row, so the identity of the
 * group (who/where) now sits on line 1 and the commercial detail on line 2.
 *
 * Every field is guarded: a project room whose project failed to populate falls
 * back to the area/locality rather than rendering "undefined".
 */
function roomLines(room: GroupRoom): { primary: string; secondary: string } {
  const memberText = `${room.members.length} member${room.members.length !== 1 ? 's' : ''}`;
  const p: any = room.project;

  if (room.roomType === 'project' && p) {
    const where = [p.location, p.city].filter(Boolean).join(', ');
    const price = p.pricing?.startingPrice ? `${fmtPrice(p.pricing.startingPrice)}+` : '';
    const bhk = (p.configuration?.bhkOptions || []).filter(Boolean).join('/');
    const size = p.configuration?.carpetAreaRange || p.configuration?.plotSizeRange || '';
    return {
      primary: [memberText, where].filter(Boolean).join(' · '),
      secondary: [price, bhk, size].filter(Boolean).join(' · '),
    };
  }

  const where = [room.area?.location, room.area?.city].filter(Boolean).join(', ');
  return {
    primary: [memberText, where].filter(Boolean).join(' · '),
    secondary: '',
  };
}

/** Group info the backend attaches to each match result. */
type MatchGroupInfo = {
  id: string;
  name: string;
  membersCount: number;
  lastActivity?: string;
};

/**
 * "Active Today" / "Active 3d ago" for a match card. Returns '' when there is no
 * timestamp so the caller can drop the segment rather than print "Active ".
 */
function activityLabel(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const now = new Date();
  if (then.toDateString() === now.toDateString()) return 'Active Today';

  const days = Math.floor((now.getTime() - then.getTime()) / 86400000);
  if (days <= 1) return 'Active Yesterday';
  if (days < 7) return `Active ${days}d ago`;
  const weeks = Math.floor(days / 7);
  return weeks < 5 ? `Active ${weeks}w ago` : 'Active a while ago';
}

/**
 * Explains WHY a property matched, quoting the requirement the user actually
 * entered. Built from the requirement card on the same message, so it needs no
 * extra data from the server.
 */
function matchReason(req: any): string {
  if (!req) return '';
  const need = [
    req.bhkType,
    req.area ? `in ${req.area}` : '',
    req.budget ? `under ${req.budget}L` : '',
  ].filter(Boolean).join(' ');
  return need ? `Teri need "${need}" se match` : '';
}

/** Short label for the row's type chip. Universal rooms don't get one. */
function roomTypeLabel(room: GroupRoom): string {
  if (room.isUniversal) return '';
  if (room.roomType === 'project') return 'Project';
  if (room.roomType === 'area') return 'Area';
  return '';
}

type PostMode = 'text' | 'requirement' | 'inventory';

const BHK_TYPES = ['1BHK', '2BHK', '3BHK', '4BHK', 'Plot', 'Shop'];
const POSSESSION_NEEDED = [
  { v: 'immediate', l: 'Immediate' }, { v: '6months', l: '6 Months' }, { v: '1year', l: '1 Year' },
];
const URGENCY = [
  { v: 'normal', l: 'Normal' }, { v: 'urgent', l: 'Urgent' }, { v: 'very_urgent', l: 'Very Urgent' },
];
const POSSESSION_STATUS = [
  { v: 'ready', l: 'Ready to Move' }, { v: '6months', l: '6 Months' }, { v: '1year', l: '1 Year' }, { v: '2year+', l: '2+ Years' },
];

// Per-property "Post to Group" cooldown (8 hours). After posting, the button is
// disabled/faded until this elapses, then returns to normal.
const POST_COOLDOWN_MS = 8 * 60 * 60 * 1000;

// Format a lakh amount the way the rest of the app does.
function fmtLakhs(lakhs?: number | null): string {
  if (!lakhs || lakhs <= 0) return '—';
  if (lakhs >= 100) return `₹${(lakhs / 100).toFixed(1)} Cr`;
  return `₹${Math.round(lakhs)} L`;
}

// Map a backend ExtractedLead (sell/rent) into the shape PostCard renders.
// This is what makes the Post list survive a reinstall — the data comes from
// the server, not from local storage.
function leadToDisplay(lead: any) {
  const p = lead?.params || {};
  const bhk = p.bhkType || '';
  const type = p.propertyType || '';
  const areaTxt = p.area ? `${p.area} ${p.areaUnit || 'sqft'}` : '';

  const fields: { label: string; value: string }[] = [];
  const push = (label: string, value: any) => {
    if (value === null || value === undefined || value === '' ) return;
    fields.push({ label, value: String(value) });
  };
  push('Listing For', lead?.direction === 'rent' || p.transactionType === 'rent' ? 'Rent' : 'Sale');
  push('Property Type', type);
  push('BHK', bhk);
  push('Area', areaTxt);
  push('Location', p.location || p.locationRaw);
  push('City', p.city);
  push('Full Address', p.formattedAddress);
  push('State', p.state);
  push('Postal Code', p.postalCode);
  push('Category', p.category);
  push('Construction Status', p.projectStatus);
  const minPrice = p.expectedPrice ?? p.budget;
  const maxPrice = p.budgetMax;
  push('Expected Price', minPrice ? `${fmtLakhs(minPrice)}${maxPrice ? ` - ${fmtLakhs(maxPrice)}` : ''}` : '');
  push('Possession Needed', p.possessionNeeded);
  push('Loan Required', p.loanRequired === true ? 'Yes' : p.loanRequired === false ? 'No' : '');
  push('RERA Approved', p.reraApproved === true ? 'Yes' : p.reraApproved === false ? 'No' : '');
  push('RERA Number', p.reraNumber);
  push('Bank Loan Available', p.bankLoanAvailable === true ? 'Yes' : p.bankLoanAvailable === false ? 'No' : '');
  push('Amenities', Array.isArray(p.amenities) && p.amenities.length ? p.amenities.join(', ') : '');
  push('Urgency', p.urgency);
  if (p.latitude && p.longitude) push('Coordinates', `${p.latitude}, ${p.longitude}`);

  return {
    id: String(lead?._id || lead?.id || ''),
    leadId: String(lead?._id || lead?.id || ''),
    title: [bhk, type].filter(Boolean).join(' ') || 'Property',
    subtitle: [p.location || p.locationRaw, p.city].filter(Boolean).join(', '),
    price: fmtLakhs(p.expectedPrice ?? p.budget),
    tags: [lead?.direction === 'rent' ? 'Rent' : 'Sale', bhk, areaTxt, type].filter(Boolean),
    fields,
    direction: lead?.direction || 'sell',
    createdAt: lead?.createdAt,
    source: 'lead',
  };
}

// WhatsApp-style disappearing-message durations for the AI Assist chat.
const DISAPPEAR_OPTIONS: { label: string; ms: number }[] = [
  { label: '6 hours', ms: 6 * 3600000 },
  { label: '12 hours', ms: 12 * 3600000 },
  { label: '1 day', ms: 24 * 3600000 },
  { label: '7 days', ms: 7 * 24 * 3600000 },
  { label: '1 month', ms: 30 * 24 * 3600000 },
  { label: 'Never', ms: 0 },
];
const disappearLabel = (ms: number) => DISAPPEAR_OPTIONS.find(o => o.ms === ms)?.label || 'Never';

function fmtCooldownLeft(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Rupees → short label (₹80L / ₹1.2Cr).
function fmtMoney(v: number): string {
  if (!v || v <= 0) return '';
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(v % 10000000 === 0 ? 0 : 1)}Cr`;
  if (v >= 100000) return `₹${Math.round(v / 100000)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

// A backend project → the common display shape used by PostCard / View Property.
// Every non-empty field comes from the real Project document. Raw AI prompts and
// questionnaire text are never included.
function projectToDisplay(p: any) {
  const mediaUrl = (m: any): string => typeof m === 'string' ? m : (m?.url || '');
  const fields: { label: string; value: string }[] = [];
  const push = (label: string, value: any) => {
    if (value === null || value === undefined || value === '') return;
    fields.push({ label, value: String(value) });
  };

  push('Listing Status', p.isPublished ? 'Published' : 'Draft');
  push('Property Type', p.propertyType || p.type);
  push('Category', p.category);
  push('BHK / Configuration', p.bhkOptions?.length ? p.bhkOptions.join(', ') : '');
  push('Carpet Area', p.carpetAreaRange);
  push('Plot Size', p.plotSizeRange);
  push('Floor Range', p.floorRange);
  push('Facing', p.facingOptions?.length ? p.facingOptions.join(', ') : '');
  push('Location', p.location);
  push('City', p.city);
  push('Starting Price', fmtMoney(p.startingPrice));
  push('Price per sq.ft', p.pricePerSqFt ? `₹${Number(p.pricePerSqFt).toLocaleString('en-IN')}` : '');
  push('Total Price Range', p.totalPriceRange);
  push('Payment Plan', p.paymentPlan);
  push('Bank Loan', p.bankLoanAvailable ? 'Available' : 'Not available');
  push('GST', p.gstPercentage != null ? `${p.gstPercentage}%` : '');
  push('Stamp Duty', p.stampDutyPercentage != null ? `${p.stampDutyPercentage}%` : '');
  push('Registration Charges', p.registrationCharges ? `₹${Number(p.registrationCharges).toLocaleString('en-IN')}` : '');
  push('Maintenance Charges', p.maintenanceCharges);
  push('Other Charges', p.otherCharges);
  push('Construction Status', p.projectStatus);
  push('RERA Approved', p.reraApproved ? 'Yes' : 'No');
  push('RERA Number', p.reraNumber);
  push('Gated Community', p.gatedCommunity ? 'Yes' : 'No');
  push('Amenities', p.amenities?.length ? p.amenities.join(', ') : '');
  push('Landmarks', p.landmarks?.length ? p.landmarks.map((l: any) => l.name || l.address).filter(Boolean).join(', ') : '');
  push('Google Map', p.googleMapLink);
  if (p.latitude && p.longitude) push('Coordinates', `${p.latitude}, ${p.longitude}`);
  push('Call Number', p.cta?.callNumber);
  push('WhatsApp Number', p.cta?.whatsappNumber);
  push('Contact Button', p.cta?.buttonText);
  push('Owner', p.owner?.companyName || p.owner?.name);
  push('Gallery Photos', p.galleryImages?.length || '');
  push('Videos', p.videos?.length || '');
  push('Brochure PDF', mediaUrl(p.brochureUrl));
  push('Created', p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN') : '');

  return {
    id: String(p.id || ''),
    projectId: String(p.id || ''),
    title: p.name || 'Property',
    subtitle: [p.location, p.city].filter(Boolean).join(', '),
    price: fmtMoney(p.startingPrice),
    image: mediaUrl(p.coverImage),
    galleryImages: (p.galleryImages || []).map(mediaUrl).filter(Boolean),
    videos: (p.videos || []).map(mediaUrl).filter(Boolean),
    brochureUrl: mediaUrl(p.brochureUrl),
    layoutImage: mediaUrl(p.layoutImage),
    tags: [
      ...(Array.isArray(p.bhkOptions) && p.bhkOptions.length ? [p.bhkOptions.join(', ')] : []),
      p.carpetAreaRange || p.plotSizeRange || '',
      p.propertyType || p.category || p.type || '',
    ].filter(Boolean),
    fields,
    direction: 'sell',
    source: 'project',
    posted: true,
    postedAt: p.createdAt ? new Date(p.createdAt).getTime() : 0,
  };
}

// Map an AI-collected sell draft (labeled fields) → a real project create payload
// (same shape as add-project) + a group inventory card. Price is normalized to
// full rupees so the property matches correctly.
function buildProjectFromDraft(draft: AiPostDraft): { payload: any; card: any } {
  const get = (re: RegExp) => draft.fields.find(f => re.test(f.label))?.value || '';
  const propType = get(/property type|^type$/i) || 'Apartment / Flat';
  const bhk = get(/bhk/i);
  const location = get(/location/i) || get(/area/i);
  const city = get(/city/i) || 'Nagpur';
  const category = get(/category/i) || 'Residential';
  const statusRaw = get(/status|possession|construction/i);
  const rera = /yes|haan|approved/i.test(get(/rera/i));
  const loan = /yes|haan|available/i.test(get(/loan/i));

  // Price → full rupees. AI collects price in lakh (unit 'lakh'); handle cr too.
  const priceStr = get(/price|budget/i);
  const priceNum = Number((priceStr.match(/[\d.]+/) || [])[0]) || 0;
  const isCr = /cr|crore/i.test(priceStr);
  const priceRupees = Math.round(priceNum * (isCr ? 10000000 : 100000));

  const isPlot = /plot|land|zameen/i.test(propType);
  const projectStatus = /ready/i.test(statusRaw) ? 'ready-to-move'
    : /under|construction/i.test(statusRaw) ? 'under-construction'
    : 'ready-to-move';

  // Auto project name: "{BHK} {PropertyType} - {Location}"
  const namePieces = [bhk, propType].filter(Boolean).join(' ');
  const projectName = [namePieces, location].filter(Boolean).join(' - ') || (draft.title || 'Property');

  const payload = {
    projectName,
    projectType: isPlot ? 'plot' : 'flat',
    city: city.trim(),
    location: location.trim(),
    latitude: 0,
    longitude: 0,
    googleMapLink: '',
    category,
    propertyType: propType,
    reraApproved: rera,
    reraNumber: '',
    projectStatus,
    amenities: (get(/amenit/i) || '').split(',').map(s => s.trim()).filter(Boolean),
    pricing: {
      startingPrice: priceRupees, // full rupees
      totalPriceRange: '',
      paymentPlan: '',
      bankLoanAvailable: loan,
    },
    configuration: {
      bhkOptions: bhk ? [bhk] : [],
      carpetAreaRange: get(/area/i) || '',
      floorRange: '',
      plotSizeRange: '',
      facingOptions: [],
      gatedCommunity: false,
    },
    cta: { buttonText: '', whatsappNumber: '', callNumber: '' },
  };

  const card = {
    projectName,
    propertyType: propType,
    carpetAreaRange: get(/area/i) || '',
    bhkOptions: bhk ? [bhk] : [],
    priceRange: { min: Math.round(priceRupees / 100000), max: 0 }, // card shows lakhs
    area: location,
    city,
    possessionStatus: /ready/i.test(statusRaw) ? 'ready' : (statusRaw || 'ready'),
    urgency: 'normal' as const,
    bankLoanAvailable: loan,
    commissionPercent: 0,
    description: draft.fields.map(f => `${f.label}: ${f.value}`).join(' • '),
  };

  return { payload, card };
}

// ─── Draggable "AI Lead Assist" FAB ──────────────────────────────────────────
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
          <View style={pd.cardIcon}><Building2 size={22} color={colors.brand} /></View>
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
        {item.price ? <Text style={pd.cardPrice}>{item.price}</Text> : null}
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

// ── Room list row ──
// One row for BOTH sections. Joined and discoverable rows previously had their
// own near-identical components (and the discover variant was additionally
// duplicated between an inline list and a modal), which let the two drift apart.
// `joined` is the only thing that differs: the trailing slot shows either
// activity time + unread badge, or a Join button.
const RoomSeparator = () => (
  <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 64 }} />
);

const GroupRow = React.memo(function GroupRow({ room, joined, joining, onPress, onJoin }: {
  room: GroupRoom;
  joined: boolean;
  joining?: boolean;
  onPress?: (room: GroupRoom) => void;
  onJoin?: (room: GroupRoom) => void;
}) {
  const { primary, secondary } = roomLines(room);
  const typeLabel = roomTypeLabel(room);
  const unread = joined ? (room.unreadCount || 0) : 0;

  return (
    <Pressable
      onPress={joined ? () => onPress?.(room) : undefined}
      disabled={!joined}
      style={[s.roomRow, room.isUniversal && s.roomRowPinned]}
    >
      <View style={[s.roomAvatar, room.isUniversal && { backgroundColor: colors.brand }]}>
        <Text style={{ fontSize: 17 }}>{room.isUniversal ? '🌐' : (ROOM_ICON[room.roomType] || '💬')}</Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.roomNameRow}>
          <Text style={[s.roomName, room.isUniversal && { color: colors.brand }]} numberOfLines={1}>
            {roomDisplayName(room)}
          </Text>
          {!!typeLabel && (
            <View style={s.roomTypeChip}>
              <Text style={s.roomTypeChipText}>{typeLabel}</Text>
            </View>
          )}
        </View>

        <Text style={s.roomMeta} numberOfLines={1}>{primary}</Text>
        {!!secondary && <Text style={s.roomMetaSecondary} numberOfLines={1}>{secondary}</Text>}
      </View>

      {joined ? (
        <View style={s.roomTrailing}>
          <Text style={s.roomTime}>{timeStr(room.lastActivity)}</Text>
          {unread > 0 && (
            <View style={s.unreadBadge}>
              <Text style={s.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
        </View>
      ) : (
        <Pressable
          onPress={() => onJoin?.(room)}
          disabled={joining}
          style={[s.smallJoin, joining && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={`Join ${roomDisplayName(room)}`}
        >
          {joining
            ? <ActivityIndicator size="small" color={colors.brand} />
            : <Text style={s.smallJoinText}>Join Group</Text>}
        </Pressable>
      )}
    </Pressable>
  );
});

export default function GroupChatEmbedded({ onRoomOpenChange, topInset = 0, autoOpenUniversal = false, hideThreadBack = false, headerless = false, onActionsReady }: {
  onRoomOpenChange?: (open: boolean) => void;
  topInset?: number;
  // When true, the Universal ("AI Lead Matching") room opens automatically and
  // the thread's back button is hidden — used when this component IS the
  // AI Lead Matching section (no separate room-list step).
  autoOpenUniversal?: boolean;
  hideThreadBack?: boolean;
  // When true, the whole thread header (avatar, member count, My Post / Matching
  // buttons) is hidden — used when the parent (AI Leads hub) provides its own
  // sub-row of Groups · Chats · My Post · Matching above this component.
  headerless?: boolean;
  // Exposes the post/matching triggers to the parent so its sub-row can drive
  // them. Called once the component is ready.
  onActionsReady?: (actions: {
    post: () => void;
    matching: () => void;
    // Return to the default landing view (no AI conversation in progress).
    resetToLanding: () => void;
  }) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const socket = useSocket();

  const [myRooms, setMyRooms] = useState<GroupRoom[]>([]);
  const [discoverRooms, setDiscoverRooms] = useState<GroupRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<GroupRoom | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [roomForm, setRoomForm] = useState({ name: '', city: '', location: '' });
  const [search, setSearch] = useState('');
  // Which discoverable room is mid-join (shows a spinner on its Join button).
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Thread UI state
  const [postMode, setPostMode] = useState<PostMode>('text');
  const [text, setText] = useState('');
  const [showRoomMenu, setShowRoomMenu] = useState(false);
  // QR export is rendered off-screen just long enough for react-native-qrcode-svg
  // to produce a PNG. This avoids opening the generic Share bottom sheet when
  // the user explicitly chose "Download QR" from the project menu.
  const [qrExport, setQrExport] = useState<{ url: string; fileName: string } | null>(null);
  const qrRef = useRef<any>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  // AI Assist mode — when on, the composer + a private inline panel drive the
  // existing AI Lead Matching assistant instead of posting to the group.
  const [aiMode, setAiMode] = useState(false);
  const [showAiMenu, setShowAiMenu] = useState(false);
  // Input type of the assistant's current question. When the assistant renders
  // its own rich control (chips / unit picker / place search) or is in a locked
  // state, this composer must hide — otherwise TWO input rows stack up.
  const [aiInputType, setAiInputType] = useState<string | undefined>(undefined);
  const handleAiTemplate = useCallback((t?: { inputType?: string }) => {
    setAiInputType(t?.inputType);
  }, []);
  // True once the embedded assistant has published its imperative API. Deferred
  // actions (My Post / Matching / a chosen intent) are drained off this, rather
  // than from inside onReady — see the drain effect below.
  const [aiReady, setAiReady] = useState(false);
  // Mirror of aiMode for stable callbacks. The action handlers below are exposed
  // to the parent hub through an effect that runs ONCE, so reading `aiMode`
  // directly would capture the first render's value (always false) forever.
  const aiModeRef = useRef(false);
  useEffect(() => { aiModeRef.current = aiMode; }, [aiMode]);
  // Disappearing messages setting for the AI Assist chat (ms; 0 = Never).
  const [disappearMs, setDisappearMs] = useState(0);
  const [showDisappear, setShowDisappear] = useState(false);

  // Post card built from the AI-collected property details (no manual form).
  const [postDraft, setPostDraft] = useState<AiPostDraft | null>(null);
  const [postingDraft, setPostingDraft] = useState(false);
  // "Post" view: all properties the user has posted so far + the current draft.
  const [showPost, setShowPost] = useState(false);
  const [postedList, setPostedList] = useState<any[]>([]); // AiPostDraft + { projectId, postedAt, id }
  const [postedLeads, setPostedLeads] = useState<any[]>([]); // backend ExtractedLeads (sell/rent)
  const [myProjects, setMyProjects] = useState<any[]>([]); // backend published projects (source of truth)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewProperty, setViewProperty] = useState<any | null>(null); // View Property detail sheet
  // Matching results state
  const [showMatching, setShowMatching] = useState(false);
  const [matchingResults, setMatchingResults] = useState<any[]>([]);
  const [matchingLoading, setMatchingLoading] = useState(false);
  const [matchingError, setMatchingError] = useState<string | null>(null);
  // Free-text lead detection (mirrors the website's extract → confirm → match).
  // When a typed message like "i need a flat in besa" is detected as a lead,
  // we show a confirm sheet; on confirm we run matching (leadMatchingApi.confirm).
  const [leadDetect, setLeadDetect] = useState<{ extraction: any; messageId?: string } | null>(null);
  const [confirmingLead, setConfirmingLead] = useState(false);
  const aiApiRef = useRef<AiAssistantApi | null>(null);
  // Action to run once AI mode is activated from a header button (post/match).
  const pendingAiActionRef = useRef<'post' | 'match' | null>(null);
  // Intent chosen from the Sell/Buy/Rent quick-start, applied once AI is ready.
  const pendingAiIntentRef = useRef<'sell' | 'buy' | 'rent' | null>(null);
  const flatRef = useRef<FlatList>(null);

  // AI Assist belongs to the AI Lead Matching room only — it is a private
  // slot-filling conversation, not a group feature. It must never run inside an
  // individual property or area group, where its greeting, intent chips and
  // My Post / Matching buttons make no sense.
  //
  // `hideThreadBack` identifies the AI Leads hub pane (whose auto-opened room IS
  // the universal room); `isUniversal` covers the room being opened directly from
  // the Groups list.
  const aiAllowed = !!activeRoom && (activeRoom.isUniversal || hideThreadBack);

  // Use this — never raw `aiMode` — for anything in the render path. It prevents
  // a frame where the assistant UI paints over a property group before the
  // safety-net effect below has run.
  const aiActive = aiMode && aiAllowed;

  // Safety net: if the active room changes to one where AI Assist doesn't belong,
  // shut it down rather than leaving a stale assistant mounted over the thread.
  useEffect(() => {
    if (!aiMode || aiAllowed) return;
    setAiMode(false);
    setAiInputType(undefined);
    setAiReady(false);
    aiApiRef.current = null;
    pendingAiActionRef.current = null;
    pendingAiIntentRef.current = null;
  }, [aiMode, aiAllowed]);

  const role = user?.role ?? '';
  const canRequirement = ['agent', 'admin', 'captain'].includes(role);
  const canInventory = ['builder', 'admin', 'captain', 'agent'].includes(role);
  // Photos / PDFs in a group are published by admins and captains only. The
  // backend enforces the same rule on both /attachments and the message route;
  // hiding the paperclip just stops other members from hitting a 403.
  const canUploadMedia = ['admin', 'captain'].includes(role);

  // Requirement / inventory composer state
  const [reqForm, setReqForm] = useState({ bhkType: '2BHK', budget: '', area: '', city: '', possessionNeeded: 'immediate', loanRequired: false, urgency: 'normal', clientNotes: '' });
  const [invForm, setInvForm] = useState({ bhkOptions: '', min: '', max: '', area: '', city: '', possessionStatus: 'ready', bankLoanAvailable: false, commissionPercent: '2', description: '' });

  useEffect(() => { onRoomOpenChange?.(!!activeRoom); }, [activeRoom, onRoomOpenChange]);

  // Sequence guard: a slow earlier response must not overwrite a newer one.
  const roomsSeqRef = useRef(0);

  const loadRooms = useCallback(async (query?: string) => {
    const seq = ++roomsSeqRef.current;
    try {
      const q = query !== undefined ? query : search;
      const data = await groupChatApi.getRooms(q ? { search: q } : undefined);
      if (seq !== roomsSeqRef.current) return; // a newer request already answered
      setMyRooms(data.myRooms);
      setDiscoverRooms(data.discoverRooms);
    } catch { /* silent */ }
    finally { if (seq === roomsSeqRef.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Debounced search. `search` is bound directly to the input, so this used to
  // fire one request per keystroke with no debounce and no ordering guarantee —
  // typing "besa" issued four requests and whichever landed last won.
  useEffect(() => {
    if (!search) { loadRooms(''); return; }
    const t = setTimeout(() => loadRooms(search), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Load the saved disappearing-messages setting once.
  useEffect(() => { disappearStorage.get().then(setDisappearMs); }, []);

  // Append a message only if it isn't already present (dedup by id). Prevents
  // duplicates from optimistic append + socket echo, and stray double-renders.
  const appendMessage = useCallback((msg: GroupMessage) => {
    setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // Real-time incoming messages
  // `socket.ready` is in the deps on purpose: on a cold start this effect can run
  // before getSocket() resolves, in which case the subscription was a silent
  // no-op and the room received no live messages until it was reopened.
  useEffect(() => {
    const unsub = socket.onGroupMessage((msg: any) => {
      const incomingRoom = String(msg.room || msg.roomId || '');
      if (!incomingRoom) return;

      // A message for the room on screen is appended; one for any OTHER room
      // bumps that room's unread badge instead of being dropped. Without this the
      // badge only refreshed on a full room-list reload.
      if (activeRoom?.id && incomingRoom === activeRoom.id) {
        // appendMessage dedups by id, so an echo of our own optimistic message
        // won't create a duplicate.
        appendMessage(normalizeMsg(msg, activeRoom.id));
        return;
      }

      // Mirrors the server-side count: own messages and system notices never
      // contribute to unread.
      const senderId = String(msg.sender?._id || msg.sender?.id || '');
      if (senderId && user?.id && senderId === user.id) return;
      if (msg.messageType === 'system') return;

      setMyRooms(prev => prev.map(r => (
        r.id === incomingRoom
          ? { ...r, unreadCount: (r.unreadCount || 0) + 1, lastActivity: msg.createdAt || r.lastActivity }
          : r
      )));
    });
    return unsub;
  }, [activeRoom?.id, socket.onGroupMessage, socket.ready, appendMessage, user?.id]);

  // Another member may delete the group while this screen is open. Close the
  // thread immediately instead of leaving a dead composer that only fails on
  // the next send.
  useEffect(() => {
    const unsub = socket.onGroupDeleted((data) => {
      if (!activeRoom?.id || String(data.roomId) !== activeRoom.id) return;
      socket.leaveGroup(activeRoom.id);
      setMyRooms(prev => prev.filter(r => r.id !== activeRoom.id));
      setActiveRoom(null);
      setMessages([]);
      setShowRoomMenu(false);
      toast.show(data.message || 'This group was deleted', 'info');
    });
    return unsub;
  }, [activeRoom?.id, socket.onGroupDeleted, socket.ready, socket.leaveGroup, toast]);

  // Re-assert room membership once the socket becomes available, for the case
  // where openRoom ran before it existed.
  useEffect(() => {
    if (socket.ready && activeRoom?.id) socket.joinGroup(activeRoom.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket.ready, activeRoom?.id]);

  // Stable identity: this is the onPress passed to every memoised room row, so a
  // fresh function each render would change the rows' props and defeat the memo.
  // The previously-open room is read from a ref instead of the `activeRoom` state
  // so the callback does not need to change when a room opens.
  const activeRoomIdRef = useRef<string | null>(null);
  useEffect(() => { activeRoomIdRef.current = activeRoom?.id ?? null; }, [activeRoom?.id]);

  const openRoom = useCallback(async (room: GroupRoom) => {
    const previousId = activeRoomIdRef.current;
    if (previousId) socket.leaveGroup(previousId);
    setActiveRoom(room);
    setMessages([]);
    setLoadingMsgs(true);
    setPostMode('text');
    socket.joinGroup(room.id);

    // Clear the unread badge locally straight away so the list is already
    // correct when the user comes back, then persist it. A failed mark-read is
    // deliberately silent — a stale badge is not worth an error toast.
    setMyRooms(prev => prev.map(r => (r.id === room.id ? { ...r, unreadCount: 0 } : r)));
    groupChatApi.markRoomRead(room.id).catch(() => {});

    try {
      setMessages(await groupChatApi.getMessages(room.id));
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 150);
    } catch { /* silent */ }
    finally { setLoadingMsgs(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket.joinGroup, socket.leaveGroup]);

  const closeRoom = () => {
    if (activeRoom) socket.leaveGroup(activeRoom.id);
    setActiveRoom(null);
    setShowRoomMenu(false);
  };

  // When used as the AI Lead Matching section, auto-open the Universal room so
  // the group chat shows directly (no room-list step). Runs once after rooms load.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoOpenUniversal || autoOpenedRef.current || activeRoom || loading) return;
    const universal = myRooms.find(r => r.isUniversal) || myRooms.find(r => /hit community/i.test(r.name));
    if (universal) {
      autoOpenedRef.current = true;
      openRoom(universal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenUniversal, myRooms, loading, activeRoom]);

  // Single composer handler: routes to AI when AI mode is on, else to the group.
  const handleComposerSend = () => {
    const t = text.trim();
    if (!t) return;
    // aiActive, not aiMode: routing on raw aiMode meant that if the assistant was
    // still mounted from another pane, a message typed in a PROPERTY group would
    // be swallowed as an AI answer instead of being posted to the group.
    if (aiActive) {
      // Private AI answer — never posted to the group.
      setText('');
      aiApiRef.current?.submitFreeText(t);
      return;
    }
    sendText();
  };

  const sendText = async () => {
    if (!text.trim() || !activeRoom) return;
    const content = text.trim();
    const roomId = activeRoom.id;
    setText('');
    let postedMessageId: string | undefined;
    try {
      // Persist via REST and append the created message immediately, so the
      // sender always sees their own message (independent of socket echo).
      // appendMessage dedups if the socket also echoes it back.
      const res = await groupChatApi.postMessage(roomId, { messageType: 'text', content });
      postedMessageId = res?.message?._id || res?.message?.id;
      if (res?.message) appendMessage(normalizeMsg(res.message, roomId));
    } catch {
      // Fallback: try the socket, and still show the message locally.
      socket.sendGroupMessage({ roomId, content, messageType: 'text' });
      appendMessage(normalizeMsg({ _id: `local_${Date.now()}`, sender: { _id: user?.id, name: user?.name, role: user?.role }, messageType: 'text', content, createdAt: new Date().toISOString() }, roomId));
    }

    // Free-text lead detection (same as the website): after sending, run NLP
    // extraction. If a buy/sell/rent requirement is detected, offer to find
    // matches. Non-blocking — the message is already sent.
    try {
      const extraction = await leadMatchingApi.extract(content);
      if (extraction?.detected) {
        setLeadDetect({ extraction, messageId: postedMessageId });
      }
    } catch {
      // Extraction is non-blocking — ignore failures.
    }
  };

  // Confirm a detected free-text lead → run matching + persist (mirrors website).
  const confirmDetectedLead = async () => {
    if (!leadDetect || !activeRoom) return;
    setConfirmingLead(true);
    try {
      const ex = leadDetect.extraction;
      const res = await leadMatchingApi.confirm({
        originalText: ex.extractedFrom || '',
        messageId: leadDetect.messageId,
        roomId: activeRoom.id,
        source: 'group_chat',
        intent: ex.intent || 'requirement',
        params: ex.params,
      });
      const n = res?.matchCount ?? (res?.matches?.length || 0);
      toast.show(
        n > 0
          ? `✓ Lead saved — ${n} match${n > 1 ? 'es' : ''} found 🎯`
          : '✓ Lead saved — naya inventory aane par match batayenge',
        'success',
      );
      setLeadDetect(null);
    } catch (e: any) {
      toast.show(e?.message || 'Could not find matches', 'error');
    } finally {
      setConfirmingLead(false);
    }
  };

  // ── Attachments: Camera / Gallery / PDF ──
  // Uploads to a GROUP-scoped R2 key, then posts the returned URL + metadata.
  // This works in universal/area rooms (no projectId required) and does not
  // mutate the linked project's gallery or brochure.
  const uploadAndSendAttachment = async (
    file: { uri: string; name: string; mimeType: string },
    kind: 'image' | 'file',
  ) => {
    if (!activeRoom) return;
    setUploading(true);
    setShowAttachMenu(false);
    try {
      const uploaded = await mediaApi.uploadGroupAttachment({
        roomId: activeRoom.id,
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        kind,
      });
      if (!uploaded.url) throw new Error('Upload failed');

      const response = await groupChatApi.postMessage(activeRoom.id, {
        messageType: kind,
        content: uploaded.url,
        attachment: uploaded.attachment,
      });
      if (response?.message) appendMessage(normalizeMsg(response.message, activeRoom.id));

      toast.show(kind === 'image' ? 'Photo sent 📷' : 'PDF sent 📎', 'success');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Could not send attachment', 'error');
    } finally {
      setUploading(false);
    }
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { toast.show('Camera permission needed', 'error'); return; }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAndSendAttachment(
      { uri: a.uri, name: a.fileName || `photo_${Date.now()}.jpg`, mimeType: a.mimeType || 'image/jpeg' },
      'image',
    );
  };

  const pickFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast.show('Photos permission needed', 'error'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAndSendAttachment(
      { uri: a.uri, name: a.fileName || `image_${Date.now()}.jpg`, mimeType: a.mimeType || 'image/jpeg' },
      'image',
    );
  };

  const pickFile = async () => {
    // Backend intentionally accepts PDF here. Advertising */* caused Word/ZIP
    // files to be selectable and then fail after upload.
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: 'application/pdf',
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await uploadAndSendAttachment(
      { uri: a.uri, name: a.name || `document_${Date.now()}.pdf`, mimeType: a.mimeType || 'application/pdf' },
      'file',
    );
  };

  const postRequirement = async () => {
    if (!activeRoom) return;
    if (!reqForm.budget || !reqForm.area) { toast.show('Budget and Area are required', 'error'); return; }
    const card = {
      bhkType: reqForm.bhkType,
      budget: Number(reqForm.budget),
      area: reqForm.area.trim(),
      city: reqForm.city.trim(),
      possessionNeeded: reqForm.possessionNeeded,
      loanRequired: reqForm.loanRequired,
      urgency: reqForm.urgency,
      clientNotes: reqForm.clientNotes.trim(),
    };
    try {
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'requirement_card', requirementCard: card });
      if (res?.message) appendMessage(normalizeMsg(res.message, activeRoom.id));
      const n = res?.message?.matchResults?.length || 0;
      toast.show(n > 0 ? `Posted — ${n} match${n > 1 ? 'es' : ''} found 🚀` : 'Posted — no matches yet', 'success');
      setReqForm({ bhkType: '2BHK', budget: '', area: '', city: '', possessionNeeded: 'immediate', loanRequired: false, urgency: 'normal', clientNotes: '' });
      setPostMode('text');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) { toast.show(e?.message || 'Failed to post', 'error'); }
  };

  const postInventory = async () => {
    if (!activeRoom) return;
    if (!invForm.area || !invForm.min) { toast.show('Area and Min Price are required', 'error'); return; }
    const card = {
      bhkOptions: invForm.bhkOptions.split(',').map(s => s.trim()).filter(Boolean),
      priceRange: { min: Number(invForm.min), max: Number(invForm.max) || 0 },
      area: invForm.area.trim(),
      city: invForm.city.trim(),
      possessionStatus: invForm.possessionStatus,
      urgency: 'normal' as const,
      bankLoanAvailable: invForm.bankLoanAvailable,
      commissionPercent: Number(invForm.commissionPercent) || 0,
      description: invForm.description.trim(),
    };
    try {
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'inventory_card', inventoryCard: card });
      if (res?.message) appendMessage(normalizeMsg(res.message, activeRoom.id));
      toast.show('Inventory posted 📢', 'success');
      setInvForm({ bhkOptions: '', min: '', max: '', area: '', city: '', possessionStatus: 'ready', bankLoanAvailable: false, commissionPercent: '2', description: '' });
      setPostMode('text');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) { toast.show(e?.message || 'Failed to post', 'error'); }
  };

  // Publish the AI-collected property draft as a REAL published project (so it
  // shows in Projects + becomes a match candidate) AND posts a group card.
  // Details come from the AI conversation — no manual form.
  const publishDraft = async () => {
    if (!activeRoom || !postDraft) return;
    setPostingDraft(true);
    try {
      const built = buildProjectFromDraft(postDraft);

      // 1) Create the project and publish it (real, matchable inventory).
      let projectId: string | undefined;
      try {
        const created = await projectsApiExtended.create(built.payload);
        projectId = created?.id;
        if (projectId) {
          try { await projectsApiExtended.publish(projectId); } catch { /* publish is best-effort */ }
        }
      } catch (e: any) {
        // Non-fatal: still post the group card so the user isn't blocked.
        console.warn('project create failed, posting card only:', e?.message);
      }

      // 2) Post the inventory card into the group (visible to members).
      // Attach the stable project ObjectId created above. Without this, cards in
      // the universal room had no way to open details, start a deal chat or call
      // the project's contact — all three buttons acted on an empty id.
      const inventoryCard: InventoryCard = {
        ...built.card,
        project: projectId || undefined,
      };
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'inventory_card', inventoryCard });
      if (res?.message) appendMessage(normalizeMsg(res.message, activeRoom.id));

      // 3) Save to the local posted list with a cooldown timestamp (per-property).
      const updated = await postedListStorage.add({ ...postDraft, projectId, postedAt: Date.now() });
      // Refresh the durable backend list so the new post shows even after a reinstall.
      loadPostedLeads();
      setPostedList(updated);

      // 4) Clear the AI draft so it stops re-appearing as "Ready to post".
      aiApiRef.current?.clearDraft();
      toast.show(projectId ? 'Property posted & published 📢' : 'Property posted 📢', 'success');
      setPostDraft(null);
      // Refresh backend-sourced posted projects.
      loadMyProjects();
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to post', 'error');
    } finally {
      setPostingDraft(false);
    }
  };

  // Re-post an already-published project's card into the group (after cooldown).
  const repostProject = async (project: any, disp: any) => {
    if (!activeRoom) return;
    try {
      const card: InventoryCard = {
        project: project.id,
        projectName: project.name || project.projectName || disp.title,
        propertyType: project.propertyType || project.type || '',
        carpetAreaRange: project.carpetAreaRange || '',
        bhkOptions: Array.isArray(project.bhkOptions) ? project.bhkOptions : [],
        priceRange: { min: Math.round((project.startingPrice || 0) / 100000), max: 0 },
        area: project.location || '',
        city: project.city || '',
        possessionStatus: /ready/i.test(project.projectStatus || '') ? 'ready' : (project.projectStatus || 'ready'),
        urgency: 'normal',
        bankLoanAvailable: !!project.bankLoanAvailable,
        commissionPercent: 0,
        callNumber: project.cta?.callNumber || project.cta?.whatsappNumber || '',
        description: disp.fields.map((f: any) => `${f.label}: ${f.value}`).join(' • '),
      };
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'inventory_card', inventoryCard: card });
      if (res?.message) appendMessage(normalizeMsg(res.message, activeRoom.id));
      // Record a fresh cooldown timestamp for this project.
      const updated = await postedListStorage.add({
        title: disp.title, subtitle: disp.subtitle, price: disp.price,
        fields: disp.fields, isSellable: true, intent: 'sell',
        projectId: project.id, postedAt: Date.now(),
      } as any);
      setPostedList(updated);
      toast.show('Property re-posted to group 📢', 'success');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to post', 'error');
    }
  };

  // Re-post a posted-list entry that has no backend project (create had failed),
  // rebuilding the inventory card from its saved AI fields, and refresh cooldown.
  const repostFromEntry = async (entry: any, disp: any) => {
    if (!activeRoom) return;
    try {
      const built = buildProjectFromDraft(entry);
      const inventoryCard: InventoryCard = {
        ...built.card,
        project: entry.projectId || undefined,
      };
      const res = await groupChatApi.postMessage(activeRoom.id, { messageType: 'inventory_card', inventoryCard });
      if (res?.message) appendMessage(normalizeMsg(res.message, activeRoom.id));
      const updated = await postedListStorage.add({ ...entry, postedAt: Date.now() } as any);
      setPostedList(updated);
      toast.show('Property re-posted to group 📢', 'success');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to post', 'error');
    }
  };

  // Load the user's own published properties from the backend (source of truth,
  // survives reinstall). Server filters projects to the requesting user for agents.
  const loadMyProjects = useCallback(async () => {
    try {
      const all = await projectsApiExtended.getAll();
      setMyProjects(Array.isArray(all) ? all : []);
    } catch {
      setMyProjects([]);
    }
  }, []);

  // Load the user's AI-posted properties from the BACKEND.
  //
  // Every sell/rent conversation persists an ExtractedLead server-side, so this
  // is the durable record of "what I told the AI to sell" — it survives app
  // reinstall, unlike the local posted list (AsyncStorage gets wiped). Normal
  // add-project projects are not ExtractedLeads, so Post stays separate from
  // the Project section.
  const loadPostedLeads = useCallback(async () => {
    try {
      const res = await leadMatchingApi.getLeads({ limit: 50, mineOnly: true });
      const leads = Array.isArray(res?.leads) ? res.leads : [];
      // Only sellable inventory (sell / rent) — buyer requirements aren't "posts".
      const sellable = leads.filter((l: any) => {
        const dir = String(l?.direction || '').toLowerCase();
        return dir === 'sell' || dir === 'rent' || l?.intent === 'inventory';
      });
      setPostedLeads(sellable);
    } catch {
      setPostedLeads([]);
    }
  }, []);

  // ── AI action handlers (used by the group header buttons/menu) ──
  // Post = show ALL properties the user has posted so far, plus (if present) the
  // current AI-collected draft as a postable card.
  const doPost = async () => {
    const list = await postedListStorage.getAll();
    setPostedList(list);
    loadMyProjects();   // backend published projects (for cooldown enrichment)
    loadPostedLeads();  // backend AI-posted properties — the durable source
    const draft = aiApiRef.current?.getPostDraft();
    // Only treat the draft as postable if it's a new sellable draft not already
    // in the posted list (avoid showing a just-posted item twice as "draft").
    if (draft && draft.isSellable && draft.fields.length > 0) {
      setPostDraft(draft);
    } else {
      setPostDraft(null);
    }
    setExpandedId(null);
    setShowPost(true);
  };
  const doMatching = async () => {
    // Get the current AI-collected requirement params
    const params = aiApiRef.current?.getCurrentParams?.();
    if (!params || Object.keys(params).length === 0) {
      toast.show('Please complete your requirement first', 'error');
      return;
    }

    setShowMatching(true);
    setMatchingLoading(true);
    setMatchingError(null);
    setMatchingResults([]);

    try {
      const result = await leadMatchingApi.matchRequirement(params);
      if (result.detected && result.matches && result.matches.length > 0) {
        setMatchingResults(result.matches);
      } else {
        setMatchingError('No matching properties found for your requirement');
      }
    } catch (err: any) {
      console.error('Matching error:', err);
      setMatchingError(err.message || 'Failed to find matches');
    } finally {
      setMatchingLoading(false);
    }
  };

  // Expose post/matching to the parent hub (headerless mode) so its sub-row can
  // trigger them. aiPost/aiMatching are defined below; a stable wrapper is fine
  // because they read refs/state at call time.
  // (The onActionsReady publish effect lives further down, after aiPost /
  // aiMatching / aiResetToLanding are declared — it depends on their identities.)

  // Members who joined in the last 7 days — shown in the room header next to the
  // total. Members without a joinedAt (older records) simply aren't counted.
  const newJoinCount = React.useMemo(() => {
    if (!activeRoom) return 0;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return activeRoom.members.reduce((n, m) => {
      const t = m.joinedAt ? new Date(m.joinedAt).getTime() : NaN;
      return !isNaN(t) && t >= cutoff ? n + 1 : n;
    }, 0);
  }, [activeRoom]);

  // My Posts = every real Project owned by the current user + their own
  // backend inventory leads + any local draft/cooldown entry not yet represented
  // on the server. De-duplicate by stable ids first, then title/location only as
  // a compatibility fallback for old records that have no relationship id.
  const postedCards = React.useMemo(() => {
    const cards: any[] = [];
    const seenIds = new Set<string>();
    const seenFallback = new Set<string>();

    const add = (card: any) => {
      const ids = [card.projectId, card.leadId, card.id].filter(Boolean).map(String);
      if (ids.some(id => seenIds.has(id))) return;
      const fallback = `${card.title || ''}|${card.subtitle || ''}`.toLowerCase();
      if (fallback !== '|' && seenFallback.has(fallback)) return;
      ids.forEach(id => seenIds.add(id));
      if (fallback !== '|') seenFallback.add(fallback);
      cards.push(card);
    };

    // `/projects` is broader for admins/co-captains. "My" means primary owner,
    // so never show another user's property in this modal.
    myProjects
      .filter((p: any) => String(p.owner?.id || '') === String(user?.id || ''))
      .map(projectToDisplay)
      .forEach(add);

    postedLeads.map(leadToDisplay).forEach(add);

    for (const entry of postedList) {
      add({
        id: entry.id || entry.projectId || String(entry.postedAt || Date.now()),
        projectId: entry.projectId,
        leadId: entry.leadId,
        title: entry.title,
        subtitle: entry.subtitle,
        price: entry.price,
        image: entry.image,
        tags: (entry.fields || []).filter((f: any) => /bhk|area|type/i.test(f.label)).map((f: any) => f.value),
        fields: entry.fields || [],
        direction: entry.intent || 'sell',
        source: 'local',
        createdAt: entry.postedAt ? new Date(entry.postedAt).toISOString() : undefined,
      });
    }

    return cards;
  }, [postedLeads, postedList, myProjects, user?.id]);

  // When Post/Matching is tapped while AI mode is OFF, we turn AI on and defer
  // the action until the assistant API is ready (fired from onReady below).
  // These read aiModeRef, not aiMode: they are handed to the parent hub once and
  // then called much later, so a captured `aiMode` would be permanently stale.
  // When AI mode is already on they act immediately; otherwise the action is
  // queued and the drain effect below runs it as soon as the assistant is ready.
  const aiPost = useCallback(() => {
    if (aiModeRef.current && aiApiRef.current) { doPost(); return; }
    pendingAiActionRef.current = 'post';
    setAiMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const aiMatching = useCallback(() => {
    if (aiModeRef.current && aiApiRef.current) { doMatching(); return; }
    pendingAiActionRef.current = 'match';
    setAiMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Quick-start: user picked Sell / Buy / Rent. Enter AI mode and let the
  // assistant answer the intent question itself, so the chat continues from the
  // next question instead of asking "what would you like to do?" again.
  const aiStartWithIntent = useCallback((intent: 'sell' | 'buy' | 'rent') => {
    if (aiModeRef.current && aiApiRef.current) { aiApiRef.current.startWithIntent(intent); return; }
    pendingAiIntentRef.current = intent;
    setAiMode(true);
  }, []);

  // Stable onReady. It used to be an inline arrow, which gave the prop a new
  // identity on every render of this component — and because the composer's
  // `text` state lives here, that meant every keystroke re-ran the assistant's
  // publish effect and re-allocated its whole API object. Mirrors the pattern
  // already used for onTemplateChange.
  const handleAiReady = useCallback((api: AiAssistantApi) => {
    aiApiRef.current = api;
    setAiReady(true);
  }, []);

  // Drain deferred actions once the assistant is genuinely mounted and ready.
  // Previously this lived inside onReady and fired on a blind setTimeout(300),
  // which raced the assistant's own session open() — and only worked at all
  // because the unstable onReady kept re-firing the effect.
  useEffect(() => {
    if (!aiMode || !aiReady) return;
    const api = aiApiRef.current;
    if (!api) return;

    if (pendingAiIntentRef.current) {
      const intent = pendingAiIntentRef.current;
      pendingAiIntentRef.current = null;
      api.startWithIntent(intent);
      return;
    }
    if (pendingAiActionRef.current) {
      const action = pendingAiActionRef.current;
      pendingAiActionRef.current = null;
      if (action === 'post') doPost();
      else if (action === 'match') doMatching();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMode, aiReady]);

  const aiEndChat = () => { aiApiRef.current?.endChat(); };
  // Exit Chat: reset the conversation (so re-entering starts fresh at step 1),
  // then leave AI mode and return to the group thread.
  const aiExitChat = () => {
    const api = aiApiRef.current;
    Promise.resolve(api?.exitChat?.()).finally(() => {
      setAiMode(false);
      setAiInputType(undefined);
      setAiReady(false);
      aiApiRef.current = null;
    });
  };

  // Return to the default landing view — the same state the section shows when
  // the app is first opened: group thread visible, Sell/Buy/Rent starters above
  // the composer, no AI conversation in progress. Used when the user taps the
  // "AI Leads" section button. Resets the backend flow too, so re-entering starts
  // at step 1 instead of resuming a half-finished question.
  const aiResetToLanding = useCallback(() => {
    const api = aiApiRef.current;
    setShowPost(false);
    setShowAiMenu(false);
    setShowDisappear(false);
    setText('');
    pendingAiActionRef.current = null;
    pendingAiIntentRef.current = null;
    Promise.resolve(api?.exitChat?.()).finally(() => {
      setAiMode(false);
      setAiInputType(undefined);
      setAiReady(false);
      aiApiRef.current = null;
    });
  }, []);

  // Expose post / matching / reset to the parent hub. All three are
  // useCallback-stable and read live state through refs, so publishing them is
  // safe — the previous version captured the first render's `aiMode` (always
  // false), which is why "My Post" and "Matching" sometimes did nothing.
  useEffect(() => {
    onActionsReady?.({ post: aiPost, matching: aiMatching, resetToLanding: aiResetToLanding });
  }, [onActionsReady, aiPost, aiMatching, aiResetToLanding]);

  const handleInterested = useCallback(async (projectId: string, messageId: string) => {
    if (!projectId) {
      toast.show('This older card is not linked to a project', 'error');
      return;
    }
    try {
      const res = await groupChatApi.showInterest({ projectId, messageId, roomId: activeRoom?.id });
      toast.show(res?.message || 'Builder notified! Deal room created.', 'success');
    } catch (e: any) {
      toast.show(e?.message?.includes('exists') ? 'Deal already exists' : (e?.message || 'Failed'), 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoom?.id, toast]);

  /**
   * View Details must ALWAYS open something. Cards posted from the manual
   * inventory form carry no project id, and older cards can point at a deleted
   * project — both used to only raise "not linked to a project", which read as a
   * dead button. The card's own data is a valid fallback detail view.
   */
  const handlePropertyViewDetails = useCallback(async (projectId: string, fallback?: InventoryCard) => {
    const sheetFromCard = (inv?: InventoryCard) => {
      const price = inv?.priceRange?.min ? fmtPrice(inv.priceRange.min * 100000) : '';
      const bhk = inv?.bhkOptions?.filter(Boolean).join(' / ') || '';
      return {
        title: inv?.projectName || 'Property',
        subtitle: [inv?.area, inv?.city].filter(Boolean).join(', '),
        price,
        image: '',
        fields: [
          ...(inv?.propertyType ? [{ label: 'Property Type', value: inv.propertyType }] : []),
          ...(bhk ? [{ label: 'Configuration', value: bhk }] : []),
          ...(inv?.carpetAreaRange ? [{ label: 'Area', value: inv.carpetAreaRange }] : []),
          ...(inv?.possessionStatus ? [{ label: 'Possession', value: String(inv.possessionStatus).replace(/[-_]/g, ' ') }] : []),
          { label: 'Bank Loan', value: inv?.bankLoanAvailable ? 'Available' : 'Not specified' },
          ...(inv?.commissionPercent ? [{ label: 'Commission', value: `${inv.commissionPercent}%` }] : []),
          ...(inv?.description ? [{ label: 'Details', value: inv.description }] : []),
        ],
      };
    };

    if (!projectId) {
      if (!fallback) { toast.show('No details available for this card', 'error'); return; }
      setViewProperty(sheetFromCard(fallback));
      return;
    }

    // Media is included so the detail sheet shows gallery / layout / brochure
    // instead of just a list of text fields.
    const mediaUrls = (arr: any): string[] =>
      (Array.isArray(arr) ? arr : []).map((x: any) => (typeof x === 'string' ? x : x?.url)).filter(Boolean);
    const oneUrl = (v: any): string => (typeof v === 'string' ? v : v?.url || '');

    try {
      const p = await projectsApiExtended.getById(projectId);
      const area = p.carpetAreaRange || '';
      const cover = typeof p.coverImage === 'string' ? p.coverImage : p.coverImage?.url;
      setViewProperty({
        title: p.name || fallback?.projectName || 'Property',
        subtitle: [p.location, p.city].filter(Boolean).join(', '),
        price: fmtPrice(p.startingPrice),
        image: cover || '',
        fields: [
          { label: 'Property Type', value: p.propertyType || p.type || '—' },
          ...(p.bhkOptions?.length ? [{ label: 'Configuration', value: p.bhkOptions.join(' / ') }] : []),
          ...(area ? [{ label: 'Area', value: area }] : []),
          { label: 'Status', value: p.projectStatus || '—' },
          ...(p.reraNumber ? [{ label: 'RERA', value: p.reraNumber }] : []),
          { label: 'Bank Loan', value: p.bankLoanAvailable ? 'Available' : 'Not specified' },
        ],
        galleryImages: mediaUrls((p as any).galleryImages),
        videos: mediaUrls((p as any).videos),
        layoutImage: oneUrl((p as any).layoutImage),
        brochureUrl: oneUrl((p as any).brochureUrl),
      });
    } catch {
      // Project fetch failed (deleted / not visible) — still show the card data
      // rather than leaving the button looking broken.
      if (fallback) setViewProperty(sheetFromCard(fallback));
      else toast.show('Could not load property details', 'error');
    }
  }, [toast]);

  /**
   * "Preview Info" on a match card — the same sheet as View Details but short:
   * only the basics, and no media section. Everything is built from data the
   * match already carries, so it opens instantly with no network call.
   */
  const handlePreviewMatch = useCallback((match: any) => {
    const p = match?.project || {};
    const group: MatchGroupInfo | null = match?.group || null;
    const bhk = (p.configuration?.bhkOptions || []).filter(Boolean).join(' / ');
    const size = p.configuration?.carpetAreaRange || p.configuration?.plotSizeRange || '';

    setViewProperty({
      compact: true,
      title: p.projectName || 'Property',
      subtitle: [p.location, p.city].filter(Boolean).join(', '),
      price: p.pricing?.startingPrice ? fmtPrice(p.pricing.startingPrice) : '',
      image: p.media?.coverImage?.url || '',
      fields: [
        { label: 'Match Score', value: `${Math.round(Number(match?.score) || 0)}%` },
        ...(bhk ? [{ label: 'Configuration', value: bhk }] : []),
        ...(size ? [{ label: 'Area', value: size }] : []),
        ...(p.owner?.name ? [{ label: 'Builder', value: p.owner.name }] : []),
        ...(group ? [{ label: 'Group', value: `${group.name} · ${group.membersCount} members` }] : []),
      ],
    });
  }, []);

  /** "View Details" on an AI match card — reuses the property detail sheet. */
  const handleViewMatchedProject = useCallback((projectId: string, projectName?: string) => {
    handlePropertyViewDetails(projectId, projectName ? ({ projectName } as InventoryCard) : undefined);
  }, [handlePropertyViewDetails]);

  /**
   * "View Details" on an "Also posted by members" card. These are leads, not
   * published projects, so there is no project page to open — the card's own
   * fields are the detail view.
   */
  const handleViewInventoryMatch = useCallback((card: InventoryMatchCard) => {
    setViewProperty({
      title: card.projectName || 'Property',
      subtitle: [card.location, card.city].filter(Boolean).join(', '),
      price: card.startingPrice ? fmtPrice(card.startingPrice) : '',
      image: '',
      fields: [
        ...(card.bhkOptions?.length ? [{ label: 'Configuration', value: card.bhkOptions.join(' / ') }] : []),
        ...(card.area ? [{ label: 'Area', value: `${card.area} ${card.areaUnit || 'sqft'}` }] : []),
        ...(card.builderName ? [{ label: 'Posted by', value: card.builderName }] : []),
        ...(card.postedByRole ? [{ label: 'Role', value: card.postedByRole }] : []),
        { label: 'Match Score', value: `${Math.round(card.score)}%` },
        { label: 'Listing Type', value: 'Posted by a member' },
      ],
    });
  }, []);

  /**
   * "Join Group" on an inventory card. The card only knows its projectId, so the
   * backend resolves (or creates) that property's canonical group, adds the user
   * and returns the room, which we then open.
   */
  const handleJoinPropertyGroup = useCallback(async (projectId: string) => {
    if (!projectId) {
      toast.show('This card is not linked to a property group', 'error');
      return;
    }
    if (joiningId) return;
    setJoiningId(projectId);
    try {
      const { room, joined } = await groupChatApi.joinProjectRoom(projectId);
      setMyRooms(prev => [room, ...prev.filter(x => x.id !== room.id)]);
      setDiscoverRooms(prev => prev.filter(x => x.id !== room.id));
      toast.show(joined ? `Joined ${roomDisplayName(room)}` : `Opening ${roomDisplayName(room)}`, 'success');
      openRoom(room);
    } catch (e: any) {
      toast.show(e?.message || 'Could not join the property group', 'error');
    } finally {
      setJoiningId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joiningId, toast]);

  /**
   * Call dials the person who POSTED the property first (sender phone, sent by
   * the backend for inventory cards only), then the card's own callNumber, and
   * finally the project's CTA numbers.
   */
  const handlePropertyCall = useCallback(async (projectId: string, fallbackNumber?: string, posterPhone?: string) => {
    const clean = (v?: string) => String(v || '').replace(/[^0-9+]/g, '');
    let number = clean(posterPhone) || clean(fallbackNumber);

    if (!number && projectId) {
      try {
        const p = await projectsApiExtended.getById(projectId);
        number = clean(p.cta?.callNumber || p.cta?.whatsappNumber);
      } catch {
        // The user-facing message below is clearer than exposing a fetch error.
      }
    }

    if (!number) {
      toast.show('No contact number is available for this property', 'error');
      return;
    }

    // Android dialer links are not always reported as openable by canOpenURL,
    // and refusing on that basis is what made Call look dead. Try the dial
    // intent directly and only report a failure if the OS actually rejects it.
    const telUrl = `tel:${number}`;
    try {
      await Linking.openURL(telUrl);
    } catch {
      toast.show('Could not open the dialer on this device', 'error');
    }
  }, [toast]);

  // Stable renderItem so the memoised MessageBubble can actually bail out.
  // Previously this was an inline arrow with a fresh onInterested on every
  // render, which defeated memoisation entirely.
  const renderMessage = useCallback(
    ({ item: msg }: { item: GroupMessage }) => (
      <MessageBubble 
        msg={msg} 
        meId={user?.id || ''} 
        onInterested={handleInterested}
        onPropertyViewDetails={handlePropertyViewDetails}
        onPropertyCall={handlePropertyCall}
        onJoinPropertyGroup={handleJoinPropertyGroup}
        onPreviewMatch={handlePreviewMatch}
        projectId={(activeRoom?.project as any)?.id || (activeRoom?.project as any)?._id || ''}
      />
    ),
    [user?.id, handleInterested, handlePropertyViewDetails, handlePropertyCall, handleJoinPropertyGroup, handlePreviewMatch, activeRoom?.project]
  );

  // ── Project media menu ──
  const activeProject = () => (activeRoom?.project as any) || {};
  const activeProjectId = () => String(activeProject().id || activeProject()._id || '');
  const safeProjectFileName = (suffix: string) => {
    const base = String(activeProject().projectName || activeRoom?.name || 'project')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${base}_${suffix}`;
  };
  const plainProjectUrl = () => {
    const slug = activeProject().slug;
    return slug ? `https://homeintown.in/visit/${slug}` : 'https://homeintown.in';
  };

  /** Resolve a tracked share URL, with a stable public project URL fallback. */
  const resolveShareUrl = async (type: 'link' | 'pdf' | 'qr') => {
    const pid = activeProjectId();
    if (!pid) throw new Error('No project linked to this group');
    try {
      const result = await shareApi.generateToken(pid, type);
      return result.shareUrl || plainProjectUrl();
    } catch {
      if (type === 'link' || type === 'qr') return plainProjectUrl();
      throw new Error('No PDF brochure available for this project');
    }
  };

  /**
   * Share link opens the OS share sheet with the tracked project URL, and falls
   * back to copying it if the sheet cannot be shown. (Download QR deliberately
   * does NOT use the share sheet — that was a separate bug.)
   */
  const handleShareLink = async () => {
    setShowRoomMenu(false);
    try {
      const url = await resolveShareUrl('link');
      const name = activeProject().projectName || activeRoom?.name || 'this property';
      try {
        await Share.share({ message: `${name}\n${url}`, url });
      } catch {
        await Clipboard.setStringAsync(url);
        toast.show('Project link copied', 'success');
      }
    } catch (e: any) {
      toast.show(e?.message || 'Could not share the project link', 'error');
    }
  };

  /** Download the real brochure/token PDF and hand the file to the OS. */
  const handleDownloadPdf = async () => {
    setShowRoomMenu(false);
    const pid = activeProjectId();
    if (!pid) { toast.show('No project linked to this group', 'error'); return; }

    toast.show('Downloading PDF…', 'info');
    try {
      const p = activeProject();
      const rawBrochure = p.media?.brochurePdf;
      const brochureUrl = typeof rawBrochure === 'string' ? rawBrochure : rawBrochure?.url;
      const url = brochureUrl || await resolveShareUrl('pdf');
      const target = `${FileSystem.cacheDirectory}${safeProjectFileName('Brochure.pdf')}`;
      const result = await FileSystem.downloadAsync(url, target);
      if (result.status !== 200) throw new Error('PDF download failed');

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Project Brochure',
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Linking.openURL(result.uri);
      }
    } catch (e: any) {
      toast.show(e?.message || 'Failed to download PDF', 'error');
    }
  };

  /** Generate a QR token and render it off-screen for PNG export. */
  const handleDownloadQr = async () => {
    setShowRoomMenu(false);
    if (!activeProjectId()) { toast.show('No project linked to this group', 'error'); return; }
    toast.show('Generating QR…', 'info');
    try {
      const url = await resolveShareUrl('qr');
      qrRef.current = null;
      setQrExport({ url, fileName: safeProjectFileName('QR.png') });
    } catch (e: any) {
      toast.show(e?.message || 'Failed to generate QR', 'error');
    }
  };

  // QRCode's toDataURL API is ref-based. The off-screen component mounts after
  // qrExport is set; wait one frame, convert it, write a real PNG, then clear it.
  useEffect(() => {
    if (!qrExport) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const node = qrRef.current;
      if (!node?.toDataURL) {
        if (!cancelled) {
          toast.show('Could not render QR code', 'error');
          setQrExport(null);
        }
        return;
      }

      node.toDataURL(async (base64: string) => {
        if (cancelled) return;
        try {
          const target = `${FileSystem.cacheDirectory}${qrExport.fileName}`;
          await FileSystem.writeAsStringAsync(target, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(target, {
              mimeType: 'image/png',
              dialogTitle: 'Project QR Code',
              UTI: 'public.png',
            });
          } else {
            toast.show('QR generated', 'success');
          }
        } catch (e: any) {
          toast.show(e?.message || 'Failed to save QR', 'error');
        } finally {
          setQrExport(null);
        }
      });
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [qrExport, toast]);

  const handleDownloadGallery = async () => {
    setShowRoomMenu(false);
    const pid = (activeRoom?.project as any)?.id || (activeRoom?.project as any)?._id;
    if (!pid) { toast.show('No project linked to this group', 'error'); return; }
    toast.show('Downloading gallery…', 'info');
    try {
      const { url, token } = await shareApi.galleryDownload(String(pid));
      const name = ((activeRoom?.project as any)?.projectName || 'project').replace(/[^a-zA-Z0-9]/g, '_');
      const target = `${FileSystem.cacheDirectory}${name}_Gallery.zip`;
      const res = await FileSystem.downloadAsync(url, target, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status !== 200) throw new Error('Download failed');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.uri, { mimeType: 'application/zip', dialogTitle: 'Project Gallery' });
      } else {
        toast.show('Gallery saved', 'success');
      }
    } catch (e: any) {
      toast.show(e?.message || 'Failed to download gallery', 'error');
    }
  };

  // ── Room options ──
  // Project groups are canonically created by the property owner. Prefer the
  // explicit project.owner id and fall back to room.createdBy for older/area
  // groups. Role or room-admin status must not be treated as property ownership.
  const groupOwnerId = activeRoom?.project?.owner?.id || activeRoom?.createdBy?.id || '';
  const isGroupOwner = !!activeRoom && !!user?.id && groupOwnerId === user.id;
  const canDelete = !!activeRoom && !activeRoom.isUniversal && isGroupOwner;
  const canLeave = !!activeRoom && !activeRoom.isUniversal && !isGroupOwner && activeRoom.canLeave !== false;

  const handleLeave = () => {
    setShowRoomMenu(false);
    if (!activeRoom) return;
    Alert.alert('Exit group?', `Exit "${roomDisplayName(activeRoom)}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Exit', style: 'destructive', onPress: async () => {
          try {
            await groupChatApi.leaveRoom(activeRoom.id);
            setMyRooms(prev => prev.filter(r => r.id !== activeRoom.id));
            toast.show('Exited group', 'success');
            closeRoom();
          } catch (e: any) { toast.show(e?.message || 'Failed to leave', 'error'); }
        },
      },
    ]);
  };

  const handleDelete = () => {
    setShowRoomMenu(false);
    if (!activeRoom) return;
    Alert.alert('Delete group?', `This will close "${roomDisplayName(activeRoom)}" for everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await groupChatApi.deleteRoom(activeRoom.id);
            setMyRooms(prev => prev.filter(r => r.id !== activeRoom.id));
            toast.show('Group deleted', 'success');
            closeRoom();
          } catch (e: any) { toast.show(e?.message || 'Failed to delete', 'error'); }
        },
      },
    ]);
  };

  const handleJoin = useCallback(async (room: GroupRoom) => {
    if (joiningId) return; // guard against double-taps creating duplicate joins
    setJoiningId(room.id);
    try {
      const r = await groupChatApi.joinRoom(room.id);
      // Move the room from Discover into My Groups, de-duping in case the list
      // already has it (e.g. a refresh landed mid-join).
      setMyRooms(prev => [r, ...prev.filter(x => x.id !== r.id)]);
      setDiscoverRooms(prev => prev.filter(x => x.id !== room.id));
      toast.show(`Joined ${roomDisplayName(r)}`, 'success');
      openRoom(r);
    } catch (e: any) { toast.show(e?.message || 'Failed', 'error'); }
    finally { setJoiningId(null); }
  }, [joiningId, toast, openRoom]);

  // One stable renderItem for the whole SectionList. `section.joined` decides
  // which variant the row shows, so both sections share a single row component.
  const renderGroupRow = useCallback(
    ({ item: room, section }: { item: GroupRoom; section: { joined: boolean } }) => (
      <GroupRow
        room={room}
        joined={section.joined}
        joining={joiningId === room.id}
        onPress={openRoom}
        onJoin={handleJoin}
      />
    ),
    [joiningId, openRoom, handleJoin]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string; data: GroupRoom[]; joined: boolean } }) => (
      <View style={s.sectionHeader}>
        {section.joined
          ? <Users size={13} color={colors.brand} />
          : <Globe size={13} color={colors.brand} />}
        <Text style={s.sectionTitle}>{section.title}</Text>
        <View style={s.sectionCountPill}>
          <Text style={s.sectionCountText}>{section.data.length}</Text>
        </View>
      </View>
    ),
    []
  );

  const handleCreate = async () => {
    if (!roomForm.name || !roomForm.city || !roomForm.location) {
      toast.show('Name, city, location required', 'error'); return;
    }
    setCreating(true);
    try {
      const r = await groupChatApi.createRoom({ name: roomForm.name, roomType: 'area', area: { city: roomForm.city, location: roomForm.location } });
      setMyRooms(prev => [r, ...prev]);
      setShowCreate(false);
      setRoomForm({ name: '', city: '', location: '' });
      openRoom(r);
    } catch (e: any) { toast.show(e?.message || 'Failed', 'error'); }
    finally { setCreating(false); }
  };

  // ═══════════ ROOM LIST ═══════════
  if (!activeRoom) {
    // The universal ("AI Lead Matching") room is the AI Leads section itself, so
    // it must NOT appear in the Groups list. Only real, joinable groups here.
    const listRooms = myRooms.filter(r => !r.isUniversal);

    // Public groups the user hasn't joined. The backend already excludes joined
    // rooms and the universal room; this second guard keeps the list correct if
    // a join resolves while a refresh is in flight, so a group can never show up
    // in both My Groups and Discover.
    const joinedIds = new Set(myRooms.map(r => r.id));
    const discoverList = discoverRooms.filter(r => !r.isUniversal && !joinedIds.has(r.id));

    // ONE list for both groups the user is in and groups they can join.
    // Previously the discover rows were a .map() inside ListFooterComponent —
    // unvirtualized — AND a second copy lived in a full-screen modal reached by a
    // globe icon. Sections give both lists virtualization from one code path, and
    // the modal is gone.
    const sections = [
      { title: 'My Groups', data: listRooms, joined: true },
      { title: 'Discover Groups', data: discoverList, joined: false },
    ].filter(sec => sec.data.length > 0);

    const nothingToShow = sections.length === 0;

    return (
      <View style={{ flex: 1 }}>
        {/* Header: always-visible search + New. The search used to be a magnifier
            that expanded over the whole header, hiding the other actions while
            typing, and a globe opened a duplicate Discover sheet. */}
        <View style={s.listHeader}>
          <View style={s.searchInline}>
            <Search size={15} color={colors.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search groups…"
              placeholderTextColor={colors.muted}
              style={s.searchInput}
              onSubmitEditing={() => loadRooms(search)}
              returnKeyType="search"
            />
            {!!search && (
              <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
                <X size={16} color={colors.muted2} />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => setShowCreate(true)}
            style={s.newBtn}
            accessibilityRole="button"
            accessibilityLabel="Create a new group"
          >
            <Plus size={14} color={colors.brand} />
            <Text style={s.newBtnText}>New</Text>
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
          nothingToShow ? (
            <View style={s.empty}>
              <Users size={28} color={colors.muted} />
              <Text style={s.emptyText}>
                {search ? `No groups match "${search}"` : 'No groups yet'}
              </Text>
              <Text style={s.emptyHint}>
                {search
                  ? 'Try a different area or project name.'
                  : 'Groups you join appear here, and public groups show up under Discover Groups.'}
              </Text>
              {!search && (
                <Pressable onPress={() => setShowCreate(true)} style={s.joinBtn}>
                  <Text style={s.joinBtnText}>Create a group</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={r => r.id}
              renderItem={renderGroupRow}
              renderSectionHeader={renderSectionHeader}
              ItemSeparatorComponent={RoomSeparator}
              stickySectionHeadersEnabled
              contentContainerStyle={{ paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            />
          )
        )}

        {/* Create */}
        <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreate(false)}>
          <View style={{ flex: 1, backgroundColor: colors.cream }}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Create Group</Text>
              <Pressable onPress={() => setShowCreate(false)}><X size={20} color={colors.ink} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              {[{ k: 'name', lbl: 'Group Name *', ph: 'e.g. Baner Builders' }, { k: 'city', lbl: 'City *', ph: 'e.g. Pune' }, { k: 'location', lbl: 'Area / Location *', ph: 'e.g. Baner' }].map(f => (
                <View key={f.k} style={{ gap: 4 }}>
                  <Text style={s.fieldLabel}>{f.lbl}</Text>
                  <TextInput value={(roomForm as any)[f.k]} onChangeText={v => setRoomForm(r => ({ ...r, [f.k]: v }))} placeholder={f.ph} placeholderTextColor={colors.muted} style={s.fieldInput} />
                </View>
              ))}
              <Pressable onPress={handleCreate} disabled={creating} style={[s.primaryBtn, creating && { opacity: 0.6 }]}>
                {creating ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Create Group</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════ THREAD (full-screen) ═══════════
  const proj = (activeRoom.project as any) || null;
  // Share link / PDF / QR / Gallery all act on the linked project, so they are
  // only offered when the group actually has one (area groups do not).
  const hasProjectMedia = !!(proj?.slug || proj?.id || proj?._id);
  return (
    <KeyboardAvoidingView style={{ flex: 1, paddingTop: topInset }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Thread header — hidden entirely in headerless mode (the AI Leads hub
          provides its own Groups · Chats · My Post · Matching sub-row instead). */}
      {!headerless && (
      <View style={s.threadHeader}>
        {!hideThreadBack && (
          <Pressable onPress={closeRoom} style={{ padding: 4 }}><ChevronLeft size={22} color={colors.ink} /></Pressable>
        )}
        {/* Universal room gets the globe symbol (matches the room list) so this
            header reads as "the shared room", not a repeat of the tab name. */}
        <View style={[s.threadAvatar, activeRoom.isUniversal && { backgroundColor: colors.brand }]}>
          <Text style={{ fontSize: 15 }}>
            {activeRoom.isUniversal ? '🌐' : (ROOM_ICON[activeRoom.roomType] || '💬')}
          </Text>
        </View>
        {/* Membership stats instead of a repeated section name. The tab above
            already says "AI Matching", so the room title added nothing and only
            got truncated once the Post / Matching buttons were in the row. */}
        <View style={{ flex: 1 }}>
          <Text style={s.threadTitle} numberOfLines={1}>
            {activeRoom.members.length} members
          </Text>
          <Text style={s.threadSub} numberOfLines={1}>
            {newJoinCount > 0
              ? `+${newJoinCount} new this week`
              : activeRoom.isUniversal
                ? 'Universal group'
                : activeRoom.roomType === 'project'
                  ? ([proj?.location, proj?.city].filter(Boolean).join(', ') || 'Project group')
                  : (activeRoom.area?.location || activeRoom.area?.city || 'Group')}
          </Text>
        </View>

        {/* AI 3-dot menu in the header (only visible when AI mode is active) */}
        {aiAllowed && aiActive && (
          <View style={s.headerAiRow}>
            <Pressable onPress={() => setShowAiMenu(v => !v)} style={s.headerAiDots}>
              <MoreVertical size={18} color={colors.ink} />
            </Pressable>
          </View>
        )}

        {/* Area groups have no project banner, so their lifecycle menu lives in
            the thread header. Project groups use the dots on the blue banner. */}
        {!activeRoom.isUniversal && !proj && (
          <Pressable
            onPress={() => setShowRoomMenu(v => !v)}
            style={s.headerAiDots}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Group options"
          >
            <MoreVertical size={18} color={colors.ink} />
          </Pressable>
        )}

        {/* AI 3-dot dropdown (End Chat / Exit Chat) */}
        {aiActive && showAiMenu && (
          <>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAiMenu(false)} />
            <View style={s.menu}>
              <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); setShowDisappear(true); }}>
                <Clock size={15} color={colors.muted2} />
                <Text style={s.menuText}>Disappearing messages</Text>
                <Text style={{ fontSize: 10, fontWeight: '700', color: colors.brand }}>{disappearLabel(disappearMs)}</Text>
              </Pressable>
              <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); aiEndChat(); }}>
                <X size={15} color={colors.muted2} /><Text style={s.menuText}>End Chat</Text>
              </Pressable>
              <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); aiExitChat(); }}>
                <LogOut size={15} color={colors.muted2} /><Text style={s.menuText}>Exit Chat</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* Single group menu. The media actions used to sit behind a nested
            "Project media" item, so the first tap showed only two options and
            the download actions needed a second hop. */}
        {showRoomMenu && (
          <View style={s.menu}>
            {hasProjectMedia && (
              <>
                <Pressable style={s.menuItem} onPress={handleShareLink}>
                  <LinkIcon size={15} color={colors.muted2} /><Text style={s.menuText}>Share link</Text>
                </Pressable>
                <Pressable style={s.menuItem} onPress={handleDownloadPdf}>
                  <FileText size={15} color={colors.muted2} /><Text style={s.menuText}>Download PDF</Text>
                </Pressable>
                <Pressable style={s.menuItem} onPress={handleDownloadQr}>
                  <QrCode size={15} color={colors.muted2} /><Text style={s.menuText}>Download QR</Text>
                </Pressable>
                <Pressable style={s.menuItem} onPress={handleDownloadGallery}>
                  <ImageIcon size={15} color={colors.muted2} /><Text style={s.menuText}>Download Gallery</Text>
                </Pressable>
              </>
            )}
            {canLeave && (
              <Pressable style={s.menuItem} onPress={handleLeave}>
                <LogOut size={15} color={colors.muted2} /><Text style={s.menuText}>Exit Group</Text>
              </Pressable>
            )}
            {canDelete && (
              <Pressable style={s.menuItem} onPress={handleDelete}>
                <Trash2 size={15} color={colors.red} /><Text style={[s.menuText, { color: colors.red }]}>Delete Group</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
      )}

      {/* Headerless mode: Action buttons row below the tabs */}
      {headerless && aiAllowed && (
        <View style={s.aiActionBar}>
          <Pressable onPress={aiPost} style={[s.headerAiBtn, { backgroundColor: '#F0FDF4', borderColor: colors.greenBorder }]}>
            <Building2 size={13} color={colors.greenText} />
            <Text style={[s.headerAiBtnText, { color: colors.greenText }]}>My Post</Text>
          </Pressable>
          <Pressable onPress={aiMatching} style={[s.headerAiBtn, { backgroundColor: colors.brandTint, borderColor: `${colors.brand}55` }]}>
            <Search size={13} color={colors.brand} />
            <Text style={[s.headerAiBtnText, { color: colors.brand }]}>Matching</Text>
          </Pressable>
          {aiActive && (
            <Pressable onPress={() => setShowAiMenu(v => !v)} style={s.headerAiDots}>
              <MoreVertical size={18} color={colors.ink} />
            </Pressable>
          )}
        </View>
      )}

      {/* AI 3-dot menu (Disappearing / End / Exit) appears when AI is active */}
      {headerless && aiAllowed && aiActive && showAiMenu && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAiMenu(false)} />
          <View style={s.menu}>
            <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); setShowDisappear(true); }}>
              <Clock size={15} color={colors.muted2} />
              <Text style={s.menuText}>Disappearing messages</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.brand }}>{disappearLabel(disappearMs)}</Text>
            </Pressable>
            <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); aiEndChat(); }}>
              <X size={15} color={colors.muted2} /><Text style={s.menuText}>End Chat</Text>
            </Pressable>
            <Pressable style={s.menuItem} onPress={() => { setShowAiMenu(false); aiExitChat(); }}>
              <LogOut size={15} color={colors.muted2} /><Text style={s.menuText}>Exit Chat</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* Property banner — the group's linked project, straight from the DB.
          Shows the cover image plus every detail that exists on the project, so
          the group always reflects the latest property data. */}
      {proj && (
        <View style={s.banner}>
          {proj.media?.coverImage?.url ? (
            <Image source={{ uri: proj.media.coverImage.url }} style={s.bannerThumb} />
          ) : (
            <View style={s.bannerIcon}><Building2 size={16} color={colors.blueText} /></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.bannerName} numberOfLines={1}>{proj.projectName || activeRoom.name}</Text>

            {!![proj.location, proj.city].filter(Boolean).length && (
              <Text style={s.bannerMeta} numberOfLines={1}>
                📍 {[proj.location, proj.city].filter(Boolean).join(', ')}
              </Text>
            )}

            <Text style={s.bannerMeta} numberOfLines={1}>
              {[
                proj.pricing?.startingPrice ? `💰 ${fmtPrice(proj.pricing.startingPrice)}+` : '',
                proj.configuration?.bhkOptions?.length ? `🏠 ${proj.configuration.bhkOptions.join('/')}` : '',
                proj.configuration?.carpetAreaRange || proj.configuration?.plotSizeRange
                  ? `📐 ${proj.configuration.carpetAreaRange || proj.configuration.plotSizeRange}` : '',
              ].filter(Boolean).join('  ')}
            </Text>

            <Text style={s.bannerMeta} numberOfLines={1}>
              {[
                proj.propertyType || proj.category ? `🏷️ ${proj.propertyType || proj.category}` : '',
                proj.projectStatus ? `🔄 ${proj.projectStatus}` : '',
                proj.pricing?.bankLoanAvailable ? '🏦 Loan' : '',
                proj.reraNumber || proj.reraApproved ? '📑 RERA' : '',
              ].filter(Boolean).join('  ')}
            </Text>
          </View>
          <Pressable
            onPress={() => setShowRoomMenu(v => !v)}
            style={s.bannerMenuBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Group options"
          >
            <MoreVertical size={18} color={colors.blueText} />
          </Pressable>
        </View>
      )}

      {/* Tap-catcher to close the menu */}
      {showRoomMenu && (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowRoomMenu(false)} />
      )}

      {/* Messages — the group chat is ALWAYS the base view. */}
      {loadingMsgs ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 14, gap: 10 }}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
            renderItem={renderMessage}
          />

          {/* ── AI Assist (inline, private) — overlays the message area while
              active. Runs the existing AI Lead Matching assistant via the user's
              own private thread (leadChatApi); other members see nothing. Only a
              shared match becomes public. Uses the SAME group composer below. ── */}
          {aiActive && (
            <View style={s.aiOverlay}>
              {/* AI actions moved to the Universal Group header (Post / Matching / 3-dot). */}
              <View style={{ flex: 1 }}>
                <AiAssistant
                  hideOwnChrome
                  disappearMs={disappearMs}
                  groupContext={{ roomId: activeRoom.id, roomName: roomDisplayName(activeRoom) }}
                  onTemplateChange={handleAiTemplate}
                  onReady={handleAiReady}
                  onMatchShared={noop}
                  onViewProject={handleViewMatchedProject}
                  onViewInventoryMatch={handleViewInventoryMatch}
                  onJoinProjectGroup={handleJoinPropertyGroup}
                />
              </View>
            </View>
          )}

          {/* The floating "AI Lead Assist" button was removed — the Sell / Buy /
              Rent starter chips above the composer are now the entry point. */}
        </View>
      )}

      {/* ── Sell / Buy / Rent starters ──
          Sits right above the input on the AI Lead Matching landing page, so a
          new user immediately sees what this section does. Tapping one opens the
          assistant with that intent already answered, continuing the flow. ── */}
      {!aiActive && aiAllowed && (
        <View style={ip.stripWrap}>
          <Text style={ip.stripLabel}>Shuru karein — tap karein</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ip.stripRow}
            keyboardShouldPersistTaps="handled"
          >
            {([
              // `v` is the intent sent to the assistant — only the label is
              // presentational, so these values must stay as they are.
              { v: 'buy', icon: '🔑', label: 'Buy Property' },
              { v: 'sell', icon: '🏷️', label: 'Sell Property' },
              { v: 'rent', icon: '🏠', label: 'Rent Property' },
            ] as const).map((opt) => (
              <Pressable key={opt.v} style={ip.chip} onPress={() => aiStartWithIntent(opt.v)}>
                <Text style={ip.chipIcon}>{opt.icon}</Text>
                <Text style={ip.chipText}>{opt.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Composer — the SINGLE input box. Routes to the group when in normal
          mode, and to the AI assistant when AI mode is active.
          Hidden while the assistant question renders its OWN input (option
          chips, the amount + unit picker, city/locality search) or is in a
          locked state. Without this gate the rich control and this composer both
          showed, giving two stacked input rows. */}
      {!(aiActive && aiOwnsInput({ inputType: aiInputType })) && (
      <View style={s.composer}>
        {/* Attachment options: Camera / Gallery / Files (group mode only) */}
        {!aiActive && showAttachMenu && canUploadMedia && (
          <View style={s.attachRow}>
            <Pressable onPress={pickFromCamera} disabled={uploading} style={s.attachOpt}>
              <View style={[s.attachIcon, { backgroundColor: '#EFF6FF' }]}><Camera size={17} color="#2563EB" /></View>
              <Text style={s.attachLabel}>Camera</Text>
            </Pressable>
            <Pressable onPress={pickFromGallery} disabled={uploading} style={s.attachOpt}>
              <View style={[s.attachIcon, { backgroundColor: '#F0FDF4' }]}><ImageIcon size={17} color={colors.greenText} /></View>
              <Text style={s.attachLabel}>Gallery</Text>
            </Pressable>
            <Pressable onPress={pickFile} disabled={uploading} style={s.attachOpt}>
              <View style={[s.attachIcon, { backgroundColor: '#FFF8F0' }]}><FileText size={17} color={colors.brand} /></View>
              <Text style={s.attachLabel}>PDF</Text>
            </Pressable>
          </View>
        )}

        <View style={s.textRow}>
          {!aiActive ? (
            canUploadMedia ? (
              <Pressable
                onPress={() => setShowAttachMenu(v => !v)}
                disabled={uploading}
                style={[s.attachBtn, showAttachMenu && { backgroundColor: colors.brandTint }]}
              >
                {uploading
                  ? <ActivityIndicator size="small" color={colors.brand} />
                  : <Paperclip size={18} color={showAttachMenu ? colors.brand : colors.muted2} />}
              </Pressable>
            ) : null
          ) : (
            <View style={[s.attachBtn, { backgroundColor: colors.brandTint, borderColor: `${colors.brand}55` }]}>
              <Sparkles size={16} color={colors.brand} />
            </View>
          )}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={aiActive ? 'Answer the AI…' : 'Type a message…'}
            placeholderTextColor={colors.muted}
            style={s.textInput}
            multiline
            onSubmitEditing={handleComposerSend}
          />
          <Pressable onPress={handleComposerSend} disabled={!text.trim()} style={[s.sendBtn, !text.trim() && { opacity: 0.4 }]}>
            <Send size={16} color="#fff" />
          </Pressable>
        </View>
      </View>
      )}

      {/* Requirement composer sheet */}
      <RequirementSheet
        visible={postMode === 'requirement'}
        form={reqForm}
        setForm={setReqForm}
        onClose={() => setPostMode('text')}
        onSubmit={postRequirement}
      />

      {/* Inventory composer sheet */}
      <InventorySheet
        visible={postMode === 'inventory'}
        form={invForm}
        setForm={setInvForm}
        onClose={() => setPostMode('text')}
        onSubmit={postInventory}
      />

      {/* ── Post view — lists ALL properties the user has posted so far, plus
          (if present) the current AI-collected draft as a postable card. Each
          card is compact with an expand toggle for full details. ── */}
      <Modal visible={showPost} transparent animationType="slide" onRequestClose={() => setShowPost(false)}>
        <Pressable style={pd.overlay} onPress={() => setShowPost(false)}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.head}>
              <Building2 size={18} color={colors.greenText} />
              <View style={{ flex: 1 }}>
                <Text style={pd.headTitle}>My Posts</Text>
                <Text style={pd.headSub}>{postedCards.length} posted{postDraft ? ' · 1 ready to post' : ''} · AI Assist</Text>
              </View>
              <Pressable onPress={() => setShowPost(false)} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>

            <ScrollView
              style={{ maxHeight: '78%' }}
              contentContainerStyle={{ gap: 10, paddingBottom: 12 }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {/* Draft ready to post (from the current AI conversation) */}
              {postDraft && (
                <PostCard
                  item={{ title: postDraft.title, subtitle: postDraft.subtitle, price: postDraft.price, tags: postDraft.fields.filter(f => /bhk|area|type/i.test(f.label)).map(f => f.value) }}
                  posted={false}
                  cooldownLeftMs={0}
                  posting={postingDraft}
                  onPost={publishDraft}
                  onView={() => setViewProperty({ title: postDraft.title, subtitle: postDraft.subtitle, price: postDraft.price, fields: postDraft.fields })}
                />
              )}

              {/* Already-posted properties. Source = owned real Projects plus
                  this user's backend ExtractedLead inventory, so My Posts is
                  complete and survives reinstall. Local storage is consulted
                  only for the per-property 8h re-post cooldown. */}
              {postedCards.map((disp: any) => {
                // Cooldown comes from whichever local record matches this lead —
                // by leadId first, else by the property's title+location.
                const local = postedList.find((x: any) =>
                  (x.projectId && disp.projectId && String(x.projectId) === String(disp.projectId)) ||
                  (x.leadId && x.leadId === disp.id) ||
                  (x.title && disp.title && x.title === disp.title && x.subtitle === disp.subtitle)
                );
                const postedAt = local?.postedAt || 0;
                const leftMs = postedAt ? Math.max(0, POST_COOLDOWN_MS - (Date.now() - postedAt)) : 0;
                const backendProjectId = disp.projectId || local?.projectId;
                const backend = backendProjectId
                  ? myProjects.find((p) => String(p.id) === String(backendProjectId))
                  : null;
                return (
                  <PostCard
                    key={disp.id}
                    item={disp}
                    posted
                    cooldownLeftMs={leftMs}
                    posting={false}
                    onPost={() => {
                      // Re-post this property's card into the group (after cooldown).
                      if (backend) repostProject(backend, disp);
                      else repostFromEntry({ ...(local || {}), leadId: disp.id, title: disp.title, subtitle: disp.subtitle, price: disp.price, fields: disp.fields, isSellable: true, intent: 'sell' }, disp);
                    }}
                    onView={() => setViewProperty(disp)}
                  />
                );
              })}

              {postedCards.length === 0 && !postDraft && (
                <Text style={pd.empty}>Abhi tak koi property post nahi ki. AI ko apni sell/rent property batayein, phir yahan se post karein.</Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── View Property detail sheet ── */}
      <Modal visible={!!viewProperty} transparent animationType="slide" onRequestClose={() => setViewProperty(null)}>
        <Pressable style={pd.overlay} onPress={() => setViewProperty(null)}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.head}>
              <View style={pd.cardIcon}><Building2 size={22} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={pd.headTitle} numberOfLines={1}>{viewProperty?.title || 'Property'}</Text>
                {viewProperty?.subtitle ? <Text style={pd.headSub} numberOfLines={1}>📍 {viewProperty.subtitle}</Text> : null}
              </View>
              {viewProperty?.price ? <Text style={pd.cardPrice}>{viewProperty.price}</Text> : null}
              <Pressable onPress={() => setViewProperty(null)} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>

            <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 6, gap: 12 }} showsVerticalScrollIndicator={false}>
              {!!viewProperty?.image && (
                <Image source={{ uri: viewProperty.image }} style={pd.detailHero} resizeMode="cover" />
              )}

              <View style={pd.detailList}>
                {(viewProperty?.fields || []).map((f: any, i: number) => (
                  <View key={i} style={pd.detailRow}>
                    <Text style={pd.detailLabel}>{f.label}</Text>
                    <Text style={pd.detailValue} numberOfLines={3}>{f.value}</Text>
                  </View>
                ))}
              </View>

              {/* Preview Info is deliberately short: basics only, no media. */}
              {!viewProperty?.compact && (viewProperty?.galleryImages?.length > 0 || viewProperty?.videos?.length > 0 || viewProperty?.brochureUrl || viewProperty?.layoutImage) && (
                <View style={pd.mediaSection}>
                  <Text style={pd.mediaTitle}>Media</Text>

                  {viewProperty?.galleryImages?.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {viewProperty.galleryImages.map((url: string, i: number) => (
                        <Pressable key={`${url}-${i}`} onPress={() => Linking.openURL(url)}>
                          <Image source={{ uri: url }} style={pd.mediaThumb} resizeMode="cover" />
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}

                  <View style={pd.mediaActions}>
                    {viewProperty?.layoutImage && (
                      <Pressable style={pd.mediaBtn} onPress={() => Linking.openURL(viewProperty.layoutImage)}>
                        <ImageIcon size={13} color={colors.brand} /><Text style={pd.mediaBtnText}>Layout</Text>
                      </Pressable>
                    )}
                    {(viewProperty?.videos || []).map((url: string, i: number) => (
                      <Pressable key={`${url}-${i}`} style={pd.mediaBtn} onPress={() => Linking.openURL(url)}>
                        <FileText size={13} color={colors.brand} /><Text style={pd.mediaBtnText}>Video {i + 1}</Text>
                      </Pressable>
                    ))}
                    {viewProperty?.brochureUrl && (
                      <Pressable style={pd.mediaBtn} onPress={() => Linking.openURL(viewProperty.brochureUrl)}>
                        <FileText size={13} color={colors.brand} /><Text style={pd.mediaBtnText}>Brochure</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Disappearing messages options (WhatsApp-style) ── */}
      <Modal visible={showDisappear} transparent animationType="slide" onRequestClose={() => setShowDisappear(false)}>
        <Pressable style={pd.overlay} onPress={() => setShowDisappear(false)}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.head}>
              <Clock size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={pd.headTitle}>Disappearing messages</Text>
                <Text style={pd.headSub}>AI Assist ke messages chosen time ke baad apne aap gayab honge</Text>
              </View>
              <Pressable onPress={() => setShowDisappear(false)} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>
            <View style={{ gap: 2 }}>
              {DISAPPEAR_OPTIONS.map(opt => (
                <Pressable
                  key={opt.ms}
                  style={dp.optRow}
                  onPress={async () => {
                    setDisappearMs(opt.ms);
                    await disappearStorage.set(opt.ms);
                    setShowDisappear(false);
                    toast.show(opt.ms ? `Messages disappear after ${opt.label}` : 'Disappearing off', 'success');
                  }}
                >
                  <Text style={dp.optLabel}>{opt.label}</Text>
                  {disappearMs === opt.ms && <Check size={17} color={colors.brand} />}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Off-screen QR renderer used only by Download QR. It is deliberately
          not a modal, so choosing a specific menu action never opens the generic
          Share bottom sheet shown in the bug screenshot. */}
      {qrExport && (
        <View pointerEvents="none" style={s.qrExporter}>
          <QRCode
            value={qrExport.url}
            size={320}
            color={colors.night}
            backgroundColor={colors.white}
            quietZone={16}
            getRef={(node: any) => { qrRef.current = node; }}
          />
        </View>
      )}

      {/* ── Lead detected from a free-text message (like the website) ──
          Shows the parsed requirement; confirming runs matching + saves the lead. */}
      <Modal visible={!!leadDetect} transparent animationType="slide" onRequestClose={() => setLeadDetect(null)}>
        <Pressable style={ld.overlay} onPress={() => setLeadDetect(null)}>
          <Pressable style={ld.sheet} onPress={() => {}}>
            <View style={ld.head}>
              <Sparkles size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={ld.title}>Requirement detected</Text>
                <Text style={ld.sub}>Aapke message se ye detail mili — confirm karke match dekhein</Text>
              </View>
              <Pressable onPress={() => setLeadDetect(null)} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>

            {(() => {
              const p = leadDetect?.extraction?.params || {};
              const intent = leadDetect?.extraction?.intent || 'requirement';
              const rows: { label: string; value: string }[] = [];
              const push = (label: string, v: any) => { if (v != null && String(v).trim()) rows.push({ label, value: String(v) }); };
              push('Looking to', intent === 'inventory' ? 'Sell / List' : 'Buy / Rent');
              push('Property type', p.propertyType);
              push('BHK', p.bhkType);
              push('Location', p.location || p.locationRaw);
              push('City', p.city);
              push('Budget', p.budget ? `₹${p.budget}L${p.budgetMax ? ` – ₹${p.budgetMax}L` : ''}` : '');
              push('Possession', p.possessionNeeded);
              return (
                <View style={ld.card}>
                  {rows.length ? rows.map((r, i) => (
                    <View key={i} style={ld.row}>
                      <Text style={ld.rowLabel}>{r.label}</Text>
                      <Text style={ld.rowValue} numberOfLines={1}>{r.value}</Text>
                    </View>
                  )) : <Text style={ld.rowValue}>Basic requirement detected.</Text>}
                </View>
              );
            })()}

            <View style={ld.actions}>
              <Pressable onPress={() => setLeadDetect(null)} style={ld.dismissBtn}>
                <Text style={ld.dismissText}>Dismiss</Text>
              </Pressable>
              <Pressable onPress={confirmDetectedLead} disabled={confirmingLead} style={[ld.findBtn, confirmingLead && { opacity: 0.6 }]}>
                {confirmingLead
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Search size={14} color="#fff" /><Text style={ld.findText}>Find Matches</Text></>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Matching Results Modal ── */}
      <Modal visible={showMatching} transparent animationType="slide" onRequestClose={() => setShowMatching(false)}>
        <Pressable style={pd.overlay} onPress={() => setShowMatching(false)}>
          <Pressable style={pd.sheet} onPress={() => {}}>
            <View style={pd.head}>
              <Search size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={pd.headTitle}>Matching Properties</Text>
                <Text style={pd.headSub}>
                  {matchingLoading ? 'Searching...' : 
                   matchingResults.length > 0 ? `${matchingResults.length} properties found` : 
                   'Results will appear here'}
                </Text>
              </View>
              <Pressable onPress={() => setShowMatching(false)} hitSlop={8}><X size={20} color={colors.ink} /></Pressable>
            </View>

            {matchingLoading ? (
              <View style={{ paddingVertical: 60, alignItems: 'center' }}>
                <ActivityIndicator color={colors.brand} size="large" />
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 12 }}>Finding matching properties...</Text>
              </View>
            ) : matchingError ? (
              <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 20 }}>
                <Text style={{ fontSize: 13, color: colors.muted2, textAlign: 'center' }}>{matchingError}</Text>
              </View>
            ) : matchingResults.length > 0 ? (
              <ScrollView style={{ maxHeight: 500 }} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
                {matchingResults.map((match, idx) => {
                  const project = match.project || {};
                  const score = Math.round(match.score || 0);
                  const matchedOn = match.matchedOn || [];
                  const scoreColor = score >= 70 ? colors.greenText : score >= 50 ? colors.amberText : colors.muted2;

                  return (
                    <View key={idx} style={mts.card}>
                      {/* Header with name and score */}
                      <View style={mts.cardHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={mts.projectName} numberOfLines={1}>{project.projectName || 'Property'}</Text>
                          <Text style={mts.projectLoc} numberOfLines={1}>
                            📍 {[project.location, project.city].filter(Boolean).join(', ') || 'Location not specified'}
                          </Text>
                        </View>
                        <View style={[mts.scoreBadge, { backgroundColor: `${scoreColor}18`, borderColor: scoreColor }]}>
                          <Text style={[mts.scoreText, { color: scoreColor }]}>{score}%</Text>
                        </View>
                      </View>

                      {/* Property details */}
                      <View style={mts.detailsRow}>
                        {project.configuration?.bhkOptions && project.configuration.bhkOptions.length > 0 && (
                          <View style={mts.detailChip}>
                            <Text style={mts.detailChipText}>{project.configuration.bhkOptions.join(', ')}</Text>
                          </View>
                        )}
                        {project.pricing?.startingPrice && (
                          <View style={mts.detailChip}>
                            <Text style={mts.detailChipText}>{fmtPrice(project.pricing.startingPrice)}</Text>
                          </View>
                        )}
                      </View>

                      {/* Matched criteria */}
                      {matchedOn.length > 0 && (
                        <View style={mts.matchedRow}>
                          <Text style={mts.matchedLabel}>Matched on:</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                            {matchedOn.slice(0, 4).map((criterion: string, i: number) => (
                              <View key={i} style={mts.matchTag}>
                                <Text style={mts.matchTagText}>{criterion}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}

                      {/* Owner info if available */}
                      {project.owner && (
                        <Text style={mts.ownerText} numberOfLines={1}>
                          By {project.owner.name || 'Builder'}{project.owner.companyName ? ` · ${project.owner.companyName}` : ''}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 20 }}>
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center' }}>
                  No properties matched your requirement yet. Try adjusting your preferences.
                </Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

    </KeyboardAvoidingView>
  );
}

// ═══════════ Requirement composer (bottom sheet) ═══════════
function RequirementSheet({ visible, form, setForm, onClose, onSubmit }: {
  visible: boolean; form: any; setForm: (fn: any) => void; onClose: () => void; onSubmit: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sh.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={sh.sheet}>
          <View style={[sh.head, { backgroundColor: colors.brand }]}>
            <Search size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={sh.headTitle}>Post Client Requirement</Text>
              <Text style={sh.headSub}>Auto-match with available inventory</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><X size={20} color="#fff" /></Pressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
            <Field label="Configuration" required>
              <View style={sh.chipsWrap}>
                {BHK_TYPES.map(o => (
                  <Pressable key={o} onPress={() => setForm((f: any) => ({ ...f, bhkType: o }))} style={[sh.chip, form.bhkType === o && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                    <Text style={[sh.chipText, form.bhkType === o && { color: '#fff' }]}>{o}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <View style={sh.row2}>
              <Field label="Budget (Lakhs)" required flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 85" placeholderTextColor={colors.muted} value={form.budget} onChangeText={(v: string) => setForm((f: any) => ({ ...f, budget: v }))} />
              </Field>
              <Field label="City" flex>
                <TextInput style={sh.input} placeholder="e.g. Nagpur" placeholderTextColor={colors.muted} value={form.city} onChangeText={(v: string) => setForm((f: any) => ({ ...f, city: v }))} />
              </Field>
            </View>

            <Field label="Area / Locality" required>
              <TextInput style={sh.input} placeholder="e.g. Manish Nagar" placeholderTextColor={colors.muted} value={form.area} onChangeText={(v: string) => setForm((f: any) => ({ ...f, area: v }))} />
            </Field>

            <Field label="Possession">
              <View style={sh.chipsWrap}>
                {POSSESSION_NEEDED.map(o => (
                  <Pressable key={o.v} onPress={() => setForm((f: any) => ({ ...f, possessionNeeded: o.v }))} style={[sh.chip, form.possessionNeeded === o.v && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                    <Text style={[sh.chipText, form.possessionNeeded === o.v && { color: '#fff' }]}>{o.l}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <Field label="Urgency">
              <View style={sh.chipsWrap}>
                {URGENCY.map(o => (
                  <Pressable key={o.v} onPress={() => setForm((f: any) => ({ ...f, urgency: o.v }))} style={[sh.chip, form.urgency === o.v && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                    <Text style={[sh.chipText, form.urgency === o.v && { color: '#fff' }]}>{o.l}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <View style={sh.switchRow}>
              <Text style={sh.switchLabel}>Loan Required</Text>
              <Switch value={form.loanRequired} onValueChange={(v: boolean) => setForm((f: any) => ({ ...f, loanRequired: v }))} trackColor={{ true: colors.brand }} thumbColor="#fff" />
            </View>

            <Field label="Client Notes">
              <TextInput style={[sh.input, { height: 66, textAlignVertical: 'top' }]} multiline placeholder="Any extra details…" placeholderTextColor={colors.muted} value={form.clientNotes} onChangeText={(v: string) => setForm((f: any) => ({ ...f, clientNotes: v }))} />
            </Field>
          </ScrollView>

          <View style={sh.footer}>
            <Pressable onPress={onSubmit} style={[sh.submitBtn, { backgroundColor: colors.brand }]}>
              <Text style={sh.submitText}>Post & Auto-Match 🚀</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ═══════════ Inventory composer (bottom sheet) ═══════════
function InventorySheet({ visible, form, setForm, onClose, onSubmit }: {
  visible: boolean; form: any; setForm: (fn: any) => void; onClose: () => void; onSubmit: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sh.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={sh.sheet}>
          <View style={[sh.head, { backgroundColor: colors.green }]}>
            <Building2 size={18} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={sh.headTitle}>Post Inventory Card</Text>
              <Text style={sh.headSub}>Share what you have available</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><X size={20} color="#fff" /></Pressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
            <Field label="BHK Options" required>
              <TextInput style={sh.input} placeholder="e.g. 2BHK, 3BHK" placeholderTextColor={colors.muted} value={form.bhkOptions} onChangeText={(v: string) => setForm((f: any) => ({ ...f, bhkOptions: v }))} />
            </Field>

            <View style={sh.row2}>
              <Field label="Min Price (L)" required flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 50" placeholderTextColor={colors.muted} value={form.min} onChangeText={(v: string) => setForm((f: any) => ({ ...f, min: v }))} />
              </Field>
              <Field label="Max Price (L)" flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 90" placeholderTextColor={colors.muted} value={form.max} onChangeText={(v: string) => setForm((f: any) => ({ ...f, max: v }))} />
              </Field>
            </View>

            <View style={sh.row2}>
              <Field label="Area / Location" required flex>
                <TextInput style={sh.input} placeholder="e.g. Baner" placeholderTextColor={colors.muted} value={form.area} onChangeText={(v: string) => setForm((f: any) => ({ ...f, area: v }))} />
              </Field>
              <Field label="City" flex>
                <TextInput style={sh.input} placeholder="e.g. Pune" placeholderTextColor={colors.muted} value={form.city} onChangeText={(v: string) => setForm((f: any) => ({ ...f, city: v }))} />
              </Field>
            </View>

            <Field label="Possession Status">
              <View style={sh.chipsWrap}>
                {POSSESSION_STATUS.map(o => (
                  <Pressable key={o.v} onPress={() => setForm((f: any) => ({ ...f, possessionStatus: o.v }))} style={[sh.chip, form.possessionStatus === o.v && { backgroundColor: colors.green, borderColor: colors.green }]}>
                    <Text style={[sh.chipText, form.possessionStatus === o.v && { color: '#fff' }]}>{o.l}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <View style={sh.row2}>
              <View style={[sh.switchRow, { flex: 1, marginTop: 0 }]}>
                <Text style={sh.switchLabel}>Bank Loan</Text>
                <Switch value={form.bankLoanAvailable} onValueChange={(v: boolean) => setForm((f: any) => ({ ...f, bankLoanAvailable: v }))} trackColor={{ true: colors.green }} thumbColor="#fff" />
              </View>
              <Field label="Commission %" flex>
                <TextInput style={sh.input} keyboardType="numeric" placeholder="e.g. 2" placeholderTextColor={colors.muted} value={form.commissionPercent} onChangeText={(v: string) => setForm((f: any) => ({ ...f, commissionPercent: v }))} />
              </Field>
            </View>

            <Field label="Description">
              <TextInput style={[sh.input, { height: 66, textAlignVertical: 'top' }]} multiline placeholder="Highlights, offers…" placeholderTextColor={colors.muted} value={form.description} onChangeText={(v: string) => setForm((f: any) => ({ ...f, description: v }))} />
            </Field>
          </ScrollView>

          <View style={sh.footer}>
            <Pressable onPress={onSubmit} style={[sh.submitBtn, { backgroundColor: colors.green }]}>
              <Text style={sh.submitText}>Post Inventory 📢</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, required, flex, children }: { label: string; required?: boolean; flex?: boolean; children: React.ReactNode }) {
  return (
    <View style={[{ gap: 7 }, flex && { flex: 1 }]}>
      <Text style={sh.label}>{label}{required ? <Text style={{ color: colors.red }}> *</Text> : null}</Text>
      {children}
    </View>
  );
}

// Normalize a posted message from REST/socket into our GroupMessage shape.
let _msgSeq = 0;
function normalizeMsg(m: any, roomId: string): GroupMessage {
  return {
    id: String(m._id || m.id || `tmp_${Date.now()}_${_msgSeq++}`),
    room: String(m.room || roomId),
    sender: {
      id: String(m.sender?._id || m.sender?.id || ''),
      name: m.sender?.name || '',
      role: m.sender?.role || '',
      companyName: m.sender?.companyName,
      isVerified: m.sender?.isVerified === true,
      verificationStatus: m.sender?.verificationStatus,
      // Present on inventory cards only — the card's Call button dials it.
      phone: m.sender?.phone,
    },
    messageType: m.messageType || 'text',
    content: m.content || '',
    attachment: m.attachment,
    requirementCard: m.requirementCard,
    inventoryCard: m.inventoryCard,
    matchResults: m.matchResults,
    createdAt: m.createdAt || new Date().toISOString(),
  };
}

// ── Shared card action row ──
// Used by all three property surfaces: the inventory card, the AI Match Found
// card and each requirement match row. Before this existed the inventory card
// hand-rolled its own button row, the match rows had a single Interested button,
// and the AI Match card had no actions at all — so "open this property" was
// missing exactly where matching results appear.
type CardActionIcon = 'details' | 'join' | 'call' | 'interested';

const CARD_ACTION_ICON = {
  details: Eye,
  join: UserPlus,
  call: Phone,
  interested: Check,
} as const;

const CardActions = React.memo(function CardActions({ actions, tone }: {
  actions: Array<{ key: string; label: string; icon: CardActionIcon; ghost?: boolean; onPress: () => void }>;
  tone: 'green' | 'brand';
}) {
  const solidBg = tone === 'green' ? colors.greenText : colors.brand;
  const accent = tone === 'green' ? colors.greenText : colors.brand;
  const ghostBorder = tone === 'green' ? colors.greenBorder : `${colors.brand}55`;
  const divider = tone === 'green' ? '#DCFCE7' : `${colors.brand}22`;

  return (
    <View style={[mbs.cardActions, { borderTopColor: divider }]}>
      {actions.map(action => {
        const Icon = CARD_ACTION_ICON[action.icon];
        const color = action.ghost ? accent : '#fff';
        return (
          <Pressable
            key={action.key}
            onPress={action.onPress}
            style={[
              mbs.cardActionBtn,
              action.ghost
                ? { backgroundColor: colors.white, borderWidth: 1, borderColor: ghostBorder }
                : { backgroundColor: solidBg },
            ]}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Icon size={12} color={color} />
            <Text style={[mbs.cardActionText, { color }]} numberOfLines={1} adjustsFontSizeToFit>
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

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

// ── Message bubble ──
// Memoised: without this, every keystroke in the composer (whose state lives in
// GroupChatEmbedded) re-rendered every visible bubble in the thread.
const MessageBubble = React.memo(function MessageBubble({ 
  msg, meId, onInterested, onPropertyViewDetails, onPropertyCall, onJoinPropertyGroup, onPreviewMatch, projectId 
}: {
  msg: GroupMessage; 
  meId: string; 
  onInterested: (projectId: string, messageId: string) => void;
  onPropertyViewDetails: (projectId: string, fallback?: InventoryCard) => void;
  onPropertyCall: (projectId: string, fallbackNumber?: string, posterPhone?: string) => void;
  onJoinPropertyGroup: (projectId: string) => void;
  onPreviewMatch: (match: any) => void;
  projectId: string;
}) {
  const isMe = msg.sender.id === meId;

  if (msg.messageType === 'system') {
    if (msg.content?.startsWith('📋 Project:')) return null;
    return <Text style={mbs.system}>{msg.content}</Text>;
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

    return (
      <View style={[mbs.cardWrap, { alignSelf: 'flex-start' }]}>
        <View style={mbs.propertyCard}>
          {/* Top strip: label + who posted it */}
          <View style={mbs.propertyHeaderRow}>
            <View style={mbs.propertyLabelPill}>
              <Building2 size={11} color={colors.greenText} />
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
                <Building2 size={20} color={colors.greenText} />
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
                <Text style={[mbs.propertyTagText, { color: '#fff' }]}>{possessionLabel}</Text>
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

          <CardActions
            tone="green"
            actions={[
              { key: 'details', label: 'View Details', icon: 'details', ghost: true, onPress: () => onPropertyViewDetails(cardProjectId, inv) },
              { key: 'join', label: 'Join Group', icon: 'join', onPress: () => onJoinPropertyGroup(cardProjectId) },
              { key: 'call', label: 'Call', icon: 'call', onPress: () => onPropertyCall(cardProjectId, inv.callNumber, msg.sender.phone) },
            ]}
          />

          {!!messageClock(msg.createdAt) && (
            <Text style={mbs.propertyTime}>{messageClock(msg.createdAt)}</Text>
          )}
        </View>
      </View>
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

  // image attachment
  if (msg.messageType === 'image' && msg.content) {
    return (
      <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
        <View style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem, { padding: 4 }]}>
          {!isMe && <Text style={[mbs.textSender, { marginHorizontal: 6, marginTop: 4 }]}>{msg.sender.name} · {msg.sender.role}</Text>}
          <Pressable onPress={() => Linking.openURL(msg.content)}>
            <Image source={{ uri: msg.content }} style={mbs.attachImage} resizeMode="cover" />
          </Pressable>
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
          <Pressable onPress={() => Linking.openURL(msg.content)} style={mbs.fileRow}>
            <FileText size={18} color={isMe ? '#fff' : colors.brand} />
            <Text style={[mbs.fileName, { color: isMe ? '#fff' : colors.ink }]} numberOfLines={1}>{fileName}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // text
  return (
    <View style={[{ flexDirection: 'row' }, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
      <View style={[mbs.textBubble, isMe ? mbs.textMe : mbs.textThem]}>
        {!isMe && <Text style={mbs.textSender}>{msg.sender.name} · {msg.sender.role}</Text>}
        <Text style={[mbs.textContent, { color: isMe ? '#fff' : colors.ink }]}>{msg.content}</Text>
      </View>
    </View>
  );
});

function Tag({ text, brand }: { text: string; brand?: boolean }) {
  return (
    <View style={[mbs.tag, brand && { backgroundColor: colors.brandTint }]}>
      <Text style={[mbs.tagText, brand && { color: colors.brand }]}>{text}</Text>
    </View>
  );
}

function Chips({ options, value, onChange, small }: { options: string[]; value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map(o => (
        <Pressable key={o} onPress={() => onChange(o)} style={[cs.chip, value === o && cs.chipOn, small && { paddingVertical: 6 }]}>
          <Text style={[cs.chipText, value === o && cs.chipTextOn]}>{o}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function SelectRow({ label, options, value, onChange }: { label: string; options: { v: string; l: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={cs.selLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {options.map(o => (
          <Pressable key={o.v} onPress={() => onChange(o.v)} style={[cs.chip, value === o.v && cs.chipOn]}>
            <Text style={[cs.chipText, value === o.v && cs.chipTextOn]}>{o.l}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, marginBottom: 6, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 13, color: colors.ink },
  // Inline (expanded) search that fills the header row when the magnifier is tapped.
  searchInline: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8, minHeight: 46 },
  newBtn: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brandTint },
  newBtnText: { fontSize: 12, fontWeight: '800', color: colors.brand },
  roomRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, backgroundColor: colors.white },
  roomRowPinned: { backgroundColor: `${colors.brand}08` },
  roomAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  pinBadge: { backgroundColor: colors.brandTint, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  pinText: { fontSize: 9, fontWeight: '800', color: colors.brand },
  roomNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  roomName: { fontSize: 13.5, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  roomTypeChip: { flexShrink: 0, backgroundColor: colors.slateBg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  roomTypeChipText: { fontSize: 8.5, fontWeight: '800', color: colors.slateText, letterSpacing: 0.2 },
  roomMeta: { fontSize: 10.5, color: colors.muted2, marginTop: 1 },
  roomMetaSecondary: { fontSize: 10.5, fontWeight: '700', color: colors.slateText, marginTop: 1 },
  roomTrailing: { alignItems: 'flex-end', gap: 5 },
  roomTime: { fontSize: 10, color: colors.muted },
  unreadBadge: { minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { fontSize: 9.5, fontWeight: '800', color: '#fff' },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 10 },
  emptyText: { fontSize: 13, color: colors.muted },
  emptyHint: { fontSize: 11.5, color: colors.muted2, textAlign: 'center', paddingHorizontal: 32, lineHeight: 17 },
  joinBtn: { paddingHorizontal: 16, paddingVertical: 9, backgroundColor: colors.brand, borderRadius: 12, marginTop: 4 },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  smallJoin: { minWidth: 76, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.brand },
  smallJoinText: { fontSize: 11.5, fontWeight: '800', color: colors.brand },

  // Section headers for the single room SectionList (My Groups / Discover Groups).
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 7, backgroundColor: colors.cream },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: colors.muted2, letterSpacing: 0.3 },
  sectionCountPill: { backgroundColor: colors.brandTint, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 8 },
  sectionCountText: { fontSize: 9.5, fontWeight: '800', color: colors.brand },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.ink },
  fieldInput: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 13, color: colors.ink, backgroundColor: colors.white },
  primaryBtn: { backgroundColor: colors.brand, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  threadHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line, zIndex: 20 },
  threadAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  threadTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },
  threadSub: { fontSize: 10.5, color: colors.muted, marginTop: 1 },
  // AI action row in the group header (Post · Matching · 3-dot)
  headerAiRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerAiBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  headerAiBtnText: { fontSize: 11, fontWeight: '800' },
  headerAiDots: { padding: 4 },
  // Standalone AI action row used in headerless mode (the AI Leads hub supplies
  // its own navigation above). Same button styling as the in-header row, so the
  // two placements look identical.
  aiActionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line,
    zIndex: 20,
  },

  // Floating Action Buttons (FABs)
  fabContainer: {
    position: 'absolute',
    right: 16,
    bottom: 80, // Above the composer/input area
    gap: 12,
    zIndex: 100,
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 28,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  fabMyPost: {
    backgroundColor: '#F0FDF4',
    borderColor: colors.greenBorder,
  },
  fabMatching: {
    backgroundColor: colors.brandTint,
    borderColor: `${colors.brand}88`,
  },
  fabText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  menu: { position: 'absolute', right: 8, top: 52, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingVertical: 4, minWidth: 180, zIndex: 30, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  menuText: { fontSize: 12.5, fontWeight: '600', color: colors.muted2 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.blueBg, borderBottomWidth: 1, borderBottomColor: colors.blueBorder, paddingHorizontal: 14, paddingVertical: 10 },
  bannerIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  bannerThumb: { width: 42, height: 42, borderRadius: 9, backgroundColor: colors.white },
  bannerName: { fontSize: 12.5, fontWeight: '800', color: colors.blueText },
  bannerMeta: { fontSize: 10, color: colors.blueText, marginTop: 1 },
  bannerMenuBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  // Kept mounted but visually outside the viewport only while exporting a QR.
  // opacity:0 is not used because some native SVG renderers skip rasterisation
  // for fully transparent trees.
  qrExporter: { position: 'absolute', left: -1000, top: -1000, width: 352, height: 352, padding: 16, backgroundColor: '#fff' },

  composer: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 10 },
  quickRow: { flexDirection: 'row', gap: 8 },
  aiInlineBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.brandTint, borderBottomWidth: 1, borderBottomColor: `${colors.brand}33` },
  aiBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33` },
  aiBackText: { fontSize: 11.5, fontWeight: '800', color: colors.brand },
  aiPrivatePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}44`, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  aiPrivateText: { fontSize: 10, fontWeight: '800', color: colors.brand, letterSpacing: 0.2 },
  aiMenuBtn: { padding: 6, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33` },
  // Small floating 3-dot menu button (top-right) after removing the banner bar.
  aiMenuFloat: { position: 'absolute', right: 10, top: 8, zIndex: 40, padding: 6, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33`, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  aiMenu: { position: 'absolute', right: 10, top: 40, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingVertical: 4, minWidth: 190, zIndex: 40, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  aiMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  aiMenuText: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  // AI Assist overlay (covers the message area while AI mode is active)
  aiOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.cream },
  quickChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  quickChipText: { fontSize: 11.5, fontWeight: '800' },
  modeRow: { flexDirection: 'row', gap: 6 },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  modeBtnActive: { backgroundColor: colors.night, borderColor: colors.night },
  modeText: { fontSize: 10.5, fontWeight: '800', color: colors.muted2 },
  modeTextActive: { color: '#fff' },
  textRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  attachBtn: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  attachRow: { flexDirection: 'row', gap: 10, paddingBottom: 8, paddingHorizontal: 2 },
  attachOpt: { alignItems: 'center', gap: 4 },
  attachIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  attachLabel: { fontSize: 10, fontWeight: '700', color: colors.muted2 },
  textInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 21, paddingHorizontal: 16, paddingVertical: 10, fontSize: 13.5, color: colors.ink, backgroundColor: colors.cream, maxHeight: 100, minHeight: 42 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  cardBox: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 9 },
  cardTitle: { fontSize: 12, fontWeight: '800' },
  grid2: { flexDirection: 'row', gap: 8 },
  miniInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 12, color: colors.ink, backgroundColor: colors.white },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  switchLabel: { fontSize: 12, fontWeight: '700', color: colors.ink },
  postBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 2 },
  postBtnText: { color: '#fff', fontWeight: '800', fontSize: 12.5 },
});

const ld = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 15, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 10.5, color: colors.muted2, marginTop: 1 },
  card: { backgroundColor: colors.cream, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 7 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  rowValue: { fontSize: 12.5, fontWeight: '700', color: colors.ink, flexShrink: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 10 },
  dismissBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  dismissText: { fontSize: 13, fontWeight: '700', color: colors.muted2 },
  findBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.brand },
  findText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
});

// Sell / Buy / Rent starter chips shown above the composer.
const ip = StyleSheet.create({
  stripWrap: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 9, paddingBottom: 3 },
  stripLabel: { fontSize: 9.5, fontWeight: '800', color: colors.muted, letterSpacing: 0.4, paddingHorizontal: 12, marginBottom: 7, textTransform: 'uppercase' },
  stripRow: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: `${colors.brand}55`, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  chipIcon: { fontSize: 14 },
  chipText: { fontSize: 12, fontWeight: '800', color: colors.brand },
});

const dp = StyleSheet.create({
  optRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  optLabel: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
});

const pd = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28, gap: 14, maxHeight: '88%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  headSub: { fontSize: 10.5, color: colors.muted2, marginTop: 1 },
  card: { backgroundColor: colors.cream, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  cardThumb: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.line },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  cardLoc: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  cardPrice: { fontSize: 14, fontWeight: '800', color: colors.brand },
  detailList: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  detailValue: { fontSize: 12, fontWeight: '700', color: colors.ink, flexShrink: 1, textAlign: 'right' },
  detailHero: { width: '100%', height: 170, borderRadius: 14, backgroundColor: colors.line },
  mediaSection: { gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  mediaTitle: { fontSize: 12, fontWeight: '800', color: colors.ink },
  mediaThumb: { width: 100, height: 72, borderRadius: 10, backgroundColor: colors.line },
  mediaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  mediaBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: `${colors.brand}33` },
  mediaBtnText: { fontSize: 10.5, fontWeight: '700', color: colors.brand },
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
  empty: { fontSize: 12, color: colors.muted2, textAlign: 'center', paddingVertical: 28, paddingHorizontal: 10, lineHeight: 18 },
});

const cs = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 11, fontWeight: '700', color: colors.muted2 },
  chipTextOn: { color: '#fff' },
  selLabel: { fontSize: 10, fontWeight: '700', color: colors.muted2 },
});

const mbs = StyleSheet.create({
  system: { textAlign: 'center', fontSize: 10, color: colors.muted2, backgroundColor: colors.slateBg, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  cardWrap: { width: '92%', maxWidth: 380, minWidth: 0 },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 4 },
  cardTag: { fontSize: 10, fontWeight: '800' },
  cardMain: { fontSize: 13, fontWeight: '800', color: colors.ink },
  cardSub: { fontSize: 11, color: colors.muted2 },
  cardNote: { fontSize: 10.5, color: colors.muted, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 3 },
  tag: { backgroundColor: colors.slateBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  tagText: { fontSize: 8.5, fontWeight: '700', color: colors.slateText },
  // Compact universal-group inventory card styles
  propertyCard: {
    width: '100%',
    minWidth: 0,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: colors.greenBorder,
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
    backgroundColor: '#DCFCE7',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  propertyLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.greenText,
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
    backgroundColor: '#DCFCE7',
  },
  propertyThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
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
  propertyTagPossession: {
    backgroundColor: colors.greenText,
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
  // Shared CardActions row — one definition for the inventory card, the AI match
  // card and the requirement match rows. Colours come from the `tone` prop, so
  // only geometry lives here. minWidth:0 is what lets three buttons shrink
  // inside a narrow card instead of overflowing it.
  cardActions: {
    width: '100%',
    minWidth: 0,
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  cardActionBtn: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 9,
    paddingHorizontal: 2,
    borderRadius: 9,
  },
  cardActionText: {
    fontSize: 9.5,
    fontWeight: '800',
    textAlign: 'center',
  },
  propertyTime: {
    alignSelf: 'flex-end',
    fontSize: 8.5,
    color: colors.muted,
    marginTop: -1,
  },
  matchBox: { backgroundColor: colors.white, borderWidth: 1, borderColor: `${colors.brand}33`, borderRadius: 16, padding: 10, gap: 8 },
  matchTitle: { fontSize: 11, fontWeight: '800', color: colors.brand },
  // Group match card — one per matching result.
  matchCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: `${colors.brand}33`, padding: 10, gap: 4 },
  matchCardHead: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  matchScorePill: { flexShrink: 0, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  matchScorePillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.2 },
  matchCardTitle: { flexShrink: 1, fontSize: 13, fontWeight: '800', color: colors.ink },
  matchCardLine: { fontSize: 10.5, color: colors.muted2, lineHeight: 15 },
  matchCardReason: { fontSize: 10.5, fontWeight: '700', color: colors.brand, lineHeight: 15, marginTop: 1 },
  textBubble: { maxWidth: '75%', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16 },
  textMe: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  textThem: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  textSender: { fontSize: 9, fontWeight: '800', color: colors.brand, marginBottom: 2 },
  textContent: { fontSize: 13, lineHeight: 20 },
  attachImage: { width: 200, height: 200, borderRadius: 12 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  fileName: { fontSize: 12.5, fontWeight: '600', maxWidth: 180 },
});

const sh = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  headTitle: { fontSize: 15, fontWeight: '800', color: '#fff' },
  headSub: { fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  label: { fontSize: 11.5, fontWeight: '700', color: colors.muted2 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13.5, color: colors.ink, backgroundColor: colors.cream },
  row2: { flexDirection: 'row', gap: 12 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.muted2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  switchLabel: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  footer: { padding: 14, borderTopWidth: 1, borderTopColor: colors.line },
  submitBtn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});


// Matching Results Styles
const mts = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  projectName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.2,
  },
  projectLoc: {
    fontSize: 11.5,
    color: colors.muted2,
    marginTop: 2,
  },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  scoreText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  detailChip: {
    backgroundColor: colors.slateBg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.slateBorder,
  },
  detailChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.slateText,
  },
  matchedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  matchedLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  matchTag: {
    backgroundColor: `${colors.brand}12`,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: `${colors.brand}33`,
  },
  matchTagText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.brand,
  },
  ownerText: {
    fontSize: 10.5,
    color: colors.muted,
    fontStyle: 'italic',
  },
});
