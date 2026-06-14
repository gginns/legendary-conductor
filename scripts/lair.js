/**
 * Lair tracker decorator.
 *
 * When a combat contains a creature that actually has lair actions, we inject a
 * synthetic, tokenless combatant into the tracker to mark the initiative-20 lair
 * phase. It has no actor and no token, so every access here is guarded.
 *
 * Ordering: per the GM's choice, the lair phase acts *first* among combatants on
 * the lair initiative count. Foundry sorts initiative descending, so we store a
 * value fractionally above the count (e.g. 20.5) to win the tie, then pin the
 * tracker's displayed number back to the integer count (20).
 *
 * Lifecycle: created/removed by the active GM as lair creatures come and go;
 * torn down on combat end; swept for orphans at startup.
 */

import { MODULE_ID, isActiveGM, log, warn } from "./util.js";
import { combatHasLair, lairInitiative } from "./detector.js";

const SYNTHETIC_FLAG = "syntheticLair";
const LAIR_ICON = "icons/environment/wilderness/cave-entrance.webp";

/** True if a combatant is our synthetic lair marker. */
export function isSyntheticLair(combatant) {
  return !!combatant?.getFlag?.(MODULE_ID, SYNTHETIC_FLAG);
}

/** The synthetic lair combatant in a combat, or null. */
export function findSyntheticLair(combat) {
  return combat?.combatants?.find(c => isSyntheticLair(c)) ?? null;
}

/**
 * Reconcile the synthetic combatant against the combat's lair state: create it
 * when lair content exists and it's missing, remove it when no lair content
 * remains, and keep its initiative pinned just above the lair count. Only the
 * active GM mutates the combat.
 */
export async function syncLairCombatant(combat) {
  if (!combat || !isActiveGM()) return;
  const existing = findSyntheticLair(combat);
  const wanted = combatHasLair(combat);

  if (!wanted) {
    if (existing) await removeLairCombatant(combat);
    return;
  }

  const initiative = lairInitiative(combat) + 0.5; // wins the tie at the count
  if (!existing) {
    await createLairCombatant(combat, initiative);
  } else if (existing.initiative !== initiative) {
    try {
      await existing.update({ initiative });
    } catch (e) {
      warn("Failed to update lair combatant initiative", e);
    }
  }
}

async function createLairCombatant(combat, initiative) {
  try {
    await combat.createEmbeddedDocuments("Combatant", [{
      // No tokenId / actorId: this is a phase marker, not a creature.
      name: game.i18n.localize("LEGCON.Lair.TrackerName"),
      img: LAIR_ICON,
      initiative,
      hidden: false,
      flags: { [MODULE_ID]: { [SYNTHETIC_FLAG]: true } }
    }]);
    log("Created synthetic lair combatant");
  } catch (e) {
    warn("Failed to create synthetic lair combatant", e);
  }
}

/** Remove the synthetic combatant from a combat, if present. */
export async function removeLairCombatant(combat) {
  if (!combat || !isActiveGM()) return;
  const existing = findSyntheticLair(combat);
  if (!existing) return;
  try {
    await combat.deleteEmbeddedDocuments("Combatant", [existing.id]);
    log("Removed synthetic lair combatant");
  } catch (e) {
    warn("Failed to remove synthetic lair combatant", e);
  }
}

/**
 * Startup sweep: a crash or a module disable mid-combat can leave a synthetic
 * combatant behind. Remove any whose combat no longer has lair content.
 */
export async function sweepOrphanLairCombatants() {
  if (!isActiveGM()) return;
  for (const combat of game.combats ?? []) {
    const synthetic = findSyntheticLair(combat);
    if (synthetic && !combatHasLair(combat)) {
      try {
        await combat.deleteEmbeddedDocuments("Combatant", [synthetic.id]);
        log(`Swept orphan lair combatant from combat ${combat.id}`);
      } catch (e) {
        warn("Failed to sweep orphan lair combatant", e);
      }
    }
  }
}

/* -------------------------------------------- */
/*  Tracker rendering                           */
/* -------------------------------------------- */

/**
 * Decorate the synthetic combatant's row in the tracker: tag it as the lair
 * phase and pin its shown initiative to the integer lair count (we store a
 * fractional value to win the tie). Tolerant of both the v12 jQuery render
 * signature and the v13+ ApplicationV2 HTMLElement signature.
 */
export function decorateCombatTracker(app, htmlArg, _data) {
  try {
    const root = htmlArg instanceof HTMLElement
      ? htmlArg
      : htmlArg?.[0] ?? htmlArg?.element ?? null;
    if (!root?.querySelectorAll) return;

    const combat = game.combat;
    const synthetic = findSyntheticLair(combat);
    if (!synthetic) return;

    const row = root.querySelector(`[data-combatant-id="${synthetic.id}"]`);
    if (!row) return;

    row.classList.add("legcon-lair-row");

    // Pin the displayed initiative to the integer count.
    const initEl = row.querySelector(".token-initiative, .initiative");
    if (initEl) initEl.textContent = String(Math.floor(synthetic.initiative ?? 20));
  } catch (e) {
    warn("Failed to decorate combat tracker", e);
  }
}
