<script setup lang="ts">
import { ref, reactive } from 'vue'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import type { Casting, CastingStatus } from '@/types'
import { useAuth } from '@/composables/useAuth'

const props = defineProps<{
  castings: Casting[]
  projectName: string
  updaters?: string[]
  isExternalTab?: boolean
  bulkSelectMode?: boolean
  isSelected?: (id: string) => boolean
}>()

const emit = defineEmits<{
  'update-status': [castingId: string, newStatus: CastingStatus]
  'open-modal': [castingId: string]
  'delete': [castingId: string]
  'save-cost': [castingId: string, cost: number]
  'save-time': [castingId: string, startTime: string, endTime: string]
  'additional-order': [casting: Casting]
  'open-summary': [castings: Casting[]]
  'open-email': [casting: Casting]
  'toggle-select': [castingId: string]
}>()

// Time editing state
const editingTimeId = ref<string | null>(null)
const editingTime = reactive({ startTime: '', endTime: '' })

const startTimeEdit = (casting: Casting) => {
  editingTimeId.value = casting.id
  editingTime.startTime = casting.startTime || ''
  editingTime.endTime = casting.endTime || ''
}

const cancelTimeEdit = () => {
  editingTimeId.value = null
}

const saveTimeEdit = (castingId: string) => {
  emit('save-time', castingId, editingTime.startTime, editingTime.endTime)
  editingTimeId.value = null
}

const { isAdmin } = useAuth()

// Status styling per spec
const getStatusStyle = (status: CastingStatus) => {
  const styles: Record<string, { bg: string; color: string }> = {
    '仮キャスティング':           { bg: '#F3F4F6', color: '#374151' },
    '仮押さえ':                   { bg: '#FEF3C7', color: '#92400E' },
    '打診中':                     { bg: '#DBEAFE', color: '#1E40AF' },
    'オーダー待ち':               { bg: '#EDE9FE', color: '#6B21A8' },
    'オーダー待ち（仮キャスティング）': { bg: '#EDE9FE', color: '#6B21A8' },
    'OK':                         { bg: '#D1FAE5', color: '#065F46' },
    '決定':                       { bg: '#22C55E', color: '#FFFFFF' },
    '条件つきOK':                 { bg: '#FED7AA', color: '#C2410C' },
    'NG':                         { bg: '#EF4444', color: '#FFFFFF' },
    'キャンセル':                 { bg: '#9CA3AF', color: '#FFFFFF' },
  }
  return styles[status] || { bg: '#F3F4F6', color: '#374151' }
}

const isRowDimmed = (status: string) => ['NG', 'キャンセル'].includes(status)

const isOrderWait = (status: string) => {
  return ['オーダー待ち', 'オーダー待ち（仮キャスティング）'].includes(status)
}

const editingCosts = new Map<string, number>()

const handleCostChange = (castingId: string, value: number | null) => {
  editingCosts.set(castingId, value || 0)
}

const saveCost = (castingId: string) => {
  const cost = editingCosts.get(castingId) || 0
  emit('save-cost', castingId, cost)
}

const formatCost = (cost: number) => {
  if (!cost) return ''
  return '¥' + cost.toLocaleString()
}

const openSlack = (url: string) => {
  window.open(url, '_blank')
}

const handleSummaryClick = () => {
  emit('open-summary', props.castings)
}
</script>

