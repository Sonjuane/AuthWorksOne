// Minimal history router (avoids a vue-router dependency): the current URL as a reactive ref.
import { ref } from 'vue';

export const route = ref(new URL(location.href));

export function navigate(to, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', to);
  route.value = new URL(location.href);
  if (!replace) window.scrollTo(0, 0);
}

addEventListener('popstate', () => { route.value = new URL(location.href); });

// Same-origin relative paths only (mirrors the server's safeReturnPath).
export const safePath = (value, fallback = '/connections') =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : fallback;
