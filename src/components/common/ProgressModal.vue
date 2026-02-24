<script setup lang="ts">
import Dialog from 'primevue/dialog'
import ProgressBar from 'primevue/progressbar'
import { computed } from 'vue'

const props = defineProps<{
  visible: boolean
  progress: number // 0-100
  message?: string
}>()

defineEmits<{
  'update:visible': [value: boolean]
}>()

const displayMessage = computed(() => {
  if (props.message) return props.message
  if (props.progress < 30) return '準備中...'
  if (props.progress < 60) return '送信中...'
  if (props.progress < 90) return '処理中...'
  return '完了まであと少し...'
})
</script>

<template>
  <Dialog 
    :visible="visible" 
    :closable="false"
    :modal="true"
    :draggable="false"
    class="progress-dialog"
    :pt="{
      mask: { class: 'progress-dialog-mask' }
    }"
  >
    <template #header>
      <span class="dialog-header">処理中...</span>
    </template>
    
    <div class="progress-content">
      <p class="progress-message">{{ displayMessage }}</p>
      <ProgressBar 
        :value="progress" 
        :showValue="true"
        class="progress-bar"
      />
      <p class="progress-hint">しばらくお待ちください</p>
    </div>
  </Dialog>
</template>

<style scoped>
.progress-dialog :deep(.p-dialog-content) {
  padding: 2rem;
}

.dialog-header {
  font-size: 1.125rem;
  font-weight: 600;
}

.progress-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  min-width: 300px;
}

.progress-message {
  font-size: 1rem;
  color: var(--text-color);
  margin: 0;
}

.progress-bar {
  width: 100%;
  height: 1.5rem;
}

.progress-hint {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
  margin: 0;
}

.progress-dialog-mask {
  backdrop-filter: blur(4px);
}
</style>
