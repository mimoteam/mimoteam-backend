// backend/src/availability/availability.routes.ts
import { Router } from "express";
import { Availability } from "./availability.model";

const router = Router();

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * GET /availability?partnerId=...&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 * Retorna apenas dias != 'available'
 */
router.get("/", async (req, res, next) => {
  try {
    const partnerId = String(req.query.partnerId || "");
    const dateFrom = String(req.query.dateFrom || "");
    const dateTo = String(req.query.dateTo || "");

    if (!partnerId) return res.status(400).json({ error: "partnerId is required" });
    if (!isYmd(dateFrom) || !isYmd(dateTo)) {
      return res.status(400).json({ error: "dateFrom/dateTo must be YYYY-MM-DD" });
    }

    const items = await Availability.find({
      partnerId,
      date: { $gte: dateFrom, $lte: dateTo },
    })
      .sort({ date: 1 })
      .lean();

    res.json({
      items: items.map((d) => ({
        date: d.date,
        state: d.state,
        by: d.by,
      })),
      total: items.length,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /availability/:date
 * body: { partnerId, state: 'available'|'unavailable'|'busy', actor: 'admin'|'partner' }
 * - 'available' => apaga o registro (estado implícito)
 * - parceiro não consegue sobrescrever 'busy'
 */
router.patch("/:date", async (req, res, next) => {
  try {
    const date = String(req.params.date || "");
    const partnerId = String(req.body?.partnerId || "");
    const state = String(req.body?.state || "");
    const actor = (String(req.body?.actor || "partner").toLowerCase() === "admin" ? "admin" : "partner") as "admin"|"partner";

    if (!partnerId) return res.status(400).json({ error: "partnerId is required" });
    if (!isYmd(date)) return res.status(400).json({ error: "Invalid date (YYYY-MM-DD)" });
    if (!["available", "unavailable", "busy"].includes(state)) {
      return res.status(400).json({ error: "state must be available|unavailable|busy" });
    }

    const existing = await Availability.findOne({ partnerId, date }).lean();

    // parceiro não muda um dia já 'busy'
    if (actor === "partner" && existing?.state === "busy") {
      return res.json({ date, state: "busy", by: existing.by, unchanged: true });
    }

    if (state === "available") {
      await Availability.deleteOne({ partnerId, date });
      return res.json({ date, state: "available" });
    }

    const updated = await Availability.findOneAndUpdate(
      { partnerId, date },
      { $set: { partnerId, date, state, by: actor } },
      { new: true, upsert: true }
    ).lean();

    res.json({ date: updated!.date, state: updated!.state, by: updated!.by });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /availability/bulk
 * body: { partnerId, from, to, weekdays?: number[], state: 'available'|'unavailable', actor: 'admin'|'partner' }
 * - aplica apenas em dias do range (e weekdays se passado)
 * - parceiro não sobrescreve 'busy'
 */
router.post("/bulk", async (req, res, next) => {
  try {
    const partnerId = String(req.body?.partnerId || "");
    const from = String(req.body?.from || "");
    const to = String(req.body?.to || "");
    const state = String(req.body?.state || "");
    const actor = (String(req.body?.actor || "partner").toLowerCase() === "admin" ? "admin" : "partner") as "admin"|"partner";
    const weekdays: number[] = Array.isArray(req.body?.weekdays) ? req.body.weekdays.map((n: any) => Number(n)) : [];

    if (!partnerId) return res.status(400).json({ error: "partnerId is required" });
    if (!isYmd(from) || !isYmd(to)) return res.status(400).json({ error: "from/to must be YYYY-MM-DD" });
    if (!["available", "unavailable"].includes(state)) {
      return res.status(400).json({ error: "state must be available|unavailable" });
    }

    const d1 = new Date(from);
    const d2 = new Date(to);
    if (Number.isNaN(+d1) || Number.isNaN(+d2) || d1 > d2) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    // carrega existentes no range para evitar sobrescrever busy
    const existing = await Availability.find({
      partnerId,
      date: { $gte: from, $lte: to },
    }).lean();
    const map = new Map(existing.map((e) => [e.date, e]));

    let upserts = 0, deleted = 0, skippedBusy = 0;

    const cur = new Date(d1);
    while (cur <= d2) {
      const dayKey = cur.toISOString().slice(0, 10);
      const dow = cur.getDay();
      if (!weekdays.length || weekdays.includes(dow)) {
        const ex = map.get(dayKey);

        // parceiro não mexe em 'busy'
        if (actor === "partner" && ex?.state === "busy") {
          skippedBusy++;
        } else if (state === "available") {
          if (ex) {
            await Availability.deleteOne({ partnerId, date: dayKey });
            deleted++;
          }
        } else {
          // state === 'unavailable'
          await Availability.updateOne(
            { partnerId, date: dayKey },
            { $set: { partnerId, date: dayKey, state: "unavailable", by: actor } },
            { upsert: true }
          );
          upserts++;
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    res.json({ upserts, deleted, skippedBusy });
  } catch (e) {
    next(e);
  }
});

export default router;
