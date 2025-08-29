// backend/src/services/service.controller.ts
import { Request, Response } from "express";
import { type SortOrder } from "mongoose";
import { Service as ServiceModel } from "./service.model"; // <-- import nomeado

type AnyQuery = Record<string, any>;

const toInt = (v: unknown, fb: number) => {
  const n = parseInt(String(v));
  return Number.isFinite(n) ? n : fb;
};

function parsePagination(q: AnyQuery) {
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

export async function listServices(req: Request, res: Response) {
  try {
    const { page, pageSize, skip } = parsePagination(req.query);
    const sortBy = (String(req.query.sortBy || "serviceDate") || "serviceDate").trim();
    const sortDir: SortOrder =
      String(req.query.sortDir || "desc").toLowerCase() === "asc" ? 1 : -1;

    const filter: AnyQuery = {};

    // filtros de acordo com o schema
    if (req.query.partner) filter.partnerId = String(req.query.partner);
    if (req.query.serviceType) filter.serviceTypeId = String(req.query.serviceType);
    if (req.query.team) filter.team = String(req.query.team);
    if (req.query.status) filter.status = String(req.query.status);

    if (req.query.dateFrom || req.query.dateTo) {
      const range: AnyQuery = {};
      if (req.query.dateFrom) range.$gte = new Date(String(req.query.dateFrom));
      if (req.query.dateTo) range.$lte = new Date(String(req.query.dateTo));
      filter.serviceDate = range;
    }

    if (req.query.q) {
      const q = String(req.query.q).trim();
      if (q) {
        filter.$or = [
          { firstName: { $regex: q, $options: "i" } },
          { lastName:  { $regex: q, $options: "i" } },
          { clientName:{ $regex: q, $options: "i" } },
        ];
      }
    }

    const sort: Record<string, SortOrder> = { [sortBy]: sortDir, _id: -1 };

    const [docs, total] = await Promise.all([
      ServiceModel.find(filter).sort(sort).skip(skip).limit(pageSize).lean(),
      ServiceModel.countDocuments(filter),
    ]);

    res.json({
      items: docs,
      total,
      totalRecords: total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      page,
      pageSize,
    });
  } catch (e: any) {
    res.status(500).json({ message: e.message || "Failed to list services" });
  }
}

export async function createService(req: Request, res: Response) {
  try {
    const b = req.body ?? {};
    const finalValue = Number(b.finalValue ?? b.suggestedValue ?? 0);

    const doc = await ServiceModel.create({
      firstName: b.firstName ?? "",
      lastName: b.lastName ?? "",
      serviceDate: b.serviceDate ? new Date(b.serviceDate) : new Date(),
      // partnerId como string + subdoc opcional, de acordo com o schema
      partnerId: b.partnerId ?? (typeof b.partner === "string" ? b.partner : ""),
      partner: typeof b.partner === "object" ? b.partner : null,
      team: b.team ?? "",
      serviceTypeId: b.serviceTypeId ?? (typeof b.serviceType === "string" ? b.serviceType : ""),
      serviceType: typeof b.serviceType === "object" ? b.serviceType : null,
      serviceTime: b.serviceTime ?? null,
      park: b.park ?? "",
      location: b.location ?? "",
      hopper: !!b.hopper,
      guests: b.guests ?? null,
      observations: b.observations ?? "",
      finalValue: Number.isFinite(finalValue) ? finalValue : 0,
      overrideValue: b.overrideValue ?? null,
      calculatedPrice: b.calculatedPrice ?? null,
      status: b.status || "RECORDED",
    });

    res.status(201).json({ item: doc });
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to create service" });
  }
}

export async function bulkCreateServices(req: Request, res: Response) {
  try {
    const body = req.body;
    const items = Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
    if (!items.length) return res.status(400).json({ message: "No items" });

    const docs = await ServiceModel.insertMany(
      items.map((b: any) => ({
        firstName: b.firstName ?? "",
        lastName: b.lastName ?? "",
        serviceDate: b.serviceDate ? new Date(b.serviceDate) : new Date(),
        partnerId: b.partnerId ?? (typeof b.partner === "string" ? b.partner : ""),
        partner: typeof b.partner === "object" ? b.partner : null,
        team: b.team ?? "",
        serviceTypeId: b.serviceTypeId ?? (typeof b.serviceType === "string" ? b.serviceType : ""),
        serviceType: typeof b.serviceType === "object" ? b.serviceType : null,
        serviceTime: b.serviceTime ?? null,
        park: b.park ?? "",
        location: b.location ?? "",
        hopper: !!b.hopper,
        guests: b.guests ?? null,
        observations: b.observations ?? "",
        finalValue: Number(b.finalValue ?? b.suggestedValue ?? 0) || 0,
        overrideValue: b.overrideValue ?? null,
        calculatedPrice: b.calculatedPrice ?? null,
        status: b.status || "RECORDED",
      })),
      { ordered: false }
    );

    res.status(201).json({ inserted: docs.length, items: docs });
  } catch (e: any) {
    res.status(400).json({ message: e.message || "Failed to bulk insert services" });
  }
}
