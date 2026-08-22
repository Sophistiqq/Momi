import type { Handle } from '@sveltejs/kit';

export function init() {
	const url = process.env.RENDER_EXTERNAL_URL;
	if (!url) return;

	Bun.cron('*/10 * * * *', async () => {
		try {
			await fetch(url, { method: 'HEAD' });
		} catch {
			// ignore; next fire will retry
		}
	}, { tz: 'UTC' });
}

export const handle: Handle = async ({ event, resolve }) => resolve(event);
