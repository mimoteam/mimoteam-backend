// src/payments/payment.routes.ts
import { Router, Request, Response } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import Payment from "./payment.model";
import { Service } from "../services/service.model";
import { auth } from "../middleware/auth";

const router = Router();
const ROUTER_TAG = "payments-router v2025-09-07-raw-in";

/* ========= Mongoose debug (DEV) ========= */
if (process.env.NODE_ENV !== "production") {
  mongoose.set("debug", (coll, method, query, doc, options) => {
    console.log(`[MONGOOSE] ${coll}.${method}`, { query, doc, options });
  });
}

/* ========= helpers ========= */
const normalizePayment = (d: any) => {
  const { _id, serviceIds, notesLog, partnerId, partner, ...rest } = d || {};

  const pid =
    partnerId ? String(partnerId)
    : partner?.id ? String(partner.id)
    : partner?._id ? String(partner._id)
    : "";

  const pname =
    (d as any).partnerName ||
    partner?.fullName ||
    partner?.name ||
    partner?.login ||
    "";

  return {
    id: String(_id),
    ...rest,
    partnerId: pid,
    partnerName: pname,
    serviceIds: Array.isArray(serviceIds) ? serviceIds.map((x: any) => String(x)) : [],
    notesLog: Array.isArray(notesLog) ? notesLog : [],
  };
};

const newNoteId = () =>
  (crypto as any)?.randomUUID?.() || new mongoose.Types.ObjectId().toString();

function isDebug(q: any) {
  const v = String(q?.debug ?? "").toLowerCase();
  return v === "1" || v === "true";
}

const isValidObjectId = (v: any) => mongoose.isValidObjectId(String(v));
function startOfDayUTC(dt: Date) { const d = new Date(dt); d.setUTCHours(0,0,0,0); return d; }
function endOfDayUTC(dt: Date)   { const d = new Date(dt); d.setUTCHours(23,59,59,999); return d; }

