# Retel Jet Tracking

## Milestones
- [x] Milestone 1: Fun flying in an empty world.
- [ ] Milestone 2: Weapons and targets (later).
- [ ] Milestone 3: Simple mission loop (later).

## Milestone 1 Notes (Done)
- Built a simple sky + ocean world.
- Added a placeholder jet with basic flight physics.
- Added chase/cockpit camera toggle and reset.
- Added a HUD for speed, altitude, and throttle.
- Tuned lift/drag and added a soft speed cap to prevent runaway climb.
- Added a small island and a mini map showing the jet from above.
- Matched the mini map island shape to the ground (square).
- Expanded the mini map to show the full ocean and kept the jet inside the map area.
- Added a pause toggle on P.
- Updated the mini map to draw the island where it actually sits in the world.
- Added multiple islands and showed them on the mini map.
- Made the center island bigger and added a runway with markings and a runway start position.
- The jet now starts with zero throttle and can only lift off after reaching takeoff speed.
- Required pitch-up input to lift off while on the runway.
- Added a brake toggle (B) that holds the jet in place on the runway and shows status on HUD.
- Added a cockpit HUD overlay with green symbology and tape-style readouts.
- Fixed cockpit HUD scaling to fit the screen.
- Moved the HUD into the cockpit view when in cockpit mode.

Kid-friendly: We made a tiny sky playground and a pretend jet you can fly around!
Kid-friendly update: We fixed the jet so it doesn’t zoom into space on its own.
Kid-friendly update: Now there’s a little island and a mini map so you can see where you are.
Kid-friendly update: The map island now matches the real island shape.
Kid-friendly update: The map now shows the whole ocean, and the jet stays inside it.
Kid-friendly update: You can press P to pause the game.
Kid-friendly update: The map now shows the island in the right spot.
Kid-friendly update: We added more islands to fly around.
Kid-friendly update: The middle island has a runway and you start at the end of it.
Kid-friendly update: You have to go fast enough before the jet can lift off.
Kid-friendly update: You must pull up to take off.
Kid-friendly update: Press B to use the brakes so the jet waits on the runway.
Kid-friendly update: The cockpit view now has a cool glowing HUD.
Kid-friendly update: The HUD now fits the screen better.
Kid-friendly update: The numbers move into the cockpit view when you switch cameras.

## How to Play (Kid-Friendly)
- W/S makes the engine stronger or weaker.
- Arrow keys tilt the jet (up/down = nose up/down, left/right = roll).
- A/D turns the jet left or right.
- Space switches camera views.
- R puts the jet back at the start.

## Quick Test Checklist
- [ ] Can take off (gain altitude).
- [ ] Can turn and lose some speed.
- [ ] Can stall if too slow.
- [ ] Reset works.
