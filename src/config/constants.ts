export const REDIS_CLIENT = "REDIS_CLIENT";

// Cache of validated users keyed by access token, to avoid a DB hit on every authenticated request.
export const REDIS_USER_TOKEN_CACHE_PREFIX = "auth:user-by-token";
// Keep below the access-token lifetime (15m) so a cached user can't outlive its token.
export const USER_TOKEN_CACHE_TTL = 600; // seconds

// Queue
export const EMAIL_QUEUE = "EMAIL_QUEUE";