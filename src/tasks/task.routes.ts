import { Router } from "express";
import { Task } from "./task.model";
import { z } from "zod";
import { ListTaskQuerySchema, CreateTaskSchema, PatchTaskSchema } from "./task.schemas";

const router = Router();

// GET /tasks
router.get("/", async (req, res, next) => {
  try {
    const q = ListTaskQuerySchema.parse(req.query);
    const filter: any = {};
    if (q.q) filter.text = { $regex: q.q, $options: "i" };
    if (typeof q.completed === "boolean") filter.completed = q.completed;
    if (q.status) filter.status = q.status;
    if (q.assignedToId) filter.assignedToId = q.assignedToId;

    const skip = (q.page - 1) * q.pageSize;
    const cursor = Task.find(filter).sort({ updatedAt: -1, createdAt: -1 }).skip(skip).limit(q.pageSize);
    const [items, total] = await Promise.all([
      cursor.lean(),
      q.includeTotal ? Task.countDocuments(filter) : Promise.resolve(0),
    ]);

    res.json({ items, page: q.page, pageSize: q.pageSize, total });
  } catch (err) { next(err); }
});

// POST /tasks
router.post("/", async (req, res, next) => {
  try {
    const body = CreateTaskSchema.parse(req.body);
    const created = await Task.create({
      ...body,
      status: "todo",
      completed: false,
      createdBy: req.user?._id ?? null,
      createdByName: req.user?.fullName || req.user?.name || req.user?.email || "Admin",
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PATCH /tasks/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const patch = PatchTaskSchema.parse(req.body);

    // coerência completed ↔ status
    if (patch.completed === true && !patch.status) patch.status = "done";
    if (patch.status === "done" && patch.completed !== true) patch.completed = true;

    const updated = await Task.findByIdAndUpdate(id, patch, { new: true, runValidators: true }).lean();
    if (!updated) return res.status(404).json({ message: "Task not found" });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /tasks/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const ok = await Task.findByIdAndDelete(id);
    if (!ok) return res.status(404).json({ message: "Task not found" });
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
