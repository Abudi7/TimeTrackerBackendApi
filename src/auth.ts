// server/src/auth.ts
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const JWT_SECRET = process.env.JWT_SECRET!;

export function signToken(payload: { id: number; email: string; role: 'user' | 'admin' }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}
export function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; email: string; role: 'user' | 'admin' };
  } catch (e) {
    return null;
  }
}