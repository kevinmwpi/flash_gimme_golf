# Recruiting messages

Every message here is ready to copy. Fill in anything in [BRACKETS].

**Rules for every message**
- **The one line.** All a tester ever hears about how to play is "Play ~10 minutes with a friend online." Don't mention controls, holes, modes, devices or tips, and don't call it a puzzle game.
- **The link.** Send the plain `https://flash-golf.vercel.app`, and only in a private DM. Never send a `?room=` link, and never make a room for anyone.
- **The preview.** Remove the link preview wherever the app lets you. Its text ("Join my room and beat par together.") counts as an extra instruction.
  - Discord: wrap the link as `<…>`.
  - WhatsApp, Signal, Telegram: tap the X on the preview card.
  - Slack: use "Remove preview".
  - If an app gives you no way to remove it, write `preview shown` in that tester's `assisted` cell.
- **Don't raise the future.** Until 7 days after someone's session, never mention playing again, sharing, more levels or recommending it. If they bring it up themselves, log their exact words and score them later with tracker.md.
- **First-timers only.** Only recruit people who haven't played or seen the game, including as someone else's partner.
- **Watched or not.** People you want to watch get (c) instead of (a). Never send both.
- **IDs.** When someone says yes, give them a T id (T01, T02…). The friend they bring gets a `b` row with the same session (T01b).

**Numbers:** about 5 friends or friends-of-friends and about 5 strangers.
- DM 7–8 people and post in 2 places.
- Send (c) to 4 people so that 3 say yes. Try to make one of those a pair of strangers.
- Stop sending links once 10 have played.

## (a) Friend DM

> Hey [NAME]! I made a little golf game that runs in the browser and I'd love for you to try it.
> https://flash-golf.vercel.app
> Play ~10 minutes with a friend online. Let me know how it went whenever.

For a friend of a friend, use this first line instead: "Hi [NAME], [MUTUAL FRIEND] said you might be up for trying a game I'm making."

## (b) Stranger post (no link in the post)

**Where to post** (read the pinned rules first):
- **r/playtesters:** text post with the "Unpaid Playtest" flair.
- **A game-dev Discord** with a #playtest or #feedback channel. Post in that channel only.
- **Skip r/playmygame for now.** Its rules require the link in the post.

**Not yet:** r/WebGames, r/IndieGaming, Newgrounds and the itch.io boards are the Phase 4 launch channels.

**Etiquette**
- Post once per community and say you're the developer. Don't ask for upvotes.
- Play and comment on 1–2 other people's games there. Keep your own links to about 10% of your activity.
- If the channel requires an image, use the title screen only.
- Answer comments within a day, but only about logistics. If someone asks how to play or posts a tip, reply "DM me" and explain nothing in the thread.

**Title:** Looking for a few pairs to try my free browser golf game for two (~10 min, no install)

> Hi! I'm the solo developer of Flash Golf, a free golf game for two people that runs in the browser. There's no install and no account. It's a test build, and I'd love a few pairs to try it.
> - Want to try it? DM me and I'll send you the link.
> - Nobody to play with? Say so in your DM and I'll pair you with another tester.
> - Afterwards, please DM me rather than commenting, so the next people go in fresh. I'll send a short optional form (2 minutes, no sign-in).
> - If you'd be OK with me watching over a screenshare, say so before you play.

**Replying to a DM:** give them a T id, then send exactly the last two lines of (a). If you pair two strangers, introduce them in a group DM and send both of them the link and the one line.

## (c) Screenshare invite

> Hi [NAME]! Would you and a friend be up for playing a short game I made while I watch over a screenshare? Please keep about 30 minutes free. There's no set stopping point.
> - Pick a time: [SLOT 1], [SLOT 2], [SLOT 3], or suggest one.
> - You two get on your usual voice call ([Discord / Zoom / Meet]), and one of you shares your screen. I'll join muted with my camera off.
> - I won't help or explain anything while you play. That's on purpose. If something technical breaks, tell me.
> - Just talk to each other like you normally would.
> - You can stop at any time, no reason needed.
> - I'll take notes that only I will see. [I'd also like to record the screen and call audio, but only if you both agree. Only I would watch it, and I'll delete it by [DATE].]
>
> If that's OK, reply "yes, both of us" [and "record" or "no recording". Either is fine].

The link goes out only once the call has started. observer-checklist.md covers the rest.

## (d) Form follow-up (only testers you didn't watch)

1. Wait for their first message after playing. Copy it word for word into `first_message`, then reply with:

> Thanks for trying it! If you've got 2 minutes, here's a short form: [LINK ?tester=T01]
> There's no sign-in, and every question is optional. Honest is more useful than nice, so "it got boring" or "we couldn't get in" are great answers too.
> [If your friend wants to answer too, this link is for them: [LINK ?tester=T01b]]

2. If you've heard nothing 48 hours after sending the link, send only "Did you get a chance to try it?" If there's still no reply, log it as a drop-off and stop there.

## (e) Thank-you

> Thank you, [NAME]. That's really helpful, and I appreciate you giving it your time. [I'll delete the recording by [DATE].]

Send it once their form comes in, or later the same day as a watched call. After that, don't message them about the game until their 7 days are up.

## If a tester asks you something

| They say | You say or do |
|---|---|
| "What do I do?" / "How does it work?" | "I'm staying quiet on purpose so I can see what makes sense without me. Try whatever seems right, and tell me afterwards how it went." |
| "Can I play solo / on one screen?" | "The ask is just: play ~10 minutes with a friend online." Then log what they actually do. |
| "Can you play with me?" | "I can't be your partner for this one, but I can pair you with another tester." |
| The page won't load, an error card shows, or COULDN'T CONNECT is still there after Retry | Help straight away and add a tech tag. This doesn't count as `assisted`. |
| "We can't get into the same game" | Ask "What happened when you tried?" and log their answer word for word, because it's a finding. If they still want help, give as little as you can and set `assisted` to `lobby help`. |
| "Is there more?" | "That's everything there is." Promise nothing. |
