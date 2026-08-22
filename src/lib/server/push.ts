import webpush from 'web-push';
import { supabase as db } from './db';

const subject = process.env.VAPID_SUBJECT;
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
if (subject && publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function sendPushToUser(userId: string, title: string, body: string, url = '/'): Promise<void> {
  if (!subject || !publicKey || !privateKey) return;
  const { data: subs, error } = await db()
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (error || !subs?.length) return;

  const payload = JSON.stringify({ title, body, url });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 86400, urgency: 'normal', timeout: 8000 }
      );
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db().from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
      console.error('push failed:', e?.statusCode ?? e?.message ?? e);
    }
  }
}
