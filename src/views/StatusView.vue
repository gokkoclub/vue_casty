<script setup lang="ts">
import Card from 'primevue/card'
</script>

<template>
  <div class="status-view">
    <div class="page-header">
      <h1>キャスティング状況</h1>
    </div>
    
    <Card>
      <template #content>
        <p class="text-muted">キャスティング状況ビューがここに表示されます</p>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.status-view {
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
