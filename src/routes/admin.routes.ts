import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { pool } from "../db";
import { authMiddleware, AuthedRequest } from "../middleware/authMiddleware";

const router = Router();
const uploadsDir = path.join(process.cwd(), "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `logo-${Date.now()}${ext.toLowerCase()}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.mimetype);
    cb(null, ok);
  },
});

// GET current logo URL
router.get("/logo", async (_req, res) => {
  const [rows]: any = await pool.query("SELECT logo_path FROM app_settings WHERE id = 1");
  const logoPath = rows?.[0]?.logo_path || null;
  const url = logoPath ? `/uploads/${path.basename(logoPath)}` : "/uploads/logo-default.png";
  res.json({ logoUrl: url });
});

// POST upload logo (protected)
router.post("/logo", authMiddleware, upload.single("file"), async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const fullPath = req.file.path; // e.g., /.../public/uploads/logo-123.webp
  await pool.query("UPDATE app_settings SET logo_path = ? WHERE id = 1", [fullPath]);

  const logoUrl = `/uploads/${req.file.filename}`;
  res.json({ ok: true, logoUrl });
});

export default router;
