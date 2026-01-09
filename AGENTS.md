# Agent Notes for Retel

## Project Summary
Retel is a small Babylon.js flight playground built with Vite. The entrypoint is `src/main.js`, which starts the game loop in `src/game.js` and composes the jet (`src/jet.js`) and HUD (`src/ui.js`). Gameplay intent and progress live in `GAME_SPEC.md` and `TRACKING.md`, with player controls in `controls.md`.

## Key Paths
- `src/main.js`: app entry; imports styles and starts the game.
- `src/game.js`: scene setup, input handling, world building, main loop.
- `src/jet.js`: jet mesh + flight physics/controller.
- `src/ui.js`: HUD and cockpit UI.
- `src/styles.css`: global styles for HUD/canvas.
- `GAME_SPEC.md`: design goals and mechanics.
- `TRACKING.md`: milestone checklist and test notes.
- `controls.md`: user-facing control reference.

## Local Dev
- Install: `npm install`
- Run dev server: `npm run dev`
- Build: `npm run build`
- Preview build: `npm run preview`

## Conventions
- Keep gameplay logic in `src/game.js`, physics/tuning in `src/jet.js`, and UI in `src/ui.js`.
- Prefer small, named helper functions over large inlined blocks in `src/game.js`.
- When adjusting controls, update `controls.md` and any HUD labels that reference input.
- When adding milestones or changes in scope, update `TRACKING.md` and (if needed) `GAME_SPEC.md`.

## Testing & Validation
There is no automated test suite. Validate changes by running the dev server and checking:
- Takeoff, throttle, and stall behavior still feel reasonable.
- Camera toggle, reset, pause, and brakes still work.
- HUD values update correctly in both chase and cockpit views.
