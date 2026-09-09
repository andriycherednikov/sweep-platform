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
   Mail clients are not browsers, and designing for them means designing for the
   FALLBACK. No webfont loads here, so Barlow/Barlow Condensed do nothing and
   every heading lands in Helvetica — which is why leaning on the app's
   typography made this look like an unstyled document. What survives everywhere
   is colour, weight, case, spacing and a rule, so the brand is carried by a navy
   masthead and an accent hairline rather than by a typeface.

   Everything structural is inline: Outlook's Word engine drops <style> entirely,
   so the block below only holds what cannot be inlined (dark mode, one media
   query). No images at all — an image wordmark is a broken box in an
   image-blocking inbox. Foreground AND background are set on every element so
   Gmail's forced inversion cannot eat half of it.
   ponytail: one shell, two callers, interpolated — a render({...}) engine with
   six knobs would be more machinery than the two mails it serves. */
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
// The wordmark IS the logo (web/src/styles.css:1037). Caveat is requested for the
// clients that honour a webfont — Apple Mail does — and the rest fall through a stack of
// script faces that actually ship on their platform, so it still reads as a signature
// rather than as a heading. Never uppercased: on the site it is sentence case.
const SCRIPT = "'Caveat','Bradley Hand','Segoe Script','Brush Script MT',cursive"
const MONO = "ui-monospace,'SFMono-Regular',Menlo,Consolas,'Courier New',monospace"
const INK = '#0f1620'
const ACCENT = '#ec3013'       // --lp-accent
// --lp-lift: the same red, lifted for use ON the ink ground. #ec3013 on #0f1620 is
// 4.3:1, under AA for text this size; the lift is 5.8:1 and the design system already
// defines it for exactly this (web/src/styles.css:1020).
const ACCENT_LIFT = '#ff563c'

function shell({ preheader, eyebrow, heading, lede, block, foot }) {
  return `<!doctype html>
<html lang="en" style="color-scheme:light dark;supported-color-schemes:light dark;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>The Sweep</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@700&display=swap');
@media (prefers-color-scheme: dark) {
  .page{background:#0a0f16 !important;}
  .card{background:#131c26 !important;}
  .ink{color:#f4f6f8 !important;} .muted{color:#9aa8b6 !important;} .foot{color:#75828f !important;}
  .rule{border-color:#26313d !important;}
  .codebox{background:#000000 !important;}
}
@media screen and (max-width:600px) {
  .shell{width:100% !important;}
  .pad{padding-left:26px !important; padding-right:26px !important;}
  .code{font-size:32px !important; letter-spacing:8px !important;}
  .h1{font-size:26px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:#eeebe5;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eeebe5;">
<tr><td align="center" style="padding:36px 12px 44px;">
<table role="presentation" class="shell" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">

  <!-- masthead: the brand is a navy band, because a typeface cannot be relied on -->
  <tr><td style="background:${INK};border-radius:14px 14px 0 0;padding:22px 34px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="font-family:${SCRIPT};font-size:30px;font-weight:700;line-height:1.1;color:#ffffff;">The Sweep</td>
      <td align="right" style="font-family:${SANS};font-size:12.5px;font-weight:700;letter-spacing:.3px;color:${ACCENT_LIFT};">${eyebrow}</td>
    </tr></table>
  </td></tr>
  <!-- the accent lives here: one hairline, and it survives every client -->
  <tr><td style="background:${ACCENT};font-size:0;line-height:0;height:3px;">&nbsp;</td></tr>

  <tr><td class="card" style="background:#ffffff;border-radius:0 0 14px 14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

      <tr><td class="pad" style="padding:34px 34px 0;">
        <h1 class="ink h1" style="margin:0;font-family:${SANS};font-size:30px;font-weight:700;letter-spacing:-.5px;line-height:1.15;color:${INK};">${heading}</h1>
        <p class="muted" style="margin:12px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:#5f6b76;">${lede}</p>
      </td></tr>

      <tr><td class="pad" style="padding:24px 34px 0;">${block}</td></tr>

      <tr><td class="pad" style="padding:26px 34px 0;">
        <div class="rule" style="border-top:1px solid #ebe7e0;font-size:0;line-height:0;">&nbsp;</div>
      </td></tr>
      <tr><td class="pad muted" style="padding:14px 34px 30px;font-family:${SANS};font-size:12.5px;line-height:1.6;color:#8b949d;">${foot}</td></tr>

    </table>
  </td></tr>

  <tr><td class="foot" align="center" style="padding:18px 8px 0;font-family:${SANS};font-size:11.5px;line-height:1.6;color:#9b968f;">The Sweep &middot; we will never ask you for your password.</td></tr>

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
      eyebrow: sweep,
      heading: 'Your code',
      lede: 'Type this into the page you left open. It works once, and it expires in 15 minutes.',
      // The code is the payload, so it gets the strongest thing on the page. On paper it
      // was quieter than the masthead, which is the wrong way round for a mail whose
      // entire job is six digits.
      block: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="codebox" style="background:${INK};border-radius:12px;">
          <tr><td align="center" style="padding:26px 12px 28px;">
            <span class="code" style="font-family:${MONO};font-size:42px;font-weight:600;letter-spacing:11px;line-height:1;color:#ffffff;-webkit-user-select:all;user-select:all;">${esc(code)}</span>
          </td></tr>
        </table>`,
      foot: 'Never share this code &mdash; nobody from The Sweep will ask you for it. '
        + 'If you did not ask for it, someone typed your address into a sweep invite; '
        + 'ignore this and nothing happens.',
    }),
  }
}

