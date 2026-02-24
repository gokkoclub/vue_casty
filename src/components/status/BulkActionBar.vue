<script setup lang="ts">
import Button from 'primevue/button'

const props = defineProps<{
  selectedCount: number
}>()

const emit = defineEmits<{
  (e: 'delete'): void
  (e: 'updateStatus'): void
  (e: 'selectAll'): void
  (e: 'clearSelection'): void
}>()
</script>

<template>
  <div class="bulk-action-bar">
    <span class="selection-count">
      <i class="pi pi-check-square"></i>
      {{ selectedCount }}件選択中
    </span>
    
    <div class="actions">
      <Button 
        label="一括削除" 
        icon="pi pi-trash" 
        severity="danger"
        :disabled="selectedCount === 0"
        @click="emit('delete')"
      />
      <Button 
        label="一括ステータス更新" 
        icon="pi pi-pencil" 
        severity="info"
        :disabled="selectedCount === 0"
        @click="emit('updateStatus')"
      />
      <Button 
        label="全選択" 
        icon="pi pi-check-circle" 
        text
        @click="emit('selectAll')"
      />
      <Button 
        label="選択解除" 
        icon="pi pi-times-circle" 
        text
        @click="emit('clearSelection')"
      />
    </div>
  </div>
</template>

<style scoped>
.bulk-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: var(--blue-50);
  border: 1px solid var(--blue-200);
  border-radius: 8px;
  margin-bottom: 1rem;
}

.selection-count {
  font-weight: 600;
  color: var(--blue-800);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .bulk-action-bar {
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .actions {
    justify-content: center;
  }
}
</style>
