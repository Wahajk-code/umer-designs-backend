import { User } from '@prisma/client';

export type SafeUser = Omit<User, 'passwordHash'>;

/** Strips the password hash before any User ever reaches a serialized response. */
export function sanitizeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}
