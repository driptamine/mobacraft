import { filterHeroes, heroBatches, heroRoster, type RecruitableHero } from '../../stats/races/heroes.js';
import { assetUrl } from '../render/assets.js';

export function heroSlotButton(heroName: string | undefined, slot: number, playerName: string, onPick: (hero: RecruitableHero) => void): HTMLButtonElement {
  const hero = heroRoster.find(entry => entry.name === heroName);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'skirmish-hero-choice';
  button.dataset.heroSlot = String(slot);
  button.setAttribute('aria-label', `Choose hero for ${playerName}`);
  if (hero?.icon) {
    const image = document.createElement('img');
    image.src = assetUrl(hero.icon)!; image.alt = hero.title;
    button.append(image);
  }
  const text = document.createElement('span');
  const title = document.createElement('strong'); title.textContent = hero?.title || 'Choose hero';
  const hint = document.createElement('small'); hint.textContent = 'CHOOSE HERO';
  text.append(title, hint); button.append(text);
  button.addEventListener('click', () => openHeroPicker(heroName, playerName, selected => {
    onPick(selected);
    document.querySelector<HTMLButtonElement>(`[data-hero-slot="${slot}"]`)?.focus();
  }));
  return button;
}

function openHeroPicker(selected: string | undefined, playerName: string, onPick: (hero: RecruitableHero) => void): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'lobby-hero-picker';
  dialog.setAttribute('aria-label', `Choose hero for ${playerName}`);
  const header = document.createElement('header');
  const title = document.createElement('h2'); title.textContent = `CHOOSE HERO · ${playerName}`;
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'CLOSE';
  close.addEventListener('click', () => dialog.close()); header.append(title, close);
  const filters = document.createElement('div'); filters.className = 'lobby-hero-filters';
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search heroes…'; search.setAttribute('aria-label', 'Search heroes');
  const batch = document.createElement('select'); batch.setAttribute('aria-label', 'Hero batch');
  for (const value of ['all', ...heroBatches]) {
    const option = document.createElement('option'); option.value = String(value); option.textContent = value === 'all' ? 'All batches' : `Batch ${value}`; batch.append(option);
  }
  const count = document.createElement('span'); count.setAttribute('aria-live', 'polite');
  filters.append(search, batch, count);
  const grid = document.createElement('div'); grid.className = 'lobby-hero-grid';
  function render(): void {
    const heroes = filterHeroes(batch.value === 'all' ? null : Number(batch.value), search.value);
    count.textContent = `${heroes.length} heroes`;
    grid.replaceChildren();
    for (const hero of heroes) {
      const card = document.createElement('button'); card.type = 'button';
      card.className = 'lobby-hero-card'; card.dataset.hero = hero.name;
      card.disabled = !hero.available;
      card.setAttribute('aria-pressed', String(hero.name === selected));
      card.title = hero.available ? hero.title : `${hero.title} · Unavailable`;
      const image = document.createElement('img'); image.src = assetUrl(hero.icon || '')!; image.alt = ''; image.loading = 'lazy';
      const name = document.createElement('span'); name.textContent = hero.title;
      const info = document.createElement('small'); info.textContent = hero.available ? `BATCH ${hero.batch}` : 'UNAVAILABLE';
      card.append(image, name, info);
      card.addEventListener('click', () => { dialog.close(); onPick(hero); });
      grid.append(card);
    }
    if (!heroes.length) { const empty = document.createElement('p'); empty.textContent = 'No heroes found'; grid.append(empty); }
  }
  search.addEventListener('input', render); batch.addEventListener('change', render);
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.append(header, filters, grid); document.body.append(dialog);
  render(); dialog.showModal(); search.focus();
}
