import type { HeroKit } from './hero-kits.js';

export const batch1Kits: Readonly<Record<string, HeroKit>> = {
  axe: { name: 'Axe', color: 0xf45c4f, abilities: [
    { name: 'Iron Stand', icon: '▣', description: 'Brace against incoming damage and shock nearby enemies.', mode: 'self', cooldown: 12, radius: 6, damage: 40, stun: 0.8, guard: 0.40, duration: 4 },
    { name: 'Red Sweep', icon: '⟳', description: 'Strike everyone within reach and slow their advance.', mode: 'self', cooldown: 7, radius: 5, damage: 90, slow: 0.35, duration: 2 },
    { name: 'Breaker Rush', icon: '➤', description: 'Rush toward the target point and knock enemies back on arrival.', mode: 'area', cooldown: 13, range: 14, dash: 12, radius: 5, damage: 105, push: 3 },
    { name: 'Anvil Drop', icon: '▼', description: 'Deliver a heavy blow to one nearby enemy.', mode: 'enemy', cooldown: 28, range: 5, damage: 310 },
  ] },
  juggernaut: { name: 'Juggernaut', color: 0xffaa63, abilities: [
    { name: 'Spiral Step', icon: '⟳', description: 'Deal repeated damage in a circle around you as you move.', mode: 'self', cooldown: 12, radius: 5, damage: 42, pulses: 4, duration: 3 },
    { name: 'Restoring Seal', icon: '✚', description: 'Restore health to nearby allies in a series of pulses.', mode: 'area', cooldown: 18, range: 17, radius: 6, heal: 65, pulses: 4, duration: 4 },
    { name: 'Draw Cut', icon: '➤', description: 'Dash along a line and cut through enemies in your path.', mode: 'line', cooldown: 9, range: 13, radius: 2, dash: 12, damage: 105 },
    { name: 'Seven Petals', icon: '✷', description: 'Fill a target area with a sustained barrage of slashes.', mode: 'area', cooldown: 30, range: 15, radius: 6, damage: 74, pulses: 5, duration: 2.4 },
  ] },
  sven: { name: 'Sven', color: 0x529cf8, abilities: [
    { name: 'Arc Hammer', icon: '⬢', description: 'Hurl an electric weight that shocks enemies around its target.', mode: 'enemy', cooldown: 12, range: 20, radius: 4, damage: 115, stun: 1.3, shot: 'weight' },
    { name: 'Wide Cleave', icon: '◒', description: 'Send a broad cut along a short line.', mode: 'line', cooldown: 7, range: 9, radius: 3.4, damage: 130 },
    { name: 'Shield March', icon: '▣', description: 'Grant nearby allies protection and a burst of speed.', mode: 'self', cooldown: 16, radius: 7, guard: .27, haste: .30, duration: 5 },
    { name: 'Thunder Oath', icon: '✦', description: 'Empower your attacks and strike nearby enemies.', mode: 'self', cooldown: 29, radius: 5, damage: 95, power: 28, duration: 9 },
  ] },
  tidehunter: { name: 'Tidehunter', color: 0x42d6ba, abilities: [
    { name: 'Surge Jet', icon: '≈', description: 'Launch a surge that damages and slows one enemy.', mode: 'enemy', cooldown: 9, range: 22, damage: 100, slow: .45, duration: 3, shot: 'crystal' },
    { name: 'Reef Shell', icon: '⬡', description: 'Grow protective plating and restore some health.', mode: 'self', cooldown: 14, radius: 0, guard: .48, heal: 90, duration: 5 },
    { name: 'Keel Sweep', icon: '◒', description: 'Sweep close enemies away and slow them.', mode: 'self', cooldown: 8, radius: 6, damage: 95, push: 2.5, slow: .3, duration: 2 },
    { name: 'Seafloor Quake', icon: '✷', description: 'Raise successive waves that stun enemies in a wide area.', mode: 'self', cooldown: 34, radius: 11, damage: 87, stun: 1.2, pulses: 3, duration: 1.8 },
  ] },
  pudge: { name: 'Pudge', color: 0xaac859, abilities: [
    { name: 'Chain Drag', icon: '↢', description: 'Send a weighted chain along a line and pull in the first enemy it hits.', mode: 'line', cooldown: 12, range: 23, radius: 1.45, damage: 100, pull: 18, shot: 'tether' },
    { name: 'Mire Cloud', icon: '◉', description: 'Trail a corrosive cloud that damages and slows nearby enemies.', mode: 'self', cooldown: 13, radius: 5.5, damage: 32, slow: .25, pulses: 5, duration: 4 },
    { name: 'Patchwork', icon: '✚', description: 'Restore health and briefly harden your hide.', mode: 'self', cooldown: 16, radius: 0, heal: 155, guard: .22, duration: 3 },
    { name: 'Feast Grip', icon: '✹', description: 'Seize an enemy at close range and recover health from the attack.', mode: 'enemy', cooldown: 29, range: 4, damage: 260, stun: 1.6, heal: 125 },
  ] },
  drow: { name: 'Drow', color: 0x75c9ff, primary: { shape: 'arrow', speed: 42 }, abilities: [
    { name: 'Rime Arrow', icon: '➶', description: 'Fire a heavy arrow that chills its target.', mode: 'enemy', cooldown: 6, range: 31, damage: 95, slow: .48, duration: 3, shot: 'arrow' },
    { name: 'Snow Squall', icon: '≈', description: 'Blast enemies in a corridor backward and slow them.', mode: 'line', cooldown: 12, range: 18, radius: 3, damage: 65, push: 4, slow: .35, duration: 2 },
    { name: 'Silver Volley', icon: '⇉', description: 'Rain arrows on an area in three volleys.', mode: 'area', cooldown: 14, range: 28, radius: 6, damage: 56, pulses: 3, duration: 1.7 },
    { name: 'Clear Sight', icon: '◎', description: 'Boost your attack damage and movement speed.', mode: 'self', cooldown: 24, radius: 0, power: 23, haste: .27, duration: 9 },
  ] },
  lina: { name: 'Lina', color: 0xff7338, primary: { shape: 'ember', speed: 34 }, abilities: [
    { name: 'Ember Ribbon', icon: '≈', description: 'Sweep a ribbon of fire through a line of enemies.', mode: 'line', cooldown: 8, range: 23, radius: 2.6, damage: 120 },
    { name: 'Kiln Circle', icon: '◉', description: 'Ignite the ground and stun enemies in the circle.', mode: 'area', cooldown: 13, range: 24, radius: 5, damage: 105, stun: 1.2 },
    { name: 'Heatstep', icon: '➤', description: 'Dash away from danger and gain a short speed boost.', mode: 'area', cooldown: 12, range: 12, dash: 12, radius: 3, damage: 55, haste: .32, duration: 4 },
    { name: 'Solar Needle', icon: 'ϟ', description: 'Launch a focused bolt of heat at one enemy.', mode: 'enemy', cooldown: 30, range: 27, damage: 340, shot: 'ember' },
  ] },
  lion: { name: 'Lion', color: 0xcb8aff, primary: { shape: 'sigil', speed: 32 }, abilities: [
    { name: 'Spire Row', icon: '▲', description: 'Push a row of spikes through the ground and stun enemies above it.', mode: 'line', cooldown: 11, range: 22, radius: 2.2, damage: 95, stun: 1.1 },
    { name: 'Sable Mark', icon: '◇', description: 'Briefly pin one enemy in place and interrupt its attacks.', mode: 'enemy', cooldown: 16, range: 22, stun: 2.1, shot: 'sigil' },
    { name: 'Vital Siphon', icon: '↢', description: 'Drain health from an enemy to heal yourself.', mode: 'enemy', cooldown: 12, range: 21, damage: 110, heal: 90, shot: 'tether' },
    { name: 'Violet Rupture', icon: '✷', description: 'Launch an orb that bursts on impact and hurts nearby enemies.', mode: 'enemy', cooldown: 31, range: 26, radius: 4, damage: 270, shot: 'sigil' },
  ] },
  crystal_maiden: { name: 'Crystal Maiden', color: 0x81e6fd, primary: { shape: 'crystal', speed: 31 }, abilities: [
    { name: 'Glacier Halo', icon: '❄', description: 'Freeze the ground in a circle and slow enemies inside.', mode: 'area', cooldown: 10, range: 23, radius: 6, damage: 96, slow: .44, duration: 3 },
    { name: 'Quartz Lock', icon: '◇', description: 'Fire a crystal that pins its target in place.', mode: 'enemy', cooldown: 14, range: 23, damage: 80, stun: 1.5, shot: 'crystal' },
    { name: 'Winter Refuge', icon: '✚', description: 'Heal and shield an ally.', mode: 'ally', cooldown: 15, range: 18, heal: 130, guard: .3, duration: 5 },
    { name: 'Whiteout', icon: '✷', description: 'Call repeated freezing bursts around you.', mode: 'self', cooldown: 32, radius: 9, damage: 56, slow: .35, pulses: 6, duration: 4 },
  ] },
  shadow_fiend: { name: 'Shadow Fiend', color: 0xf35467, primary: { shape: 'crescent', speed: 37 }, abilities: [
    { name: 'Cinder Step', icon: '◒', description: 'Detonate the ground close to you.', mode: 'area', cooldown: 7, range: 10, radius: 4, damage: 118 },
    { name: 'Ash Eruption', icon: '▲', description: 'Erupt a distant patch of ground and slow enemies inside.', mode: 'area', cooldown: 10, range: 22, radius: 5, damage: 126, slow: .28, duration: 2.5 },
    { name: 'Soot Mantle', icon: '⬡', description: 'Empower your attacks and reduce incoming damage.', mode: 'self', cooldown: 17, radius: 0, power: 22, guard: .24, duration: 7 },
    { name: 'Dusk Chorus', icon: '✷', description: 'Send waves outward that damage and drive back nearby enemies.', mode: 'self', cooldown: 34, radius: 11, damage: 88, push: 2, pulses: 4, duration: 2 },
  ] },
};
