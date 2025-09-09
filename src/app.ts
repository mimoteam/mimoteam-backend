import express from "express";
import type { Request, Response, RequestHandler } from "express";
import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import compression from "compression";
import responseTime from "response-time";
import path from "path";

import authRoutes from "./auth/auth.routes";
import userRoutes from "./users/users.routes";
import serviceRoutes from "./services/service.routes";
import costRoutes from "./costs/cost.routes";
import paymentRoutes from "./payments/payment.routes";
import availabilityRoutes from "./availability/availability.routes";
import uploadRoutes from "./upload/upload.routes";
// import taskRoutes from "./tasks/task.routes";
// import handoverRoutes from "./handover/handover.routes";
import statusRoutes from "./status/status.routes";

import { ensureUploadDirs, ROOT_UPLOADS } from "./config/uploads";
import { auth } from "./middleware/auth";
import { notFound, errorHandler } from "./middleware/error";
import { env } from "./config/env";

/* ✅ Lightning Lane */
import lanesRouter from "./lightninglanes/ll.routes";

let debugRoutes: any = null;
if (env.NODE_ENV !== "production") {
  try {
    debugRoutes = require("./dev/debug.routes").default;
  } catch {
    debugRoutes = null;
  }
}

const app = express();

/* ===== Ajustes ===== */
app.set("etag", false);
app.set("trust proxy", 1);

/* ===== CORS ===== */
const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const envOrigins = (process.env.CORS_ORIGIN || DEFAULT_ORIGINS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowed = new Set(envOrigins);

/* HOTFIX preflight */
app.use((req, res, next) => {
  if (req.method !== "OPTIONS") return next();
  const origin = (req.headers.origin as string) || "";
  const acrh =
    (req.headers["access-control-request-headers"] as string) ||
    "content-type, authorization";

  const isDevLocal =
    !origin ||
    allowed.has(origin) ||
    origin === "http://localhost:5173" ||
    origin === "http://127.0.0.1:5173" ||
    (process.env.NODE_ENV !== "production" &&
      /^http:\/\/localhost:\d+$/i.test(origin));

  if (isDevLocal) {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD"
    );
    res.setHeader("Access-Control-Allow-Headers", acrh);
    res.setHeader(
      "Vary",
      "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
    );
    return res.status(204).end();
  }
  return res.status(403).json({ message: `Not allowed by CORS: ${origin}` });
});

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
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "X-Idempotency-Key",
  ],
  exposedHeaders: ["Location"],
  optionsSuccessStatus: 204,
  maxAge: 600,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

/* ===== Middlewares ===== */
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

/* Debug de env */
if (process.env.NODE_ENV !== "production") {
  console.log("[env] NODE_ENV:", env.NODE_ENV);
  if (!env.JWT_SECRET) {
    console.warn("[env] ATENÇÃO: JWT_SECRET não definido!");
  } else {
    console.log("[env] JWT_SECRET prefix:", env.JWT_SECRET.slice(0, 8));
  }
}

/* Debug (?debug=1) */
app.use((req, _res, next) => {
  if (req.query.debug === "1" || process.env.DEBUG_REQUESTS === "1") {
    console.log("[DEBUG][REQ]", req.method, req.originalUrl);
    console.log("[DEBUG][QUERY]", req.query);
    if (req.method === "OPTIONS") {
      console.log(
        "[DEBUG][PREFLIGHT] ACRH =",
        req.header("Access-Control-Request-Headers")
      );
    }
  }
  next();
});

/* ===== Uploads estáticos ===== */
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

/* ===== Health ===== */
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* Helper para espelhar rotas em / e /api */
const mirror = (paths: string[], ...handlers: any[]) => {
  paths.forEach((p) => app.use(p, ...handlers));
};

/* ===== Rotas ===== */
mirror(["/auth", "/api/auth"], authRoutes);
mirror(["/users", "/api/users"], userRoutes);
mirror(["/services", "/api/services"], serviceRoutes);
mirror(["/costs", "/api/costs"], costRoutes);

/* 🔧 AQUI ESTAVA O PROBLEMA — precisa INVOCAR o factory */
mirror(["/payments", "/api/payments"], auth(), paymentRoutes);

mirror(["/availability", "/api/availability"], availabilityRoutes);
mirror(["/upload", "/api/upload"], uploadRoutes);
mirror(["/status", "/api/status"], statusRoutes);

/* Lightning Lane */
app.use("/lanes", lanesRouter);
app.use("/api/lanes", lanesRouter);

/* Debug (DEV) */
if (debugRoutes) {
  app.use("/api", debugRoutes);
}

/* NOOP stubs, se quiser manter */
const noopListHandler: RequestHandler = (req: Request, res: Response) => {
  const page = Number((req.query?.page as string) || "1");
  const pageSize = Number((req.query?.pageSize as string) || "50");
  res.json({ items: [], total: 0, page, pageSize, totalPages: 0 });
};

["/api/tasks", "/tasks", "/admin/tasks", "/dashboard/tasks"].forEach((p) =>
  app.get(p, noopListHandler)
);

[
  "/api/handover",
  "/handover",
  "/api/handover-notes",
  "/handover-notes",
  "/api/shift-handover",
  "/shift-handover",
].forEach((p) => app.get(p, noopListHandler));

/* ===== 404 + erro ===== */
app.use(notFound);
app.use(errorHandler);

export default app;
