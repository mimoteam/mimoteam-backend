// src/auth/auth.service.ts
import jwt, { type SignOptions } from 'jsonwebtoken';

export function signJwt(
  payload: object,
  expiresIn: SignOptions['expiresIn'] = '7d' as unknown as SignOptions['expiresIn']
) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');

  // Alguns @types são mais “estritos”; o cast abaixo evita ruído de tipos
  const opts: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] };

  return jwt.sign(payload as any, secret, opts);
}
