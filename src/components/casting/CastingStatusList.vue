<script setup lang="ts">
import Tag from 'primevue/tag'
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
  'additional-order': [casting: Casting]
  'open-summary': [castings: Casting[]]
  'open-email': [casting: Casting]
  'toggle-select': [castingId: string]
}>()

const { isAdmin } = useAuth()

// Status badge colors per specification
const getStatusClass = (status: CastingStatus): string => {
  switch (status) {
    case '仮キャスティング': return 'status-provisional'
    case '仮押さえ': return 'status-hold'
    case '打診中': return 'status-inquiry'
    case 'オーダー待ち':
    case 'オーダー待ち（仮キャスティング）': return 'status-order-wait'
    case 'OK': return 'status-ok'
    case '決定': return 'status-confirmed'
    case '条件つきOK': return 'status-conditional'
    case 'NG': return 'status-ng'
    case 'キャンセル': return 'status-cancelled'
    default: return 'status-default'
  }
}

// Get status severity for Tag component
const getStatusSeverity = (status: CastingStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' => {
  switch (status) {
    case '決定': return 'success'
    case 'OK': return 'info'
    case '仮押さえ':
    case '仮キャスティング': return 'warning'
    case '打診中': return 'info'
    case 'オーダー待ち': 
    case 'オーダー待ち（仮キャスティング）': return 'contrast'
    case 'NG':
    case 'キャンセル': return 'danger'
    case '条件つきOK': return 'warning'
    default: return 'secondary'
  }
}

// Check if row should be dimmed
const isRowDimmed = (status: string) => {
  return ['NG', 'キャンセル'].includes(status)
}

// Cost editing
const editingCosts = new Map<string, number>()

const handleCostChange = (castingId: string, value: number | null) => {
  editingCosts.set(castingId, value || 0)
}

const saveCost = (castingId: string) => {
  const cost = editingCosts.get(castingId) || 0
  emit('save-cost', castingId, cost)
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

// Check if order wait status for cost editing
const isOrderWait = (status: string) => {
  return ['オーダー待ち', 'オーダー待ち（仮キャスティング）'].includes(status)
}

// Handle summary click - pass all castings for this project
const handleSummaryClick = () => {
  emit('open-summary', props.castings)
}
</script>

<template>
  <div class="casting-list-container">
    <!-- Project Header -->
    <div class="project-header">
      <h5 class="project-name">{{ projectName }}</h5>
      <span v-if="updaters && updaters.length" class="updaters">
        by {{ updaters.join(', ') }}
      </span>
      <!-- Summary button for admins -->
      <Button
        v-if="isAdmin"
        label="まとめ"
        icon="pi pi-list"
        text
        size="small"
        severity="info"
        @click="handleSummaryClick"
      />
    </div>

    <!-- Casting List (Tree-style rows) -->
    <div class="casting-list">
      <div 
        v-for="(casting, index) in castings" 
        :key="casting.id"
        class="casting-row"
        :class="{ 'dimmed': isRowDimmed(casting.status) }"
      >
        <!-- Tree connector -->
        <div class="tree-connector">
          <span class="tree-line" :class="{ 'last': index === castings.length - 1 }">
            {{ index === castings.length - 1 ? '└─' : '├─' }}
          </span>
        </div>

        <!-- Checkbox for bulk selection -->
        <div v-if="bulkSelectMode" class="checkbox-cell" @click.stop="emit('toggle-select', casting.id)">
          <i :class="isSelected?.(casting.id) ? 'pi pi-check-square' : 'pi pi-square'" class="checkbox-icon"></i>
        </div>

        <!-- Cast Info -->
        <div class="cast-info" @click="emit('open-modal', casting.id)">
          <span class="cast-name">{{ casting.castName }}</span>
          <Tag 
            :value="casting.castType" 
            :severity="casting.castType === '内部' ? 'info' : 'secondary'"
            rounded
            class="cast-type-tag"
          />
        </div>

        <!-- Status Badge (clickable) -->
        <Tag 
          :value="casting.status" 
          :severity="getStatusSeverity(casting.status)"
          :class="['status-badge', getStatusClass(casting.status)]"
          @click.stop="emit('open-modal', casting.id)"
        />

        <!-- Role & Rank -->
        <div class="role-info">
          <span class="role-name">{{ casting.roleName || '-' }}</span>
          <span class="rank">({{ casting.rank || '?' }})</span>
          <Tag 
            v-if="casting.mainSub"
            :value="casting.mainSub" 
            :severity="casting.mainSub === 'メイン' ? 'success' : 'secondary'"
            rounded
            class="main-sub-tag"
          />
        </div>

        <!-- Cost (editable if order wait) -->
        <div class="cost-cell">
          <template v-if="isOrderWait(casting.status)">
            <InputNumber 
              :modelValue="casting.cost"
              @update:modelValue="(v) => handleCostChange(casting.id, v)"
              mode="currency"
              currency="JPY"
              locale="ja-JP"
              :maxFractionDigits="0"
              class="cost-input"
              inputClass="cost-input-inner"
            />
            <Button
              icon="pi pi-save"
              text
              size="small"
              severity="success"
              @click.stop="saveCost(casting.id)"
              v-tooltip.top="'金額を保存'"
            />
          </template>
          <span v-else class="cost-display">{{ formatCost(casting.cost) }}</span>
        </div>

        <!-- Actions -->
        <div class="actions">
          <Button
            v-if="casting.slackPermalink"
            icon="pi pi-comments"
            text
            size="small"
            @click.stop="openSlack(casting.slackPermalink)"
            v-tooltip.top="'Slackを開く'"
          />
          
          <!-- Additional Order Button -->
          <Button
            icon="pi pi-plus"
            text
            size="small"
            severity="info"
            @click.stop="emit('additional-order', casting)"
            v-tooltip.top="'追加オーダー'"
          />
          
          <!-- Email Button (external tab only) -->
          <Button
            v-if="isExternalTab"
            icon="pi pi-envelope"
            text
            size="small"
            severity="warning"
            @click.stop="emit('open-email', casting)"
            v-tooltip.top="'メール'"
          />
          
          <!-- Delete Button (admin only) -->
          <Button
            v-if="isAdmin"
            icon="pi pi-trash"
            text
            size="small"
            severity="danger"
            @click.stop="emit('delete', casting.id)"
            v-tooltip.top="'削除'"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.casting-list-container {
  margin-bottom: 1.5rem;
}

.project-header {
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
  font-size: 1rem;
}

.updaters {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

.casting-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-left: 1rem;
}

.casting-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--surface-card);
  border-radius: 6px;
  border: 1px solid var(--surface-border);
  transition: all 0.2s;
  cursor: pointer;
}

