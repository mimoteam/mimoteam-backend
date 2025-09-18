// src/app.ts
import express from "express";
import type { Request, Response, RequestHandler } from "express";
import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import compression from "compression";
import responseTime from "response-time";
import path from "path";
import { randomBytes } from "crypto";

// ✅ use named import para evitar overload mismatch
import {
  sign as jwtSign,
  type Secret as JwtSecret,
  type SignOptions,
  type JwtPayload,
} from "jsonwebtoken";

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

import { ensureUploadDirs } from "./config/uploads";
import { auth } from "./middleware/auth";
import { notFound, errorHandler } from "./middleware/error";
import { env } from "./config/env";

/* ✅ Lightning Lane */
import lanesRouter from "./lightninglanes/ll.routes";

/* ✅ Billing */
import billingRoutes from "./billing/billing.routes";

/* (Opcional) User model para stubs de WebAuthn (vincular usuário pelo username/email) */
import User from "./users/user.model";
import bcrypt from "bcryptjs";

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
      "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    );
    res.setHeader("Access-Control-Allow-Headers", acrh);
    res.setHeader(
      "Vary",
      "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
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

/* 👉 ECO DE ORIGIN (garante header também em respostas de erro) */
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  const isAllowed =
    !!origin &&
    (allowed.has(origin) ||
      (process.env.NODE_ENV !== "production" &&
        /^http:\/\/localhost:\d+$/i.test(origin)));
  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  next();
});

/* ===== Middlewares ===== */
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
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
        req.header("Access-Control-Request-Headers"),
      );
    }
  }
  next();
});

