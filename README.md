# MongoIndex Coach

Offline teaching tool that **simulates MongoDB `explain()`-style summaries** for a synthetic collection. No live MongoDB required.

## What you get

- Query shape builder (equality / range / sort)
- Example query presets
- ESR-ordered compound index proposal
- Before/after winning plans with docs & keys examined
- Over-indexing warnings (duplicates, prefix redundancy, write tax, low-cardinality leading keys)
- Persists last query + proposal to `data/indexes.json` via `POST /api/coach`

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm test
npm run typecheck
```

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/coach` | Load last saved proposal (if any) |
| `POST` | `/api/coach` | Body `{ "query": { equality, range, sort, projection } }` — coach + persist |

```bash
curl -X POST http://localhost:3000/api/coach \
  -H 'Content-Type: application/json' \
  -d '{"query":{"equality":["tenantId","status"],"range":["createdAt"],"sort":[{"field":"createdAt","dir":-1}],"projection":["_id","status"]}}'
```

## Library

`lib/indexes.ts` exports `proposeIndex`, `simulateExplain`, `coachQuery`, and `overIndexWarnings` (pure simulation — no `mongodb` driver).

## Author

Saeed Rumaneh · MIT License · 2026

## Complete product flows

1. Click an **Example** preset — before/after cost and winning plans update immediately.
2. Click **Save proposal** — query + index land in `data/indexes.json`.
3. Reload and **Load last** — restored shape shows the same before/after cost comparison.
