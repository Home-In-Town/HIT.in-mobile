// Redesigned CRM Metrics Bar — richer cards matching website style.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Users, Flame, Thermometer, TrendingUp } from 'lucide-react-native';
import { CrmAnalytics } from '../../lib/api';
import { colors } from '../../theme';

interface Props {
  analytics: CrmAnalytics;
}

export default function CrmMetricsBar({ analytics }: Props) {
  const engagement = analytics.engagementRate
    ? `${(analytics.engagementRate * 100).toFixed(1)}%`
    : `${analytics.engagementRate ?? 0}%`;

  const stats = [
    {
      label: 'TOTAL LEADS',
      value: String(analytics.total),
      sub: 'all time',
      cardBg: colors.white,
      border: colors.line,
      accentBar: colors.brand,
      valueColor: colors.ink,
      subColor: colors.muted,
      icon: <Users size={18} color={colors.brand} />,
      iconBg: `${colors.brand}15`,
    },
    {
      label: 'HOT LEADS',
      value: String(analytics.hot),
      sub: 'high priority',
      cardBg: '#FFF5F5',
      border: '#FECACA',
      accentBar: '#EF4444',
      valueColor: '#B91C1C',
      subColor: '#F87171',
      icon: <Flame size={18} color="#EF4444" />,
      iconBg: '#FEE2E2',
    },
    {
      label: 'WARM LEADS',
      value: String(analytics.warm),
      sub: 'needs nurturing',
      cardBg: '#FFFBEB',
      border: '#FDE68A',
      accentBar: '#F59E0B',
      valueColor: '#B45309',
      subColor: '#D97706',
      icon: <Thermometer size={18} color="#D97706" />,
      iconBg: '#FEF3C7',
    },
    {
      label: 'ENGAGEMENT',
      value: engagement,
      sub: 'CTA click rate',
      cardBg: colors.white,
      border: `${colors.brand}30`,
      accentBar: colors.brand,
      valueColor: colors.brand,
      subColor: colors.muted,
      icon: <TrendingUp size={18} color={colors.brand} />,
      iconBg: `${colors.brand}15`,
    },
  ];

  return (
    <View style={s.grid}>
      {stats.map((stat, i) => (
        <View
          key={i}
          style={[s.card, { backgroundColor: stat.cardBg, borderColor: stat.border }]}
        >
          {/* Top accent bar */}
          <View style={[s.accentBar, { backgroundColor: stat.accentBar }]} />

          <View style={s.cardInner}>
            {/* Icon */}
            <View style={[s.iconBox, { backgroundColor: stat.iconBg }]}>
              {stat.icon}
            </View>

            {/* Value */}
            <Text style={[s.value, { color: stat.valueColor }]}>{stat.value}</Text>

            {/* Label */}
            <Text style={[s.label, { color: stat.subColor }]}>{stat.label}</Text>

            {/* Sub */}
            <Text style={[s.sub, { color: stat.subColor }]}>{stat.sub}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '47.5%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  accentBar: {
    height: 3,
    width: '100%',
  },
  cardInner: {
    padding: 14,
    gap: 3,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  value: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 2,
  },
  sub: {
    fontSize: 11,
    fontWeight: '500',
  },
});
