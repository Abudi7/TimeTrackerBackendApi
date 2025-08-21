import { Router } from "express";
import { pool } from "../db";
import { AuthedRequest } from "../middleware/authMiddleware";
import { z } from "zod";
import { validate } from "../middleware/validate";

const router = Router();

const upsertProjectSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(190),
    color: z.string().max(16).optional().nullable(),
  }),
});

// GET /projects - list user's projects
router.get("/", async (req: AuthedRequest, res) => {
  const uid = req.user!.id;
  const [rows] = await pool.query("SELECT id, name, color FROM projects WHERE user_id = ? ORDER BY id DESC", [uid]);
  res.json({ projects: rows });
});

// POST /projects - create
router.post("/", validate(upsertProjectSchema), async (req: AuthedRequest, res) => {
  const uid = req.user!.id;
  const { name, color } = req.body;
  const [r] = await pool.query("INSERT INTO projects (user_id, name, color) VALUES (?, ?, ?)", [uid, name, color || null]);
  // @ts-ignore
  res.json({ id: r.insertId, name, color: color || null });
});

// PUT /projects/:id - update
router.put("/:id", validate(upsertProjectSchema), async (req: AuthedRequest, res) => {
  const uid = req.user!.id;
  const { id } = req.params as any;
  const { name, color } = req.body;
  await pool.query("UPDATE projects SET name=?, color=? WHERE id=? AND user_id=?", [name, color || null, id, uid]);
  res.json({ id: Number(id), name, color: color || null });
});

// DELETE /projects/:id
router.delete("/:id", async (req: AuthedRequest, res) => {
  const uid = req.user!.id;
  const { id } = req.params as any;
  await pool.query("DELETE FROM projects WHERE id=? AND user_id=?", [id, uid]);
  res.json({ ok: true });
});

export default router;