<template>
  <div class="csl">
    <!-- Project Header -->
    <div class="csl-project-hdr">
      <div class="csl-project-left">
        <span class="csl-project-name">{{ projectName }}</span>
        <span class="csl-cast-count">{{ castings.length }}人</span>
      </div>
      <div class="csl-project-actions">
        <span v-if="updaters && updaters.length" class="csl-updater">
          {{ updaters.join(', ') }}
        </span>
        <Button
          v-if="isAdmin"
          label="まとめ"
          icon="pi pi-list"
          text
          size="small"
          @click="handleSummaryClick"
        />
      </div>
    </div>

    <!-- Cast Rows -->
    <div class="csl-rows">
      <div 
        v-for="casting in castings" 
        :key="casting.id"
        class="csl-row"
        :class="{ 'dimmed': isRowDimmed(casting.status) }"
        @click="emit('open-modal', casting.id)"
      >
        <!-- Bulk Select -->
        <div v-if="bulkSelectMode" class="csl-cell csl-check" @click.stop="emit('toggle-select', casting.id)">
          <i :class="isSelected?.(casting.id) ? 'pi pi-check-square' : 'pi pi-stop'" class="check-icon"></i>
        </div>

        <!-- Cast Name & Type -->
        <div class="csl-cell csl-cast">
          <span class="csl-cast-name">{{ casting.castName }}</span>
          <span class="csl-cast-type" :class="casting.castType === '内部' ? 'internal' : 'external'">
            {{ casting.castType }}
          </span>
        </div>

        <!-- Status -->
        <div class="csl-cell csl-status" @click.stop="emit('open-modal', casting.id)">
          <span 
            class="csl-status-badge"
            :style="{ background: getStatusStyle(casting.status).bg, color: getStatusStyle(casting.status).color }"
          >
            {{ casting.status }}
          </span>
        </div>

        <!-- Role & Rank -->
        <div class="csl-cell csl-role">
          <span class="csl-role-name">{{ casting.roleName || '-' }}</span>
          <span v-if="casting.mainSub === 'メイン'" class="csl-main-badge">メイン</span>
        </div>

        <!-- Time (for external/internal events) -->
        <div v-if="casting.mode === 'external' || casting.mode === 'internal'" class="csl-cell csl-time" @click.stop>
          <template v-if="editingTimeId === casting.id">
            <input
              v-model="editingTime.startTime"
              type="time"
              class="csl-time-input"
            />
            <span class="csl-time-sep">~</span>
            <input
              v-model="editingTime.endTime"
              type="time"
              class="csl-time-input"
            />
            <button class="csl-save-btn" @click="saveTimeEdit(casting.id)" title="保存">
              <i class="pi pi-check"></i>
            </button>
            <button class="csl-act-btn" @click="cancelTimeEdit" title="キャンセル">
              <i class="pi pi-times"></i>
            </button>
          </template>
          <template v-else>
            <span v-if="casting.startTime || casting.endTime" class="csl-time-display">
              <i class="pi pi-clock csl-time-icon"></i>
              {{ casting.startTime || '??' }}〜{{ casting.endTime || '??' }}
            </span>
            <span v-else class="csl-time-empty">時間未設定</span>
            <button class="csl-act-btn csl-time-edit" @click="startTimeEdit(casting)" title="時間を編集">
              <i class="pi pi-pencil"></i>
            </button>
          </template>
        </div>

        <!-- Cost -->
        <div class="csl-cell csl-cost" @click.stop>
          <template v-if="!isRowDimmed(casting.status)">
            <InputNumber 
              :modelValue="casting.cost"
              @update:modelValue="(v) => handleCostChange(casting.id, v)"
              mode="currency"
              currency="JPY"
              locale="ja-JP"
              :maxFractionDigits="0"
              class="csl-cost-input"
              inputClass="csl-cost-inner"
            />
            <button class="csl-save-btn" @click="saveCost(casting.id)" title="保存">
              <i class="pi pi-check"></i>
            </button>
          </template>
          <span v-else class="csl-cost-text">{{ formatCost(casting.cost) }}</span>
        </div>

        <!-- Actions -->
        <div class="csl-cell csl-actions" @click.stop>
          <button v-if="casting.slackPermalink" class="csl-act-btn" @click="openSlack(casting.slackPermalink)" title="Slack">
            <i class="pi pi-comments"></i>
          </button>
          <button class="csl-act-btn" @click="emit('additional-order', casting)" title="追加オーダー">
            <i class="pi pi-plus"></i>
          </button>
          <button v-if="isExternalTab" class="csl-act-btn" @click="emit('open-email', casting)" title="メール">
            <i class="pi pi-envelope"></i>
          </button>
          <button v-if="isAdmin" class="csl-act-btn danger" @click="emit('delete', casting.id)" title="削除">
            <i class="pi pi-trash"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.csl {
  margin-bottom: 0.75rem;
}

