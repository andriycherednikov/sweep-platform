import Fastify from 'fastify'
import Stripe from 'stripe'
import { bootstrapRoutes } from './routes/bootstrap.js'
import { fixtureRoutes } from './routes/fixtures.js'
import { standingsRoutes } from './routes/standings.js'
import { peopleRoutes } from './routes/people.js'
import { teamRoutes } from './routes/teams.js'
import { photoRoutes } from './routes/photos.js'
import { syncStatusRoutes } from './routes/sync-status.js'
import { streamRoutes } from './routes/stream.js'
import { socialRoutes } from './routes/social.js'
import { optoutRoutes } from './routes/optout.js'
import { coinsRoutes } from './routes/coins.js'
import { createBus } from './events/bus.js'
import multipart from '@fastify/multipart'
import fstatic from '@fastify/static'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { resolve } from 'node:path'
import { createStorageSync } from './photos/storage.js'
import { MAX_BYTES } from './photos/process.js'
import { adminRoutes } from './routes/admin.js'
import { sweepsRoutes } from './routes/sweeps.js'
import { sweepResolver } from './sweeps/resolve.js'
import { readOnlyGate } from './sweeps/read-only.js'
import { accountRoutes } from './routes/account.js'
import { catalogRoutes } from './routes/catalog.js'
import { publicRoutes } from './routes/public.js'
import { billingRoutes } from './routes/billing.js'
import { stripeWebhookRoutes } from './routes/stripe-webhook.js'
import { providerFor } from './providers/registry.js'
import { transportFromEnv } from './mail.js'

export function buildApp(db, opts = {}) {
  // Trust the forwarded headers only from the shared Caddy, which overwrites
  // X-Forwarded-For with the real client. Without this every request looks like it came
  // from the proxy and the per-client rate limits become one shared bucket.
  // Identified by address, not by hop count: fastify 5.12 disabled numeric trustProxy
  // (GHSA-3m5p-2c4r-xxw2) because a direct client can supply as many hops as it likes.
  // Caddy reaches us over the compose network, so the peer is always loopback or private.
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: 'loopback, uniquelocal' })
  app.decorate('db', db)
  app.decorate('bus', opts.bus ?? createBus())
  app.decorate('publish', opts.publish ?? ((event) => app.bus.publish(event)))

  const photosDir = resolve(opts.photosDir ?? process.env.PHOTOS_DIR ?? './photos-data')
  const store = createStorageSync(photosDir)
  app.decorate('photos', store)
  // Photos go live on upload. The queue used to be the default, which cost every new
  // member their own face until an admin got round to it — during signup, where the
  // whole point is to look like yourself. The owner can still remove any photo from the
  // Manage console, which is the recourse that actually gets used.
  // Set PHOTOS_AUTO_APPROVE=false to put them back behind moderation.
  const env = opts.env ?? process.env
  app.decorate('autoApprovePhotos', opts.autoApprovePhotos ?? env.PHOTOS_AUTO_APPROVE !== 'false')
  app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } })
  // serve approved/ at /photos (in prod Caddy does this; harmless to also expose here)
  app.register(fstatic, { root: store.approvedDir, prefix: '/photos/', decorateReply: false })

  // Signs the admin/member session cookies, so a default is role forgery for anyone who
  // has read this repo. Compose won't catch a missing one: `required: true` on the
  // env_file asserts the file exists, not that anything inside it is set.
  const sessionSecret = opts.sessionSecret ?? process.env.SESSION_SECRET
    ?? (process.env.NODE_ENV === 'production' ? null : 'dev-insecure-secret')
  if (!sessionSecret) throw new Error('SESSION_SECRET must be set in production')
  app.decorate('sessionSecret', sessionSecret)
  // The origin the BROWSER uses. Every outbound link is built from it — sign-in links,
  // invite links, the Stripe return — so a wrong one mails people a dead URL and a
  // missing one would silently mail them "undefined". Required in production, same
  // guard shape as sessionSecret above; in dev the SPA is on Vite, hence the default.
  const publicOrigin = opts.publicOrigin ?? process.env.PUBLIC_ORIGIN
    ?? (process.env.NODE_ENV === 'production' ? null : 'http://localhost:5173')
  if (!publicOrigin) throw new Error('PUBLIC_ORIGIN must be set in production')
  app.decorate('publicOrigin', publicOrigin)
  // adapter resolution seam — tests inject recorded providers; live code gets the registry
  app.decorate('providerFor', opts.providerFor ?? providerFor)
  // Feed fills started by a request but not waited on by it (see routes/account.js).
  // Tests await fillsIdle() where they need the data; production never waits.
  app.decorate('fills', new Set())
  app.decorate('fillsIdle', () => Promise.allSettled([...app.fills]))
  // Sign-in links and member verification both ride this. A production boot with no
  // transport would print bearer credentials to stdout, so it is refused — the same
  // shape as the sessionSecret guard above. opts.sendMail is the test seam, so the
  // guard must read the ENV, not the option, or a configured prod boot would throw.
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV
  const sendMail = opts.sendMail
    ?? transportFromEnv(opts.env ?? process.env)
    ?? (nodeEnv === 'production' ? null : (async (to, subject, body) => console.log(`[mail] to=${to} subject=${subject}\n${body}`)))
  if (!sendMail) throw new Error('a mail transport must be configured in production')
  app.decorate('sendMail', sendMail)
  // Stripe seam (P4): tests inject a fake; dev without a key runs fine (billing routes 503).
  const stripeKey = opts.stripeKey ?? process.env.STRIPE_SECRET_KEY ?? ''
  if (/^(sk|rk)_live/.test(stripeKey) && process.env.NODE_ENV !== 'production') {
    throw new Error('live Stripe key outside production — refusing to boot')
  }
  app.decorate('stripe', opts.stripe ?? (stripeKey ? new Stripe(stripeKey) : null))
  app.decorate('stripeWebhookSecret', opts.stripeWebhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '')
  app.decorate('stripePriceId', opts.stripePriceId ?? process.env.STRIPE_PRICE_ID ?? '')
  app.register(cookie, { secret: sessionSecret })
  app.register(rateLimit, { global: false })

  app.get('/api/health', async () => ({ ok: true }))
  app.addHook('preHandler', sweepResolver(app))
  app.addHook('preHandler', readOnlyGate(app))
  app.get('/api/whoami', async (req) => ({ sweepId: req.sweep?.id ?? null, role: req.role ?? null }))
  app.register(bootstrapRoutes)
  app.register(fixtureRoutes)
  app.register(standingsRoutes)
  app.register(peopleRoutes)
  app.register(teamRoutes)
  app.register(photoRoutes)
  app.register(syncStatusRoutes)
  app.register(streamRoutes)
  app.register(socialRoutes)
  app.register(optoutRoutes)
  app.register(coinsRoutes)
  app.register(adminRoutes)
  app.register(sweepsRoutes)
  app.register(accountRoutes)
  app.register(billingRoutes)
  app.register(stripeWebhookRoutes)
  app.register(catalogRoutes)
  app.register(publicRoutes)
  return app
}
