import { Router } from "express";
import {
  listServices,
  getService,
  createService,
  bulkCreateServices,
  updateService,
  deleteService,         // <- export existente no controller
  deleteManyServices,
} from "./service.controller";

const router = Router();

/* LIST */
router.get("/", listServices);

/* BULK CREATE (deixa antes de :id só por organização; método é POST então não conflita) */
router.post("/bulk", bulkCreateServices);

/* GET ONE */
router.get("/:id", getService);

/* CREATE */
router.post("/", createService);

/* UPDATE (PATCH) */
router.patch("/:id", updateService);

/* DELETE ONE */
router.delete("/:id", deleteService);

/* BULK DELETE
   1) POST /services/bulk-delete { ids: [...] }
   2) DELETE /services?ids=a,b,c
   3) DELETE /services?ids=a&ids=b
   4) DELETE /services?ids[]=a&ids[]=b
   5) DELETE /services  (body { ids: [...] })
*/
router.post("/bulk-delete", deleteManyServices);

router.delete("/", (req, res, next) => {
  // compat: ids[] → body.ids
  const qAny = (req.query as any)["ids[]"];
  if (!req.body?.ids && qAny) {
    const list = Array.isArray(qAny) ? qAny : [qAny];
    (req as any).body = { ...(req.body || {}), ids: list };
    delete (req.query as any)["ids[]"];
  }
  return deleteManyServices(req, res, next);
});

export default router;
export { router as servicesRouter };
