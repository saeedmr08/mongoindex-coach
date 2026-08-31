"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEMO_ORDERS,
  coachQuery,
  type CoachReport,
  type QueryShape,
} from "@/lib/indexes";

const EQ_OPTIONS = ["tenantId", "status", "customerId"] as const;
const RANGE_OPTIONS = ["createdAt", "totalCents"] as const;
const SORT_OPTIONS = ["createdAt", "totalCents", "status"] as const;

function toggle(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((x) => x !== value)
    : [...list, value];
}

const EXAMPLE_QUERIES: { label: string; shape: QueryShape }[] = [
  {
    label: "Tenant status feed",
    shape: {
      equality: ["tenantId", "status"],
      range: ["createdAt"],
      sort: [{ field: "createdAt", dir: -1 }],
      projection: ["_id", "totalCents", "status"],
    },
  },
  {
    label: "Customer totals",
    shape: {
      equality: ["customerId"],
      range: ["totalCents"],
      sort: [{ field: "totalCents", dir: -1 }],
      projection: ["_id", "totalCents", "status"],
    },
  },
  {
    label: "Status-only scan risk",
    shape: {
      equality: ["status"],
      range: [],
      sort: [{ field: "createdAt", dir: -1 }],
      projection: ["_id", "status"],
    },
  },
];

