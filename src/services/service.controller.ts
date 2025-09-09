// src/services/service.controller.ts
import type { Request, Response, NextFunction } from "express";
import mongoose, { Types } from "mongoose";
import { Service } from "./service.model";
import * as PaymentModule from "../payments/payment.model";

/* ========================= Helpers ========================= */
const isObjectId = (id?: string) =>
  typeof id === "string" && Types.ObjectId.isValid(id);

const toInt = (v: unknown, fb: number) => {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fb;
};

function qsStrings(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "object") return [String((v as any).toString?.() ?? "")];
  return [String(v)];
}

function parsePagination(q: Record<string, any>) {
  const hasLimitOffset = q.limit != null || q.offset != null;
  if (hasLimitOffset) {
    const pageSize = Math.min(1000, Math.max(1, toInt(q.limit, 20)));
    const offset = Math.max(0, toInt(q.offset, 0));
    const page = Math.max(1, Math.floor(offset / pageSize) + 1);
    return { page, pageSize, skip: offset };
  }
  const page = Math.max(1, toInt(q.page, 1));
  const pageSize = Math.min(1000, Math.max(1, toInt(q.pageSize, 20)));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function normalizeStatus(v?: string): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "pending";
  if (["waiting to approve", "waiting for approval", "shared", "waiting"].includes(s)) return "waiting to approve";
  if (["denied", "rejected", "recusado"].includes(s)) return "denied";
  if (["paid", "pago"].includes(s)) return "paid";
  if (["pending", "pendente", "recorded", "rec", "approved", "aprovado"].includes(s)) return "pending";
  return s;
}

// Se vier 'YYYY-MM-DD', grava como meio-dia UTC para evitar -1 dia por timezone.
function coerceServiceDate(raw: any): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00.000Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildSort(q: Record<string, any>) {
  const sortByRaw = String(q.sortBy ?? "serviceDate").trim();
  const sortDir = String(q.sortDir ?? "desc").toLowerCase() === "asc" ? 1 : -1;
  const allowed = new Set([
    "serviceDate",
    "firstName",
    "lastName",
    "partnerId",
    "team",
    "status",
    "createdAt",
    "updatedAt",
  ]);
  const field = allowed.has(sortByRaw) ? sortByRaw : "serviceDate";
  return { [field]: sortDir as 1 | -1, _id: -1 as const };
}

/** Coleta robusta de IDs da query (?ids=csv | ?ids=a&ids=b | ?ids[]=a&ids[]=b) */
function collectIds(q: Record<string, any>): string[] {
  const out = new Set<string>();
  const addCsv = (v: any) =>
    String(v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => out.add(id));

  // ?ids=csv | ?ids=a&ids=b
  const idsParam = (q as any).ids;
  if (Array.isArray(idsParam)) idsParam.forEach(addCsv);
  else if (idsParam) addCsv(idsParam);

  // ?ids[]=a&ids[]=b
  const idsArray = (q as any)["ids[]"];
  if (Array.isArray(idsArray)) {
    idsArray.map((s) => String(s).trim()).filter(Boolean).forEach((id) => out.add(id));
  } else if (idsArray) {
    out.add(String(idsArray).trim());
  }

  return Array.from(out);
}

function buildFilter(q: Record<string, any>) {
  const status = qsStrings(q.status)[0];
  const partnerId = (qsStrings(q.partnerId)[0] ?? qsStrings(q.partner)[0]) || undefined;
  const team = qsStrings(q.team)[0];
  const serviceTypeId = (qsStrings(q.serviceTypeId)[0] ?? qsStrings(q.serviceType)[0]) || undefined;
  const qtext = (qsStrings(q.q)[0] ?? qsStrings(q.search)[0]) || undefined;

  const base: any = {};
  if (status) base.status = normalizeStatus(status);
  if (partnerId) base.partnerId = partnerId;
  if (team) base.team = new RegExp(`^${team}$`, "i");
  if (serviceTypeId) base.serviceTypeId = serviceTypeId;

  // 🔥 IDs sem usar _id: {$in: ...} — evita CastError
  const rawIds = collectIds(q);
  const validIds = rawIds.filter(Types.ObjectId.isValid);
  const idClause = validIds.length ? { $or: validIds.map((id) => ({ _id: id })) } : null;

  // Busca textual
  const textClause =
    qtext && String(qtext).trim()
      ? {
          $or: [
            { clientName: new RegExp(String(qtext).trim(), "i") },
            { firstName: new RegExp(String(qtext).trim(), "i") },
            { lastName: new RegExp(String(qtext).trim(), "i") },
            { observations: new RegExp(String(qtext).trim(), "i") },
            { "partner.name": new RegExp(String(qtext).trim(), "i") },
            { team: new RegExp(String(qtext).trim(), "i") },
            { park: new RegExp(String(qtext).trim(), "i") },
            { location: new RegExp(String(qtext).trim(), "i") },
          ],
        }
      : null;

  // Combinação segura
  const andParts = [];
  if (Object.keys(base).length) andParts.push(base);
  if (idClause) andParts.push(idClause);
  if (textClause) andParts.push(textClause);

  if (andParts.length === 0) return {}; // sem filtros
  if (andParts.length === 1) return andParts[0]; // único filtro
  return { $and: andParts };
}

