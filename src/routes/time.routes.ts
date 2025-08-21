// server/src/routes/time.routes.ts
// Time tracking routes:
// - Store timestamps in UTC
// - Compute "today" and history by user's local day using offsetMinutes
// - Start/End support project_id, note, and tags[]
// - List entries with project info and tags

import { Router } from "express";
import { pool } from "../db";
import { AuthedRequest } from "../middleware/authMiddleware";
import { RowDataPacket } from "mysql2";
import { z } from "zod";
import { validate } from "../middleware/validate";

const router = Router();

/* ------------------------- helpers & validation ------------------------- */

// Clamp offsetMinutes to +/- 24h and coerce to integer
function getOffsetMinutes(q: any): number {
  const n = Number(q?.offsetMinutes);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-24 * 60, Math.min(24 * 60, Math.trunc(n)));
}

// Validate body for /start
const startSchema = z.object({
  body: z.object({
    project_id: z.number().int().positive().optional().nullable(),
    note: z.string().max(2000).optional().nullable(),
    tags: z.array(z.number().int().positive()).optional().default([]),
  }),
});

// Validate body for /end
const endSchema = z.object({
  body: z.object({
    project_id: z.number().int().positive().optional().nullable(),
    note: z.string().max(2000).optional().nullable(),
    tags: z.array(z.number().int().positive()).optional().default([]),
  }),
});

// Ensure project (if provided) belongs to the current user
async function assertProjectOwnership(userId: number, projectId: number | null | undefined) {
  if (projectId == null) return;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM projects WHERE id = ? AND user_id = ?",
    [projectId, userId]
  );
  if ((rows as any[]).length === 0) {
    const err: any = new Error("Project not found or not yours");
    err.status = 400;
    throw err;
  }
}

// Ensure all tags (if provided) belong to the current user; return sanitized list
async function assertTagsOwnership(
  userId: number,
  tagIds: number[] | undefined
): Promise<number[]> {
  if (!Array.isArray(tagIds) || tagIds.length === 0) return [];
  const unique = Array.from(new Set(tagIds));
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM tags WHERE user_id = ? AND id IN (?)",
    [userId, unique]
  );
  const foundIds = (rows as any[]).map((r: any) => r.id);
  if (foundIds.length !== unique.length) {
    const err: any = new Error("One or more tags not found or not yours");
    err.status = 400;
    throw err;
  }
  return unique;
}

/* --------------------------------- routes -------------------------------- */

// POST /time/start
// Create an open entry at current UTC time. Optionally set project_id, note, and tags[].
router.post("/start", validate(startSchema), async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { project_id, note, tags } = req.body as {
    project_id?: number | null;
    note?: string | null;
    tags?: number[];
  };

  // Prevent double running
  const [open] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM time_entries WHERE user_id = ? AND end_at IS NULL",
    [userId]
  );
  if ((open as any[]).length > 0) {
    return res.status(400).json({ message: "Already running" });
  }

  // Ownership checks (if provided)
  await assertProjectOwnership(userId, project_id ?? null);
  const cleanTags = await assertTagsOwnership(userId, tags);

  // Insert entry in UTC
  const [ins] = await pool.query<any>(
    "INSERT INTO time_entries (user_id, start_at, project_id, note) VALUES (?, UTC_TIMESTAMP(), ?, ?)",
    [userId, project_id ?? null, note ?? null]
  );
  const entryId = ins.insertId as number;

  // Attach tags, if any
  if (cleanTags.length) {
    const values = cleanTags.map((tid) => [entryId, tid]);
    await pool.query("INSERT IGNORE INTO time_entry_tags (entry_id, tag_id) VALUES ?", [values]);
  }

  return res.json({ message: "Started", entryId });
});

