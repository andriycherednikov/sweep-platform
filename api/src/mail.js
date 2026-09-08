import { Resend } from 'resend'

/** The mail transport, or null when unconfigured. Kept behind app.sendMail's existing
 *  seam so tests inject a fake and no other file learns the provider's name.
 *  `client` is injectable for tests; production builds one from the key. */
export function transportFromEnv(env = process.env, client = null) {
  const key = env.RESEND_API_KEY
  const from = env.MAIL_FROM
  if (!key || !from) return null
  const resend = client ?? new Resend(key)
  return async (to, subject, body) => {
    const { error } = await resend.emails.send({ from, to, subject, text: body })
    if (error) throw new Error(`mail send failed: ${error.message ?? error}`)
  }
}
