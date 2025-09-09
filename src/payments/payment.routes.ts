// src/payments/payment.routes.ts
import { Router, type Request, type Response, type NextFunction } from "express";
import mongoose from "mongoose";
import PaymentModel from "./payment.model";
import UserModel from "../users/user.model";

type AnyDoc = Record<string, any>;
const router = Router();

/* ── util: wrapper anti-unhandled-rejection ─────────────────── */
const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/* ── util: paginação/ordenacao ──────────────────────────────── */
function getPage(req: Request) {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize || 50)));
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip, limit: pageSize };
}

function getSort(req: Request) {
  const sortBy = String(req.query.sortBy || "_id");
  const dir = String(req.query.sortDir || "desc").toLowerCase() === "asc" ? 1 : -1;
  return { [sortBy]: dir } as AnyDoc;
}

/* ── util: filtro simples (partner/status/intervalo) ────────── */
function buildFilter(req: Request) {
  const q: AnyDoc = {};
  const partnerId = (req.query.partnerId || req.query.partner) as string | undefined;
  const status = req.query.status as string | undefined;

  if (partnerId) q.partnerId = String(partnerId);
  if (status) q.status = String(status);

  // datas aceitando from/to ou dateFrom/dateTo
  const from = (req.query.from || req.query.dateFrom) as string | undefined;
  const to   = (req.query.to   || req.query.dateTo)   as string | undefined;
  if (from || to) {
    const gte = from ? new Date(from) : undefined;
    const lte = to   ? new Date(to)   : undefined;
    // cobre period* ou week* conforme existir
    q.$or = [
      {
        periodFrom: { ...(gte ? { $lte: lte ?? new Date("9999-12-31") } : {}) },
        periodTo:   { ...(lte ? { $gte: gte ?? new Date("0001-01-01") } : {}) },
      },
      {
        weekStart:  { ...(gte ? { $lte: lte ?? new Date("9999-12-31") } : {}) },
        weekEnd:    { ...(lte ? { $gte: gte ?? new Date("0001-01-01") } : {}) },
      },
    ];
  }

  return q;
}

/* ── DIAGNÓSTICO ────────────────────────────────────────────── */
router.get(
  "/__diag",
  ah(async (_req, res) => {
    const state = mongoose.connection.readyState; // 1=connected
    let count = 0;
    try {
      count = await PaymentModel.estimatedDocumentCount().maxTimeMS(3000);
    } catch {}
    res.json({
      ok: true,
      mongoose: state,
      count,
      time: new Date().toISOString(),
      model: "Payment",
      note: "se isso responde, o router está montado e o db alcançável",
    });
  })
);

