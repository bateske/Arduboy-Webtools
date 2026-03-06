/**
 * Tab controller for panel switching.
 */

export class TabController {
  /**
   * @param {NodeListOf<HTMLElement>} tabs - The tab buttons.
   * @param {NodeListOf<HTMLElement>} panels - The panel elements.
   * @param {string} [activeClass='active'] - CSS class for the active state.
   * @param {string} [dataAttr='panel'] - The data attribute on tab buttons (e.g. 'panel' for data-panel).
   * @param {string|null} [storageKey=null] - localStorage key for persisting the active tab across page refreshes.
   */
  constructor(tabs, panels, activeClass = 'active', dataAttr = 'panel', storageKey = null) {
    this.tabs = tabs;
    this.panels = panels;
    this.activeClass = activeClass;
    this.dataAttr = dataAttr;
    this._storageKey = storageKey;
    this._currentTab = null;

    this.tabs.forEach((tab) => {
      tab.addEventListener('click', () => this.activate(tab.dataset[this.dataAttr]));
    });
  }

  /**
   * Activate a tab by name.
   * @param {string} name
   */
  activate(name) {
    this.tabs.forEach((t) => t.classList.toggle(this.activeClass, t.dataset[this.dataAttr] === name));
    this.panels.forEach((p) => p.classList.toggle(this.activeClass, p.id === `panel-${name}`));
    this._currentTab = name;
    if (this._storageKey) localStorage.setItem(this._storageKey, name);
    // Remove the pre-paint data-tab attribute set by the inline <head> script;
    // the .active class takes over from here.
    delete document.documentElement.dataset.tab;
  }

  /** @returns {string|null} The currently active tab name. */
  get current() {
    return this._currentTab;
  }
}
