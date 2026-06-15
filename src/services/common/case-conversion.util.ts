/**
 * Recursively camelCase object keys (maps raw Postgres rows like created_at to the API shape).
 * Leaves Dates, Buffers and primitives untouched.
 */

function toCamelCase(key: string): string {
    return key.replace(/[_-]+([a-z0-9])/gi, (_match, char: string) =>
        char.toUpperCase(),
    );
}

export function toCamelCaseDeep<T = any>(input: any): T {
    if (Array.isArray(input)) {
        return input.map((item) => toCamelCaseDeep(item)) as unknown as T;
    }

    const isPlainObject =
        input !== null &&
        typeof input === 'object' &&
        !(input instanceof Date) &&
        !(input instanceof Buffer);

    if (isPlainObject) {
        return Object.fromEntries(
            Object.entries(input).map(([key, value]) => [
                toCamelCase(key),
                toCamelCaseDeep(value),
            ]),
        ) as T;
    }

    return input as T;
}
