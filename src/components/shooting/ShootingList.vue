<script setup lang="ts">
import Card from 'primevue/card'
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

const formatDate = (date: any) => {
  if (!date) return ''
  const d = date.toDate ? date.toDate() : new Date(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <div class="shooting-list">
    <div v-if="loading" class="loading">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
    </div>

    <div v-else-if="shootings.length > 0" class="list-container">
      <Card 
        v-for="shooting in shootings" 
        :key="shooting.id"
        class="shooting-card"
        :class="{ 'selected': selectedId === shooting.id }"
        @click="emit('select', shooting)"
      >
        <template #title>
          <div class="card-header">
            <span class="date-badge">{{ formatDate(shooting.shootDate) }}</span>
            <span class="title">{{ shooting.title }}</span>
          </div>
        </template>
        <template #subtitle>
          <div class="subtitle-row">
            <i class="pi pi-users"></i> {{ shooting.team }}
          </div>
        </template>
      </Card>
      
      <div class="divider">
        <span>または</span>
      </div>

      <Button 
        label="リストにない案件を作成 (外部/社内)" 
        icon="pi pi-plus"
        severity="secondary"
        outlined
        class="w-full"
        @click="emit('create-new')"
      />
    </div>

    <div v-else class="empty-state">
      <p>選択された期間の撮影予定はありません</p>
      <Button 
        label="新規案件として進める" 
        icon="pi pi-arrow-right"
        @click="emit('create-new')"
      />
    </div>
  </div>
</template>

<style scoped>
.shooting-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.loading {
  display: flex;
  justify-content: center;
  padding: 2rem;
}

.list-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.shooting-card {
  border-left: 4px solid var(--p-surface-300);
  cursor: pointer;
  transition: all 0.2s;
}

.shooting-card:hover {
  border-left-color: var(--p-primary-color);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.shooting-card.selected {
  border-left-color: var(--p-primary-color);
  background: var(--p-primary-50);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.date-badge {
  background: var(--p-primary-50);
  color: var(--p-primary-700);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 600;
}

.title {
  font-size: 1rem;
  font-weight: 600;
}

.subtitle-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  margin-top: 0.25rem;
}

.divider {
  display: flex;
  align-items: center;
  text-align: center;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid var(--p-surface-200);
}

.divider span {
  padding: 0 0.5rem;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--p-text-muted-color);
  background: var(--p-surface-50);
  border-radius: 8px;
  border: 1px dashed var(--p-surface-300);
}

.empty-state p {
  margin-bottom: 1rem;
}

.w-full {
  width: 100%;
}
</style>
