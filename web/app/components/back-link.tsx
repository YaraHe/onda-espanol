"use client";

import { useRouter } from "next/navigation";
import { Icon } from "./icons";

export function BackLink({ fallback, beforeNavigate }: { fallback: string; beforeNavigate?: () => boolean }) {
  const router = useRouter();

  function goBack() {
    if (beforeNavigate && !beforeNavigate()) return;
    const from = new URLSearchParams(window.location.search).get("from");
    const destination = from && ["/", "/library", "/records"].includes(from) ? from : fallback;
    router.replace(destination);
  }

  return (
    <button type="button" onClick={goBack} className="back-link">
      <Icon name="arrow-left" />
      <span>返回</span>
    </button>
  );
}
