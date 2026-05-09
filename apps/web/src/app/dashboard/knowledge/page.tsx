"use client";

import React, { useState, useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { Btn, Card, Stat, PageHeader, Kbd, Mono } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";
import { getKnowledge, uploadKnowledge, reindexKnowledge, deleteKnowledge } from "@/lib/api";

type KnowledgeDoc = {
  doc_title: string;
  source_file: string;
  doc_type: string;
  chunk_count: number;
  total_chars: number;
};

type UploadStatus = "idle" | "uploading" | "success" | "error";
type ReindexStatus = "idle" | "reindexing" | "success" | "error";

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

export default function KnowledgePage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId || "posthog";

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [reindexStatus, setReindexStatus] = useState<ReindexStatus>("idle");
  const [reindexMessage, setReindexMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadDocs() {
    try {
      const res = await getKnowledge(tenantId);
      if (res?.documents) setDocs(res.documents);
      if (typeof res?.totalChunks === "number") setTotalChunks(res.totalChunks);
    } catch {
      // Keep empty
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await getKnowledge(tenantId);
        if (cancelled) return;
        if (res?.documents) setDocs(res.documents);
        if (typeof res?.totalChunks === "number") setTotalChunks(res.totalChunks);
      } catch {
        // Keep empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadStatus("uploading");
    setUploadMessage(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}...`);

    try {
      const res = await uploadKnowledge(tenantId, files);
      if (res.error) {
        setUploadStatus("error");
        setUploadMessage(res.error);
      } else {
        setUploadStatus("success");
        setUploadMessage(`Uploaded ${files.length} file${files.length > 1 ? "s" : ""} successfully.`);
        // Refresh the document list after successful upload
        await loadDocs();
      }
    } catch (err) {
      setUploadStatus("error");
      setUploadMessage(err instanceof Error ? err.message : "Upload failed");
    }

    // Reset the file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Clear status after a few seconds
    setTimeout(() => {
      setUploadStatus("idle");
      setUploadMessage("");
    }, 4000);
  }

  async function handleReindex() {
    setReindexStatus("reindexing");
    setReindexMessage("Re-indexing knowledge base...");

    try {
      const res = await reindexKnowledge(tenantId);
      if (res.error) {
        setReindexStatus("error");
        setReindexMessage(res.error);
      } else {
        setReindexStatus("success");
        setReindexMessage(res.message || "Re-index complete.");
        // Refresh docs after reindex
        await loadDocs();
      }
    } catch (err) {
      setReindexStatus("error");
      setReindexMessage(err instanceof Error ? err.message : "Re-index failed");
    }

    setTimeout(() => {
      setReindexStatus("idle");
      setReindexMessage("");
    }, 4000);
  }

  // Compute type counts
  const typeCounts: Record<string, number> = {};
  for (const d of docs) {
    typeCounts[d.doc_type] = (typeCounts[d.doc_type] || 0) + 1;
  }
  const typeNames = Object.keys(typeCounts).sort();

  // Filter
  const filtered = docs.filter((d) => {
    if (typeFilter !== "all" && d.doc_type !== typeFilter) return false;
    if (q && !d.doc_title.toLowerCase().includes(q.toLowerCase()) && !d.source_file.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const totalChars = docs.reduce((a, d) => a + (Number(d.total_chars) || 0), 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Knowledge"
        title="Indexed documents"
        sub={<>Knowledge base for <span className="mono">{tenantId}</span> · Supported formats: <span className="mono">.md</span>, <span className="mono">.mdx</span>, <span className="mono">.txt</span></>}
        actions={
          <>
            {/* Hidden file input for upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.mdx,.txt"
              multiple
              style={{ display: "none" }}
              onChange={handleUpload}
            />
            <Btn
              kind="ghost"
              size="sm"
              icon="plus"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadStatus === "uploading"}
            >
              {uploadStatus === "uploading" ? "Uploading..." : "Upload files"}
            </Btn>
            <Btn
              kind="ghost"
              size="sm"
              icon="filter"
              onClick={handleReindex}
              disabled={reindexStatus === "reindexing"}
            >
              {reindexStatus === "reindexing" ? "Re-indexing..." : "Re-index all"}
            </Btn>
            {/* TODO: source repo URL should be configurable per tenant, not hardcoded */}
            <Btn
              kind="secondary"
              size="sm"
              icon="ext"
              onClick={() => window.open("https://github.com/PostHog/posthog.com/tree/master/contents", "_blank")}
            >
              View source repo
            </Btn>
            <Btn kind="primary" size="sm" icon="plus" disabled title="Coming soon">Connect source</Btn>
            {docs.length > 0 && (
              <Btn
                kind="ghost"
                size="sm"
                icon="x"
                onClick={async () => {
                  if (!confirm(`Delete all ${docs.length} documents for ${tenantId}? This cannot be undone.`)) return;
                  try {
                    await deleteKnowledge(tenantId);
                    await loadDocs();
                  } catch {}
                }}
                style={{ color: "var(--fg-4)" }}
                title="Delete all indexed documents"
              >
                Clear index
              </Btn>
            )}
          </>
        }
      />

      {/* Upload status feedback */}
      {uploadStatus !== "idle" && (
        <div
          className={`status-banner ${uploadStatus === "error" ? "status-error" : uploadStatus === "success" ? "status-success" : "status-info"}`}
          style={{
            padding: "8px 16px",
            marginBottom: 12,
            borderRadius: 6,
            fontSize: 13,
            background: uploadStatus === "error" ? "var(--red-bg, #fee)" : uploadStatus === "success" ? "var(--green-bg, #efe)" : "var(--blue-bg, #eef)",
            color: uploadStatus === "error" ? "var(--red, #c00)" : uploadStatus === "success" ? "var(--green, #080)" : "var(--blue, #06c)",
          }}
        >
          {uploadMessage}
        </div>
      )}

      {/* Reindex status feedback */}
      {reindexStatus !== "idle" && (
        <div
          className={`status-banner ${reindexStatus === "error" ? "status-error" : reindexStatus === "success" ? "status-success" : "status-info"}`}
          style={{
            padding: "8px 16px",
            marginBottom: 12,
            borderRadius: 6,
            fontSize: 13,
            background: reindexStatus === "error" ? "var(--red-bg, #fee)" : reindexStatus === "success" ? "var(--green-bg, #efe)" : "var(--blue-bg, #eef)",
            color: reindexStatus === "error" ? "var(--red, #c00)" : reindexStatus === "success" ? "var(--green, #080)" : "var(--blue, #06c)",
          }}
        >
          {reindexMessage}
        </div>
      )}

      <div className="stat-row">
        <Stat label="Documents" value={docs.length.toLocaleString()} />
        <Stat label="Total chunks" value={fmtNum(totalChunks)} sub="across all documents" />
        <Stat label="Estimated tokens" value={fmtNum(estimatedTokens)} sub={`${fmtNum(totalChars)} characters`} />
        <Stat label="Last sync" value="2m ago" sub="auto · on push" accent />
      </div>

      <Card noPad>
        <div className="kb-toolbar">
          <div className="search-input">
            <Icon name="search" size={14} />
            <input placeholder="Filter documents..." value={q} onChange={(e) => setQ(e.target.value)} />
            <Kbd>/</Kbd>
          </div>
          <div className="seg-tabs">
            <button
              className={`seg-tab ${typeFilter === "all" ? "seg-active" : ""}`}
              onClick={() => setTypeFilter("all")}
            >
              All <span className="mono dim">{docs.length}</span>
            </button>
            {typeNames.map((t) => (
              <button
                key={t}
                className={`seg-tab ${typeFilter === t ? "seg-active" : ""}`}
                onClick={() => setTypeFilter(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)} <span className="mono dim">{typeCounts[t]}</span>
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", opacity: 0.5 }}>Loading knowledge base...</div>
        ) : docs.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", opacity: 0.5 }}>No documents indexed yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Title</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Chunks</th>
                <th style={{ textAlign: "right" }}>~Tokens</th>
                <th>Type</th>
                <th style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <tr key={i}>
                  <td><Icon name="file" size={14} /></td>
                  <td className="t-strong">{d.doc_title}</td>
                  <td><Mono dim>{d.source_file}</Mono></td>
                  <td style={{ textAlign: "right" }}><Mono>{d.chunk_count}</Mono></td>
                  <td style={{ textAlign: "right" }}><Mono>{fmtNum(Math.ceil((Number(d.total_chars) || 0) / 4))}</Mono></td>
                  <td><Mono dim>{d.doc_type}</Mono></td>
                  <td><Icon name="chevR" size={14} className="row-chev" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
