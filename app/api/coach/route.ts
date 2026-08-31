import { NextRequest, NextResponse } from "next/server";
import {
  DEMO_ORDERS,
  coachQuery,
  type QueryShape,
} from "@/lib/indexes";
import { readIndexes, writeIndexes } from "@/lib/indexes-store";

export const runtime = "nodejs";

function isQueryShape(raw: unknown): raw is QueryShape {
  if (!raw || typeof raw !== "object") return false;
  const q = raw as Record<string, unknown>;
  return (
    Array.isArray(q.equality) &&
    Array.isArray(q.range) &&
    Array.isArray(q.sort) &&
    Array.isArray(q.projection)
  );
}

/** GET /api/coach — last persisted query + index proposal (seeds default if empty). */
export async function GET() {
  let saved = await readIndexes();
  if (!saved) {
    const defaultQuery: QueryShape = {
      equality: ["tenantId", "status"],
      range: ["createdAt"],
      sort: [{ field: "createdAt", dir: -1 }],
      projection: ["_id", "totalCents", "status"],
    };
    const report = coachQuery(DEMO_ORDERS, defaultQuery);
    saved = {
      savedAt: new Date().toISOString(),
      query: defaultQuery,
      proposed: report.proposed,
      improvementRatio: report.improvementRatio,
      warnings: report.warnings,
      before: {
        indexUsed: report.before.indexUsed,
        totalDocsExamined: report.before.totalDocsExamined,
        totalKeysExamined: report.before.totalKeysExamined,
        estimatedMillis: report.before.estimatedMillis,
      },
      after: {
        indexUsed: report.after.indexUsed,
        totalDocsExamined: report.after.totalDocsExamined,
        totalKeysExamined: report.after.totalKeysExamined,
        estimatedMillis: report.after.estimatedMillis,
      },
    };
    await writeIndexes(saved);
  }
  return NextResponse.json({
    profile: {
      name: DEMO_ORDERS.name,
      documents: DEMO_ORDERS.documents,
      existingIndexes: DEMO_ORDERS.existingIndexes,
    },
    saved,
  });
}

/**
 * POST /api/coach — run simulated explain, persist last query + proposal
 * to data/indexes.json.
 */
export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const body = raw as { query?: unknown };
  if (!isQueryShape(body.query)) {
    return NextResponse.json(
      {
        error:
          "Body requires query: { equality, range, sort, projection }",
      },
      { status: 400 }
    );
  }

  const report = coachQuery(DEMO_ORDERS, body.query);
  const saved = {
    savedAt: new Date().toISOString(),
    query: body.query,
    proposed: report.proposed,
    improvementRatio: report.improvementRatio,
    warnings: report.warnings,
    before: {
      indexUsed: report.before.indexUsed,
      totalDocsExamined: report.before.totalDocsExamined,
      totalKeysExamined: report.before.totalKeysExamined,
      estimatedMillis: report.before.estimatedMillis,
    },
    after: {
      indexUsed: report.after.indexUsed,
      totalDocsExamined: report.after.totalDocsExamined,
      totalKeysExamined: report.after.totalKeysExamined,
      estimatedMillis: report.after.estimatedMillis,
    },
  };

  await writeIndexes(saved);

  return NextResponse.json({
    ok: true,
    report,
    saved,
  });
}
