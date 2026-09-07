import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable,
  RefreshControl, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BarChart3, Eye, Users, Phone, MessageSquare, TrendingUp,
} from 'lucide-react-native';
import Svg, { Rect, Text as SvgText, G } from 'react-native-svg';
import { analyticsApi, ProjectAnalyticsOverview } from '../../src/lib/api';
import { useToast } from '../../src/components/Toast';
import { SkeletonMetrics } from '../../src/components/Skeleton';
import EmptyState from '../../src/components/EmptyState';
import MenuButton from '../../src/components/MenuButton';
import { colors } from '../../src/theme';

const W = Dimensions.get('window').width - 32; // chart width

/* ── Mini bar chart (SVG) ── */
function BarChart({
  data,
  color = colors.brand,
  height = 100,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}) {
  if (!data.length) return null;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const BAR_W = Math.floor((W - 32 - (data.length - 1) * 6) / data.length);
  const chartH = height - 24; // reserve 24px for labels

  return (
    <Svg width={W - 32} height={height} style={{ marginTop: 4 }}>
      <G>
        {data.map((d, i) => {
          const barH = Math.max(4, Math.round((d.value / maxVal) * chartH));
          const x = i * (BAR_W + 6);
          const y = chartH - barH;
          return (
            <G key={i}>
              <Rect
                x={x} y={y}
                width={BAR_W} height={barH}
                rx={4} fill={color} opacity={0.85}
              />
              <SvgText
                x={x + BAR_W / 2} y={height - 4}
                fontSize={8} fill={colors.muted}
                textAnchor="middle"
              >
                {d.label.length > 5 ? d.label.slice(0, 5) : d.label}
              </SvgText>
            </G>
          );
        })}
      </G>
    </Svg>
  );
}

/* ── Stat card ── */
function StatCard({
  label, value, icon, bg, accent,
}: {
  label: string; value: number | string; icon: React.ReactNode; bg: string; accent: string;
}) {
  return (
    <View style={[sc.card, { backgroundColor: bg, borderColor: `${accent}30` }]}>
      <View style={[sc.iconBox, { backgroundColor: `${accent}20` }]}>{icon}</View>
      <Text style={[sc.value, { color: accent }]}>{typeof value === 'number' ? value.toLocaleString() : value}</Text>
      <Text style={sc.label}>{label}</Text>
    </View>
  );
}

const sc = StyleSheet.create({
  card: { width: '22%', borderRadius: 12, borderWidth: 1, padding: 10, alignItems: 'center', gap: 4 },
  iconBox: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  value: { fontSize: 18, fontWeight: '800' },
  label: { fontSize: 9, color: colors.muted, fontWeight: '600', textAlign: 'center' },
});

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [data, setData] = useState<ProjectAnalyticsOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const totals = data.reduce((acc, p) => ({
    visits: acc.visits + (p.totalVisits || 0),
    leads:  acc.leads  + (p.uniqueLeads || 0),
    calls:  acc.calls  + (p.totalCalls  || 0),
    wa:     acc.wa     + (p.totalWhatsApp || 0),
  }), { visits: 0, leads: 0, calls: 0, wa: 0 });

  const load = async () => {
    try {
      const res = await analyticsApi.overview();
      setData(Array.isArray(res) ? res : []);
    } catch (e: any) {
      toast.show(e?.message || 'Failed to load analytics', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Top-10 projects by visits for chart
  const chartData = [...data]
    .sort((a, b) => b.totalVisits - a.totalVisits)
    .slice(0, 8)
    .map(p => ({ label: p.projectName?.split(' ')[0] || '?', value: p.totalVisits }));

  const leadsChart = [...data]
    .sort((a, b) => b.uniqueLeads - a.uniqueLeads)
    .slice(0, 8)
    .map(p => ({ label: p.projectName?.split(' ')[0] || '?', value: p.uniqueLeads }));

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MenuButton />
          <View>
            <Text style={s.title}>Analytics</Text>
            <Text style={s.sub}>Performance overview</Text>
          </View>
        </View>
      </View>

      {loading ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <SkeletonMetrics />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
        >
          {/* Aggregate stats */}
          <View style={s.statsRow}>
            <StatCard label="Visits"  value={totals.visits} icon={<Eye  size={14} color={colors.brand}  />} bg={colors.white} accent={colors.brand} />
            <StatCard label="Leads"   value={totals.leads}  icon={<Users size={14} color={colors.indigo} />} bg={colors.indigoBg} accent={colors.indigo} />
            <StatCard label="Calls"   value={totals.calls}  icon={<Phone size={14} color={colors.green}  />} bg={colors.greenBg} accent={colors.green} />
            <StatCard label="WA"      value={totals.wa}     icon={<MessageSquare size={14} color={colors.cyan}   />} bg={colors.cyanBg} accent={colors.cyan} />
          </View>

          {/* Visits bar chart */}
          {chartData.length > 0 && (
            <View style={s.chartCard}>
              <View style={s.chartHeader}>
                <BarChart3 size={16} color={colors.brand} />
                <Text style={s.chartTitle}>Visits by Project</Text>
              </View>
              <BarChart data={chartData} color={colors.brand} height={110} />
            </View>
          )}

          {/* Leads bar chart */}
          {leadsChart.length > 0 && (
            <View style={s.chartCard}>
              <View style={s.chartHeader}>
                <TrendingUp size={16} color={colors.indigo} />
                <Text style={[s.chartTitle, { color: colors.indigoText }]}>Leads by Project</Text>
              </View>
              <BarChart data={leadsChart} color={colors.indigo} height={110} />
            </View>
          )}

          {/* Per-project table */}
          <View style={s.tableCard}>
            <Text style={s.tableTitle}>All Projects</Text>
            {data.length === 0 ? (
              <EmptyState
                icon={<BarChart3 size={28} color={colors.muted} />}
                title="No data yet"
                subtitle="Analytics will appear once your projects get visitors."
              />
            ) : (
              data.map(p => {
                const isSelected = selectedProject === p.projectId;
                return (
                  <Pressable
                    key={p.projectId}
                    onPress={() => setSelectedProject(isSelected ? null : p.projectId)}
                    style={[s.tableRow, isSelected && s.tableRowActive]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowName} numberOfLines={1}>{p.projectName}</Text>
                      {p.city ? <Text style={s.rowCity}>{p.city}</Text> : null}
                    </View>
                    <View style={s.rowStats}>
                      <View style={s.rowStat}>
                        <Eye size={10} color={colors.muted} />
                        <Text style={s.rowStatNum}>{p.totalVisits}</Text>
                      </View>
                      <View style={s.rowStat}>
                        <Users size={10} color={colors.indigo} />
                        <Text style={[s.rowStatNum, { color: colors.indigoText }]}>{p.uniqueLeads}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  statsRow: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  chartCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 4 },
  chartHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  chartTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  tableCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 0 },
  tableTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line },
  tableRowActive: { backgroundColor: colors.brandTint, borderRadius: 8, paddingHorizontal: 6, marginHorizontal: -6 },
  rowName: { fontSize: 13, fontWeight: '600', color: colors.ink },
  rowCity: { fontSize: 11, color: colors.muted, marginTop: 1 },
  rowStats: { flexDirection: 'row', gap: 12 },
  rowStat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rowStatNum: { fontSize: 13, fontWeight: '700', color: colors.ink },
});
