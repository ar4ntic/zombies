import { isLocalHost } from "./auth.ts";
import type { Env } from "./env.ts";

const RESEND_URL = "https://api.resend.com/emails";

export interface Mail {
  to: string;
  subject: string;
  /** Sentence before the link. */
  intro: string;
  linkLabel: string;
  link: string;
  /** Sentence after the link. */
  outro: string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Sends a mail with one link through Resend. Without an API key nothing is sent; on a local dev host the link
 * is written to the log instead so the flows can be tried. Returns whether the mail went out (or was logged).
 */
export async function sendMail(request: Request, env: Env, mail: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    if (isLocalHost(request)) {
      console.log(`[mail] to ${mail.to}: ${mail.subject}\n${mail.link}`);
      return true;
    }
    console.error("Mail is not configured: RESEND_API_KEY and MAIL_FROM are required");
    return false;
  }
  const text = `${mail.intro}\n\n${mail.link}\n\n${mail.outro}`;
  const html =
    `<p>${escapeHtml(mail.intro)}</p>` +
    `<p><a href="${escapeHtml(mail.link)}">${escapeHtml(mail.linkLabel)}</a></p>` +
    `<p>${escapeHtml(mail.outro)}</p>`;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, text, html }),
    });
    if (!res.ok) console.error(`Resend answered ${res.status}: ${await res.text()}`);
    return res.ok;
  } catch (err) {
    console.error("Could not reach Resend", err);
    return false;
  }
}
