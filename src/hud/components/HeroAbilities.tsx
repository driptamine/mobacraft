import type { JSX } from 'react';
import { world } from '../../core/scene.js';
import { kitFor } from '../../heroes/hero-kits.js';
import { heroAbilityCooldown, heroStunned } from '../../heroes/hero-combat.js';
import { HERO_ABILITY_KEYS, chooseHeroAbility, heroAbilityMessage, pendingHeroAbility, selectedAbilityHero } from '../../input/hero-abilities.js';
import { setHudHover } from '../../input/camera.js';
import { useHUDVersion } from '../useHUD.js';

export function HeroAbilities(): JSX.Element | null {
  useHUDVersion('topbar');
  const id = selectedAbilityHero();
  if (id === undefined) return null;
  const kit = kitFor(world.get(id, 'squad').unitType)!;
  const stunned = heroStunned(world, id);
  return (
    <section className="hero-abilities" aria-label={`${kit.name} abilities`} onPointerEnter={() => setHudHover(true)} onPointerLeave={() => setHudHover(false)}>
      {heroAbilityMessage && <p role="status">{heroAbilityMessage}</p>}
      <div className="hero-ability-list">
        {kit.abilities.map((ability, index) => {
          const remaining = Math.ceil(heroAbilityCooldown(world, id, index));
          const armed = pendingHeroAbility?.caster === id && pendingHeroAbility?.index === index;
          return (
            <button key={ability.name} type="button" aria-label={ability.name} aria-pressed={armed}
              disabled={remaining > 0 || stunned} title={`${ability.name}\n${ability.description}\nCooldown: ${ability.cooldown}s`}
              style={{ borderColor: armed ? '#fff2b6' : `#${kit.color.toString(16).padStart(6, '0')}80` }}
              onClick={() => chooseHeroAbility(index)}>
              <span className="hero-ability-icon" aria-hidden="true">{ability.icon}</span>
              <span className="hero-ability-name">{ability.name}</span>
              <kbd>{remaining > 0 ? `${remaining}s` : HERO_ABILITY_KEYS[index]?.slice(-1)}</kbd>
            </button>
          );
        })}
      </div>
    </section>
  );
}
