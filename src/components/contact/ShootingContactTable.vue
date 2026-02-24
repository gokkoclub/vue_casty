<script setup lang="ts">
import { ref, computed } from 'vue'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import type { ShootingContact, ShootingContactStatus } from '@/types'

const props = defineProps<{
    contacts: ShootingContact[]
    status: ShootingContactStatus
}>()

const emit = defineEmits<{
    save: [id: string, data: Partial<ShootingContact>]
    advanceStatus: [id: string]
    openMail: [contact: ShootingContact]
    openPdf: [contact: ShootingContact]
}>()

// In-line editing state per row
const editing = ref<Record<string, boolean>>({})
const editData = ref<Record<string, Record<string, string>>>({})

const isEditable = computed(() =>
    props.status === '香盤連絡待ち' || props.status === '発注書送信待ち'
)

function startEdit(contact: ShootingContact) {
    editing.value[contact.id] = true
    editData.value[contact.id] = {
        inTime: contact.inTime || '',
        outTime: contact.outTime || '',
        location: contact.location || '',
        cost: contact.cost || (contact.fee ? String(contact.fee) : ''),
    }
}

function cancelEdit(id: string) {
    editing.value[id] = false
    delete editData.value[id]
}

function saveEdit(id: string) {
    const data = editData.value[id]
    if (!data) return
    emit('save', id, {
        inTime: data.inTime,
        outTime: data.outTime,
        location: data.location,
        cost: data.cost
    })
    editing.value[id] = false
    delete editData.value[id]
}

