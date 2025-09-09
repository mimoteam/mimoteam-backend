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

/** -------- service-status -------- */
router.get('/service-status', async (req, res) => {
  const idsParam = String(req.query.ids || '').trim();
  const ids = idsParam ? idsParam.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Missing ids' });

const orConds = ids.map(id => ({ serviceIds: id }));
const rows = await Payment.find(
  { $or: orConds },
  { _id: 1, serviceIds: 1 }
).lean();

  const index = new Map<string, string>();
  rows.forEach((p: any) => (p.serviceIds || []).forEach((sid: any) => {
    const s = String(sid);
    if (!index.has(s)) index.set(s, String(p._id));
  }));

  const items: Record<string, { inPayment: boolean; paymentId: string | null }> = {};
  ids.forEach((id) => {
  const payment = rows.find((p: any) => (p.serviceIds || []).some((sid: any) => String(sid) === id));
  const paymentId = payment ? String(payment._id) : null;
  items[id] = { inPayment: !!paymentId, paymentId };
});

  return res.json({ items });
});
/** -------------------------------- */

/** LIST */
router.get('/', async (req, res) => {
  const { page = '1', pageSize = '10', limit, offset, partnerId, status } =
    req.query as Record<string, string | undefined>;

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

/** CREATE */
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
  await recalcTotal(String(created._id));
  res.status(201).json(normalizePayment(created.toObject() as any));
});

/** UPDATE */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const patch: any = { ...req.body };
  if (Array.isArray(patch.serviceIds)) patch.serviceIds = patch.serviceIds.map(String);
  if (Array.isArray(patch.extraIds)) patch.extraIds = patch.extraIds.map(String);

  const updated = await Payment.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  if (!updated) return res.status(404).json({ error: 'Not found' });

  if ('serviceIds' in patch) await recalcTotal(id);
  res.json(normalizePayment(updated as any));
});

/** DELETE */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const del = await Payment.findByIdAndDelete(id);
  if (!del) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

/** eligible */
router.get('/eligible', async (req, res) => {
  const partnerId = String((req.query as any).partner || '');
  const dateFrom = (req.query as any).dateFrom ? new Date(String((req.query as any).dateFrom)) : null;
  const dateTo = (req.query as any).dateTo ? new Date(String((req.query as any).dateTo)) : null;
  const serviceType = String((req.query as any).serviceType || 'REIMBURSEMENT');

  if (!partnerId) return res.status(400).json({ error: 'Missing partner' });

  const periodFilter: any = {};
  if (dateFrom) periodFilter.$gte = dateFrom;
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    periodFilter.$lte = end;
  }

  const payments = await Payment.find({ partnerId }, { serviceIds: 1 }).lean();
  const usedIds = new Set<string>();
  payments.forEach((p) => (p.serviceIds || []).forEach((sid: any) => usedIds.add(String(sid))));

  const filter: any = { partnerId };
  if (Object.keys(periodFilter).length) filter.serviceDate = periodFilter;
  if (serviceType !== 'ALL') filter.serviceTypeId = serviceType;

  const services = await Service.find(filter).sort({ serviceDate: -1 }).lean();
  const items = services
    .filter((s) => !usedIds.has(String(s._id)))
    .map((s) => ({
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

/** itens: add */
router.post('/:id/items', async (req, res) => {
  const { id } = req.params;
  const { serviceId } = req.body || {};
  if (!serviceId) return res.status(400).json({ error: 'Missing serviceId' });

  const pay = await Payment.findById(id);
  if (!pay) return res.status(404).json({ error: 'Payment not found' });

  const svc = await Service.findById(serviceId).lean();
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  if (String((svc as any).partnerId || (svc as any).partner?.id || '') !== String((pay as any).partnerId)) {
    return res.status(400).json({ error: 'Service partner mismatch' });
  }

  const has = (pay.serviceIds as any[]).some((s: any) => String(s) === String(serviceId));
  if (!has) {
    (pay.serviceIds as any[]).push(String(serviceId));
    await pay.save();
    await recalcTotal(id);
  }

  res.json(normalizePayment(pay.toObject() as any));
});

/** itens: remove */
router.delete('/:id/items/:serviceId', async (req, res) => {
  const { id, serviceId } = req.params;
  const pay = await Payment.findById(id);
  if (!pay) return res.status(404).json({ error: 'Payment not found' });

  const next = (pay.serviceIds as any[]).filter((s: any) => String(s) !== String(serviceId));
  if (next.length !== (pay.serviceIds as any[]).length) {
    (pay.serviceIds as any[]) = next;
    await pay.save();
    await recalcTotal(id);
  }

  res.json(normalizePayment(pay.toObject() as any));
});

export default router;