/* ========= Payment model (opcional/robusto) ========= */
function getPaymentModel(): mongoose.Model<any> | null {
  const anyMod = PaymentModule as any;
  if (anyMod?.default?.findOne) return anyMod.default as mongoose.Model<any>;
  if (anyMod?.Payment?.findOne) return anyMod.Payment as mongoose.Model<any>;
  try {
    const m = mongoose.model("Payment");
    if ((m as any)?.findOne) return m as mongoose.Model<any>;
  } catch {}
  return null;
}

type LinkInfo = {
  paymentId: string;
  status: "pending" | "paid" | "declined";
  ts: number;
};
const normPaymentStatus = (s: any): LinkInfo["status"] => {
  const up = String(s || "").toUpperCase();
  if (up === "PAID") return "paid";
  if (up === "DECLINED") return "declined";
  return "pending";
};

async function getFirstPaymentLink(id: string) {
  const Payment = getPaymentModel();
  if (!Payment) return null;
  const arr: any[] = [id];
  if (Types.ObjectId.isValid(id)) arr.push(new Types.ObjectId(id));
  const doc = await Payment.findOne(
    { serviceIds: { $in: arr } },
    { _id: 1, status: 1, updatedAt: 1, createdAt: 1 }
  )
    .sort({ updatedAt: -1, _id: -1 })
    .lean();
  if (!doc) return null;
  return { paymentId: String((doc as any)._id), status: normPaymentStatus((doc as any).status) };
}

async function mapPaymentLinksByServiceIds(ids: string[]) {
  const Payment = getPaymentModel();
  if (!Payment) return new Map<string, LinkInfo>();
  const idsStr = Array.from(new Set(ids.map(String)));
  const objIds = idsStr.filter(Types.ObjectId.isValid).map((s) => new Types.ObjectId(s));

  const [byStr, byObj] = await Promise.all([
    Payment.find(
      { serviceIds: { $in: idsStr } },
      { _id: 1, serviceIds: 1, status: 1, updatedAt: 1, createdAt: 1 }
    ).lean(),
    objIds.length
      ? Payment.find(
          { serviceIds: { $in: objIds } },
          { _id: 1, serviceIds: 1, status: 1, updatedAt: 1, createdAt: 1 }
        ).lean()
      : Promise.resolve([] as any[]),
  ]);

  const map = new Map<string, LinkInfo>();
  const idsSet = new Set(idsStr);
  for (const p of [...byStr, ...byObj] as any[]) {
    const pid = String(p._id);
    const ts: number = new Date(p.updatedAt || p.createdAt || Date.now()).getTime();
    const status = normPaymentStatus(p.status);
    for (const sid of p.serviceIds || []) {
      const key = String(sid);
      if (!idsSet.has(key)) continue;
      const prev = map.get(key);
      if (!prev || ts >= prev.ts) map.set(key, { paymentId: pid, status, ts });
    }
  }
  return map;
}

/* ========================= Controllers ========================= */

