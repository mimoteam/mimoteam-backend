// backend/src/auth/auth.controller.ts
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import UserModel from '../users/user.model';
import { signJwt } from './auth.service';

const normalize = (v?: string) => (v || '').toString().trim().toLowerCase();

export async function login(req: Request, res: Response) {
  try {
    // aceita { login, password } e aliases comuns
    const { login, user, email, username, password } = (req.body || {}) as any;
    const identifier = normalize(login ?? user ?? email ?? username);
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Missing login/password' });
    }

    // importante: selecione o campo de senha (hash) se for select:false no schema
    const dbUser = await UserModel
      .findOne({ $or: [{ login: identifier }, { email: identifier }, { username: identifier }] })
      .select('+password')            // <-- ajuste para '+passwordHash' se o campo no schema for passwordHash
      .lean(false);

    if (!dbUser) return res.status(401).json({ error: 'Invalid credentials' });
    if (dbUser.status && dbUser.status !== 'active') {
      return res.status(403).json({ error: 'User disabled' });
    }

    // compare com o hash salvo
    const ok = await bcrypt.compare(password, (dbUser as any).password);
    // se seu schema usa passwordHash:  await bcrypt.compare(password, (dbUser as any).passwordHash)
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signJwt({ sub: dbUser._id.toString(), role: dbUser.role });

    // limpa o campo de senha do objeto
    const obj = dbUser.toObject();
    delete (obj as any).password; // ou delete obj.passwordHash

    const safeUser = {
      id: dbUser._id.toString(),
      fullName: obj.fullName,
      email: obj.email,
      login: obj.login,
      role: obj.role,
      status: obj.status,
      team: obj.team,
      funcao: obj.funcao,
    };

    return res.json({ token, user: safeUser });
  } catch (err) {
    console.error('auth.login error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// rota de seed só fora de produção
export async function devSeed(_req: Request, res: Response) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'forbidden' });
    }

    const users = [
      {
        fullName: 'Admin User',
        email: 'admin@mimo.com',
        login: 'admin',
        password: await bcrypt.hash('admin123', 10), // hash salvo em "password"
        role: 'admin',
        funcao: 'GUIDE',
        team: 'US Team',
        status: 'active',
      },
      {
        fullName: 'Partner User',
        email: 'partner@mimo.com',
        login: 'partner',
        password: await bcrypt.hash('partner123', 10),
        role: 'partner',
        funcao: 'CONCIERGE',
        team: 'Brazil Team',
        status: 'active',
      },
      {
        fullName: 'Finance User',
        email: 'finance@mimo.com',
        login: 'finance',
        password: await bcrypt.hash('finance123', 10),
        role: 'finance',
        funcao: 'THIRD-PARTY',
        team: 'US Team',
        status: 'active',
      },
    ];

    const seeded: string[] = [];
    for (const u of users) {
      await UserModel.updateOne({ login: u.login }, { $setOnInsert: u }, { upsert: true });
      seeded.push(u.login);
    }
    return res.json({ ok: true, seeded });
  } catch (e) {
    console.error('devSeed error:', e);
    return res.status(500).json({ error: 'seed failed' });
  }
}
