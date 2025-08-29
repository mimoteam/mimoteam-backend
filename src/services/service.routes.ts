// backend/src/services/service.routes.ts
import { Router } from "express";
import { type SortOrder } from "mongoose";
import { Service } from "./service.model";

export const servicesRouter = Router();

/* ---------------- helpers ---------------- */
const toBool = (v: any) => {
  if (typeof v === "boolean") return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "on", "yes"].includes(s);
};

const toNumOrNull = (v: any) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const parseDate = (v: any): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const normalizeOut = (d: any) => ({
  id: String(d._id),
  serviceDate: d.serviceDate,
  firstName: d.firstName || "",
  lastName: d.lastName || "",
  clientName: d.clientName || "",
  park: d.park || "",
  location: d.location || "",
  guests: d.guests ?? null,
  hopper: !!d.hopper,
  team: d.team || "",
  finalValue: Number(d.finalValue || 0),
  serviceType: d.serviceType || null,
  serviceTypeId: d.serviceTypeId || "",
  partnerId: d.partnerId || "",
  partner: d.partner || null,
  serviceTime: d.serviceTime ?? null,
  observations: d.observations || "",
  overrideValue: d.overrideValue ?? null,
  calculatedPrice: d.calculatedPrice ?? null,
  status: d.status || "RECORDED",
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

const buildFilter = (q: any) => {
  const filter: Record<string, any> = {};
  if (q.partner) filter.partnerId = String(q.partner);
  if (q.serviceType) filter.serviceTypeId = String(q.serviceType);
  if (q.team) filter.team = String(q.team);
  if (q.status) filter.status = String(q.status);

  const from = parseDate(q.dateFrom);
  const to = parseDate(q.dateTo);
  if (from || to) {
    filter.serviceDate = {};
    if (from) filter.serviceDate.$gte = from;
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      filter.serviceDate.$lte = end;
    }
  }

  const text = (q.q || q.search || "").toString().trim();
  if (text) {
    const rx = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { clientName: rx },
      { "partner.name": rx },
    ];
  }
  return filter;
};

const buildSort = (q: any): Record<string, SortOrder> => {
  const sortBy = (q.sortBy || "serviceDate").toString();
  const dir: SortOrder = (q.sortDir || "desc").toString().toLowerCase() === "asc" ? 1 : -1;
  const map: Record<string, string> = { client: "firstName" };
  const field = map[sortBy] || sortBy;
  return { [field]: dir, _id: -1 as SortOrder };
};

const parsePayload = (b: any) => ({
  serviceDate: parseDate(b.serviceDate) || new Date(),
  firstName: b.firstName || "",
  lastName: b.lastName || "",
  clientName: b.clientName || "",
  park: b.park || "",
  location: b.location || "",
  guests: toNumOrNull(b.guests),
  hopper: toBool(b.hopper),
  team: b.team || "",
  serviceTypeId: b.serviceTypeId || "",
  serviceType: b.serviceType && typeof b.serviceType === "object" ? b.serviceType : null,
  partnerId: b.partnerId || "",
  partner:
    b.partner && typeof b.partner === "object"
      ? {
          id: String(b.partner._id || b.partner.id || b.partnerId || ""),
          name: b.partner.name || b.partner.fullName || b.partner.login || "",
          email: b.partner.email || "",
        }
      : null,
  serviceTime: toNumOrNull(b.serviceTime),
  observations: b.observations || "",
  finalValue: Number(b.finalValue ?? 0),
  overrideValue:
    b.overrideValue === "" || b.overrideValue == null ? null : Number(b.overrideValue),
  calculatedPrice: b.calculatedPrice ?? null,
  status: typeof b.status === "string" ? b.status : "RECORDED",
});

/* ---------------- rotas ---------------- */

// GET /services
servicesRouter.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(500, Number(req.query.pageSize || 20)));
    const skip = (page - 1) * pageSize;

    const filter = buildFilter(req.query);
    const sort = buildSort(req.query);

    const [docs, total] = await Promise.all([
      Service.find(filter).sort(sort).skip(skip).limit(pageSize).lean(),
      Service.countDocuments(filter),
    ]);

    const items = (docs as any[]).map(normalizeOut);

    res.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e) {
    next(e);
  }
});

// GET /services/:id
servicesRouter.get("/:id", async (req, res, next) => {
  try {
    const doc = await Service.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(normalizeOut(doc));
  } catch (e) {
    next(e);
  }
});

// POST /services
servicesRouter.post("/", async (req, res, next) => {
  try {
    const payload = parsePayload(req.body || {});
    const created = await Service.create(payload);
    const obj = created.toObject();
    res.status(201).json(normalizeOut(obj));
  } catch (e) {
    next(e);
  }
});

// POST /services/bulk  (array direto ou { items: [...] })
servicesRouter.post("/bulk", async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body)
      ? req.body
      : Array.isArray(req.body?.items)
      ? req.body.items
      : [];
    if (!raw.length) return res.status(400).json({ error: "Empty payload" });

    const payloads = raw.map(parsePayload);
    const created = await Service.insertMany(payloads, { ordered: false });

    res.status(201).json({
      inserted: created.length,
      items: created.map((d: any) => normalizeOut(d.toObject?.() ?? d)),
    });
  } catch (e) {
    next(e);
  }
});

// PATCH /services/:id
servicesRouter.patch("/:id", async (req, res, next) => {
  try {
    const patch = parsePayload(req.body || {});
    const updated = await Service.findByIdAndUpdate(
      req.params.id,
      { $set: patch },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(normalizeOut(updated));
  } catch (e) {
    next(e);
  }
});

// DELETE /services/:id
servicesRouter.delete("/:id", async (req, res, next) => {
  try {
    const del = await Service.findByIdAndDelete(req.params.id);
    if (!del) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