// POST /time/end
// Close the current open entry; optionally update project_id/note/tags before closing.
router.post("/end", validate(endSchema), async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const { project_id, note, tags } = req.body as {
    project_id?: number | null;
    note?: string | null;
    tags?: number[];
  };

  // Find open entry
  const [open] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM time_entries WHERE user_id = ? AND end_at IS NULL ORDER BY id DESC LIMIT 1",
    [userId]
  );
  const current = (open as any[])[0];
  if (!current) return res.status(400).json({ message: "No running entry" });

  // Ownership checks (if provided)
  await assertProjectOwnership(userId, project_id ?? null);
  const cleanTags = await assertTagsOwnership(userId, tags);

  // Update optional fields before closing
  if (project_id !== undefined || note !== undefined) {
    await pool.query("UPDATE time_entries SET project_id = ?, note = ? WHERE id = ?", [
      project_id ?? null,
      note ?? null,
      current.id,
    ]);
  }

  // Replace tags if provided
  if (Array.isArray(tags)) {
    await pool.query("DELETE FROM time_entry_tags WHERE entry_id = ?", [current.id]);
    if (cleanTags.length) {
      const values = cleanTags.map((tid) => [current.id, tid]);
      await pool.query("INSERT IGNORE INTO time_entry_tags (entry_id, tag_id) VALUES ?", [
        values,
      ]);
    }
  }

  // Close entry with UTC end_at
  await pool.query("UPDATE time_entries SET end_at = UTC_TIMESTAMP() WHERE id = ?", [current.id]);

  // Return duration in seconds
  const [row] = await pool.query<RowDataPacket[]>(
    "SELECT TIMESTAMPDIFF(SECOND, start_at, end_at) AS seconds FROM time_entries WHERE id = ?",
    [current.id]
  );
  const seconds = (row as any[])[0]?.seconds ?? null;

  return res.json({ message: "Stopped", seconds, entryId: current.id });
});

// GET /time/today
// Sum durations for entries whose LOCAL DATE(start_at + offset) equals LOCAL DATE(now + offset)
router.get("/today", async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const offsetMinutes = getOffsetMinutes(req.query);

  const [totalRows] = await pool.query<RowDataPacket[]>(
    `
    SELECT COALESCE(SUM(
      TIMESTAMPDIFF(SECOND, start_at, IFNULL(end_at, UTC_TIMESTAMP()))
    ), 0) AS total_seconds
    FROM time_entries
    WHERE user_id = ?
      AND DATE(ADDTIME(start_at, SEC_TO_TIME(?*60)))
          = DATE(ADDTIME(UTC_TIMESTAMP(), SEC_TO_TIME(?*60)))
    `,
    [userId, offsetMinutes, offsetMinutes]
  );

  const [openRows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM time_entries WHERE user_id = ? AND end_at IS NULL LIMIT 1",
    [userId]
  );

  return res.json({
    total_seconds: Number((totalRows as any[])[0]?.total_seconds ?? 0),
    running: !!(openRows as any[])[0],
  });
});

// GET /time/history?days=60
// Group totals by LOCAL DATE(start_at + offset) for the last N days
router.get("/history", async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const offsetMinutes = getOffsetMinutes(req.query);
  const limitDays = Math.min(parseInt((req.query.days as string) || "60", 10), 365);

  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      DATE(ADDTIME(start_at, SEC_TO_TIME(?*60))) AS day,
      COALESCE(SUM(TIMESTAMPDIFF(SECOND, start_at, IFNULL(end_at, UTC_TIMESTAMP()))), 0) AS total_seconds
    FROM time_entries
    WHERE user_id = ?
      AND start_at >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
    GROUP BY DATE(ADDTIME(start_at, SEC_TO_TIME(?*60)))
    ORDER BY day DESC
    `,
    [offsetMinutes, userId, limitDays, offsetMinutes]
  );

  const history = (rows as any[]).map((r) => ({
    day: r.day, // YYYY-MM-DD (local)
    total_seconds: Number(r.total_seconds),
  }));

  return res.json({ history });
});

// GET /time/entries
// Return last 200 entries with project info and tags
router.get("/entries", async (req: AuthedRequest, res) => {
  const userId = req.user!.id;

  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT te.id, te.start_at, te.end_at, te.note, te.project_id,
           p.name AS project_name, p.color AS project_color
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    WHERE te.user_id = ?
    ORDER BY te.start_at DESC
    LIMIT 200
    `,
    [userId]
  );

  const base = rows as any[];
  const ids = base.map((r) => r.id);
  let tagsMap: Record<number, { id: number; name: string; color: string | null }[]> = {};

  if (ids.length) {
    const [tagRows] = await pool.query<RowDataPacket[]>(
      `
      SELECT tet.entry_id, t.id, t.name, t.color
      FROM time_entry_tags tet
      JOIN tags t ON t.id = tet.tag_id
      WHERE tet.entry_id IN (?)
      `,
      [ids]
    );
    for (const tr of tagRows as any[]) {
      tagsMap[tr.entry_id] = tagsMap[tr.entry_id] || [];
      tagsMap[tr.entry_id].push({ id: tr.id, name: tr.name, color: tr.color });
    }
  }

  const entries = base.map((r) => ({
    id: r.id,
    start_at: r.start_at,
    end_at: r.end_at,
    note: r.note,
    project_id: r.project_id,
    project_name: r.project_name,
    project_color: r.project_color,
    tags: tagsMap[r.id] || [],
  }));

  return res.json({ entries });
});

export default router;
