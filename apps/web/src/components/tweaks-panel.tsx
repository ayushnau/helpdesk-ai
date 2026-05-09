"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";

// ── Inline styles (self-contained, no external CSS needed) ──────────────────
const TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:default;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}
  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}
  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}
  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2}
  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
  .twk-fab{position:fixed;bottom:16px;right:16px;z-index:2147483645;
    width:36px;height:36px;border-radius:10px;border:0;
    background:rgba(250,249,247,.78);color:#29261b;
    backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%);
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 6px 20px rgba(0,0,0,.15);
    cursor:default;display:grid;place-items:center;
    font:13px ui-sans-serif,system-ui,sans-serif;
    transition:transform .12s}
  .twk-fab:hover{transform:translateY(-1px);box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 8px 24px rgba(0,0,0,.2)}
  .route-list{display:flex;flex-direction:column;gap:4px}
  .route-pill{display:flex;align-items:center;justify-content:space-between;gap:8px;
    padding:5px 8px;background:rgba(0,0,0,.04);border:.5px solid transparent;
    border-radius:5px;font-family:inherit;font-size:11px;cursor:default;
    color:rgba(41,38,27,.78)}
  .route-pill:hover{background:rgba(0,0,0,.08)}
  .route-on{background:rgba(0,0,0,.85);color:white}
  .route-pill-path{font-family:ui-monospace,monospace;font-size:10.5px;opacity:.8}
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

function isLight(hex: string) {
  const h = String(hex).replace("#", "");
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, "0");
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}

const Check = ({ light }: { light: boolean }) => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 7.2 5.8 10 11 4.2" fill="none" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round"
          stroke={light ? "rgba(0,0,0,.78)" : "#fff"} />
  </svg>
);

// ── Sub-components ──────────────────────────────────────────────────────────

export function TweakSection({ label }: { label: string }) {
  return <div className="twk-sect">{label}</div>;
}

function TweakRow({ label, value, children, inline = false }: {
  label: string; value?: string; children: React.ReactNode; inline?: boolean;
}) {
  return (
    <div className={inline ? "twk-row twk-row-h" : "twk-row"}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  );
}

export function TweakToggle({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl"><span>{label}</span></div>
      <button type="button" className="twk-toggle" data-on={value ? "1" : "0"}
              role="switch" aria-checked={!!value}
              onClick={() => onChange(!value)}><i /></button>
    </div>
  );
}

export function TweakRadio({ label, value, options, onChange }: {
  label: string; value: string;
  options: ({ value: string; label: string } | string)[];
  onChange: (v: string) => void;
}) {
  const opts = options.map((o) => (typeof o === "object" ? o : { value: o, label: o }));
  const idx = Math.max(0, opts.findIndex((o) => o.value === value));
  const n = opts.length;
  return (
    <TweakRow label={label}>
      <div role="radiogroup" className="twk-seg">
        <div className="twk-seg-thumb"
             style={{ left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
                      width: `calc((100% - 4px) / ${n})` }} />
        {opts.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value}
                  onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </TweakRow>
  );
}

export function TweakColor({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  const cur = value.toLowerCase();
  return (
    <TweakRow label={label}>
      <div className="twk-chips" role="radiogroup">
        {options.map((o, i) => {
          const on = o.toLowerCase() === cur;
          return (
            <button key={i} type="button" className="twk-chip" role="radio"
                    aria-checked={on} data-on={on ? "1" : "0"}
                    title={o} style={{ background: o }}
                    onClick={() => onChange(o)}>
              {on && <Check light={isLight(o)} />}
            </button>
          );
        })}
      </div>
    </TweakRow>
  );
}

// ── Main panel ──────────────────────────────────────────────────────────────

const ROUTES = [
  { p: "/", l: "Landing" },
  { p: "/dashboard", l: "Overview" },
  { p: "/dashboard/prompt", l: "Prompt editor" },
  { p: "/dashboard/knowledge", l: "Knowledge" },
  { p: "/dashboard/conversations", l: "Conversations" },
  { p: "/dashboard/settings", l: "Settings" },
  { p: "/chat", l: "Full-page chat" },
];

export function TweaksPanel() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const dragRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 16, y: 16 });

  // Theme mode
  const [theme, setThemeState] = useState("dark");
  useEffect(() => {
    const saved = localStorage.getItem("helpdesk-theme") || "dark";
    setThemeState(saved);
  }, []);
  const setTheme = (t: string) => {
    setThemeState(t);
    localStorage.setItem("helpdesk-theme", t);
    if (t === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  };

  // Accent color
  const [accent, setAccent] = useState("#6366F1");
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-faint", accent + "1f");
    document.documentElement.style.setProperty("--accent-soft", accent + "2e");
  }, [accent]);

  // Drag logic
  const clampToViewport = useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const maxRight = Math.max(16, window.innerWidth - w - 16);
    const maxBottom = Math.max(16, window.innerHeight - h - 16);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(16, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(16, offsetRef.current.y)),
    };
    panel.style.right = offsetRef.current.x + "px";
    panel.style.bottom = offsetRef.current.y + "px";
  }, []);

  useEffect(() => {
    if (!open) return;
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [open, clampToViewport]);

  const onDragStart = (e: React.MouseEvent) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // FAB button when closed
  if (!open) {
    return (
      <>
        <style>{TWEAKS_STYLE}</style>
        <button className="twk-fab" onClick={() => setOpen(true)} title="Open tweaks">
          ⚙
        </button>
      </>
    );
  }

  return (
    <>
      <style>{TWEAKS_STYLE}</style>
      <div ref={dragRef} className="twk-panel"
           style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}>
        <div className="twk-hd" onMouseDown={onDragStart}>
          <b>Tweaks</b>
          <button className="twk-x" aria-label="Close tweaks"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="twk-body">
          <TweakSection label="Theme" />
          <TweakRadio label="Mode" value={theme}
                      options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
                      onChange={setTheme} />
          <TweakColor label="Accent" value={accent}
                      options={["#6366F1", "#3B82F6", "#10B981", "#F59E0B", "#EC4899", "#FAFAFA"]}
                      onChange={setAccent} />
        </div>
      </div>
    </>
  );
}
