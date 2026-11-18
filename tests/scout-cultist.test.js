import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./node-esm-hooks.mjs', import.meta.url);
globalThis.window = {};
globalThis.document = { getElementById: () => null, querySelector: () => null };
const state = await import('../src/core/scene.js');
const { World } = await import('../src/core/ecs.js');
state.setWorld(new World());
const { default: spaceMarines } = await import('../src/factions/space-marines.js');
const { default: chaos } = await import('../src/factions/chaos.js');
const { getBarracksProduction } = await import('../src/hud/data.js');
const { findUnitConfig } = await import('../src/entities/entities.js');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

describe('HQ recruits', () => {
  it('registers the scout for Space Marines with a model on disk', () => {
    const unit = spaceMarines.units?.find((u) => u.name === 'scout');
    assert.ok(unit, 'scout units entry exists');
    assert.equal(unit.model, 'models/space marines/troops/scout.glb');
    assert.ok(fs.existsSync(path.join(ROOT, unit.model)), 'scout GLB exists on disk');
  });

  it('registers the cultist for Chaos with a model on disk', () => {
    const unit = chaos.units?.find((u) => u.name === 'cultist');
    assert.ok(unit, 'cultist units entry exists');
    assert.equal(unit.model, 'models/chaos/infantry/cultist.glb');
    assert.ok(fs.existsSync(path.join(ROOT, unit.model)), 'cultist GLB exists on disk');
  });

  it('trains scouts from the Space Marine HQ list', () => {
    const production = getBarracksProduction('space marines');
    const entry = production.find((p) => typeof p === 'object' && p?.name === 'scout');
    assert.ok(entry && entry.cost === 75 && entry.icon, 'HQ reads a scout order with cost and icon');
    assert.equal(findUnitConfig('space marines', 'scout')?.model, 'models/space marines/troops/scout.glb');
  });

  it('trains cultists from the Chaos HQ list without losing generic orders', () => {
    const production = getBarracksProduction('chaos');
    const entry = production.find((p) => typeof p === 'object' && p?.name === 'cultist');
    assert.ok(entry && entry.cost === 50 && entry.icon, 'HQ reads a cultist order with cost and icon');
    assert.equal(findUnitConfig('chaos', 'cultist')?.model, 'models/chaos/infantry/cultist.glb');
  });
});
