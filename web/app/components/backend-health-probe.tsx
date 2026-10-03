"use client";

import { useEffect } from "react";
import { fetchBackendHealth } from "../lib/backend-health";

// Run only for the Stage 1 deployment check; normal page visits make no request.
export function BackendHealthProbe() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("verify-backend-health") !== "1") return;

    const controller = new AbortController();
    const root = document.documentElement;
    root.dataset.backendHealth = "checking";
    void fetchBackendHealth(controller.signal).then(
      () => { root.dataset.backendHealth = "ok"; },
      () => { if (!controller.signal.aborted) root.dataset.backendHealth = "error"; },
    );
    return () => controller.abort();
  }, []);

  return null;
}
