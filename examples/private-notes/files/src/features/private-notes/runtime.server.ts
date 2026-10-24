import { requireUser } from '@/auth/index.server';
import { bindings } from '@/api/runtime.server';
import { paymentRuntime } from '@/api/payments.server';
import { websiteConfig } from '@/config/website';
import { publicEnvironment } from '@/env';
import { hasPaymentAccess } from '@/payment/entitlements';
import { handleNotes } from './service.server';

export async function privateNotesRequest(request: Request) {
  const env = bindings();
  return handleNotes(request, {
    db: env.DB,
    origin: publicEnvironment(env).APP_URL,
    authenticate: async (incoming) => (await requireUser(incoming, env)).user,
    hasPaidAccess: async (user) => {
      if (!websiteConfig.payment.provider) return false;
      // Existing service verifies the immutable mode/account/deployment namespace first.
      // This reads the durable projection, not a browser flag, redirect, or provider network API.
      const entitlement = await paymentRuntime(env).service.getEntitlement(user);
      return !!entitlement && entitlement.paid && hasPaymentAccess(entitlement);
    },
  });
}
