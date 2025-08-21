import { Router } from "express";
import { pool } from "../db";
import { AuthedRequest } from "../middleware/authMiddleware";
import { z } from "zod";
import { validate } from "../middleware/validate";

const router = Router();

const upsertTagSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100),
    color: z.string().max(16).optional().nullable(),
  }),
});

// GET /tags
router.get("/", async (req: AuthedRequest, res) => {
  const uid = req.user!.id;
  const [rows] = await pool.query("SELECT id, name, color FROM tags WHERE user_id=? ORDER BY name ASC", [uid]);
  res.json({ tags: rows });
});

// POST /tags
router.post("/", validate(upsertTagSchema), async (req: AuthedRequest, res) => {
  const uid = req.user!.id;
  const { name, color } = req.body;
  const [r] = await pool.query("INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)", [uid, name, color || null]);
  // @ts-ignore
  res.json({ id: r.insertId, name, color: color || null });
});

// PUT /tags/:id
router.put("/:id", validate(upsertTagSchema), async (req: AuthedRequest, res) => {
  const uid = req.user!.id;
  const { id } = req.params as any;
  const { name, color } = req.body;
  await pool.query("UPDATE tags SET name=?, color=? WHERE id=? AND user_id=?", [name, color || null, id, uid]);
  res.json({ id: Number(id), name, color: color || null });
});

// DELETE /tags/:id
router.delete("/:id", async (req: AuthedRequest, res) => {
  const uid = req.user!.id;
  const { id } = req.params as any;
  await pool.query("DELETE FROM tags WHERE id=? AND user_id=?", [id, uid]);
  res.json({ ok: true });
});

export default router;
