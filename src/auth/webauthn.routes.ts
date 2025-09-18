// src/auth/webauthn.routes.ts
import { Router } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/types";
import * as jwt from "jsonwebtoken";
import { env } from "../config/env";

/** Transports (Node sem DOM) */
type AuthenticatorTransport = "usb" | "nfc" | "ble" | "hybrid" | "internal";

/** Store em memória (trocar por DB em produção) */
type StoredCred = {
  credentialID: Buffer;
  credentialPublicKey: Buffer;
  counter: number;
  transports?: AuthenticatorTransport[];
};
const userStore = new Map<
  string,
  { id: string; username: string; credentials: StoredCred[]; currentChallenge?: string }
>();

/** Env + defaults */
const rpID   = (env as any).WEBAUTHN_RP_ID   || "localhost";
const rpName = (env as any).WEBAUTHN_RP_NAME || "Mimo Team";
const origin = (env as any).WEBAUTHN_ORIGIN  || "http://localhost:5173";

const router = Router();

/* Helpers */
function getOrCreateUser(username: string) {
  let u = Array.from(userStore.values()).find((x) => x.username === username);
  if (!u) {
    const id = (Date.now() + Math.random().toString(36)).replace(/\D/g, "").slice(0, 12);
    u = { id, username, credentials: [] };
    userStore.set(id, u);
  }
  return u;
}
const toB64url = (bytes: Buffer | Uint8Array) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const b64urlToUint8 = (b64url: string) =>
  Uint8Array.from(Buffer.from(b64url.replace(/-/g, "+").replace(/_/g, "/"), "base64"));

/** =======================================================
 *  Compat: verifyAuthenticationResponse (1-arg vs 2-args)
 *  ======================================================= */
async function verifyAuthCompat(args: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
  authenticator: {
    credentialID: Uint8Array;
    credentialPublicKey: Uint8Array;
    counter: number;
    transports?: AuthenticatorTransport[];
  };
}): Promise<VerifiedAuthenticationResponse> {
  const fn: any = verifyAuthenticationResponse as any;
  // Algumas versões têm length === 2 (opts, authenticator), outras 1
  if (typeof fn === "function" && fn.length >= 2) {
    return fn(
      {
        response: args.response,
        expectedChallenge: args.expectedChallenge,
        expectedOrigin: args.expectedOrigin,
        expectedRPID: args.expectedRPID,
      },
      args.authenticator
    );
  }
  return fn({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: args.expectedOrigin,
    expectedRPID: args.expectedRPID,
    authenticator: args.authenticator,
  });
}

/* =============== REGISTER =============== */

/** Options */
router.post("/register/options", async (req, res) => {
  const username = String(req.body?.username || "").trim() || "user";
  const user = getOrCreateUser(username);

  // ⚠️ Forçamos any para suportar versões que pedem id:string OU Uint8Array
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: user.id,
    userName: user.username,
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    excludeCredentials: user.credentials.map((c) => ({
      id: toB64url(c.credentialID),     // base64url string (JSON-friendly)
      type: "public-key" as const,
      transports: c.transports,
    })),
  } as any);

  user.currentChallenge = options.challenge;
  return res.json(options);
});

/** Verify */
router.post("/register/verify", async (req, res) => {
  const username = String(req.query?.username || req.body?.username || "").trim() || "user";
  const user = getOrCreateUser(username);

  const body = req.body as RegistrationResponseJSON;

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: user.currentChallenge ?? "",
      expectedOrigin: origin,
      expectedRPID: rpID,
    } as any);
  } catch (e: any) {
    return res.status(400).json({ message: e?.message || "webauthn verify failed" });
  }

  const { verified, registrationInfo } = verification;
  if (!verified || !registrationInfo) return res.status(400).json({ message: "Invalid registration" });

  // Compat com variações de retorno
  let credID: Uint8Array;
  let pubKey: Uint8Array;
  let counter = 0;
  let transports: AuthenticatorTransport[] | undefined;

  if ((registrationInfo as any).credential) {
    const c = (registrationInfo as any).credential as {
      id: Uint8Array; publicKey: Uint8Array; counter: number; transports?: AuthenticatorTransport[];
    };
    credID = c.id; pubKey = c.publicKey; counter = c.counter ?? 0; transports = c.transports;
  } else {
    credID = (registrationInfo as any).credentialID as Uint8Array;
    pubKey  = (registrationInfo as any).credentialPublicKey as Uint8Array;
    counter = (registrationInfo as any).counter ?? 0;
  }

  user.credentials.push({
    credentialID: Buffer.from(credID),
    credentialPublicKey: Buffer.from(pubKey),
    counter,
    transports,
  });
  user.currentChallenge = undefined;

  return res.json({ ok: true });
});

/* ================ LOGIN ================ */

/** Options */
router.post("/login/options", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const user = username ? getOrCreateUser(username) : null;

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: user?.credentials.map((c) => ({
      id: toB64url(c.credentialID),   // base64url string
      type: "public-key" as const,
      transports: c.transports,
    })),
  } as any);

  if (user) user.currentChallenge = options.challenge;
  return res.json(options);
});

/** Verify */
router.post("/login/verify", async (req, res) => {
  const body = req.body as AuthenticationResponseJSON;

  // localizar usuário pelo credentialID (rawId = base64url)
  const credIdBytes = b64urlToUint8((body.rawId || body.id) as string);
  const found = Array.from(userStore.values()).find((u) =>
    u.credentials.some((c) => Buffer.from(credIdBytes).equals(c.credentialID)),
  );
  if (!found) return res.status(401).json({ message: "Unknown credential" });

  const stored = found.credentials.find((c) =>
    Buffer.from(credIdBytes).equals(c.credentialID),
  )!;

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthCompat({
      response: body,
      expectedChallenge: found.currentChallenge ?? "",
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: new Uint8Array(stored.credentialID),
        credentialPublicKey: new Uint8Array(stored.credentialPublicKey),
        counter: stored.counter,
        transports: stored.transports,
      },
    });
  } catch (e: any) {
    return res.status(400).json({ message: e?.message || "webauthn auth failed" });
  }

  if (!verification.verified) return res.status(401).json({ message: "Verification failed" });

  const newCounter = (verification as any).authenticationInfo?.newCounter;
  if (typeof newCounter === "number") stored.counter = newCounter;

  const accessToken = jwt.sign({ sub: found.id, role: "admin" }, env.JWT_SECRET, { expiresIn: "30m" });

  res.cookie("refreshToken", "demo_refresh_" + found.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 14,
  });

  found.currentChallenge = undefined;

  return res.json({
    accessToken,
    user: { id: found.id, fullName: found.username, email: `${found.username}@example.com`, role: "admin" },
  });
});

export default router;
