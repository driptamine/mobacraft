import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hudDue } from '../src/hud/store.js';

describe('hud refresh cadence', () => {
  it('fires every 3rd frame', () => {
    assert.equal(hudDue(1), false);
    assert.equal(hudDue(2), false);
    assert.equal(hudDue(3), true);
    assert.equal(hudDue(6), true);
    assert.equal(hudDue(7), false);
  });
});
