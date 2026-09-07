// Custom slide-in sidebar (drawer) — replaces the bottom tab bar.
// Doesn't depend on react-native-reanimated (uses Animated API).
// Matches the website's left sidebar navigation.

import React, { useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, Dimensions,
  ScrollView, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import {
  LayoutDashboard, Building2, BarChart3, ShoppingBag, Zap,
  Users, Briefcase, Clock, Bell, User, Building, LogOut,
  X, Shield, MessageSquare, Settings,
} from 'lucide-react-native';
import { useAuth } from '../lib/authContext';
import { colors } from '../theme';

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_W = Math.min(300, SCREEN_W * 0.8);

interface NavItem {
  label: string;
  route: string;
  icon: any;
  roles: string[]; // which roles see this item ('*' = all)
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview',      route: '/(dashboard)/crm',           icon: LayoutDashboard, roles: ['admin', 'builder', 'captain', 'agent'] },
  { label: 'Projects',       route: '/(dashboard)/projects',      icon: Building2,       roles: ['admin', 'builder', 'captain', 'agent'] },
  { label: 'Marketplace',    route: '/(dashboard)/marketplace',   icon: ShoppingBag,     roles: ['admin', 'builder', 'captain'] },
  { label: 'AI Lead Matching', route: '/(dashboard)/lead-matching', icon: Zap,           roles: ['admin', 'builder', 'captain', 'agent'] },
  { label: 'Analytics',      route: '/(dashboard)/analytics',     icon: BarChart3,       roles: ['admin', 'builder'] },
  { label: 'Chat',           route: '/(dashboard)/chat',          icon: MessageSquare,   roles: ['admin', 'builder', 'captain', 'agent'] },
  { label: 'Field Team',     route: '/(dashboard)/employees',     icon: Users,           roles: ['admin', 'builder', 'captain', 'agent'] },
  { label: 'Organizations',  route: '/(dashboard)/organizations', icon: Building,        roles: ['admin', 'builder'] },
  { label: 'Users',          route: '/(dashboard)/admin-users',   icon: Shield,          roles: ['admin'] },
  { label: 'Field Check-in', route: '/(dashboard)/field',         icon: Briefcase,       roles: ['employee'] },
  { label: 'Archive',        route: '/(dashboard)/archive',       icon: Clock,           roles: ['employee', 'agent'] },
  { label: 'Notifications',  route: '/(dashboard)/notifications', icon: Bell,            roles: ['*'] },
  { label: 'Profile',        route: '/(dashboard)/profile',       icon: User,            roles: ['*'] },
];

interface Props {
  open: boolean;
  onClose: () => void;
  unread?: number;
}

export default function Sidebar({ open, onClose, unread = 0 }: Props) {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const role = user?.role ?? 'user';

  const slideX = useRef(new Animated.Value(-DRAWER_W)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      Animated.parallel([
        Animated.timing(slideX, { toValue: 0, duration: 240, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideX, { toValue: -DRAWER_W, duration: 200, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [open]);

  const items = NAV_ITEMS.filter(item => item.roles.includes('*') || item.roles.includes(role));

  const navigate = (route: string) => {
    onClose();
    // small delay so the close animation feels smooth
    setTimeout(() => router.push(route as any), 60);
  };

  const isActive = (route: string) => {
    if (!pathname) return false;
    const seg = route.split('/').pop();
    return pathname.includes(seg || '___');
  };

  const initial = (user?.name || '?').charAt(0).toUpperCase();

  // Don't render anything when fully closed (perf)
  if (!open) {
    return (
      <Animated.View pointerEvents="none" style={[st.backdrop, { opacity: 0 }]} />
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View style={[st.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      {/* Drawer */}
      <Animated.View
        style={[
          st.drawer,
          { width: DRAWER_W, paddingTop: insets.top, transform: [{ translateX: slideX }] },
        ]}
      >
        {/* Brand header */}
        <View style={st.brandHeader}>
          <View style={st.brandRow}>
            <View style={st.logoBox}>
              <Text style={st.logoLetter}>H</Text>
            </View>
            <View>
              <Text style={st.brandName}>HomeInTown</Text>
              <Text style={st.brandSub}>Sales Intelligence</Text>
            </View>
          </View>
          <Pressable onPress={onClose} style={st.closeBtn}>
            <X size={18} color={colors.muted2} />
          </Pressable>
        </View>

        {/* User card */}
        <View style={st.userCard}>
          {user?.businessLogoUrl ? (
            <Image source={{ uri: user.businessLogoUrl }} style={st.userAvatar} />
          ) : (
            <View style={st.userAvatarFallback}>
              <Text style={st.userAvatarText}>{initial}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={st.userName} numberOfLines={1}>{user?.name || 'User'}</Text>
            <Text style={st.userRole}>{role.charAt(0).toUpperCase() + role.slice(1)}</Text>
          </View>
        </View>

        {/* Nav items */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
          <Text style={st.sectionLabel}>MENU</Text>
          {items.map(item => {
            const active = isActive(item.route);
            const Icon = item.icon;
            return (
              <Pressable
                key={item.route}
                onPress={() => navigate(item.route)}
                style={[st.navItem, active && st.navItemActive]}
              >
                <Icon size={20} color={active ? colors.brand : colors.muted2} />
                <Text style={[st.navLabel, active && st.navLabelActive]}>{item.label}</Text>
                {item.route.includes('notifications') && unread > 0 && (
                  <View style={st.navBadge}>
                    <Text style={st.navBadgeText}>{unread > 9 ? '9+' : unread}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Settings + Sign out */}
        <View style={[st.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={() => navigate('/(dashboard)/settings')} style={st.settingsBtn}>
            <Settings size={18} color={colors.muted2} />
            <Text style={st.settingsText}>Settings</Text>
          </Pressable>
          <Pressable onPress={() => { onClose(); setTimeout(() => logout(), 100); }} style={st.signOut}>
            <LogOut size={18} color={colors.red} />
            <Text style={st.signOutText}>Sign Out</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  drawer: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    backgroundColor: colors.white,
    borderRightWidth: 1, borderRightColor: colors.line,
    shadowColor: '#000', shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.15, shadowRadius: 16, elevation: 24,
  },
  brandHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  logoLetter: { color: '#fff', fontWeight: '800', fontSize: 20 },
  brandName: { fontSize: 16, fontWeight: '800', color: colors.ink },
  brandSub: { fontSize: 10, color: colors.brand, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  closeBtn: { padding: 6, borderRadius: 8, backgroundColor: colors.slateBg },
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginTop: 14, marginBottom: 6,
    padding: 12, borderRadius: 14,
    backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line,
  },
  userAvatar: { width: 44, height: 44, borderRadius: 22 },
  userAvatarFallback: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  userName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  userRole: { fontSize: 12, color: colors.brand, fontWeight: '600', marginTop: 1 },
  sectionLabel: { fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  navItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 13,
    marginHorizontal: 8, borderRadius: 12,
  },
  navItemActive: { backgroundColor: colors.brandTint },
  navLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.muted2 },
  navLabelActive: { color: colors.brand, fontWeight: '700' },
  navBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  navBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  footer: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 },
  settingsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  settingsText: { fontSize: 15, fontWeight: '600', color: colors.muted2 },
  signOut: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  signOutText: { fontSize: 15, fontWeight: '700', color: colors.red },
});
