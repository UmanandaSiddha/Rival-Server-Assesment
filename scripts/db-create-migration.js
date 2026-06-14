#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(projectRoot, 'db', 'migrations');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || process.env.DB_CREATE_DRY_RUN === '1';

function firstNonFlagArg(values) {
    for (const value of values) {
        if (!value || value === '--' || value.startsWith('-')) {
            continue;
        }
        return value;
    }
    return undefined;
}

function normalizeMigrationName(rawName) {
    return rawName
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function nextMigrationPrefix(files) {
    const prefixPattern = /^(\d+)_.*\.sql$/;
    const numbers = files
        .map((fileName) => {
            const match = fileName.match(prefixPattern);
            return match ? Number.parseInt(match[1], 10) : null;
        })
        .filter((value) => Number.isInteger(value));

    const maxValue = numbers.length > 0 ? Math.max(...numbers) : 0;
    const width = Math.max(3, String(maxValue + 1).length);

    return String(maxValue + 1).padStart(width, '0');
}

const requestedName = firstNonFlagArg(args);
const slug = requestedName ? normalizeMigrationName(requestedName) : '';

if (!slug) {
    console.error('Migration name is required.');
    console.error('Usage: npm run db:create create_tasks_table');
    process.exit(1);
}

if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
}

const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
const prefix = nextMigrationPrefix(files);
const fileName = `${prefix}_${slug}.sql`;
const filePath = path.join(migrationsDir, fileName);

if (fs.existsSync(filePath)) {
    console.error(`Migration already exists: ${fileName}`);
    process.exit(1);
}

const template = `-- migrate:up\n\n-- Write your migration SQL here\n\n-- migrate:down\n\n-- Write rollback SQL here\n`;

if (!dryRun) {
    fs.writeFileSync(filePath, template, 'utf8');
}

const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
console.log(`${dryRun ? 'Would create' : 'Created'} migration: ${relativePath}`);