/* ── SERVICE → STATUS (declarado ANTES de '/:id') ───────────── */
router.get(
  "/service-status",
  ah(async (req, res) => {
    try {
      const idsParam = String(req.query.ids || "");
      const requested = idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (requested.length === 0) return res.json({ items: [] });

      // partner guard (partner só enxerga os dele)
      const user = (req as any).user;
      const baseFilter: AnyDoc = {};
      if (user?.role?.toLowerCase() === "partner") {
        baseFilter.partnerId = String(user.id || user._id);
      }

      // buscamos pagamentos (sem filtrar por serviceIds no Mongo para evitar CastError)
      const proj: AnyDoc = {
        _id: 1,
        status: 1,
        serviceIds: 1,
        items: 1,
        services: 1,
      };

      const docs = await PaymentModel.find(baseFilter, proj)
        .lean()
        .maxTimeMS(8000);

      const wanted = new Set(requested.map(String));
      const items: Array<{ serviceId: string; paymentId: string; status: string }> = [];

      const pushMaybe = (acc: Set<string>, anyVal: any) => {
        const s = String(
          anyVal?._id ??
            anyVal?.id ??
            anyVal?.service ??
            anyVal?.serviceId ??
            anyVal ??
            ""
        );
        if (s) acc.add(s);
      };

      for (const p of docs as AnyDoc[]) {
        const found = new Set<string>();

        if (Array.isArray(p.serviceIds)) {
          for (const sid of p.serviceIds) pushMaybe(found, sid);
        }
        if (Array.isArray(p.items)) {
          for (const it of p.items) pushMaybe(found, it);
        }
        if (Array.isArray(p.services)) {
          for (const sv of p.services) pushMaybe(found, sv);
        }

        for (const sid of found) {
          if (wanted.has(sid)) {
            items.push({
              serviceId: sid,
              paymentId: String(p._id),
              status: String(p.status || "PENDING"),
            });
          }
        }
      }

      return res.json({ items });
    } catch (e) {
      console.error("[payments][service-status] error:", e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  })
);

/* ── (opcional) eligible stub para não conflitar com '/:id' ─── */
router.get(
  "/eligible",
  ah(async (req, res) => {
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 50);
    res.json({ items: [], total: 0, page, pageSize, totalPages: 0 });
  })
);

/* ── LIST ───────────────────────────────────────────────────── */
router.get(
  "/",
  ah(async (req, res) => {
    res.setTimeout(12000);

    const { page, pageSize, skip, limit } = getPage(req);
    const sort = getSort(req);
    const filter = buildFilter(req);

    // parceiro só enxerga os próprios pagamentos
    const user = (req as any).user;
    if (user?.role?.toLowerCase() === "partner") {
      filter.partnerId = String(user.id || user._id);
    }

    const proj: AnyDoc = {
      _id: 1,
      status: 1,
      partnerId: 1,
      partnerName: 1, // se existir no schema
      periodFrom: 1,
      periodTo: 1,
      weekStart: 1,
      weekEnd: 1,
      serviceIds: 1,
      total: 1,          // ← total canônico
      totalAmount: 1,    // ← compat legado
      notes: 1,
      notesLog: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    const [items, total] = await Promise.all([
      PaymentModel.find(filter, proj).sort(sort).skip(skip).limit(limit).lean().maxTimeMS(8000),
      PaymentModel.countDocuments(filter).maxTimeMS(5000),
    ]);

    // Normalização conservadora (sem alterar schema):
    const normalized = items.map((p: AnyDoc) => {
      const id = String(p._id);
      const totalValue =
        (typeof p.total === "number" ? p.total : undefined) ??
        (typeof p.totalAmount === "number" ? p.totalAmount : 0);

      const partnerName =
        p.partnerName || p?.partner?.name || p?.partner?.fullName || "";

      return {
        ...p,
        id,
        partnerName,
        total: totalValue,
        serviceIds: Array.isArray(p.serviceIds) ? p.serviceIds.map((s: any) => String(s)) : [],
      };
    });

    res.json({
      items: normalized,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  })
);

/* ── GET ONE ─────────────────────────────────────────────────── */
router.get(
  "/:id",
  ah(async (req, res) => {
    const id = String(req.params.id);
    const row = await PaymentModel.findById(id).lean().maxTimeMS(6000);
    if (!row) return res.status(404).json({ message: "Payment not found" });

    const user = (req as any).user;
    if (user?.role?.toLowerCase() === "partner" && String(row.partnerId) !== String(user.id || user._id)) {
      return res.status(404).json({ message: "Payment not found" });
    }

    (row as AnyDoc).id = String((row as AnyDoc)._id);
    if (!(row as AnyDoc).partnerName) {
      (row as AnyDoc).partnerName = (row as AnyDoc).partner?.name || (row as AnyDoc).partner?.fullName || "";
    }
    if (typeof (row as AnyDoc).total !== "number") {
      (row as AnyDoc).total = typeof (row as AnyDoc).totalAmount === "number" ? (row as AnyDoc).totalAmount : 0;
    }

    return res.json(row);
  })
);

/* ── CREATE ──────────────────────────────────────────────────── */
router.post(
  "/",
  ah(async (req, res) => {
    const body = req.body || {};

    const data: AnyDoc = {
      partnerId: body.partnerId || body.partner || null,
      periodFrom: body.periodFrom || body.weekStart || null,
      periodTo: body.periodTo || body.weekEnd || null,
      weekStart: body.weekStart || null,
      weekEnd: body.weekEnd || null,
      serviceIds: Array.isArray(body.serviceIds)
        ? body.serviceIds.map(String)
        : [],
      // total canônico (aceita legado totalAmount)
      total: typeof body.total === "number" ? body.total
           : (typeof body.totalAmount === "number" ? body.totalAmount : 0),
      notes: body.notes ?? "",
    };

    // Só seta status se veio e normaliza para UPPERCASE; senão deixa o default do schema
    if (typeof body.status === "string" && body.status.trim()) {
      data.status = String(body.status).trim().toUpperCase();
    }

    // Best-effort: preencher partnerName na criação
    if (data.partnerId) {
      try {
        const u = await UserModel.findById(String(data.partnerId), { fullName: 1, name: 1 }).lean();
        data.partnerName = u?.fullName || "";
      } catch {}
    }

    const created = await PaymentModel.create(data);
    res.status(201).json({ ...created.toObject(), id: String(created._id) });
  })
);

/* ── UPDATE ──────────────────────────────────────────────────── */
router.patch(
  "/:id",
  ah(async (req, res) => {
    const id = String(req.params.id);
    const user = (req as any).user;

    // parceiro só pode atualizar os seus
    const guard = user?.role?.toLowerCase() === "partner" ? { _id: id, partnerId: String(user.id || user._id) } : { _id: id };

    const upd: AnyDoc = { ...req.body };
    if (upd.appendNote && upd.notes) {
      const note = { id: new Date().getTime().toString(36), at: new Date().toISOString(), text: String(upd.notes) };
      delete upd.appendNote;
      upd.$push = { ...(upd.$push || {}), notesLog: note };
    }

    const row = await PaymentModel.findOneAndUpdate(guard, upd, { new: true, runValidators: false })
      .lean()
      .maxTimeMS(6000);

    if (!row) return res.status(404).json({ message: "Payment not found" });
    (row as AnyDoc).id = String(row._id);
    // pós-update: garantir consistência nos campos exibidos pelo front (opcional, mas seguro)
    if (!(row as AnyDoc).partnerName) {
      (row as AnyDoc).partnerName = (row as AnyDoc).partner?.name || (row as AnyDoc).partner?.fullName || "";
    }
    if (typeof (row as AnyDoc).total !== "number") {
      (row as AnyDoc).total = typeof (row as AnyDoc).totalAmount === "number" ? (row as AnyDoc).totalAmount : 0;
    }
    res.json(row);
  })
);

/* ── ADD service → payment ───────────────────────────────────── */
router.post(
  "/:id/items",
  ah(async (req, res) => {
    const id = String(req.params.id);
    const serviceId = String(req.body?.serviceId || "");
    if (!serviceId) return res.status(400).json({ message: "serviceId obrigatório" });

    const user = (req as any).user;
    const guard = user?.role?.toLowerCase() === "partner" ? { _id: id, partnerId: String(user.id || user._id) } : { _id: id };

    const row = await PaymentModel.findOneAndUpdate(
      guard,
      { $addToSet: { serviceIds: serviceId } },
      { new: true }
    ).lean().maxTimeMS(6000);

    if (!row) return res.status(404).json({ message: "Payment not found" });
    (row as AnyDoc).id = String(row._id);
    res.json(row);
  })
);

/* ── REMOVE service de payment ───────────────────────────────── */
router.delete(
  "/:id/items/:serviceId",
  ah(async (req, res) => {
    const id = String(req.params.id);
    const serviceId = String(req.params.serviceId);

    const user = (req as any).user;
    const guard = user?.role?.toLowerCase() === "partner" ? { _id: id, partnerId: String(user.id || user._id) } : { _id: id };

    const row = await PaymentModel.findOneAndUpdate(
      guard,
      { $pull: { serviceIds: serviceId } },
      { new: true }
    ).lean().maxTimeMS(6000);

    if (!row) return res.status(404).json({ message: "Payment not found" });
    (row as AnyDoc).id = String(row._id);
    res.json(row);
  })
);

/* ── RECALC stub ─────────────────────────────────────────────── */
router.post(
  "/:id/recalc",
  ah(async (_req, res) => {
    res.json({ ok: true, message: "recalc stub (implementar se necessário)" });
  })
);

/* — DELETE payment — */
router.delete(
  "/:id",
  ah(async (req, res) => {
    const id = String(req.params.id);
    const user = (req as any).user;
    const guard = user?.role?.toLowerCase() === "partner"
      ? { _id: id, partnerId: String(user.id || user._id) }
      : { _id: id };

    const del = await PaymentModel.findOneAndDelete(guard).lean().maxTimeMS(6000);
    if (!del) return res.status(404).json({ message: "Payment not found" });
    return res.json({ ok: true });
  })
);

export default router;
export { router };
