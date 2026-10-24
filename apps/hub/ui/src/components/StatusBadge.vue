<script setup>
import { computed } from 'vue';

const props = defineProps({ status: { type: String, required: true } });
const STYLES = {
  active: ['Active', 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'],
  needs_reauth: ['Needs reconnect', 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'],
  revoked: ['Revoked', 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'],
  error: ['Error', 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'],
  disabled: ['Disabled', 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'],
  missing_env: ['Missing env', 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'],
};
const style = computed(() => STYLES[props.status] ?? [props.status, 'bg-gray-100 text-gray-700']);
</script>

<template>
  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" :class="style[1]">{{ style[0] }}</span>
</template>
