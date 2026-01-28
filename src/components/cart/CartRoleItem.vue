<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'
import Button from 'primevue/button'
import type { CartRole, CartCast } from '@/types'
import { useOrderStore } from '@/stores/orderStore'

const props = defineProps<{
  role: CartRole
  projectId: string
}>()

const store = useOrderStore()

// Computes array of CartCast objects for this role
const assignedCasts = computed({
  get: () => {
    // Collect cast objects from pool using IDs
    // Filter out any IDs that might not exist in pool anymore
    return props.role.castIds
      .map(id => store.pool[id])
      .filter(c => !!c) as CartCast[]
  },
  set: (newCasts: CartCast[]) => {
    // Update role.castIds with new order
    props.role.castIds = newCasts.map(c => c.id)
  }
})

const typeOptions = ['メイン', 'サブ']

const removeCast = (castId: string) => {
  store.removeCastFromRole(props.role.id, castId)
}
</script>

<template>
  <div class="role-item">
    <!-- Role Header / Input -->
    <div class="role-header">
      <div class="inputs">
        <InputText 
          v-model="role.name" 
          placeholder="役名を入力" 
          class="role-name-input"
          size="small"
        />
        <SelectButton 
          v-model="role.type" 
          :options="typeOptions" 
          class="compact-select"
        />
      </div>
      <Button 
        icon="pi pi-trash" 
        text 
        rounded
        severity="danger" 
        size="small"
        class="delete-role-btn"
        @click="$emit('delete')"
      />
    </div>
    
    <!-- Cast Drop Zone -->
    <div class="drop-zone">
      <draggable
        v-model="assignedCasts"
        group="casts"
        item-key="id"
        class="cast-list"
        ghost-class="ghost"
      >
        <template #item="{ element, index }">
          <div class="cast-chip">
            <span class="rank-badge">{{ index + 1 }}</span>
            <span class="cast-name">{{ element.cast.name }}</span>
            <button class="remove-btn" @click.stop="removeCast(element.id)">
              <i class="pi pi-times"></i>
            </button>
          </div>
        </template>
        
        <template #footer>
          <div v-if="assignedCasts.length === 0" class="placeholder">
            <span>ここへキャストをドラッグ</span>
          </div>
        </template>
      </draggable>
    </div>
  </div>
</template>

<style scoped>
.role-item {
  border: 1px solid var(--p-surface-200);
  border-radius: 8px;
  padding: 0.75rem;
  background: white;
  margin-bottom: 0.75rem;
  user-select: none; /* Prevent text selection during drag */
}

.role-header {
  margin-bottom: 0.5rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.inputs {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex: 1;
}

.role-name-input {
  flex: 1;
}

.delete-role-btn {
  flex-shrink: 0;
}

/* Compact SelectButton overrides */
:deep(.p-selectbutton .p-button) {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.drop-zone {
  background: var(--p-surface-50);
  border-radius: 6px;
  border: 1px dashed var(--p-surface-300);
  min-height: 50px;
  padding: 0.5rem;
}

.cast-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-height: 30px; /* ensure drop target size */
}

.cast-chip {
  display: flex;
  align-items: center;
  background: white;
  border: 1px solid var(--p-surface-200);
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  gap: 0.5rem;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  cursor: grab;
}

.rank-badge {
  background: var(--p-primary-color);
  color: white;
  font-size: 0.7rem;
  font-weight: bold;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cast-name {
  font-size: 0.85rem;
  font-weight: 500;
}

.remove-btn {
  background: none;
  border: none;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  cursor: pointer;
  display: flex;
  align-items: center;
}
.remove-btn:hover {
  color: var(--p-red-500);
}

.placeholder {
  width: 100%;
  text-align: center;
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  padding: 0.5rem;
}

.ghost {
  opacity: 0.5;
  background: var(--p-primary-50);
}
</style>
