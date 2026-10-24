<script setup>
// Consent page (UI-04, TV-02): app name, connector, connection label; returns the user only to a
// URI the server validated against the app's consentReturnUris.
import { computed, onMounted, ref } from 'vue';
import { api, describeError } from '../api.js';
import StatusBadge from '../components/StatusBadge.vue';
import { navigate, route } from '../router.js';

const info = ref(null);
const error = ref(null);
const choice = ref('');
const busy = ref(false);

const here = computed(() => `${route.value.pathname}${route.value.search}`);
const usable = computed(() => info.value?.connections.filter((c) => c.status === 'active') ?? []);
const withParam = (url, key, value) => `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;

onMounted(async () => {
  try {
    info.value = await api(`/ui-api/consent${route.value.search}`);
    const connected = route.value.searchParams.get('connected');
    choice.value = usable.value.find((c) => c.id === connected)?.id ?? usable.value[0]?.id ?? '';
  } catch (err) {
    error.value = describeError(err);
  }
});

const addConnection = () => {
  const { connector } = info.value;
  if (connector.flow === 'redirect') {
    const query = new URLSearchParams({ connector: connector.id, label: connector.name, returnTo: here.value });
    location.href = `/connect/start?${query}`;
  } else {
    navigate(`/connections?add=${encodeURIComponent(connector.id)}&next=${encodeURIComponent(here.value)}`);
  }
};

const allow = async () => {
  busy.value = true;
  try {
    const { redirectTo } = await api('/ui-api/consent', { method: 'POST', body: { clientId: info.value.app.clientId, connectionId: choice.value, returnTo: info.value.returnTo } });
    location.href = redirectTo;
  } catch (err) {
    error.value = describeError(err);
    busy.value = false;
  }
};

const deny = () => { location.href = withParam(info.value.returnTo, 'consent', 'denied'); };
</script>

<template>
  <section class="mx-auto max-w-lg">
    <div v-if="error" class="card text-sm text-red-700 dark:text-red-300">{{ error }}</div>
    <div v-else-if="info" class="card space-y-5">
      <div>
        <h1 class="text-xl font-semibold">Allow {{ info.app.name }}?</h1>
        <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
          <strong>{{ info.app.name }}</strong> wants to use your <strong>{{ info.connector.name }}</strong> connection.
          It gets short-lived access only; you can revoke it any time under App access.
        </p>
      </div>
      <fieldset v-if="usable.length" class="space-y-2">
        <legend class="label">Connection</legend>
        <label v-for="c in usable" :key="c.id" class="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700" :class="choice === c.id && 'border-brand ring-2 ring-brand/30'">
          <input v-model="choice" type="radio" name="connection" :value="c.id" class="accent-brand" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ c.label }}</span>
          <StatusBadge :status="c.status" />
        </label>
      </fieldset>
      <div v-else class="rounded-lg bg-gray-50 p-4 text-sm dark:bg-gray-800">
        <p>You don't have a usable {{ info.connector.name }} connection yet.</p>
        <button type="button" class="btn-primary mt-3" @click="addConnection">Connect {{ info.connector.name }}</button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary" :disabled="!choice || busy" @click="allow">Allow</button>
        <button type="button" class="btn-secondary" :disabled="busy" @click="deny">Deny</button>
      </div>
    </div>
    <p v-else class="text-sm text-gray-500">Loading…</p>
  </section>
</template>
