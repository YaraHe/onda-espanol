/**
 * Keep a focus playback request's intent when replacing or regenerating its audio.
 * Preserve active playback through loading, playing, and inter-sentence gap
 * transitions. Explicitly paused and idle/error states must not start audio.
 * @param {string} phase
 */
export function shouldAutoplayFocusRequest(phase) {
  return phase === "loading" || phase === "playing" || phase === "gap";
}
