import { Router } from "express";
import mongoose from "mongoose";


const router = Router();


function dbState() {
const map: Record<number, string> = {
0: "disconnected",
1: "connected",
2: "connecting",
3: "disconnecting",
};
return map[mongoose.connection.readyState] ?? "unknown";
}


router.get("/status", (_req, res) => {
const mem = process.memoryUsage();
const toMB = (n: number) => Math.round((n / 1024 / 1024) * 100) / 100;


res.json({
ok: true,
env: process.env.NODE_ENV || "development",
version: process.env.APP_VERSION || "dev",
commit: process.env.GIT_COMMIT_SHA,
now: new Date().toISOString(),
uptimeSec: Math.round(process.uptime()),
db: { state: dbState(), name: mongoose.connection.name },
memoryMB: {
rss: toMB(mem.rss),
heapTotal: toMB(mem.heapTotal),
heapUsed: toMB(mem.heapUsed),
external: toMB(mem.external),
},
});
});


export default router;