// Ad-hoc end-to-end smoke test of the API contract the web client relies on.
// Uses fetch + a tiny cookie jar (like the browser does with httpOnly cookies).
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:4000/api/v1';
const jar = new Map();

function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function storeCookies(res) {
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
        const [pair] = c.split(';');
        const idx = pair.indexOf('=');
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
}
async function req(method, path, body) {
    const res = await fetch(BASE + path, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(jar.size ? { Cookie: cookieHeader() } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    storeCookies(res);
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: res.status, data };
}

let pass = 0,
    fail = 0;
function check(name, cond, extra = '') {
    if (cond) {
        pass++;
        console.log(`  ok  ${name}`);
    } else {
        fail++;
        console.log(`FAIL  ${name} ${extra}`);
    }
}

const email = `e2e_${Date.now()}@test.com`;

const run = async () => {
    // --- Auth ---
    let r = await req('POST', '/auth/sign-up', {
        email,
        firstName: 'E2E',
        lastName: 'User',
        password: 'password123',
    });
    check('sign-up 201 + returns user', r.status === 201 && r.data?.data?.email === email, JSON.stringify(r.data));

    r = await req('GET', '/auth/me');
    check('me before verify (unverified)', r.status === 200 && r.data?.data?.isVerified === false);

    r = await req('POST', '/auth/verify-otp', { email, otpString: '000000' });
    check('verify-otp (dev 000000)', r.status === 201 && r.data?.data?.isVerified === true, JSON.stringify(r.data));

    r = await req('GET', '/auth/me');
    check('me after verify (verified)', r.status === 200 && r.data?.data?.isVerified === true);

    // --- Teams (default team auto-created on signup) ---
    r = await req('GET', '/teams');
    const teams = Array.isArray(r.data) ? r.data : [];
    const team = teams[0];
    check('list teams → default team exists', r.status === 200 && teams.length >= 1 && !!team?.id, JSON.stringify(r.data));
    const teamId = team?.id;

    r = await req('GET', `/teams/${teamId}`);
    check('team detail returns access', r.status === 200 && Array.isArray(r.data?.access?.permissions) || r.data?.access?.hasAll);

    r = await req('GET', `/teams/${teamId}/roles`);
    const roles = r.data ?? [];
    const memberRole = roles.find((x) => x.name === 'Member') ?? roles[0];
    check('list roles (system roles present)', r.status === 200 && roles.length >= 1, JSON.stringify(roles.map?.((x) => x.name)));

    r = await req('GET', `/teams/${teamId}/members`);
    check('list members → owner is a member', r.status === 200 && r.data?.length >= 1 && r.data[0]?.isOwner === true);

    // --- Tasks ---
    r = await req('POST', '/tasks', { teamId, title: 'E2E Task', priority: 'HIGH' });
    const task = r.data;
    check('create task → returns task w/ version', r.status === 201 && task?.id && task?.version === 0 && task?.status === 'TODO', JSON.stringify(r.data));
    const taskId = task?.id;

    r = await req('GET', `/tasks?teamId=${teamId}&sort=createdAt&order=desc&page=1&limit=20`);
    check('list tasks → paginated, includes new task', r.status === 200 && r.data?.total >= 1 && r.data.data.some((t) => t.id === taskId));

    r = await req('GET', `/tasks?teamId=${teamId}&search=E2E`);
    check('search tasks by title', r.status === 200 && r.data.data.some((t) => t.id === taskId));

    r = await req('PATCH', `/tasks/${taskId}`, { status: 'DONE' });
    check('update task → DONE, version bumped, completedAt set', r.status === 200 && r.data?.status === 'DONE' && r.data?.version === 1 && !!r.data?.completedAt, JSON.stringify(r.data));

    r = await req('GET', `/tasks/${taskId}/activity`);
    check('activity log records changes', r.status === 200 && r.data?.length >= 2);

    r = await req('DELETE', `/tasks/${taskId}`);
    check('delete task', r.status === 200 && r.data?.id === taskId);

    // --- Create team + invite ---
    r = await req('POST', '/teams', { name: 'E2E Team 2' });
    const team2 = r.data;
    check('create team', r.status === 201 && !!team2?.id);

    r = await req('GET', `/teams/${team2.id}/roles`);
    const role2 = (r.data ?? []).find((x) => x.name === 'Member') ?? r.data?.[0];

    r = await req('POST', `/teams/${team2.id}/invites`, { email: 'invitee@test.com', roleId: role2.id });
    const invite = r.data;
    check('create invite → returns token + url', r.status === 201 && !!invite?.token && !!invite?.inviteUrl, JSON.stringify(r.data));

    r = await req('GET', `/teams/${team2.id}/invites`);
    check('list pending invites', r.status === 200 && r.data?.length === 1);

    // public preview (drop cookies to prove it's unauthenticated)
    const savedJar = new Map(jar);
    jar.clear();
    r = await req('GET', `/invites/${invite.token}`);
    check('public invite preview (no auth)', r.status === 200 && r.data?.teamName === 'E2E Team 2');
    for (const [k, v] of savedJar) jar.set(k, v);

    // --- Validation + authz ---
    r = await req('POST', '/tasks', { teamId, title: '' });
    check('validation rejects empty title (400)', r.status === 400);

    r = await req('GET', '/admin/users');
    check('non-admin blocked from /admin (403)', r.status === 403);

    // --- Logout ---
    r = await req('PUT', '/auth/logout');
    check('logout', r.status === 200);
    r = await req('GET', '/auth/me');
    check('me after logout (401)', r.status === 401);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
};

run().catch((e) => {
    console.error('SMOKE ERROR', e);
    process.exit(1);
});
