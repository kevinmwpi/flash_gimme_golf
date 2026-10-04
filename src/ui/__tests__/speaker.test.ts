// OWNER: ui
// AUDIO.md §5: the speaker button acts on the state the player saw, not on audio.ready at click time.
import { describe, expect, it } from 'vitest';
import { tapSpeaker, type SpeakerAudio } from '../speaker';

function fakeAudio(muted: boolean): SpeakerAudio & { unlocks: number; muted: boolean } {
  return {
    unlocks: 0,
    muted,
    unlock() {
      this.unlocks += 1;
    },
    isMuted() {
      return this.muted;
    },
    setMuted(b: boolean) {
      this.muted = b;
    },
  };
}

describe('tapSpeaker', () => {
  it('a tap on "Tap for sound" unlocks and never mutes, even though the gesture listener already made the context ready', () => {
    const audio = fakeAudio(false);
    tapSpeaker(audio, true);
    expect(audio.unlocks).toBe(1);
    expect(audio.muted).toBe(false);
  });

  it('a tap on a persisted-muted speaker before unlock unlocks AND unmutes (the label read "Unmute")', () => {
    const audio = fakeAudio(true);
    tapSpeaker(audio, true);
    expect(audio.unlocks).toBe(1);
    expect(audio.muted).toBe(false);
  });

  it('once unlocked the tap toggles mute both ways', () => {
    const audio = fakeAudio(false);
    tapSpeaker(audio, false);
    expect(audio.muted).toBe(true);
    tapSpeaker(audio, false);
    expect(audio.muted).toBe(false);
    expect(audio.unlocks).toBe(0);
  });
});
