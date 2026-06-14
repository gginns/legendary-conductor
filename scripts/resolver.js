/**
 * Action resolver.
 *
 * Clicking an action resolves it through the system: `activity.use()` runs the
 * native consumption (it decrements the legendary-action pool) and posts the
 * usual chat card. We do not re-implement the economy — we only fire the
 * activity and, for lair actions, record the round bookkeeping the system
 * doesn't track. The panel re-renders off the resulting document updates.
 */

import { fromUuidSyncCompat, warn, activationType } from "./util.js";
import { recordLairUse } from "./lair-state.js";

let busy = false;

/**
 * Use a legendary or lair activity by uuid.
 *
 * @param {string} activityUuid
 * @param {object} [opts]
 * @param {Combat} [opts.combat] Combat to record lair usage against.
 * @returns {Promise<boolean>} whether the activity fired.
 */
export async function resolveAction(activityUuid, { combat = game.combat } = {}) {
  if (busy) return false; // guard against double-clicks racing consumption
  busy = true;
  try {
    const activity = fromUuidSyncCompat(activityUuid);
    if (typeof activity?.use !== "function") {
      ui.notifications.warn(game.i18n.localize("LEGCON.Notifications.ActivityGone"));
      return false;
    }

    const isLair = activationType(activity) === "lair";

    // Let the system own consumption + chat. We don't suppress its dialog:
    // the GM may want to pick targets / spend extra. If consumption fails
    // (e.g. not enough legendary actions) the system notifies and returns null.
    let results;
    try {
      results = await activity.use();
    } catch (e) {
      warn("activity.use() failed", e);
      ui.notifications.error(game.i18n.localize("LEGCON.Notifications.UseFailed"));
      return false;
    }
    if (!results) return false; // cancelled or consumption refused

    if (isLair) {
      try {
        await recordLairUse(combat, activityUuid);
      } catch (e) {
        warn("Failed to record lair usage", e);
      }
    }
    return true;
  } finally {
    busy = false;
  }
}
