<script setup lang="ts">
import { ref } from 'vue'
import Card from 'primevue/card'
import MultiSelect from 'primevue/multiselect'
import Calendar from 'primevue/calendar'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import type { CastingFilters } from '@/composables/useCastings'
import type { CastingStatus } from '@/types'

const props = defineProps<{
  filters: CastingFilters
}>()

const emit = defineEmits<{
  'update:filters': [filters: CastingFilters]
}>()

// Local filter state
const selectedStatuses = ref<CastingStatus[]>(props.filters.status || [])
const dateRange = ref<Date[] | null>(
  props.filters.dateRange 
    ? [props.filters.dateRange.start, props.filters.dateRange.end]
    : null
)
const searchQuery = ref(props.filters.searchQuery || '')
const teamName = ref(props.filters.teamName || '')

// Status options
const statusOptions: { label: string; value: CastingStatus }[] = [
  { label: '仮押さえ', value: '仮押さえ' },
  { label: '打診中', value: '打診中' },
  { label: 'オーダー待ち', value: 'オーダー待ち' },
  { label: 'OK', value: 'OK' },
  { label: '決定', value: '決定' },
  { label: 'NG', value: 'NG' },
  { label: 'キャンセル', value: 'キャンセル' }
]

// Apply filters
const applyFilters = () => {
  const newFilters: CastingFilters = {
    status: selectedStatuses.value.length > 0 ? selectedStatuses.value : undefined,
    dateRange: dateRange.value && dateRange.value.length === 2 && dateRange.value[0] && dateRange.value[1]
      ? { start: dateRange.value[0], end: dateRange.value[1] }
      : undefined,
    searchQuery: searchQuery.value || undefined,
    teamName: teamName.value || undefined
  }
  
  emit('update:filters', newFilters)
}

// Clear filters
const clearFilters = () => {
  selectedStatuses.value = []
  dateRange.value = null
  searchQuery.value = ''
  teamName.value = ''
  applyFilters()
}
</script>

<template>
  <Card class="filters-card">
    <template #content>
      <div class="filters-grid">
        <!-- Search -->
        <div class="filter-item">
          <label>キャスト名・案件名で検索</label>
          <InputText
            v-model="searchQuery"
            placeholder="検索..."
            @keyup.enter="applyFilters"
          />
        </div>

        <!-- Status Filter -->
        <div class="filter-item">
          <label>ステータス</label>
          <MultiSelect
            v-model="selectedStatuses"
            :options="statusOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="すべて"
            :maxSelectedLabels="3"
            class="w-full"
          />
        </div>

        <!-- Date Range -->
        <div class="filter-item">
          <label>日付範囲</label>
          <Calendar
            v-model="dateRange"
            selectionMode="range"
            dateFormat="yy/mm/dd"
            placeholder="日付範囲を選択"
            :manualInput="false"
            showButtonBar
            class="w-full"
          />
        </div>

        <!-- Team Name -->
        <div class="filter-item">
          <label>チーム・アカウント名</label>
          <InputText
            v-model="teamName"
            placeholder="チーム名..."
            @keyup.enter="applyFilters"
          />
        </div>

        <!-- Action Buttons -->
        <div class="filter-actions">
          <Button
            label="フィルター適用"
            icon="pi pi-filter"
            @click="applyFilters"
            severity="primary"
          />
          <Button
            label="クリア"
            icon="pi pi-times"
            @click="clearFilters"
            severity="secondary"
            outlined
          />
        </div>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.filters-card {
  margin-bottom: 2rem;
}

.filters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  align-items: end;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.filter-item label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-color);
}

.filter-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

@media (max-width: 768px) {
  .filters-grid {
    grid-template-columns: 1fr;
  }
  
  .filter-actions {
    flex-direction: column;
    width: 100%;
  }
  
  .filter-actions :deep(.p-button) {
    width: 100%;
  }
}
</style>
