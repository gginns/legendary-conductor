/**
 * Action resolver.
 *
 * Clicking an action resolves it through the system so dnd5e owns the economy
 * and the chat card. The one wrinkle: dnd5e's `use()` consumes resources *before*
 * it fires the attack roll, and it fires that roll without awaiting it — so a
 * GM who cancels the attack dialog has already paid for the action.
 *
 * To honor "spend only on a completed roll", attack activities are handled in
 * two steps: roll the attack first (awaited, so a cancel is observable), and only
 * then run the system's consumption — skipping the redundant card and re-roll.
 * Activities without a cancelable caster dialog (saves, utility, …) keep the
 * plain `use()` flow, since they don't have the problem.
 */

import { fromUuidSyncCompat, activationType, warn } from "./util.js";
import { recordLairUse } from "./lair-state.js";

let busy = false;

/**
 * Use a legendary or lair activity by uuid.
 *
 * @param {string} activityUuid
 * @param {object} [opts]
 * @param {Combat} [opts.combat] Combat to record lair usage against.
 * @param {Event}  [opts.event]  Originating click (passed to the roll dialog).
 * @returns {Promise<boolean>} whether the action actually fired (and was paid for).
 */
export async function resolveAction(activityUuid, { combat = game.combat, event = null } = {}) {
  if (busy) return false; // guard against double-clicks racing consumption
  busy = true;
  try {
    const activity = fromUuidSyncCompat(activityUuid);
    if (typeof activity?.use !== "function") {
      ui.notifications.warn(game.i18n.localize("LEGCON.Notifications.ActivityGone"));
      return false;
    }

    const isLair = activationType(activity) === "lair";
    const fired = activity.type === "attack" && typeof activity.rollAttack === "function"
      ? await useAttackDeferred(activity, event)
      : await useDirect(activity);

    if (fired && isLair) {
      try {
        await recordLairUse(combat, activityUuid);
      } catch (e) {
        warn("Failed to record lair usage", e);
      }
    }
    return fired;
  } finally {
    busy = false;
  }
}

/** Plain system use: consumes + posts the card. For non-attack activities. */
async function useDirect(activity) {
  try {
    const results = await activity.use();
    return !!results; // null when the usage dialog was cancelled (no consumption)
  } catch (e) {
    warn("activity.use() failed", e);
    ui.notifications.error(game.i18n.localize("LEGCON.Notifications.UseFailed"));
    return false;
  }
}

/**
 * Attack activities: roll first so a cancelled dialog spends nothing, then run
 * consumption through the system (no second card, no auto re-roll).
 */
async function useAttackDeferred(activity, event) {
  let rolls;
  try {
    rolls = await activity.rollAttack({ event: event ?? undefined }, {}, {});
  } catch (e) {
    warn("rollAttack failed", e);
    ui.notifications.error(game.i18n.localize("LEGCON.Notifications.UseFailed"));
    return false;
  }
  if (!rolls?.length) return false; // cancelled — nothing spent

  // The roll happened: now let the system consume resources. Suppress the
  // redundant usage card and the auto attack-roll we already performed.
  try {
    await activity.use(
      { consume: true, subsequentActions: false },
      { configure: false },
      { create: false }
    );
  } catch (e) {
    // The attack already resolved in chat; a consumption hiccup shouldn't crash.
    warn("Deferred consumption failed after attack roll", e);
  }
  return true;
}
