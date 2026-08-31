/**
 * Persist last MongoIndex coach query + proposal under data/indexes.json.
 * Server-only.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CoachReport, QueryShape } from "./indexes";

export type IndexesFile = {
  savedAt: string;
  query: QueryShape;
  proposed: CoachReport["proposed"];
  improvementRatio: number;
  warnings: string[];
  before: {
    indexUsed: string | null;
    totalDocsExamined: number;
    totalKeysExamined: number;
    estimatedMillis: number;
  };
  after: {
    indexUsed: string | null;
    totalDocsExamined: number;
    totalKeysExamined: number;
    estimatedMillis: number;
  };
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "indexes.json");

export async function readIndexes(): Promise<IndexesFile | null> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    return JSON.parse(raw) as IndexesFile;
  } catch {
    return null;
  }
}

export async function writeIndexes(data: IndexesFile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}
