<script setup>
// App access (UI-03, TV-03): which apps may use which connections, with revoke.
import { computed, onMounted, ref } from 'vue';
import { api, describeError } from '../api.js';
import Notice from '../components/Notice.vue';
import StatusBadge from '../components/StatusBadge.vue';

const grants = ref([]);
const notice = ref(null);
const confirm = ref(null);

const byApp = computed(() => {
  const groups = new Map();
  for (const grant of grants.value) {
    if (!groups.has(grant.app.clientId)) groups.set(grant.app.clientId, { app: grant.app, grants: [] });
    groups.get(grant.app.clientId).grants.push(grant);
  }
  return [...groups.values()];
});

const load = async () => { grants.value = await api('/ui-api/grants'); };
onMounted(load);

const revoke = async (grant) => {
  try {
    await api('/ui-api/grants/revoke', { method: 'POST', body: { grantId: grant.id } });
    confirm.value = null;
    notice.value = { type: 'success', text: `${grant.app.name} can no longer use "${grant.connection.label}".` };
    await load();
  } catch (err) {
    notice.value = { type: 'error', text: describeError(err) };
  }
};
</script>

<template>
  <section>
    <h1 class="mb-4 text-xl font-semibold">App access</h1>
    <Notice :notice="notice" @close="notice = null" />
    <p v-if="!grants.length" class="card text-sm text-gray-500 dark:text-gray-400">No apps have access to your connections. Apps ask for access when they need it.</p>
    <div v-for="group in byApp" :key="group.app.clientId" class="card mb-4">
      <h2 class="mb-3 font-semibold">{{ group.app.name }}</h2>
      <ul class="divide-y divide-gray-100 dark:divide-gray-800">
        <li v-for="grant in group.grants" :key="grant.id" class="flex flex-wrap items-center justify-between gap-3 py-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ grant.connection.label }}</p>
            <p class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>{{ grant.connection.connectorId }}</span>
              <StatusBadge :status="grant.connection.status" />
              <span>since {{ new Date(grant.grantedAt).toLocaleDateString() }}</span>
            </p>
          </div>
          <div class="flex gap-2">
            <template v-if="confirm === grant.id">
              <button type="button" class="btn-danger" @click="revoke(grant)">Confirm revoke</button>
              <button type="button" class="btn-secondary" @click="confirm = null">Keep</button>
            </template>
            <button v-else type="button" class="btn-secondary" @click="confirm = grant.id">Revoke</button>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
