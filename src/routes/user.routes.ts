import { Router } from "express";
import { pool } from "../db";
import multer from "multer";
import bcrypt from "bcrypt";
import { authMiddleware, AuthedRequest } from "../middleware/authMiddleware";

const router = Router();

// إعداد رفع الملفات (avatars)
const upload = multer({
  dest: "public/uploads/avatars",
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

// GET /user/me
router.get("/me", authMiddleware, async (req: any, res, next) => {
  try {
    const [rows]: any = await pool.query(
      "SELECT id, email, full_name, avatar_path, role FROM users WHERE id = ?",
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /user/update
router.put("/update", authMiddleware, upload.single("avatar"), async (req: any, res, next) => {
  try {
    const { fullName, password, confirmPassword } = req.body;
    let avatar_path: string | undefined;

    if (req.file) {
      avatar_path = "/uploads/avatars/" + req.file.filename;
    }

    if (password && password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    let query = "UPDATE users SET ";
    const fields: any[] = [];
    const params: any[] = [];

    if (fullName) {
      fields.push("full_name = ?");
      params.push(fullName);
    }
    if (avatar_path) {
      fields.push("avatar_path = ?");
      params.push(avatar_path);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push("password_hash = ?");
      params.push(hash);
    }

    if (fields.length === 0) {
      return res.json({ message: "Nothing to update" });
    }

    query += fields.join(", ") + " WHERE id = ?";
    params.push(req.user.id);

    await pool.query(query, params);

    res.json({ message: "Profile updated successfully" });
  } catch (err) {
    next(err);
  }
});

export default router;
