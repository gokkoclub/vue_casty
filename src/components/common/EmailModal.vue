<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
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

// 編集可能なフィールド
const editKoubanSubject = ref('')
const editKoubanBody = ref('')
const editOrderSubject = ref('')
const editOrderBody = ref('')

// テンプレートから初期値を設定
const koubanMail = computed(() => props.contact ? generateKoubanMail(props.contact) : null)
const orderMail = computed(() => props.contact ? generateOrderMail(props.contact) : null)

// contact が変わったらテンプレートの内容で初期化
watch(() => props.contact, () => {
  if (koubanMail.value) {
    editKoubanSubject.value = koubanMail.value.subject
    editKoubanBody.value = koubanMail.value.body
  }
  if (orderMail.value) {
    editOrderSubject.value = orderMail.value.subject
    editOrderBody.value = orderMail.value.body
  }
}, { immediate: true })

// ダイアログが開いた時にもリセット
watch(() => props.visible, (val) => {
  if (val) {
    if (koubanMail.value) {
      editKoubanSubject.value = koubanMail.value.subject
      editKoubanBody.value = koubanMail.value.body
    }
    if (orderMail.value) {
      editOrderSubject.value = orderMail.value.subject
      editOrderBody.value = orderMail.value.body
    }
  }
})

const resetKouban = () => {
  if (koubanMail.value) {
    editKoubanSubject.value = koubanMail.value.subject
    editKoubanBody.value = koubanMail.value.body
  }
}

const resetOrder = () => {
  if (orderMail.value) {
    editOrderSubject.value = orderMail.value.subject
    editOrderBody.value = orderMail.value.body
  }
}

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
            <div class="field-header">
              <label>件名</label>
              <Button
                label="リセット"
                icon="pi pi-refresh"
                text
                size="small"
                severity="secondary"
                @click="resetKouban"
              />
            </div>
            <InputText
              v-model="editKoubanSubject"
              class="w-full"
            />
          </div>
          <div class="field">
            <label>本文</label>
            <Textarea
              v-model="editKoubanBody"
              rows="12"
              class="w-full"
            />
          </div>
          <div class="actions">
            <Button
              label="クリップボードにコピー"
              icon="pi pi-copy"
              @click="handleCopy(editKoubanSubject, editKoubanBody)"
            />
            <Button
              label="メーラーで開く"
              icon="pi pi-envelope"
              severity="secondary"
              @click="handleMailto(editKoubanSubject, editKoubanBody)"
            />
          </div>
        </div>
      </TabPanel>

      <TabPanel value="1" header="発注書送付">
        <div v-if="orderMail" class="mail-preview">
          <div class="field">
            <div class="field-header">
              <label>件名</label>
              <Button
                label="リセット"
                icon="pi pi-refresh"
                text
                size="small"
                severity="secondary"
                @click="resetOrder"
              />
            </div>
            <InputText
              v-model="editOrderSubject"
              class="w-full"
            />
          </div>
          <div class="field">
            <label>本文</label>
            <Textarea
              v-model="editOrderBody"
              rows="12"
              class="w-full"
            />
          </div>
          <div class="actions">
            <Button
              label="クリップボードにコピー"
              icon="pi pi-copy"
              @click="handleCopy(editOrderSubject, editOrderBody)"
            />
            <Button
              label="メーラーで開く"
              icon="pi pi-envelope"
              severity="secondary"
              @click="handleMailto(editOrderSubject, editOrderBody)"
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

.field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
}

.actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1rem;
}

:deep(.p-textarea) {
  background: var(--p-content-background) !important;
  color: var(--p-text-color) !important;
}
</style>