function weekKeyFromStart(weekStartIso?: string | null) {
  if (!weekStartIso) return null;
  const start = new Date(String(weekStartIso));
  const y = start.getUTCFullYear();
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const diffDays = Math.floor((start.getTime() - jan1.getTime()) / 86400000);
  const wk = Math.ceil((diffDays + 1 + jan1.getUTCDay()) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

async function recalcTotal(paymentId: string) {
  const p = await Payment.findById(paymentId).lean();
  if (!p) return null;
  const idsStr = (p.serviceIds || []).map(String);
  const objIds = idsStr.filter(isValidObjectId).map(id => new mongoose.Types.ObjectId(id));

  // Driver nativo: inclui ambos os tipos no $in (string + ObjectId)
  const query: any = { _id: { $in: [...objIds, ...idsStr] } };
  const projection = { finalValue: 1 };

  const cursor = Service.collection.find(query, { projection });
  const services = await cursor.toArray();
  const total = services.reduce((acc, s: any) => acc + Number(s.finalValue || 0), 0);

  await Payment.findByIdAndUpdate(paymentId, { $set: { total } });
  return total;
}

/* ========= período ========= */
const monthToIso = (ym: string) => {
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) return null;
  const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const to   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return { fromIso: from.toISOString(), toIso: to.toISOString(), from, to };
};

function addPeriodFilter(base: Record<string, any>, opts: { month?: string; from?: string; to?: string }) {
  let fromIso: string | undefined;
  let toIso: string | undefined;
  let fromDt: Date | undefined;
  let toDt: Date | undefined;

  if (opts.month) {
    const r = monthToIso(opts.month);
    if (!r) return;
    fromIso = r.fromIso; toIso = r.toIso;
    fromDt  = r.from;    toDt  = r.to;
  } else if (opts.from || opts.to) {
    if (opts.from) { const d = new Date(String(opts.from)); fromIso = d.toISOString(); fromDt = d; }
    if (opts.to)   { const d = new Date(String(opts.to));   toIso   = d.toISOString(); toDt   = d; }
  } else {
    return;
  }

  const orConds: any[] = [];

  const weekRange: any = {};
  if (fromIso) weekRange.$gte = fromIso;
  if (toIso)   weekRange.$lte = toIso;
  if (Object.keys(weekRange).length) orConds.push({ weekStart: weekRange });

  const createdDateRange: any = {};
  if (fromDt) createdDateRange.$gte = fromDt;
  if (toDt)   createdDateRange.$lte = toDt;
  if (Object.keys(createdDateRange).length) {
    orConds.push({
      $and: [
        { $or: [{ weekStart: null }, { weekStart: { $exists: false } }] },
        { createdAt: createdDateRange },
      ],
    });
  }

  const createdStrRange: any = {};
  if (fromIso) createdStrRange.$gte = fromIso;
  if (toIso)   createdStrRange.$lte = toIso;
  if (Object.keys(createdStrRange).length) {
    orConds.push({
      $and: [
        { $or: [{ weekStart: null }, { weekStart: { $exists: false } }] },
        { createdAt: createdStrRange },
      ],
    });
  }

  if (orConds.length) base.$or = orConds;
}

/* ========= helpers: embed services ========= */
type Line = {
  id: string;
  serviceDate: any;
  firstName: string;
  lastName: string;
  serviceTypeId?: string;
  serviceType?: { id: string; name?: string };
  park?: string;
  location?: string;
  guests?: number | null;
  hopper?: boolean;
  finalValue: number;
};

function serviceDocToLine(s: any): Line {
  const stId = s?.serviceTypeId ?? s?.serviceType?.id ?? s?.serviceType ?? "";
  const stName = s?.serviceType?.name ?? s?.serviceTypeName ?? undefined;
  return {
    id: String(s._id),
    serviceDate: s.serviceDate,
    firstName: s.firstName || "",
    lastName: s.lastName || "",
    serviceTypeId: stId || undefined,
    serviceType: stId ? { id: String(stId), name: stName } : undefined,
    park: s.park || "",
    location: s.location || "",
    guests: s.guests ?? null,
    hopper: !!s.hopper,
    finalValue: Number(s.finalValue || 0),
  };
}

function truthyFlag(v: any) {
  const s = String(v ?? "").toLowerCase().trim();
  return ["1", "true", "yes", "y", "on"].includes(s);
}
function wantsServicesEmbed(q: any, role?: string) {
  const raw = String(q?.expand || q?.embed || q?.with || "").toLowerCase().trim();
  const asked =
    truthyFlag(raw) ||
    raw.split(",").map(s => s.trim()).some(s => s === "services" || s === "lines");
  const force = truthyFlag(q?.forceEmbed);
  const isPartner = String(role || "").toLowerCase() === "partner";
  return force || asked || isPartner;
}

/** Busca serviços via driver nativo, aceitando _id como string e ObjectId numa mesma query */
async function findServicesByIdsRaw(idsAny: any[], projection: Record<string, 0|1> = {}) {
  const idsStr = Array.from(new Set((idsAny || []).map(String)));
  const objIds = idsStr.filter(isValidObjectId).map(id => new mongoose.Types.ObjectId(id));

  const query: any = { _id: { $in: [...objIds, ...idsStr] } };
  const proj = Object.keys(projection || {}).length ? projection : undefined;

  const cursor = Service.collection.find(query, proj ? { projection: proj } : undefined);
  const docs = await cursor.toArray();
  return docs;
}

async function hydratePaymentsWithServices(items: any[]): Promise<any[]> {
  const allIds = new Set<string>();
  items.forEach(p => (p.serviceIds || []).forEach((id: any) => allIds.add(String(id))));
  if (allIds.size === 0) {
    return items.map((p) => ({
      ...p,
      lines: [],
      services: [],
      details: "—",
      displayTotal: 0,
      totalComputed: Number(p.total || 0) || 0,
    }));
  }

  const projection = {
    serviceDate: 1, firstName: 1, lastName: 1,
    serviceType: 1, serviceTypeId: 1, serviceTypeName: 1,
    park: 1, location: 1, guests: 1, hopper: 1, finalValue: 1,
  } as const;

  const svcs = await findServicesByIdsRaw(Array.from(allIds), projection as any);
  const map = new Map<string, any>();
  svcs.forEach(s => map.set(String(s._id), s));

  return items.map(p => {
    const lines: Line[] = (p.serviceIds || [])
      .map((id: any) => map.get(String(id)))
      .filter(Boolean)
      .map(serviceDocToLine);

    const displayTotal = lines.reduce((sum, l) => sum + Number(l.finalValue || 0), 0);
    const detailNames = Array.from(
      new Set(lines.map((l) => (l.serviceType?.name || l.serviceTypeId || "").toString()).filter(Boolean))
    );
    const details = detailNames.length ? detailNames.join(", ") : "—";

    return {
      ...p,
      lines,
      services: lines, // alias
      details,
      displayTotal,
      totalComputed: displayTotal > 0 ? displayTotal : Number(p.total || 0) || 0,
    };
  });
}

/* ========= DIAG ========= */
router.get("/__diag", (_req, res) => {
  res.json({
    ok: true,
    tag: ROUTER_TAG,
    nodeEnv: process.env.NODE_ENV || null,
    hasJwtSecret: !!process.env.JWT_SECRET,
    routes: [
      "/ (GET, POST, PATCH, DELETE)",
      "/eligible (GET)",
      "/service-status (GET)",
      "/:id/services (GET)"
    ]
  });
});

/* ========= LIST (root) ========= */
router.get("/", auth(), async (req: Request, res: Response) => {
  const dbg = isDebug(req.query);

  let filter: Record<string, any> = {};
  try {
    const me: any = req.user;
    if (!me) {
      if (dbg) console.warn("[/payments] missing req.user → 401");
      return res.status(401).json({ error: "unauthorized" });
    }
    const isPartner = String(me.role || "user").toLowerCase() === "partner";

    const {
      page = "1",
      pageSize = "10",
      limit,
      offset,
      partnerId,
      status,
      weekKey,
      from,
      to,
      month,
      sortBy,
      sortDir,
    } = req.query as Record<string, string | undefined>;

    const _page = Number(page) || (offset ? Math.floor(Number(offset) / Number(limit)) + 1 : 1);
    const _pageSize = Math.min(500, Number(pageSize) || Number(limit) || 10);
    const skip = (_page - 1) * _pageSize;

    filter = {};
    if (isPartner) filter.partnerId = me._id;
    else if (partnerId) filter.partnerId = partnerId;

    if (status) filter.status = String(status).toUpperCase();
    if (weekKey) filter.weekKey = weekKey;

    addPeriodFilter(filter, { month, from, to });

    const allowedSort = new Set(["createdAt", "updatedAt", "total", "status", "partnerName", "weekStart"]);
    const field = allowedSort.has(String(sortBy || "")) ? String(sortBy) : "weekStart";
    const dir = String(sortDir || "desc").toLowerCase() === "asc" ? 1 : -1;
    const sort = { [field]: dir as 1 | -1, _id: -1 as const };

    let docs: any[], total: number;

    try {
      [docs, total] = await Promise.all([
        Payment.find(filter).sort(sort as any).skip(skip).limit(_pageSize).lean(),
        Payment.countDocuments(filter),
      ]);
    } catch (_err) {
      // fallback simplificado
      const base2: any = {
        ...(isPartner ? { partnerId: me._id } : {}),
        ...(partnerId ? { partnerId } : {}),
        ...(status ? { status: String(status).toUpperCase() } : {}),
        ...(weekKey ? { weekKey } : {}),
      };
      [docs, total] = await Promise.all([
        Payment.find(base2).sort(sort as any).skip(skip).limit(_pageSize).lean(),
        Payment.countDocuments(base2),
      ]);
    }

    let items = (docs as any[]).map(normalizePayment);

    const willEmbed = wantsServicesEmbed(req.query, me.role);
    let embedLinesCount = 0;
    if (willEmbed) {
      items = await hydratePaymentsWithServices(items);
      embedLinesCount = items.reduce((acc, it: any) => acc + (Array.isArray(it?.lines) ? it.lines.length : 0), 0);
    }

    const response: any = {
      items,
      total,
      page: _page,
      pageSize: _pageSize,
      totalPages: Math.max(1, Math.ceil(total / _pageSize)),
    };

    if (dbg) {
      response.debug = {
        tag: ROUTER_TAG,
        userBasic: { id: String(me?._id || ""), role: me?.role ?? null },
        query: req.query,
        filter,
        sort,
        page: _page,
        pageSize: _pageSize,
        skip,
        itemsCount: items.length,
        embedWanted: willEmbed,
        embedApplied: willEmbed,
        embedLinesCount,
      };
    }

    return res.json(response);
  } catch (e: any) {
    if (isDebug(req.query)) {
      console.error("[/payments] error:", e);
      return res.status(500).json({
        error: e?.message || "Failed to list payments",
        debug: { query: req.query, tag: ROUTER_TAG },
      });
    }
    return res.status(500).json({ error: "Failed to list payments" });
  }
});

/* ========= CREATE (root) ========= */
router.post("/", auth(), async (req: Request, res: Response) => {
  const dbg = isDebug(req.query);

  try {
    const me: any = req.user;
    if (!me) return res.status(401).json({ error: "unauthorized" });

    const rawServiceIds = Array.isArray(req.body.serviceIds) ? req.body.serviceIds.map(String) : [];
    const rawExtraIds = Array.isArray(req.body.extraIds) ? req.body.extraIds.map(String) : [];

    const payload: any = {
      partnerId: String(req.body.partnerId || ""),
      partnerName: req.body.partnerName || "",
      weekKey: req.body.weekKey ?? weekKeyFromStart(req.body.weekStart) ?? null,
      weekStart: req.body.weekStart ?? null,
      weekEnd: req.body.weekEnd ?? null,
      periodFrom: req.body.periodFrom ?? null,
      periodTo: req.body.periodTo ?? null,
      serviceIds: Array.from(new Set(rawServiceIds)).map(String),
      extraIds: Array.from(new Set(rawExtraIds)).map(String),
      status: (req.body.status || "PENDING").toUpperCase(),
      notes: req.body.notes || "",
      notesLog: Array.isArray(req.body.notesLog) ? req.body.notesLog : [],
    };

    if (String(me.role || "user") === "partner") {
      payload.partnerId = String(me._id);
    }

    if (!payload.partnerId) {
      return res.status(400).json({
        error: "Missing partnerId",
        ...(dbg ? { debug: { body: req.body, tag: ROUTER_TAG } } : {}),
      });
    }

    const created = await Payment.create(payload);
    const total = await recalcTotal(String(created._id));
    const obj = created.toObject() as any;
    obj.total = total ?? obj.total;

    let out = normalizePayment(obj);
    const willEmbed = wantsServicesEmbed(req.query, me.role);
    if (willEmbed) {
      [out] = await hydratePaymentsWithServices([out]);
    }

    const resp: any = out;
    if (dbg) resp.debug = { tag: ROUTER_TAG, embedApplied: willEmbed };
    return res.status(201).json(resp);
  } catch (e: any) {
    if (dbg) console.error("[/payments POST] error:", e);
    return res.status(400).json({
      error: e?.message || "Failed to create payment",
      ...(dbg ? { debug: { body: req.body, tag: ROUTER_TAG } } : {}),
    });
  }
});

/* ========= ELIGIBLE (declare BEFORE /:id) ========= */
router.get("/eligible", auth(), async (req: Request, res: Response) => {
  const dbg = isDebug(req.query);

  try {
    const me: any = req.user;
    if (!me) return res.status(401).json({ error: "unauthorized" });

    const isPartner = (me.role || "user") === "partner";

    const partnerId = String(isPartner ? me._id : (req.query.partnerId || req.query.partner || ""));
    const serviceType = String(req.query.serviceType || "ALL");
    const anyDate = String(req.query.anyDate || "").toLowerCase();
    const noPeriod = anyDate === "1" || anyDate === "true";

    const rawFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
    const rawTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : null;

    if (!partnerId) {
      return res.status(400).json({
        error: "Missing partner",
        ...(dbg ? { debug: { query: req.query, tag: ROUTER_TAG } } : {}),
      });
    }

    const periodFilter: any = {};
    if (!noPeriod) {
      if (rawFrom) periodFilter.$gte = startOfDayUTC(rawFrom);
      if (rawTo) periodFilter.$lte = endOfDayUTC(rawTo);
    }

    const payments = await Payment.find({ partnerId }, { serviceIds: 1 }).lean();
    const usedIds = new Set<string>();
    payments.forEach((p) => (p.serviceIds || []).forEach((sid: any) => usedIds.add(String(sid))));

    const filter: any = { partnerId: String(partnerId) };
    if (!noPeriod && Object.keys(periodFilter).length) filter.serviceDate = periodFilter;
    if (serviceType !== "ALL") filter.serviceTypeId = serviceType;

    const services = await Service.find(filter).sort({ serviceDate: -1 }).lean();
    const items = services
      .filter((s) => !usedIds.has(String(s._id)))
      .map((s) => ({
        id: String(s._id),
        serviceDate: s.serviceDate,
        firstName: s.firstName || "",
        lastName: s.lastName || "",
        serviceTypeId: s.serviceTypeId || "",
        finalValue: Number(s.finalValue || 0),
        observations: s.observations || "",
      }));

    res.json({
      items,
      total: items.length,
      ...(dbg
        ? {
            debug: {
              query: req.query,
              filter,
              noPeriod,
              periodFilter: Object.keys(periodFilter).length ? periodFilter : null,
              usedIdsCount: usedIds.size,
              itemsAfterFilter: items.length,
              tag: ROUTER_TAG,
            },
          }
        : {}),
    });
  } catch (e: any) {
    if (dbg) console.error("[/payments/eligible] error:", e);
    res.status(400).json({
      error: e?.message || "Failed to list eligible services",
      ...(dbg ? { debug: { query: req.query, tag: ROUTER_TAG } } : {}),
    });
  }
});

/* ========= SERVICE STATUS (declare BEFORE /:id) ========= */
router.get("/service-status", auth(), async (req: Request, res: Response) => {
  const dbg = String(req.query?.debug ?? "").toLowerCase() === "1";
  try {
    // aceita ids=a,b,c  |  ids[]=a&ids[]=b  |  id=a&id=b
    const q: any = req.query;
    const raw = q.ids ?? q["ids[]"] ?? q.id;
    let ids: string[] = [];

    if (Array.isArray(raw)) {
      ids = raw
        .flatMap((v) => String(v).split(","))
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (typeof raw === "string") {
      ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    }

    // Sem IDs → retorna vazio (front interpreta como "not linked")
    if (!ids.length) {
      return res.json({ items: [], total: 0, ...(dbg ? { debug: { parsedIds: ids } } : {}) });
    }

    const set = new Set(ids.map(String));
    const objIds = ids
      .filter((v) => mongoose.isValidObjectId(String(v)))
      .map((id) => new mongoose.Types.ObjectId(id));

    const inVals = objIds.length ? [...objIds, ...ids] : ids;

    const docs = await Payment.find(
      { serviceIds: { $in: inVals } },
      { _id: 1, serviceIds: 1, status: 1 }
    ).lean();

    const toSvc = (st: any): "paid" | "pending" | "declined" => {
      const s = String(st || "").toUpperCase();
      if (s === "PAID") return "paid";
      if (s === "DECLINED") return "declined";
      return "pending"; // PENDING/SHARED/APPROVED/ON_HOLD/etc
    };
    // prioridade quando o mesmo serviço aparece em múltiplos pagamentos
    const rank = { paid: 3, pending: 2, declined: 1 } as const;

    const best = new Map<string, { paymentId: string; status: "paid" | "pending" | "declined" }>();
    for (const p of docs) {
      const st = toSvc((p as any).status);
      for (const sid of (p as any).serviceIds || []) {
        const k = String(sid);
        if (!set.has(k)) continue;
        const prev = best.get(k);
        if (!prev || rank[st] > rank[prev.status]) {
          best.set(k, { paymentId: String((p as any)._id), status: st });
        }
      }
    }

    const items = ids.map((sid) => {
      const r = best.get(sid);
      return { serviceId: sid, paymentId: r?.paymentId || null, status: r?.status || "not linked" };
    });

    return res.json({
      items,
      total: items.length,
      ...(dbg ? { debug: { requested: ids.length, matchedPayments: docs.length } } : {}),
    });
  } catch (e: any) {
    if (dbg) console.error("[/payments/service-status] error:", e);
    // mantém 200 pra não quebrar o front
    return res.json({ items: [], total: 0, error: e?.message || "failed" });
  }
});

/* ========= GET ONE (AFTER static routes) ========= */
router.get("/:id", auth(), async (req: Request, res: Response) => {
  const dbg = isDebug(req.query);
  try {
    const me: any = req.user;
    if (!me) return res.status(401).json({ error: "unauthorized" });

    const pay: any = await Payment.findById(req.params.id).lean();
    if (!pay) return res.status(404).json({ error: "Not found" });

    const isPartner = String(me.role || "user") === "partner";
    if (isPartner && String(pay.partnerId) !== String(me._id)) {
      return res.status(403).json({ error: "forbidden" });
    }

    let item = normalizePayment(pay);

    const willEmbed = wantsServicesEmbed(req.query, me.role);
    if (willEmbed) {
      [item] = await hydratePaymentsWithServices([item]);
    }

    const out: any = item;
    if (dbg) out.debug = { tag: ROUTER_TAG, userBasic: { id: String(me?._id || ""), role: me?.role ?? null }, embedApplied: willEmbed };
    return res.json(out);
  } catch (e: any) {
    if (dbg) console.error("[/payments/:id GET] error:", e);
    return res.status(400).json({ error: e?.message || "Failed to get payment", tag: ROUTER_TAG });
  }
});

/* ========= UPDATE ========= */
router.patch("/:id", auth(), async (req: Request, res: Response) => {
  const dbg = isDebug(req.query);

  try {
    const me: any = req.user;
    if (!me) return res.status(401).json({ error: "unauthorized" });

    const { id } = req.params;
    const isPartner = (me.role || "user") === "partner";

    const body = req.body || {};
    const { appendNote, notes, ...patch } = body;

    if (Array.isArray(patch.serviceIds)) {
      patch.serviceIds = Array.from(new Set(patch.serviceIds.map(String)));
    }
    if (Array.isArray(patch.extraIds)) {
      patch.extraIds = Array.from(new Set(patch.extraIds.map(String)));
    }

    if (!("weekKey" in patch) && (patch.weekStart || patch.weekEnd)) {
      patch.weekKey = weekKeyFromStart(patch.weekStart);
    }

    const payment: any = await Payment.findById(id);
    if (!payment) return res.status(404).json({ error: "Not found" });

    if (isPartner) {
      if (String(payment.partnerId) !== String(me._id)) return res.status(403).json({ error: "forbidden" });
      const curr = String(payment.status || "").toUpperCase();
      const want = String(patch.status || "").toUpperCase();
      if (want && !["APPROVED", "DECLINED"].includes(want)) return res.status(400).json({ error: "invalid status transition" });
      if (curr !== "SHARED") return res.status(409).json({ error: "not in shared status" });
      patch.serviceIds = undefined;
      patch.extraIds = undefined;
      patch.partnerId = undefined;
      patch.partnerName = undefined;
    }

    const update: any = { $set: patch };
    if (appendNote && typeof notes === "string" && notes.trim()) {
      const note = { id: newNoteId(), text: notes.trim(), at: new Date() };
      update.$push = { notesLog: note };
      if (!("notes" in patch)) update.$set.notes = notes.trim();
    }

    const updated = await Payment.findByIdAndUpdate(id, update, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: "Not found" });

    if ("serviceIds" in patch && !isPartner) {
      await recalcTotal(id);
    }

    let out = normalizePayment(updated as any);
    const willEmbed = wantsServicesEmbed(req.query, me.role);
    if (willEmbed) {
      [out] = await hydratePaymentsWithServices([out]);
    }

    const resp: any = out;
    if (dbg) resp.debug = { tag: ROUTER_TAG, embedApplied: willEmbed };
    res.json(resp);
  } catch (e: any) {
    if (dbg) console.error("[/payments PATCH] error:", e);
    res.status(400).json({
      error: e?.message || "Failed to update",
      ...(dbg ? { debug: { id: req.params?.id, body: req.body, tag: ROUTER_TAG } } : {}),
    });
  }
});

/* ========= DELETE ========= */
router.delete("/:id", auth(), async (req: Request, res: Response) => {
  const dbg = isDebug(req.query);

  try {
    const { id } = req.params;
    const del = await Payment.findByIdAndDelete(id);
    if (!del) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, ...(dbg ? { debug: { id, tag: ROUTER_TAG } } : {}) });
  } catch (e: any) {
    if (dbg) console.error("[/payments DELETE] error:", e);
    res.status(400).json({
      error: e?.message || "Failed to delete",
      ...(dbg ? { debug: { id: req.params?.id, tag: ROUTER_TAG } } : {}),
    });
  }
});

