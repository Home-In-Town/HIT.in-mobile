// Unit-inventory helpers shared by UnitGrid, UnitSetupForm, the detail sheet
// and the unit_update message bubble. Pure functions only — no network.
import { unitColors } from '../theme';
import type { ProjectUnit, UnitCounts, UnitSetup, UnitStatus } from './api';

export const UNIT_STATUSES: UnitStatus[] = ['available', 'booked', 'sold', 'on-hold'];

// Display labels match the server's STATUS_LABELS so the grid, the picker and
// the auto-message text all say the same word.
export const UNIT_STATUS: Record<UnitStatus, { label: string; color: string }> = {
  available: { label: 'Vacant', color: unitColors.available },
  booked: { label: 'Booked', color: unitColors.booked },
  sold: { label: 'Sold', color: unitColors.sold },
  'on-hold': { label: 'Hold', color: unitColors['on-hold'] },
};

export const MAX_UNITS = 2000;

export function statusMeta(status: string | undefined) {
  return UNIT_STATUS[(status as UnitStatus)] || UNIT_STATUS.available;
}

export function summarizeUnits(units: ProjectUnit[] | undefined): UnitCounts {
  const c: UnitCounts = { available: 0, booked: 0, sold: 0, onHold: 0, total: 0 };
  for (const u of units || []) {
    if (!u) continue;
    c.total += 1;
    if (u.status === 'booked') c.booked += 1;
    else if (u.status === 'sold') c.sold += 1;
    else if (u.status === 'on-hold') c.onHold += 1;
    else c.available += 1;
  }
  return c;
}

export interface TowerRows {
  tower: string;
  // Top floor first, like a building elevation, so the grid "reads" as the tower.
  floors: { floor: number; units: ProjectUnit[] }[];
}

/** tower (natural order) → floors (desc) → units (asc). */
export function groupUnits(units: ProjectUnit[] | undefined): TowerRows[] {
  const byTower = new Map<string, Map<number, ProjectUnit[]>>();
  for (const u of units || []) {
    if (!u) continue;
    let floors = byTower.get(u.tower);
    if (!floors) { floors = new Map(); byTower.set(u.tower, floors); }
    const row = floors.get(u.floor) || [];
    row.push(u);
    floors.set(u.floor, row);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...byTower.entries()]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([tower, floors]) => ({
      tower,
      floors: [...floors.entries()]
        .sort(([a], [b]) => b - a)
        .map(([floor, list]) => ({ floor, units: list.sort((x, y) => x.unitNo - y.unitNo) })),
    }));
}

/**
 * Who may change unit status — mirrors the server's authorizeProjectAccess
 * (admin, owner, co-captain, assigned agent).
 *
 * THIS IS NOT THE SECURITY BOUNDARY: the PATCH/PUT endpoints enforce the same
 * rule and answer 403 otherwise. It only exists so non-editors are not offered
 * a picker whose only outcome is an error toast.
 */
export function canEditUnits(
  user: { id?: string; _id?: string; role?: string } | null | undefined,
  project: { ownerId?: string; coCaptains?: string[]; assignedAgentId?: string } | null | undefined,
): boolean {
  if (!user || !project) return false;
  if (user.role === 'admin') return true;
  const uid = String(user.id || user._id || '');
  if (!uid) return false;
  if (project.ownerId && project.ownerId === uid) return true;
  if (project.assignedAgentId && project.assignedAgentId === uid) return true;
  return (project.coCaptains || []).includes(uid);
}

/** Same label format as the server: {tower}-{floor}{unitNo padded to 2}. */
export function unitLabel(tower: string, floor: number, unitNo: number): string {
  return `${tower}-${floor}${String(unitNo).padStart(2, '0')}`;
}

/**
 * Client-side preview/validation of a setup, using the server's limits so the
 * form can explain a problem before the request is sent. The server still
 * validates independently.
 */
export function previewUnitSetup(setup: UnitSetup): { total: number; first?: string; last?: string; error?: string } {
  const towers = setup.towers || [];
  if (!towers.length) return { total: 0, error: 'Add at least one tower' };
  if (towers.length > 26) return { total: 0, error: 'At most 26 towers' };
  const seen = new Set<string>();
  let total = 0;
  for (const t of towers) {
    const name = (t.name || '').trim();
    if (!name) return { total: 0, error: 'Every tower needs a name' };
    if (name.length > 10) return { total: 0, error: `Tower "${name}": name must be 10 characters or less` };
    const key = name.toLowerCase();
    if (seen.has(key)) return { total: 0, error: `Tower "${name}" is listed twice` };
    seen.add(key);
    if (!Number.isInteger(t.floors) || t.floors < 1 || t.floors > 200) return { total: 0, error: `Tower ${name}: floors must be 1 to 200` };
    if (!Number.isInteger(t.unitsPerFloor) || t.unitsPerFloor < 1 || t.unitsPerFloor > 99) return { total: 0, error: `Tower ${name}: units per floor must be 1 to 99` };
    total += t.floors * t.unitsPerFloor;
  }
  if (total > MAX_UNITS) return { total, error: `This setup has ${total} units; the limit is ${MAX_UNITS}` };
  const a = towers[0];
  const z = towers[towers.length - 1];
  return {
    total,
    first: unitLabel(a.name.trim(), 1, 1),
    last: unitLabel(z.name.trim(), z.floors, z.unitsPerFloor),
  };
}

/** Rebuild a UnitSetup from existing units, so "Edit Units" starts from what exists. */
export function setupFromUnits(units: ProjectUnit[] | undefined): UnitSetup | null {
  const groups = groupUnits(units);
  if (!groups.length) return null;
  return {
    towers: groups.map(g => ({
      name: g.tower,
      floors: Math.max(...g.floors.map(f => f.floor)),
      unitsPerFloor: Math.max(...g.floors.map(f => Math.max(...f.units.map(u => u.unitNo)))),
    })),
    bhk: (units || []).find(u => u?.bhk)?.bhk || '',
  };
}
