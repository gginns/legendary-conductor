/**
 * Shared constants and version-compat helpers.
 *
 * Foundry v13+ moved several globals under the `foundry.*` namespace; the
 * helpers here prefer the namespaced form and fall back to the legacy global so
 * the module keeps working across v13/v14. Everything in this submodule is
 * GM-only — see {@link isActiveGM}.
 */

export const MODULE_ID = "legendary-conductor";

export function log(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

export function warn(...args) {
  console.warn(`${MODULE_ID} |`, ...args);
}

export function error(...args) {
  console.error(`${MODULE_ID} |`, ...args);
}

/* -------------------------------------------- */
/*  Namespace compat                            */
/* -------------------------------------------- */

export function renderTemplateCompat(path, data) {
  const fn = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  return fn(path, data);
}

export function loadTemplatesCompat(paths) {
  const fn = foundry.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  return fn(paths);
}

export function fromUuidSyncCompat(uuid) {
  const fn = foundry.utils?.fromUuidSync ?? globalThis.fromUuidSync;
  return fn(uuid);
}

/* -------------------------------------------- */
/*  Role guard                                  */
/* -------------------------------------------- */

/**
 * The conductor is a GM tool: the panel never renders for players and the
 * synthetic lair combatant is only ever created/destroyed by a GM. We further
 * narrow to the *active, primary* GM so that, in a multi-GM game, only one
 * client mutates the combat (creating the lair combatant, writing lair-usage
 * flags). Falls back to "any GM is me" when no primary can be determined.
 */
export function isActiveGM() {
  if (!game.user?.isGM) return false;
  const primary = game.users?.activeGM ?? null;
  if (primary) return primary === game.user;
  // No `activeGM` accessor (older core) — designate the lowest-id active GM.
  const activeGMs = game.users?.filter?.(u => u.isGM && u.active) ?? [];
  if (!activeGMs.length) return true;
  activeGMs.sort((a, b) => a.id.localeCompare(b.id));
  return activeGMs[0] === game.user;
}

/** True for any GM (used for read-only / panel-visibility decisions). */
export function isGM() {
  return !!game.user?.isGM;
}

/* -------------------------------------------- */
/*  dnd5e data-model access (defensive)         */
/* -------------------------------------------- */

/**
 * The activity collection on an item, normalized to an array across the shapes
 * dnd5e has shipped (a Collection in 4.x/5.x, occasionally a plain object).
 * Returns [] for items with no activities (e.g. pre-activity content).
 */
export function activitiesOf(item) {
  const raw = item?.system?.activities;
  if (!raw) return [];
  if (typeof raw.values === "function") return [...raw.values()];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") return Object.values(raw);
  return [];
}

/** The activation type of an activity ("legendary" | "lair" | "action" | ...). */
export function activationType(activity) {
  return activity?.activation?.type ?? null;
}

/**
 * The legendary-action point cost of an activity. dnd5e stores this on
 * `activation.value`; defaults to 1 when an author left it blank.
 */
export function legendaryCost(activity) {
  const v = Number(activity?.activation?.value);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * Normalize a `{ max, spent }` (dnd5e 5.x) or `{ value, max }` (4.x) resource to
 * `{ value, max, usesSpent }` where `value` is the amount remaining. `usesSpent`
 * tells writers which field to set back. Supports both so the module honors its
 * declared 4.0+ compatibility range.
 */
export function normalizePool(res) {
  const max = Number(res?.max) || 0;
  const usesSpent = Number.isFinite(Number(res?.spent));
  let value;
  if (usesSpent) value = max - Number(res.spent);            // 5.x: { max, spent }
  else if (Number.isFinite(Number(res?.value))) value = Number(res.value); // 4.x
  else value = max;
  return { value: Math.max(0, Math.min(value, max)), max: Math.max(0, max), usesSpent };
}

/** The legendary-action pool for an actor: `{ value, max, usesSpent }`. */
export function legendaryPool(actor) {
  return normalizePool(actor?.system?.resources?.legact);
}

/** The legendary-resistance pool for an actor: `{ value, max, usesSpent }`. */
export function legendaryResistance(actor) {
  return normalizePool(actor?.system?.resources?.legres);
}

/**
 * The update payload to set a `{max,spent}`/`{value,max}` resource to a given
 * remaining `value`, written to whichever field the actor's data uses.
 */
export function poolUpdate(path, normalized, value) {
  const v = Math.max(0, Math.min(value, normalized.max));
  return normalized.usesSpent
    ? { [`${path}.spent`]: normalized.max - v }
    : { [`${path}.value`]: v };
}

/**
 * Lair configuration for an actor: whether it has a lair and on what initiative
 * count its lair actions trigger. 2024 statblocks drop lair actions, so most
 * actors return `{ has: false }`.
 */
export function lairConfig(actor) {
  const lair = actor?.system?.resources?.lair ?? {};
  const has = !!lair.value;
  const initiative = Number.isFinite(Number(lair.initiative)) ? Number(lair.initiative) : 20;
  return { has, initiative, inside: !!lair.inside };
}