/** The sign-in link. This is the mail an account holder sees most often, and it used to
 *  be a bare URL in an empty body — indistinguishable from phishing, and the one place
 *  the product had no chance to look like itself. Same shell as the rest; the button and
 *  the pasteable URL both carry the link, because link-stripping clients exist. */
export function loginMail(link) {
  return {
    subject: 'Your sign-in link for The Sweep',
    text: `THE SWEEP\n\nHere is your sign-in link:\n\n${link}\n\n`
      + 'Open it and you are signed in on this device. It works once and\n'
      + 'expires in 15 minutes.\n\n'
      + "Didn't ask to sign in? Ignore this email - the link goes nowhere\n"
      + 'without it being opened, and nobody gets into your account.\n',
    html: shell({
      preheader: 'Open the link and you are signed in \u2014 it expires in 15 minutes.',
      eyebrow: 'Sign in',
      heading: 'Your sign-in link',
      lede: 'Open this and you are signed in on this device. Nothing to type, no password to remember.',
      block: `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" style="background:${ACCENT};border-radius:10px;">
            <a href="${esc(link)}" style="display:inline-block;padding:15px 32px;font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:.4px;text-decoration:none;color:#ffffff;">Sign me in</a>
          </td>
        </tr></table>
        <p class="muted" style="margin:16px 0 0;font-family:${SANS};font-size:12px;line-height:1.55;word-break:break-all;color:#a09a95;">Button not working? Paste this into your browser:<br>${esc(link)}</p>`,
      foot: 'The link works once and expires in 15 minutes. If you did not ask to sign in, '
        + 'ignore this &mdash; nobody gets into your account without opening it.',
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
          <td align="center" style="background:${ACCENT};border-radius:10px;">
            <a href="${esc(link)}" style="display:inline-block;padding:15px 32px;font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:.4px;text-decoration:none;color:#ffffff;">Take your seat</a>
          </td>
        </tr></table>
        <p class="muted" style="margin:16px 0 0;font-family:${SANS};font-size:12px;line-height:1.55;word-break:break-all;color:#a09a95;">Button not working? Paste this into your browser:<br>${esc(link)}</p>`,
      foot: 'The link works once and expires in seven days. If you were not expecting it, '
        + 'ignore this and nothing happens.',
    }),
  }
}
