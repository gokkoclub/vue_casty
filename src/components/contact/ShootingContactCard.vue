<script setup lang="ts">
import { ref, computed } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Tag from 'primevue/tag'
import type { ShootingContact, ShootingContactStatus } from '@/types'
import { useShootingContact } from '@/composables/useShootingContact'
import { usePdfGenerator } from '@/composables/usePdfGenerator'

const props = defineProps<{
    contact: ShootingContact
}>()

const emit = defineEmits<{
    'updated': []
}>()

const { updateContact, advanceStatus } = useShootingContact()
const { generateOrderDocument, loading: pdfLoading } = usePdfGenerator()

// Edit mode
const isEditing = ref(false)

// Editable fields
const editData = ref({
    inTime: props.contact.inTime || '',
    outTime: props.contact.outTime || '',
    location: props.contact.location || '',
    address: props.contact.address || '',
    fee: props.contact.fee || 0,
    makingUrl: props.contact.makingUrl || ''
})

// Format date
const formattedDate = computed(() => {
    if (!props.contact.shootDate) return ''
    const date = props.contact.shootDate.toDate()
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    const month = date.getMonth() + 1
    const day = date.getDate()
    const weekday = weekdays[date.getDay()]
    return `${month}/${day}(${weekday})`
})

// Get status severity
const getStatusSeverity = (status: ShootingContactStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' => {
    switch (status) {
        case '香盤連絡待ち': return 'danger'
        case '発注書送信待ち': return 'warning'
        case 'メイキング共有待ち': return 'info'
        case '投稿日連絡待ち': return 'secondary'
        case '完了': return 'success'
        default: return 'secondary'
    }
}

// Toggle edit mode
const toggleEdit = () => {
    if (isEditing.value) {
        // Cancel edit, reset data
        editData.value = {
            inTime: props.contact.inTime || '',
            outTime: props.contact.outTime || '',
            location: props.contact.location || '',
            address: props.contact.address || '',
            fee: props.contact.fee || 0,
            makingUrl: props.contact.makingUrl || ''
        }
    }
    isEditing.value = !isEditing.value
}

// Save changes
const saveChanges = async () => {
    const success = await updateContact(props.contact.id, {
        inTime: editData.value.inTime || undefined,
        outTime: editData.value.outTime || undefined,
        location: editData.value.location || undefined,
        address: editData.value.address || undefined,
        fee: editData.value.fee || undefined,
        makingUrl: editData.value.makingUrl || undefined
    })

    if (success) {
        isEditing.value = false
        emit('updated')
    }
}

// Advance to next status
const handleAdvanceStatus = async () => {
    const success = await advanceStatus(props.contact.id)
    if (success) {
        emit('updated')
    }
}

// Open mail client
const openMailClient = () => {
    const subject = encodeURIComponent(`【撮影連絡】${props.contact.projectName} - ${props.contact.castName}様`)
    const body = encodeURIComponent(buildMailBody())
    window.open(`mailto:${props.contact.email || ''}?subject=${subject}&body=${body}`)
}

// Build mail body
const buildMailBody = () => {
    const lines = [
        'お疲れ様です。',
        '',
        '以下の内容でご連絡いたします。',
        '',
        '■ 撮影詳細',
        `日時: ${formattedDate.value} ${editData.value.inTime} - ${editData.value.outTime}`,
        `場所: ${editData.value.location}`,
        `住所: ${editData.value.address}`,
        '',
        '■ 報酬',
        `金額: ¥${(editData.value.fee || 0).toLocaleString()}`,
        '',
        'よろしくお願いいたします。'
    ]
    return lines.join('\n')
}
</script>

