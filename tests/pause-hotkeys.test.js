import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/input/events.ts', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../src/core/game.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('events.ts', source, ts.ScriptTarget.Latest, true);

function findFunction(node, name) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node;
  let found;
  ts.forEachChild(node, (child) => {
    if (!found) found = findFunction(child, name);
  });
  return found;
}

const initInput = findFunction(ast, 'initInput');
assert.ok(initInput, 'initInput must exist');
const keydownMatch = initInput.getText(ast).match(/window\.addEventListener\('keydown', \(event\) => \{([\s\S]*?)\n  \}\);/);
assert.ok(keydownMatch, 'keydown handler must exist');
const keydownCode = ts.transpileModule(`(event) => {${keydownMatch[1]}\n}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function fixture({ multiplayer = false, paused = false } = {}) {
  const registry = new Map();
  const body = { children: [], append(child) { child.parent = body; this.children.push(child); if (child.id) registry.set(child.id, child); } };
  const calls = { setPaused: [], banner: [], abilities: [], hud: 0 };
  const context = vm.createContext({
    keys: {},
    camera: null,
    isCameraLocked: () => false,
    selBuilder: null,
    selSquads: [],
    paused,
    setPaused: (value) => { calls.setPaused.push(value); context.paused = value; },
    setPausedBanner: (visible) => { calls.banner.push(visible); },
    isShooterMode: () => false,
    HERO_ABILITY_KEYS: ['Digit3', 'Digit4', 'Digit5', 'Digit7'],
    chooseHeroAbility: index => { calls.abilities.push(index); return true; },
    document: {
      getElementById: (id) => registry.get(id) || null,
      createElement: () => ({ id: '', textContent: '', style: {}, parent: null,
        remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); registry.delete(this.id); } }),
      body,
    },
    window: { _multiplayerMode: multiplayer, addEventListener() {}, removeEventListener() {} },
    updateHUD: () => { calls.hud += 1; },
    event: null,
    __handler: null,
  });
  context.__handler = vm.runInContext(keydownCode, context);
  return {
    context,
    calls,
    key(partial) {
      context.event = { repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, ...partial };
      vm.runInContext('__handler(event)', context);
    },
  };
}

describe('pause hotkeys', () => {
  for (const key of ['§', '>']) {
    it(`toggles pause and the banner together on ${key}`, () => {
      const f = fixture();
      const event = { key, code: key === '§' ? 'Backquote' : 'Period', shiftKey: key === '>' };
      f.key(event);
      f.key(event);
      assert.deepEqual(f.calls.setPaused, [true, false]);
      assert.deepEqual(f.calls.banner, [true, false]);
      assert.equal(f.calls.hud, 2);
    });
  }

  it('uses 6 for pause and 7 for the fourth ability', () => {
    const f = fixture();
    f.key({ key: '6', code: 'Digit6' });
    f.key({ key: '6', code: 'Numpad6' });
    assert.deepEqual(f.calls.setPaused, [true, false]);
    assert.deepEqual(f.calls.abilities, []);
    f.key({ key: '7', code: 'Digit7' });
    assert.deepEqual(f.calls.abilities, [3]);
  });

  it('keeps both Shift keys available without toggling pause', () => {
    const f = fixture();
    f.key({ key: 'Shift', code: 'ShiftLeft' });
    f.key({ key: 'Shift', code: 'ShiftRight' });
    assert.deepEqual(f.calls.setPaused, []);
    assert.deepEqual(f.calls.banner, []);
  });

  it('ignores repeat, multiplayer, typing and modified shortcuts', () => {
    for (const event of [
      { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
      { target: { tagName: 'INPUT' } }, { target: { tagName: 'TEXTAREA' } },
      { target: { tagName: 'SELECT' } }, { target: { isContentEditable: true } },
    ]) {
      const f = fixture(); f.key({ key: '>', code: 'Period', ...event });
      assert.deepEqual(f.calls.setPaused, []);
      assert.deepEqual(f.calls.banner, []);
    }
    const mp = fixture({ multiplayer: true });
    mp.key({ key: '§', code: 'Backquote' });
    assert.deepEqual(mp.calls.setPaused, []);
    assert.deepEqual(mp.calls.banner, []);
  });

  it('shows and removes the real banner element', () => {
    const helper = findFunction(ast, 'setPausedBanner');
    assert.ok(ast.statements.includes(helper), 'banner helper must be in scope for initInput');
    const code = ts.transpileModule(helper.getText(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    const registry = new Map();
    const context = vm.createContext({
      document: {
        getElementById: (id) => registry.get(id) || null,
        createElement: () => ({ id: '', textContent: '', style: {}, parent: null,
          remove() { registry.delete(this.id); } }),
        body: { append(child) { if (child.id) registry.set(child.id, child); } },
      },
    });
    vm.runInContext(`${code}\nthis.show = setPausedBanner;`, context);
    vm.runInContext('show(true)', context);
    const banner = registry.get('game-paused-banner');
    assert.ok(banner, 'banner created');
    assert.ok(banner.textContent.includes('ПАУЗА'));
    assert.ok(banner.textContent.includes('§ / >'));
    assert.ok(banner.textContent.includes('6'));
    assert.ok(!banner.textContent.includes('Shift'));
    vm.runInContext('show(true)', context);
    assert.equal(registry.size, 1, 'no duplicate banners');
    vm.runInContext('show(false)', context);
    assert.equal(registry.size, 0, 'banner removed on resume');
  });

  it('gates the world tick on the pause flag', () => {
    assert.ok(/if\s*\(!gameOver\s*&&\s*!paused\s*&&\s*world\)/.test(gameSource), 'game loop must skip the sim while paused');
  });
});
