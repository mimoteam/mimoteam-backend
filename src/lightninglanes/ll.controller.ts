// src/lightninglanes/ll.controller.ts
import type { Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import mongoose, { Types } from "mongoose";
import LightningLaneModel, { type LaneStatus } from "./ll.model";

/* ===== Helpers ===== */
function titleCaseName(input?: string) {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return "";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.replace(/^\p{L}/u, (c) => c.toLocaleUpperCase())).join(" ");
}
function parseVisitDate(d?: string) {
  const s = String(d || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const iso = Date.parse(s);
    return isNaN(iso) ? null : new Date(iso);
  }
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
}
const ALLOWED_STATUS = ["pending", "approved", "rejected", "paid"] as const;
const isLaneStatus = (v: unknown): v is LaneStatus =>
  typeof v === "string" && (ALLOWED_STATUS as readonly string[]).includes(v);

function dbReady() {
  try { return mongoose.connection && mongoose.connection.readyState === 1; }
  catch { return false; }
}

/** GET /lanes?status=pending&page=1&pageSize=50&mine=true|false
 *  (ordenado por createdAt desc, depois visitDate desc)
 */
export async function listLanes(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || "50"), 10) || 50));

  try {
    if (!dbReady()) {
      console.warn("[LANES][LIST] DB not connected yet → empty list");
      return res.json({ items: [], total: 0, page, pageSize });
    }

    const me = (req as any).user;
    const meId = me?._id ? String(me._id) : "";
    const role = String(me?.role || "").toLowerCase();

    const mineParam = (req.query.mine ?? "true").toString().toLowerCase() !== "false";
    const mine = !!meId && mineParam;

    const and: any[] = [];

    // Dono (aceita ObjectId ou string legada)
    if (mine || role === "partner") {
      if (!meId) return res.json({ items: [], total: 0, page, pageSize });
      const byOwner: any[] = [{ partnerId: meId }];
      if (Types.ObjectId.isValid(meId)) byOwner.push({ partnerId: new Types.ObjectId(meId) });
      and.push({ $or: byOwner });
    }

    // Status opcional
    const rawStatus = String(req.query.status || "").trim();
    if (isLaneStatus(rawStatus)) and.push({ status: rawStatus });

    const q = and.length ? { $and: and } : {};

    if (req.query.debug === "1") {
      console.log("[LANES][DEBUG] role=", role, "mine=", mine, "meId=", meId);
      console.log("[LANES][DEBUG] filter=", JSON.stringify(q, null, 2));
    }

    const [items, total] = await Promise.all([
      LightningLaneModel.find(q)
        .sort({ createdAt: -1, visitDate: -1, _id: -1 }) // <<< mais recentes primeiro
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
      LightningLaneModel.countDocuments(q).exec(),
    ]);

    return res.json({ items, total, page, pageSize });
  } catch (e: any) {
    console.error("[LANES][LIST] ERROR:", e?.stack || e?.message || e);
    return res.json({ items: [], total: 0, page, pageSize });
  }
}

/** POST /lanes */
export async function createLane(req: Request, res: Response) {
  const user = (req as any).user;
  const rawId = user?._id ? String(user._id) : "";
  if (!rawId) return res.status(401).json({ message: "Unauthorized" });

  const partnerRef: any = Types.ObjectId.isValid(rawId) ? new Types.ObjectId(rawId) : rawId;

  const {
    clientName, laneType, amount, paymentMethod, cardLast4, visitDate, observation
  } = req.body || {};

  if (!clientName || !laneType || !paymentMethod) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const lane = await LightningLaneModel.create({
    partnerId: partnerRef,
    clientName: titleCaseName(clientName),
    laneType,
    amount: Number(amount || 0),
    paymentMethod,
    cardLast4: paymentMethod === "mimo_card" ? String(cardLast4 || "").slice(-4) : null,
    visitDate: parseVisitDate(visitDate),
    observation: String(observation || "").trim(), // <<< salva observação
    receipts: [],
    status: "pending" as LaneStatus,
  });

  res.status(201).json({ lane });
}

