<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { useOrderStore } from '@/stores/orderStore'
import { convertDriveUrlToImage, getPlaceholderImage } from '@/utils/imageUrl'

const store = useOrderStore()

// Convert pool record to array for draggable
const poolList = computed(() => {
  return Object.values(store.pool)
})

const getImageUrl = (imageUrl: string) => {
  if (!imageUrl) return getPlaceholderImage()
  return convertDriveUrlToImage(imageUrl)
}

const handleRemove = (id: string) => {
  store.removeFromPool(id)
}
</script>

<template>
  <div class="cast-pool">
    <div v-if="poolList.length === 0" class="empty-pool">
      <p class="text-sm text-gray-400">カレンダーで案件を選び、<br>キャストを追加してください</p>
    </div>

    <draggable
      :list="poolList"
      :group="{ name: 'casts', pull: 'clone', put: false }"
      item-key="id"
      :sort="false"
      class="pool-list"
    >
      <template #item="{ element }">
        <div class="pool-item">
          <!-- remove button top right -->
          <button 
            @click="handleRemove(element.id)" 
            class="remove-btn"
          >
            <i class="pi pi-times"></i>
          </button>

          <img 
            :src="getImageUrl(element.cast.imageUrl)"
            class="pool-thumb"
            @error="($event.target as HTMLImageElement).src = getPlaceholderImage()"
          />
          <div class="pool-info">
            <div class="pool-name">{{ element.cast.name }}</div>
            <div class="pool-agency">{{ element.cast.agency }}</div>
          </div>
        </div>
      </template>
    </draggable>
  </div>
</template>

<style scoped>
.cast-pool {
  height: 100%;
  overflow-y: auto;
  padding: 0.5rem;
}

.empty-pool {
  text-align: center;
  padding: 2rem 0.5rem;
}

.pool-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 100px;
}

.pool-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: white;
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
  cursor: grab;
  transition: box-shadow 0.2s;
}

.pool-item:hover {
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.pool-thumb {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}

.pool-info {
  flex: 1;
  min-width: 0;
}

.pool-name {
  font-weight: 700;
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pool-agency {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.remove-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  background: none;
  border: none;
  color: var(--p-text-muted-color);
  font-size: 0.7rem;
  cursor: pointer;
  padding: 2px;
}
.remove-btn:hover {
  color: var(--p-red-500);
}
</style>