// GET /services
export async function listServices(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, pageSize, skip } = parsePagination(req.query as any);
    const filter = buildFilter(req.query as any);
    const sort = buildSort(req.query as any);

    const [items, total] = await Promise.all([
      Service.find(filter)
        .collation({ locale: "en", strength: 2 })
        .sort(sort)
        .skip(skip)
        .limit(pageSize)
        .lean(),
      Service.countDocuments(filter),
    ]);

    // Enriquecimento com link de pagamento — não derruba a rota
    let itemsOut = items as any[];
    try {
      const ids = items.map((it: any) => String(it._id));
      const links = await mapPaymentLinksByServiceIds(ids);
      itemsOut = items.map((it: any) => {
        const link = links.get(String(it._id));
        return {
          ...it,
          paymentId: link?.paymentId ?? null,
          paymentStatus: link?.status ?? null,
          isLocked: !!link,
        };
      });
    } catch {}

    res.json({
      items: itemsOut,
      total,
      totalRecords: total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      page,
      pageSize,
    });
  } catch (err: any) {
    // Retorno amigável se algo escapar
    if (req.query?.debug) {
      return res
        .status(400)
        .json({ error: "bad_query", detail: String(err?.message || err) });
    }
    next(err);
  }
}

// GET /services/:id
export async function getService(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params as { id: string };
    if (!isObjectId(id)) return res.status(400).json({ error: "Invalid id" });
    const doc: any = await Service.findById(id).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });

    let paymentId: string | null = null;
    let paymentStatus: "pending" | "paid" | "declined" | null = null;
    try {
      const link = await getFirstPaymentLink(id);
      paymentId = link?.paymentId ?? null;
      paymentStatus = link?.status ?? null;
    } catch {}

    res.json({ ...doc, paymentId, paymentStatus, isLocked: !!paymentId });
  } catch (err) {
    next(err);
  }
}

// POST /services
export async function createService(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body || {};
    const payload: any = {
      ...b,
      serviceDate: coerceServiceDate(b.serviceDate) ?? new Date(),
      status: normalizeStatus(b.status),
    };
    delete payload._id;
    delete payload.id;

    const created: any = await Service.create(payload);
    const fresh = await Service.findById(String(created?._id)).lean();

    res
      .status(201)
      .json({ ...(fresh as any), paymentId: null, paymentStatus: null, isLocked: false });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /services/bulk  — resiliente (nunca 500 por erro de item)
 * Aceita: array | {items|services|rows|data}
 * Cria item-a-item e devolve resumo {inserted, failed[], items[]}
 */
export async function bulkCreateServices(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as any;

    let arr: any[] = [];
    if (Array.isArray(body)) arr = body;
    else if (Array.isArray(body.items)) arr = body.items;
    else if (Array.isArray(body.services)) arr = body.services;
    else if (Array.isArray(body.rows)) arr = body.rows;
    else if (Array.isArray(body.data)) arr = body.data;

    if (!arr.length) return res.status(400).json({ error: "Empty items" });

    const inserted: any[] = [];
    const failed: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < arr.length; i++) {
      const b = arr[i] ?? {};
      try {
        const p: any = {
          ...b,
          serviceDate: coerceServiceDate(b.serviceDate) ?? new Date(),
          status: normalizeStatus(b.status),
        };
        delete p._id;
        delete p.id;

        const doc: any = await Service.create(p);
        const fresh = await Service.findById(String(doc?._id)).lean();
        if (fresh) inserted.push(fresh);
      } catch (e: any) {
        failed.push({ index: i, error: e?.message || "unknown" });
      }
    }

    if (inserted.length === 0) {
      // nada deu certo → 400 para o front não tentar formatos alternativos e não duplicar
      return res
        .status(400)
        .json({ inserted: 0, failed: failed.length, errors: failed });
    }

    // houve ao menos um sucesso → 201 com resumo
    return res
      .status(201)
      .json({
        items: inserted,
        inserted: inserted.length,
        failed: failed.length,
        errors: failed,
      });
  } catch (err) {
    next(err);
  }
}

