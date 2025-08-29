import { Router } from 'express';
import Cost from './cost.model';

const router = Router();

/**
 * GET /costs
 * Lista com paginação + filtros opcionais.
 * Filtros suportados (todos opcionais): serviceType, team, location, park, guests, hopper, hours
 * Paginação: page/pageSize ou limit/offset
 */
router.get('/', async (req, res) => {
  const {
    page = '1',
    pageSize = '10',
    limit,
    offset,
    serviceType,
    team,
    location,
    park,
    guests,
    hopper,
    hours,
  } = req.query as Record<string, string | undefined>;

  // paginação compatível (page/pageSize OU limit/offset)
  const _page = Number(page) || (offset ? Math.floor(Number(offset) / Number(limit)) + 1 : 1);
  const _pageSize = Number(pageSize) || Number(limit) || 10;
  const skip = (_page - 1) * _pageSize;

  const filter: Record<string, any> = {};
  if (serviceType) filter.serviceType = serviceType;
  if (team) filter.team = team;
  if (location) filter.location = location;
  if (park) filter.park = park;
  if (guests) filter.guests = guests;
  if (hopper) filter.hopper = hopper;
  if (hours) filter.hours = hours;

  const [docs, total] = await Promise.all([
    Cost.find(filter).sort({ createdAt: -1 }).skip(skip).limit(_pageSize).lean(),
    Cost.countDocuments(filter),
  ]);

  // 👇 _id de lean() vira unknown → normalizamos para string
  const items = (docs as any[]).map((d) => ({ id: String(d._id), ...d }));

  res.json({
    items,
    total,
    page: _page,
    pageSize: _pageSize,
    totalPages: Math.max(1, Math.ceil(total / _pageSize)),
  });
});

/**
 * POST /costs
 * Cria uma regra de custo
 */
router.post('/', async (req, res) => {
  const created = await Cost.create(req.body);
  const obj = created.toObject() as any;
  const { _id, ...rest } = obj;
  res.status(201).json({ id: String(_id), ...rest });
});


/**
 * PATCH /costs/:id
 * Atualiza parcialmente
 */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const updated = await Cost.findByIdAndUpdate(id, { $set: req.body }, { new: true }).lean();
  if (!updated) return res.status(404).json({ error: 'Not found' });
  const d = updated as any;
  const { _id, ...rest } = d;
  res.json({ id: String(_id), ...rest });
});
/**
 * DELETE /costs/:id
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const del = await Cost.findByIdAndDelete(id);
  if (!del) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;
