<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { useEmailTemplate } from '@/composables/useEmailTemplate'
import { useToast } from 'primevue/usetoast'
import type { Casting } from '@/types'

const props = defineProps<{
  visible: boolean
  casting: Casting | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'copied': [castingId: string]
}>()

const toast = useToast()
const { generateInquiryMail, copyToClipboard, openMailto } = useEmailTemplate()

// 撮影日を文字列配列に変換
const shootingDates = computed(() => {
  if (!props.casting) return []
  if (props.casting.shootingDates?.length) return props.casting.shootingDates
  // startDate / endDate から日付範囲を生成
  if (props.casting.startDate) {
    const start = props.casting.startDate.toDate()
    const end = props.casting.endDate?.toDate() || start
    const dates: string[] = []
    const d = new Date(start)
    while (d <= end) {
      dates.push(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`)
      d.setDate(d.getDate() + 1)
    }
    return dates
  }
  return ['未定']
})

const mail = computed(() => {
  if (!props.casting) return null
  return generateInquiryMail(props.casting, shootingDates.value)
})

// 編集可能なフィールド
const editSubject = ref('')
const editBody = ref('')

// casting/mail が変わったら初期値をセット
watch(mail, (m) => {
  if (m) {
    editSubject.value = m.subject
    editBody.value = m.body
  }
}, { immediate: true })

// ダイアログが開いた時にもリセット
watch(() => props.visible, (val) => {
  if (val && mail.value) {
    editSubject.value = mail.value.subject
    editBody.value = mail.value.body
  }
})

const resetToTemplate = () => {
  if (mail.value) {
    editSubject.value = mail.value.subject
    editBody.value = mail.value.body
  }
}

const handleCopyAndUpdate = async () => {
  if (!props.casting) return
  await copyToClipboard(`${editSubject.value}\n\n${editBody.value}`)
  toast.add({
    severity: 'success',
    summary: 'コピー完了',
    detail: 'メールをコピーしました。ステータスを「打診中」に更新します。',
    life: 3000
  })
  emit('copied', props.casting.id)
}

const handleMailtoAndUpdate = () => {
  if (!props.casting) return
  // メーラーで開く（メールアドレスがない場合は空で開く）
  openMailto('', editSubject.value, editBody.value)
  toast.add({
    severity: 'success',
    summary: 'メーラー起動',
    detail: 'ステータスを「打診中」に更新します。',
    life: 3000
  })
  emit('copied', props.casting.id)
}

const handleClose = () => {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    :header="casting ? `打診メール: ${casting.castName}` : '打診メール'"
    :style="{ width: '600px' }"
  >
    <div v-if="casting && mail" class="owem-content">
      <!-- キャスト情報 -->
      <div class="owem-info">
        <div class="owem-info-row">
          <span class="owem-label">キャスト</span>
          <span class="owem-value">{{ casting.castName }}</span>
        </div>
        <div class="owem-info-row">
          <span class="owem-label">案件</span>
          <span class="owem-value">{{ casting.projectName }}</span>
        </div>
        <div class="owem-info-row">
          <span class="owem-label">現在のステータス</span>
          <span class="owem-status-badge">{{ casting.status }}</span>
        </div>
      </div>

      <!-- メール内容 -->
      <div class="owem-mail">
        <div class="owem-field">
          <div class="owem-field-header">
            <label>件名</label>
            <Button
              label="リセット"
              icon="pi pi-refresh"
              text
              size="small"
              severity="secondary"
              @click="resetToTemplate"
            />
          </div>
          <InputText
            v-model="editSubject"
            class="w-full"
          />
        </div>
        <div class="owem-field">
          <label>本文</label>
          <Textarea
            v-model="editBody"
            rows="10"
            class="w-full"
          />
        </div>
      </div>

      <!-- ステータス変更プレビュー -->
      <div class="owem-preview">
        <i class="pi pi-info-circle"></i>
        <span>メールをコピーまたは送信すると、ステータスが自動的に「<strong>打診中</strong>」に変更されます。</span>
      </div>
    </div>

    <template #footer>
      <div class="owem-footer">
        <Button
          label="キャンセル"
          severity="secondary"
          outlined
          @click="handleClose"
        />
        <Button
          label="メーラーで開く"
          icon="pi pi-envelope"
          severity="secondary"
          @click="handleMailtoAndUpdate"
        />
        <Button
          label="コピーして打診中にする"
          icon="pi pi-copy"
          @click="handleCopyAndUpdate"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.owem-content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.owem-info {
  background: var(--p-content-hover-background);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.owem-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.owem-label {
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
}

.owem-value {
  font-weight: 500;
}

.owem-status-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
}

.owem-mail {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.owem-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.owem-field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.owem-field label {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
}

.owem-subject {
  padding: 0.5rem 0.75rem;
  background: var(--p-content-hover-background);
  border-radius: 6px;
  font-weight: 500;
  font-size: 0.9rem;
}

.owem-preview {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  background: var(--p-message-info-background);
  color: var(--p-message-info-color);
  border-radius: 6px;
  font-size: 0.8rem;
}

.owem-preview i {
  font-size: 1rem;
  flex-shrink: 0;
}

.owem-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

:deep(.p-textarea) {
  background: var(--p-content-background) !important;
  color: var(--p-text-color) !important;
}
</style>
