// server/src/routes/profile.routes.ts
import { Router } from "express";
import { pool } from "../db";
import { authMiddleware, AuthedRequest } from "../middleware/authMiddleware";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

// مجلد الرفع للأفاتارات
const uploadsDir = path.join(process.cwd(), "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `avatar-${Date.now()}${ext.toLowerCase()}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (_req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.mimetype);
    cb(null, ok);
  },
});

// util: حوّل مسار DB إلى URL نسبي
function toUrl(p?: string | null) {
  if (!p) return "/uploads/avatar-default.png";
  return `/uploads/${path.basename(p)}`;
}

// GET /profile → اسم + أفاتار
router.get("/", authMiddleware, async (req: AuthedRequest, res) => {
  const uid = req.user!.id;
  const [rows]: any = await pool.query(
    "SELECT email, full_name, avatar_path FROM users WHERE id=?",
    [uid]
  );
  const u = rows?.[0];
  if (!u) return res.status(404).json({ message: "User not found" });

  res.json({
    email: u.email,
    fullName: u.full_name,
    avatarUrl: toUrl(u.avatar_path),
  });
});

// PUT /profile → تحديث الاسم
const updateSchema = z.object({
  body: z.object({
    fullName: z.string().min(3).max(190),
  }),
});
router.put("/", authMiddleware, async (req: AuthedRequest, res) => {
  const parse = updateSchema.safeParse({ body: req.body });
  if (!parse.success) return res.status(400).json({ message: "Invalid input" });

  const uid = req.user!.id;
  const { fullName } = parse.data.body;
  await pool.query("UPDATE users SET full_name=? WHERE id=?", [fullName, uid]);

  res.json({ ok: true, fullName });
});

// POST /profile/avatar → رفع صورة
router.post("/avatar", authMiddleware, upload.single("file"), async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const uid = req.user!.id;
  const fullPath = req.file.path; // /.../public/uploads/avatar-xxxx.png
  await pool.query("UPDATE users SET avatar_path=? WHERE id=?", [fullPath, uid]);

  res.json({ ok: true, avatarUrl: `/uploads/${req.file.filename}` });
});

export default router;
