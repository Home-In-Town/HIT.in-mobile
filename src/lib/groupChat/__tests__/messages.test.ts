// Characterisation tests for the message-shape helpers. The two things worth
// pinning: isProjectSummaryMessage must suppress exactly the server's pinned
// project dump and nothing else (the old '📋 Project:' prefix check matched
// nothing at all), and normalizeMsg's String(x?._id || x || '') idiom must keep
// flattening both the populated and the bare-id shapes.
import { isProjectSummaryMessage, normalizeMsg } from '../messages';
import type { GroupMessage } from '../../api';

function msg(content: string, extra: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id: 'm1',
    room: 'room-1',
    sender: { id: 'u1', name: 'Tester', role: 'agent' },
    messageType: 'system',
    content,
    createdAt: new Date(2025, 4, 15, 12, 0, 0).toISOString(),
    ...extra,
  };
}

describe('isProjectSummaryMessage', () => {
  it("matches the server's real format, '📋 <projectName>'", () => {
    // buildProjectDetailsContent opens with the project NAME, never 'Project:'.
    expect(isProjectSummaryMessage(msg('📋 Green Valley Residency\nLocation: Wardha Road, Nagpur'))).toBe(true);
  });

  it('matches a flagged message whatever its content says', () => {
    expect(isProjectSummaryMessage(msg('anything at all', { isProjectDetails: true }))).toBe(true);
    expect(isProjectSummaryMessage(msg('', { isProjectDetails: true }))).toBe(true);
  });

  it('tolerates leading whitespace before the 📋', () => {
    expect(isProjectSummaryMessage(msg('\n  📋 Green Valley Residency'))).toBe(true);
  });

  it('leaves the ordinary system notices alone', () => {
    expect(isProjectSummaryMessage(msg('Ravi Sharma joined the group'))).toBe(false);
    expect(isProjectSummaryMessage(msg('Ravi Sharma exited the group'))).toBe(false);
    expect(isProjectSummaryMessage(msg('Green Valley Residency deleted by Ravi Sharma'))).toBe(false);
    expect(isProjectSummaryMessage(msg('Ravi Sharma joined — requirement matched 2BHK in Wardha Road'))).toBe(false);
  });

  it('never suppresses a USER message that happens to start with 📋', () => {
    expect(isProjectSummaryMessage(msg('📋 Green Valley Residency', { messageType: 'text' }))).toBe(false);
  });
});

describe('normalizeMsg', () => {
  it('flattens sender.id from a populated object, a bare id, or nothing', () => {
    expect(normalizeMsg({ _id: 'a', sender: { _id: 'sid', name: 'A', role: 'agent' } }, 'r1').sender.id).toBe('sid');
    expect(normalizeMsg({ _id: 'a', sender: { id: 'sid2' } }, 'r1').sender.id).toBe('sid2');
    expect(normalizeMsg({ _id: 'a' }, 'r1').sender.id).toBe('');
  });

  it('flattens unitUpdate.project the same way', () => {
    const populated = normalizeMsg({ _id: 'a', unitUpdate: { project: { _id: 'p1' }, label: 'A-101', toStatus: 'booked' } }, 'r1');
    expect(populated.unitUpdate!.project).toBe('p1');

    const bare = normalizeMsg({ _id: 'a', unitUpdate: { project: 'p2', label: 'A-101', toStatus: 'booked' } }, 'r1');
    expect(bare.unitUpdate!.project).toBe('p2');

    const missing = normalizeMsg({ _id: 'a', unitUpdate: { label: 'A-101', toStatus: 'booked' } }, 'r1');
    expect(missing.unitUpdate!.project).toBe('');
    // The rest of the payload is spread through untouched.
    expect(missing.unitUpdate!.label).toBe('A-101');
  });

  it('survives a unit_update with no unitUpdate payload', () => {
    // CURRENT behaviour: the type says a unit_update always carries a payload,
    // but normalizeMsg only looks at the field, so a malformed message
    // normalizes to unitUpdate undefined instead of throwing.
    const out = normalizeMsg({ _id: 'a', messageType: 'unit_update' }, 'r1');
    expect(out.unitUpdate).toBeUndefined();
    expect(out.messageType).toBe('unit_update');
    expect(out.id).toBe('a');
  });

  it('prefers _id, then id, then a tmp_ fallback', () => {
    expect(normalizeMsg({ _id: 'db-id', id: 'other' }, 'r1').id).toBe('db-id');
    expect(normalizeMsg({ id: 'other' }, 'r1').id).toBe('other');
    expect(normalizeMsg({}, 'r1').id).toMatch(/^tmp_\d+_\d+$/);
  });

  it('gives two id-less messages different tmp_ ids', () => {
    const a = normalizeMsg({}, 'r1').id;
    const b = normalizeMsg({}, 'r1').id;
    expect(a).not.toBe(b);
  });

  it('coerces isProjectDetails to a strict boolean', () => {
    expect(normalizeMsg({ _id: 'a', isProjectDetails: true }, 'r1').isProjectDetails).toBe(true);
    expect(normalizeMsg({ _id: 'a', isProjectDetails: 'yes' }, 'r1').isProjectDetails).toBe(false);
    expect(normalizeMsg({ _id: 'a' }, 'r1').isProjectDetails).toBe(false);
  });

  it('defaults messageType to text and content to an empty string', () => {
    const out = normalizeMsg({ _id: 'a' }, 'r1');
    expect(out.messageType).toBe('text');
    expect(out.content).toBe('');
  });

  it('falls back to the roomId argument when the payload has no room', () => {
    expect(normalizeMsg({ _id: 'a' }, 'r1').room).toBe('r1');
    expect(normalizeMsg({ _id: 'a', room: 'r2' }, 'r1').room).toBe('r2');
  });
});
