/**
 * Legendary & Lair Action Conductor — entry point & hook wiring.
 *
 * Strategy: stay passive. We never block a turn or interrupt the GM. We listen
 * for combat changes, keep the synthetic lair combatant reconciled, advance the
 * lair round bookkeeping, and re-render the (GM-only) panel. All resolution is
 * driven by GM clicks in the panel; the dnd5e system owns the economy.
 */

import { MODULE_ID, isGM, isActiveGM, loadTemplatesCompat, log } from "./util.js";
import { registerSettings, getSetting } from "./settings.js";
import { ConductorPanel } from "./panel.js";
import {
  syncLairCombatant, removeLairCombatant, sweepOrphanLairCombatants, decorateCombatTracker
} from "./lair.js";
import { combatHasConductedContent } from "./detector.js";
import { rollLairRound } from "./lair-state.js";

Hooks.once("init", () => {
  registerSettings();
  loadTemplatesCompat([`modules/${MODULE_ID}/templates/panel.hbs`]);
  log("Initialized");
});

Hooks.once("ready", async () => {
  if (!isGM()) return; // players never run any of this
  await sweepOrphanLairCombatants();
  if (game.combat) {
    await syncLairCombatant(game.combat);
    // Restore a panel the GM had open, or auto-open for an in-progress fight.
    if (getSetting("panelVisible") || shouldAutoOpen(game.combat)) {
      await ConductorPanel.show();
    }
  }
});

/* -------------------------------------------- */
/*  Scene control toggle                        */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", controls => {
  if (!isGM()) return;
  const tool = {
    name: "legendary-conductor",
    title: "LEGCON.Control.Toggle",
    icon: "fa-solid fa-dragon",
    button: true,
    visible: true,
    toggle: false,
    onClick: () => ConductorPanel.toggle(),
    onChange: () => ConductorPanel.toggle() // v13 calls onChange for buttons
  };
  addToolToTokenControls(controls, tool);
});

/**
 * Insert a tool into the token control group, tolerating both the v12 array
 * shape (`[{ name, tools: [] }]`) and the v13 record shape
 * (`{ tokens: { tools: {} } }`).
 */
function addToolToTokenControls(controls, tool) {
  try {
    // v13+: controls is a record keyed by group name.
    if (!Array.isArray(controls) && typeof controls === "object") {
      const group = controls.tokens ?? controls.token ?? Object.values(controls)[0];
      if (group?.tools) {
        group.tools[tool.name] = { ...tool, order: Object.keys(group.tools).length };
        return;
      }
    }
    // v12: controls is an array of groups, each with a tools array.
    if (Array.isArray(controls)) {
      const group = controls.find(c => c.name === "token" || c.name === "tokens") ?? controls[0];
      group?.tools?.push(tool);
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | Failed to register scene control`, e);
  }
}

/* -------------------------------------------- */
/*  Combat lifecycle                            */
/* -------------------------------------------- */

function shouldAutoOpen(combat) {
  return getSetting("autoOpen") && combatHasConductedContent(combat);
}

// A fight begins.
Hooks.on("combatStart", async combat => {
  if (!isGM()) return;
  await syncLairCombatant(combat);
  if (shouldAutoOpen(combat)) await ConductorPanel.show();
  ConductorPanel.refresh();
});

// A new round starts: the round that just ended becomes "last round" for the
// lair no-repeat rule. `combat.round` is already the new round here.
Hooks.on("combatRound", async (combat) => {
  if (isActiveGM()) await rollLairRound(combat, Math.max(0, (combat.round ?? 1) - 1));
  ConductorPanel.refresh();
});

Hooks.on("combatTurn", () => ConductorPanel.refresh());
Hooks.on("updateCombat", () => ConductorPanel.refresh());

// Combatants come and go: keep the synthetic lair combatant and panel in sync.
Hooks.on("createCombatant", async (combatant) => {
  if (!isGM()) return;
  await syncLairCombatant(combatant.parent ?? combatant.combat);
  ConductorPanel.refresh();
});

Hooks.on("deleteCombatant", async (combatant) => {
  if (!isGM()) return;
  await syncLairCombatant(combatant.parent ?? combatant.combat);
  ConductorPanel.refresh();
});

// Actor item / resource edits (e.g. spending happens via the system).
Hooks.on("updateActor", () => ConductorPanel.refresh());
Hooks.on("updateItem", () => ConductorPanel.refresh());

// Fight ends: tear down the synthetic combatant and close the panel.
Hooks.on("deleteCombat", async (combat) => {
  if (!isGM()) return;
  await removeLairCombatant(combat);
  // Don't forget the GM's intent to see it — just hide the window.
  await ConductorPanel.hide({ remember: false });
});
