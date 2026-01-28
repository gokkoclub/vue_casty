<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'
import type { Casting, CastingStatus } from '@/types'

const props = defineProps<{
  visible: boolean
  casting: Casting | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [status: CastingStatus, cost?: number]
}>()

const statusOptions: CastingStatus[] = [
  '仮押さえ', '打診中', 'オーダー待ち', 'OK', '決定', 'NG', 'キャンセル'
]

const selectedStatus = ref<CastingStatus>('仮押さえ')
const cost = ref<number | null>(null)

// Reset when dialog opens
watch(() => props.visible, (val) => {
  if (val && props.casting) {
    selectedStatus.value = props.casting.status
    cost.value = props.casting.cost || null
  }
})

const showCostInput = computed(() => 
  ['OK', '決定'].includes(selectedStatus.value)
)

const handleConfirm = () => {
  emit('confirm', selectedStatus.value, cost.value ?? undefined)
  emit('update:visible', false)
}
</script>

<template>
  <Dialog 
    :visible="visible" 
    @update:visible="$emit('update:visible', $event)"
    header="ステータス変更"
    modal
    :style="{ width: '400px' }"
  >
    <div class="form-container">
      <div class="field">
        <label class="field-label">新しいステータス</label>
        <Select 
          v-model="selectedStatus"
          :options="statusOptions"
          class="w-full"
        />
      </div>
      
      <div v-if="showCostInput" class="field">
        <label class="field-label">金額（税別）</label>
        <InputNumber 
          v-model="cost"
          mode="currency"
          currency="JPY"
          locale="ja-JP"
          class="w-full"
        />
      </div>
    </div>
    
    <template #footer>
      <Button 
        label="キャンセル" 
        severity="secondary"
        @click="$emit('update:visible', false)" 
      />
      <Button 
        label="変更" 
        @click="handleConfirm" 
      />
    </template>
  </Dialog>
</template>

<style scoped>
.form-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-label {
  font-weight: 500;
  color: var(--p-text-color);
}

.w-full {
  width: 100%;
}
</style>
