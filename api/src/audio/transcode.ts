import { spawn } from "node:child_process";
import { mkdtemp, readFile, rmdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Converts a browser recording to the mono, 16 kHz WAV required for assessment. */
export async function transcodeToAssessmentWav(audio: Buffer): Promise<Buffer> {
  if (audio.length === 0) throw new Error("Audio is empty");

  const workDir = await mkdtemp(join(tmpdir(), "spanish-audio-"));
  const output = join(workDir, "assessment.wav");

  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", output,
      ], { stdio: ["pipe", "ignore", "pipe"] });

      let errorOutput = "";
      ffmpeg.stderr.setEncoding("utf8");
      ffmpeg.stderr.on("data", (chunk: string) => {
        errorOutput = (errorOutput + chunk).slice(-2000);
      });
      ffmpeg.stdin.on("error", () => {
        // ffmpeg may close stdin early when the input format is invalid.
      });
      ffmpeg.once("error", reject);
      ffmpeg.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg conversion failed: ${errorOutput.trim() || `exit ${code}`}`));
      });
      ffmpeg.stdin.end(audio);
    });

    return await readFile(output);
  } finally {
    await rm(output, { force: true });
    await rmdir(workDir);
  }
}
