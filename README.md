# Legendary & Lair Action Conductor

A GM-only floating panel for [Foundry VTT](https://foundryvtt.com/) (dnd5e) that surfaces and resolves legendary creatures' off-turn economy — **legendary actions** at the end of other creatures' turns, and **lair actions** on initiative 20 — without ever interrupting play.

## What it does

- **Floating panel** — draggable, minimizable, GM-only. Remembers its position and minimized/visible state per client.
- **Reads live from features** — the panel is rebuilt on every render from each creature's items/activities (`activation.type` of `legendary` or `lair`) and its `legact` pool. It never keeps a parallel database, so it can't drift from the sheet.
- **Leans on the system** — clicking an action calls the activity's native `use()`, so dnd5e handles consumption and the chat card. This module is a *view + trigger*, not an economy engine.
- **Lair phase in the tracker** — when a creature actually has lair actions, a synthetic, tokenless combatant marks the lair initiative count (it acts *first* on that count, shown as `20`). It is torn down when combat ends, and orphans are swept at startup.
- **Lair rules** — one lair action per round, and the same effect can't be used two rounds running; ineligible actions are greyed out.

## Install

Paste this manifest URL into Foundry's **Install Module** screen:

```
https://github.com/gginns/legendary-conductor/releases/latest/download/module.json
```

After updates, hard-refresh with **Ctrl+F5**.

## Requirements

- Foundry VTT v13+ (verified on v14)
- dnd5e system v4.0+ (verified on v5.3.2)

## Notes

- 2024 statblocks fold lair actions into bonus legendary actions, so the synthetic lair combatant only appears for creatures that still have explicit lair actions (`system.resources.lair.value`).
- Everything here is GM-only — players never render the panel and never mutate combat.

## License

MIT