/* ========= RECALC ========= */
router.post("/:id/recalc", auth(), async (req: Request, res: Response) => {
  try {
    const me: any = req.user;
    if (!me) return res.status(401).json({ error: "unauthorized" });

    const { id } = req.params;
    const pay = await Payment.findById(id).lean();
    if (!pay) return res.status(404).json({ error: "Not found" });

    // Recalcula total
    const total = await recalcTotal(id);
    const updated = await Payment.findById(id).lean();
    if (!updated) return res.status(404).json({ error: "Not found" });

    let out = normalizePayment(updated as any);
    const willEmbed = wantsServicesEmbed(req.query, me.role);
    if (willEmbed) {
      [out] = await hydratePaymentsWithServices([out]);
    }

    return res.json({ ...out, total });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to recalc total" });
  }
});

/* ========= SERVICES OF A PAYMENT ========= */
router.get("/:id/services", auth(), async (req: Request, res: Response) => {
  try {
    const me: any = req.user;
    const pay = await Payment.findById(req.params.id).lean();
    if (!pay) return res.status(404).json({ error: "Not found" });
    if (String(me.role || "user") === "partner" && String(pay.partnerId) !== String(me._id)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const projection = {
      serviceDate: 1, firstName: 1, lastName: 1,
      serviceType: 1, serviceTypeId: 1, serviceTypeName: 1,
      park: 1, location: 1, guests: 1, hopper: 1, finalValue: 1,
    } as const;

    const services = await findServicesByIdsRaw(pay.serviceIds || [], projection as any);

    res.json({
      items: services.map(serviceDocToLine),
      total: services.length,
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to list payment services" });
  }
});

export default router;
