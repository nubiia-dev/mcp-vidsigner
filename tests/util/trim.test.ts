import { describe, expect, it } from 'vitest';
import { trimEnd } from '../../src/util/trim.js';

describe('trimEnd', () => {
  it('removes every trailing occurrence of the given characters', () => {
    expect(trimEnd('https://x.test/api///', '/')).toBe('https://x.test/api');
    expect(trimEnd('host.example.com..', '.')).toBe('host.example.com');
    expect(trimEnd('see https://x.test/a?!.,', '.,;:!?')).toBe('see https://x.test/a');
  });

  it('keeps inner and leading occurrences and handles empty or fully trimmed input', () => {
    expect(trimEnd('/a//b', '/')).toBe('/a//b');
    expect(trimEnd('', '/')).toBe('');
    expect(trimEnd('///', '/')).toBe('');
  });

  it('runs in linear time on adversarial input', () => {
    const start = Date.now();
    trimEnd('/'.repeat(200_000) + 'x', '/');
    expect(Date.now() - start).toBeLessThan(500);
  });
});
