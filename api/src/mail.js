import { Resend } from 'resend'

/** The mail transport, or null when unconfigured. Kept behind app.sendMail's existing
 *  seam so tests inject a fake and no other file learns the provider's name.
 *  `client` is injectable for tests; production builds one from the key.
 *  `html` is optional and spread in only when present: the dev console fallback takes
 *  three params and every recording seam in the suite records positionally, so a
 *  plain-text caller must send exactly the payload it always sent. */
export function transportFromEnv(env = process.env, client = null) {
  const key = env.RESEND_API_KEY
  const from = env.MAIL_FROM
  if (!key || !from) return null
  const resend = client ?? new Resend(key)
  return async (to, subject, body, html) => {
    const { error } = await resend.emails.send({
      from, to, subject, text: body, ...(html ? { html } : {}),
    })
    if (error) throw new Error(`mail send failed: ${error.message ?? error}`)
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

/* --- the shell -------------------------------------------------------------
   Mail clients are not browsers. Every structural style is inline because
   Outlook's Word engine drops <style> entirely; the <style> block carries only
   the two things that cannot be inlined. No images at all -- an image wordmark
   is a broken box in an image-blocking inbox -- and no webfont request, so every
   stack ends in a generic family and the design must read correctly with zero
   fonts loaded. Foreground AND background are set on every element so Gmail's
   forced dark inversion cannot eat half of it.
   ponytail: one shell, two callers, interpolated -- a render({...}) engine with
   six knobs would be more machinery than the two mails it serves. */
const SANS = "'Barlow','Helvetica Neue',Arial,sans-serif"
const COND = "'Barlow Condensed','Helvetica Neue',Arial,sans-serif"
const SCRIPT = "'Caveat','Bradley Hand','Segoe Script','Brush Script MT',cursive"

function shell({ preheader, eyebrow, heading, lede, block, foot }) {
  return `<!doctype html>
<html lang="en" style="color-scheme:light dark;supported-color-schemes:light dark;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>The Sweep</title>
<style>
@media (prefers-color-scheme: dark) {
  .page{background:#0a1017 !important;} .card{background:#16202c !important; border-color:#26313f !important;}
  .ink{color:#f2f4f6 !important;} .muted{color:#93a1b0 !important;} .foot{color:#6b7a8b !important;}
}
@media screen and (max-width:600px) {
  .shell{width:100% !important;} .pad{padding-left:22px !important; padding-right:22px !important;}
  .code{font-size:32px !important; letter-spacing:8px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:#f4f2ee;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f2ee;">
<tr><td align="center" style="padding:32px 12px 40px;">
<table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
  <tr><td class="pad" align="left" style="padding:0 8px 18px;">
    <span class="ink" style="font-family:${SCRIPT};font-size:34px;line-height:1;color:#0f1620;">The Sweep</span>
  </td></tr>
  <tr><td class="card" style="background:#ffffff;border:1px solid #e2ded6;border-radius:16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="pad" style="padding:30px 34px 0;">
        <p style="margin:0;font-family:${COND};font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#ec3013;">${eyebrow}</p>
        <h1 class="ink" style="margin:10px 0 0;font-family:${COND};font-size:28px;font-weight:800;letter-spacing:-.2px;line-height:1.15;text-transform:uppercase;color:#0f1620;">${heading}</h1>
        <p class="muted" style="margin:10px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:#5f5b58;">${lede}</p>
      </td></tr>
      <tr><td class="pad" style="padding:22px 34px 4px;">${block}</td></tr>
      <tr><td class="pad" style="padding:20px 34px 30px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="8" style="width:8px;height:8px;background:#ec3013;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
          <td class="muted" style="padding-left:10px;font-family:${SANS};font-size:13.5px;line-height:1.6;color:#5f5b58;">${foot}</td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="foot pad" align="left" style="padding:18px 8px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:#8a8481;">The Sweep &middot; we never ask for your password.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

/** The join code. The code leads the subject because most people never open the mail --
 *  iOS and Gmail both surface it from the subject alone. The sweep name is deliberately
 *  NOT in the subject: it is owner-typed free text and a free cardless trial makes it a
 *  lure vector. It appears escaped in the body only. */
export function codeMail(code, sweepName) {
  const sweep = esc(sweepName ?? 'your sweep')
  return {
    subject: `${code} is your code for The Sweep`,
    text: `THE SWEEP\n\nYour code for ${sweepName ?? 'your sweep'}: ${code}\n\n`
      + 'Type it into the page you left open. It works once and expires in\n'
      + '15 minutes. Never share this code - nobody from The Sweep will ask\n'
      + 'you for it.\n\n'
      + "Didn't ask for this? Someone typed your address into a sweep invite.\n"
      + 'Ignore this email and nothing happens.\n',
    html: shell({
      preheader: `Your code is ${esc(code)} - it expires in 15 minutes.`,
      eyebrow: `Joining ${sweep}`,
      heading: 'Here&rsquo;s your code',
      lede: 'Type it into the page you left open. It works once, and it expires in 15 minutes.',
      block: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f1620;border-radius:12px;">
          <tr><td align="center" style="padding:24px 12px;">
            <span class="code" style="font-family:ui-monospace,'SFMono-Regular',Menlo,Consolas,'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:12px;line-height:1;color:#ffffff;-webkit-user-select:all;user-select:all;">${esc(code)}</span>
          </td></tr>
        </table>`,
      foot: 'Never share this code &mdash; nobody from The Sweep will ask you for it. '
        + 'Didn&rsquo;t ask for this? Someone typed your address into a sweep invite. '
        + 'Ignore this email and nothing happens.',
    }),
  }
}

/** The owner put someone on the roster. This carries the GROUP link, never a per-person
 *  credential -- see the member-identity spec section 2 for why per-person links are refused. */
export function inviteMail(sweepName, link) {
  const sweep = esc(sweepName ?? 'a sweep')
  return {
    subject: `You're in ${sweepName ?? 'a sweep'} on The Sweep`,
    text: `THE SWEEP\n\nSomeone added you to ${sweepName ?? 'a sweep'}.\n\n`
      + `Open this link, enter this email address, and the seat they set up\nfor you is yours:\n\n${link}\n\n`
      + "Didn't expect this? Ignore this email - nothing happens until you\nopen the link.\n",
    html: shell({
      preheader: `Someone added you to ${sweep}. Open the link to take your seat.`,
      eyebrow: `You&rsquo;re in ${sweep}`,
      heading: 'Someone put you in the sweep',
      lede: 'Open the link and enter this email address. The seat they set up for you - and any teams already drawn to it - is yours.',
      block: `<a href="${esc(link)}" style="padding:13px 26px;border-radius:11px;background:#ec3013;color:#ffffff;font-family:${COND};font-size:17px;font-weight:800;text-transform:uppercase;text-decoration:none;display:inline-block;">Take your seat</a>
        <p class="muted" style="margin:14px 0 0;font-family:${SANS};font-size:12.5px;line-height:1.5;word-break:break-all;color:#5f5b58;">${esc(link)}</p>`,
      foot: 'Didn&rsquo;t expect this? Ignore this email &mdash; nothing happens until you open the link.',
    }),
  }
}
