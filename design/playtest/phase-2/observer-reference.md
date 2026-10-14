# Observer reference (read before a session, not during)

Everything here is for you only. Never tell testers any of it.

## Seats, buttons, pace

- **Seats.** The host (the room creator) is Red and the guest is Blue.
- **Host-only buttons:** Start game, Retry hole, Restart hole and Play again. Play again is pre-selected, so Space or Enter fires it, and Space is also the shoot key.
- **Either player** can press Tee off or Next hole, or tap the intro card's background. The first press moves both players on.
- **Modes.** A first-time visitor lands on SOLO; ONLINE is the third button. If they play SOLO or LOCAL 2P, log it and don't redirect them.
- **Ending a hole.** A hole ends only when both balls are in, and there's no stroke limit. Pace is about 2–2.5 min per hole. Course par is 28 (6 + 7 + 8 + 7).
- **Hints.** The hints on holes 2–4 (the intro card and the pause menu's "Stuck?") nearly give the answer away. For each hole, note whether they **read** the answer or **worked it out**.
- **Holder tip.** With PR #25 merged, the game shows "Stay on the DOOR plate for Blue — tap straight up at low power" (or "plate A") at most once per hole, and only while the partner still needs that plate. Note whether they read it and follow it.
- **Controls hand.** The on-screen hand shows once per browser, on hole 1 only. Use a private window to see what a newcomer sees.

## The four holes

| Hole | Par (no medal above) | Goes first | New mechanic | Confused | Got it |
|---|---|---|---|---|---|
| 1 First Fairway | 6 (8) | Red | SAND | Full power every shot; "SAND…" twice or more; "is it broken?" | Eases off the power, or pitches over the bunker on purpose |
| 2 Two Doors | 7 (9) | Red, who holds | PRESSURE SWITCH | Blue keeps lobbing the wall (no shot clears it); Red leaves the DOOR plate early, then "why did it close?" | Roles said out loud ("you stay on that, I'll go through"); Blue stops on the WINDOW plate and Red lobs through the window |
| 3 Colour Keys | 8 (10) | **Blue (guest)** | COLOUR GATE | Red lobs at wall 1 and gets "LOCKED!" twice or more | "Only blue goes through blue" / "you open mine, I open yours" |
| 4 Plate & Bridge | 7 (9) | Red, who holds | BRIDGE | Tries to jump the chasm (impossible) and gets "OUT! +1" more than once; surprised by "BRIDGE GONE" | "Stay on A, I'll cross", then "I'm holding it, come over" |

On hole 4, chipping past plate A into the chasm once or twice is aim, not confusion.

## Known issues: tag them in `bugs_tech`, don't read them as design problems

- **`cold-start`**
  - The title shows "ONLINE SERVER: WAKING…". If waking takes more than 5 s, it switches to "OFFLINE" and never checks again.
  - The lobby shows "Waking up the server — this can take a few seconds."
  - After 8 s it shows "COULDN'T CONNECT". Retry usually works.
- **`room-closed`**
  - A room closes after about 10 min with no input from either player. Aiming counts as input; keepalive pings and a guest joining don't.
  - It also closes 15 min after it was created if nobody pressed Start.
  - In the lobby this shows "THE ROOM CLOSED · The room closed before the game started." If you merged that day, tag it `deploy` instead.
- **`deploy`**
  - A merge that touches server or game code redeploys the server, which closes every open room. Players see "THE ROOM CLOSED · The server closed this room."
  - After a protocol change, tabs that were already open show "Your game is out of date — reload the page to update."
- **`room-full`:** "COULDN'T JOIN · Room X already has two players."
  - Usual causes: the host opened their own invite link in another tab, or someone opened the link after Start, or in a new tab after dropping out.
  - **But** if the person who got this message was sent the link by a tester and isn't the session partner, that's a share. Log it as `FUTURE?` (did) as well. The pause menu's "Copy invite link" always points to the current room, which is full.
- **Rejoin hint:** "They can rejoin with room code X" is misleading. Only reloading the **same tab** within 60 s rejoins.
- **`holder-toast`** (holes 2–4, only if PR #25 is not merged)
  - The old tip "You're holding the … for … — tap straight up at low power to stay on the plate." can appear after the partner is already through. On hole 4 it reads "holding the A".
  - A stall tap right after this toast is the build's fault, not TURN or COOP.
- **`gamepad-cards`:** a gamepad can't press Tee off, Next hole or menu buttons, even though the card says "or press Ⓐ". This comes from reading the code; it hasn't been tested on a real pad.
- **`layout`**
  - The power bar and hint pill cover some ground, some switch wires and the lower part of the hole 4 chasm.
  - The power bar and the AIMING label stay up while the ball is flying.
  - The control hints can't be turned off.
  - On a portrait phone, the server pill overlaps the logo, and once in a game you get "Turn your phone sideways".
- **`no-sound-ios`:** sound starts only after the first tap ("Tap for sound"). On an iPhone, the ringer switch mutes it.
- **Pausing online doesn't stop the game.** The pause menu says "The game keeps running for Blue." If the partner shoots during a pause, that isn't a turn problem.
