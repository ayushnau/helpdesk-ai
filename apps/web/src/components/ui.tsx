"use client";

import React from "react";
import { Icon } from "./icons";

export function Btn({ kind = "secondary", size = "md", icon, iconRight, children, onClick, disabled, type = "button", style = {}, title }: {
  kind?: string; size?: string; icon?: string; iconRight?: string; children?: React.ReactNode;
  onClick?: () => void; disabled?: boolean; type?: "button" | "submit" | "reset"; style?: React.CSSProperties; title?: string;
}) {
  const cls = ["btn", `btn-${kind}`, `btn-${size}`].join(" ");
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} style={style} title={title}>
      {icon && <Icon name={icon} size={size === "sm" ? 12 : 14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 12 : 14} />}
    </button>
  );
}

export function Card({ children, style = {}, className = "", noPad = false }: {
  children: React.ReactNode; style?: React.CSSProperties; className?: string; noPad?: boolean;
}) {
  return (
    <div className={`card ${noPad ? "card-np" : ""} ${className}`} style={{ padding: noPad ? 0 : 16, ...style }}>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, accent = false, mono = true }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean; mono?: boolean;
}) {
  return (
    <div className={`stat ${accent ? "stat-accent" : ""}`}>
      <div className="stat-lbl">{label}</div>
      <div className={`stat-val ${mono ? "mono" : ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Badge({ children, kind = "neutral", mono = false, dot = false, style = {} }: {
  children: React.ReactNode; kind?: string; mono?: boolean; dot?: boolean; style?: React.CSSProperties;
}) {
  return (
    <span className={`badge badge-${kind} ${mono ? "mono" : ""}`} style={style}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function Mono({ children, dim = false, style = {} }: { children: React.ReactNode; dim?: boolean; style?: React.CSSProperties }) {
  return <span className="mono" style={{ color: dim ? "var(--fg-3)" : "inherit", ...style }}>{children}</span>;
}

export function PageHeader({ eyebrow, title, sub, actions }: {
  eyebrow?: string; title: string; sub?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="page-hd">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Sparkline({ data, width = 120, height = 32, stroke = "var(--accent)", fill = false }: {
  data: number[]; width?: number; height?: number; stroke?: string; fill?: boolean;
}) {
  if (!data || !data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(1, max - min);
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return [x, y];
  });
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const dFill = `${d} L${width} ${height} L0 ${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="spark">
      {fill && <path d={dFill} fill="var(--accent-faint)" stroke="none" />}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

export function BarChart({ data, labels, height = 160, accentIdx, max: maxProp }: {
  data: number[]; labels: string[]; height?: number; accentIdx?: number; max?: number;
}) {
  const top = maxProp || Math.max(...data);
  return (
    <div className="bar-chart" style={{ height }}>
      {data.map((v, i) => {
        const h = (v / top) * 100;
        const isAccent = accentIdx === i;
        return (
          <div className="bar-col" key={i} title={`${labels[i]} · ${v.toLocaleString()} tokens`}>
            <div className="bar-wrap">
              <div className={`bar ${isAccent ? "bar-accent" : ""}`} style={{ height: `${h}%` }} />
            </div>
            <div className="bar-lbl">{labels[i]}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Empty({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark" />
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function ToolCall({ name, query, result }: { name: string; query?: string; result?: string }) {
  const done = !!result;
  return (
    <div className="tool-call">
      <div className="tool-call-head">
        {done
          ? <span className="success-dot" />
          : <span className="tool-spinner" />
        }
        <span className="mono">{name}</span>
        {result && <span className="tool-call-time mono">{result}</span>}
      </div>
      {query && <div className="tool-call-q mono">{query}</div>}
    </div>
  );
}

export function CitationChip({ n, title, onClick }: { n: number; title: string; onClick?: () => void }) {
  return (
    <button className="cite-chip" onClick={onClick} title={title}>
      <span className="cite-n mono">{n}</span>
      <span className="cite-title">{title}</span>
      <Icon name="ext" size={11} />
    </button>
  );
}

export function CiteRef({ n }: { n: number }) {
  return <sup className="cite-ref mono">[{n}]</sup>;
}

export function FormRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="form-row">
      <div className="form-row-l">
        <div className="form-label">{label}</div>
        {hint && <div className="form-hint">{hint}</div>}
      </div>
      <div className="form-row-r">{children}</div>
    </div>
  );
}

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <div className="logo">
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M3 4l5-2 5 2v8l-5 2-5-2V4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M8 8l5-2M8 8v6M8 8L3 6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span className="logo-text">helpdesk<span className="logo-dot">.</span>ai</span>
    </div>
  );
}
