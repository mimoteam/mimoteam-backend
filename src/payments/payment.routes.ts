// backend/src/payments/payment.routes.ts
import { Router } from 'express';
import Payment from './payment.model';
import { Service } from '../services/service.model';

const router = Router();

const normalizePayment = (d: any) => {
  const { _id, serviceIds, ...rest } = d;
  return {
    id: String(_id),
    ...rest,
    serviceIds: Array.isArray(serviceIds) ? serviceIds.map((x: any) => String(x)) : [],
  };
};

async function recalcTotal(paymentId: string) {
  const p = await Payment.findById(paymentId).lean();
  if (!p) return null;
  const services = await Service.find({ _id: { $in: p.serviceIds } }, { finalValue: 1 }).lean();
  const total = services.reduce((acc, s: any) => acc + Number(s.finalValue || 0), 0);
  await Payment.findByIdAndUpdate(paymentId, { $set: { total } });
  return total;
}

// LIST
router.get('/', async (req, res) => {
  const {
    page = '1',
    pageSize = '10',
    limit,
    offset,
    partnerId,
    status,
  } = req.query as Record<string, string | undefined>;

  const _page = Number(page) || (offset ? Math.floor(Number(offset) / Number(limit)) + 1 : 1);
  const _pageSize = Number(pageSize) || Number(limit) || 10;
  const skip = (_page - 1) * _pageSize;

  const filter: Record<string, any> = {};
  if (partnerId) filter.partnerId = partnerId;
  if (status) filter.status = status;

  const [docs, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(_pageSize).lean(),
    Payment.countDocuments(filter),
  ]);

  const items = (docs as any[]).map(normalizePayment);

  res.json({
    items,
    total,
    page: _page,
    pageSize: _pageSize,
    totalPages: Math.max(1, Math.ceil(total / _pageSize)),
  });
});

// CREATE
router.post('/', async (req, res) => {
  const payload = {
    partnerId: req.body.partnerId,
    partnerName: req.body.partnerName || '',
    weekKey: req.body.weekKey ?? null,
    weekStart: req.body.weekStart ?? null,
    weekEnd: req.body.weekEnd ?? null,
    periodFrom: req.body.periodFrom ?? null,
    periodTo: req.body.periodTo ?? null,
    serviceIds: Array.isArray(req.body.serviceIds) ? req.body.serviceIds.map(String) : [],
    extraIds: Array.isArray(req.body.extraIds) ? req.body.extraIds.map(String) : [],
    status: req.body.status || 'PENDING',
    notes: req.body.notes || '',
    notesLog: Array.isArray(req.body.notesLog) ? req.body.notesLog : [],
  };
  const created = await Payment.create(payload);
  const obj = created.toObject() as any;

  // calcula total inicial
  await recalcTotal(String(created._id));

  res.status(201).json(normalizePayment(obj));
});

// UPDATE
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const patch: any = { ...req.body };
  if (Array.isArray(patch.serviceIds)) patch.serviceIds = patch.serviceIds.map(String);
  if (Array.isArray(patch.extraIds)) patch.extraIds = patch.extraIds.map(String);

  const updated = await Payment.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  if (!updated) return res.status(404).json({ error: 'Not found' });

  // se mexeu em serviceIds, recalcular total
  if ('serviceIds' in patch) await recalcTotal(id);

  res.json(normalizePayment(updated as any));
});

// DELETE
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const del = await Payment.findByIdAndDelete(id);
  if (!del) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

/**
 * GET /payments/eligible
 * Lista serviços do parceiro no período que AINDA NÃO estão em nenhum pagamento
 * Parâmetros: partner (obrigatório), dateFrom, dateTo, serviceType (default: 'REIMBURSEMENT')
 */
router.get('/eligible', async (req, res) => {
  const partnerId = String(req.query.partner || '');
  const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
  const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : null;
  const serviceType = String(req.query.serviceType || 'REIMBURSEMENT'); // 'REIMBURSEMENT' | 'ALL' | outro id

  if (!partnerId) return res.status(400).json({ error: 'Missing partner' });

  const periodFilter: any = {};
  if (dateFrom) periodFilter.$gte = dateFrom;
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    periodFilter.$lte = end;
  }

  // serviços já usados em QUALQUER pagamento
  const payments = await Payment.find({ partnerId }, { serviceIds: 1 }).lean();
  const usedIds = new Set<string>();
  payments.forEach(p => (p.serviceIds || []).forEach((sid: any) => usedIds.add(String(sid))));

  const filter: any = { partnerId };
  if (Object.keys(periodFilter).length) filter.serviceDate = periodFilter;
  if (serviceType !== 'ALL') filter.serviceTypeId = serviceType;

  const services = await Service.find(filter).sort({ serviceDate: -1 }).lean();
  const items = services
    .filter(s => !usedIds.has(String(s._id)))
    .map(s => ({
      id: String(s._id),
      serviceDate: s.serviceDate,
      firstName: s.firstName || '',
      lastName: s.lastName || '',
      serviceTypeId: s.serviceTypeId || '',
      finalValue: Number(s.finalValue || 0),
      observations: s.observations || '',
    }));

  res.json({ items, total: items.length });
});

/**
 * POST /payments/:id/items  { serviceId }
 * Adiciona serviço ao payment (sem duplicar) e recalcula total
 */
router.post('/:id/items', async (req, res) => {
  const { id } = req.params;
  const { serviceId } = req.body || {};
  if (!serviceId) return res.status(400).json({ error: 'Missing serviceId' });

  const pay = await Payment.findById(id);
  if (!pay) return res.status(404).json({ error: 'Payment not found' });

  const svc = await Service.findById(serviceId).lean();
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  if (String(svc.partnerId || svc.partner?.id || '') !== String(pay.partnerId)) {
    return res.status(400).json({ error: 'Service partner mismatch' });
  }

  const has = pay.serviceIds.some(s => String(s) === String(serviceId));
  if (!has) {
    pay.serviceIds.push(String(serviceId));
    await pay.save();
    await recalcTotal(id);
  }

  const obj = pay.toObject() as any;
  res.json(normalizePayment(obj));
});

/**
 * DELETE /payments/:id/items/:serviceId
 * Remove serviço do payment e recalcula total
 */
router.delete('/:id/items/:serviceId', async (req, res) => {
  const { id, serviceId } = req.params;
  const pay = await Payment.findById(id);
  if (!pay) return res.status(404).json({ error: 'Payment not found' });

  const next = pay.serviceIds.filter(s => String(s) !== String(serviceId));
  if (next.length !== pay.serviceIds.length) {
    pay.serviceIds = next;
    await pay.save();
    await recalcTotal(id);
  }

  const obj = pay.toObject() as any;
  res.json(normalizePayment(obj));
});

export default router;
