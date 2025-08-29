import multer from "multer";
import path from "path";
import { AVATARS_DIR } from "../config/uploads";

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, AVATARS_DIR);
  },
  filename(_req, file, cb) {
    const ext = (path.extname(file.originalname) || ".jpg").toLowerCase();
    const name = `${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  },
});

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) return cb(null, true);
  cb(new Error("Invalid file type. Only images are allowed."));
};

export const uploadAvatarMulter = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});
