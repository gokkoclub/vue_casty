<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import DatePicker from 'primevue/datepicker'
import Button from 'primevue/button'
import Tag from 'primevue/tag'

const props = defineProps<{
  dates: Date[]
}>()

const emit = defineEmits<{
  'update:dates': [dates: Date[]]
}>()

// Internal state for DatePicker which handles range as array
const pickedDates = ref<Date[]>([])

// Initialize from props if needed
watch(() => props.dates, (newVal) => {
  // Only clear pickedDates when dates are externally cleared
  // AND pickedDates still has values (avoid re-triggering the cycle)
  if (newVal.length === 0 && pickedDates.value.length > 0) {
    pickedDates.value = []
  }
}, { immediate: true })

watch(pickedDates, (newVal) => {
  console.log('[DEBUG DateSelector] pickedDates changed:', newVal)
  // If range is selected (start, end), fill the dates in between for the store
  if (Array.isArray(newVal) && newVal.length === 2 && newVal[0] && newVal[1]) {
      console.log('[DEBUG DateSelector] start raw:', newVal[0], 'toString:', newVal[0].toString(), 'getDate:', newVal[0].getDate())
      console.log('[DEBUG DateSelector] end raw:', newVal[1], 'toString:', newVal[1].toString(), 'getDate:', newVal[1].getDate())
      const start = new Date(newVal[0].getFullYear(), newVal[0].getMonth(), newVal[0].getDate())
      const end = new Date(newVal[1].getFullYear(), newVal[1].getMonth(), newVal[1].getDate())
      console.log('[DEBUG DateSelector] normalized start:', start.toString(), 'end:', end.toString())
      const dates: Date[] = []
      let current = new Date(start)
      while (current <= end) {
        dates.push(new Date(current))
        current.setDate(current.getDate() + 1)
      }
      console.log('[DEBUG DateSelector] Generated dates count:', dates.length, dates.map(d => d.getDate()))
      emit('update:dates', dates)
  } else if (Array.isArray(newVal) && newVal.length > 0 && newVal[0]) {
    emit('update:dates', [newVal[0]])
  } else {
    emit('update:dates', [])
  }
})

const formattedDates = computed(() => {
  if (!props.dates || props.dates.length === 0) return []
  return props.dates
    .map(d => {
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${year}/${month}/${day}`
    })
    .sort()
})

const clearDates = () => {
  pickedDates.value = []
}
</script>

<template>
  <div class="date-selector">
    <DatePicker 
      v-model="pickedDates"
      selectionMode="range"
      inline
      :numberOfMonths="1"
      showButtonBar
      :minDate="new Date()"
      @clear-click="clearDates"
    />
    
    <div class="selected-dates" v-if="props.dates.length > 0">
      <div class="dates-header">
        <span>選択中の日付 ({{ props.dates.length }}日)</span>
        <Button 
          label="クリア"
          text
          size="small"
          severity="secondary"
          @click="clearDates"
        />
      </div>
      <div class="date-tags">
        <Tag 
          v-for="date in formattedDates" 
          :key="date" 
          :value="date"
          severity="info"
        />
      </div>
    </div>
    
    <p v-else class="no-selection">
      開始日と終了日を選択してください
    </p>
  </div>
</template>

<style scoped>
.date-selector {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow: hidden;
  contain: layout;
}

/* Calendar containment fix */
.date-selector :deep(.p-datepicker) {
  width: 100% !important;
  max-width: 100%;
  box-sizing: border-box;
}

.date-selector :deep(.p-datepicker-panel) {
  width: 100% !important;
  max-width: 100%;
}

.date-selector :deep(.p-datepicker-calendar) {
  width: 100%;
  table-layout: fixed;
}

.date-selector :deep(.p-datepicker-calendar td) {
  padding: 0.15rem;
}

.date-selector :deep(.p-datepicker-calendar td > span) {
  width: 2rem;
  height: 2rem;
  font-size: 0.85rem;
}

.selected-dates {
  padding: 0.75rem;
  background: var(--p-surface-50);
  border-radius: 6px;
}

.dates-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.date-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.no-selection {
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
  text-align: center;
  padding: 1rem;
}
</style>
