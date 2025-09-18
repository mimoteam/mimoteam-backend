import { Router } from "express";
import * as ctrl from "./billing.controller";
import { validate } from "../middleware/validate";
import { createBillingSchema, updateBillingSchema } from "./billing.schemas";

const router = Router();

/**
 * IMPORTANTE:
 * NÃO prefixe com '/billing' aqui.
 * O app faz o mount: mirror(['/billing','/api/billing'], billingRoutes)
 */

// Listar / Criar
router.get("/", ctrl.list);
router.post("/", validate(createBillingSchema), ctrl.create);

// Atualizar (objeto completo) – rota antiga (mantida)
router.put("/:id", validate(updateBillingSchema), ctrl.update);

// ✅ Atualizar somente status (o front usa isso)
router.patch("/:id/status", ctrl.updateStatus);
// (Opcional: aceitar também /status/:id)
router.patch("/status/:id", ctrl.updateStatus);

// Remover item
router.delete("/:id", ctrl.remove);

// ✅ Limpar tudo (o front chama DELETE /api/billing)
router.delete("/", ctrl.clear);

export default router;
