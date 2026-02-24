<script setup lang="ts">
import Button from 'primevue/button'
import type { Shooting } from '@/types'

const props = defineProps<{
  shootings: Shooting[]
  loading: boolean
  selectedId?: string | null
}>()

const emit = defineEmits<{
  'select': [shooting: Shooting]
  'create-new': []
}>()

const formatShootDate = (date: any) => {
  if (!date) return ''
  if (typeof date === 'string') return date.substring(0, 10)
  const d = date.toDate ? date.toDate() : new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
</script>

<template>
  <div class="shooting-list">
    <div v-if="loading" class="loading">
      <i class="pi pi-spin pi-spinner"></i>
    </div>

    <div v-else-if="shootings.length > 0" class="list-container">
      <div 
        v-for="shooting in shootings" 
        :key="shooting.id"
        class="shooting-item"
        :class="{ 'selected': selectedId === shooting.id }"
        @click="emit('select', shooting)"
      >
        <div class="item-main">
          <span class="item-title">{{ shooting.title }}</span>
          <span class="item-team">{{ shooting.team }}</span>
        </div>
        <span class="item-date">{{ formatShootDate(shooting.shootDate) }}</span>
      </div>
      
      <Button 
        label="＋ 新規案件" 
        severity="secondary"
        text
        size="small"
        class="w-full new-btn"
        @click="emit('create-new')"
      />
    </div>

    <div v-else class="empty-state">
      <p>撮影予定なし</p>
      <Button 
        label="新規案件として進める" 
        icon="pi pi-arrow-right"
        size="small"
        @click="emit('create-new')"
      />
    </div>
  </div>
</template>

<style scoped>
.shooting-list {
  display: flex;
  flex-direction: column;
}

.loading {
  display: flex;
  justify-content: center;
  padding: 1rem;
  font-size: 1.25rem;
  color: var(--p-text-muted-color);
}

.list-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.shooting-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0.75rem 1rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  background: white;
}

.shooting-item:hover {
  border-color: var(--p-primary-300);
  background: var(--p-surface-50);
}

.shooting-item.selected {
  border-color: var(--p-primary-color);
  background: var(--p-primary-50);
}

.item-main {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.item-title {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--p-text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-date {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  flex-shrink: 0;
}

.item-team {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.new-btn {
  margin-top: 0.25rem;
}

.empty-state {
  text-align: center;
  padding: 1rem;
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
}

.empty-state p {
  margin-bottom: 0.5rem;
}

.w-full {
  width: 100%;
}
</style>
