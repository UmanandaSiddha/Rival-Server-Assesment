const LOCAL_ORIGINS = [
    'http://localhost:4000',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:5174',
    'https://rival.api.umanandasiddha.in',
    'https://rival.umanandasiddha.in'
];

/**
 * Allowlisted origins = local dev defaults + FRONTEND_URL + any in CORS_ORIGINS (comma-separated).
 * So production just sets FRONTEND_URL (and/or CORS_ORIGINS) — no code change needed.
 */
export function getAllowedOrigins(): string[] {
    const fromEnv = [
        process.env.FRONTEND_URL,
        ...String(process.env.CORS_ORIGINS ?? '').split(','),
    ]
        .map((o) => o?.trim())
        .filter((o): o is string => Boolean(o));
    return [...new Set([...LOCAL_ORIGINS, ...fromEnv])];
}

// Kept for callers/tests that read the list directly.
export const allowedOrigins = getAllowedOrigins();

/**
 * CORS is allowlist-by-default; set `CORS_PERMISSIVE=true` to accept any origin.
 */
export function isPermissiveCorsEnabled(): boolean {
    const v = String(process.env.CORS_PERMISSIVE ?? '').toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
}

/** Shared CORS origin callback for HTTP (Express) and Socket.IO. */
export function corsOriginCallback(
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean | string) => void,
): void {
    if (isPermissiveCorsEnabled()) {
        callback(null, true);
        return;
    }
    if (!origin || getAllowedOrigins().includes(origin)) {
        callback(null, origin);
        return;
    }
    callback(new Error('Not allowed by CORS'));
}
