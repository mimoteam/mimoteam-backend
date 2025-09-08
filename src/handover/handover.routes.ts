import { Router } from "express";
import { Handover } from "./handover.model";
import { ListHNQuerySchema, CreateHNNoteSchema, AddCommentSchema } from "./handover.schemas";

const router = Router();

// GET /handover
router.get("/", async (req, res, next) => {
  try {
    const q = ListHNQuerySchema.parse(req.query);
    const filter: any = {};
    if (q.type) filter.type = q.type;
    if (q.tag) filter.tag = q.tag;
    if (q.q) filter.$or = [{ body: { $regex: q.q, $options: "i" } }, { "comments.body": { $regex: q.q, $options: "i" } }];

    const skip = (q.page - 1) * q.pageSize;
    const query = Handover.find(filter).sort({ createdAt: -1 }).skip(skip).limit(q.pageSize);

    const [items, total] = await Promise.all([
      query.lean(),
      q.includeTotal ? Handover.countDocuments(filter) : Promise.resolve(0),
    ]);

    res.json({ items, page: q.page, pageSize: q.pageSize, total });
  } catch (err) { next(err); }
});

// POST /handover
router.post("/", async (req, res, next) => {
  try {
    const body = CreateHNNoteSchema.parse(req.body);
    const created = await Handover.create({
      ...body,
      author: req.user?._id ?? null,
      authorName: req.user?.fullName || req.user?.name || req.user?.email || "Admin",
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// DELETE /handover/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const ok = await Handover.findByIdAndDelete(id);
    if (!ok) return res.status(404).json({ message: "Note not found" });
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /handover/:id/comments
router.post("/:id/comments", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const { body } = AddCommentSchema.parse(req.body);
    const note = await Handover.findById(id);
    if (!note) return res.status(404).json({ message: "Note not found" });
    note.comments.push({
      body,
      author: req.user?._id ?? null,
      authorName: req.user?.fullName || req.user?.name || req.user?.email || "Admin",
    } as any);
    await note.save();
    res.json(note);
  } catch (err) { next(err); }
});

export default router;
