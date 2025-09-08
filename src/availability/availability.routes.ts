// src/availability/availability.routes.ts
type AvRow = { date: string; state: "busy" | "unavailable"; by?: "admin" | "partner" | "unknown" };

import { Router } from "express";
import { Availability } from "./availability.model";
import { Types } from "mongoose";

const router = Router();

/* ===== helpers ===== */
const isYmd = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const PROJ = { _id: 0, date: 1, state: 1, by: 1 } as const;

/** Descobre o tipo real do campo partnerId no schema (String | ObjectId) e normaliza o valor */
function resolvePartnerId(raw: string) {
  const path: any = (Availability as any).schema?.path?.("partnerId");
  const instance = String(path?.instance || "").toLowerCase();
  if (instance === "objectid") {
    if (!Types.ObjectId.isValid(raw)) return null;
    return new Types.ObjectId(raw);
  }
  const s = String(raw || "").trim();
  return s || null;
}

/* =========================================================================
GET /availability?partnerId=&dateFrom=&dateTo=
— usa o driver nativo para evitar cast no campo "date" (String com $gte/$lte)
========================================================================= */
router.get("/", async (req, res) => {
  try {
    const q = req.query as Record<string, any>;
    const partnerIdRaw = String(q.partnerId || "");
    const from = String(q.dateFrom || "");
    const to   = String(q.dateTo   || "");

    if (!partnerIdRaw || !isYmd(from) || !isYmd(to)) {
      return res.status(400).json({ message: "partnerId, dateFrom e dateTo são obrigatórios (YYYY-MM-DD)" });
    }

    const pid = resolvePartnerId(partnerIdRaw);
    if (!pid) return res.status(400).json({ message: "Invalid partnerId" });

    const rows = await (Availability as any).collection
      .find({ partnerId: pid, date: { $gte: from, $lte: to } }, { projection: PROJ })
      .sort({ date: 1 })
      .toArray();

    return res.json(rows || []);
  } catch (err: any) {
    console.error("GET /availability error:", err?.message);
    // se preferir fail-open:
    // return res.json([]);
    return res.status(500).json({ error: "list_failed", message: err?.message || "unknown" });
  }
});

/* =========================================================================
PATCH /availability/:date
— operações sem operadores em "date" podem usar Mongoose normalmente
========================================================================= */
router.patch("/:date", async (req, res) => {
  try {
    const date = String(req.params?.date || "");
    const body = (req.body ?? {}) as Record<string, any>;

    const partnerIdRaw = String(body.partnerId || "");
    const state = String(body.state || "").toLowerCase();
    const actor: "admin" | "partner" =
      String(body.actor || "partner").toLowerCase() === "admin" ? "admin" : "partner";

    if (!partnerIdRaw) return res.status(400).json({ error: "partnerId is required" });
    if (!isYmd(date))   return res.status(400).json({ error: "Invalid date (YYYY-MM-DD)" });
    if (!["available", "unavailable", "busy"].includes(state)) {
      return res.status(400).json({ error: "state must be available|unavailable|busy" });
    }

    // normaliza partnerId conforme o tipo do schema
    const path: any = (Availability as any).schema?.path?.("partnerId");
    const instance = String(path?.instance || "").toLowerCase();

    const mkPid = (raw: string) => {
      if (instance === "objectid") {
        if (!Types.ObjectId.isValid(raw)) throw new Error("Invalid partnerId");
        const oid = new Types.ObjectId(raw);
        return { filter: { partnerId: oid }, value: oid };
      }
      const s = String(raw || "").trim();
      if (!s) throw new Error("Invalid partnerId");
      return { filter: { partnerId: s }, value: s };
    };

    const { filter, value } = mkPid(partnerIdRaw);

    // se já está busy, partner não pode liberar
    const existing = await (Availability as any)
      .findOne({ ...filter, date }, { _id: 0, date: 1, state: 1, by: 1 })
      .lean();

    if (actor === "partner" && existing?.state === "busy") {
      return res.json({ date, state: "busy", by: existing.by || "admin", unchanged: true });
    }

    if (state === "available") {
      await (Availability as any).deleteMany({ ...filter, date });
      return res.json({ date, state: "available" });
    }

    await (Availability as any).updateOne(
      { ...filter, date },
      { $set: { partnerId: value, date, state: state as "busy" | "unavailable", by: actor } },
      { upsert: true }
    );

    return res.json({ date, state, by: actor });
  } catch (e: any) {
    console.error("PATCH /availability failed:", e?.message);
    return res.status(500).json({ error: "patch_failed", message: e?.message || "unknown" });
  }
});

