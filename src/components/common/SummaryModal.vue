<script setup lang="ts">
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import type { Casting } from '@/types'

const props = defineProps<{
  visible: boolean
  castings: Casting[]
  projectName: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const totalCost = computed(() => {
  return props.castings.reduce((sum, c) => sum + (c.cost || 0), 0)
})

const statusSeverity = (status: string): 'success' | 'info' | 'warning' | 'danger' | 'secondary' => {
  const map: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'secondary'> = {
    '決定': 'success',
    'OK': 'success',
    '条件つきOK': 'warning',
    '打診中': 'info',
    'オーダー待ち': 'secondary',
    'NG': 'danger',
    'キャンセル': 'danger'
  }
  return map[status] || 'secondary'
}
</script>

<template>
  <Dialog 
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    :header="`まとめ: ${projectName}`"
    :style="{ width: '800px' }"
  >
    <DataTable :value="castings" stripedRows>
      <Column field="castName" header="キャスト" />
      <Column field="roleName" header="役名" />
      <Column field="mainSub" header="区分" />
      <Column field="status" header="ステータス">
        <template #body="{ data }">
          <Tag :value="data.status" :severity="statusSeverity(data.status)" />
        </template>
      </Column>
      <Column field="cost" header="金額">
        <template #body="{ data }">
          {{ data.cost ? `¥${data.cost.toLocaleString()}` : '-' }}
        </template>
      </Column>
    </DataTable>
    
    <div class="summary-footer">
      <div class="total">
        <span class="label">合計金額（税別）:</span>
        <span class="value">¥{{ totalCost.toLocaleString() }}</span>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.summary-footer {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--surface-200);
  display: flex;
  justify-content: flex-end;
}

.total {
  display: flex;
  gap: 0.5rem;
  font-size: 1.125rem;
}

.total .label {
  color: var(--text-color-secondary);
}

.total .value {
  font-weight: 700;
  color: var(--primary-color);
}
</style>
