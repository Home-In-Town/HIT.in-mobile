// Characterisation tests for the Groups-row text. These are the strings the
// user reads on every row, and most of them are assembled by
// `.filter(Boolean).join(' · ')` — so what is really pinned here is which
// segments are ABSENT: a project count the server has not sent yet, and a
// project that failed to populate must never reach the row as 'undefined'.
import { roomDisplayName, roomLines, roomTypeLabel } from '../rooms';
import type { GroupRoom } from '../../api';

const member = (id: string): GroupRoom['members'][number] => ({
  user: { id, name: `User ${id}`, role: 'agent' },
  role: 'member',
});

// A minimal valid room; each test overrides only the fields it is about.
function room(over: Partial<GroupRoom> = {}): GroupRoom {
  return {
    id: 'r1',
    name: 'Green Valley Residency',
    roomType: 'project',
    members: [member('u1')],
    description: '',
    lastActivity: new Date(2025, 4, 15, 12, 0, 0).toISOString(),
    ...over,
  };
}

describe('roomDisplayName', () => {
  it("renames the universal room to 'AI Lead Matching'", () => {
    expect(roomDisplayName(room({ name: 'HIT Community', isUniversal: true, roomType: 'universal' }))).toBe(
      'AI Lead Matching',
    );
  });

  it("renames any room NAMED 'HIT Community', case-insensitively, even without the flag", () => {
    expect(roomDisplayName(room({ name: 'HIT Community' }))).toBe('AI Lead Matching');
    expect(roomDisplayName(room({ name: 'hit community india' }))).toBe('AI Lead Matching');
  });

  it('prefers companyName, then builder name, then the room name on a builder room', () => {
    const builderRoom = (builder: GroupRoom['builder']) =>
      roomDisplayName(room({ roomType: 'builder', name: 'Room Name', builder }));

    expect(builderRoom({ id: 'b1', companyName: 'Acme Developers', name: 'Ravi Sharma' })).toBe('Acme Developers');
    expect(builderRoom({ id: 'b1', name: 'Ravi Sharma' })).toBe('Ravi Sharma');
    expect(builderRoom({ id: 'b1' })).toBe('Room Name');
    expect(roomDisplayName(room({ roomType: 'builder', name: 'Room Name' }))).toBe('Room Name');
  });

  it('uses the room name for every other type', () => {
    expect(roomDisplayName(room({ roomType: 'project' }))).toBe('Green Valley Residency');
    expect(roomDisplayName(room({ roomType: 'area', name: 'Wardha Road' }))).toBe('Wardha Road');
  });

  it('returns an empty string when there is no room', () => {
    expect(roomDisplayName(null)).toBe('');
    expect(roomDisplayName(undefined)).toBe('');
    expect(roomDisplayName()).toBe('');
  });
});

describe('roomLines', () => {
  it('puts members, the project count and Verified on a builder row', () => {
    const lines = roomLines(
      room({
        roomType: 'builder',
        members: [member('u1'), member('u2')],
        projectCount: 7,
        builder: { id: 'b1', companyName: 'Acme Developers', isVerified: true },
      }),
    );

    expect(lines.primary).toBe('2 members · 7 projects · Verified');
    expect(lines.secondary).toBe('Builder · Tap to see their properties');
  });

  it('OMITS the projects segment when the server has not sent a count', () => {
    // projectCount lands in a later backend phase; until then the row must read
    // correctly without it rather than printing '0 projects' or 'undefined'.
    const noCount = roomLines(room({ roomType: 'builder', builder: { id: 'b1', isVerified: true } }));
    expect(noCount.primary).toBe('1 member · Verified');

    const zeroCount = roomLines(
      room({ roomType: 'builder', projectCount: 0, builder: { id: 'b1', isVerified: true } }),
    );
    expect(zeroCount.primary).toBe('1 member · Verified');
    expect(zeroCount.primary).not.toContain('project');
  });

  it('singularises the project count at 1', () => {
    const lines = roomLines(room({ roomType: 'builder', projectCount: 1, builder: { id: 'b1' } }));
    expect(lines.primary).toBe('1 member · 1 project');
  });

  it("drops Verified and says 'Agent' for an unverified agent", () => {
    const lines = roomLines(room({ roomType: 'builder', builder: { id: 'b1', role: 'agent' } }));
    expect(lines.primary).toBe('1 member');
    expect(lines.secondary).toBe('Agent · Tap to see their properties');
  });

  it('puts location on line 1 and price/bhk/size on line 2 for a project room', () => {
    const lines = roomLines(
      room({
        roomType: 'project',
        members: [member('u1'), member('u2'), member('u3')],
        project: {
          id: 'p1',
          projectName: 'Green Valley Residency',
          location: 'Wardha Road',
          city: 'Nagpur',
          pricing: { startingPrice: 8500000 },
          configuration: { bhkOptions: ['2BHK', '3BHK'], carpetAreaRange: '950-1400 sqft' },
        },
      }),
    );

    expect(lines.primary).toBe('3 members · Wardha Road, Nagpur');
    expect(lines.secondary).toBe('₹85L+ · 2BHK/3BHK · 950-1400 sqft');
  });

  it('falls back to plotSizeRange when there is no carpet area', () => {
    const lines = roomLines(
      room({
        roomType: 'project',
        project: { id: 'p1', projectName: 'Sunrise Plots', configuration: { plotSizeRange: '1200-2400 sqft' } },
      }),
    );

    expect(lines.primary).toBe('1 member');
    expect(lines.secondary).toBe('1200-2400 sqft');
  });

  it('falls through to the area branch when the project failed to populate', () => {
    // The guard that matters: a project room with no project must read as its
    // locality, never as 'undefined'.
    const withArea = roomLines(
      room({ roomType: 'project', project: undefined, area: { city: 'Nagpur', location: 'Wardha Road' } }),
    );
    expect(withArea.primary).toBe('1 member · Wardha Road, Nagpur');
    expect(withArea.secondary).toBe('');
    expect(withArea.primary).not.toContain('undefined');

    const bare = roomLines(room({ roomType: 'project', project: undefined }));
    expect(bare.primary).toBe('1 member');
    expect(bare.secondary).toBe('');
    expect(bare.primary).not.toContain('undefined');
    expect(bare.secondary).not.toContain('undefined');
  });

  it('reads the locality on an area room', () => {
    const lines = roomLines(room({ roomType: 'area', area: { city: 'Nagpur', location: 'Wardha Road' } }));
    expect(lines.primary).toBe('1 member · Wardha Road, Nagpur');
    expect(lines.secondary).toBe('');
  });
});

describe('roomTypeLabel', () => {
  it('gives the universal room no chip at all', () => {
    expect(roomTypeLabel(room({ roomType: 'universal', isUniversal: true }))).toBe('');
    // The flag wins over the type: a builder room flagged universal gets ''.
    expect(roomTypeLabel(room({ roomType: 'builder', isUniversal: true }))).toBe('');
  });

  it('labels the three real types', () => {
    expect(roomTypeLabel(room({ roomType: 'builder' }))).toBe('Company');
    expect(roomTypeLabel(room({ roomType: 'project' }))).toBe('Project');
    expect(roomTypeLabel(room({ roomType: 'area' }))).toBe('Area');
  });

  it('returns an empty string for a type it does not know', () => {
    // Cast because the union forbids it at compile time; the server is the only
    // writer and this is the branch that catches a type it adds later.
    const unknown = room({ roomType: 'lead' as unknown as GroupRoom['roomType'] });
    expect(roomTypeLabel(unknown)).toBe('');
  });
});
