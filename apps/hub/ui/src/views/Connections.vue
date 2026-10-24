<script setup>
// Connections (UI-02): add, relabel, reconnect, delete, and status per connection.
import { computed, onMounted, reactive, ref } from 'vue';
import { api, describeError } from '../api.js';
import Notice from '../components/Notice.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { navigate, route, safePath } from '../router.js';

const connectors = ref([]);
const connections = ref([]);
const notice = ref(null);
const busy = ref(false);
const form = reactive({ open: false, connectorId: '', label: '', input: {}, connectionId: null });
const editing = reactive({ id: null, label: '' });
const confirmDelete = ref(null);

const byId = computed(() => Object.fromEntries(connectors.value.map((c) => [c.id, c])));
const selected = computed(() => byId.value[form.connectorId]);
const next = computed(() => route.value.searchParams.get('next'));
const fieldType = (field) => ({ secret: 'password', url: 'url' }[field.type] ?? 'text');

const load = async () => {
  [connectors.value, connections.value] = await Promise.all([api('/ui-api/connectors'), api('/ui-api/connections')]);
};

const openForm = ({ connectorId = '', connectionId = null } = {}) => {
  Object.assign(form, { open: true, connectorId, connectionId, label: '', input: {} });
};

onMounted(async () => {
  await load();
  const params = route.value.searchParams;
  if (params.get('connected')) notice.value = { type: 'success', text: 'Connection added.' };
  if (params.get('connect_error')) notice.value = { type: 'error', text: describeError({ code: params.get('connect_error') }) };
  if (params.get('reconnect')) {
    const existing = connections.value.find((c) => c.id === params.get('reconnect'));
    if (existing) openForm({ connectorId: existing.connectorId, connectionId: existing.id });
  }
  if (params.get('add') && byId.value[params.get('add')]) openForm({ connectorId: params.get('add') });
});

const submit = async () => {
  const connector = selected.value;
  if (!connector) return;
  if (connector.flow === 'redirect') {
    const query = new URLSearchParams(form.connectionId ? { connectionId: form.connectionId } : { connector: connector.id, label: form.label });
    if (next.value) query.set('returnTo', safePath(next.value));
    location.href = `/connect/start?${query}`;
    return;
  }
  busy.value = true;
  try {
    const body = form.connectionId ? { connectionId: form.connectionId, input: form.input } : { connectorId: connector.id, label: form.label, input: form.input };
    await api('/ui-api/connections', { method: 'POST', body });
    form.open = false;
    if (next.value) return navigate(safePath(next.value));
    notice.value = { type: 'success', text: form.connectionId ? 'Connection updated.' : 'Connection added.' };
    await load();
  } catch (err) {
    notice.value = { type: 'error', text: describeError(err) };
  } finally {
    busy.value = false;
  }
};

const reconnect = (connection) => {
  if (byId.value[connection.connectorId]?.flow === 'redirect') location.href = `/connect/start?connectionId=${connection.id}`;
  else openForm({ connectorId: connection.connectorId, connectionId: connection.id });
};

const saveLabel = async () => {
  try {
    await api('/ui-api/connections/relabel', { method: 'POST', body: { connectionId: editing.id, label: editing.label } });
    editing.id = null;
    await load();
  } catch (err) {
    notice.value = { type: 'error', text: describeError(err) };
  }
};

const remove = async (connection) => {
  try {
    await api('/ui-api/connections/delete', { method: 'POST', body: { connectionId: connection.id } });
    confirmDelete.value = null;
    notice.value = { type: 'success', text: `"${connection.label}" disconnected.` };
    await load();
  } catch (err) {
    notice.value = { type: 'error', text: describeError(err) };
  }
};
</script>

<template>
  <section>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">Connections</h1>
      <button type="button" class="btn-primary" :disabled="!connectors.length" @click="openForm()">Add connection</button>
    </div>
    <Notice :notice="notice" @close="notice = null" />

    <form v-if="form.open" class="card mb-6 space-y-4" @submit.prevent="submit">
      <h2 class="font-semibold">{{ form.connectionId ? 'Reconnect' : 'Add a connection' }}</h2>
      <div v-if="!form.connectionId">
        <label class="label" for="connector">Service</label>
        <select id="connector" v-model="form.connectorId" class="field" required>
          <option value="" disabled>Choose a service</option>
          <option v-for="c in connectors" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <div v-if="selected && !form.connectionId">
        <label class="label" for="label">Label</label>
        <input id="label" v-model="form.label" class="field" required maxlength="100" placeholder="e.g. My HubSpot portal" />
      </div>
      <template v-if="selected?.flow === 'form'">
        <div v-for="field in selected.credentialFields" :key="field.name">
          <label class="label" :for="field.name">{{ field.label }}</label>
          <input :id="field.name" v-model="form.input[field.name]" :type="fieldType(field)" class="field" :required="field.required !== false" :autocomplete="field.type === 'secret' ? 'new-password' : 'off'" />
        </div>
      </template>
      <p v-if="selected?.flow === 'redirect'" class="text-sm text-gray-500 dark:text-gray-400">You'll sign in to {{ selected.name }} and approve access, then come back here.</p>
      <p v-if="selected" class="text-xs text-gray-500 dark:text-gray-400">We test the credentials before saving them. Secrets are stored encrypted.</p>
      <div class="flex flex-wrap gap-2">
        <button type="submit" class="btn-primary" :disabled="busy || !selected">{{ selected?.flow === 'redirect' ? `Continue to ${selected.name}` : busy ? 'Testing…' : 'Save' }}</button>
        <button type="button" class="btn-secondary" @click="form.open = false">Cancel</button>
      </div>
    </form>

    <p v-if="!connections.length" class="card text-sm text-gray-500 dark:text-gray-400">No connections yet. Add one to let your apps use it.</p>
    <ul v-else class="space-y-3">
      <li v-for="c in connections" :key="c.id" class="card">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <form v-if="editing.id === c.id" class="flex flex-wrap gap-2" @submit.prevent="saveLabel">
              <input v-model="editing.label" class="field max-w-xs" maxlength="100" required aria-label="Label" />
              <button type="submit" class="btn-primary">Save</button>
              <button type="button" class="btn-secondary" @click="editing.id = null">Cancel</button>
            </form>
            <p v-else class="truncate font-medium">{{ c.label }}</p>
            <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span>{{ byId[c.connectorId]?.name ?? c.connectorId }}</span>
              <StatusBadge :status="c.status" />
              <span v-if="c.baseUrl" class="truncate">{{ c.baseUrl }}</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-if="c.status !== 'active'" type="button" class="btn-primary" @click="reconnect(c)">Reconnect</button>
            <button v-if="editing.id !== c.id" type="button" class="btn-secondary" @click="Object.assign(editing, { id: c.id, label: c.label })">Rename</button>
            <template v-if="confirmDelete === c.id">
              <button type="button" class="btn-danger" @click="remove(c)">Confirm disconnect</button>
              <button type="button" class="btn-secondary" @click="confirmDelete = null">Keep</button>
            </template>
            <button v-else type="button" class="btn-secondary" @click="confirmDelete = c.id">Disconnect</button>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
