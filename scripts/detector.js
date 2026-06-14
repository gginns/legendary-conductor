/**
 * Detector & view model.
 *
 * Every render rebuilds the conductor's view from the live combat: each
 * combatant's actor is scanned for activities whose `activation.type` is
 * "legendary" or "lair", and the result is a plain, serializable object the
 * Handlebars template renders directly. Nothing is cached between renders, so
 * the panel can never drift from the sheet — edit a statblock mid-combat and
 * the next render reflects it.
 */

import {
  activationType, activitiesOf, lairConfig, legendaryCost, legendaryPool, warn
} from "./util.js";
import { lairUsageState } from "./lair-state.js";

const DEFAULT_TOKEN = "icons/svg/mystery-man.svg";

/** True if any combatant in the combat exposes a legendary or lair activity. */
export function combatHasConductedContent(combat) {
  if (!combat) return false;
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor) continue;
    if (actorHasActivationType(actor, "legendary")) return true;
    if (actorHasActivationType(actor, "lair") && lairConfig(actor).has) return true;
  }
  return false;
}

/** True if at least one lair creature exists — gate for the synthetic combatant. */
export function combatHasLair(combat) {
  if (!combat) return false;
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (actor && lairConfig(actor).has && actorHasActivationType(actor, "lair")) return true;
  }
  return false;
}

/** The initiative count lair actions fire on — max across lair creatures (default 20). */
export function lairInitiative(combat) {
  let init = 20;
  for (const combatant of combat?.combatants ?? []) {
    const actor = combatant.actor;
    if (actor && lairConfig(actor).has) init = Math.max(init, lairConfig(actor).initiative);
  }
  return init;
}

function actorHasActivationType(actor, type) {
  for (const item of actor.items ?? []) {
    for (const activity of activitiesOf(item)) {
      if (activationType(activity) === type) return true;
    }
  }
  return false;
}

/* -------------------------------------------- */
/*  View model                                  */
/* -------------------------------------------- */

/**
 * Build the full render context for the panel from a combat.
 *
 * @returns {{
 *   active: boolean,
 *   round: number,
 *   creatures: object[],
 *   lair: object|null,
 *   empty: boolean
 * }}
 */
export function buildViewModel(combat) {
  if (!combat?.started) {
    return { active: false, round: 0, creatures: [], lair: null, empty: true };
  }

  const creatures = [];
  const lairCreatures = [];

  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor) continue; // synthetic lair combatant & tokenless rows
    try {
      const card = buildCreatureCard(combatant, actor);
      if (card.actions.length) creatures.push(card);
      const lairCard = buildLairCreature(combatant, actor, combat);
      if (lairCard) lairCreatures.push(lairCard);
    } catch (e) {
      warn(`Failed to build view model for ${actor?.name ?? combatant?.id}`, e);
    }
  }

  const lair = lairCreatures.length
    ? { initiative: lairInitiative(combat), creatures: lairCreatures }
    : null;

  return {
    active: true,
    round: combat.round ?? 0,
    creatures,
    lair,
    empty: !creatures.length && !lair
  };
}

/** A legendary-action creature card: pool pips + affordable/greyed actions. */
function buildCreatureCard(combatant, actor) {
  const pool = legendaryPool(actor);
  const actions = collectActivities(actor, "legendary").map(({ item, activity }) => {
    const cost = legendaryCost(activity);
    return {
      uuid: activity.uuid,
      name: activity.name || item.name,
      img: activity.img || item.img || DEFAULT_TOKEN,
      cost,
      costLabel: `${cost}`,
      affordable: cost <= pool.value
    };
  });

  return {
    combatantId: combatant.id,
    actorUuid: actor.uuid,
    name: combatant.name ?? actor.name,
    img: combatant.img || actor.img || DEFAULT_TOKEN,
    isCurrentTurn: combatant.id === combatant.combat?.combatant?.id,
    pool: {
      value: pool.value,
      max: pool.max,
      // Pips: filled up to `value`, hollow up to `max`.
      pips: Array.from({ length: pool.max }, (_, i) => ({ filled: i < pool.value }))
    },
    actions
  };
}

/**
 * A lair creature's actions for the init-20 section, with the one-per-round /
 * no-repeat-two-rounds-running greying applied (rules tracked on combat flags).
 */
function buildLairCreature(combatant, actor, combat) {
  const cfg = lairConfig(actor);
  if (!cfg.has) return null;
  const found = collectActivities(actor, "lair");
  if (!found.length) return null;

  const state = lairUsageState(combat);
  const usedThisRound = state.thisRound?.round === combat.round;
  const lastRoundActionId = state.lastRound?.round === combat.round - 1
    ? state.lastRound?.uuid
    : null;

  const actions = found.map(({ item, activity }) => {
    const repeatBlocked = activity.uuid === lastRoundActionId;
    const usedNow = usedThisRound && state.thisRound?.uuid === activity.uuid;
    return {
      uuid: activity.uuid,
      name: activity.name || item.name,
      img: activity.img || item.img || DEFAULT_TOKEN,
      // Greyed when the round's lair action is spent, or when repeating it
      // would break the "not two rounds running" rule.
      disabled: usedThisRound || repeatBlocked,
      usedThisRound: usedNow,
      repeatBlocked
    };
  });

  return {
    combatantId: combatant.id,
    actorUuid: actor.uuid,
    name: combatant.name ?? actor.name,
    img: combatant.img || actor.img || DEFAULT_TOKEN,
    insideLair: cfg.inside,
    usedThisRound,
    actions
  };
}

/** All `{ item, activity }` pairs on an actor whose activation type matches. */
function collectActivities(actor, type) {
  const out = [];
  for (const item of actor.items ?? []) {
    for (const activity of activitiesOf(item)) {
      if (activationType(activity) === type) out.push({ item, activity });
    }
  }
  return out;
}
