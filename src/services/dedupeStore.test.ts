import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DedupeStore } from './dedupeStore.js';

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function createStore(): DedupeStore {
  tempDir = mkdtempSync(join(tmpdir(), 'vacancy-dedupe-'));
  return new DedupeStore(join(tempDir, 'seen.db'));
}

describe('DedupeStore', () => {
  it('marks a new message as unseen first, then duplicate', () => {
    const store = createStore();

    expect(store.isDuplicate('msg-1')).toBe(false);
    expect(store.isDuplicate('msg-1')).toBe(true);
    expect(store.hasSeen('msg-1')).toBe(true);

    store.close();
  });

  it('supports read-only checks before marking a message seen', () => {
    const store = createStore();

    expect(store.hasSeen('msg-2')).toBe(false);
    store.markSeen('msg-2');
    expect(store.hasSeen('msg-2')).toBe(true);

    store.close();
  });
});
