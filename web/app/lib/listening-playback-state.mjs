/**
 * Playback phase describes work in progress; it is not the user's intent.
 * Audio requests may be replaced repeatedly or retried while the phase changes.
 * @param {boolean} shouldPlay
 * @param {"play" | "pause" | "replace" | "retry"} action
 */
export function transitionPlaybackIntent(shouldPlay, action) {
  if (action === "play") return true;
  if (action === "pause") return false;
  return shouldPlay;
}
