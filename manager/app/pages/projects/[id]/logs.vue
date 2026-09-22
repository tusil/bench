<script setup lang="ts">
definePageMeta({
  middleware: (route) => {
    const id = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
    return navigateTo({
      path: `/projects/${encodeURIComponent(id || "")}`,
      query: route.query,
    }, { redirectCode: 301 });
  },
});
</script>

<template>
  <div />
</template>
