<script setup>
// In-app link: client-side navigation, normal browser behavior for modified clicks.
import { computed } from 'vue';
import { navigate, route } from '../router.js';

const props = defineProps({ to: { type: String, required: true }, match: { type: String, default: '' } });
const active = computed(() => route.value.pathname === props.to || (props.match && route.value.pathname.startsWith(props.match)));
const go = (event) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  navigate(props.to);
};
</script>

<template>
  <a
    :href="to"
    :aria-current="active ? 'page' : undefined"
    class="rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap"
    :class="active ? 'bg-brand/10 text-brand' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'"
    @click="go"
  ><slot /></a>
</template>
