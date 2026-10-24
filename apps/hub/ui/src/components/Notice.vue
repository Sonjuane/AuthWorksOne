<script setup>
defineProps({ notice: { type: Object, default: null } });
defineEmits(['close']);
</script>

<template>
  <div
    v-if="notice"
    role="status"
    class="mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm"
    :class="notice.type === 'error'
      ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
      : 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200'"
  >
    <span>{{ notice.text }}</span>
    <button type="button" class="font-semibold opacity-70 hover:opacity-100" aria-label="Dismiss" @click="$emit('close')">×</button>
  </div>
</template>
