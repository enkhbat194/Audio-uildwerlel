import { getFreshFirebaseIdToken } from './firebaseClient';

export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getFreshFirebaseIdToken();
  const headers = new Headers(init.headers ?? {});
  headers.set('X-Requested-With', 'AhojAudioFactory');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    headers,
  });
}

export async function downloadAuthedFile(url: string, fallbackFilename: string): Promise<void> {
  const res = await authedFetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Файл татах алдаа (${res.status}): ${text.slice(0, 120)}`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}
