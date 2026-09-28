import React, { useEffect, useState } from 'react';
import { View, AppState } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '../../src/lib/authContext';
import { notificationsApi } from '../../src/lib/api';
import { SidebarProvider, useSidebar } from '../../src/lib/sidebarContext';
import Sidebar from '../../src/components/Sidebar';
import { colors } from '../../src/theme';

function DashboardShell() {
  const { open, closeSidebar } = useSidebar();
  const [unread, setUnread] = useState(0);

  // Unread badge polling. The interval used to run unconditionally, so a
  // backgrounded app kept making a request every minute for as long as the
  // process lived. Now polling stops when the app leaves the foreground and
  // fires once immediately on return, so the badge is still fresh on resume.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    // Android commonly emits a 'change' → 'active' event shortly after the
    // activity settles, even though the app was already active. Without tracking
    // the previous state, that fired a SECOND unread request milliseconds after
    // the one on mount (visible in the server logs as duplicate
    // /notifications?limit=1 calls ~150ms apart).
    let lastState = AppState.currentState;

    const fetchUnread = () =>
      notificationsApi.list({ limit: 1 }).then(r => setUnread(r.unreadCount)).catch(() => {});

    const startPolling = () => {
      if (timer) return;
      timer = setInterval(fetchUnread, 60000);
    };
    const stopPolling = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    if (lastState === 'active') {
      fetchUnread();
      startPolling();
    }

    const sub = AppState.addEventListener('change', state => {
      const wasActive = lastState === 'active';
      lastState = state;

      if (state !== 'active') {
        stopPolling();
        return;
      }
      // Only a real background → foreground transition needs a refresh.
      if (wasActive) return;
      fetchUnread();
      startPolling();
    });

    return () => {
      stopPolling();
      sub.remove();
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      {/* All dashboard screens as a stack (no bottom tab bar) */}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.cream },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="crm" />
        <Stack.Screen name="crm-leads" />
        <Stack.Screen name="projects" />
        <Stack.Screen name="add-project" />
        <Stack.Screen name="marketplace" />
        <Stack.Screen name="lead-matching" />
        <Stack.Screen name="analytics" />
        <Stack.Screen name="employees" />
        <Stack.Screen name="organizations" />
        <Stack.Screen name="admin-users" />
        <Stack.Screen name="chat" />
        <Stack.Screen name="group-chat" />
        <Stack.Screen name="captain-team" />
        <Stack.Screen name="field" />
        <Stack.Screen name="archive" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="settings" />
      </Stack>

      {/* Slide-in sidebar overlays everything */}
      <Sidebar open={open} onClose={closeSidebar} unread={unread} />
    </View>
  );
}

export default function DashboardLayout() {
  // useAuth just to ensure provider ready (role used inside Sidebar)
  useAuth();
  return (
    <SidebarProvider>
      <DashboardShell />
    </SidebarProvider>
  );
}
