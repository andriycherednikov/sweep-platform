/** Call-recording stand-in for the stripe SDK — tests never touch the network. */
export function fakeStripe(over = {}) {
  const calls = { customersCreate: [], checkoutCreate: [], portalCreate: [], subUpdate: [], subRetrieve: [], sessionRetrieve: [] }
  return {
    calls,
    customers: { create: async (p) => { calls.customersCreate.push(p); return { id: 'cus_fake1' } } },
    checkout: {
      sessions: {
        create: async (p) => { calls.checkoutCreate.push(p); return { id: 'cs_fake1', url: 'https://checkout.stripe.test/s1' } },
        retrieve: async (id) => {
          calls.sessionRetrieve.push(id)
          return over.session ?? {
            id, status: 'complete', payment_status: 'paid',
            client_reference_id: 'ac_bill', customer: 'cus_fake1', subscription: 'sub_fake1',
          }
        },
      },
    },
    billingPortal: { sessions: { create: async (p) => { calls.portalCreate.push(p); return { url: 'https://portal.stripe.test/p1' } } } },
    subscriptions: {
      update: async (id, p) => { calls.subUpdate.push({ id, ...p }); return { id } },
      retrieve: async (id) => { calls.subRetrieve.push(id); return over.subscription ?? { id, status: 'active', items: { data: [{ id: 'si_fake1' }] } } },
    },
    ...over,
  }
}
