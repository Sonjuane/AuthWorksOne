<script setup>
// Shell: session + branding, sign-in gate, header/nav, and the current view.
import { computed, onMounted, ref } from 'vue';
import { api, loginUrl, setCsrf } from './api.js';
import NavLink from './components/NavLink.vue';
import { navigate, route } from './router.js';
import Account from './views/Account.vue';
import Admin from './views/Admin.vue';
import AppAccess from './views/AppAccess.vue';
import Connections from './views/Connections.vue';
import Consent from './views/Consent.vue';

const session = ref(null);
const branding = ref({});
const dark = ref(false);

const VIEWS = { '/connections': Connections, '/apps': AppAccess, '/account': Account, '/consent': Consent, '/admin': Admin };
const view = computed(() => VIEWS[route.value.pathname] ?? null);
const logo = computed(() => (dark.value ? branding.value.darkLogoUrl : branding.value.logoUrl) ?? branding.value.logoUrl);

onMounted(async () => {
  branding.value = await api('/ui-api/branding').catch(() => ({}));
  dark.value = Boolean(branding.value.isDarkModeEnabled && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark.value);
  const color = dark.value ? branding.value.darkPrimaryColor : branding.value.primaryColor;
  if (color) document.documentElement.style.setProperty('--color-brand', color);

  const data = await api('/ui-api/session');
  if (!data.user) {
    location.href = loginUrl();
    return;
  }
  setCsrf(data.csrf);
  session.value = data;
  if (route.value.pathname === '/' || !VIEWS[route.value.pathname]) navigate('/connections', { replace: true });
});
</script>

<template>
  <div v-if="session" class="flex min-h-screen flex-col">
    <header class="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div class="flex min-w-0 items-center gap-3">
          <img v-if="logo" :src="logo" alt="AuthWorks" class="h-8 w-auto" />
          <span class="truncate text-sm font-semibold text-gray-500 dark:text-gray-400">Connector Hub</span>
        </div>
        <div class="flex min-w-0 items-center gap-3 text-sm">
          <span class="hidden truncate text-gray-500 sm:inline dark:text-gray-400">{{ session.user.email }}</span>
          <a href="/logout" class="btn-secondary">Sign out</a>
        </div>
      </div>
      <nav class="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 pb-2 sm:px-4" aria-label="Main">
        <NavLink to="/connections">Connections</NavLink>
        <NavLink to="/apps">App access</NavLink>
        <NavLink to="/account">Account</NavLink>
        <NavLink v-if="session.isAdmin" to="/admin">Admin</NavLink>
      </nav>
    </header>
    <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
      <component :is="view" v-if="view" :session="session" />
    </main>
  </div>
  <div v-else class="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading…</div>
</template>