<template>
    <Card class="contact-card">
        <template #content>
            <div class="contact-content">
                <!-- Header -->
                <div class="contact-header">
                    <div class="cast-info">
                        <h3>{{ contact.castName }}</h3>
                        <Tag :value="contact.castType" :severity="contact.castType === '外部' ? 'secondary' : 'info'" />
                    </div>
                    <Tag :value="contact.status" :severity="getStatusSeverity(contact.status)" />
                </div>

                <!-- Details -->
                <div class="contact-details">
                    <div class="detail-row">
                        <span class="label">案件</span>
                        <span class="value">{{ contact.projectName }}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">日程</span>
                        <span class="value">{{ formattedDate }}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">役名</span>
                        <span class="value">{{ contact.roleName }} ({{ contact.mainSub }})</span>
                    </div>
                </div>

                <!-- Editable Fields -->
                <div class="editable-fields" v-if="isEditing">
                    <div class="field-row">
                        <label>IN時間</label>
                        <InputText v-model="editData.inTime" placeholder="10:00" />
                    </div>
                    <div class="field-row">
                        <label>OUT時間</label>
                        <InputText v-model="editData.outTime" placeholder="18:00" />
                    </div>
                    <div class="field-row">
                        <label>場所</label>
                        <InputText v-model="editData.location" placeholder="スタジオ名など" />
                    </div>
                    <div class="field-row">
                        <label>住所</label>
                        <InputText v-model="editData.address" placeholder="東京都..." />
                    </div>
                    <div class="field-row">
                        <label>金額</label>
                        <InputNumber v-model="editData.fee" mode="currency" currency="JPY" locale="ja-JP" />
                    </div>
                    <div class="field-row">
                        <label>メイキングURL</label>
                        <InputText v-model="editData.makingUrl" placeholder="https://..." />
                    </div>
                </div>

                <!-- Display Fields (read-only) -->
                <div class="display-fields" v-else>
                    <div v-if="contact.inTime || contact.outTime" class="detail-row">
                        <span class="label">IN/OUT</span>
                        <span class="value">{{ contact.inTime || '--:--' }} - {{ contact.outTime || '--:--' }}</span>
                    </div>
                    <div v-if="contact.location" class="detail-row">
                        <span class="label">場所</span>
                        <span class="value">{{ contact.location }}</span>
                    </div>
                    <div v-if="contact.fee" class="detail-row">
                        <span class="label">金額</span>
                        <span class="value">¥{{ contact.fee.toLocaleString() }}</span>
                    </div>
                    <div v-if="contact.makingUrl" class="detail-row">
                        <span class="label">メイキング</span>
                        <a :href="contact.makingUrl" target="_blank" class="link">{{ contact.makingUrl }}</a>
                    </div>
                </div>

                <!-- Actions -->
                <div class="contact-actions">
                    <Button
                        v-if="isEditing"
                        label="保存"
                        icon="pi pi-check"
                        size="small"
                        @click="saveChanges"
                    />
                    <Button
                        :label="isEditing ? 'キャンセル' : '編集'"
                        :icon="isEditing ? 'pi pi-times' : 'pi pi-pencil'"
                        size="small"
                        :severity="isEditing ? 'secondary' : 'primary'"
                        :outlined="!isEditing"
                        @click="toggleEdit"
                    />
                    <Button
                        v-if="contact.email && !isEditing"
                        label="メール作成"
                        icon="pi pi-envelope"
                        size="small"
                        severity="secondary"
                        outlined
                        @click="openMailClient"
                    />
                    <Button
                        v-if="contact.status !== '完了' && !isEditing"
                        label="次のステータスへ"
                        icon="pi pi-arrow-right"
                        size="small"
                        severity="success"
                        @click="handleAdvanceStatus"
                    />
                    <Button
                        v-if="!isEditing"
                        label="発注書PDF"
                        icon="pi pi-file-pdf"
                        size="small"
                        severity="secondary"
                        outlined
                        :loading="pdfLoading"
                        @click="generateOrderDocument(contact)"
                    />
                </div>
            </div>
        </template>
    </Card>
</template>

<style scoped>
.contact-card {
    transition: transform 0.2s, box-shadow 0.2s;
}

.contact-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.contact-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.contact-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}

.cast-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.cast-info h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
}

.contact-details,
.display-fields {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.detail-row {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.detail-row .label {
    font-size: 0.875rem;
    color: var(--text-color-secondary);
    min-width: 60px;
}

.detail-row .value {
    font-weight: 500;
}

.detail-row .link {
    color: var(--primary-color);
    text-decoration: none;
    word-break: break-all;
}

.detail-row .link:hover {
    text-decoration: underline;
}

.editable-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    padding: 1rem;
    background: var(--surface-50);
    border-radius: 8px;
}

.field-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.field-row label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-color-secondary);
}

.contact-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding-top: 0.5rem;
    border-top: 1px solid var(--surface-border);
}
</style>
