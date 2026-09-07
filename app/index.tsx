import React from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/lib/authContext';
import { colors } from '../src/theme';

// Entry route — redirects to the role-appropriate home tab.
export default function Index() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }}>
        <Text style={{ fontSize: 22, fontWeight: 'bold', color: colors.brand, marginBottom: 12 }}>HomeInTown</Text>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (status === 'unauthenticated') {
    return <Redirect href="/login" />;
  }

  // Role-based home screen
  const role = user?.role ?? 'user';

  if (role === 'employee') {
    return <Redirect href={'/(dashboard)/field' as any} />;
  }

  if (role === 'captain') {
    return <Redirect href="/(dashboard)/crm" />;
  }

  // admin, builder, agent, user, unassigned → CRM
  return <Redirect href="/(dashboard)/crm" />;
}
