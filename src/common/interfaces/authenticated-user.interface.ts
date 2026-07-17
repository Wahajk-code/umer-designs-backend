import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  role: Role;
}
