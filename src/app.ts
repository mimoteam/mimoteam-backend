// src/app.ts
import express, { type Request, type Response, type NextFunction } from "express";
import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import compression from "compression";
import responseTime from "response-time";
import path from "path";

import userRoutes from "./users/user.routes";
import authRoutes from "./auth/auth.routes";
import { servicesRouter } from "./services/service.routes";
import costRoutes from "./costs/cost.routes";
import paymentRoutes from "./payments/payment.routes";
import availabilityRoutes from "./availability/availability.routes";
import { ensureUploadDirs, ROOT_UPLOADS } from "./config/uploads";
import uploadRoutes from "./upload/upload.routes";
import taskRoutes from "./tasks/task.routes";
import handoverRoutes from "./handover/handover.routes";

// ⬇️ use o shim que exporta `auth` (se preferir, troque para o seu middleware real)
import { auth } from "./middleware/auth";

const app = express();

/* Ajustes gerais */
app.set("etag", "strong");
app.set("trust proxy", 1);

/* CORS */
const envOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const allowed = new Set(envOrigins);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowed.has(origin)) return cb(null, true);
    if (
      process.env.NODE_ENV !== "production" &&
      /^http:\/\/localhost:\d+$/i.test(origin)
    ) {
      return cb(null, true);
    }
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
  maxAge: 600,
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

/* Middlewares */
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(compression());
app.use(responseTime());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

/* Uploads estático com cache */
ensureUploadDirs();
app.use(
  "/uploads",
  express.static(path.resolve(ROOT_UPLOADS), {
    etag: true,
    lastModified: true,
    maxAge: "7d",
    immutable: false,
  })
);

/* Rotas públicas */
app.use("/auth", authRoutes);

/* Rotas protegidas / públicas */
app.use("/users", userRoutes);
app.use("/services", servicesRouter);
app.use("/costs", costRoutes);
app.use("/payments", paymentRoutes);
app.use("/availability", availabilityRoutes);
app.use("/upload", uploadRoutes);

/* Rotas que exigem admin */
app.use("/tasks", auth("admin"), taskRoutes);
app.use("/handover", auth("admin"), handoverRoutes);

/* Healthcheck */
app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

/* 404 + handler de erro */
app.use((_req: Request, res: Response) => res.status(404).json({ error: "Not found" }));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  const status = err?.status || 500;
  res.status(status).json({ error: err?.message || "Internal error" });
});

export default app;
