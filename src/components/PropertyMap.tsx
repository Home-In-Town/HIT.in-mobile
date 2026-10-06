// PropertyMap — Google-map property view for the "Project" tab.
// Ported from homeintown_ai-mobile's HomeMapScreen, adapted to this app's
// theme (colors), lucide icons, and expo-router navigation. Shows a full map
// with price-pin markers, a search bar + filter chips, a property count badge,
// a "24/7 AI Guide" pill, and a bottom horizontal property-card carousel.
// Tapping a price pin selects that property and scrolls the bottom carousel to
// its card; the card's ONLY action is Join Group. Both of those taps used to
// push the /(dashboard)/property-detail route as well, and that route was
// dropped from this surface on explicit user instruction — the Project tab is
// not allowed to show project details. The property sheet seen in a group
// thread is a different component (GroupChatEmbedded's own viewProperty modal)
// and still has its View Details button.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, FlatList,
  ActivityIndicator, Dimensions, Platform, Linking, Alert, Modal, Image,
} from 'react-native';
import MapView, { Marker, Region, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import {
  Search, ArrowRight, Navigation, Locate, X, MapPin, AlertTriangle,
  CheckCircle, Building2, Users, ChevronLeft,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mapPropertiesApi, MapProperty } from '../lib/mapProperties';
import { useAuth } from '../lib/authContext';
import { colors } from '../theme';
import GroupChatEmbedded from './GroupChatEmbedded';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.72;

// Default center: Nagpur (this app's primary market).
const DEFAULT_REGION: Region = {
  latitude: 21.1458,
  longitude: 79.0882,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

// "Favourites" is the signed-in user's OWN uploads, not a saved/bookmarked list.
// It sits second so it's reachable without scrolling the chip row.
const FAVOURITES = 'Favourites';
const CATEGORY_TABS = [
  { name: 'All', icon: '🏠' },
  { name: FAVOURITES, icon: '⭐' },
  { name: 'Flat', icon: '🏢' },
  { name: 'Plot', icon: '📐' },
  { name: 'Villa', icon: '🏡' },
  { name: 'Rent', icon: '💰' },
];

export default function PropertyMap({ isAdmin = false }: { isAdmin?: boolean }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const myId = user?.id ? String(user.id) : '';
  const mapRef = useRef<MapView>(null);
  const cardListRef = useRef<FlatList>(null);

  const [properties, setProperties] = useState<MapProperty[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load and a genuinely empty market used to be indistinguishable:
  // both fell through to setProperties([]) and rendered "No properties".
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [showDirectionsPanel, setShowDirectionsPanel] = useState(false);
  const [incompleteProperties, setIncompleteProperties] = useState<{ name: string; reason: string }[]>([]);
  const [showIncompletePanel, setShowIncompletePanel] = useState(false);
  // Which property's group thread the local modal is showing, if any. See the
  // modal's comment for why the thread is hosted here rather than navigated to.
  const [joinProjectId, setJoinProjectId] = useState<string | null>(null);
  // Has the hosted thread reported an OPEN room yet? GroupChatEmbedded publishes
  // onRoomOpenChange on its mount pass too, and at that point the auto-join is
  // still in flight, so acting on the first `false` would dismiss this modal
  // before the thread ever appeared. Only a true → false transition means the
  // room was actually closed from inside (Exit / Delete Group).
  const threadRoomWasOpenRef = useRef(false);
  const handleThreadRoomOpenChange = useCallback((open: boolean) => {
    if (open) { threadRoomWasOpenRef.current = true; return; }
    if (!threadRoomWasOpenRef.current) return;
    threadRoomWasOpenRef.current = false;
    setJoinProjectId(null);
  }, []);

  const incompleteCount = incompleteProperties.length;

  const fitMapToProperties = (data: MapProperty[]) => {
    if (data.length > 0 && mapRef.current) {
      const coords = data.map((p) => ({ latitude: p.lat, longitude: p.lng }));
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 150, right: 50, bottom: 260, left: 50 },
          animated: true,
        });
      }, 500);
    }
  };

  const fetchProperties = useCallback(async (force = false) => {
    try {
      setLoading(true);
      setError(null);
      const { properties: data, incompleteProperties: incomplete } = await mapPropertiesApi.getAll(force);
      setIncompleteProperties(incomplete);
      setProperties(data);
      fitMapToProperties(data);
    } catch (e: any) {
      setError(e?.message || 'Could not load properties');
      setProperties([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Permission only. `showsUserLocation` and the My Location FAB both need it,
  // but nothing needs a fix at mount — the map opens fitted to the properties,
  // so the getCurrentPositionAsync() call that used to live here paid for a GPS
  // lock and discarded the result.
  const requestLocation = async () => {
    try { await Location.requestForegroundPermissionsAsync(); }
    catch { /* the map still works from the default region */ }
  };

  useEffect(() => { fetchProperties(); requestLocation(); }, [fetchProperties]);

  // Derived, not state. The previous version filtered into state and then read
  // that state back in the same tick, which is why searching animated the map to
  // the *previous* result set's first property.
  const filteredProperties = useMemo(() => {
    let filtered = properties;
    if (activeCategory === FAVOURITES) {
      // Signed out there is no "mine", so the filter matches nothing rather
      // than everything.
      filtered = myId ? filtered.filter((p) => p.ownerId === myId) : [];
    } else if (activeCategory !== 'All') {
      const categoryMap: Record<string, string> = { Flat: 'flat', Plot: 'plot', Villa: 'villa', Rent: 'rent' };
      const target = categoryMap[activeCategory];
      if (target) filtered = filtered.filter((p) => p.type.toLowerCase().includes(target));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(
        (p) =>
          p.property_name.toLowerCase().includes(q) ||
          p.property_location.toLowerCase().includes(q) ||
          (p.city && p.city.toLowerCase().includes(q)) ||
          (p.location && p.location.toLowerCase().includes(q))
      );
    }
    return filtered;
  }, [properties, activeCategory, searchQuery, myId]);

  // The selected index addresses the filtered list, so it points at a different
  // property once that list changes. Clear it rather than highlight a random card.
  useEffect(() => { setSelectedIndex(-1); }, [activeCategory, searchQuery]);

  // Re-frame the map when the chip changes. Without this, picking Favourites
  // could leave every one of the user's pins off-screen and the filter would
  // look like it did nothing.
  const lastCategory = useRef(activeCategory);
  useEffect(() => {
    if (lastCategory.current === activeCategory) return;
    lastCategory.current = activeCategory;
    fitMapToProperties(filteredProperties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, filteredProperties]);

  // Custom marker views re-rasterise continuously while tracksViewChanges is on,
  // which is a standing cost on Android. Markers only need redrawing just after
  // the set or the selection changes.
  const [trackMarkers, setTrackMarkers] = useState(true);
  useEffect(() => {
    setTrackMarkers(true);
    const t = setTimeout(() => setTrackMarkers(false), 800);
    return () => clearTimeout(t);
  }, [filteredProperties, selectedIndex]);

  const handleSearch = () => {
    const first = filteredProperties[0];
    if (first && mapRef.current) {
      mapRef.current.animateToRegion({ latitude: first.lat, longitude: first.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 500);
    }
  };

  const handleMyLocation = async () => {
    try {
      const location = await Location.getCurrentPositionAsync({});
      mapRef.current?.animateToRegion({
        latitude: location.coords.latitude, longitude: location.coords.longitude,
        latitudeDelta: 0.05, longitudeDelta: 0.05,
      }, 500);
    } catch {
      Alert.alert('Location Error', 'Unable to get your location. Please enable location services.');
    }
  };

  const handleNavigateToProperty = (property: MapProperty) => {
    setShowDirectionsPanel(false);
    const url = Platform.select({
      android: `google.navigation:q=${property.lat},${property.lng}`,
      ios: `maps://app?daddr=${property.lat},${property.lng}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${property.lat},${property.lng}`,
    });
    if (url) {
      Linking.openURL(url).catch(() => {
        Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${property.lat},${property.lng}`);
      });
    }
  };

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        mapPadding={{ top: 150, right: 0, bottom: 200, left: 0 }}
      >
        {filteredProperties.map((property, index) => (
          <Marker
            key={property.id}
            coordinate={{ latitude: property.lat, longitude: property.lng }}
            // A pin tap selects and reveals — nothing more. It used to also call
            // openDetail(property), which pushed /(dashboard)/property-detail on
            // top of the map, so the scroll it had just started was never seen.
            // The user asked for exactly this instead: "pill tap → bas niche wala
            // card us property pe aa jaaye", with no details anywhere on this tab.
            onPress={() => {
              setSelectedIndex(index);
              cardListRef.current?.scrollToIndex({ index, animated: true });
            }}
            tracksViewChanges={trackMarkers}
          >
            <View style={[styles.marker, selectedIndex === index && styles.markerActive]}>
              <View style={[styles.markerDot, selectedIndex === index && styles.markerDotActive]} />
              <Text style={[styles.markerPrice, selectedIndex === index && styles.markerPriceActive]}>
                {property.price_short}
              </Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Search Overlay */}
      <View style={styles.searchOverlay}>

        <View style={styles.searchRow}>
          {/* Compact search: icon button expands to input inline */}
          {showSearch ? (
            <View style={styles.searchBar}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search Area, City, Town"
                placeholderTextColor={colors.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={() => { handleSearch(); setShowSearch(false); }}
                returnKeyType="search"
                autoFocus
              />
              <Pressable onPress={() => { handleSearch(); setShowSearch(false); }} style={styles.searchIconBtn}>
                <ArrowRight size={18} color={colors.muted} />
              </Pressable>
              <Pressable onPress={() => { setSearchQuery(''); setShowSearch(false); }} style={styles.searchIconBtn}>
                <X size={18} color={colors.muted} />
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.searchIconOnly} onPress={() => setShowSearch(true)}>
              <Search size={20} color={colors.ink} />
            </Pressable>
          )}

          {/* Warning button — admin only */}
          {isAdmin && (
            <Pressable
              style={[styles.filterBtn, incompleteCount > 0 && styles.filterBtnWarn]}
              onPress={() => setShowIncompletePanel(true)}
            >
              <AlertTriangle size={18} color={incompleteCount > 0 ? '#fff' : colors.ink} />
              {incompleteCount > 0 && (
                <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{incompleteCount}</Text></View>
              )}
            </Pressable>
          )}
        </View>

        {/* Category chips */}
        <FlatList
          data={CATEGORY_TABS}
          keyExtractor={(item) => item.name}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipList}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.chip, activeCategory === item.name && styles.chipActive]}
              onPress={() => setActiveCategory(item.name)}
            >
              <Text style={styles.chipIcon}>{item.icon}</Text>
              <Text style={[styles.chipText, activeCategory === item.name && styles.chipTextActive]}>{item.name}</Text>
            </Pressable>
          )}
        />
      </View>

      {/* Right FABs */}
      <View style={styles.fabColumn}>
        <Pressable style={styles.fab} onPress={() => setShowDirectionsPanel(true)}>
          <Navigation size={20} color={colors.brand} />
        </Pressable>
        <Pressable style={styles.fab} onPress={handleMyLocation}>
          <Locate size={20} color={colors.ink} />
        </Pressable>
      </View>

      {/* Count badge */}
      {!loading && filteredProperties.length > 0 && (
        <View style={styles.countBadge}>
          <Text style={styles.countText}>
            {filteredProperties.length} {filteredProperties.length === 1 ? 'property' : 'properties'}
          </Text>
        </View>
      )}

      {/* Bottom card carousel */}
      {!loading && filteredProperties.length > 0 && (
        <View style={styles.cardCarousel}>
          <FlatList
            ref={cardListRef}
            data={filteredProperties}
            horizontal
            snapToInterval={CARD_WIDTH + 12}
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cardListContent}
            keyExtractor={(item) => `card-${item.id}`}
            // Cards are a fixed CARD_WIDTH with a 12 gap, so the layout is exact
            // and worth declaring: without getItemLayout, scrollToIndex silently
            // no-ops for any index outside the rendered window (and
            // onScrollToIndexFailed below swallows it). That never showed up
            // before because the pin tap also pushed the detail route, which
            // covered the map; now the scroll IS the whole pin-tap feature.
            getItemLayout={(_, index) => ({ length: CARD_WIDTH + 12, offset: (CARD_WIDTH + 12) * index, index })}
            onScrollToIndexFailed={() => {}}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + 12));
              if (index >= 0 && index < filteredProperties.length) {
                setSelectedIndex(index);
                const prop = filteredProperties[index];
                mapRef.current?.animateToRegion({ latitude: prop.lat, longitude: prop.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 300);
              }
            }}
            renderItem={({ item, index }) => (
              // WHY THIS CARD BODY IS A PLAIN View AND NOT A Pressable.
              // It used to be a Pressable whose onPress ran openDetail(item),
              // pushing the /(dashboard)/property-detail route. That was removed
              // on explicit user instruction for THIS surface specifically — the
              // Project tab must not reveal project details from either entry
              // point ("jb hum pil or card pr click krte he tb details show nahi
              // honi chiye"). So the body is deliberately inert and Join Group
              // below is the card's only action. A Pressable with no onPress was
              // the wrong way to express that: TalkBack would still announce the
              // card as a button, which is now a lie, so it is a View.
              // The property sheet with the gallery / brochure is NOT this code:
              // it lives in GroupChatEmbedded (handlePropertyViewDetails →
              // viewProperty modal), reached from a group thread's View Details,
              // and was intentionally left untouched — it is a wanted feature.
              <View style={[styles.card, selectedIndex === index && styles.cardActive]}>
                {/* Rendered locally rather than via a placeholder URL: the
                    via.placeholder.com domain this used to point at no longer
                    resolves, so every image-less property fired a failing
                    request and still showed nothing. */}
                {item.image ? (
                  <Image source={{ uri: item.image }} style={styles.cardImage} />
                ) : (
                  <View style={[styles.cardImage, styles.imgFallback]}>
                    <Building2 size={22} color={colors.muted} />
                  </View>
                )}
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName} numberOfLines={1}>{item.property_name}</Text>
                  <Text style={styles.cardLocation} numberOfLines={1}>📍 {item.property_location}</Text>
                  <View style={styles.cardPriceRow}>
                    <Text style={styles.cardPrice}>{item.price_short}</Text>
                    {item.bhkOptions && item.bhkOptions.length > 0 && (
                      <Text style={styles.cardBhk}>{item.bhkOptions[0]}</Text>
                    )}
                  </View>
                  {/* WHY THERE IS NO Call / WhatsApp HERE ANY MORE.
                      This row used to hold a `tel:` Call button and a green
                      `wa.me` WhatsApp button, gated on item.cta. They were the
                      ONLY contact affordance on this card, and they were removed
                      on explicit user instruction in favour of a single Join
                      Group — the same project-wide decision that makes every
                      property card say "Join Group" and never "Chat Now". The
                      builder's number is still reachable from inside the group
                      this button opens, and from the group thread's View Details
                      sheet, so nothing became unreachable. This clause used to
                      name "the property detail screen (tap the card body)" as a
                      third route; that stopped being true when the detail route
                      was removed from this surface. DO NOT RESTORE THEM. */}
                  <Pressable
                    style={styles.cardJoinBtn}
                    // No stopPropagation any more: the card body was a Pressable
                    // calling openDetail, so this tap used to push the detail
                    // route behind the group modal unless it was stopped. The
                    // body is now an inert View, so there is nothing left above
                    // this button to propagate to.
                    // The ref is reset here, not only on close: dismissing the
                    // modal with its chevron while a room is open leaves it true,
                    // and the next mount's `false` publish would then close the
                    // modal the instant it opened.
                    onPress={() => { threadRoomWasOpenRef.current = false; setJoinProjectId(item.id); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Join the group for ${item.property_name}`}
                  >
                    <Users size={13} color="#fff" />
                    <Text style={styles.cardJoinText}>Join Group</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {/* Loading */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.brand} />
          <Text style={styles.loadingText}>Loading properties...</Text>
        </View>
      )}

      {/* Empty vs failed. A load failure now says so and offers a retry instead
          of claiming there are no properties. The retry forces past the shared
          60 s cache, otherwise it would replay the same failure. */}
      {!loading && filteredProperties.length === 0 && (
        <View style={styles.loadingOverlay}>
          {error ? (
            <>
              <AlertTriangle size={30} color={colors.amber} />
              <Text style={styles.loadingText}>{error}</Text>
              <Pressable style={styles.retryBtn} onPress={() => fetchProperties(true)}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Building2 size={30} color={colors.muted} />
              <Text style={styles.loadingText}>
                {properties.length === 0
                  ? 'No properties to show on the map.'
                  : activeCategory === FAVOURITES
                    // Only published projects with a resolvable location reach
                    // the map, so drafts and pin-less uploads can't show here.
                    ? "You haven't uploaded a published property with a map location yet."
                    : 'No properties match this search.'}
              </Text>
            </>
          )}
        </View>
      )}

      {/* Directions panel */}
      <Modal visible={showDirectionsPanel} animationType="slide" transparent onRequestClose={() => setShowDirectionsPanel(false)}>
        <View style={styles.sheetOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowDirectionsPanel(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandleWrap}><View style={styles.sheetHandle} /></View>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Directions</Text>
              <Pressable onPress={() => setShowDirectionsPanel(false)}><X size={22} color={colors.ink} /></Pressable>
            </View>
            <FlatList
              data={filteredProperties}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12 }}
              renderItem={({ item }) => (
                <View style={styles.dirItem}>
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.dirImg} />
                  ) : (
                    <View style={[styles.dirImg, styles.imgFallback]}>
                      <Building2 size={18} color={colors.muted} />
                    </View>
                  )}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.dirName} numberOfLines={1}>{item.property_name}</Text>
                    <Text style={styles.dirLoc} numberOfLines={1}>📍 {item.property_location}</Text>
                    <Text style={styles.dirPrice}>{item.price_short}</Text>
                  </View>
                  <Pressable style={styles.navBtn} onPress={() => handleNavigateToProperty(item)}>
                    <Navigation size={16} color="#fff" />
                  </Pressable>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Incomplete panel */}
      <Modal visible={showIncompletePanel} animationType="slide" transparent onRequestClose={() => setShowIncompletePanel(false)}>
        <View style={styles.sheetOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowIncompletePanel(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandleWrap}><View style={styles.sheetHandle} /></View>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Incomplete Properties</Text>
                <Text style={styles.sheetSub}>Properties that can't be shown on map</Text>
              </View>
              <Pressable onPress={() => setShowIncompletePanel(false)}><X size={22} color={colors.ink} /></Pressable>
            </View>
            <FlatList
              data={incompleteProperties}
              keyExtractor={(_, i) => `inc-${i}`}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12 }}
              ListEmptyComponent={
                <View style={styles.emptyInc}>
                  <CheckCircle size={40} color={colors.brand} />
                  <Text style={styles.emptyIncText}>All properties have valid locations!</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.incItem}>
                  <View style={styles.incIcon}><MapPin size={20} color={colors.amber} /></View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.incName}>{item.name}</Text>
                    <Text style={styles.incReason}>{item.reason}</Text>
                  </View>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* ── Property group thread, opened by a card's Join Group ──
          Hosted as a LOCAL modal rather than as a jump to the chat surface. The
          group thread lives in the AI Leads tab while this map is the Project tab
          of app/(dashboard)/crm.tsx, so handing a project id across that switcher
          would have meant new state in crm.tsx, lead-matching.tsx and both keyed
          GroupChatEmbedded panes — a cross-tab navigation the user did not ask
          for, to land on a surface they would then have to navigate back out of.

          `hideThreadBack` because this modal's own chevron is the only back
          control: a second chevron inside the thread would close the room and
          strand the user on an empty room list inside a modal. The `key` forces a
          clean remount per property so the previous property's room, messages and
          socket subscription cannot leak into the next one, and the
          `{!!joinProjectId && …}` guard unmounts the component on close rather
          than leaving it mounted and hidden with a live room subscription. All
          providers it needs (Toast / Auth / SafeArea) sit in app/_layout.tsx,
          above both surfaces.

          `onAutoJoinFailed` closes this modal when the join request fails. It
          used to just stay open: GroupChatEmbedded was left with no active room,
          so it rendered its OWN room list — search bar, Groups/Chats sections,
          Discover rows — under a header reading "Property Group". The failure
          already toasts, so dropping back to the map (where Join Group can simply
          be tapped again) is the honest outcome.

          `onRoomOpenChange` closes it for the OTHER route to the same dead end,
          which onAutoJoinFailed does not cover: this instance keeps its thread
          header, so the avatar tap reaches group info, and Exit Group / Delete
          Group there call closeRoom() — leaving that same room list under the
          "Property Group" header with nothing to rejoin. Listening to the room's
          open state catches every closeRoom path at once, including later ones.

          WHY `statusBarTranslucent` IS ON THIS Modal.
          Without it there was a blank colors.cream band, exactly one
          status-bar/cutout height tall, sitting above the "‹ Property Group"
          header — the top inset was being applied TWICE. React Native's Android
          Modal is a separate dialog window, and when statusBarTranslucent is
          false (the default) ReactModalHostView wraps the dialog content in a
          FrameLayout with fitsSystemWindows = true; RN's own comment there says
          this "has the pleasant side-effect of us not having to preface all
          Modals with 'top: statusBarHeight'". So the dialog already reserved the
          status bar, and then the inner View added `paddingTop: insets.top` on
          top of it. That inset is non-zero because app/_layout.tsx renders
          expo-status-bar's <StatusBar>, whose `translucent` prop defaults to
          true, so the ACTIVITY window draws under the status bar and
          useSafeAreaInsets() measures the real bar/cutout there. On a punch-hole
          device displayCutout() is OR-ed into that measurement, which is why the
          band read as a large gap rather than a hairline.
          Turning statusBarTranslucent on makes the dialog window behave like the
          activity window the insets were measured against, so the single
          remaining `insets.top` becomes the correct, device-measured value
          instead of a double. No pixel constant and no StatusBar.currentHeight is
          involved, so a phone with a different bar height is still right. The
          prop is Android-only and the paddingTop stays for iOS, where a
          full-screen modal genuinely does not inset for the notch. topInset={0}
          on the child is also deliberate: this modal's own groupModalHeader is
          the chrome, so the thread must not inset a third time.
          ── */}
      <Modal visible={!!joinProjectId} animationType="slide" statusBarTranslucent onRequestClose={() => setJoinProjectId(null)}>
        <View style={{ flex: 1, backgroundColor: colors.cream, paddingTop: insets.top }}>
          <View style={styles.groupModalHeader}>
            <Pressable onPress={() => setJoinProjectId(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to map">
              <ChevronLeft size={22} color={colors.ink} />
            </Pressable>
            <Text style={styles.groupModalTitle}>Property Group</Text>
          </View>
          {!!joinProjectId && (
            <GroupChatEmbedded
              key={joinProjectId}
              autoOpenProjectId={joinProjectId}
              onAutoJoinFailed={() => setJoinProjectId(null)}
              onRoomOpenChange={handleThreadRoomOpenChange}
              hideThreadBack
              topInset={0}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Search overlay
  searchOverlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: Platform.OS === 'ios' ? 12 : 10, paddingHorizontal: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchIconOnly: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.white, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.line, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.line, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  searchInput: { flex: 1, fontSize: 13, color: colors.ink },
  searchIconBtn: { padding: 6 },
  filterBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.white, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.line, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  filterBtnWarn: { backgroundColor: colors.amber, borderColor: colors.amberText },
  filterBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: colors.red, width: 18, height: 18, borderRadius: 9, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#fff' },
  filterBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  chipList: { marginTop: 10, gap: 8, paddingRight: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, gap: 4, borderWidth: 1, borderColor: colors.line, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  chipActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipIcon: { fontSize: 12 },
  chipText: { fontSize: 11, fontWeight: '500', color: colors.ink },
  chipTextActive: { color: '#fff' },

  // Markers
  marker: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, gap: 5, borderWidth: 1.5, borderColor: '#D1D5DB', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3 },
  markerActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  markerDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.green },
  markerDotActive: { backgroundColor: '#fff' },
  markerPrice: { fontSize: 12, fontWeight: '800', color: '#111827' },
  markerPriceActive: { color: '#fff' },

  // FABs
  fabColumn: { position: 'absolute', bottom: 140, right: 16, gap: 12 },
  fab: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.line, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 },

  // Count
  countBadge: { position: 'absolute', bottom: 132, alignSelf: 'center', backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  countText: { fontSize: 11, fontWeight: '500', color: colors.muted2 },

  // Card carousel
  cardCarousel: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: Platform.OS === 'ios' ? 24 : 12 },
  cardListContent: { paddingHorizontal: 16, gap: 12 },
  card: { width: CARD_WIDTH, backgroundColor: '#fff', borderRadius: 14, flexDirection: 'row', overflow: 'hidden', borderWidth: 1, borderColor: colors.line, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 6 },
  cardActive: { borderColor: colors.greenText, borderWidth: 2 },
  cardImage: { width: 90, height: '100%', minHeight: 110, backgroundColor: '#F3F4F6' },
  cardInfo: { flex: 1, padding: 10, justifyContent: 'space-between' },
  cardName: { fontSize: 13, fontWeight: '700', color: '#111827' },
  cardLocation: { fontSize: 10, color: colors.muted2, marginTop: 2 },
  cardPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  cardPrice: { fontSize: 15, fontWeight: '900', color: '#111827' },
  cardBhk: { fontSize: 10, color: colors.muted2, backgroundColor: '#F3F4F6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  // Replaces cardCtaRow / cardCtaBtn / cardCtaText / cardCtaWhatsapp /
  // cardCtaTextWhatsapp, all deleted with the Call and WhatsApp buttons. Full
  // width and brand-filled because it is now the card's single action — the two
  // pill-shaped buttons it replaced shared the row.
  cardJoinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 6, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.brand },
  cardJoinText: { fontSize: 10.5, fontWeight: '800', color: '#fff' },

  // Header of the local property-group modal — supplies the only back control.
  groupModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  groupModalTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },

  // Loading / empty
  loadingOverlay: { position: 'absolute', top: '45%', alignSelf: 'center', alignItems: 'center', backgroundColor: colors.white, paddingHorizontal: 24, paddingVertical: 16, borderRadius: 16, gap: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 5 },
  loadingText: { fontSize: 13, color: colors.muted2, marginTop: 4, textAlign: 'center' },
  retryBtn: { marginTop: 4, backgroundColor: colors.brand, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 10 },
  retryText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  // Local stand-in for a missing cover image, used by the carousel card and the
  // directions rows.
  imgFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.slateBg },

  // Sheets
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '60%', paddingBottom: 24 },
  sheetHandleWrap: { alignItems: 'center', paddingVertical: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  sheetSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  dirItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.line },
  dirImg: { width: 50, height: 50, borderRadius: 8, backgroundColor: colors.slateBg },
  dirName: { fontSize: 13, fontWeight: '600', color: colors.ink },
  dirLoc: { fontSize: 11, color: colors.muted2, marginTop: 2 },
  dirPrice: { fontSize: 13, fontWeight: '700', color: colors.greenText, marginTop: 2 },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brand, justifyContent: 'center', alignItems: 'center', marginLeft: 12 },
  emptyInc: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyIncText: { fontSize: 14, color: colors.muted2, fontWeight: '500' },
  incItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.line },
  incIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.amberBg, justifyContent: 'center', alignItems: 'center' },
  incName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  incReason: { fontSize: 11, color: colors.muted, marginTop: 2 },
});
