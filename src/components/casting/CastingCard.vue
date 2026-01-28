<script setup lang="ts">
import { computed } from 'vue'
import Card from 'primevue/card'
import Dropdown from 'primevue/dropdown'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import type { Casting, CastingStatus } from '@/types'
import { useAuth } from '@/composables/useAuth'
import { Permissions } from '@/utils/permissions'

const props = defineProps<{
  casting: Casting
}>()

const emit = defineEmits<{
  'update-status': [castingId: string, newStatus: string]
  'open-modal': [castingId: string]
  'delete': [castingId: string]
}>()

const { isAdmin } = useAuth()

// Available status options based on current status and permissions
const availableStatusOptions = computed(() => {
  const available = Permissions.getAvailableStatusTransitions(props.casting.status, isAdmin.value)
  return available.map(status => ({
    label: status,
    value: status
  }))
})



// Get status severity for Tag
const getStatusSeverity = (status: CastingStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' => {
  switch (status) {
    case '決定':
      return 'success'
    case 'OK':
      return 'info'
    case '仮押さえ':
    case '打診中':
    case 'オーダー待ち':
      return 'warning'
    case 'NG':
    case 'キャンセル':
      return 'danger'
    default:
      return 'secondary'
  }
}

// Format time
const formatTime = (timeStr?: string) => {
  return timeStr || '--:--'
}

// Handle status change
const handleStatusChange = (newStatus: CastingStatus) => {
  emit('update-status', props.casting.id, newStatus)
}

// Open Slack thread
const openSlackThread = () => {
  if (props.casting.slackPermalink) {
    window.open(props.casting.slackPermalink, '_blank')
  }
}


</script>

<template>
  <Card class="casting-card">
    <template #content>
      <div class="casting-content">
        <!-- Left: Cast Info -->
        <div class="cast-info">
          <div class="cast-header">
            <h3 class="cast-name">{{ casting.castName }}</h3>
            <Tag
              :value="casting.castType"
              :severity="casting.castType === '内部' ? 'info' : 'secondary'"
              rounded
            />
          </div>
          
          <div class="cast-details">
            <div class="detail-row">
              <i class="pi pi-briefcase"></i>
              <span>{{ casting.projectName }}</span>
            </div>
            <div class="detail-row">
              <i class="pi pi-users"></i>
              <span>{{ casting.roleName }}</span>
            </div>
            <div class="detail-row">
              <i class="pi pi-building"></i>
              <span>{{ casting.accountName }}</span>
            </div>
            <div v-if="casting.startTime || casting.endTime" class="detail-row">
              <i class="pi pi-clock"></i>
              <span>{{ formatTime(casting.startTime) }} - {{ formatTime(casting.endTime) }}</span>
            </div>
          </div>
        </div>

        <!-- Middle: Status -->
        <div class="status-section">
          <label>ステータス</label>
          <Dropdown
            :modelValue="casting.status"
            :options="availableStatusOptions"
            optionLabel="label"
            optionValue="value"
            @update:modelValue="handleStatusChange"
            class="status-dropdown"
            :disabled="availableStatusOptions.length === 0"
            :placeholder="availableStatusOptions.length === 0 ? '変更不可' : 'ステータスを選択'"
          />
          <Tag
            :value="casting.status"
            :severity="getStatusSeverity(casting.status)"
            class="mt-2"
          />
        </div>

        <!-- Right: Actions -->
        <div class="actions-section">
          <div class="rank-badge">
            第{{ casting.rank }}候補
          </div>
          
          <div class="action-buttons">
            <Button
              icon="pi pi-pencil"
              text
              size="small"
              @click="emit('open-modal', casting.id)"
              v-tooltip.top="'詳細変更'"
              class="action-btn"
            />
            <Button
              v-if="casting.slackPermalink"
              icon="pi pi-comments"
              text
              size="small"
              @click="openSlackThread"
              v-tooltip.top="'Slackスレッドを開く'"
              class="action-btn"
            />
            <Button
              v-if="isAdmin"
              icon="pi pi-trash"
              text
              size="small"
              severity="danger"
              @click="emit('delete', casting.id)"
              v-tooltip.top="'削除（管理者のみ）'"
              class="action-btn"
            />
          </div>
          
          <div v-if="casting.note" class="note">
            <i class="pi pi-file-edit"></i>
            <span>{{ casting.note }}</span>
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.casting-card {
  transition: transform 0.2s, box-shadow 0.2s;
}

.casting-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.casting-content {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 2rem;
  align-items: start;
}

.cast-info {
  flex: 1;
  min-width: 0;
}

.cast-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.cast-name {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-color);
}

.cast-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.detail-row i {
  width: 16px;
  font-size: 0.875rem;
}

.status-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 180px;
}

.status-section label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-color-secondary);
  text-transform: uppercase;
}

.status-dropdown {
  width: 100%;
}

.actions-section {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.75rem;
}

.rank-badge {
  background: var(--primary-50);
  color: var(--primary-700);
  padding: 0.375rem 0.75rem;
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 600;
}

.slack-btn {
  margin-top: auto;
}

.note {
  display: flex;
  align-items: start;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
  max-width: 200px;
}

.note i {
  flex-shrink: 0;
  margin-top: 0.125rem;
}

@media (max-width: 1024px) {
  .casting-content {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
  
  .status-section,
  .actions-section {
    align-items: flex-start;
  }
}
</style>
