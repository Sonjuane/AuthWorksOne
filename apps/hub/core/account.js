// Hub UI profile (UI-01, ID-06) through the Logto Account API with the signed-in user's opaque
// access token (server side). `customData` PATCH replaces the whole object, so it is merged first.
import { ApiError } from './auth.js';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));
const CUSTOM_FIELDS = ['displayName', 'jobTitle'];

export const isTimezone = (value) => value === 'UTC' || TIMEZONES.has(value);

export function createAccount({ apiBase, accessToken }) {
  const call = async (session, method, path, body) => {
    const res = await fetch(`${apiBase}/api/my-account${path}`, {
      method,
      headers: { authorization: `Bearer ${await accessToken(session)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status === 400 ? 400 : 502, res.status === 400 ? 'invalid_request' : 'account_api_failed', data.message ?? `Account API -> ${res.status}`);
    return data;
  };
  const view = (me) => ({
    email: me.primaryEmail ?? null,
    name: me.name ?? '',
    avatar: me.avatar ?? '',
    displayName: me.customData?.displayName ?? '',
    jobTitle: me.customData?.jobTitle ?? '',
    timezone: me.profile?.zoneinfo ?? '',
  });

  return {
    get: async (session) => view(await call(session, 'GET', '')),

    async update(session, input) {
      const text = (value, max) => {
        const trimmed = String(value ?? '').trim();
        if (trimmed.length > max) throw new ApiError(400, 'invalid_request', `Value too long (max ${max})`);
        return trimmed;
      };
      const avatar = text(input.avatar, 2048);
      if (avatar && !/^https:\/\//.test(avatar)) throw new ApiError(400, 'invalid_request', 'Avatar must be an https:// image URL');
      const timezone = text(input.timezone, 64);
      if (timezone && !isTimezone(timezone)) throw new ApiError(400, 'invalid_request', 'Unknown timezone');
      const current = await call(session, 'GET', '');
      const customData = { ...(current.customData ?? {}) };
      for (const field of CUSTOM_FIELDS) customData[field] = text(input[field], 100);
      if (!customData.displayName) throw new ApiError(400, 'invalid_request', 'Display name is required');
      await call(session, 'PATCH', '', { name: text(input.name, 100) || null, avatar: avatar || null, customData });
      await call(session, 'PATCH', '/profile', { zoneinfo: timezone || undefined });
      return view(await call(session, 'GET', ''));
    },
  };
}