function formatDate(contact: ShootingContact): string {
    if (contact.shootDate?.toDate) {
        const d = contact.shootDate.toDate()
        const weekdays = ['日', '月', '火', '水', '木', '金', '土']
        return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`
    }
    return '-'
}
</script>

<template>
    <table class="sc-table">
        <thead>
            <tr>
                <th class="col-cast">キャスト</th>
                <th class="col-ms">M/S</th>
                <th class="col-project">案件 / 役名</th>
                <th class="col-date">撮影日</th>

                <!-- Tab-specific columns -->
                <template v-if="status === '香盤連絡待ち' || status === '発注書送信待ち'">
                    <th class="col-time">IN/OUT</th>
                    <th class="col-location">場所</th>
                    <th class="col-cost">金額</th>
                </template>
                <template v-else-if="status === 'メイキング共有待ち'">
                    <th class="col-url">メイキングURL</th>
                </template>
                <template v-else-if="status === '投稿日連絡待ち'">
                    <th class="col-postdate">投稿日</th>
                </template>

                <th class="col-actions">操作</th>
            </tr>
        </thead>
        <tbody>
            <tr v-for="contact in contacts" :key="contact.id" class="contact-row">
                <td class="col-cast">
                    <span class="cast-name">{{ contact.castName }}</span>
                </td>
                <td class="col-ms">
                    <Tag
                        :value="contact.mainSub === 'メイン' ? 'M' : contact.mainSub === 'サブ' ? 'S' : '-'"
                        :severity="contact.mainSub === 'メイン' ? 'success' : 'secondary'"
                        class="ms-tag"
                    />
                </td>
                <td class="col-project">
                    <span class="project-name">{{ contact.projectName }}</span>
                    <span v-if="contact.roleName" class="role-name">/ {{ contact.roleName }}</span>
                </td>
                <td class="col-date">{{ formatDate(contact) }}</td>

                <!-- Tab: 香盤連絡待ち / 発注書送信待ち -->
                <template v-if="status === '香盤連絡待ち' || status === '発注書送信待ち'">
                    <td class="col-time">
                        <template v-if="editing[contact.id]">
                            <div class="edit-inline">
                                <InputText
                                    v-model="editData[contact.id]!.inTime"
                                    placeholder="IN"
                                    class="time-input"
                                />
                                <span>〜</span>
                                <InputText
                                    v-model="editData[contact.id]!.outTime"
                                    placeholder="OUT"
                                    class="time-input"
                                />
                            </div>
                        </template>
                        <template v-else>
                            {{ contact.inTime || '-' }}〜{{ contact.outTime || '-' }}
                        </template>
                    </td>
                    <td class="col-location">
                        <template v-if="editing[contact.id]">
                            <InputText
                                v-model="editData[contact.id]!.location"
                                placeholder="場所"
                                class="location-input"
                            />
                        </template>
                        <template v-else>
                            {{ contact.location || '-' }}
                        </template>
                    </td>
                    <td class="col-cost">
                        <template v-if="editing[contact.id]">
                            <InputText
                                v-model="editData[contact.id]!.cost"
                                placeholder="金額"
                                class="cost-input"
                            />
                        </template>
                        <template v-else>
                            {{ contact.cost || (contact.fee ? `¥${contact.fee.toLocaleString()}` : '-') }}
                        </template>
                    </td>
                </template>

                <!-- Tab: メイキング共有待ち -->
                <template v-else-if="status === 'メイキング共有待ち'">
                    <td class="col-url">
                        <a v-if="contact.makingUrl" :href="contact.makingUrl" target="_blank" class="link">
                            <i class="pi pi-external-link"></i>
                            {{ contact.makingUrl.length > 40 ? contact.makingUrl.substring(0, 40) + '...' : contact.makingUrl }}
                        </a>
                        <span v-else class="no-data">-</span>
                    </td>
                </template>

                <!-- Tab: 投稿日連絡待ち -->
                <template v-else-if="status === '投稿日連絡待ち'">
                    <td class="col-postdate">
                        {{ contact.postDate?.toDate ? contact.postDate.toDate().toLocaleDateString('ja-JP') : '-' }}
                    </td>
                </template>

                <!-- Actions -->
                <td class="col-actions">
                    <div class="action-buttons">
                        <!-- Edit/Save for editable tabs -->
                        <template v-if="isEditable">
                            <Button
                                v-if="editing[contact.id]"
                                icon="pi pi-check"
                                size="small"
                                severity="success"
                                @click="saveEdit(contact.id)"
                                v-tooltip.top="'保存'"
                            />
                            <Button
                                v-if="editing[contact.id]"
                                icon="pi pi-times"
                                size="small"
                                severity="secondary"
                                @click="cancelEdit(contact.id)"
                                v-tooltip.top="'キャンセル'"
                            />
                            <Button
                                v-if="!editing[contact.id]"
                                icon="pi pi-pencil"
                                size="small"
                                severity="secondary"
                                outlined
                                @click="startEdit(contact)"
                                v-tooltip.top="'編集'"
                            />
                        </template>

                        <!-- 発注書PDF (only 発注書送信待ち) -->
                        <Button
                            v-if="status === '発注書送信待ち'"
                            icon="pi pi-file-pdf"
                            size="small"
                            severity="secondary"
                            outlined
                            @click="emit('openPdf', contact)"
                            v-tooltip.top="'発注書PDF'"
                        />

                        <!-- Mail -->
                        <Button
                            icon="pi pi-envelope"
                            size="small"
                            severity="info"
                            outlined
                            @click="emit('openMail', contact)"
                            v-tooltip.top="'メール作成'"
                        />

                        <!-- Advance status -->
                        <Button
                            icon="pi pi-arrow-right"
                            size="small"
                            severity="success"
                            outlined
                            @click="emit('advanceStatus', contact.id)"
                            v-tooltip.top="'次のステータスへ'"
                        />
                    </div>
                </td>
            </tr>
        </tbody>
    </table>
</template>

<style scoped>
.sc-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
}

.sc-table th {
    padding: 0.5rem 0.75rem;
    text-align: left;
    font-weight: 600;
    color: var(--text-color-secondary);
    border-bottom: 2px solid var(--surface-border);
    white-space: nowrap;
    font-size: 0.8rem;
}

.sc-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--surface-border);
    vertical-align: middle;
}

.contact-row:hover {
    background: var(--surface-hover);
}

.col-cast { min-width: 100px; }
.col-ms { width: 50px; text-align: center; }
.col-project { min-width: 150px; }
.col-date { width: 90px; white-space: nowrap; }
.col-time { min-width: 130px; }
.col-location { min-width: 120px; }
.col-cost { min-width: 80px; }
.col-url { min-width: 200px; }
.col-postdate { width: 100px; }
.col-actions { width: 150px; }

.cast-name {
    font-weight: 600;
}

.project-name {
    font-weight: 500;
}

.role-name {
    color: var(--text-color-secondary);
    margin-left: 0.25rem;
    font-size: 0.8rem;
}

.ms-tag {
    font-size: 0.7rem;
    min-width: 24px;
    text-align: center;
}

.edit-inline {
    display: flex;
    align-items: center;
    gap: 0.25rem;
}

.time-input {
    width: 60px;
    padding: 0.25rem 0.4rem;
    font-size: 0.8rem;
}

.location-input {
    width: 100%;
    padding: 0.25rem 0.4rem;
    font-size: 0.8rem;
}

.cost-input {
    width: 80px;
    padding: 0.25rem 0.4rem;
    font-size: 0.8rem;
}

.link {
    color: var(--primary-color);
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: 0.25rem;
}

.link:hover {
    text-decoration: underline;
}

.no-data {
    color: var(--text-color-secondary);
}

.action-buttons {
    display: flex;
    gap: 0.25rem;
    flex-wrap: nowrap;
}
</style>
