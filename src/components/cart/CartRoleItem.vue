<script setup lang="ts">
import { computed, watch } from 'vue'
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

const allDates = computed(() => store.context.dateRanges)
const isMultiDate = computed(() => allDates.value.length > 1)

// Format date for display: "2026/03/01" → "3/1"
const formatDateShort = (dateStr: string) => {
  const parts = dateStr.split('/')
  return `${parseInt(parts[1]!)}/${parseInt(parts[2]!)}`
}

// Computes array of CartCast objects for this role
const assignedCasts = computed({
  get: () => {
    return props.role.castIds
      .map(id => store.pool[id])
      .filter(c => !!c) as CartCast[]
  },
  set: (newCasts: CartCast[]) => {
    props.role.castIds = newCasts.map(c => c.id)
  }
})

// Watch for new casts added via drag & drop — init their dates
watch(() => props.role.castIds, (newIds, oldIds) => {
  const added = newIds.filter(id => !oldIds?.includes(id))
  for (const castId of added) {
    store.initCastDatesForRole(props.role.id, castId)
  }
}, { deep: true })

const typeOptions = ['メイン', 'サブ']

const removeCast = (castId: string) => {
  store.removeCastFromRole(props.role.id, castId)
}

const isCastDateSelected = (castId: string, date: string): boolean => {
  const dates = props.role.castDates[castId]
  if (!dates) return true // not yet initialized = all selected
  return dates.includes(date)
}

const toggleDate = (castId: string, date: string) => {
  store.toggleCastDate(props.role.id, castId, date)
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
          <div class="cast-entry">
            <div class="cast-chip">
              <span class="rank-badge">{{ index + 1 }}</span>
              <span class="cast-name">{{ element.cast.name }}</span>
              <button class="remove-btn" @click.stop="removeCast(element.id)">
                <i class="pi pi-times"></i>
              </button>
            </div>
            <!-- Per-cast date toggles (only when multiple dates) -->
            <div v-if="isMultiDate" class="cast-dates">
              <button
                v-for="date in allDates"
                :key="date"
                class="date-toggle"
                :class="{ active: isCastDateSelected(element.id, date) }"
                @click.stop="toggleDate(element.id, date)"
              >
                {{ formatDateShort(date) }}
              </button>
            </div>
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
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  padding: 0.75rem;
  background: var(--p-content-background);
  margin-bottom: 0.75rem;
  user-select: none;
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

:deep(.p-selectbutton .p-button) {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.drop-zone {
  background: var(--p-content-hover-background);
  border-radius: 6px;
  border: 1px dashed var(--p-surface-300);
  min-height: 50px;
  padding: 0.5rem;
}

.cast-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 30px;
}

.cast-entry {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.cast-chip {
  display: flex;
  align-items: center;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
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
  flex: 1;
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

/* Date toggles */
.cast-dates {
  display: flex;
  gap: 0.25rem;
  padding-left: 1.75rem;
  flex-wrap: wrap;
}

.date-toggle {
  background: var(--p-content-hover-background);
  color: var(--p-text-muted-color);
  border: none;
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s ease;
  font-weight: 500;
}

.date-toggle.active {
  background: var(--p-primary-color);
  color: white;
}

.date-toggle:hover {
  opacity: 0.8;
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