/* Project Header */
.csl-project-hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-surface-100);
}

.csl-project-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.csl-project-name {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--p-text-color);
}

.csl-cast-count {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  background: var(--p-surface-100);
  padding: 0.1rem 0.4rem;
  border-radius: 8px;
}

.csl-project-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.csl-updater {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

/* Rows */
.csl-rows {
  display: flex;
  flex-direction: column;
}

.csl-row {
  display: flex;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-surface-50);
  cursor: pointer;
  transition: background 0.1s;
  gap: 0.75rem;
}

.csl-row:hover {
  background: var(--p-surface-50);
}

.csl-row:last-child {
  border-bottom: none;
}

.csl-row.dimmed {
  opacity: 0.4;
}

/* Cells */
.csl-cell {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.csl-check {
  width: 28px;
  cursor: pointer;
}

.check-icon {
  font-size: 1.1rem;
  color: var(--p-primary-color);
}

/* Cast name */
.csl-cast {
  min-width: 140px;
  gap: 0.4rem;
}

.csl-cast-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--p-text-color);
  white-space: nowrap;
}

.csl-cast-type {
  font-size: 0.6rem;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-weight: 600;
  white-space: nowrap;
}

.csl-cast-type.internal {
  background: #DBEAFE;
  color: #1D4ED8;
}

.csl-cast-type.external {
  background: #F3F4F6;
  color: #6B7280;
}

/* Status */
.csl-status {
  min-width: 100px;
}

.csl-status-badge {
  display: inline-block;
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  white-space: nowrap;
}

.csl-status-badge:hover {
  opacity: 0.8;
}

/* Role */
.csl-role {
  flex: 1;
  min-width: 80px;
  gap: 0.4rem;
}

.csl-role-name {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.csl-main-badge {
  font-size: 0.6rem;
  background: #D1FAE5;
  color: #065F46;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-weight: 600;
}

/* Time */
.csl-time {
  min-width: 140px;
  gap: 0.3rem;
}

.csl-time-display {
  font-size: 0.8rem;
  color: var(--p-text-color);
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.csl-time-icon {
  font-size: 0.7rem;
  color: var(--p-primary-color);
}

.csl-time-empty {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  font-style: italic;
}

.csl-time-input {
  width: 80px;
  padding: 0.15rem 0.3rem;
  font-size: 0.75rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 4px;
  outline: none;
}

.csl-time-input:focus {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 1px var(--p-primary-color);
}

.csl-time-sep {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.csl-time-edit {
  font-size: 0.7rem !important;
  padding: 0.15rem !important;
  opacity: 0;
  transition: opacity 0.15s;
}

.csl-row:hover .csl-time-edit {
  opacity: 1;
}

/* Cost */
.csl-cost {
  min-width: 100px;
  gap: 0.25rem;
}

.csl-cost-input {
  width: 60px !important;
  max-width: 60px !important;
  flex-shrink: 1;
  min-width: 0;
}

:deep(.csl-cost-input) {
  width: 60px !important;
  max-width: 60px !important;
}

:deep(.csl-cost-input .p-inputnumber-input),
:deep(.csl-cost-inner) {
  width: 60px !important;
  max-width: 60px !important;
  text-align: right;
  padding: 0.2rem 0.3rem;
  font-size: 0.7rem;
}

.csl-cost-text {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.csl-save-btn {
  background: #D1FAE5;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  color: #065F46;
  font-size: 0.75rem;
  flex-shrink: 0;
}

.csl-save-btn:hover {
  background: #A7F3D0;
}

/* Actions */
.csl-actions {
  gap: 0.15rem;
}

.csl-act-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.3rem;
  border-radius: 4px;
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  transition: all 0.15s;
}

.csl-act-btn:hover {
  background: var(--p-surface-100);
  color: var(--p-text-color);
}

.csl-act-btn.danger:hover {
  background: #FEE2E2;
  color: #DC2626;
}

/* Responsive */
@media (max-width: 768px) {
  .csl-row {
    flex-wrap: wrap;
  }
  
  .csl-role, .csl-cost {
    width: 100%;
    margin-top: 0.25rem;
  }
}
</style>
