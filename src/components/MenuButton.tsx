// Hamburger menu button — opens the sidebar. Place in any screen's header.
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Menu } from 'lucide-react-native';
import { useSidebar } from '../lib/sidebarContext';
import { colors } from '../theme';

export default function MenuButton({ color = colors.ink }: { color?: string }) {
  const { openSidebar } = useSidebar();
  return (
    <Pressable onPress={openSidebar} style={s.btn} hitSlop={8}>
      <Menu size={22} color={color} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { padding: 4, marginRight: 4 },
});
