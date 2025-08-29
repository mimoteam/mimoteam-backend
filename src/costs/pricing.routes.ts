// backend/src/pricing/pricing.routes.ts
import { Router } from 'express';
import Cost from '../costs/cost.model'; // ⬅️ caminho corrigido

const router = Router();

// POST /pricing/lookup
// body: { serviceType, team, location, park, guests, hopper, hours }
router.post('/lookup', async (req, res) => {
  try {
    const p = req.body || {};
    const toStr = (v: any) => String(v ?? '');
    const norm  = (v: any) => toStr(v).toUpperCase();

    const serviceType = norm(p.serviceType);
    if (!serviceType) {
      return res.status(400).json({ error: 'Missing serviceType' });
    }

    // pega regras candidatas por tipo
    const candidates = await Cost.find({ serviceType }).lean();

    // normaliza parâmetros recebidos
    const P = {
      team:     norm(p.team),
      location: norm(p.location),
      park:     norm(p.park),
      guests:   Number.isFinite(Number(p.guests)) ? Number(p.guests) : null,
      hopper:   p.hopper === true || norm(p.hopper) === 'TRUE' ? 'TRUE'
              : p.hopper === false || norm(p.hopper) === 'FALSE' ? 'FALSE'
              : '',
      hours:    Number.isFinite(Number(p.hours)) ? Number(p.hours) : null,
    };

    let best: any = null;
    let bestScore = -1;

    for (const r of candidates) {
      // cada campo definido na regra precisa casar; vazio/null = curinga
      const matchTeam   = !r.team     || r.team     === P.team;
      const matchLoc    = !r.location || r.location === P.location;
      const matchPark   = !r.park     || r.park     === P.park;
      const matchGuests = r.guests == null || r.guests === P.guests;
      const matchHopper = !r.hopper   || r.hopper   === P.hopper;
      const matchHours  = r.hours  == null || r.hours  === P.hours;

      if (!(matchTeam && matchLoc && matchPark && matchGuests && matchHopper && matchHours)) continue;

      // pontua especificidade
      let score = 0;
      if (r.team)        score++;
      if (r.location)    score++;
      if (r.park)        score++;
      if (r.guests!=null)score++;
      if (r.hopper)      score++;
      if (r.hours!=null) score++;

      // desempate: mais recente vence
      const tieR = new Date(r.updatedAt || r.createdAt || 0).getTime();
      const tieB = best ? new Date(best.updatedAt || best.createdAt || 0).getTime() : -1;

      if (score > bestScore || (score === bestScore && tieR > tieB)) {
        best = r;
        bestScore = score;
      }
    }

    if (!best) return res.json({ hit: null });

    // campos efetivamente ancorados na regra vencedora
    const keyFields = (['team','location','park','guests','hopper','hours'] as const)
      .filter((k) => (best as any)[k] !== '' && (best as any)[k] !== null && (best as any)[k] !== undefined);

    res.json({
      hit: { amount: best.amount, keyFields, ruleId: String(best._id) },
      raw: best,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

export default router;
