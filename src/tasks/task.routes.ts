// src/tasks/task.routes.ts
import { Router, type Request, type Response } from "express";
import TaskModel from "./task.model";
import { CreateTaskSchema, UpdateTaskSchema, ListTasksQuerySchema } from "./task.schemas";
import { z } from "zod";

const router = Router();

// projeção base
const BASE_PROJECTION = { __v: 0 } as const;

function actor(req: Request) {
  const any = req as any;
  const u = any.user || any.auth || {};
  return {
    id: u.id || u._id || u.userId || null,
    name: u.fullName || u.name || u.login || u.email || "Admin",
    role: u.role || "admin",
  };
}

const IdParam = z.object({ id: z.string().length(24) });

router.get("/", async (req: Request, res: Response) => {
  try {
    const parsed = ListTasksQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "invalid query" });

    const { q, completed, assignedToId, page, pageSize, includeTotal } = parsed.data;

    const filter: any = {};
    if (typeof completed === "boolean") filter.completed = completed;
    if (assignedToId) filter.assignedToId = assignedToId;

    let useText = false;
    if (q && q.trim().length >= 2) {
      filter.$text = { $search: q.trim() };
      useText = true;
    } else if (q) {
      const rx = new RegExp(q, "i");
      filter.text = rx;
    }

    const skip = (page - 1) * pageSize;
    const sort: any = useText ? { score: { $meta: "textScore" }, createdAt: -1 } : { createdAt: -1 };
    const projection: any = useText ? { ...BASE_PROJECTION, score: { $meta: "textScore" } } : BASE_PROJECTION;

    let qy = TaskModel.find(filter).select(projection).sort(sort).skip(skip).limit(pageSize).lean();
    if (!useText && typeof completed === "boolean") qy = qy.hint({ completed: 1, createdAt: -1 });
    if (!useText && !assignedToId && typeof completed !== "boolean" && !q) qy = qy.hint({ createdAt: -1 });

    const listPromise = qy.exec();
    const countPromise = includeTotal
      ? (q || typeof completed === "boolean" || assignedToId
          ? TaskModel.countDocuments(filter).exec()
          : TaskModel.estimatedDocumentCount().exec())
      : Promise.resolve(undefined);

    const [items, total] = await Promise.all([listPromise, countPromise]);
    const clean = items.map(({ score, ...rest }: any) => rest);

    const payload: any = { items: clean, page, pageSize };
    if (includeTotal) payload.total = total;

    res.json(payload);
  } catch (e) {
    console.error("[tasks:list] error:", e);
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const parsed = CreateTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid body" });

    const a = actor(req);
    const doc = await TaskModel.create({
      ...parsed.data,
      createdById: a.id,
      createdByName: a.name,
    });

    res.status(201).json(doc.toObject());
  } catch (e) {
    console.error("[tasks:create] error:", e);
    res.status(500).json({ error: "internal error" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const pid = IdParam.safeParse(req.params);
    if (!pid.success) return res.status(400).json({ error: "invalid id" });

    const parsed = UpdateTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid body" });

    const updated = await TaskModel.findByIdAndUpdate(pid.data.id, parsed.data, {
      new: true,
      runValidators: true,
      projection: BASE_PROJECTION,
    }).lean();

    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  } catch (e) {
    console.error("[tasks:update] error:", e);
    res.status(500).json({ error: "internal error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const pid = IdParam.safeParse(req.params);
    if (!pid.success) return res.status(400).json({ error: "invalid id" });

    const deleted = await TaskModel.findByIdAndDelete(pid.data.id).select("_id").lean();
    if (!deleted) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("[tasks:delete] error:", e);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
