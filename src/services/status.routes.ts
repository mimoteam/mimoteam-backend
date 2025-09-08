// src/status/status.routes.ts
import { Router, type Request } from "express";

export const STATUS_VALUES = [
  "pending",
  "waiting to approve",
  "denied",
  "paid",
  "recorded", // legado/compat
] as const;

const STATUS_TITLES: Record<string, string> = Object.fromEntries(
  STATUS_VALUES.map((s) => [s, s.replace(/\b\w/g, (c) => c.toUpperCase())])
);

function normalizeStatus(v?: string): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "pending";
  if (["waiting to approve", "waiting for approval", "shared", "waiting"].includes(s)) return "waiting to approve";
  if (["denied", "rejected", "recusado"].includes(s)) return "denied";
  if (["paid", "pago"].includes(s)) return "paid";
  if (["pending", "pendente"].includes(s)) return "pending";
  if (["recorded", "rec"].includes(s)) return "recorded";
  return s;
}

// Converte qualquer coisa do req.query[key] em string | undefined
function qsFirstString(req: Request, key: string): string | undefined {
  const v = (req.query as Record<string, unknown>)[key];
  if (v == null) return undefined;
  if (Array.isArray(v)) return String(v[0]);
  return typeof v === "string" ? v : String(v);
}

const router = Router();

// GET /status  -> lista canônica
router.get("/status", (_req, res) => {
  res.json({ items: STATUS_VALUES });
});

// GET /status/normalize?value=Shared -> { value, normalized, title }
router.get("/status/normalize", (req, res) => {
  const raw = qsFirstString(req, "value"); // string | undefined
  const normalized = normalizeStatus(raw);
  res.json({ value: raw, normalized, title: STATUS_TITLES[normalized] ?? normalized });
});

export default router;
