import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
globalThis.document = { getElementById: () => null };
const controller = await import('../src/ai/controller.js');

describe('listening posts', () => {
  it('every ai/ race with post data builds its own post type', () => {
    const expected = {
      ig: 'listening_post', chaos: 'listening_post', 'space marines': 'listening_post',
      orks: 'listening_post', necrons: 'listening_post', eldar: 'listening_post',
      tau: 'tau_listening_post', sob: 'listening_post', 'dark eldar': null,
    };
    for (const [faction, type] of Object.entries(expected)) {
      assert.equal(controller.listeningPostTypeFor(faction), type, faction);
    }
  });
});
