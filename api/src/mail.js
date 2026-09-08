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
   what cannot be inlined. No images at all -- an image wordmark is a broken box
   in an image-blocking inbox -- and no webfont request, so every stack ends in a
   generic family and this has to read correctly with zero fonts loaded. That is
   also why the wordmark is NOT set in a script face: Caveat never loads in mail,
   so it always fell through to whatever handwriting font the machine had, which
   is what made it look amateur. Condensed caps degrade to Arial and still look
   deliberate. Foreground AND background are set on every element so Gmail's
   forced dark inversion cannot eat half of it.
   ponytail: one shell, two callers, interpolated -- a render({...}) engine with
   six knobs would be more machinery than the two mails it serves. */
const SANS = "'Barlow','Helvetica Neue',Helvetica,Arial,sans-serif"
const COND = "'Barlow Condensed','Helvetica Neue',Helvetica,Arial,sans-serif"

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
  .page{background:#0b1119 !important;} .card{background:#141d28 !important; border-color:#243040 !important;}
  .ink{color:#f4f6f8 !important;} .muted{color:#9aa8b6 !important;} .foot{color:#6b7a8b !important;}
  .rule{border-color:#243040 !important;}
}
@media screen and (max-width:600px) {
  .shell{width:100% !important;} .pad{padding-left:26px !important; padding-right:26px !important;}
  .code{font-size:34px !important; letter-spacing:10px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:#f4f2ee;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f2ee;">
<tr><td align="center" style="padding:40px 12px 48px;">
<table role="presentation" class="shell" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">

  <tr><td class="pad" align="center" style="padding:0 0 22px;">
    <span class="ink" style="font-family:${COND};font-size:15px;font-weight:800;letter-spacing:5px;text-transform:uppercase;color:#0f1620;">The&nbsp;Sweep</span>
  </td></tr>

  <tr><td class="card" style="background:#ffffff;border:1px solid #e6e1d9;border-radius:14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

      <tr><td class="pad" style="padding:38px 40px 0;">
        <p class="muted" style="margin:0;font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#8a8481;">${eyebrow}</p>
        <h1 class="ink" style="margin:12px 0 0;font-family:${COND};font-size:30px;font-weight:700;letter-spacing:0;line-height:1.2;color:#0f1620;">${heading}</h1>
        <p class="muted" style="margin:12px 0 0;font-family:${SANS};font-size:15px;line-height:1.65;color:#5f5b58;">${lede}</p>
      </td></tr>

      <tr><td class="pad" style="padding:26px 40px 0;">${block}</td></tr>

      <tr><td class="pad" style="padding:28px 40px 0;">
        <div class="rule" style="border-top:1px solid #eeeae3;font-size:0;line-height:0;">&nbsp;</div>
      </td></tr>
      <tr><td class="pad muted" style="padding:16px 40px 34px;font-family:${SANS};font-size:13px;line-height:1.6;color:#8a8481;">${foot}</td></tr>

    </table>
  </td></tr>

  <tr><td class="foot pad" align="center" style="padding:20px 8px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:#a09a95;">The Sweep &middot; we will never ask you for your password.</td></tr>

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
      heading: 'Your code',
      lede: 'Type this into the page you left open. It works once, and it expires in 15 minutes.',
      block: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f1620;border-radius:12px;">
          <tr><td align="center" style="padding:26px 12px;">
            <span class="code" style="font-family:ui-monospace,'SFMono-Regular',Menlo,Consolas,'Courier New',monospace;font-size:38px;font-weight:600;letter-spacing:12px;line-height:1;color:#ffffff;-webkit-user-select:all;user-select:all;">${esc(code)}</span>
          </td></tr>
        </table>`,
      foot: 'Never share this code &mdash; nobody from The Sweep will ask you for it. '
        + 'If you did not ask for it, someone typed your address into a sweep invite; '
        + 'ignore this and nothing happens.',
    }),
  }
}

/** The organiser set a seat aside for someone. The link is addressed to THIS seat and
 *  THIS address: opening it signs them in and hands them the seat, teams and all, so
 *  they never retype the address the organiser just typed for them. Single-use and
 *  expiring, which is what keeps a forwarded copy from being a spare key. */
export function inviteMail(sweepName, link) {
  const sweep = esc(sweepName ?? 'a sweep')
  const name = sweepName ?? 'a sweep'
  return {
    subject: `Your seat in ${name}`,
    text: `THE SWEEP\n\nYou have a seat in ${name}.\n\n`
      + `Open this link and you are in - signed in, with whatever teams have\nalready been drawn to your name:\n\n${link}\n\n`
      + 'The link works once and expires in seven days. If you were not\nexpecting it, ignore this and nothing happens.\n',
    html: shell({
      preheader: `Open the link and you are in \u2014 signed in, teams and all.`,
      eyebrow: sweep,
      heading: 'You have a seat',
      lede: 'Open this and you are in — signed in as yourself, with whatever teams have already been drawn to your name. Nothing to type.',
      block: `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" style="background:#ec3013;border-radius:10px;">
            <a href="${esc(link)}" style="display:inline-block;padding:14px 30px;font-family:${COND};font-size:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;text-decoration:none;color:#ffffff;">Take your seat</a>
          </td>
        </tr></table>
        <p class="muted" style="margin:16px 0 0;font-family:${SANS};font-size:12px;line-height:1.55;word-break:break-all;color:#a09a95;">Button not working? Paste this into your browser:<br>${esc(link)}</p>`,
      foot: 'The link works once and expires in seven days. If you were not expecting it, '
        + 'ignore this and nothing happens.',
    }),
  }
}
