<script setup lang="ts">
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import type { CastingStatus } from '@/types'

const props = defineProps<{
  visible: boolean
  selectedCount: number
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'confirm': [newStatus: CastingStatus]
}>()

const loading = ref(false)

// Status options for bulk update
const statusOptions: CastingStatus[] = [
  '仮押さえ',
  '打診中',
  'オーダー待ち',
  'OK',
  '決定',
  '条件つきOK',
  'NG',
  'キャンセル'
]

// Reset state when dialog opens
watch(() => props.visible, (newVal) => {
  if (newVal) {
    loading.value = false
  }
})

// Handle status selection
const handleSelect = (status: CastingStatus) => {
  loading.value = true
  emit('confirm', status)
}

// Close dialog
const handleClose = () => {
  emit('update:visible', false)
}

// Get severity for button
const getSeverity = (status: CastingStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' => {
  switch (status) {
    case '決定':
    case 'OK': return 'success'
    case '条件つきOK':
    case '仮押さえ': return 'warning'
    case '打診中':
    case 'オーダー待ち': return 'info'
    case 'NG':
    case 'キャンセル': return 'danger'
    default: return 'secondary'
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    header="一括ステータス更新"
    :style="{ width: '400px' }"
    :closable="!loading"
  >
    <div class="bulk-status-content">
      <p class="description">
        <strong>{{ selectedCount }}件</strong>のキャスティングを一括更新します。
      </p>
      <p class="description sub">更新後のステータスを選択してください：</p>
      
      <div class="status-grid">
        <Button
          v-for="status in statusOptions"
          :key="status"
          :label="status"
          :severity="getSeverity(status)"
          outlined
          :loading="loading"
          @click="handleSelect(status)"
        />
      </div>
    </div>

    <template #footer>
      <Button
        label="キャンセル"
        severity="secondary"
        outlined
        @click="handleClose"
        :disabled="loading"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.bulk-status-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.description {
  margin: 0;
  text-align: center;
}

.description.sub {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}
</style>
