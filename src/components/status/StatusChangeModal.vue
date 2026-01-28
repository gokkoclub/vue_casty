<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Dropdown from 'primevue/dropdown'
import Textarea from 'primevue/textarea'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import type { Casting, CastingStatus } from '@/types'
import { useAuth } from '@/composables/useAuth'
import { Permissions, getStatusColor, getStatusIcon } from '@/utils/permissions'

const props = defineProps<{
    visible: boolean
    casting: Casting | null
}>()

const emit = defineEmits<{
    'update:visible': [value: boolean]
    'confirm': [castingId: string, newStatus: CastingStatus, extraMessage?: string]
}>()

const { isAdmin } = useAuth()

// Local state
const selectedStatus = ref<CastingStatus | null>(null)
const extraMessage = ref('')
const loading = ref(false)

// Available status options based on current status and permissions
const availableStatuses = computed(() => {
    if (!props.casting) return []
    
    const transitions = Permissions.getAvailableStatusTransitions(props.casting.status, isAdmin.value)
    return transitions.map(status => ({
        label: status,
        value: status,
        icon: getStatusIcon(status),
        severity: getStatusColor(status)
    }))
})

// Check if status change is possible
const canChangeStatus = computed(() => availableStatuses.value.length > 0)

// Check if confirm button should be enabled
const canConfirm = computed(() => selectedStatus.value !== null)

// Get severity for tag
const getTagSeverity = (status: CastingStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' => {
    const color = getStatusColor(status)
    if (color === 'success') return 'success'
    if (color === 'info') return 'info'
    if (color === 'warning') return 'warning'
    if (color === 'danger') return 'danger'
    return 'secondary'
}

// Reset state when dialog opens
watch(() => props.visible, (newVal) => {
    if (newVal) {
        selectedStatus.value = null
        extraMessage.value = ''
        loading.value = false
    }
})

// Handle confirm
const handleConfirm = async () => {
    if (!props.casting || !selectedStatus.value) return

    loading.value = true
    emit('confirm', props.casting.id, selectedStatus.value, extraMessage.value || undefined)
}

// Close dialog
const handleClose = () => {
    emit('update:visible', false)
}
</script>

<template>
    <Dialog
        :visible="visible"
        @update:visible="emit('update:visible', $event)"
        modal
        :header="casting ? `ステータス変更: ${casting.castName}` : 'ステータス変更'"
        :style="{ width: '500px' }"
        :closable="!loading"
    >
        <div v-if="casting" class="status-change-content">
            <!-- Current Info -->
            <div class="casting-info">
                <div class="info-row">
                    <span class="label">キャスト</span>
                    <span class="value">{{ casting.castName }}</span>
                </div>
                <div class="info-row">
                    <span class="label">案件</span>
                    <span class="value">{{ casting.projectName }}</span>
                </div>
                <div class="info-row">
                    <span class="label">役名</span>
                    <span class="value">{{ casting.roleName }}</span>
                </div>
                <div class="info-row">
                    <span class="label">現在のステータス</span>
                    <Tag :value="casting.status" :severity="getTagSeverity(casting.status)" />
                </div>
            </div>

            <!-- Status Selection -->
            <div class="status-selection" v-if="canChangeStatus">
                <label>新しいステータス</label>
                <Dropdown
                    v-model="selectedStatus"
                    :options="availableStatuses"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="ステータスを選択"
                    class="w-full"
                    :disabled="loading"
                >
                    <template #option="{ option }">
                        <div class="status-option">
                            <i :class="['pi', option.icon]"></i>
                            <span>{{ option.label }}</span>
                        </div>
                    </template>
                </Dropdown>
            </div>

            <!-- No permission message -->
            <div v-else class="no-permission">
                <i class="pi pi-lock"></i>
                <p>このステータスからの変更権限がありません。</p>
                <p v-if="!isAdmin" class="hint">管理者に連絡してください。</p>
            </div>

            <!-- Extra Message -->
            <div class="extra-message" v-if="canChangeStatus">
                <label>追記メッセージ（任意）</label>
                <Textarea
                    v-model="extraMessage"
                    rows="3"
                    placeholder="Slackスレッドに追記するメッセージを入力..."
                    class="w-full"
                    :disabled="loading"
                />
                <small>スレッドに返信として投稿されます</small>
            </div>

            <!-- Status Change Preview -->
            <div v-if="selectedStatus" class="status-preview">
                <Tag :value="casting.status" :severity="getTagSeverity(casting.status)" />
                <i class="pi pi-arrow-right"></i>
                <Tag :value="selectedStatus" :severity="getTagSeverity(selectedStatus)" />
            </div>
        </div>

        <template #footer>
            <div class="dialog-footer">
                <Button
                    label="キャンセル"
                    severity="secondary"
                    outlined
                    @click="handleClose"
                    :disabled="loading"
                />
                <Button
                    label="変更を確定"
                    icon="pi pi-check"
                    @click="handleConfirm"
                    :disabled="!canConfirm"
                    :loading="loading"
                />
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.status-change-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.casting-info {
    background: var(--surface-50);
    padding: 1rem;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.info-row .label {
    font-size: 0.875rem;
    color: var(--text-color-secondary);
}

.info-row .value {
    font-weight: 500;
}

.status-selection,
.extra-message {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.status-selection label,
.extra-message label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-color);
}

.extra-message small {
    color: var(--text-color-secondary);
    font-size: 0.75rem;
}

.status-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.status-option i {
    font-size: 0.875rem;
}

.no-permission {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem;
    text-align: center;
    background: var(--surface-50);
    border-radius: 8px;
}

.no-permission i {
    font-size: 2rem;
    color: var(--text-color-secondary);
    margin-bottom: 0.5rem;
}

.no-permission p {
    margin: 0.25rem 0;
    color: var(--text-color-secondary);
}

.no-permission .hint {
    font-size: 0.875rem;
}

.status-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--surface-100);
    border-radius: 8px;
}

.status-preview i {
    color: var(--primary-color);
}

.dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
}
</style>
