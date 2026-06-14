/**
 * Client settings. All per-client (GM machine) and hidden from the config menu
 * except the auto-open toggle — the panel's position and minimized/visible state
 * are remembered transparently.
 */

import { MODULE_ID } from "./util.js";

export function registerSettings() {
  // The one user-facing knob.
  game.settings.register(MODULE_ID, "autoOpen", {
    name: "LEGCON.Settings.AutoOpen.Name",
    hint: "LEGCON.Settings.AutoOpen.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  // Remembered floating-panel position { left, top }.
  game.settings.register(MODULE_ID, "panelPosition", {
    scope: "client",
    config: false,
    type: Object,
    default: null
  });

  // Whether the panel is minimized.
  game.settings.register(MODULE_ID, "panelMinimized", {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  // Whether the GM has the panel showing (toggled by the scene control).
  game.settings.register(MODULE_ID, "panelVisible", {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
}

export const getSetting = key => game.settings.get(MODULE_ID, key);
export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);
