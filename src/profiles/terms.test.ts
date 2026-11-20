import { describe, expect, it } from 'vitest';
import { parseTerm, regexToTerm } from './terms.js';
import { profileSchema } from './types.js';

describe('parseTerm', () => {
  it('matches plain phrases as whole words, any case and spacing', () => {
    const pattern = parseTerm('software developer');

    expect(pattern.test('Senior SOFTWARE   Developer needed')).toBe(true);
    expect(pattern.test('software developers')).toBe(false);
  });

  it('escapes regex characters in plain terms', () => {
    const pattern = parseTerm('c++ (junior)');

    expect(pattern.test('Hiring C++ (junior) dev')).toBe(true);
    expect(pattern.test('Hiring c (junior)')).toBe(false);
  });

  it('supports * as a word wildcard', () => {
    const pattern = parseTerm('engineer*');

    expect(pattern.test('Engineering roles')).toBe(true);
    expect(pattern.test('engineers wanted')).toBe(true);
  });

  it('uses /regex/flags terms as regular expressions without stateful flags', () => {
    const pattern = parseTerm('/back-?end (dev|engineer)/gi');

    expect(pattern.flags).toBe('i');
    expect(pattern.test('Backend engineer')).toBe(true);
    expect(pattern.test('Backend engineer')).toBe(true);
  });

  it('round-trips a RegExp through regexToTerm', () => {
    const original = /\bsoftware (engineer|developer)\b/i;
    const parsed = parseTerm(regexToTerm(original));

    expect(parsed.source).toBe(original.source);
    expect(parsed.flags).toBe(original.flags);
  });

  it('throws on an invalid regular expression', () => {
    expect(() => parseTerm('/(unclosed/')).toThrow();
  });

  it('rejects invalid terms when validating a profile', () => {
    const result = profileSchema.safeParse({
      id: 'x',
      name: 'X',
      threshold: 1,
      groups: [{ id: 'a', label: 'A', weight: 1, terms: ['/(bad/'] }],
    });

    expect(result.success).toBe(false);
  });
});
