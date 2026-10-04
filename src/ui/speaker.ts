// OWNER: ui
/**
 * The speaker button acts on the state the player SAW (AUDIO.md §5), never on `audio.ready` at click
 * time: the capture-phase gesture listener has already unlocked the context by the time React's click
 * handler runs, so branching on `ready` would mute the game on the very tap labelled "Tap for sound".
 */
import type { AudioSystem } from '../view/audio';

export type SpeakerAudio = Pick<AudioSystem, 'unlock' | 'isMuted' | 'setMuted'>;

/**
 * `lockedShown` is the rendered locked state. Locked + "Tap for sound" => unlock only. Locked while a
 * persisted mute shows "Unmute" => unlock AND unmute (that is what the label promised). Otherwise toggle.
 */
export function tapSpeaker(audio: SpeakerAudio, lockedShown: boolean): void {
  if (lockedShown) {
    audio.unlock();
    if (audio.isMuted()) audio.setMuted(false);
    return;
  }
  audio.setMuted(!audio.isMuted());
}
