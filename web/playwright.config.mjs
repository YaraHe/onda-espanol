import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const chromeFromUserProfile = process.platform === "win32" && process.env.USERPROFILE
  ? join(process.env.USERPROFILE, "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe")
  : null;
const chromeExecutable = process.env.PLAYWRIGHT_CHROME_PATH
  ?? (chromeFromUserProfile && existsSync(chromeFromUserProfile) ? chromeFromUserProfile : null);

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "practice-save-recovery.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  globalSetup: "./test/e2e/global-setup.mjs",
  reporter: [["list"]],
  use: {
    baseURL: process.env.S4_TEST_WEB_URL ?? "http://127.0.0.1:43100",
    browserName: "chromium",
    ...(chromeExecutable ? { launchOptions: { executablePath: chromeExecutable } } : { channel: "chrome" }),
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