/** PATCH /lanes/:id */
export async function updateLane(req: Request, res: Response) {
  const id = String(req.params.id || "");
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid id" });

  const role = String((req as any).user?.role || "").toLowerCase();
  const meId = (req as any).user?._id;

  const lane = await LightningLaneModel.findById(id);
  if (!lane) return res.status(404).json({ message: "Not found" });

  const isOwner = lane.partnerId?.toString() === String(meId || "");
  const canEditAll = role === "admin" || role === "finance";

  const patch: any = {};
  const body = req.body || {};

  if (canEditAll && body.status) {
    const s = String(body.status);
    if (!isLaneStatus(s)) return res.status(400).json({ message: "Invalid status" });
    patch.status = s;
  }
  if (isOwner || canEditAll) {
    if (body.clientName) patch.clientName = titleCaseName(body.clientName);
    if (body.laneType) patch.laneType = body.laneType;
    if (body.amount != null) patch.amount = Number(body.amount);
    if (body.paymentMethod) patch.paymentMethod = body.paymentMethod;
    if (body.cardLast4 != null)
      patch.cardLast4 = body.paymentMethod === "mimo_card"
        ? String(body.cardLast4 || "").slice(0, 4)
        : null;
    if (body.visitDate) patch.visitDate = parseVisitDate(body.visitDate);
    if (body.observation !== undefined) patch.observation = String(body.observation || "").trim(); // <<< atualiza observação
  }

  Object.assign(lane, patch);
  await lane.save();
  res.json({ lane });
}

/** DELETE /lanes/:id — remove o serviço inteiro + recibos */
export async function deleteLane(req: Request, res: Response) {
  const id = String(req.params.id || "");
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid id" });

  const role = String((req as any).user?.role || "").toLowerCase();
  const meId = (req as any).user?._id;

  const lane = await LightningLaneModel.findById(id);
  if (!lane) return res.status(404).json({ message: "Not found" });

  const isOwner = lane.partnerId?.toString() === String(meId || "");
  const canDeleteAll = role === "admin" || role === "finance";
  if (!isOwner && !canDeleteAll) return res.status(403).json({ message: "Forbidden" });

  for (const url of lane.receipts || []) {
    try {
      const fileName = url.split("/").pop() || "";
      const abs = path.resolve(process.cwd(), "uploads", "lanes", fileName);
      await fs.unlink(abs).catch(() => {});
    } catch {}
  }

  await lane.deleteOne();
  res.json({ ok: true, deletedId: id });
}

/** POST /lanes/:id/receipts  (multipart) */
export async function addReceipts(req: Request, res: Response) {
  const id = String(req.params.id || "");
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid id" });

  const files = (req.files as Express.Multer.File[]) || [];
  const urls = files.map((f) => `/uploads/lanes/${path.basename(f.filename)}`);

  const lane = await LightningLaneModel.findByIdAndUpdate(
    id,
    { $push: { receipts: { $each: urls } } },
    { new: true }
  ).lean();

  if (!lane) return res.status(404).json({ message: "Not found" });
  res.json({ lane, added: urls });
}

/** DELETE /lanes/:id/receipts?url=/uploads/lanes/xxx.jpg */
export async function removeReceipt(req: Request, res: Response) {
  const id = String(req.params.id || "");
  const url = String(req.query.url || "");
  if (!Types.ObjectId.isValid(id) || !url) return res.status(400).json({ message: "Invalid request" });

  const lane = await LightningLaneModel.findByIdAndUpdate(
    id,
    { $pull: { receipts: url } },
    { new: true }
  );

  try {
    const fileName = url.split("/").pop() || "";
    const abs = path.resolve(process.cwd(), "uploads", "lanes", fileName);
    await fs.unlink(abs).catch(() => {});
  } catch {}

  if (!lane) return res.status(404).json({ message: "Not found" });
  res.json({ lane });
}
