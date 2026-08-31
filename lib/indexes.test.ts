import { describe, expect, it } from "vitest";
import {
  DEMO_ORDERS,
  coachQuery,
  overIndexWarnings,
  proposeIndex,
  selectivity,
  simulateExplain,
  type IndexSpec,
  type QueryShape,
} from "./indexes";

const sampleQuery: QueryShape = {
  equality: ["tenantId", "status"],
  range: ["createdAt"],
  sort: [{ field: "createdAt", dir: -1 }],
  projection: ["_id", "totalCents"],
};

describe("selectivity", () => {
  it("uses cardinality against document count", () => {
    const s = selectivity(DEMO_ORDERS, "status");
    expect(s).toBeCloseTo(1 / 6, 5);
  });
});

describe("proposeIndex", () => {
  it("orders keys Equality → Sort → Range (ESR)", () => {
    const idx = proposeIndex(sampleQuery);
    expect(idx.keys.map((k) => k.field)).toEqual([
      "tenantId",
      "status",
      "createdAt",
    ]);
    expect(idx.keys[2].dir).toBe(-1);
  });

  it("falls back to _id when query is empty", () => {
    const idx = proposeIndex({
      equality: [],
      range: [],
      sort: [],
      projection: [],
    });
    expect(idx.keys[0].field).toBe("_id");
  });
});

describe("simulateExplain", () => {
  it("COLLSCANs when no usable index exists for the equality prefix", () => {
    const q: QueryShape = {
      equality: ["customerId"],
      range: [],
      sort: [],
      projection: [],
    };
    const plan = simulateExplain(DEMO_ORDERS, q);
    expect(plan.winningPlan[0].stage).toBe("COLLSCAN");
    expect(plan.indexUsed).toBeNull();
    expect(plan.totalDocsExamined).toBe(DEMO_ORDERS.documents);
  });

  it("uses IXSCAN after a covering compound index is proposed", () => {
    const proposed = proposeIndex(sampleQuery);
    const before = simulateExplain(DEMO_ORDERS, sampleQuery);
    const after = simulateExplain(DEMO_ORDERS, sampleQuery, proposed);
    expect(before.totalDocsExamined).toBeGreaterThan(after.totalDocsExamined);
    expect(after.indexUsed).toBe(proposed.name);
    expect(after.winningPlan.some((s) => s.stage === "IXSCAN")).toBe(true);
  });
});

describe("overIndexWarnings", () => {
  it("warns on duplicate of an existing index", () => {
    const dup: IndexSpec = {
      name: "copy",
      keys: [{ field: "tenantId", dir: 1 }],
    };
    const warnings = overIndexWarnings(DEMO_ORDERS, dup);
    expect(warnings.some((w) => w.includes("duplicates"))).toBe(true);
  });

  it("warns when many indexes would exist", () => {
    const fat = {
      ...DEMO_ORDERS,
      existingIndexes: Array.from({ length: 8 }, (_, i) => ({
        name: `idx_${i}`,
        keys: [{ field: "status", dir: 1 as const }],
      })),
    };
    const warnings = overIndexWarnings(fat, proposeIndex(sampleQuery));
    expect(warnings.some((w) => w.includes("8 indexes") || w.includes("would have"))).toBe(
      true
    );
  });
});

describe("coachQuery", () => {
  it("returns before/after summaries and improvement ratio", () => {
    const report = coachQuery(DEMO_ORDERS, sampleQuery);
    expect(report.improvementRatio).toBeGreaterThan(1);
    expect(report.proposed.keys.length).toBeGreaterThan(0);
    expect(report.before.nReturned).toBe(report.after.nReturned);
  });
});
