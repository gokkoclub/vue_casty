<script setup lang="ts">
import { ref, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import RadioButton from 'primevue/radiobutton'
import Checkbox from 'primevue/checkbox'
import InputText from 'primevue/inputtext'

const props = defineProps<{
  visible: boolean
  hasPdf: boolean
  hasMinorCast: boolean
  isShootingMode: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'confirm': [intimacy: string, competition?: { type: string; period: string }]
}>()

// Intimacy scene
const intimacyChoice = ref<'なし' | 'あり' | '未定'>('なし')

// Competition (for external/internal only)
const hasCompetition = ref<'なし' | 'あり'>('なし')
const competitionType = ref('')
const competitionPeriod = ref('')

// Minor confirmation
const minorConfirmed = ref(false)

const canConfirm = computed(() => {
  if (props.hasMinorCast && !minorConfirmed.value) return false
  // Competition validation: if あり, type is required
  if (!props.isShootingMode && hasCompetition.value === 'あり' && !competitionType.value.trim()) return false
  return true
})

const handleConfirm = () => {
  const competition = (!props.isShootingMode && hasCompetition.value === 'あり')
    ? { type: competitionType.value.trim(), period: competitionPeriod.value.trim() }
    : undefined
  emit('confirm', intimacyChoice.value, competition)
  emit('update:visible', false)
  // Reset for next time
  intimacyChoice.value = 'なし'
  minorConfirmed.value = false
  hasCompetition.value = 'なし'
  competitionType.value = ''
  competitionPeriod.value = ''
}

const handleCancel = () => {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    header="送信前の確認"
    :style="{ width: '500px' }"
    :closable="true"
  >
    <div class="confirm-content">
      <!-- PDF Warning (shooting mode only) -->
      <div v-if="isShootingMode && !hasPdf" class="pdf-warning mb-3">
        <i class="pi pi-exclamation-triangle"></i>
        <span>脚本PDFが添付されていません。</span>
      </div>

      <!-- Intimacy Check -->
      <div class="intimacy-section mb-3">
        <label class="section-label">インティマシーシーンの有無</label>
        <div class="intimacy-radios">
          <label class="intimacy-radio">
            <RadioButton v-model="intimacyChoice" value="なし" />
            <span>なし</span>
          </label>
          <label class="intimacy-radio">
            <RadioButton v-model="intimacyChoice" value="あり" />
            <span class="text-danger">あり</span>
          </label>
          <label class="intimacy-radio">
            <RadioButton v-model="intimacyChoice" value="未定" />
            <span>未定</span>
          </label>
        </div>
        <p class="hint-text">※「あり」を選択すると、備考欄に自動追記されます。</p>
      </div>

      <!-- Minor Cast Check -->
      <div v-if="hasMinorCast" class="minor-check-box mb-3">
        <label class="minor-check-label">
          <Checkbox v-model="minorConfirmed" binary />
          <span>
            <strong>未成年者（18歳未満）</strong>が含まれる場合、
            労働基準法（深夜労働の禁止・労働時間制限など）および関連法規を遵守した撮影計画であることを確認しました。
          </span>
        </label>
      </div>

      <!-- Competition Info (external/internal only) -->
      <div v-if="!isShootingMode" class="competition-section mb-3">
        <label class="section-label">競合の有無</label>
        <div class="intimacy-radios">
          <label class="intimacy-radio">
            <RadioButton v-model="hasCompetition" value="なし" />
            <span>なし</span>
          </label>
          <label class="intimacy-radio">
            <RadioButton v-model="hasCompetition" value="あり" />
            <span class="text-danger">あり</span>
          </label>
        </div>
        <div v-if="hasCompetition === 'あり'" class="competition-fields">
          <div class="comp-field">
            <label>競合の種類 <span class="text-red-500">*</span></label>
            <InputText v-model="competitionType" placeholder="例: 化粧品、飲料、アパレル" class="w-full" />
          </div>
          <div class="comp-field">
            <label>競合期間</label>
            <InputText v-model="competitionPeriod" placeholder="例: 2026/03〜2027/03" class="w-full" />
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button
          label="キャンセル"
          severity="secondary"
          outlined
          @click="handleCancel"
        />
        <Button
          :label="hasMinorCast ? '同意して送信' : 'オーダー送信'"
          icon="pi pi-check"
          severity="success"
          :disabled="!canConfirm"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.confirm-content {
  display: flex;
  flex-direction: column;
}

.section-label {
  display: block;
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

/* PDF Warning */
.pdf-warning {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  background: #FEF3C7;
  color: #92400E;
  border: 1px solid #FDE68A;
  border-radius: 6px;
  font-size: 0.85rem;
}

.pdf-warning i {
  color: #D97706;
  font-size: 1rem;
}

/* Intimacy */
.intimacy-section {
  padding: 0.75rem;
  background: var(--p-surface-50);
  border-radius: 8px;
}

.intimacy-radios {
  display: flex;
  gap: 1.25rem;
  margin-top: 0.25rem;
}

.intimacy-radio {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.text-danger {
  color: #DC2626;
  font-weight: 700;
}

.hint-text {
  margin-top: 0.35rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

/* Minor Check */
.minor-check-box {
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-radius: 8px;
  padding: 0.75rem;
}

.minor-check-label {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.8rem;
  line-height: 1.5;
  color: #92400E;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

/* Competition Section */
.competition-section {
  padding: 0.75rem;
  background: var(--p-surface-50);
  border-radius: 8px;
}

.competition-fields {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: white;
  border-radius: 6px;
  border: 1px solid var(--p-surface-200);
}

.comp-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.comp-field label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}
</style>
