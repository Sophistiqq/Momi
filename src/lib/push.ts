import { session } from './session.svelte';

// Ask for notification permission and register this device for web push,
// then store the subscription server-side. Best-effort: any failure (no
// support, denied permission, VAPID not configured) quietly does nothing.
export async function initPushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !session.user) return;
  try {
    const keyRes = await fetch('/share-target/push/public-key', { headers: { Accept: 'application/json' } });
    if (!keyRes.ok) return;
    const { publicKey } = await keyRes.json();
    if (!publicKey) return;

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return;

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    });
    const json = sub.toJSON();
    await fetch('/share-target/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      }),
    });
  } catch {
    // Notifications are best-effort; never break the feed over them.
  }
}

// VAPID keys arrive as URL-safe base64; pushManager wants raw bytes.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
