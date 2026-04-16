<script setup lang="ts">
import { ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import { useToast } from 'primevue/usetoast'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase'
import type { Casting, CastingStatus } from '@/types'
import { useAuth } from '@/composables/useAuth'

const props = defineProps<{
  castings: Casting[]
  projectName: string
  updaters?: string[]
}>()

const emit = defineEmits<{
  'update-status': [castingId: string, newStatus: CastingStatus]
  'open-modal': [castingId: string]
  'delete': [castingId: string]
  'save-cost': [castingId: string, cost: number]
}>()

const { isAdmin } = useAuth()

// Get status severity
const getStatusSeverity = (status: CastingStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' => {
  switch (status) {
    case '決定': return 'success'
    case 'OK': return 'info'
    case '仮押さえ':
    case '仮キャスティング': return 'warning'
    case '打診中': return 'info'
    case 'オーダー待ち': return 'contrast'
    case 'NG':
    case 'キャンセル': return 'danger'
    default: return 'secondary'
  }
}

// Get row class based on status
const getRowClass = (data: Casting) => {
  if (data.status === 'NG') return 'opacity-50'
  if (data.status === 'キャンセル') return 'opacity-50'
  return ''
}

// Cost editing state
const editingCosts = new Map<string, number>()

const handleCostChange = (castingId: string, value: number | null) => {
  editingCosts.set(castingId, value || 0)
}

const saveCost = (castingId: string) => {
  const cost = editingCosts.get(castingId) || 0
  emit('save-cost', castingId, cost)
}

// Handle row click
const handleRowClick = (event: { data: Casting }) => {
  if (isAdmin.value) {
    emit('open-modal', event.data.id)
  }
}

// Format cost display
const formatCost = (cost: number) => {
  if (!cost) return '-'
  return '¥' + cost.toLocaleString()
}

// Open Slack thread
const openSlack = (url: string) => {
  window.open(url, '_blank')
}

// カレンダー再生成
const toast = useToast()
const regeneratingCalendarId = ref<string | null>(null)
const handleRegenerateCalendar = async (castingId: string) => {
  if (!functions) {
    toast.add({ severity: 'error', summary: 'エラー', detail: 'Firebase Functions 未初期化', life: 3000 })
    return
  }
  regeneratingCalendarId.value = castingId
  try {
    const fn = httpsCallable(functions, 'regenerateCalendarEvent')
    const res: any = await fn({ castingId })
    if (res?.data?.success) {
      toast.add({ severity: 'success', summary: 'カレンダー作成', detail: `eventId: ${res.data.eventId}`, life: 4000 })
    } else {
      toast.add({ severity: 'warn', summary: '作成スキップ', detail: res?.data?.message || '不明', life: 4000 })
    }
  } catch (e: any) {
    console.error('regenerateCalendarEvent failed:', e)
    toast.add({ severity: 'error', summary: 'エラー', detail: e?.message || String(e), life: 5000 })
  } finally {
    regeneratingCalendarId.value = null
  }
}
</script>

<template>
  <div class="casting-status-table">
    <div class="table-header">
      <h5 class="project-name">{{ projectName }}</h5>
      <span v-if="updaters && updaters.length" class="updaters">
        by {{ updaters.join(', ') }}
      </span>
    </div>

    <DataTable 
      :value="castings" 
      :rowClass="getRowClass"
      @row-click="handleRowClick"
      class="p-datatable-sm"
      stripedRows
      showGridlines
    >
      <!-- 役名 -->
      <Column field="roleName" header="役名" style="width: 120px">
        <template #body="{ data }">
          {{ data.roleName || '-' }}
        </template>
      </Column>

      <!-- 候補順 -->
      <Column field="rank" header="候補" style="width: 60px; text-align: center">
        <template #body="{ data }">
          {{ data.rank || '-' }}
        </template>
      </Column>

      <!-- 区分 -->
      <Column field="mainSub" header="区分" style="width: 80px; text-align: center">
        <template #body="{ data }">
          <Tag 
            :value="data.mainSub" 
            :severity="data.mainSub === 'メイン' ? 'success' : 'secondary'"
            rounded
          />
        </template>
      </Column>

      <!-- キャスト名 -->
      <Column field="castName" header="キャスト" style="width: 140px">
        <template #body="{ data }">
          <div class="cast-cell">
            <span>{{ data.castName }}</span>
            <Tag 
              :value="data.castType" 
              :severity="data.castType === '内部' ? 'info' : 'secondary'"
              rounded
              class="cast-type-tag"
            />
          </div>
        </template>
      </Column>

      <!-- ステータス -->
      <Column field="status" header="ステータス" style="width: 130px">
        <template #body="{ data }">
          <Tag 
            :value="data.status" 
            :severity="getStatusSeverity(data.status)"
            class="status-tag"
            @click.stop="isAdmin && emit('open-modal', data.id)"
          />
        </template>
      </Column>

      <!-- 金額 -->
      <Column field="cost" header="金額" style="width: 120px; text-align: right">
        <template #body="{ data }">
          <div v-if="!['NG', 'キャンセル'].includes(data.status)" class="cost-edit">
            <InputNumber 
              :modelValue="data.cost"
              @update:modelValue="(v) => handleCostChange(data.id, v)"
              mode="currency"
              currency="JPY"
              locale="ja-JP"
              :maxFractionDigits="0"
              class="cost-input"
              inputClass="cost-input-inner"
            />
          </div>
          <span v-else>{{ formatCost(data.cost) }}</span>
        </template>
      </Column>

      <!-- 備考 -->
      <Column field="note" header="備考" style="min-width: 150px">
        <template #body="{ data }">
          <div v-if="data.conditionalMessage" class="conditional-msg">{{ data.conditionalMessage }}</div>
          <span class="note-text">{{ data.note || '' }}</span>
        </template>
      </Column>

      <!-- アクション -->
      <Column header="" style="width: 110px; text-align: center">
        <template #body="{ data }">
          <div class="actions">
            <Button
              v-if="!['NG', 'キャンセル'].includes(data.status)"
              icon="pi pi-save"
              text
              size="small"
              severity="success"
              @click.stop="saveCost(data.id)"
              v-tooltip.top="'金額を保存'"
            />
            <Button
              v-if="data.castType === '内部' && !data.calendarEventId && !['NG', 'キャンセル'].includes(data.status)"
              icon="pi pi-calendar-plus"
              text
              size="small"
              severity="warn"
              :loading="regeneratingCalendarId === data.id"
              @click.stop="handleRegenerateCalendar(data.id)"
              v-tooltip.top="'カレンダーを生成'"
            />
            <Button
              v-if="data.slackPermalink"
              icon="pi pi-comments"
              text
              size="small"
              @click.stop="openSlack(data.slackPermalink)"
              v-tooltip.top="'Slackを開く'"
            />
            <Button
              v-if="isAdmin"
              icon="pi pi-trash"
              text
              size="small"
              severity="danger"
              @click.stop="emit('delete', data.id)"
              v-tooltip.top="'削除'"
            />
          </div>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<style scoped>
.casting-status-table {
  margin-bottom: 1rem;
}

.table-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  padding: 0.5rem 0;
}

.project-name {
  font-weight: 600;
  margin: 0;
  color: var(--text-color);
}

.updaters {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

.cast-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.cast-type-tag {
  font-size: 0.625rem;
  padding: 0.125rem 0.375rem;
}

.status-tag {
  cursor: pointer;
  transition: transform 0.15s;
}

.status-tag:hover {
  transform: scale(1.05);
}

.cost-edit {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.cost-input {
  width: 100%;
}

:deep(.cost-input-inner) {
  text-align: right;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.note-text {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

.conditional-msg {
  font-size: 0.75rem;
  color: var(--yellow-700);
  background: var(--yellow-50);
  border-radius: 4px;
  padding: 0.15rem 0.4rem;
  margin-bottom: 0.2rem;
  display: inline-block;
}

.actions {
  display: flex;
  gap: 0.25rem;
  justify-content: center;
}

:deep(.p-datatable .p-datatable-tbody > tr) {
  cursor: pointer;
  transition: background-color 0.15s;
}

:deep(.p-datatable .p-datatable-tbody > tr:hover) {
  background-color: var(--surface-hover) !important;
}
</style>