export default function HomePage() {
  const [equality, setEquality] = useState<string[]>(["tenantId", "status"]);
  const [range, setRange] = useState<string[]>(["createdAt"]);
  const [sortField, setSortField] = useState("createdAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [persistMsg, setPersistMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query: QueryShape = useMemo(
    () => ({
      equality,
      range,
      sort: sortField ? [{ field: sortField, dir: sortDir }] : [],
      projection: ["_id", "totalCents", "status"],
    }),
    [equality, range, sortField, sortDir]
  );

  const report: CoachReport = useMemo(
    () => coachQuery(DEMO_ORDERS, query),
    [query]
  );

  const applyExample = (shape: QueryShape) => {
    setEquality([...shape.equality]);
    setRange([...shape.range]);
    if (shape.sort[0]) {
      setSortField(shape.sort[0].field);
      setSortDir(shape.sort[0].dir);
    }
  };

  const loadSaved = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/coach");
      if (!res.ok) throw new Error("Failed to load coach store");
      const json = await res.json();
      if (json.saved?.query) {
        const q = json.saved.query as QueryShape;
        setEquality([...q.equality]);
        setRange([...q.range]);
        if (q.sort?.[0]) {
          setSortField(q.sort[0].field);
          setSortDir(q.sort[0].dir);
        }
        setSavedAt(json.saved.savedAt ?? null);
        setPersistMsg("Restored last proposal from data/indexes.json");
      } else {
        setPersistMsg("No saved proposal yet — pick an example and Save.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  const persist = async () => {
    setBusy(true);
    setPersistMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setSavedAt(json.saved?.savedAt ?? null);
      setPersistMsg("Saved query + index proposal to data/indexes.json");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setPersistMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const maxDocs = Math.max(
    report.before.totalDocsExamined,
    report.after.totalDocsExamined,
    1
  );

  if (loading) {
    return (
      <main>
        <p className="meta">Loading index coach…</p>
      </main>
    );
  }

  return (
    <main>
      <div className="eyebrow">Saeed Rumaneh · MongoIndex Coach</div>
      <h1>Explain without a cluster</h1>
      <p className="sub">
        Shape a query against a synthetic <code>orders</code> collection.
        The coach invents an ESR-ordered compound index, simulates winning
        plans before/after, and persists the last proposal to{" "}
        <code>data/indexes.json</code> via <code>POST /api/coach</code>.
      </p>

      {error ? <p className="meta" role="alert">{error}</p> : null}

      <div className="field-row" style={{ marginBottom: "1rem" }}>
        {EXAMPLE_QUERIES.map((ex) => (
          <button
            type="button"
            key={ex.label}
            className="chip"
            onClick={() => applyExample(ex.shape)}
          >
            Example: {ex.label}
          </button>
        ))}
        <button
          type="button"
          className="chip on"
          disabled={busy}
          onClick={() => void persist()}
        >
          Save proposal
        </button>
        <button type="button" className="chip" onClick={() => void loadSaved()}>
          Load last
        </button>
      </div>
      {persistMsg ? <p className="meta">{persistMsg}</p> : null}
      {savedAt ? <p className="meta">Last saved: {savedAt}</p> : null}

      <div className="board">
        <section className="panel">
          <h2>Query shape</h2>
          <p className="meta">
            {DEMO_ORDERS.name} · {DEMO_ORDERS.documents.toLocaleString()} docs ·{" "}
            {DEMO_ORDERS.existingIndexes.length} existing indexes
          </p>

          <p className="meta">Equality</p>
          <div className="field-row">
            {EQ_OPTIONS.map((f) => (
              <button
                type="button"
                key={f}
                className={`chip ${equality.includes(f) ? "on" : ""}`}
                onClick={() => setEquality(toggle(equality, f))}
              >
                {f}
              </button>
            ))}
          </div>

          <p className="meta">Range</p>
          <div className="field-row">
            {RANGE_OPTIONS.map((f) => (
              <button
                type="button"
                key={f}
                className={`chip ${range.includes(f) ? "on" : ""}`}
                onClick={() => setRange(toggle(range, f))}
              >
                {f}
              </button>
            ))}
          </div>

          <p className="meta">Sort</p>
          <div className="field-row">
            {SORT_OPTIONS.map((f) => (
              <button
                type="button"
                key={f}
                className={`chip ${sortField === f ? "on" : ""}`}
                onClick={() => setSortField(f)}
              >
                {f}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${sortDir === 1 ? "on" : ""}`}
              onClick={() => setSortDir(1)}
            >
              asc
            </button>
            <button
              type="button"
              className={`chip ${sortDir === -1 ? "on" : ""}`}
              onClick={() => setSortDir(-1)}
            >
              desc
            </button>
          </div>

          <div className="proposed">
            createIndex({`{ ${report.proposed.keys
              .map((k) => `${k.field}: ${k.dir}`)
              .join(", ")} }`})
            <div style={{ marginTop: "0.35rem", opacity: 0.8 }}>
              {report.proposed.name}
            </div>
          </div>

          <div className="ratio">
            {report.improvementRatio}×
            <span>fewer docs examined (heuristic)</span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.75rem",
              margin: "0.85rem 0",
            }}
          >
            <div>
              <span className="meta">Before cost</span>
              <strong style={{ display: "block", marginTop: "0.2rem" }}>
                {report.before.totalDocsExamined.toLocaleString()} docs · ~
                {report.before.estimatedMillis} ms
              </strong>
            </div>
            <div>
              <span className="meta">After cost</span>
              <strong style={{ display: "block", marginTop: "0.2rem" }}>
                {report.after.totalDocsExamined.toLocaleString()} docs · ~
                {report.after.estimatedMillis} ms
              </strong>
            </div>
          </div>

          {report.warnings.length > 0 && (
            <div className="warnings">
              {report.warnings.map((w) => (
                <div className="warning" key={w}>
                  {w}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Winning plans</h2>
          <div className="compare">
            <div className="plan">
              <header>
                <strong>Before</strong>
                <span>{report.before.indexUsed ?? "COLLSCAN"}</span>
              </header>
              <div className="bar">
                <span
                  style={{
                    width: `${(report.before.totalDocsExamined / maxDocs) * 100}%`,
                  }}
                />
              </div>
              <p className="meta">
                docs {report.before.totalDocsExamined.toLocaleString()} · keys{" "}
                {report.before.totalKeysExamined.toLocaleString()} · ~
                {report.before.estimatedMillis} ms
              </p>
              {report.before.winningPlan.map((s, i) => (
                <div className="stage" key={`b-${i}`}>
                  <b>{s.stage}</b> — {s.note}
                </div>
              ))}
            </div>

            <div className="plan">
              <header>
                <strong>After</strong>
                <span>{report.after.indexUsed ?? "COLLSCAN"}</span>
              </header>
              <div className="bar good">
                <span
                  style={{
                    width: `${(report.after.totalDocsExamined / maxDocs) * 100}%`,
                  }}
                />
              </div>
              <p className="meta">
                docs {report.after.totalDocsExamined.toLocaleString()} · keys{" "}
                {report.after.totalKeysExamined.toLocaleString()} · ~
                {report.after.estimatedMillis} ms
              </p>
              {report.after.winningPlan.map((s, i) => (
                <div className="stage" key={`a-${i}`}>
                  <b>{s.stage}</b> — {s.note}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
