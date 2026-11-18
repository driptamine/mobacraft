// Keep the standalone editor outside the game's dependency graph at startup.
if (/^\/balance\/?$/.test(location.pathname)) {
  document.title = 'Balance Editor · GrimCraft';
  document.body.replaceChildren();
  void import('./balance/editor.jsx').then(module => module.mountBalanceEditor());
} else {
  // The menu shell paints first; the HUD and the heavy game graph (models,
  // netcode, map layouts) stream in only after its DOM exists, so the HUD
  // can never beat the menu to the screen.
  void import('./ui/main-menu.js')
    .then((module) => module.injectMainMenu())
    .finally(() => {
      void Promise.all([import('./hud/index.jsx'), import('./core/game.js')]);
    });
}
