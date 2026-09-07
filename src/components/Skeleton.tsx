// Shimmer skeleton loader — used across all list screens instead of plain ActivityIndicator.
import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../theme';

interface Props {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function SkeletonBox({ width = '100%', height = 16, borderRadius = 8, style }: Props) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: colors.line,
          opacity,
        },
        style,
      ]}
    />
  );
}

// Card skeleton — generic card shape
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  return (
    <View style={[sk.card, style]}>
      <SkeletonBox width="100%" height={120} borderRadius={12} />
      <View style={{ padding: 12, gap: 8 }}>
        <SkeletonBox width="70%" height={14} />
        <SkeletonBox width="45%" height={12} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <SkeletonBox width={60} height={10} borderRadius={20} />
          <SkeletonBox width={50} height={10} borderRadius={20} />
        </View>
      </View>
    </View>
  );
}

// Row skeleton — for list items
export function SkeletonRow({ style }: { style?: ViewStyle }) {
  return (
    <View style={[sk.row, style]}>
      <SkeletonBox width={44} height={44} borderRadius={22} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonBox width="65%" height={14} />
        <SkeletonBox width="40%" height={11} />
      </View>
      <SkeletonBox width={50} height={20} borderRadius={6} />
    </View>
  );
}

// Metric skeleton — for 2×2 stat cards
export function SkeletonMetrics() {
  return (
    <View style={sk.metricsGrid}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={sk.metricCard}>
          <SkeletonBox width={32} height={32} borderRadius={10} />
          <SkeletonBox width="60%" height={22} style={{ marginTop: 8 }} />
          <SkeletonBox width="80%" height={11} style={{ marginTop: 4 }} />
        </View>
      ))}
    </View>
  );
}

const sk = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '47.5%',
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
});
