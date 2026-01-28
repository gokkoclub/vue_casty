<script setup lang="ts">
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [mode: 'external' | 'internal' | 'cancel']
}>()

const handleSelect = (mode: 'external' | 'internal' | 'cancel') => {
  emit('select', mode)
  if (mode === 'cancel') {
    emit('update:visible', false)
  }
}
</script>

<template>
  <Dialog 
    :visible="visible" 
    @update:visible="emit('update:visible', $event)"
    modal
    header="案件タイプの選択"
    :style="{ width: '400px' }"
    :closable="false"
  >
    <div class="dialog-content">
      <p class="mb-4">
        選択された日程に登録済みの撮影データが見つかりませんでした。
        新規案件として登録しますか？
      </p>

      <div class="actions">
        <Button 
          label="外部案件 (その他)" 
          icon="pi pi-briefcase"
          class="w-full mb-2"
          @click="handleSelect('external')"
        />
        
        <Button 
          label="社内イベント" 
          icon="pi pi-building"
          class="w-full mb-2"
          severity="info"
          @click="handleSelect('internal')"
        />
        
        <Button 
          label="キャンセル (戻る)" 
          icon="pi pi-arrow-left"
          class="w-full"
          severity="secondary"
          text
          @click="handleSelect('cancel')"
        />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.dialog-content {
  text-align: center;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.w-full {
  width: 100%;
}

.mb-2 {
  margin-bottom: 0.5rem;
}

.mb-4 {
  margin-bottom: 1.5rem;
}
</style>
