import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "path";

import authRoutes from "./routes/auth.routes";
import timeRoutes from "./routes/time.routes";
import projectsRoutes from "./routes/projects.routes";
import tagsRoutes from "./routes/tags.routes";
import adminRoutes from "./routes/admin.routes";
import { authMiddleware } from "./middleware/authMiddleware";
import profileRoutes from "./routes/profile.routes";
import userRoutes from "./routes/user.routes";

dotenv.config();

const app = express();
app.set('trust proxy', 1); // ✅ مهم على Railway

const PORT = process.env.PORT || 4000;

app.use(morgan("dev"));
app.use(express.json());

app.use(cors({
  origin: (process.env.FRONTEND_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
            .split(",")
            .map(s => s.trim()),
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));

app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// ملفات ثابتة
const publicDir = path.join(process.cwd(), "public");
app.use("/uploads", express.static(path.join(publicDir, "uploads")));
app.use(express.static(publicDir));

// Rate limits
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use(generalLimiter);
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { message: "Too many login attempts. Try again later." },
});

// Routes
app.get('/', (_req, res) => res.json({ app: 'TimeTrackerBackendApi', status: 'ok' })); // ✅
app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/profile", profileRoutes);
app.use("/user", authMiddleware, userRoutes);

app.use("/auth",
  (req, res, next) => (req.path === "/login" ? loginLimiter(req, res, next) : next()),
  authRoutes
);

app.use("/time", authMiddleware, timeRoutes);
app.use("/projects", authMiddleware, projectsRoutes);
app.use("/tags", authMiddleware, tagsRoutes);
app.use("/admin", adminRoutes);

app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
});