/* =========================================================================
POST /availability/bulk
— gera lista de dias (UTC) e checa "busy" via driver nativo (date: {$in: [...]})
========================================================================= */
router.post("/bulk", async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, any>;
    const partnerIdRaw = String(b.partnerId || "");
    const from = String(b.from || "");
    const to   = String(b.to   || "");
    const state = String(b.state || "").toLowerCase(); // "available" | "unavailable"
    const actor: "admin" | "partner" =
      String(b.actor || "partner").toLowerCase() === "admin" ? "admin" : "partner";
    const weekdays: number[] = Array.isArray(b.weekdays)
      ? b.weekdays.map((n:any) => Number(n)).filter((n:number) => Number.isInteger(n) && n>=0 && n<=6)
      : [];

    if (!partnerIdRaw) return res.status(400).json({ error: "partnerId is required" });
    if (!isYmd(from) || !isYmd(to)) return res.status(400).json({ error: "from/to must be YYYY-MM-DD" });
    if (!["available","unavailable"].includes(state)) {
      return res.status(400).json({ error: "state must be available|unavailable" });
    }

    // partnerId normalizado
    const pid = resolvePartnerId(partnerIdRaw);
    if (!pid) return res.status(400).json({ error: "Invalid partnerId" });

    // gera chaves YYYY-MM-DD (UTC) deduplicadas dentro do range + weekdays
    const d1 = new Date(from), d2 = new Date(to);
    if (Number.isNaN(+d1) || Number.isNaN(+d2) || d1 > d2) {
      return res.status(400).json({ error: "Invalid date range" });
    }
    const toKeyUTC = (d: Date) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth()+1).padStart(2,'0');
      const da= String(d.getUTCDate()).padStart(2,'0');
      return `${y}-${m}-${da}`;
    };

    const seen = new Set<string>();
    const keys: string[] = [];
    const cur = new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate()));
    const end = new Date(Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth(), d2.getUTCDate()));
    while (cur <= end) {
      const dow = cur.getUTCDay();
      if (!weekdays.length || weekdays.includes(dow)) {
        const k = toKeyUTC(cur);
        if (!seen.has(k)) { seen.add(k); keys.push(k); }
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (!keys.length) return res.json({ upserts: 0, deleted: 0, skippedBusy: 0 });

    // partner não sobrescreve dias busy — checa via driver nativo (evita cast do Mongoose)
    let busySet = new Set<string>();
    if (actor === "partner") {
      const busyRows: { date: string }[] = await (Availability as any).collection
        .find({ partnerId: pid, state: "busy", date: { $in: keys } }, { projection: { _id: 0, date: 1 } })
        .toArray();
      busySet = new Set(busyRows.map(r => r.date));
    }

    // monta operações únicas por dia
    const ops: any[] = [];
    let upserts = 0, deleted = 0, skippedBusy = 0;

    for (const k of keys) {
      if (actor === "partner" && busySet.has(k)) { skippedBusy++; continue; }

      if (state === "available") {
        ops.push({ deleteOne: { filter: { partnerId: pid, date: k } } });
        deleted++;
      } else {
        ops.push({
          updateOne: {
            filter: { partnerId: pid, date: k },
            update: { $set: { partnerId: pid, date: k, state: "unavailable", by: actor } },
            upsert: true,
          }
        });
        upserts++;
      }
    }

    if (!ops.length) return res.json({ upserts, deleted, skippedBusy });

    // ordered:true evita colisão interna caso a mesma chave apareça 2x por algum motivo
    await (Availability as any).bulkWrite(ops, { ordered: true });

    return res.json({ upserts, deleted, skippedBusy });
  } catch (e:any) {
    console.error("POST /availability/bulk error:", e?.message);
    return res.status(500).json({ error: "bulk_failed", message: e?.message || "unknown" });
  }
});

export default router;
