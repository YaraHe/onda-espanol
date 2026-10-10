/**
 * Playback phase describes work in progress; it is not the user's intent.
 * Audio requests may be replaced repeatedly while the phase remains loading.
 * @param {boolean} shouldPlay
 * @param {"play" | "pause" | "replace"} action
 */
export function transitionPlaybackIntent(shouldPlay, action) {
  if (action === "play") return true;
  if (action === "pause") return false;
  return shouldPlay;
}
