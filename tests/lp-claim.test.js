import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { _currentMapKey: 'arena' };
globalThis.document = { getElementById: () => null };
const controller = await import('../src/ai/controller.js');
const { setLocalMatch } = await import('../src/core/local-match.js');

function fakeWorld({ builders = [], points = {}, sites = {}, owners = {} }) {
  return {
    query: (kind) => kind === 'builder' ? builders.map((b) => b.id)
      : kind === 'strategicPoint' ? Object.keys(points).map(Number) : [],
    get: (id, kind) => {
      if (kind === 'builder') return builders.find((b) => b.id === id);
      if (kind === 'strategicPoint') return points[id];
      if (kind === 'networkOwner') return owners[id];
      if (kind === 'building') return sites[id];
      return undefined;
    },
  };
}

const bot = { owner: 7, team: 'blue', faction: 'tau' };
const botOwner = { 7: { id: 7 } };
const humanSeats = [
  { slot: 0, faction: 'ig', team: 'blue', computer: false },
  { slot: 1, faction: 'tau', team: 'blue', computer: true },
  { slot: 2, faction: 'chaos', team: 'red', computer: true },
];

describe('listening post claims', () => {
  it('defers to a teammate builder walking to the point', () => {
    setLocalMatch({ mapKey: 'arena', seats: humanSeats });
    const world = fakeWorld({
      builders: [{ id: 10, team: 'blue', buildTargetSP: 5 }],
      points: { 5: { owner: 'blue', faction: null } },
      owners: { ...botOwner, 10: { id: 42 } },
    });
    assert.equal(controller.lpClaimedByTeammate(world, bot, 5), true);
  });

  it('defers to a teammate post already under construction', () => {
    setLocalMatch({ mapKey: 'arena', seats: humanSeats });
    const world = fakeWorld({
      builders: [{ id: 10, team: 'blue', buildTarget: { pendingEntityId: 99 } }],
      points: { 5: { owner: 'blue', faction: null } },
      sites: { 99: { strategicPointId: 5 } },
      owners: { ...botOwner, 10: { id: 42 } },
    });
    assert.equal(controller.lpClaimedByTeammate(world, bot, 5), true);
  });

  it('leaves human-captured points for the human post', () => {
    setLocalMatch({ mapKey: 'arena', seats: humanSeats });
    const world = fakeWorld({
      points: { 5: { owner: 'blue', faction: 'ig' } },
      owners: botOwner,
    });
    assert.equal(controller.lpClaimedByTeammate(world, bot, 5), true);
  });

  it('builds on neutral and own-faction points', () => {
    setLocalMatch({ mapKey: 'arena', seats: humanSeats });
    const neutral = fakeWorld({ points: { 5: { owner: 'blue', faction: null } }, owners: botOwner });
    assert.equal(controller.lpClaimedByTeammate(neutral, bot, 5), false);
    const own = fakeWorld({ points: { 5: { owner: 'blue', faction: 'tau' } }, owners: botOwner });
    assert.equal(controller.lpClaimedByTeammate(own, bot, 5), false);
  });

  it('ignores enemy builders and all-computer teams', () => {
    setLocalMatch({ mapKey: 'arena', seats: humanSeats });
    const world = fakeWorld({
      builders: [{ id: 10, team: 'red', buildTargetSP: 5 }],
      points: { 5: { owner: 'blue', faction: null } },
      owners: { ...botOwner, 10: { id: 9 } },
    });
    assert.equal(controller.lpClaimedByTeammate(world, bot, 5), false);
    setLocalMatch({ mapKey: 'arena', seats: humanSeats.map((s) => ({ ...s, computer: true })) });
    const solo = fakeWorld({ points: { 5: { owner: 'blue', faction: 'ig' } }, owners: botOwner });
    assert.equal(controller.lpClaimedByTeammate(solo, bot, 5), false);
    setLocalMatch(null);
  });
});
