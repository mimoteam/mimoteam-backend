import fs from "fs";
import path from "path";

export const ROOT_UPLOADS = path.resolve(process.cwd(), "uploads");
export const AVATARS_DIR  = path.join(ROOT_UPLOADS, "avatars");
export const TEMP_DIR     = path.join(ROOT_UPLOADS, "temp");

export function ensureUploadDirs() {
  [ROOT_UPLOADS, AVATARS_DIR, TEMP_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}
