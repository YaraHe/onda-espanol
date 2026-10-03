"use client";

import { useRouter } from "next/navigation";
import { Icon } from "./icons";

export function BackLink({ fallback }: { fallback: string }) {
  const router = useRouter();

  function goBack() {
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
