/**
 * Lair usage state.
 *
 * Lair-action rules the system does NOT enforce:
 *   - one lair action per round;
 *   - the same lair effect can't be used two rounds running.
 *
 * We track just enough to grey the right buttons: which lair activity was used
 * this round and which was used last round. State lives on the combat document's
 * flags (world scope) so it survives reloads and is consistent across clients;
 * only the active GM writes it.
 */

import { MODULE_ID, isActiveGM } from "./util.js";

const FLAG = "lairUsage";

/**
 * Read the lair-usage record for a combat:
 *   { thisRound: { round, uuid } | null, lastRound: { round, uuid } | null }
 */
export function lairUsageState(combat) {
  const raw = combat?.getFlag?.(MODULE_ID, FLAG) ?? {};
  return {
    thisRound: raw.thisRound ?? null,
    lastRound: raw.lastRound ?? null
  };
}

/**
 * Record that a lair activity was used this round. Rolls the prior "this round"
 * into "last round" only when it belongs to the immediately preceding round, so
 * the no-repeat rule compares against the correct round. No-ops for non-GMs.
 */
export async function recordLairUse(combat, activityUuid) {
  if (!combat || !isActiveGM()) return;
  const round = combat.round ?? 0;
  const state = lairUsageState(combat);

  let lastRound = state.lastRound;
  // If the current round already has a recorded use, keep its lastRound;
  // otherwise the existing thisRound (from a previous round) becomes lastRound.
  if (state.thisRound && state.thisRound.round !== round) {
    lastRound = state.thisRound;
  }

  await combat.setFlag(MODULE_ID, FLAG, {
    thisRound: { round, uuid: activityUuid },
    lastRound
  });
}

/**
 * Advance bookkeeping at a round boundary: the round that just ended becomes
 * "last round". Called from the combat-round hook. No-ops for non-GMs.
 */
export async function rollLairRound(combat, previousRound) {
  if (!combat || !isActiveGM()) return;
  const state = lairUsageState(combat);
  if (state.thisRound && state.thisRound.round === previousRound) {
    await combat.setFlag(MODULE_ID, FLAG, {
      thisRound: null,
      lastRound: state.thisRound
    });
  }
}
