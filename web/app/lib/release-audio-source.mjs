/**
 * @param {HTMLAudioElement | null} audio
 * @param {string | null} objectUrl
 */
export function releaseAudioSource(audio, objectUrl) {
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}
