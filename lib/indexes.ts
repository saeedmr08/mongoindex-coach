/**
 * Offline MongoDB index coach — simulates explain()-style summaries
 * for a synthetic collection without a live database.
 */

export type FieldStats = {
  name: string;
  cardinality: number;
  avgBytes: number;
};

export type CollectionProfile = {
  name: string;
  documents: number;
  avgDocBytes: number;
  fields: FieldStats[];
  existingIndexes: IndexSpec[];
};

export type IndexSpec = {
  name: string;
  keys: { field: string; dir: 1 | -1 }[];
};

export type QueryShape = {
  equality: string[];
  range: string[];
  sort: { field: string; dir: 1 | -1 }[];
  projection: string[];
};

export type StageSummary = {
  stage: "COLLSCAN" | "IXSCAN" | "FETCH" | "SORT" | "PROJECTION";
  docsExamined: number;
  keysExamined: number;
  nReturned: number;
  note: string;
};

export type ExplainSummary = {
  winningPlan: StageSummary[];
  totalDocsExamined: number;
  totalKeysExamined: number;
  nReturned: number;
  estimatedMillis: number;
  indexUsed: string | null;
};

export type CoachReport = {
  before: ExplainSummary;
  after: ExplainSummary;
  proposed: IndexSpec;
  improvementRatio: number;
  warnings: string[];
};

const WRITE_PENALTY_PER_INDEX = 0.04;

export function fieldByName(
  profile: CollectionProfile,
  name: string
): FieldStats | undefined {
  return profile.fields.find((f) => f.name === name);
}

export function selectivity(
  profile: CollectionProfile,
  field: string
): number {
  const f = fieldByName(profile, field);
  if (!f || profile.documents === 0) return 1;
  return Math.min(1, Math.max(1 / profile.documents, 1 / f.cardinality));
}

/** ESR-inspired key order: Equality → Sort → Range */
export function proposeIndex(query: QueryShape): IndexSpec {
  const keys: IndexSpec["keys"] = [];
  const seen = new Set<string>();

  for (const field of query.equality) {
    if (!seen.has(field)) {
      keys.push({ field, dir: 1 });
      seen.add(field);
    }
  }
  for (const s of query.sort) {
    if (!seen.has(s.field)) {
      keys.push({ field: s.field, dir: s.dir });
      seen.add(s.field);
    }
  }
  for (const field of query.range) {
    if (!seen.has(field)) {
      keys.push({ field, dir: 1 });
      seen.add(field);
    }
  }

  if (keys.length === 0) {
    keys.push({ field: "_id", dir: 1 });
  }

  const name = `idx_${keys.map((k) => `${k.field}_${k.dir === 1 ? "asc" : "desc"}`).join("_")}`;
  return { name, keys };
}

function indexCoversPrefix(
  index: IndexSpec,
  equality: string[],
  sort: QueryShape["sort"]
): boolean {
  const keys = index.keys.map((k) => k.field);
  let i = 0;
  for (const eq of equality) {
    if (keys[i] !== eq) return false;
    i++;
  }
  for (const s of sort) {
    if (keys[i] !== s.field) return false;
    const dir = index.keys[i]?.dir;
    if (dir !== undefined && dir !== s.dir && sort.length > 0) {
      // direction mismatch on leading sort key → cannot use for sort
      return false;
    }
    i++;
  }
  return i > 0 || equality.length === 0;
}

function pickIndex(
  profile: CollectionProfile,
  query: QueryShape,
  extra?: IndexSpec
): IndexSpec | null {
  const pool = extra
    ? [...profile.existingIndexes, extra]
    : profile.existingIndexes;

  // Prefer longest matching prefix
  let best: IndexSpec | null = null;
  let bestScore = -1;
  for (const idx of pool) {
    if (!indexCoversPrefix(idx, query.equality, query.sort)) {
      // still allow equality-only prefix match
      const eqOnly = indexCoversPrefix(idx, query.equality, []);
      if (!eqOnly) continue;
      const score = query.equality.length;
      if (score > bestScore) {
        best = idx;
        bestScore = score;
      }
      continue;
    }
    const score = query.equality.length + query.sort.length;
    if (score > bestScore) {
      best = idx;
      bestScore = score;
    }
  }
  return best;
}

function estimateReturned(profile: CollectionProfile, query: QueryShape): number {
  let fraction = 1;
  for (const eq of query.equality) {
    fraction *= selectivity(profile, eq);
  }
  for (const r of query.range) {
    // assume range hits ~15% of the equality-filtered set
    fraction *= Math.min(1, selectivity(profile, r) * Math.sqrt(profile.documents) * 0.15 + 0.05);
  }
  return Math.max(1, Math.round(profile.documents * fraction));
}

