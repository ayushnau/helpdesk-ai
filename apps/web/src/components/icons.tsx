"use client";

import React from "react";

const paths: Record<string, string> = {
  home: "M3 7l5-4 5 4v6H3V7z",
  sparkle: "M8 2v4M8 10v4M2 8h4M10 8h4M4.5 4.5l1.5 1.5M10 10l1.5 1.5M11.5 4.5L10 6M6 10l-1.5 1.5",
  book: "M3 3h7a2 2 0 012 2v8H5a2 2 0 01-2-2V3zM3 11a2 2 0 012-2h7",
  chat: "M3 4h10v7H7l-3 2v-2H3V4z",
  settings: "M8 5v6M5 8h6M3.5 3.5l9 9M12.5 3.5l-9 9",
  key: "M9.5 6.5a2.5 2.5 0 11-2.5 2.5L3 13l1 1 1-1 1 1 1-1 1-1 1 .5",
  edit: "M3 11l1.5 1.5L12 5l-1.5-1.5L3 11zM10 4l1 1",
  search: "M11 11l3 3M7 12a5 5 0 100-10 5 5 0 000 10z",
  plus: "M8 3v10M3 8h10",
  arrow: "M5 8h6M8 5l3 3-3 3",
  arrowL: "M11 8H5M8 5L5 8l3 3",
  check: "M3 8l3 3 7-7",
  x: "M4 4l8 8M12 4l-8 8",
  copy: "M5 5h7v8H5V5zM3 3h7v2",
  play: "M5 4l7 4-7 4V4z",
  spinner: "M8 2a6 6 0 016 6",
  dot: "M8 8h.01",
  chevR: "M6 4l4 4-4 4",
  chevD: "M4 6l4 4 4-4",
  flask: "M6 2v3l-3 6a2 2 0 002 3h6a2 2 0 002-3l-3-6V2H6zM5 9h6",
  bolt: "M9 2L3 9h4l-1 5 6-7H8l1-5z",
  server: "M2 4h12v3H2V4zM2 9h12v3H2V9zM5 5.5h.01M5 10.5h.01",
  file: "M4 2h5l3 3v9H4V2zM9 2v3h3",
  ext: "M9 3h4v4M13 3l-7 7M11 9v3H3V4h3",
  chart: "M3 13V3M3 13h10M6 10V7M9 10V5M12 10V8",
  user: "M8 8a3 3 0 100-6 3 3 0 000 6zM3 14c0-2.5 2.5-4 5-4s5 1.5 5 4",
  cmd: "M5 5h6v6H5V5zM3 5a2 2 0 114 0v6a2 2 0 11-4 0M9 5a2 2 0 114 0v6a2 2 0 11-4 0",
  filter: "M3 4h10M5 8h6M7 12h2",
  tag: "M2 8V3h5l7 7-5 5-7-7zM5 5.5h.01",
  inbox: "M2 9l1.5-5h9L14 9v4H2V9zM2 9h4l1 2h2l1-2h4",
  book2: "M3 3h10v10l-5-2-5 2V3z",
};

export function Icon({ name, size = 16, className = "" }: { name: string; size?: number; className?: string }) {
  const p = paths[name] || paths.dot;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         strokeWidth="1.5" stroke="currentColor" strokeLinecap="round"
         strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={p} />
    </svg>
  );
}
