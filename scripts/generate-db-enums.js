#!/usr/bin/env node

// Reads CREATE/ALTER/DROP TYPE ... AS ENUM statements from db/migrations and generates
// a typed src/database/enums.ts. Run `npm run db:generate-enums` after editing enum migrations.

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(projectRoot, 'db', 'migrations');
const outputFile = path.join(projectRoot, 'src', 'database', 'enums.ts');

function migrationComparator(left, right) {
    const leftMatch = left.match(/^(\d+)_/);
    const rightMatch = right.match(/^(\d+)_/);

    if (leftMatch && rightMatch) {
        const leftNumber = Number.parseInt(leftMatch[1], 10);
        const rightNumber = Number.parseInt(rightMatch[1], 10);
        if (leftNumber !== rightNumber) {
            return leftNumber - rightNumber;
        }
    }

    return left.localeCompare(right);
}

function extractUpSection(sql) {
    const marker = /^\s*--\s*migrate:down\s*$/im;
    const match = marker.exec(sql);
    return match ? sql.slice(0, match.index) : sql;
}

function parseEnumValues(enumBody) {
    const values = [];
    const valuePattern = /'((?:[^']|'')*)'/g;

    let match = valuePattern.exec(enumBody);
    while (match) {
        values.push(match[1].replace(/''/g, "'"));
        match = valuePattern.exec(enumBody);
    }

    return values;
}

function statementToEnumChange(statement) {
    const createMatch = statement.match(/CREATE\s+TYPE\s+"([^"]+)"\s+AS\s+ENUM\s*\(([\s\S]*?)\)\s*;/i);
    if (createMatch) {
        return { kind: 'create', name: createMatch[1], values: parseEnumValues(createMatch[2]) };
    }

    const alterMatch = statement.match(/ALTER\s+TYPE\s+"([^"]+)"\s+ADD\s+VALUE(?:\s+IF\s+NOT\s+EXISTS)?\s+'((?:[^']|'')*)'\s*;/i);
    if (alterMatch) {
        return { kind: 'alter-add', name: alterMatch[1], value: alterMatch[2].replace(/''/g, "'") };
    }

    const dropMatch = statement.match(/DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"(?:\s+CASCADE|\s+RESTRICT)?\s*;/i);
    if (dropMatch) {
        return { kind: 'drop', name: dropMatch[1] };
    }

    return null;
}

function toEscapedSingleQuoted(value) {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isIdentifier(value) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

if (!fs.existsSync(migrationsDir)) {
    console.error('Migrations directory not found:', migrationsDir);
    process.exit(1);
}

const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort(migrationComparator);

const enums = new Map();

for (const migrationFile of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, migrationFile), 'utf8');
    const upSection = extractUpSection(sql);

    const statementPattern = /(CREATE\s+TYPE\s+"[^"]+"\s+AS\s+ENUM\s*\([\s\S]*?\)\s*;|ALTER\s+TYPE\s+"[^"]+"\s+ADD\s+VALUE(?:\s+IF\s+NOT\s+EXISTS)?\s+'(?:[^']|'')*'\s*;|DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?"[^"]+"(?:\s+CASCADE|\s+RESTRICT)?\s*;)/gi;
    let match = statementPattern.exec(upSection);

    while (match) {
        const change = statementToEnumChange(match[0]);

        if (change?.kind === 'create') {
            enums.set(change.name, [...change.values]);
        }
        if (change?.kind === 'alter-add') {
            const currentValues = enums.get(change.name) ?? [];
            if (!currentValues.includes(change.value)) {
                currentValues.push(change.value);
                enums.set(change.name, currentValues);
            }
        }
        if (change?.kind === 'drop') {
            enums.delete(change.name);
        }

        match = statementPattern.exec(upSection);
    }
}

if (enums.size === 0) {
    console.error('No enums found in migrations.');
    process.exit(1);
}

const lines = [
    '// Auto-generated from db/migrations CREATE TYPE statements.',
    '// Run `npm run db:generate-enums` after changing enum migrations. Do not edit by hand.',
    '',
];

for (const [enumName, enumValues] of enums.entries()) {
    lines.push(`export const ${enumName} = {`);

    for (const enumValue of enumValues) {
        const escapedValue = toEscapedSingleQuoted(enumValue);
        if (isIdentifier(enumValue)) {
            lines.push(`  ${enumValue}: '${escapedValue}',`);
        } else {
            lines.push(`  '${escapedValue}': '${escapedValue}',`);
        }
    }

    lines.push('} as const;');
    lines.push('');
    lines.push(`export type ${enumName} = (typeof ${enumName})[keyof typeof ${enumName}];`);
    lines.push('');
}

const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputFile, `${lines.join('\n')}\n`, 'utf8');

const relativeOutput = path.relative(projectRoot, outputFile).replace(/\\/g, '/');
console.log(`Generated enums file: ${relativeOutput}`);
console.log(`Enum count: ${enums.size}`);
