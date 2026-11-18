import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
globalThis.document = { getElementById: () => null };
const { unitTooltip } = await import('../src/hud/data.js');

describe('unit combat tooltip', () => {
  it('shows range, armour and base damage of the unit weapon', () => {
    const tip = unitTooltip({ name: 'grey_knight' }, 'space marines');
    assert.ok(tip.includes('RNG 25u'), tip);
    assert.ok(tip.includes('ARMOR Infantry Heavy Medium'), tip);
    assert.ok(tip.includes('BASE DMG 55-58'), tip);
  });
  it('scales wiki per-shot damage by refire rate', () => {
    const tip = unitTooltip({ name: 'Guardsmen' }, 'ig');
    assert.ok(tip.includes('RNG 27u'), tip);
    assert.ok(tip.includes('BASE DMG 20-24'), tip);
  });

  it('covers newly added recruits with their own wiki weapons', () => {
    const cultist = unitTooltip({ name: 'cultist' }, 'chaos');
    assert.ok(cultist.includes('RNG 20u'), cultist);
    assert.ok(cultist.includes('ARMOR Infantry Low'), cultist);
    assert.ok(cultist.includes('BASE DMG 8-9'), cultist);
    const scout = unitTooltip({ name: 'scout' }, 'space marines');
    assert.ok(scout.includes('RNG 25u'), scout);
    assert.ok(scout.includes('ARMOR Infantry Medium'), scout);
    assert.ok(scout.includes('BASE DMG 11-13'), scout);
  });

  it('falls back gracefully without a weapon profile', () => {
    const tip = unitTooltip({ name: 'heretic' }, 'chaos');
    assert.ok(tip.includes('HERETIC'), tip);
    assert.ok(!tip.includes('BASE DMG'), tip);
  });
});