export function simulateExplain(
  profile: CollectionProfile,
  query: QueryShape,
  extraIndex?: IndexSpec
): ExplainSummary {
  const nReturned = estimateReturned(profile, query);
  const chosen = pickIndex(profile, query, extraIndex);
  const stages: StageSummary[] = [];

  if (!chosen) {
    stages.push({
      stage: "COLLSCAN",
      docsExamined: profile.documents,
      keysExamined: 0,
      nReturned,
      note: "No usable index — full collection scan",
    });
    if (query.sort.length > 0) {
      stages.push({
        stage: "SORT",
        docsExamined: nReturned,
        keysExamined: 0,
        nReturned,
        note: "In-memory sort of filtered docs",
      });
    }
  } else {
    const eqSelect = query.equality.reduce(
      (acc, f) => acc * selectivity(profile, f),
      1
    );
    const keysExamined = Math.max(
      nReturned,
      Math.round(profile.documents * eqSelect * (query.range.length ? 1.4 : 1.05))
    );
    stages.push({
      stage: "IXSCAN",
      docsExamined: 0,
      keysExamined,
      nReturned,
      note: `Index scan on ${chosen.name}`,
    });
    stages.push({
      stage: "FETCH",
      docsExamined: Math.min(profile.documents, keysExamined),
      keysExamined: 0,
      nReturned,
      note: "Fetch full documents from matched keys",
    });
    const sortCovered =
      query.sort.length > 0 &&
      indexCoversPrefix(chosen, query.equality, query.sort);
    if (query.sort.length > 0 && !sortCovered) {
      stages.push({
        stage: "SORT",
        docsExamined: nReturned,
        keysExamined: 0,
        nReturned,
        note: "Sort not covered by index key order",
      });
    }
  }

  if (query.projection.length > 0) {
    stages.push({
      stage: "PROJECTION",
      docsExamined: 0,
      keysExamined: 0,
      nReturned,
      note: `Project ${query.projection.join(", ")}`,
    });
  }

  const totalDocsExamined = stages.reduce((s, x) => s + x.docsExamined, 0);
  const totalKeysExamined = stages.reduce((s, x) => s + x.keysExamined, 0);
  const bytesTouched =
    totalDocsExamined * profile.avgDocBytes + totalKeysExamined * 24;
  const estimatedMillis = Math.max(0.2, bytesTouched / 2_500_000);

  return {
    winningPlan: stages,
    totalDocsExamined,
    totalKeysExamined,
    nReturned,
    estimatedMillis: Math.round(estimatedMillis * 100) / 100,
    indexUsed: chosen?.name ?? null,
  };
}

export function overIndexWarnings(
  profile: CollectionProfile,
  proposed: IndexSpec
): string[] {
  const warnings: string[] = [];
  const totalAfter = profile.existingIndexes.length + 1;

  if (totalAfter > 8) {
    warnings.push(
      `Collection would have ${totalAfter} indexes — write amplification and RAM pressure climb quickly past ~8.`
    );
  }

  const duplicate = profile.existingIndexes.find(
    (idx) =>
      idx.keys.length === proposed.keys.length &&
      idx.keys.every(
        (k, i) =>
          k.field === proposed.keys[i].field && k.dir === proposed.keys[i].dir
      )
  );
  if (duplicate) {
    warnings.push(`Proposed index duplicates existing "${duplicate.name}".`);
  }

  const prefixRedundant = profile.existingIndexes.find((idx) => {
    if (idx.keys.length <= proposed.keys.length) return false;
    return proposed.keys.every(
      (k, i) => k.field === idx.keys[i]?.field && k.dir === idx.keys[i]?.dir
    );
  });
  if (prefixRedundant) {
    warnings.push(
      `Existing "${prefixRedundant.name}" already prefixes the proposed keys — new index may be redundant.`
    );
  }

  if (proposed.keys.length > 4) {
    warnings.push(
      "Compound indexes wider than 4 fields are rarely selective end-to-end; consider narrowing."
    );
  }

  const lowCard = proposed.keys.filter((k) => {
    const f = fieldByName(profile, k.field);
    return f && f.cardinality < 5 && profile.documents > 1000;
  });
  if (lowCard.length > 0 && proposed.keys[0] && lowCard[0].field === proposed.keys[0].field) {
    warnings.push(
      `Leading key "${lowCard[0].field}" has very low cardinality — weak selectivity as a prefix.`
    );
  }

  const writeTax = Math.round(totalAfter * WRITE_PENALTY_PER_INDEX * 100);
  if (writeTax >= 20) {
    warnings.push(
      `Rough write tax ≈ ${writeTax}% extra index maintenance per insert/update (heuristic).`
    );
  }

  return warnings;
}

export function coachQuery(
  profile: CollectionProfile,
  query: QueryShape
): CoachReport {
  const proposed = proposeIndex(query);
  const before = simulateExplain(profile, query);
  const after = simulateExplain(profile, query, proposed);
  const improvementRatio =
    before.totalDocsExamined === 0
      ? 1
      : before.totalDocsExamined / Math.max(1, after.totalDocsExamined);

  return {
    before,
    after,
    proposed,
    improvementRatio: Math.round(improvementRatio * 100) / 100,
    warnings: overIndexWarnings(profile, proposed),
  };
}

export const DEMO_ORDERS: CollectionProfile = {
  name: "orders",
  documents: 250_000,
  avgDocBytes: 420,
  fields: [
    { name: "tenantId", cardinality: 120, avgBytes: 24 },
    { name: "status", cardinality: 6, avgBytes: 12 },
    { name: "createdAt", cardinality: 200_000, avgBytes: 8 },
    { name: "customerId", cardinality: 48_000, avgBytes: 24 },
    { name: "totalCents", cardinality: 8_000, avgBytes: 8 },
    { name: "_id", cardinality: 250_000, avgBytes: 12 },
  ],
  existingIndexes: [
    { name: "_id_", keys: [{ field: "_id", dir: 1 }] },
    {
      name: "idx_tenantId_asc",
      keys: [{ field: "tenantId", dir: 1 }],
    },
  ],
};
