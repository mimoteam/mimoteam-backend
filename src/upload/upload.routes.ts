import { Router } from "express";
import { uploadAvatarMulter } from "../middleware/uploadAvatar";
import User from "../users/user.model";

const router = Router();

/**
 * POST /upload/avatar?userId=...
 * Campo do arquivo no form-data: "file"
 */
router.post("/avatar", uploadAvatarMulter.single("file"), async (req, res, next) => {
  try {
    const userId = (req.query.userId as string) || (req.body?.userId as string);
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filename = req.file.filename;
    const publicPath = `/uploads/avatars/${filename}`;

    // salva URL no usuário (ignora se não achar)
    await User.findByIdAndUpdate(userId, { avatarUrl: publicPath }, { new: true }).lean();

    return res.status(201).json({ url: publicPath, avatarUrl: publicPath });
  } catch (err) {
    next(err);
  }
});

export default router;
