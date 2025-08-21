// server/src/routes/auth.routes.ts
import { Router } from "express";
import { pool } from "../db";
import { z } from "zod";
import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import { hashPassword, verifyPassword, signToken } from "../auth";

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ===== Schemas =====
const registerSchema = z.object({
  body: z.object({
    email: z.string().email().max(190),
    password: z.string().min(6).max(100),
    fullName: z.string().min(3).max(190),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

// ===== Register (role = 'user', avatar_path default) =====
router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse({ body: req.body });
  if (!parsed.success) return res.status(400).json({ message: "Invalid input" });

  const { email, password, fullName } = parsed.data.body;

  const [dup] = await pool.query("SELECT id FROM users WHERE email=?", [email]);
  if ((dup as any[]).length) return res.status(409).json({ message: "Email exists" });

  const password_hash = await hashPassword(password);
  const defaultAvatar = "uploads/avatar-default.png"; // محفوظ تحت public

  await pool.query(
    "INSERT INTO users (email, password_hash, full_name, role, avatar_path) VALUES (?, ?, ?, 'user', ?)",
    [email, password_hash, fullName, defaultAvatar]
  );

  res.json({ message: "Registered" });
});

// ===== Login =====
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse({ body: req.body });
  if (!parsed.success) return res.status(400).json({ message: "Invalid input" });

  const { email, password } = parsed.data.body;

  const [rows] = await pool.query(
    "SELECT id, password_hash, role FROM users WHERE email=?",
    [email]
  );
  const u = (rows as any[])[0];
  if (!u) return res.status(401).json({ message: "Invalid credentials" });

  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });

  const token = signToken({ id: u.id, email, role: u.role });
  res.json({ token });
});

// ===== Google OAuth (verify idToken) =====
router.post("/google", async (req, res, next) => {
  try {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) return res.status(400).json({ message: "idToken is required" });

    // MUST match your Google OAuth Client ID exactly
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(401).json({ message: "Invalid Google token" });
    }

    const email = payload.email;
    const fullName = payload.name || "";
    const googlePicture = payload.picture as string | undefined;

    const [rows]: any = await pool.query(
      "SELECT id, role FROM users WHERE email=?",
      [email]
    );

    let id: number;
    let role: "user" | "admin" = "user";

    if (!rows.length) {
      // مستخدم جديد بجوجل → خزّن role=user و avatar (صورة جوجل إن وُجدت، وإلا الافتراضي)
      const defaultAvatar = "uploads/avatar-default.png";
      const tempHash = await bcrypt.hash(Math.random().toString(36), 10);
      const [ins]: any = await pool.query(
        "INSERT INTO users (email, password_hash, full_name, role, avatar_path) VALUES (?, ?, ?, 'user', ?)",
        [email, tempHash, fullName, googlePicture || defaultAvatar]
      );
      id = ins.insertId;
    } else {
      id = rows[0].id;
      role = rows[0].role;
    }

    const token = signToken({ id, email, role });
    res.json({ token });
  } catch (e) {
    next(e);
  }
});

export default router;
