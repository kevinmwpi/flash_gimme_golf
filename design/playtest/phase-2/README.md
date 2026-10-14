# Flash Golf: Phase 2 playtest kit

**What Phase 2 needs (CLAUDE.md §5):**
- Recruit 10 testers, a mix of friends and strangers.
- Send each one the URL and nothing more than: "Play ~10 minutes with a friend online."
- Watch 3 or more pairs over screenshare without explaining anything. Note confusion, laughter and drop-off.
- Get short written feedback from everyone else.

**The gate:** 3 or more testers show *unprompted* interest in playing again, or in sending a room code to someone remote.
- If it fails, change one axis (tutorial, co-op clarity or turn flow) and retest before writing any new levels.
- Nothing gets built for the test. It runs on the live build: https://flash-golf.vercel.app. Don't link the repo README; its status line is out of date.

## The files

| file | when to use it |
|---|---|
| `recruit.md` | Every message you send: friend DM, stranger post, screenshare invite, form follow-up, thank-you, and replies to tester questions. |
| `feedback-form.md` | Build the form once (Tally or Google Forms). Send it only to testers you didn't watch, and only after they've played. |
| `observer-checklist.md` | Keep it open during each watched session. |
| `observer-reference.md` | Read it before each watched session: seats, the 4 holes, known issues. Don't read it during the session. |
| `tracker.md` + `tracker.csv` | `tracker.md` holds the only scoring rule and the decision. Import the CSV into a spreadsheet and fill in a row after each tester. |

## Timeline (about 10–12 hours of your time over 3–4 weeks)

1. **Setup, day 0 (one evening, ~2 h)**
   - Smoke-test the live URL with two browsers (see observer-checklist.md).
   - Build the form and import tracker.csv. Fill in the window dates in the tracker.
   - Merge PR #25 (the holder tip fix) before your first session, never during one: a merge redeploys the server. If it isn't merged, tag the old tip `holder-toast` (observer-reference.md).
   - From now on, **don't merge to `main` while any session could be running.** A server redeploy closes every open room.
2. **Recruit, days 1–3 (~2 h)**
   - Send 7–8 friend DMs, post in 2 stranger channels and send 4 screenshare invites.
   - Give each person a T id when they say yes.
   - Try 1–2 other people's games in the channels you post in.
3. **Play, weeks 1–2**
   - Watched sessions: about 45 minutes each, including notes. Do 3–4 of them.
   - Unwatched testers: about 15 minutes each. Log their first message, send the form, log their answers.
   - If someone is silent 48 hours after getting the link, send one nudge.
4. **Top up, end of week 2:** replace no-shows once if needed. That adds at most one more week.
5. **Score, last session + 7 days (~1 h):** score every row with tracker.md "Does it count?" and fill in the decision box.
6. **Decide**
   - Cleared: start Phase 3.
   - Failed: pick one axis, make the smallest change you can, and retest with new people.

## Never, at any point

- Give tips or explain the game.
- Be anyone's partner. That voids the session.
- Ask "would you play again / recommend it?" or mention more levels.
- Post in the Phase 4 launch channels: r/WebGames, r/IndieGaming, Newgrounds, itch.io.

**The game records nothing.** There's no analytics and no room log, so every number comes from watching or from what testers tell you.

**World 2/3 stays parked** until this gate clears. CLAUDE.md, Phase 3: "Only if Phase 2 cleared."
