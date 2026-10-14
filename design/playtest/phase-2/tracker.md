# Flash Golf: Phase 2 results tracker

Import `tracker.csv` into a spreadsheet and use one row per person.

**The gate (CLAUDE.md §5):** "3+ playtesters express *unprompted* interest in playing again or sending a room code to someone remote."

**Before the first tester:** fill in the dates in the decision box. Once any row has data in it, don't change any rule on this page.

## Columns

- **id:** T01, T02… for each person you recruit. A replacement for a no-show gets the next number (T11…). A partner a tester brings gets a `b` row, such as T01b. `b` rows are logged but never counted.
- **who / seen:** who is friend, friend-of-friend or stranger. seen is watched or written.
- **session:** S1, S2… Both players in the same game share one.
- **partner:** the partner's id, or "own friend".
- **mode:** ONLINE / LOCAL 2P / SOLO / didn't get in.
- **holes_finished:** 0–4. If they didn't start at Hole 1 (the host can choose a start hole), add where they started, e.g. `2 (from H3)`.
- **minutes:** for watched sessions, from opening the link until they stopped. Otherwise `?` (the form doesn't ask).
- **first_message:** their first message after playing, copied word for word, whether or not it counts.
- **unprompted:** yes or no, using the rubric below. **evidence:** their exact words, or what they did.
- **evidence_from:** to-partner / to-you-unasked / first-message / nudge-reply / form-open-answer / debrief-open-answer / action.
- **play_again_click:** y / n / – (only the host has the button). Logged, never counted.
- **laughs:** how many, plus the best moment.
- **confusion:** up to 3, worst first, e.g. "H2: Blue lobbed at the wall 4×". **axes:** every axis seen (TUT / COOP / TURN).
- **assisted:** leave blank if they got only the one line. Otherwise, what else they got: `lobby help mm:ss`, `preview shown`, `partner had played`.
- **bugs_tech:** cold-start, room-closed, deploy, room-full, holder-toast (only if PR #25 isn't merged), gamepad-cards, no-sound-ios, layout, aim, plus anything new. These are never axes.
- **delete_recording_by:** the date you promised to delete the recording.
- **late_notes:** answers to direct questions, and anything after the window closed. Never counted.

## Does it count? (the only rubric)

Mark **yes** only if all four are true:
1. **It's about playing more or bringing someone new in.** That can be a wish, a plan, or something they already did: played again, sent the link or a room code to someone new, or someone new turned up with a link from them.
2. **You didn't raise it.** Before they said or did it, nothing from you mentioned playing again, sharing, other people, more holes or the future. That covers the call, your messages and the form.
   - Open questions that name none of those are fine: "Let me know how it went", "Did you get a chance to try it?", "Anything else you want to tell me?"
   - The day-8 question is not fine.
   - If their partner raised it first, it still counts, as long as this person adds their own specific words or action.
3. **It's specific.** A plan in their own words ("let's…", "I'm going to…", "can I send this to…?"), a request for more holes, or an action.
4. **It's inside the window,** which runs from when you sent the link until 7 days after they played.

One yes per person. If it's borderline, it's a no. Score debrief answers the same way as form answers.

**Counts**
- "Same time tomorrow? I want gold on Two Doors." (said to the partner)
- "We played it again last night." (unasked)
- "I'm sending this to my brother", or the brother turns up with their link.
- They send a code or invite link to someone who isn't in this game. That includes the pause menu's "Copy invite link", even though the recipient gets "already has two players".
- They go back to ONLINE → Create a room for someone new, or they ask you how to.
- At the final scorecard someone suggests going again in their own words ("one more round?"), and they actually play the second round.
- "Is there a World 2? We want to keep going."

**Doesn't count**
- Praise ("fun!", "gg"), and vague closers like "we should play again sometime", "I'd play more of this", or "my brother would love this" with no plan to send it.
- A bare "is there more?", "is there a World 2?" or "is that it?". The WORLD 1 COMPLETE screen invites these. They count only if the same person also says they want more, or asks when more is coming.
- Answers to "would you play again / share it?" (these go in late_notes).
- The code sent to the partner they started with.
- A Play again click on its own (it's pre-selected, and Space is also the shoot key), or Retry hole.
- "I'd play this if it had…"
- A bare "yeah" to the partner's plan.
- To "Did you get a chance to try it?", a plain "yes". Only what goes beyond answering the question can count.
- Anything in a `b` row, anything after the window, and any session where you were the partner (that whole session is void).

## Decision

- **Cleared:** at least 3 different T rows say yes, **and** at least 3 watched sessions are done with `assisted` blank, **and** at least one stranger has played. Keep going until all 10 have played, because those notes feed Phase 3.
- **Failed:** all 10 have played (or the one extension has ended), the last tester's 7-day window has closed, and fewer than 3 say yes.
- **No-shows:** someone who said yes, got the nudge and never played keeps their row (`holes_finished` 0, `unprompted` no) but no longer counts as one of the 10. Replace no-shows once, give the replacements up to one more week, then decide. Extend only once.
- **Stop sending links** once 10 have played. If someone who already had the link plays later, they get a T row and count. Never recruit extra people to chase a third yes.
- **Strength.** Friends and strangers count the same toward the gate.
  - **Strong:** at least one yes from a stranger, at least one yes is an action, and the yeses come from 2 or more sessions.
  - **Weak:** every yes is from friends, every yes is only words, or every yes is from one session. Recruiting 2–3 more strangers before committing 8–12 weeks to Phase 3 is cheap insurance. That's your call.

```
Sessions window: ______ to ______ (2–3 weeks)   Extension: no / yes, to ______
Decide on: ______ (last session + 7 days)
Played: __ /10   Watched, assisted blank: __ (need 3+)   Strangers played: __
Unprompted yes, distinct T rows: __ from __ sessions  →  CLEARED (3+) / FAILED
Strength: strong / weak / between   Yeses from ONLINE: __   from assisted rows: __
If failed, sessions per axis: TUT __  COOP __  TURN __   →  axis: ______
```

## If it fails: one axis

1. Count the **sessions** tagged with each axis, not the individual incidents. The axis with the most sessions wins.
2. If two axes tie, pick the one with more sessions where `holes_finished` is below 4. If they still tie, pick the one that showed up earliest in play.
3. Make the smallest change you can on that axis only. No new holes, no new mechanics, nothing from the §4 cut list.
4. Retest with **new** people, using the same line, the same rules and a fresh tracker. Don't merge while the round is running.
5. **No World 2/3 work until a retest clears.** When one does, first re-review `design/proposals/worlds-2-3/LEVELS.md`. Its status note at the top requires this review. If several iterations fail, CLAUDE.md says to consider sunsetting, "a mature outcome, not a failure."

## If it clears

- Start Phase 3: only what CLAUDE.md §5 lists, and the §4 cut list still applies.
- Before any World 2 build, hand every TURN tag, and every note about idle waiting or complaints about stall taps (but not `holder-toast` ones), to the decision 2 re-review in the worlds-2-3 proposal. That review decides; this tracker doesn't.