.casting-row:hover {
  background: var(--surface-hover);
  transform: translateX(4px);
}

.casting-row.dimmed {
  opacity: 0.5;
}

.tree-connector {
  flex-shrink: 0;
  width: 24px;
}

.tree-line {
  font-family: monospace;
  color: var(--primary-300);
  font-size: 0.9rem;
}

.checkbox-cell {
  flex-shrink: 0;
  cursor: pointer;
  padding: 0.25rem;
}

.checkbox-icon {
  font-size: 1.25rem;
  color: var(--primary-color);
  transition: transform 0.15s;
}

.checkbox-icon:hover {
  transform: scale(1.1);
}

.cast-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 140px;
  flex-shrink: 0;
}

.cast-name {
  font-weight: 600;
  color: var(--text-color);
}

.cast-type-tag {
  font-size: 0.625rem;
  padding: 0.125rem 0.375rem;
}

.status-badge {
  cursor: pointer;
  transition: transform 0.15s;
  min-width: 80px;
  text-align: center;
  flex-shrink: 0;
}

.status-badge:hover {
  transform: scale(1.05);
}

/* Status colors per specification */
.status-provisional { background: #E5E7EB; color: #374151; }
.status-hold { background: #FEF3C7; color: #92400E; }
.status-inquiry { background: #DBEAFE; color: #1E40AF; }
.status-order-wait { background: #E9D5FF; color: #6B21A8; }
.status-ok { background: #D1FAE5; color: #065F46; }
.status-confirmed { background: #22C55E !important; color: white !important; }
.status-conditional { background: #FED7AA; color: #C2410C; }
.status-ng { background: #EF4444 !important; color: white !important; }
.status-cancelled { background: #9CA3AF !important; color: white !important; }

.role-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 100px;
}

.role-name {
  font-size: 0.875rem;
  color: var(--text-color);
}

.rank {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

.main-sub-tag {
  font-size: 0.625rem;
  padding: 0.125rem 0.375rem;
}

.cost-cell {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 120px;
  flex-shrink: 0;
}

.cost-input {
  width: 100px;
}

:deep(.cost-input-inner) {
  text-align: right;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.cost-display {
  font-size: 0.875rem;
  color: var(--text-color);
}

.actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .casting-row {
    flex-wrap: wrap;
  }
  
  .role-info {
    width: 100%;
    margin-top: 0.5rem;
  }
  
  .cost-cell {
    width: 100%;
    margin-top: 0.25rem;
  }
}
</style>
