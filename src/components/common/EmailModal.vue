<script setup lang="ts">
import { ref, computed } from 'vue'
import Dialog from 'primevue/dialog'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import { useEmailTemplate } from '@/composables/useEmailTemplate'
import { useToast } from 'primevue/usetoast'
import type { ShootingContact } from '@/types'

const props = defineProps<{
  visible: boolean
  contact: ShootingContact | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const toast = useToast()
const { generateKoubanMail, generateOrderMail, copyToClipboard, openMailto } = useEmailTemplate()

const activeTab = ref(0)

const koubanMail = computed(() => props.contact ? generateKoubanMail(props.contact) : null)
const orderMail = computed(() => props.contact ? generateOrderMail(props.contact) : null)

const handleCopy = async (subject: string, body: string) => {
  await copyToClipboard(`${subject}\n\n${body}`)
  toast.add({ 
    severity: 'success', 
    summary: 'コピー完了', 
    detail: 'クリップボードにコピーしました', 
    life: 3000 
  })
}

const handleMailto = (subject: string, body: string) => {
  if (!props.contact?.email) {
    toast.add({ 
      severity: 'warn', 
      summary: '警告', 
      detail: 'メールアドレスが設定されていません', 
      life: 3000 
    })
    return
  }
  openMailto(props.contact.email, subject, body)
}
</script>

<template>
  <Dialog 
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    header="メール作成"
    :style="{ width: '600px' }"
  >
    <TabView v-model:activeIndex="activeTab">
      <TabPanel value="0" header="香盤連絡">
        <div v-if="koubanMail" class="mail-preview">
          <div class="field">
            <label>件名</label>
            <div class="subject">{{ koubanMail.subject }}</div>
          </div>
          <div class="field">
            <label>本文</label>
            <Textarea 
              :modelValue="koubanMail.body" 
              readonly 
              rows="12" 
              class="w-full"
            />
          </div>
          <div class="actions">
            <Button 
              label="クリップボードにコピー" 
              icon="pi pi-copy"
              @click="handleCopy(koubanMail.subject, koubanMail.body)"
            />
            <Button 
              label="メーラーで開く" 
              icon="pi pi-envelope"
              severity="secondary"
              @click="handleMailto(koubanMail.subject, koubanMail.body)"
            />
          </div>
        </div>
      </TabPanel>
      
      <TabPanel value="1" header="発注書送付">
        <div v-if="orderMail" class="mail-preview">
          <div class="field">
            <label>件名</label>
            <div class="subject">{{ orderMail.subject }}</div>
          </div>
          <div class="field">
            <label>本文</label>
            <Textarea 
              :modelValue="orderMail.body" 
              readonly 
              rows="12" 
              class="w-full"
            />
          </div>
          <div class="actions">
            <Button 
              label="クリップボードにコピー" 
              icon="pi pi-copy"
              @click="handleCopy(orderMail.subject, orderMail.body)"
            />
            <Button 
              label="メーラーで開く" 
              icon="pi pi-envelope"
              severity="secondary"
              @click="handleMailto(orderMail.subject, orderMail.body)"
            />
          </div>
        </div>
      </TabPanel>
    </TabView>
  </Dialog>
</template>

<style scoped>
.mail-preview {
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

.subject {
  padding: 0.5rem;
  background: var(--surface-100);
  border-radius: 4px;
  font-weight: 500;
}

.actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1rem;
}
</style>
