// Tests for the Role Distribution screen's pure logic. The two hard blocks are
// the point of the feature (a self-demotion or a last-admin demotion locks the
// admin surface permanently, and the server has no guard of its own), so they
// are pinned here alongside the search and counting helpers the list is built
// from.
import {
  matchesUserSearch,
  roleDistribution,
  phoneKey,
  duplicatePhoneKeys,
  roleChangeBlock,
  roleChangeConsequence,
  ROLE_ORDER,
} from '../adminUsers';

const u = (over: Partial<{ name: string; phone: string; email: string; companyName: string }> = {}) => ({
  name: 'Asha Patil',
  phone: '+919970119846',
  email: 'asha@example.com',
  companyName: 'Patil Realty',
  ...over,
});

describe('matchesUserSearch', () => {
  it('matches on name, phone, email and companyName', () => {
    expect(matchesUserSearch(u(), 'asha')).toBe(true);
    expect(matchesUserSearch(u(), '9970')).toBe(true);
    expect(matchesUserSearch(u(), 'example.com')).toBe(true);
    expect(matchesUserSearch(u(), 'realty')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesUserSearch(u(), 'ASHA')).toBe(true);
    expect(matchesUserSearch(u({ name: 'ASHA PATIL' }), 'patil')).toBe(true);
  });

  it('trims a padded query and a padded stored value', () => {
    expect(matchesUserSearch(u(), '  asha  ')).toBe(true);
    expect(matchesUserSearch(u({ name: '  Asha Patil  ' }), 'asha patil')).toBe(true);
  });

  it('matches everything on an empty or whitespace query', () => {
    expect(matchesUserSearch(u(), '')).toBe(true);
    expect(matchesUserSearch(u(), '   ')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesUserSearch(u(), 'zzz')).toBe(false);
  });

  it('does not throw when the optional fields are missing', () => {
    expect(matchesUserSearch({ name: 'Ravi', phone: '9999999999' } as any, 'ravi')).toBe(true);
    expect(matchesUserSearch({ name: 'Ravi', phone: '9999999999' } as any, 'patil')).toBe(false);
  });
});

describe('roleDistribution', () => {
  it('counts a mixed list', () => {
    const d = roleDistribution([
      { role: 'admin' }, { role: 'admin' }, { role: 'captain' }, { role: 'agent' },
    ] as any);
    expect(d.admin).toBe(2);
    expect(d.captain).toBe(1);
    expect(d.agent).toBe(1);
  });

  it('keeps all seven keys present with 0 when absent', () => {
    const d = roleDistribution([{ role: 'agent' }] as any);
    for (const role of ROLE_ORDER) expect(d[role]).toBeDefined();
    expect(d.admin).toBe(0);
    expect(d.unassigned).toBe(0);
  });

  it('normalises whitespace and casing into the same bucket', () => {
    const d = roleDistribution([{ role: 'Captain' }, { role: ' captain ' }, { role: 'CAPTAIN' }] as any);
    expect(d.captain).toBe(3);
  });

  // A stray role value must show up rather than be swallowed, which is why
  // roleDistribution does not clamp its keys to ROLE_ORDER.
  it('gives an unknown role its own visible bucket', () => {
    expect(roleDistribution([{ role: 'superuser' }] as any).superuser).toBe(1);
  });

  it('returns all zeros for an empty list', () => {
    const d = roleDistribution([]);
    expect(Object.values(d).every(n => n === 0)).toBe(true);
  });
});

describe('phoneKey / duplicatePhoneKeys', () => {
  it('gives the bare and +91 forms of a number the same key', () => {
    expect(phoneKey('9970119846')).toBe('9970119846');
    expect(phoneKey('+919970119846')).toBe('9970119846');
    expect(duplicatePhoneKeys([{ phone: '9970119846' }, { phone: '+919970119846' }] as any))
      .toEqual(new Set(['9970119846']));
  });

  it('yields an empty key for short or garbage input and never reports it', () => {
    expect(phoneKey('12345')).toBe('');
    expect(phoneKey('')).toBe('');
    expect(phoneKey(null)).toBe('');
    expect(duplicatePhoneKeys([{ phone: '12345' }, { phone: 'abc' }, { phone: '' }] as any).size).toBe(0);
  });

  it('returns an empty set when every number is unique', () => {
    expect(duplicatePhoneKeys([{ phone: '9970119846' }, { phone: '7599944999' }] as any).size).toBe(0);
  });
});

describe('roleChangeBlock', () => {
  it('blocks changing your own role', () => {
    const msg = roleChangeBlock({ target: { id: 'me', role: 'admin' } as any, currentUserId: 'me', adminCount: 5 });
    expect(msg).toMatch(/your own role/i);
  });

  it('blocks demoting the last admin', () => {
    const msg = roleChangeBlock({ target: { id: 'other', role: 'admin' } as any, currentUserId: 'me', adminCount: 1 });
    expect(msg).toMatch(/last admin/i);
  });

  it('allows another admin when there are several', () => {
    expect(roleChangeBlock({ target: { id: 'other', role: 'admin' } as any, currentUserId: 'me', adminCount: 5 })).toBeNull();
  });

  it('allows a non-admin target even when only one admin exists', () => {
    expect(roleChangeBlock({ target: { id: 'other', role: 'agent' } as any, currentUserId: 'me', adminCount: 1 })).toBeNull();
  });
});

describe('roleChangeConsequence', () => {
  it('returns null for a no-op', () => {
    expect(roleChangeConsequence('agent', 'agent')).toBeNull();
    expect(roleChangeConsequence('Agent', ' agent ')).toBeNull();
  });

  it('names the captain losses and the Assign Captain relabel', () => {
    const c = roleChangeConsequence('captain', 'agent')!;
    expect(c.message).toMatch(/assign-agent/i);
    expect(c.message).toMatch(/My Agents/i);
    expect(c.message).toMatch(/Assign Captain/i);
  });

  it('names what each destination role costs or grants', () => {
    expect(roleChangeConsequence('agent', 'unassigned')!.message).toMatch(/assignment request/i);
    expect(roleChangeConsequence('agent', 'user')!.message).toMatch(/chat, CRM, groups/i);
    expect(roleChangeConsequence('agent', 'admin')!.message).toMatch(/everyone's roles/i);
  });

  it('still returns copy for an unremarkable transition', () => {
    const c = roleChangeConsequence('agent', 'employee')!;
    expect(c.title).toContain('employee');
    expect(c.message.length).toBeGreaterThan(0);
  });
});
