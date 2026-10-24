<script setup>
// Account (UI-01): profile via the Logto Account API; security settings in Logto Account Center.
import { onMounted, reactive, ref } from 'vue';
import { api, describeError } from '../api.js';
import Notice from '../components/Notice.vue';

const props = defineProps({ session: { type: Object, required: true } });
const profile = reactive({ name: '', avatar: '', displayName: '', jobTitle: '', timezone: '', email: '' });
const notice = ref(null);
const busy = ref(false);
const timezones = Intl.supportedValuesOf('timeZone');

onMounted(async () => Object.assign(profile, await api('/ui-api/profile')));

const save = async () => {
  busy.value = true;
  try {
    Object.assign(profile, await api('/ui-api/profile', { method: 'POST', body: { ...profile } }));
    notice.value = { type: 'success', text: 'Profile saved.' };
  } catch (err) {
    notice.value = { type: 'error', text: describeError(err) };
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <section class="grid gap-6 lg:grid-cols-3">
    <form class="card min-w-0 space-y-4 lg:col-span-2" @submit.prevent="save">
      <h1 class="text-xl font-semibold">Profile</h1>
      <Notice :notice="notice" @close="notice = null" />
      <div class="flex min-w-0 items-center gap-4">
        <img v-if="profile.avatar" :src="profile.avatar" alt="" class="h-14 w-14 shrink-0 rounded-full object-cover" />
        <div v-else class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand/10 text-lg font-semibold text-brand">{{ (profile.displayName || profile.email || '?').slice(0, 1).toUpperCase() }}</div>
        <p class="min-w-0 truncate text-sm text-gray-500 dark:text-gray-400">{{ profile.email }}</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="displayName">Display name</label>
          <input id="displayName" v-model="profile.displayName" class="field" required maxlength="100" />
        </div>
        <div>
          <label class="label" for="name">Full name</label>
          <input id="name" v-model="profile.name" class="field" maxlength="100" />
        </div>
        <div>
          <label class="label" for="jobTitle">Job title</label>
          <input id="jobTitle" v-model="profile.jobTitle" class="field" maxlength="100" />
        </div>
        <div>
          <label class="label" for="timezone">Timezone</label>
          <select id="timezone" v-model="profile.timezone" class="field">
            <option value="">Not set</option>
            <option v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</option>
          </select>
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="avatar">Avatar image URL</label>
          <input id="avatar" v-model="profile.avatar" type="url" class="field" placeholder="https://…" maxlength="2048" />
        </div>
      </div>
      <button type="submit" class="btn-primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save profile' }}</button>
    </form>
    <aside class="card h-fit min-w-0 space-y-3">
      <h2 class="font-semibold">Security</h2>
      <p class="text-sm text-gray-600 dark:text-gray-300">Email, password, 2-step verification, linked sign-in accounts, and active sessions are managed in your account settings.</p>
      <a :href="props.session.accountCenterUrl" class="btn-secondary w-full">Open account settings</a>
    </aside>
  </section>
</template>
