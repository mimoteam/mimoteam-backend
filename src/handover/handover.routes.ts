// src/handover/handover.routes.ts
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import HandoverModel from "./handover.model";
import { ListHandoverQuerySchema, CreateHandoverSchema, AddCommentSchema } from "./handover.schemas";

const router = Router();
const BASE_PROJECTION = { __v: 0 } as const;
const IdParam = z.object({ id: z.string().length(24) });

function actor(req: Request) {
  const any = req as any;
  const u = any.user || any.auth || {};
  return {
    id: u.id || u._id || u.userId || null,
    name: u.fullName || u.name || u.login || u.email || "Admin",
    role: u.role || "admin",
  };
}

// GET /handover
router.get("/", async (req: Request, res: Response) => {
  try {
    const parsed = ListHandoverQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "invalid query" });

    const { q, type, tag, from, to, page, pageSize, includeTotal } = parsed.data;

    const filter: any = {};
    if (type) filter.type = type;
    if (tag) filter.tag = tag;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }

    let useText = false;
    if (q && q.trim().length >= 2) {
      filter.$text = { $search: q.trim() };
      useText = true;
    } else if (q) {
      const rx = new RegExp(q, "i");
      filter.$or = [{ body: rx }, { "comments.body": rx }];
    }

    const skip = (page - 1) * pageSize;
    const sort: any = useText ? { score: { $meta: "textScore" }, createdAt: -1 } : { createdAt: -1 };
    const projection: any = useText ? { ...BASE_PROJECTION, score: { $meta: "textScore" } } : BASE_PROJECTION;

    let qy = HandoverModel.find(filter).select(projection).sort(sort).skip(skip).limit(pageSize).lean();
    if (!useText && type && !tag && !q) qy = qy.hint({ type: 1, createdAt: -1 });
    if (!useText && tag && !type && !q) qy = qy.hint({ tag: 1, createdAt: -1 });
    if (!useText && !type && !tag && !q && !(from || to)) qy = qy.hint({ createdAt: -1 });

    const listPromise = qy.exec();
    const countPromise = includeTotal
      ? (q || type || tag || from || to
          ? HandoverModel.countDocuments(filter).exec()
          : HandoverModel.estimatedDocumentCount().exec())
      : Promise.resolve(undefined);

    const [items, total] = await Promise.all([listPromise, countPromise]);
    const clean = items.map(({ score, ...rest }: any) => rest);

    const payload: any = { items: clean, page, pageSize };
    if (includeTotal) payload.total = total;
    res.json(payload);
  } catch (e) {
    console.error("[handover:list] error:", e);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /handover
router.post("/", async (req: Request, res: Response) => {
  try {
    const parsed = CreateHandoverSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid body" });

    const a = actor(req);
    const doc = await HandoverModel.create({
      ...parsed.data,
      authorId: a.id,
      authorName: a.name,
    });

    res.status(201).json(doc.toObject());
  } catch (e) {
    console.error("[handover:create] error:", e);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /handover/:id/comments
router.post("/:id/comments", async (req: Request, res: Response) => {
  try {
    const pid = IdParam.safeParse(req.params);
    if (!pid.success) return res.status(400).json({ error: "invalid id" });

    const parsed = AddCommentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid body" });

    const a = actor(req);

    const updated = await HandoverModel.findByIdAndUpdate(
      pid.data.id,
      {
        $push: {
          comments: {
            body: parsed.data.body,
            authorId: a.id,
            authorName: a.name,
            createdAt: new Date(),
          },
        },
      },
      { new: true, projection: BASE_PROJECTION }
    ).lean();

    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  } catch (e) {
    console.error("[handover:addComment] error:", e);
    res.status(500).json({ error: "internal error" });
  }
});

// DELETE /handover/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const pid = IdParam.safeParse(req.params);
    if (!pid.success) return res.status(400).json({ error: "invalid id" });

    const deleted = await HandoverModel.findByIdAndDelete(pid.data.id).select("_id").lean();
    if (!deleted) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("[handover:delete] error:", e);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
