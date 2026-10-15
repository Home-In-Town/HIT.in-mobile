// Display formatters lifted out of GroupChatEmbedded.tsx. Pure functions only —
// no imports at all, so they are safe to load anywhere.

export function timeStr(iso: string) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function messageClock(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function fmtPrice(v: number): string {
  if (!v) return '—';
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(0)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Stable no-op, so passing one as a prop doesn't change identity each render. */
export const noop = () => {};

// Format a lakh amount the way the rest of the app does.
export function fmtLakhs(lakhs?: number | null): string {
  if (!lakhs || lakhs <= 0) return '—';
  if (lakhs >= 100) return `₹${(lakhs / 100).toFixed(1)} Cr`;
  return `₹${Math.round(lakhs)} L`;
}

export function fmtCooldownLeft(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Rupees → short label (₹80L / ₹1.2Cr).
export function fmtMoney(v: number): string {
  if (!v || v <= 0) return '';
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(v % 10000000 === 0 ? 0 : 1)}Cr`;
  if (v >= 100000) return `₹${Math.round(v / 100000)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
}
