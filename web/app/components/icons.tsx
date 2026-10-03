type IconName =
  | "arrow-left"
  | "book"
  | "camera"
  | "headphones"
  | "history"
  | "mic"
  | "search"
  | "settings"
  | "shuffle"
  | "volume";

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const common = {
    className,
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  const paths: Record<IconName, React.ReactNode> = {
    "arrow-left": <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    book: <><path d="M12 6c-2.5-1.5-5.5-1.5-9-.5v13c3.5-1 6.5-1 9 .5 2.5-1.5 5.5-1.5 9-.5v-13c-3.5-1-6.5-1-9 .5Z" /><path d="M12 6v13" /></>,
    camera: <><path d="M3 7h4l2-2h6l2 2h4v12H3V7Z" /><circle cx="12" cy="13" r="3" /></>,
    headphones: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><path d="M4 14h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 1-2ZM20 14h-3v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-1-2Z" /></>,
    history: <><path d="M3 12a9 9 0 1 0 2.7-6.4" /><path d="M3 4v4h4" /><path d="M12 7v5l3 2" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4m-4 0h8" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.8v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2-2 .1-.1A1.7 1.7 0 0 0 7.4 15a1.7 1.7 0 0 0-1.5-1H5.7v-2.8h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L7 8.2l2-2 .1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.8v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2 2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>,
    shuffle: <><path d="M4 7h3c4 0 6 10 10 10h3" /><path d="m17 14 3 3-3 3M4 17h3c1.7 0 3-1.7 4.2-3.5M14 8.5C15 7.5 16 7 17 7h3m-3-3 3 3-3 3" /></>,
    volume: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M17 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12" /></>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}
