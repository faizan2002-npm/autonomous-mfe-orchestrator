import { accountApi } from './api';

export type PushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** VAPID public keys are base64url; PushManager wants the raw bytes. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

/** Whether this browser currently receives push for the signed-in user. */
export async function pushState(publicKey: string | null): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!publicKey) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  const existing = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
  return existing && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Asks for permission, subscribes this device and registers it with the gateway. */
export async function enablePush(publicKey: string): Promise<PushState> {
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const worker = await registration();
  await navigator.serviceWorker.ready;
  let subscription = await worker.pushManager.getSubscription();
  if (!subscription)
    subscription = await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  const json = subscription.toJSON();
  await accountApi.subscribePush({
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const subscription = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
  if (subscription) {
    await accountApi.unsubscribePush(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
  }
  return 'off';
}
