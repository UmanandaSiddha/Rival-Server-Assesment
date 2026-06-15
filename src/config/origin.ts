export const allowedOrigins = [
	'http://localhost:4000',
	'http://localhost:3000',
	'http://localhost:3001',
	'http://localhost:5173',
	'http://localhost:5174'
];

/**
 * CORS is allowlist-by-default; set `CORS_PERMISSIVE=true` to accept any origin.
 * For prod, add real origins to `allowedOrigins` above (or opt into permissive explicitly).
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
	if (!origin || allowedOrigins.includes(origin)) {
		callback(null, origin);
		return;
	}
	callback(new Error('Not allowed by CORS'));
}