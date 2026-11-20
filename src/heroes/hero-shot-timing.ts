import type { ShotStyle } from './hero-kits.js';

export function heroProjectileSpeed(style: ShotStyle): ShotStyle {
  return { ...style, speed: style.speed * 0.5 };
}
