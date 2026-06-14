import { EmailTemplate } from './email.types';

/**
 * Minimal HTML email bodies. The job carries the subject; this only renders the body so templates
 * stay data-driven. Swap for React Email / MJML later without touching producers or the worker.
 */
export function renderEmail(template: EmailTemplate, data: Record<string, any>): string {
    const greeting = data.firstName ? `Hi ${escapeHtml(data.firstName)},` : 'Hi,';

    switch (template) {
        case 'otp':
            return wrap(`
                <p>${greeting}</p>
                <p>Your verification code is:</p>
                <p style="font-size:28px;font-weight:700;letter-spacing:4px">${escapeHtml(String(data.otpCode))}</p>
                <p>It expires in ${Number(data.expiresInMinutes ?? 5)} minutes. If you didn't request this, ignore this email.</p>
            `);
        case 'welcome':
            return wrap(`
                <p>${greeting}</p>
                <p>Your account is verified — welcome aboard. You can now create tasks and collaborate with your team.</p>
            `);
        case 'invite':
            return wrap(`
                <p>${greeting}</p>
                <p>${escapeHtml(data.invitedByName ?? 'Someone')} invited you to join the team
                    <b>${escapeHtml(data.teamName ?? 'a team')}</b>.</p>
                <p><a href="${escapeHtml(data.inviteUrl)}">Accept the invitation</a></p>
                <p>This invite expires on ${escapeHtml(data.expiresAt ?? 'soon')}.</p>
            `);
        default:
            return wrap(`<p>${greeting}</p>`);
    }
}

function wrap(inner: string): string {
    return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;color:#111;line-height:1.5">${inner}</div>`;
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
