import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '../../src/lib/authContext';
import { notificationsApi } from '../../src/lib/api';
import { SidebarProvider, useSidebar } from '../../src/lib/sidebarContext';
import Sidebar from '../../src/components/Sidebar';
import { colors } from '../../src/theme';

function DashboardShell() {
  const { open, closeSidebar } = useSidebar();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const fetchUnread = () =>
      notificationsApi.list({ limit: 1 }).then(r => setUnread(r.unreadCount)).catch(() => {});
    fetchUnread();
    const id = setInterval(fetchUnread, 60000);
    return () => clearInterval(id);
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
