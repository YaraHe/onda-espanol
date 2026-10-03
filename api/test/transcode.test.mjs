import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { transcodeToAssessmentWav } from "../dist/audio/transcode.js";

const exec = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || (process.env.FFMPEG_PATH
  ? join(dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
  : "ffprobe");

test("webm/opus and mp4/aac become mono 16 kHz PCM WAV", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "spanish-transcode-test-"));

  try {
    for (const source of [
      { name: "sample.webm", codec: "libopus" },
      { name: "sample.mp4", codec: "aac" },
    ]) {
      const inputPath = join(workDir, source.name);
      const outputPath = join(workDir, `${source.name}.wav`);
      await exec(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
        "sine=frequency=440:duration=1.5", "-c:a", source.codec, inputPath,
      ]);

      const wav = await transcodeToAssessmentWav(await readFile(inputPath));
      assert.ok(wav.length > 44);
      await writeFile(outputPath, wav);

      const { stdout } = await exec(ffprobe, [
        "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,sample_rate,channels",
        "-of", "json", outputPath,
      ]);
      const stream = JSON.parse(stdout).streams[0];
      assert.deepEqual(stream, {
        codec_name: "pcm_s16le",
        sample_rate: "16000",
        channels: 1,
      });
    }
  } finally {
    for (const name of ["sample.webm", "sample.mp4", "sample.webm.wav", "sample.mp4.wav"]) {
      await rm(join(workDir, name), { force: true });
    }
    await rmdir(workDir);
  }
});

test("invalid audio fails instead of returning a WAV", async () => {
  await assert.rejects(transcodeToAssessmentWav(Buffer.from("invalid audio")), /ffmpeg conversion failed/);
});
