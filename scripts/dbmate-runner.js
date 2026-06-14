#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

try {
    require('dotenv').config();
} catch {
    // dotenv is optional at runtime; env vars may already be set by the shell/CI.
}

const action = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!action) {
    console.error('Usage: node scripts/dbmate-runner.js <up|down|status|drop> [args]');
    process.exit(1);
}

const rawDatabaseUrl = (process.env.DBMATE_DATABASE_URL || process.env.DATABASE_URL || '')
    .trim()
    .replace(/^"(.*)"$/, '$1');

if (!rawDatabaseUrl) {
    console.error('DATABASE_URL is not set. Set DATABASE_URL or DBMATE_DATABASE_URL.');
    process.exit(1);
}

function sanitizeDbmateUrl(input) {
    try {
        const url = new URL(input);

        // `?schema=` is a Prisma-ism; dbmate/libpq rejects it.
        url.searchParams.delete('schema');

        const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
        if (localHosts.has(url.hostname)) {
            url.searchParams.set('sslmode', 'disable');
        } else if (!url.searchParams.has('sslmode')) {
            // Managed Postgres (RDS, Supabase, Neon, etc.) generally requires TLS.
            url.searchParams.set('sslmode', 'require');
        }

        return url.toString();
    } catch {
        return input;
    }
}

const databaseUrl = sanitizeDbmateUrl(rawDatabaseUrl);

const result = spawnSync('dbmate', ['--migrations-dir', 'db/migrations', action, ...extraArgs], {
    env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

if (typeof result.status === 'number') {
    process.exit(result.status);
}

process.exit(1);
