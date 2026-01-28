<script setup lang="ts">
import Card from 'primevue/card'
</script>

<template>
  <div class="management-view">
    <div class="page-header">
      <h1>管理画面</h1>
    </div>
    
    <Card>
      <template #content>
        <p class="text-muted">管理画面がここに表示されます</p>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.management-view {
  padding: 1rem;
}

.page-header {
  margin-bottom: 1.5rem;
}

.page-header h1 {
  font-size: 1.75rem;
  font-weight: 600;
}

.text-muted {
  color: var(--p-text-muted-color);
}
</style>
