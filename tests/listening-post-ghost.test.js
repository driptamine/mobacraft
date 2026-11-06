import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./node-esm-hooks.mjs', import.meta.url);
globalThis.document = { getElementById: () => null };
const { canPlaceListeningPost, ghostUsesConfigModel } = await import('../src/meshes.js');

describe('listening post placement', () => {
  it('routes the ghost through the real listening_post.glb model', () => {
    assert.equal(ghostUsesConfigModel('listening_post'), true);
  });

  it('allows only player-owned points and relics without a post', () => {
    assert.equal(canPlaceListeningPost(null, 'blue'), false);
    assert.equal(canPlaceListeningPost(undefined, 'blue'), false);
    assert.equal(canPlaceListeningPost({ owner: null, hasListeningPost: false }, 'blue'), false);
    assert.equal(canPlaceListeningPost({ owner: 'red', hasListeningPost: false }, 'blue'), false);
    assert.equal(canPlaceListeningPost({ owner: 'blue', hasListeningPost: true }, 'blue'), false);
    assert.equal(canPlaceListeningPost({ owner: 'blue', hasListeningPost: false }, 'blue'), true);
    assert.equal(
      canPlaceListeningPost({ kind: 'relic', owner: 'blue', hasListeningPost: false }, 'blue'),
      true,
    );
  });
});