/* ===== Uploads estáticos ===== */
ensureUploadDirs();
app.use(
  "/uploads",
  express.static(path.resolve(process.cwd(), "uploads"), {
    fallthrough: true,
    setHeaders: (res) =>
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable"),
  }),
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

/* payments exigem auth() (já estava assim) */
mirror(["/payments", "/api/payments"], auth(), paymentRoutes);

mirror(["/availability", "/api/availability"], availabilityRoutes);
mirror(["/upload", "/api/upload"], uploadRoutes);
mirror(["/status", "/api/status"], statusRoutes);

/* Lightning Lane */
app.use("/lanes", lanesRouter);
app.use("/api/lanes", lanesRouter);

/* ✅ Billing (espelhado em /billing e /api/billing) */
mirror(["/billing", "/api/billing"], billingRoutes);

/* Debug (DEV) */
if (debugRoutes) {
  app.use("/api", debugRoutes);
}

/* =========================================================
   ✅ WebAuthn DEV Stubs (para eliminar 404 e fluir no front)
   ========================================================= */
const JWT_SECRET: JwtSecret =
  ((env.JWT_SECRET as unknown) as JwtSecret) || "dev-secret";

const signToken = (payload: JwtPayload | string): string => {
  const opts: SignOptions = {
    // garante o tipo correto do expiresIn
    expiresIn:
      (process.env.JWT_EXPIRES_IN as SignOptions["expiresIn"]) || "7d",
  };
  return jwtSign(payload, JWT_SECRET, opts);
};

const toB64Url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const randomChallenge = (len = 32) => toB64Url(randomBytes(len));

const rpIdFromReq = (req: Request) =>
  (process.env.WEBAUTHN_RPID ||
    (req.hostname || "localhost").replace(/:\d+$/, "") ||
    "localhost") as string;

type WAFlow = "login" | "register";
function setWAState(
  res: Response,
  flow: WAFlow,
  username: string,
  challenge: string,
) {
  res.cookie("wa_flow", flow, { sameSite: "lax" });
  res.cookie("wa_user", username || "", { sameSite: "lax" });
  res.cookie("wa_chal", challenge, { sameSite: "lax" });
}
function readWAState(req: Request) {
  const flow = (req.cookies?.wa_flow || "") as WAFlow;
  const username = (req.cookies?.wa_user || "") as string;
  const challenge = (req.cookies?.wa_chal || "") as string;
  return { flow, username, challenge };
}

/* OPTIONS: Login */
app.post("/webauthn/login/options", async (req: Request, res: Response) => {
  const { username } = req.body || {};
  const uname = String(username || "").trim();
  if (!uname) return res.status(400).json({ message: "username required" });

  const challenge = randomChallenge();
  setWAState(res, "login", uname, challenge);

  const rpId = rpIdFromReq(req);
  const options = {
    publicKey: {
      challenge, // string base64url — o front converte p/ ArrayBuffer
      timeout: 60000,
      rpId,
      userVerification: "preferred",
      allowCredentials: [] as Array<{
        id: string;
        type: "public-key";
        transports?: string[];
      }>,
    },
  };
  res.json(options);
});

/* VERIFY: Login (stub) */
app.post("/webauthn/login/verify", async (req: Request, res: Response) => {
  const { username } = readWAState(req);
  if (!username)
    return res.status(400).json({ message: "No pending WebAuthn login" });

  const userDoc =
    (await User.findOne({
      $or: [
        { login: new RegExp(`^${username}$`, "i") },
        { email: new RegExp(`^${username}$`, "i") },
      ],
    })) || null;

  if (!userDoc) {
    return res
      .status(404)
      .json({ message: "User not found for passkey login" });
  }

  const payload = {
    _id: String(userDoc._id),
    id: String(userDoc._id),
    email: userDoc.email,
    fullName: (userDoc as any).fullName || "",
    role: userDoc.role || "partner",
  };
  const token = signToken(payload);
  res.cookie?.("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  const { password, __v, ...safe } =
    (userDoc.toObject ? userDoc.toObject({ virtuals: true }) : userDoc) || {};
  return res.json({ user: safe, token });
});

/* OPTIONS: Register */
app.post("/webauthn/register/options", async (req: Request, res: Response) => {
  const { username, displayName, userId } = req.body || {};
  const uname = String(username || "").trim();
  const dname = String(displayName || uname || "User").trim();
  if (!uname) return res.status(400).json({ message: "username required" });

  const challenge = randomChallenge();
  setWAState(res, "register", uname, challenge);

  const uidRaw = userId ? Buffer.from(String(userId)) : Buffer.from(uname);
  const rpId = rpIdFromReq(req);

  const options = {
    publicKey: {
      challenge, // string base64url; o front converte
      rp: { name: "MIMO Team", id: rpId },
      user: {
        id: toB64Url(uidRaw), // string base64url; o front converte
        name: uname,
        displayName: dname,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      timeout: 60000,
      attestation: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        requireResidentKey: false,
        userVerification: "preferred",
      },
    },
  };

  res.json(options);
});

/* VERIFY: Register (stub) */
app.post("/webauthn/register/verify", async (req: Request, res: Response) => {
  const { username } = readWAState(req);
  const uname = String(username || "").trim();
  if (!uname)
    return res
      .status(400)
      .json({ message: "No pending WebAuthn registration" });

  let userDoc =
    (await User.findOne({
      $or: [
        { login: new RegExp(`^${uname}$`, "i") },
        { email: new RegExp(`^${uname}$`, "i") },
      ],
    })) || null;

  if (!userDoc) {
    const email = uname.includes("@") ? uname : `${uname}@example.local`;
    const passwordHash = await bcrypt.hash(`passkey:${uname}:${Date.now()}`, 8);
    userDoc = await User.create({
      login: uname,
      email,
      fullName: uname,
      role: "partner",
      password: passwordHash,
    });
  }

  const payload = {
    _id: String(userDoc._id),
    id: String(userDoc._id),
    email: userDoc.email,
    fullName: (userDoc as any).fullName || "",
    role: userDoc.role || "partner",
  };
  const token = signToken(payload);

  res.cookie?.("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  const { password, __v, ...safe } =
    (userDoc.toObject ? userDoc.toObject({ virtuals: true }) : userDoc) || {};
  return res.json({ ok: true, user: safe, token });
});

/* NOOP stubs (se quiser manter) */
const noopListHandler: RequestHandler = (req: Request, res: Response) => {
  const page = Number((req.query?.page as string) || "1");
  const pageSize = Number((req.query?.pageSize as string) || "50");
  res.json({ items: [], total: 0, page, pageSize, totalPages: 0 });
};

["/api/tasks", "/tasks", "/admin/tasks", "/dashboard/tasks"].forEach((p) =>
  app.get(p, noopListHandler),
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
