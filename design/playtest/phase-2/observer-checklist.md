# Screenshare observer checklist (keep open during the session)

Use one copy per watched session. Read `observer-reference.md` beforehand, not during. Never be their partner, because that voids the session.

## Before

**Once, before the first session**
- [ ] Do a two-device smoke test on https://flash-golf.vercel.app: ONLINE → Create a room → open the invite link on a second device → Start game → one shot each.
  - Use your own room. Never open a tester's invite link, because it takes the Blue seat.
- [ ] Read tracker.md "Does it count?" once. It's the only scoring rule, and you apply it after the session, not live.

**Scheduling**
- [ ] Recruit them with recruit.md (c). Record only if both players said yes in writing.
- [ ] They do **not** have the URL yet.

**On the day**
- [ ] Don't merge to `main` today. A server redeploy closes every open room.
- [ ] About a minute before, open the title page to wake the server and wait for "ONLINE SERVER: OK".
  - If it says OFFLINE, reload once. A slow wake shows OFFLINE and never updates.
  - Then close the tab. Don't create a room.
- [ ] Mute your mic, turn your camera off, and have your notes and a clock ready.
- [ ] Read the opening line below, mute, then send **only the person you recruited** exactly this: `https://flash-golf.vercel.app` + "Play ~10 minutes with a friend online." Send nothing else.

> Thanks. I'll stay muted and just watch. I can't answer questions about the game while you play, so do whatever you'd do if I weren't here, including stopping whenever you like. If something technical breaks, tell me. [You both said yes to recording. Is that still OK?]

## During

**Say nothing until the debrief.** Silence between holes is data. Don't ask them to think aloud.

**If they ask you something**
1. Count to 10 in silence.
2. Then say one of these:
   - "What would you try if I weren't here?"
   - "What do you think it does?"
   - Their last words as a question: "The door…?"
3. Never say "yes", "almost", "good shot", "try the plate" or "pull back". Don't sigh, and don't laugh at misses. Log `ASK`.

**Exceptions**
- **Tech trouble** (can't connect, frozen screen, an error card): help at once and log `TECH`.
- **"We can't get into the same game":** first ask "What happened when you tried?" If you then help, log `HELPED`. That session no longer counts toward the 3 unassisted watched sessions.
- **Stuck and fed up** (more than 3 min on the same thing, and annoyed or talking about quitting): log `DROP` and ask "Keep going or stop here?" If they stop, end the session. Never hint about the game.

**Header:** `Session S__ · date · Red/host T__ (friend / friend-of-friend / stranger) · Blue/guest T__ · devices · screen shared by · recording Y/N · saw the URL before? Y/N`

**Log format.** Start the clock when they open the URL. Write what you see and their exact words, not your conclusions.
```
mm:ss | hole | code     | what you saw / exact words                                  | who
00:00 |  -   | START    | host opened URL, clicked ONLINE                             | Red
01:50 |  1   | CONF-TUT | pressed away from ball twice ("Drag back from YOUR ball"),  | Red
      |      |          | then dragged toward the hole, arc pointed backwards         |
03:05 |  1   | LAUGH    | both laughed at "GIMME! +1"                                  | both
```

| code | log it when |
|---|---|
| `CONF-TUT` / `CONF-COOP` / `CONF-TURN` | someone is confused (see the axis key) |
| `LAUGH` | there's laughter or a shared "oh!" |
| `STUCK` | they're on the same problem for 30 s or more (also note when it ends) |
| `DROP` | they quit or say they'd quit (note the time and the hole) |
| `FUTURE?` | anyone says or does anything about playing more or someone new playing. Write the exact words, whether it was said or done, and who it was to. Score it later. |
| `CLICK` | someone presses Play again or Retry hole (note who). A click never counts on its own. |
| `ASK` / `TECH` / `HELPED` | they asked you something / a tech problem or known issue / you helped |

**Axis key.** Tag only what you see or hear.
- **TUT** (what each person knows about the controls and how things work)
  - pulls the wrong way
  - fails the same shot 3 or more times on one mechanic
  - calls a mechanic a bug
  - opens the pause menu's "Stuck?" tip
  - asks "what do we do?" at the start of a hole
- **COOP** (the pair's plan)
  - one solves while the other just follows
  - no talk about roles at the doors, walls or bridge
  - one strands the other without knowing why
  - "which ball is mine?"
  - nobody notices the HOLDS / CUP HOLDS chips
  - blaming each other
- **TURN** (only what you can hear)
  - tries to shoot on the partner's turn ("Red's turn — your ball is the blue one")
  - "whose turn is it?"
  - the waiting player disengages out loud ("hurry up", "is it me yet?", "sorry, I was on my phone"), or misses the start of their own turn
  - "wait, I was reading" after the other closed a card
  - surprise that Blue starts hole 3
  - Silence alone is not a tag.
- **No axis:** connection, bugs, layout and aim precision. Log these as `TECH`.
- **The game's own holder tip** ("Stay on the … plate for … — tap straight up at low power") is the game teaching, not you. A stall tap right after it is the advice working: note it, but don't tag TURN or COOP.

## After

1. **Stay muted** until they've clearly finished. That means they leave the results screen, start another round, or speak to you.
   - Never unmute while the WORLD 1 COMPLETE screen is up. If they start a second round, keep watching.
   - Write down, word for word, what they say to each other and their first words to you.
2. **Debrief.** Unmute and keep it under 5 minutes. Ask in this order:
   1. "In a sentence or two, how would you describe what you just played?"
   2. "Was there any moment where you weren't sure what to do or what was happening?" If they say yes: "What happened there?"
   3. "Which moment from the game sticks with you most?"
   4. "Anything else you want to tell me?" Then wait silently for a count of 10.
3. **Never ask** about playing again, recommending it or sharing it, and never mention more levels.
   - If they ask "is there more?", log `FUTURE?` with their exact words and say: "That's everything there is."
4. **Close:** "Thanks, this really helps." Stop the recording. Don't send a form. Send recruit.md (e) later that day.
5. **Within 15 minutes**, fill in the tracker row for each player:
   - holes_finished, minutes, laughs
   - confusion and axes
   - every `FUTURE?`, scored with the rubric
   - Play-again clicks
   - assisted
   - bugs_tech
   - delete_recording_by
