import React, { useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { world, camera, selSquads, canCommand } from '../../core/scene.js';
import { updateHUD } from '../../core/hud.js';
import { useHUDVersion } from '../useHUD.js';
import { assetUrl } from '../../render/assets.js';
import { dotaItems, dotaItemById, filterItems, itemCategories, itemRecipes, itemStatus, recipeComponentIds } from '../../items/catalog.js';
import { assembleHeroItem, buyHeroItem, HERO_ITEM_SLOTS, planItemAssembly, sellHeroItem, type HeroInventory } from '../../items/inventory.js';
import { heroRoster } from '../../../stats/races/heroes.js';
import { isDotaMap } from '../../maps/dota-map-layout.js';
import { isDoomSpiral } from '../../maps/doom-spiral.js';
import { lockCamera } from '../../render/camera-lock.js';
import { setHudHover } from '../../input/camera.js';

const bonusLabels: Record<string, string> = { health: 'Здоровье', strength: 'Сила', agility: 'Ловкость', intelligence: 'Интеллект', damage: 'Урон', armor: 'Броня', attackSpeed: 'Скорость атаки', movementSpeed: 'Скорость передвижения', movementPercent: 'Передвижение, %', healthRegen: 'Восстановление здоровья' };

export function HeroItems(): JSX.Element | null {
  useHUDVersion('topbar'); useHUDVersion('health');
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [category, setCategory] = useState('all');
  const [selected, setSelected] = useState('item_blink'), [selectedSlot, setSelectedSlot] = useState<number | null>(null), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), requestWorld = useRef(world);
  const hero = [...selSquads, ...(world?.query('heroInventory') || [])].find(id => {
    const squad = world?.get(id, 'squad');
    return squad && world.has(id, 'heroInventory') && canCommand(squad.team, id);
  });
  const inventory: HeroInventory | undefined = hero == null ? undefined : world?.get(hero, 'heroInventory');
  const name = hero == null ? '' : heroRoster.find(entry => entry.name === world.get(hero, 'squad')?.unitType)?.title || 'Hero';
  const key = window._currentMapKey || '';
  const enabled = !window._multiplayerMode && (isDotaMap(key) || isDoomSpiral(key));
  useEffect(() => { setOpen(false); setError(''); requestWorld.current = world; }, [world]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    return camera ? lockCamera(camera) : undefined;
  }, [open]);
  useEffect(() => () => setHudHover(false), []);
  if (!enabled) return null;
  const item = dotaItemById.get(selected)!;
  const items = open ? filterItems(category, search) : [];
  const recipes = open ? itemRecipes(item) : [];
  const plan = open && inventory ? planItemAssembly(inventory, item) : null;
  const close = () => { setOpen(false); setError(''); };
  const show = (slot: number | null = null) => {
    if (slot != null && inventory?.slots[slot]) setSelected(inventory.slots[slot]!.itemId);
    setSelectedSlot(slot); setError(''); requestWorld.current = world; setOpen(true);
  };
  const buy = () => {
    if (hero == null || requestWorld.current !== world || !canCommand(world.get(hero, 'squad')?.team, hero)) return;
    setError(buyHeroItem(world, hero, item.id) || ''); updateHUD();
  };
  const sell = () => {
    if (hero == null || selectedSlot == null || requestWorld.current !== world || !canCommand(world.get(hero, 'squad')?.team, hero)) return;
    const result = sellHeroItem(world, hero, selectedSlot); setError(result || ''); if (!result) setSelectedSlot(null); updateHUD();
  };
  const assemble = () => {
    if (hero == null || requestWorld.current !== world || !canCommand(world.get(hero, 'squad')?.team, hero)) return;
    const result = assembleHeroItem(world, hero, item.id);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    setSelected(result.itemId);
    setSelectedSlot(result.slot);
    setError('');
    updateHUD();
  };
  const slots = (insideShop = false) => <div className="hero-item-slots" aria-label="Инвентарь героя">
    {Array.from({ length: HERO_ITEM_SLOTS }, (_, slot) => {
      const entry = inventory?.slots[slot], held = entry && dotaItemById.get(entry.itemId);
      return <button key={slot} type="button" data-inventory-slot={slot} aria-label={`Слот ${slot + 1}: ${held?.title || 'пусто'}`} title={held?.title || 'Пустой слот'} disabled={!inventory} onClick={() => {
        if (insideShop) { setSelectedSlot(slot); setError(''); if (held) setSelected(held.id); }
        else show(held ? slot : null);
      }}>
        {held ? <img src={assetUrl(held.icon)!} alt={held.title} /> : <span>{slot + 1}</span>}
      </button>;
    })}
  </div>;
  return <>
    <section className="hero-inventory" aria-label="Предметы героя" onPointerEnter={() => setHudHover(true)} onPointerLeave={() => setHudHover(false)}>
      <div className="hero-inventory-heading"><span>{name || 'ПРЕДМЕТЫ'}</span><b>{Math.floor(inventory?.gold || 0)} G</b></div>
      {slots()}
      <button className="hero-shop-open" type="button" onClick={() => show()}>МАГАЗИН · ITEMS</button>
    </section>
    {open && createPortal(<dialog ref={dialog} className="dota-item-shop" aria-label="Магазин предметов Dota" onCancel={close} onClose={close}
      onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
      <header><h2>МАГАЗИН ПРЕДМЕТОВ</h2><span>{name} · <b>{Math.floor(inventory?.gold || 0)} G</b></span><button type="button" onClick={close}>ЗАКРЫТЬ</button></header>
      <div className="dota-shop-filters"><input autoFocus aria-label="Поиск предметов" type="search" placeholder="Название или описание предмета…" value={search} onChange={event => setSearch(event.target.value)} />
        <select aria-label="Категория предметов" value={category} onChange={event => setCategory(event.target.value)}>{itemCategories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <span aria-live="polite">{items.length} / {dotaItems.length}</span></div>
      <div className="dota-shop-body"><div className="dota-item-catalog">
        {items.map(entry => <button type="button" key={entry.id} data-item={entry.id} aria-pressed={entry.id === selected} title={`${entry.title} · ${itemStatus(entry)}`} onClick={() => { setSelected(entry.id); setSelectedSlot(null); setError(''); }}>
          <img src={assetUrl(entry.icon)!} alt="" loading="lazy" /><span>{entry.title}</span><small>{itemStatus(entry)}</small>
        </button>)}
        {!items.length && <p>Предметы не найдены</p>}
      </div><aside className="dota-item-details">
        <div className="dota-item-title"><img src={assetUrl(item.icon)!} alt={item.title} /><div><h3>{item.title}</h3><b>{itemStatus(item)}</b></div></div>
        <dl>{Object.entries(item.passive).filter(([, value]) => value).map(([bonus, value]) => <React.Fragment key={bonus}><dt>{bonusLabels[bonus]}</dt><dd>{value > 0 ? '+' : ''}{value}</dd></React.Fragment>)}</dl>
        <p className="dota-item-description">{item.description || item.descriptionEnglish || (item.recipe ? 'Рецепт для сборки предмета.' : 'Предмет из каталога Dota.')}</p>
        {recipes.length > 0 && <div className="dota-item-components">
          <b>Компоненты</b>
          {recipes.map(recipe => <div key={recipe.id}>
            {recipe.components.filter(parts => parts.some(Boolean)).map((parts, index) =>
              <p key={index}>{recipeComponentIds(parts).map(id => dotaItemById.get(id)?.title ?? id).join(' + ')}{recipe.cost > 0 ? ` · ${recipe.cost} G` : ''}</p>
            )}
          </div>)}
          {plan ? <button className="dota-item-buy" type="button" onClick={assemble} disabled={!inventory || inventory.gold < plan.fee}>
            {plan.fee ? `Собрать · ${plan.fee} G` : 'Собрать'}
          </button> : <p>Для сборки нужны компоненты в инвентаре.</p>}
        </div>}
        <p className="dota-item-effects-note">Работают базовые бонусы здоровья, урона, брони и скорости. Активные и уникальные эффекты пока недоступны.</p>
        {item.purchasable && <button className="dota-item-buy" type="button" onClick={buy} disabled={!inventory || inventory.gold < item.cost || inventory.slots.every(Boolean)}>
          {item.recipe ? 'Купить рецепт' : 'Купить'} · {item.cost} G
        </button>}
        {!item.purchasable && !recipes.length && <p className="dota-item-hint">Предмет недоступен для покупки.</p>}
        {!inventory && <p className="dota-item-hint">Для покупки выберите своего героя.</p>}
        {error && <p role="alert" className="dota-item-error">{error}</p>}
        <div className="dota-shop-inventory"><h4>ИНВЕНТАРЬ · {name}</h4>{slots(true)}
          {selectedSlot != null && inventory?.slots[selectedSlot]?.itemId === item.id && <button className="dota-item-sell" type="button" onClick={sell} disabled={!item.sellable}>Продать · {Math.floor(inventory.slots[selectedSlot]!.paid / 2)} G</button>}
        </div>
      </aside></div>
    </dialog>, document.body)}
  </>;
}
