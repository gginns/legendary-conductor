/**
 * ConductorPanel — the floating, draggable, minimizable, GM-only panel.
 *
 * It is a pure view over {@link buildViewModel}: every render rebuilds from the
 * live combat, so it never drifts from the sheets. It mutates nothing on its
 * own — clicking an action delegates to the resolver, which fires the activity
 * through the system. Position / minimized / visible state persist to client
 * settings so it reopens where the GM left it.
 */

import { MODULE_ID, isGM, warn, fromUuidSyncCompat, normalizePool, poolUpdate } from "./util.js";
import { buildViewModel } from "./detector.js";
import { resolveAction } from "./resolver.js";
import { getSetting, setSetting } from "./settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ConductorPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {ConductorPanel|null} The single instance on this client. */
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: "legendary-conductor-panel",
    classes: ["legcon-panel"],
    tag: "div",
    window: {
      title: "LEGCON.Panel.Title",
      icon: "fa-solid fa-dragon",
      minimizable: true,
      resizable: false
    },
    position: { width: 320, height: "auto" },
    actions: {
      useAction: ConductorPanel.#onUseAction,
      adjustPool: ConductorPanel.#onAdjustPool
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/panel.hbs` }
  };

  /* -------------------------------------------- */
  /*  Singleton open/close                        */
  /* -------------------------------------------- */

  /** Show the panel (creating it if needed), restoring saved position. */
  static async show() {
    if (!isGM()) return null; // never for players
    if (!ConductorPanel.instance) {
      const options = {};
      const pos = getSetting("panelPosition");
      if (Number.isFinite(pos?.left) && Number.isFinite(pos?.top)) {
        options.position = { left: pos.left, top: pos.top };
      }
      ConductorPanel.instance = new ConductorPanel(options);
    }
    const panel = ConductorPanel.instance;
    if (!panel.rendered) await panel.render({ force: true });
    if (getSetting("panelMinimized")) panel.minimize();
    await setSetting("panelVisible", true);
    return panel;
  }

  /** Hide the panel without forgetting it should be visible next combat. */
  static async hide({ remember = true } = {}) {
    if (remember) await setSetting("panelVisible", false);
    const panel = ConductorPanel.instance;
    if (panel?.rendered) await panel.close({ [`${MODULE_ID}-keepVisible`]: !remember });
  }

  /** Toggle from the scene control. */
  static async toggle() {
    if (ConductorPanel.instance?.rendered) await ConductorPanel.hide();
    else await ConductorPanel.show();
  }

  /** Re-render if currently open (called on combat updates). */
  static refresh() {
    const panel = ConductorPanel.instance;
    if (panel?.rendered) panel.render();
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _prepareContext(_options) {
    let model;
    try {
      model = buildViewModel(game.combat);
    } catch (e) {
      warn("buildViewModel failed", e);
      model = { active: false, round: 0, creatures: [], lair: null, empty: true };
    }
    return model;
  }

  /* -------------------------------------------- */
  /*  Persistence of window state                 */
  /* -------------------------------------------- */

  _onPosition(position) {
    super._onPosition?.(position);
    const { left, top } = position ?? {};
    if (Number.isFinite(left) && Number.isFinite(top)) {
      // Debounced persistence to avoid a write per drag frame.
      clearTimeout(this.#posTimer);
      this.#posTimer = setTimeout(() => {
        setSetting("panelPosition", { left, top }).catch(() => {});
      }, 250);
    }
  }
  #posTimer = null;

  minimize() {
    const r = super.minimize();
    setSetting("panelMinimized", true).catch(() => {});
    return r;
  }

  maximize() {
    const r = super.maximize();
    setSetting("panelMinimized", false).catch(() => {});
    return r;
  }

  _onClose(options) {
    super._onClose?.(options);
    // Proven persistence path (matches Battlecard): read final position on close.
    try {
      const { left, top } = this.position ?? {};
      if (Number.isFinite(left) && Number.isFinite(top)) {
        setSetting("panelPosition", { left, top }).catch(() => {});
      }
    } catch (e) { /* settings not ready */ }
    if (ConductorPanel.instance === this) ConductorPanel.instance = null;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async #onUseAction(event, target) {
    const uuid = target?.dataset?.uuid;
    if (!uuid) return;
    if (target.classList.contains("disabled")) return;
    target.classList.add("disabled"); // optimistic; render rebuilds truth
    await resolveAction(uuid, { combat: game.combat, event });
    // The resulting document updates trigger a re-render via the combat hooks;
    // re-render now too in case nothing on the combat itself changed.
    ConductorPanel.refresh();
  }

  /**
   * Click a legendary-action or legendary-resistance pip to adjust the pool.
   * Clicking a filled pip spends down to just below it; clicking an empty pip
   * restores up to it — the familiar "set the level" pip behavior, matching the
   * dnd5e sheet. Writes to whichever resource field the actor's data uses.
   */
  static async #onAdjustPool(event, target) {
    const { pool, actorUuid, n } = target.dataset;
    const idx = Number(n);
    if (!pool || !Number.isInteger(idx)) return;
    const actor = fromUuidSyncCompat(actorUuid);
    const res = actor?.system?.resources?.[pool];
    if (!res) return;

    const norm = normalizePool(res);
    const filledNow = idx <= norm.value;
    const newValue = filledNow ? idx - 1 : idx; // toggle on the boundary
    try {
      await actor.update(poolUpdate(`system.resources.${pool}`, norm, newValue));
    } catch (e) {
      warn(`Failed to adjust ${pool}`, e);
    }
    ConductorPanel.refresh();
  }
}
