import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { auth, authOptional } from "../middleware/auth";
import {
  listLanes,
  createLane,
  updateLane,
  addReceipts,
  removeReceipt,
  deleteLane,
} from "./ll.controller";

const router = Router();

// ===== Multer (upload de recibos) =====
const baseDir = path.resolve(process.cwd(), "uploads", "lanes");
fs.mkdirSync(baseDir, { recursive: true });

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("gif")) return ".gif";
  if (m.includes("heic") || m.includes("heif")) return ".heic";
  if (m.includes("tif")) return ".tif";
  if (m.includes("bmp")) return ".bmp";
  return path.extname(m) || ".jpg";
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, baseDir),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const ext = extFromMime(file.mimetype) || path.extname(file.originalname) || ".jpg";
    const name = (file.fieldname || "files").replace(/[^\w-]+/g, "").slice(0, 32) || "files";
    cb(null, `${name}-${ts}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.mimetype)) {
      return cb(new Error("Invalid file type"));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ===== Rotas =====
router.get("/", authOptional(), listLanes);
router.post("/", auth(), createLane);
router.patch("/:id", auth(), updateLane);
router.delete("/:id", auth(), deleteLane);
router.post("/:id/receipts", auth(), upload.array("files", 12), addReceipts);
router.delete("/:id/receipts", auth(), removeReceipt);

export default router;
