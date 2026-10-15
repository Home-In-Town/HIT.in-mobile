// Characterisation tests for the media coercion. A media entry is a bare URL
// string from one endpoint and a `{ url }` object from another, which is the
// whole reason these two helpers exist — so the tolerance for both shapes, and
// the non-array fallback, are what is pinned here.
import { mediaUrls, oneUrl } from '../media';

describe('mediaUrls', () => {
  it('returns the URLs of a mixed array, in order', () => {
    expect(mediaUrls(['a.jpg', { url: 'b.jpg' }, 'c.jpg', { url: 'd.jpg' }])).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
      'd.jpg',
    ]);
  });

  it('drops falsy entries and objects with no url', () => {
    expect(mediaUrls(['a.jpg', null, undefined, '', { url: '' }, {}, { url: 'b.jpg' }])).toEqual([
      'a.jpg',
      'b.jpg',
    ]);
  });

  it('returns an empty array for anything that is not an array', () => {
    expect(mediaUrls(null)).toEqual([]);
    expect(mediaUrls(undefined)).toEqual([]);
    expect(mediaUrls({ url: 'a.jpg' })).toEqual([]);
    expect(mediaUrls('a.jpg')).toEqual([]);
  });
});

describe('oneUrl', () => {
  it('passes a bare string straight through', () => {
    expect(oneUrl('a.jpg')).toBe('a.jpg');
  });

  it('unwraps a { url } object', () => {
    expect(oneUrl({ url: 'b.jpg' })).toBe('b.jpg');
  });

  it('returns an empty string when there is nothing to unwrap', () => {
    expect(oneUrl(null)).toBe('');
    expect(oneUrl(undefined)).toBe('');
    expect(oneUrl({})).toBe('');
    expect(oneUrl({ uri: 'c.jpg' })).toBe('');
  });
});
