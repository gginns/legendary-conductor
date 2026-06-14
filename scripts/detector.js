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
  activationType, activitiesOf, lairConfig, legendaryCost, legendaryPool, legendaryResistance, warn
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
      if (card) creatures.push(card);
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

/**
 * Display label for an action. dnd5e activities default `activity.name` to the
 * activity-type label ("Attack", "Save", "Use"), so that alone reads nothing
 * like the statblock. The feature (item) name is what the sheet shows
 * ("Wing Attack", "Detect", "Tail"), so prefer it — and only append the
 * activity name to disambiguate when one feature exposes several matching
 * activities.
 */
function actionLabel(item, activity, siblingCount) {
  const itemName = item?.name ?? "?";
  if (siblingCount > 1 && activity?.name && activity.name !== itemName) {
    return `${itemName} — ${activity.name}`;
  }
  return itemName;
}

/** Count of matching activities per item id, for label disambiguation. */
function siblingCounts(found) {
  const counts = {};
  for (const { item } of found) counts[item.id] = (counts[item.id] ?? 0) + 1;
  return counts;
}

/** Pip array for a pool: 1-based index, filled up to `value`. */
function poolPips(pool) {
  return Array.from({ length: pool.max }, (_, i) => ({ n: i + 1, filled: i < pool.value }));
}

/**
 * A legendary-action creature card: legendary-action pips, legendary-resistance
 * pips, and affordable/greyed actions. Returns null when the creature has no
 * legendary content at all (no actions, no action pool, no resistances).
 */
function buildCreatureCard(combatant, actor) {
  const legact = legendaryPool(actor);
  const legres = legendaryResistance(actor);
  const found = collectActivities(actor, "legendary");
  const counts = siblingCounts(found);
  const actions = found.map(({ item, activity }) => {
    const cost = legendaryCost(activity);
    return {
      uuid: activity.uuid,
      name: actionLabel(item, activity, counts[item.id]),
      img: item.img || activity.img || DEFAULT_TOKEN,
      cost,
      costLabel: `${cost}`,
      affordable: cost <= legact.value
    };
  });

  if (!actions.length && legact.max === 0 && legres.max === 0) return null;

  return {
    combatantId: combatant.id,
    actorUuid: actor.uuid,
    name: combatant.name ?? actor.name,
    img: combatant.img || actor.img || DEFAULT_TOKEN,
    isCurrentTurn: combatant.id === (combatant.parent ?? combatant.combat)?.combatant?.id,
    legact: { value: legact.value, max: legact.max, pips: poolPips(legact) },
    legres: { value: legres.value, max: legres.max, pips: poolPips(legres) },
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
  const counts = siblingCounts(found);

  const actions = found.map(({ item, activity }) => {
    const repeatBlocked = activity.uuid === lastRoundActionId;
    const usedNow = usedThisRound && state.thisRound?.uuid === activity.uuid;
    return {
      uuid: activity.uuid,
      name: actionLabel(item, activity, counts[item.id]),
      img: item.img || activity.img || DEFAULT_TOKEN,
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
