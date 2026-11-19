import { batch1Kits } from './batch1-kits.js';

export type ShotShape = 'arrow' | 'ember' | 'sigil' | 'crystal' | 'crescent' | 'weight' | 'tether' | 'shard' | 'tracer' | 'orb' | 'wave';
export interface ShotStyle { shape: ShotShape; color: number; speed: number }

interface AbilityOptions {
  damage?: number;
  heal?: number;
  slow?: number;
  stun?: number;
  haste?: number;
  guard?: number;
  power?: number;
  pull?: number;
  push?: number;
  range?: number;
  radius?: number;
  duration?: number;
  pulses?: number;
  shot?: ShotShape;
  shotSpeed?: number;
  dash?: number;
}

export interface HeroAbility extends AbilityOptions {
  name: string;
  icon: string;
  description: string;
  mode: 'self' | 'area' | 'line' | 'enemy' | 'ally';
  cooldown: number;
}

export interface HeroKit {
  name: string;
  color: number;
  primary?: Omit<ShotStyle, 'color'>;
  castClip?: string;
  abilities: readonly HeroAbility[];
}

const kits: Readonly<Record<string, HeroKit>> = {
  ...batch1Kits,
  antimage: { name: 'Anti-Mage', color: 0xaf83ff, castClip: 'cast_mana_void', abilities: [
    { name: 'Phase Shard', icon: '◇', description: 'Hurl a split crystal that briefly slows its target.', mode: 'enemy', cooldown: 9, range: 21, damage: 95, slow: .25, duration: 2, shot: 'shard', shotSpeed: 38 },
  ] },
  bristleback: { name: 'Bristleback', color: 0xd9ae59, castClip: 'cast_hairball', abilities: [
    { name: 'Burr Bomb', icon: '✺', description: 'Lob a burr that bursts and damages nearby enemies.', mode: 'enemy', cooldown: 10, range: 19, radius: 3.1, damage: 100, shot: 'weight', shotSpeed: 26 },
  ] },
  dazzle: { name: 'Dazzle', color: 0xdb6cbd, primary: { shape: 'shard', speed: 33 }, castClip: 'cast1_poison_touch_anim', abilities: [
    { name: 'Briar Seed', icon: '✦', description: 'Fire a seed that slows its target on impact.', mode: 'enemy', cooldown: 8, range: 26, damage: 80, slow: .35, duration: 2.5, shot: 'orb', shotSpeed: 28 },
  ] },
  earthshaker: { name: 'Earthshaker', color: 0xea975d, castClip: 'fissure_anim', abilities: [
    { name: 'Fault Stone', icon: '⬢', description: 'Launch a heavy stone that stuns enemies near the impact.', mode: 'enemy', cooldown: 12, range: 21, radius: 3.4, damage: 105, stun: .8, shot: 'weight', shotSpeed: 27 },
  ] },
  kunkka: { name: 'Kunkka', color: 0x69d4dd, castClip: 'cast_tidal_wave', abilities: [
    { name: 'Breakwater', icon: '≈', description: 'Send a wave that pushes back enemies near its point of impact.', mode: 'enemy', cooldown: 11, range: 21, radius: 3.5, damage: 105, push: 2.8, shot: 'wave', shotSpeed: 30 },
  ] },
  phantom_assassin: { name: 'Phantom Assassin', color: 0x8ccfcc, castClip: 'phantom_assassin_stiflingdagger_anim', abilities: [
    { name: 'Glass Knife', icon: '➶', description: 'Throw a fast blade that slows its target.', mode: 'enemy', cooldown: 7, range: 24, damage: 90, slow: .3, duration: 2, shot: 'shard', shotSpeed: 46 },
  ] },
  queenofpain: { name: 'Queen of Pain', color: 0xeb628c, primary: { shape: 'crescent', speed: 38 }, abilities: [] },
  sniper: { name: 'Sniper', color: 0xffc776, primary: { shape: 'tracer', speed: 72 }, abilities: [] },
  storm_spirit: { name: 'Storm Spirit', color: 0x76bffb, primary: { shape: 'orb', speed: 32 }, abilities: [] },
  vengeful: { name: 'Vengeful Spirit', color: 0x9c9df6, primary: { shape: 'sigil', speed: 36 }, castClip: 'magic_missile_anim', abilities: [
    { name: 'Ion Comet', icon: '✹', description: 'Fire a glowing comet that briefly stuns its target.', mode: 'enemy', cooldown: 10, range: 25, damage: 105, stun: 1, shot: 'ember', shotSpeed: 41 },
  ] },
  witchdoctor: { name: 'Witch Doctor', color: 0xa5de80, primary: { shape: 'crystal', speed: 30 }, castClip: 'paralyzing_cask_anim', abilities: [
    { name: 'Rattle Gourd', icon: '●', description: 'Toss a gourd that rattles and damages enemies on impact.', mode: 'enemy', cooldown: 11, range: 23, radius: 3, damage: 90, stun: .6, shot: 'weight', shotSpeed: 25 },
  ] },
};

export function kitFor(unitType: string | null | undefined): HeroKit | undefined {
  return unitType && Object.hasOwn(kits, unitType) ? kits[unitType] : undefined;
}

export function abilityShotStyle(ability: HeroAbility, color: number): ShotStyle | undefined {
  if (!ability.shot) return undefined;
  return { color, shape: ability.shot, speed: ability.shotSpeed ?? (ability.mode === 'line' ? 28 : 35) };
}
