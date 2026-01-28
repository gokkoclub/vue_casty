<script setup lang="ts">
import { computed } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import { useOrderStore } from '@/stores/orderStore'

const store = useOrderStore()

// Get all casts from pool as a simple array
const selectedCasts = computed(() => {
  return Object.values(store.pool).map(cartCast => cartCast.cast)
})

const handleRemove = (castId: string) => {
  store.removeFromPool(castId)
}
</script>

<template>
  <div class="simple-cast-list">
    <h3 class="list-title">選択されたキャスト</h3>
    
    <div v-if="selectedCasts.length === 0" class="empty-state">
      <i class="pi pi-users" style="font-size: 2rem; opacity: 0.3;"></i>
      <p>キャストを選択してください</p>
    </div>

    <div v-else class="cast-items">
      <Card 
        v-for="cast in selectedCasts" 
        :key="cast.id"
        class="cast-item"
      >
        <template #content>
          <div class="cast-info">
            <div class="cast-name">{{ cast.name }}</div>
            <div class="cast-agency">{{ cast.agency || '事務所未登録' }}</div>
          </div>
          <Button
            icon="pi pi-times"
            severity="danger"
            text
            rounded
            @click="handleRemove(cast.id)"
            size="small"
          />
        </template>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.simple-cast-list {
  padding: 0.5rem;
}

.list-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: var(--primary-color);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  text-align: center;
  color: var(--text-color-secondary);
}

.empty-state p {
  margin-top: 0.5rem;
  font-size: 0.9rem;
}

.cast-items {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.cast-item {
  padding: 0;
}

.cast-item :deep(.p-card-content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
}

.cast-info {
  flex: 1;
}

.cast-name {
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.cast-agency {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}
</style>
