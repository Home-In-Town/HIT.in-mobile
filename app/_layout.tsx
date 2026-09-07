import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ScrollView } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '../src/lib/authContext';
import { ToastProvider } from '../src/components/Toast';
import { colors } from '../src/theme';

// Keep the splash visible until we're mounted, then hide it. If this throws
// (e.g. already hidden), ignore it — never let it block startup.
SplashScreen.preventAutoHideAsync().catch(() => {});

// expo-router automatically renders this when any render throws, instead of a
// blank white screen. Turns a silent crash into a readable message.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.cream, padding: 24, justifyContent: 'center' }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.brand, marginBottom: 8 }}>
        Something went wrong
      </Text>
      <ScrollView style={{ maxHeight: 300 }}>
        <Text style={{ fontSize: 13, color: colors.ink }}>{error?.message}</Text>
        {!!error?.stack && (
          <Text style={{ fontSize: 11, color: colors.muted2, marginTop: 12 }}>{error.stack}</Text>
        )}
      </ScrollView>
      <Text onPress={retry} style={{ marginTop: 20, fontSize: 15, fontWeight: 'bold', color: colors.brand }}>
        Tap to retry
      </Text>
    </View>
  );
}

function RootNavigator() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  // Wait one render so the navigator is mounted before we navigate
  // (avoids the "navigate before mounting the Root Layout" error).
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || status === 'loading') return;

    const inLogin = segments[0] === 'login';
    const inDashboard = segments[0] === '(dashboard)';

    if (status === 'unauthenticated' && inDashboard) {
      // Logged out while inside the dashboard → back to login
      router.replace('/login');
    } else if ((status === 'authenticated' || status === 'unassigned') && inLogin) {
      // Logged in while on login screen → into the dashboard
      router.replace('/(dashboard)/crm');
    }
  }, [mounted, status, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="(dashboard)" />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Hide the splash once the root layout has mounted.
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.cream }}>
      <SafeAreaProvider>
        <ToastProvider>
          <AuthProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </AuthProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
