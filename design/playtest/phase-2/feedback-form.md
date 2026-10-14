# Feedback form (only for testers you didn't watch)

**When to send it**
- Only after they've played, using the message in recruit.md (d). Never send it with the URL.
- Watched testers don't get the form. The debrief asks them the same questions, and asking twice shapes the second set of answers.

**Setup** (every question is optional, because the message promises that)
- **Tally** (easiest)
  - No sign-in is needed by default.
  - Add a hidden field called `tester`, then send `…?tester=T01`.
  - Put a page break before Q5.
- **Google Forms**
  - Settings → Responses: turn off "Collect email addresses" and "Limit to 1 response". The second one forces a Google sign-in.
  - Presentation: turn off "Show link to submit another response".
  - Put a short-answer field at the top: "Tester code (already filled in, leave as is)". Then use ⋮ → Get pre-filled link.
  - Start a new section before Q5.
- **Partners** get their own code, such as `T01b`. Log their answers, but they never count.

**Title:** Flash Golf: 2-minute feedback
**Description:** Thanks for playing! This takes about 2 minutes. There are no right or wrong answers, and short answers are great.

## Page 1 (only these answers can count)

1. **In a sentence or two, how would you describe what you just played?** *(paragraph)*
   Why: shows whether "we worked it out together" came across without anyone saying it. Note whether they mention their partner.
2. **Was there any moment where you weren't sure what to do or what was happening? What happened?** *(paragraph)*
   Why: finds confusion without suggesting there was any. Tag each answer TUT, COOP, TURN, or tech.
3. **Which moment from the game sticks with you most?** *(paragraph)*
   Why: shows which hole's idea landed, without steering them toward praise right before Q4.
4. **Anything else you want to tell me?** *(paragraph)*
   Why: the main place for unprompted interest. The question doesn't raise the topic, so what they write here can count.

## Page 2 (facts, never counted)

5. **What's the last hole you finished?** *(multiple choice)*
   - None, we didn't get into a game → `holes_finished` 0
   - None, we started but didn't finish one → 0
   - Hole 1 / Hole 2 / Hole 3 → 1 / 2 / 3
   - Hole 4 (we saw the final scorecard) → 4
   - Not sure → ?

   Why: the game records nothing, so this is your only drop-off data. People can go Back to page 1, so page 2 avoids wording that could feed a page-1 answer, such as "World 1" or hole names.
6. **How did you play?** *(multiple choice → `mode`)*
   - Online, each of us on our own device
   - Both of us on one device
   - On my own
   - Tried online but couldn't get into the same game
   - Other
7. **OK if I message you once more later with one short question? If yes, leave the best way to reach you.** *(short answer)* A blank answer means no.

**Confirmation message** (replace the default): "Got it, thank you. This really helps." Don't add a link back to the game, "share it" or "more coming".

## Left out on purpose

- **No "Would you play again?" or "Would you recommend it?"**
  - Asking people what they intend to do changes what they do next.
  - Answers to a direct question are prompted, so they could never count.
- **No rating scales.** With 10 testers they're noise.
- If you add one of these anyway, give it its own last page, tag every answer "asked", and never count it.

## Q7 contact and scoring

- **The follow-up message is optional.** Send at most one, on day 8 or later, after their window has closed: "Have you opened it again or shown anyone since? Totally fine if not."
  - Put the answers in `late_notes`. They never count, because your question raised the topic.
- **Keep the contact details private.** Never add anyone to a mailing list, a Discord server or a launch post. Keep contact details out of any copy of the tracker you share, and delete them when Phase 2 closes.
- **Scoring:** score Q1–Q4 with tracker.md "Does it count?", with `evidence_from` = `form-open-answer`. Page 2 answers never count.
