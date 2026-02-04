<script setup lang="ts">
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { usePdfGenerator } from '@/composables/usePdfGenerator'
import type { ShootingContact } from '@/types'

const props = defineProps<{
  visible: boolean
  contact: ShootingContact | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const { loading, generateOrderDocument } = usePdfGenerator()

const handlePreview = () => {
  if (!props.contact) return
  // PDF生成してダウンロード
  generateOrderDocument(props.contact)
}

const handleDownload = () => {
  if (!props.contact) return
  generateOrderDocument(props.contact)
}
</script>

<template>
  <Dialog 
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    header="発注書生成"
    :style="{ width: '500px' }"
  >
    <div v-if="contact" class="pdf-form">
      <div class="field">
        <label>発注先</label>
        <InputText :modelValue="contact.castName" disabled class="w-full" />
      </div>
      
      <div class="field">
        <label>案件名</label>
        <InputText :modelValue="contact.projectName" disabled class="w-full" />
      </div>
      
      <div class="field">
        <label>出演者</label>
        <InputText :modelValue="contact.castName" disabled class="w-full" />
      </div>
      
      <div class="field">
        <label>撮影日</label>
        <InputText :modelValue="contact.shootDate?.toDate?.().toLocaleDateString('ja-JP') || '未定'" disabled class="w-full" />
      </div>
      
      <div class="field">
        <label>金額（税込）</label>
        <InputNumber :modelValue="contact.fee" disabled class="w-full" prefix="¥" />
      </div>
      
      <div class="field">
        <label>備考</label>
        <Textarea :modelValue="''" disabled rows="3" class="w-full" placeholder="備考なし" />
      </div>
    </div>
    
    <template #footer>
      <Button 
        label="プレビュー" 
        icon="pi pi-eye" 
        severity="secondary"
        :loading="loading"
        @click="handlePreview"
      />
      <Button 
        label="PDFダウンロード" 
        icon="pi pi-download"
        :loading="loading"
        @click="handleDownload"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.pdf-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}
</style>
