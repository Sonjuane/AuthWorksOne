<script setup>
// Hub admin (UI-05, AU-04): connector status, client settings (read-only), audit log with filters.
import { onMounted, reactive, ref } from 'vue';
import { api, describeError } from '../api.js';
import StatusBadge from '../components/StatusBadge.vue';

const tab = ref('connectors');
const connectors = ref([]);
const clients = ref({ clients: [], notProvisioned: [] });
const audit = reactive({ entries: [], events: [], nextBefore: null });
const filters = reactive({ sub: '', event: '', client: '', from: '', to: '' });
const error = ref(null);

const query = (before) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, key === 'from' || key === 'to' ? new Date(value).toISOString() : value.trim());
  if (before) params.set('before', before);
  return params;
};

const loadAudit = async (more = false) => {
  try {
    const page = await api(`/ui-api/admin/audit?${query(more ? audit.nextBefore : null)}`);
    audit.events = page.events;
    audit.entries = more ? [...audit.entries, ...page.entries] : page.entries;
    audit.nextBefore = page.nextBefore;
  } catch (err) {
    error.value = describeError(err);
  }
};

onMounted(async () => {
  try {
    [connectors.value, clients.value] = await Promise.all([api('/ui-api/admin/connectors'), api('/ui-api/admin/clients')]);
    await loadAudit();
  } catch (err) {
    error.value = describeError(err);
  }
});

const TABS = [['connectors', 'Connectors'], ['clients', 'Client apps'], ['audit', 'Audit log']];
</script>

<template>
  <section>
    <h1 class="mb-4 text-xl font-semibold">Hub admin</h1>
    <p v-if="error" class="card mb-4 text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <div class="mb-4 flex gap-1 overflow-x-auto" role="tablist">
      <button v-for="[id, name] in TABS" :key="id" type="button" role="tab" :aria-selected="tab === id" class="btn" :class="tab === id ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'" @click="tab = id">{{ name }}</button>
    </div>

    <div v-if="tab === 'connectors'" class="space-y-3">
      <div v-for="c in connectors" :key="c.id" class="card flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="font-medium">{{ c.name }} <span class="text-sm font-normal text-gray-500">({{ c.id }}, {{ c.authType }})</span></p>
          <p class="truncate text-xs text-gray-500 dark:text-gray-400">{{ c.file }}</p>
          <p v-if="c.missingEnv.length" class="mt-1 text-xs text-amber-700 dark:text-amber-300">Set in env: {{ c.missingEnv.join(', ') }}</p>
        </div>
        <StatusBadge :status="c.status" />
      </div>
    </div>

    <div v-if="tab === 'clients'" class="space-y-3">
      <div v-for="c in clients.clients" :key="c.clientId" class="card">
        <p class="font-medium">{{ c.name }} <span class="text-sm font-normal text-gray-500">({{ c.key }})</span></p>
        <dl class="mt-2 grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt class="text-gray-500">Client ID</dt><dd class="font-mono text-xs break-all">{{ c.clientId }}</dd>
          <dt class="text-gray-500">Allowed connectors</dt><dd>{{ c.allowedConnectors.join(', ') || '—' }}</dd>
          <dt class="text-gray-500">Consent return URIs</dt><dd class="break-all">{{ c.consentReturnUris.join(', ') || '—' }}</dd>
        </dl>
      </div>
      <p v-if="clients.notProvisioned.length" class="text-sm text-gray-500">Configured but not provisioned in this profile: {{ clients.notProvisioned.join(', ') }}</p>
      <p class="text-xs text-gray-500">Read-only. Change client settings in config/sso.config.json and run npm run provision.</p>
    </div>

    <div v-if="tab === 'audit'" class="space-y-4">
      <form class="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5" @submit.prevent="loadAudit()">
        <div><label class="label" for="f-sub">User (sub)</label><input id="f-sub" v-model="filters.sub" class="field" /></div>
        <div>
          <label class="label" for="f-event">Event</label>
          <select id="f-event" v-model="filters.event" class="field"><option value="">Any</option><option v-for="e in audit.events" :key="e" :value="e">{{ e }}</option></select>
        </div>
        <div>
          <label class="label" for="f-client">Client</label>
          <select id="f-client" v-model="filters.client" class="field"><option value="">Any</option><option v-for="c in clients.clients" :key="c.clientId" :value="c.clientId">{{ c.name }}</option></select>
        </div>
        <div><label class="label" for="f-from">From</label><input id="f-from" v-model="filters.from" type="datetime-local" class="field" /></div>
        <div><label class="label" for="f-to">To</label><input id="f-to" v-model="filters.to" type="datetime-local" class="field" /></div>
        <div class="flex gap-2 sm:col-span-2 lg:col-span-5"><button type="submit" class="btn-primary">Apply filters</button></div>
      </form>
      <div class="card overflow-x-auto p-0 sm:p-0">
        <table class="w-full min-w-[44rem] text-left text-sm">
          <thead class="border-b border-gray-200 text-xs text-gray-500 uppercase dark:border-gray-800">
            <tr><th class="px-4 py-2">Time</th><th class="px-4 py-2">Event</th><th class="px-4 py-2">Result</th><th class="px-4 py-2">User</th><th class="px-4 py-2">Client</th><th class="px-4 py-2">IP</th></tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr v-for="e in audit.entries" :key="e.id">
              <td class="px-4 py-2 whitespace-nowrap">{{ new Date(e.at).toLocaleString() }}</td>
              <td class="px-4 py-2 font-mono text-xs">{{ e.event_type }}</td>
              <td class="px-4 py-2"><span :class="e.result === 'failure' ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'">{{ e.result }}</span><span v-if="e.error_code" class="ml-1 text-xs text-gray-500">{{ e.error_code }}</span></td>
              <td class="px-4 py-2 font-mono text-xs">{{ e.sub ?? '—' }}</td>
              <td class="px-4 py-2 font-mono text-xs">{{ e.client_id ?? '—' }}</td>
              <td class="px-4 py-2 font-mono text-xs">{{ e.ip ?? '—' }}</td>
            </tr>
            <tr v-if="!audit.entries.length"><td colspan="6" class="px-4 py-6 text-center text-gray-500">No entries match.</td></tr>
          </tbody>
        </table>
      </div>
      <button v-if="audit.nextBefore" type="button" class="btn-secondary" @click="loadAudit(true)">Load more</button>
    </div>
  </section>
</template>