// PATCH /services/:id
export async function updateService(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params as { id: string };
    if (!isObjectId(id)) return res.status(400).json({ error: "Invalid id" });

    try {
      const link = await getFirstPaymentLink(id);
      if (link) {
        return res.status(409).json({
          error: "locked",
          message: "Service is linked to a payment and cannot be modified.",
          paymentId: link.paymentId,
          paymentStatus: link.status,
        });
      }
    } catch {}

    const patch: any = { ...(req.body || {}) };
    delete patch._id;
    delete patch.id;
    if (patch.status) patch.status = normalizeStatus(patch.status);
    if (patch.serviceDate !== undefined)
      patch.serviceDate = coerceServiceDate(patch.serviceDate) ?? undefined;

    const updated = await Service.findByIdAndUpdate(
      id,
      { $set: patch },
      { new: true, runValidators: true, upsert: false }
    ).collation({ locale: "en", strength: 2 });

    if (!updated) return res.status(404).json({ error: "Not found" });

    res.json({
      ...(updated.toObject() as any),
      paymentId: null,
      paymentStatus: null,
      isLocked: false,
    });
  } catch (err) {
    next(err);
  }
}

// DELETE /services/:id
export async function deleteService(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params as { id: string };
    if (!isObjectId(id)) return res.status(400).json({ error: "Invalid id" });

    try {
      const link = await getFirstPaymentLink(id);
      if (link) {
        return res.status(409).json({
          error: "locked",
          message: "Service is linked to a payment and cannot be deleted.",
          paymentId: link.paymentId,
          paymentStatus: link.status,
        });
      }
    } catch {}

    const del = await Service.findByIdAndDelete(id).lean();
    if (!del) return res.status(404).json({ error: "Not found" });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/* ========= BULK DELETE ========= */
function parseIdsFromReq(req: Request): string[] {
  const out = new Set<string>();

  // ?ids=csv | ?ids=a&ids=b
  const qIds = (req.query as any).ids;
  if (Array.isArray(qIds)) {
    qIds.forEach((v) =>
      String(v)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => out.add(id))
    );
  } else if (qIds) {
    String(qIds)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => out.add(id));
  }

  // ?ids[]=a&ids[]=b
  const qIdsArray = (req.query as any)["ids[]"];
  if (Array.isArray(qIdsArray)) {
    qIdsArray
      .map((s) => String(s).trim())
      .filter(Boolean)
      .forEach((id) => out.add(id));
  } else if (qIdsArray) {
    out.add(String(qIdsArray).trim());
  }

  // body { ids: [...] }
  const bodyIds = Array.isArray((req.body as any)?.ids)
    ? (req.body as any).ids
    : [];
  bodyIds
    .map((s: any) => String(s).trim())
    .filter(Boolean)
    .forEach((id: string) => out.add(id));

  return Array.from(out).filter(isObjectId);
}

export async function deleteManyServices(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = parseIdsFromReq(req);
    if (!ids.length) return res.status(400).json({ error: "Missing ids" });

    // tenta descobrir bloqueados por pagamento — mas sem derrubar a rota
    let linkedSet = new Set<string>();
    const Payment = getPaymentModel();

    if (Payment) {
      try {
        const objIds = ids.map((s) => new Types.ObjectId(s));
        const [byStr, byObj] = await Promise.all([
          Payment.find({ serviceIds: { $in: ids } }, { serviceIds: 1 }).lean(),
          Payment.find({ serviceIds: { $in: objIds } }, { serviceIds: 1 }).lean(),
        ]);
        [...byStr, ...byObj].forEach((p: any) =>
          (p.serviceIds || []).forEach((sid: any) =>
            linkedSet.add(String(sid))
          )
        );
      } catch {
        linkedSet = new Set(); // degrade
      }
    }

    const free = ids.filter((id) => !linkedSet.has(id));
    const linked = ids.filter((id) => linkedSet.has(id));

    let deleted = 0;
    if (free.length) {
      const CHUNK = 500;
      for (let i = 0; i < free.length; i += CHUNK) {
        const slice = free.slice(i, i + CHUNK);
        const r = await Service.deleteMany({ _id: { $in: slice } });
        deleted += r.deletedCount || 0;
      }
    }

    return res.json({
      deleted,
      blocked: linked.length,
      blockedIds: linked,
      processedIds: ids.length,
    });
  } catch (err) {
    // última proteção: evitar 500
    try {
      return res.status(200).json({
        deleted: 0,
        blocked: 0,
        blockedIds: [],
        processedIds: 0,
        warn: "degraded_mode",
      });
    } catch {
      next(err);
    }
  }
}

/* ========================= Export ========================= */
const ServiceController = {
  listServices,
  getService,
  createService,
  bulkCreateServices,
  updateService,
  deleteService,
  deleteManyServices,
};

export default ServiceController;
