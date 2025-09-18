import type { Request, Response, NextFunction } from "express";
import Billing from "./billing.model"; // seu model Mongoose

// Lista
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 50));
    const onlyPending = String(req.query.onlyPending || "").toLowerCase() === "true";

    const filter: any = {};
    if (onlyPending) filter.status = "TO_BE_ADD";

    const [items, total] = await Promise.all([
      Billing.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Billing.countDocuments(filter),
    ]);

    res.json({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (e) {
    next(e);
  }
}

// Criar
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await Billing.create({
      client: req.body.client,
      service: req.body.service,
      type: req.body.type,
      observation: req.body.observation,
      amount: Number(req.body.amount || 0),
      status: (req.body.status || "TO_BE_ADD").toUpperCase(),
    });
    res.status(201).json({ item: doc });
  } catch (e) {
    next(e);
  }
}

// Atualização “completa” (rota antiga PUT /:id)
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const patch: any = { ...req.body };
    if (patch.amount != null) patch.amount = Number(patch.amount);
    if (patch.status) patch.status = String(patch.status).toUpperCase();

    const doc = await Billing.findByIdAndUpdate(id, patch, { new: true });
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.json({ item: doc });
  } catch (e) {
    next(e);
  }
}

// ✅ Atualizar **apenas** o status (PATCH /:id/status)
export async function updateStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id || req.params["id"];
    const status = String(req.body?.status || "").toUpperCase();
    if (!["ADDED", "TO_BE_ADD"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const doc = await Billing.findByIdAndUpdate(id, { status }, { new: true });
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.json({ item: doc });
  } catch (e) {
    next(e);
  }
}

// Remover
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const r = await Billing.deleteOne({ _id: id });
    if (!r.deletedCount) return res.status(404).json({ message: "Not found" });
    // 204 sem body deixa o fetch feliz
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}

// ✅ Limpar todos (DELETE /)
export async function clear(_req: Request, res: Response, next: NextFunction) {
  try {
    await Billing.deleteMany({});
    res.json({ ok: true, cleared: true });
  } catch (e) {
    next(e);
  }
}
