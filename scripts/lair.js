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

/** All synthetic lair combatants in a combat (normally 0 or 1). */
export function findSyntheticLairs(combat) {
  return combat?.combatants?.filter(c => isSyntheticLair(c)) ?? [];
}

/** The (first) synthetic lair combatant in a combat, or null. */
export function findSyntheticLair(combat) {
  return findSyntheticLairs(combat)[0] ?? null;
}

/**
 * Per-combat re-entrancy lock. Combat creation fires a `createCombatant` hook
 * for every token at once; without this lock each handler would run, see "no
 * synthetic yet" (the first create hasn't committed), and create its own —
 * spawning duplicates. The synchronous `add` below runs before any `await`, so
 * later handlers in the same tick bail out and the first call reconciles the
 * final state.
 */
const syncing = new Set();

/**
 * Reconcile the synthetic combatant against the combat's lair state: ensure
 * exactly one exists when lair content is present (creating or de-duplicating as
 * needed), none when it isn't, with its initiative pinned just above the lair
 * count. Only the active GM mutates the combat.
 */
export async function syncLairCombatant(combat) {
  if (!combat || !isActiveGM()) return;
  if (syncing.has(combat.id)) return; // a sync is already in flight for this combat
  syncing.add(combat.id);
  try {
    const synthetics = findSyntheticLairs(combat);
    const wanted = combatHasLair(combat);

    if (!wanted) {
      if (synthetics.length) {
        await combat.deleteEmbeddedDocuments("Combatant", synthetics.map(c => c.id));
        log("Removed synthetic lair combatant(s)");
      }
      return;
    }

    const initiative = lairInitiative(combat) + 0.5; // wins the tie at the count

    if (synthetics.length === 0) {
      await createLairCombatant(combat, initiative);
      return;
    }

    // Keep one; delete any duplicates from a prior race.
    const [keep, ...extra] = synthetics;
    if (extra.length) {
      await combat.deleteEmbeddedDocuments("Combatant", extra.map(c => c.id));
      log(`Removed ${extra.length} duplicate lair combatant(s)`);
    }
    if (keep.initiative !== initiative) {
      try {
        await keep.update({ initiative });
      } catch (e) {
        warn("Failed to update lair combatant initiative", e);
      }
    }
  } finally {
    syncing.delete(combat.id);
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
 * Startup sweep: a crash, a module disable, or a pre-fix duplicate-spawning
 * version can leave synthetic combatants behind. Delegate to syncLairCombatant,
 * which removes them when there's no lair content and collapses duplicates to a
 * single combatant when there is.
 */
export async function sweepOrphanLairCombatants() {
  if (!isActiveGM()) return;
  for (const combat of game.combats ?? []) {
    if (findSyntheticLairs(combat).length) await syncLairCombatant(combat);
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

    // Decorate every synthetic row (normally one; tolerate stragglers before a
    // sync collapses them).
    for (const synthetic of findSyntheticLairs(game.combat)) {
      const row = root.querySelector(`[data-combatant-id="${synthetic.id}"]`);
      if (!row) continue;

      row.classList.add("legcon-lair-row");

      // Pin the displayed initiative to the integer count (we store e.g. 20.5
      // to win the tie). The initiative number lives in different elements
      // across versions, so set the most specific one we can find.
      const pinned = String(Math.floor(synthetic.initiative ?? 20));
      const initEl = row.querySelector(".token-initiative .initiative")
        ?? row.querySelector(".initiative")
        ?? row.querySelector(".token-initiative");
      if (initEl && initEl.textContent.trim() !== pinned) initEl.textContent = pinned;
    }
  } catch (e) {
    warn("Failed to decorate combat tracker", e);
  }
}
