import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as not requiring a user JWT (e.g. browsing published designs).
 * It is still required to pass InternalAttestationGuard — "public" means
 * public-through-the-BFF, never reachable directly from the open internet.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
