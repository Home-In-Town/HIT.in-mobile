import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme';

function Tag({ text, brand }: { text: string; brand?: boolean }) {
  return (
    <View style={[mbs.tag, brand && { backgroundColor: colors.brandTint }]}>
      <Text style={[mbs.tagText, brand && { color: colors.brand }]}>{text}</Text>
    </View>
  );
}

// Kept the object name `mbs` so the JSX body above is unchanged from when this
// lived in GroupChatEmbedded.tsx. Only `tag` and `tagText` came across (1
// reference each, both here); `mbs.tagRow`, `mbs.system` and the rest stay with
// MessageBubble in the parent. Note these are NOT pd.tag / pd.tagText, which
// have different values and moved into PostCard.tsx.
const mbs = StyleSheet.create({
  tag: { backgroundColor: colors.slateBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  tagText: { fontSize: 8.5, fontWeight: '700', color: colors.slateText },
});

export default Tag;
