import { SetMetadata } from '@nestjs/common';

/**
 * Opts a route out of InternalAttestationGuard entirely — reserved for
 * endpoints that must be reachable directly (health checks for the hosting
 * platform's own uptime pinger, which can never carry the internal HMAC
 * headers). Everything else stays default-closed; use this only for routes
 * that reveal nothing beyond "the process is up".
 */
export const IS_SKIP_INTERNAL_ATTESTATION_KEY = 'skipInternalAttestation';
export const SkipInternalAttestation = () => SetMetadata(IS_SKIP_INTERNAL_ATTESTATION_KEY, true);
