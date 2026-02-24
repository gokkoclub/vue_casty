<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import Tag from 'primevue/tag'
import Badge from 'primevue/badge'
import DatePicker from 'primevue/datepicker'
import ProgressSpinner from 'primevue/progressspinner'
import { useEmailSettings } from '@/composables/useEmailSettings'
import type { EmailTemplateSetting } from '@/composables/useEmailSettings'
import { useCastMaster } from '@/composables/useCastMaster'
import type { CastMaster, Casting } from '@/types'
import { collection, query, where, getDocs, updateDoc, doc, Timestamp } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { useToast } from 'primevue/usetoast'

const toast = useToast()
const activeTab = ref(0)

// ========= Tab 1: Email Templates =========
const emailSettings = useEmailSettings()
const editingTemplateId = ref<string | null>(null)
const editSubject = ref('')
const editBody = ref('')

onMounted(() => {
    emailSettings.fetchTemplates()
    castMaster.fetchHistory()
})

function startEditTemplate(t: EmailTemplateSetting) {
    editingTemplateId.value = t.id
    editSubject.value = t.subject
    editBody.value = t.body
}

function cancelEditTemplate() {
    editingTemplateId.value = null
}

async function saveEditTemplate() {
    if (!editingTemplateId.value) return
    await emailSettings.saveTemplate({
        id: editingTemplateId.value,
        subject: editSubject.value,
        body: editBody.value
    })
    // Refresh
    await emailSettings.fetchTemplates()
    editingTemplateId.value = null
}

function resetTemplate(id: string) {
    const def = emailSettings.resetToDefault(id)
    if (def) {
        editSubject.value = def.subject
        editBody.value = def.body
    }
}

// ========= Tab 2: Cast Master DB =========
const castMaster = useCastMaster()
const masterFilter = ref('')
const editingMasterId = ref<string | null>(null)
const editMasterCost = ref<number>(0)

const filteredMasters = computed(() => {
    const q = masterFilter.value.toLowerCase()
    if (!q) return castMaster.masters.value
    return castMaster.masters.value.filter(m =>
        m.castName.toLowerCase().includes(q) ||
        m.projectName.toLowerCase().includes(q) ||
        m.accountName.toLowerCase().includes(q)
    )
})

function startEditMaster(m: CastMaster) {
    editingMasterId.value = m.id
    editMasterCost.value = m.cost || 0
}

function cancelEditMaster() {
    editingMasterId.value = null
}

async function saveEditMaster() {
    if (!editingMasterId.value) return
    await castMaster.updateMaster(editingMasterId.value, {
        cost: editMasterCost.value
    })
    editingMasterId.value = null
}

function formatDate(ts: Timestamp | undefined): string {
    if (!ts?.toDate) return '-'
    const d = ts.toDate()
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`
}

// ========= Tab 3: Shooting Date Edit =========
const dateSearchProject = ref('')
const dateSearchResults = ref<{ id: string; collection: string; castName: string; projectName: string; shootDate: Timestamp; newDate?: Date }[]>([])
const dateSearchLoading = ref(false)

async function searchByProject() {
    if (!db || !dateSearchProject.value.trim()) return
    dateSearchLoading.value = true
    dateSearchResults.value = []

    try {
        // Search castings
        const castingsSnap = await getDocs(
            query(collection(db, 'castings'), where('projectName', '==', dateSearchProject.value.trim()))
        )
        castingsSnap.forEach(docSnap => {
            const d = docSnap.data() as Casting
            dateSearchResults.value.push({
                id: docSnap.id,
                collection: 'castings',
                castName: d.castName,
                projectName: d.projectName,
                shootDate: d.startDate
            })
        })

        // Search shootingContacts
        const contactsSnap = await getDocs(
            query(collection(db, 'shootingContacts'), where('projectName', '==', dateSearchProject.value.trim()))
        )
        contactsSnap.forEach(docSnap => {
            const d = docSnap.data()
            dateSearchResults.value.push({
                id: docSnap.id,
                collection: 'shootingContacts',
                castName: d.castName || '',
                projectName: d.projectName || '',
                shootDate: d.shootDate
            })
        })
    } catch (error) {
        console.error('Error searching:', error)
        toast.add({ severity: 'error', summary: 'エラー', detail: '検索に失敗しました', life: 3000 })
    } finally {
        dateSearchLoading.value = false
    }
}

async function updateShootDate(item: typeof dateSearchResults.value[0]) {
    if (!db || !item.newDate) return
    try {
        const newTs = Timestamp.fromDate(item.newDate)
        const colName = item.collection
        const fieldName = colName === 'castings' ? 'startDate' : 'shootDate'
        await updateDoc(doc(db, colName, item.id), { [fieldName]: newTs })
        item.shootDate = newTs
        item.newDate = undefined
        toast.add({ severity: 'success', summary: '更新完了', detail: `${item.castName} の撮影日を変更しました`, life: 2000 })
    } catch (error) {
        console.error('Error updating date:', error)
        toast.add({ severity: 'error', summary: 'エラー', detail: '撮影日の更新に失敗しました', life: 3000 })
    }
}

async function bulkUpdateDate() {
    const itemsWithNewDate = dateSearchResults.value.filter(i => i.newDate)
    if (itemsWithNewDate.length === 0) {
        toast.add({ severity: 'warn', summary: '確認', detail: '変更する日付が設定されていません', life: 3000 })
        return
    }
    for (const item of itemsWithNewDate) {
        await updateShootDate(item)
    }
}

function setAllNewDate(date: Date | null) {
    if (!date) return
    dateSearchResults.value.forEach(item => { item.newDate = date })
}
</script>

<template>
    <div class="management-view">
        <div class="page-header">
            <h1>
                <i class="pi pi-cog"></i>
                管理画面
            </h1>
        </div>

        <TabView v-model:activeIndex="activeTab">
            <!-- Tab 1: Email Templates -->
            <TabPanel value="0">
                <template #header>
                    <div class="tab-header">
                        <i class="pi pi-envelope"></i>
                        <span>メールテンプレート</span>
                        <Badge :value="emailSettings.templates.value.length" severity="info" />
                    </div>
                </template>

                <div class="tab-content">
                    <div v-if="emailSettings.loading.value" class="loading-container">
                        <ProgressSpinner />
                    </div>

                    <div v-else class="template-list">
                        <div
                            v-for="tpl in emailSettings.templates.value"
                            :key="tpl.id"
                            class="template-card"
                        >
                            <!-- View mode -->
                            <template v-if="editingTemplateId !== tpl.id">
                                <div class="template-header">
                                    <Tag :value="tpl.id" severity="info" />
                                    <div class="template-actions">
                                        <Button
                                            icon="pi pi-pencil"
                                            size="small"
                                            severity="secondary"
                                            outlined
                                            @click="startEditTemplate(tpl)"
                                            v-tooltip.top="'編集'"
                                        />
                                    </div>
                                </div>
                                <div class="template-preview">
                                    <div class="preview-field">
                                        <label>件名:</label>
                                        <span>{{ tpl.subject }}</span>
                                    </div>
                                    <div class="preview-field">
                                        <label>本文 (先頭3行):</label>
                                        <span class="preview-body">{{ tpl.body.split('\n').slice(0, 3).join('\n') }}...</span>
                                    </div>
                                </div>
                            </template>

                            <!-- Edit mode -->
                            <template v-else>
                                <div class="template-header">
                                    <Tag :value="tpl.id" severity="warning" />
                                    <span class="editing-label">編集中</span>
                                </div>
                                <div class="template-edit">
                                    <div class="edit-field">
                                        <label>件名:</label>
                                        <InputText v-model="editSubject" class="w-full" />
                                    </div>
                                    <div class="edit-field">
                                        <label>本文:</label>
                                        <Textarea v-model="editBody" rows="15" class="w-full" autoResize />
                                    </div>
                                    <div class="edit-actions">
                                        <Button label="保存" icon="pi pi-check" size="small" @click="saveEditTemplate" />
                                        <Button label="デフォルトに戻す" icon="pi pi-undo" size="small" severity="secondary" @click="resetTemplate(tpl.id)" />
                                        <Button label="キャンセル" icon="pi pi-times" size="small" severity="secondary" outlined @click="cancelEditTemplate" />
                                    </div>
                                    <div class="variable-hint">
                                        <small>利用可能な変数: <code v-pre>{{撮影日}}</code> <code v-pre>{{キャスト名}}</code> <code v-pre>{{作品名}}</code> <code v-pre>{{役名}}</code> <code v-pre>{{金額}}</code> <code v-pre>{{時間}}</code> <code v-pre>{{集合場所}}</code> <code v-pre>{{住所}}</code> <code v-pre>{{notion}}</code> <code v-pre>{{アカウント}}</code> <code v-pre>{{GドライブURL}}</code> <code v-pre>{{投稿日}}</code></small>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            </TabPanel>

            <!-- Tab 2: Cast Master DB -->
            <TabPanel value="1">
                <template #header>
                    <div class="tab-header">
                        <i class="pi pi-database"></i>
                        <span>キャストマスターDB</span>
                        <Badge :value="castMaster.masters.value.length" severity="secondary" />
                    </div>
                </template>

                <div class="tab-content">
                    <div class="filter-bar">
                        <InputText
                            v-model="masterFilter"
                            placeholder="🔍 キャスト名・作品名・アカウント名で検索"
                            class="filter-input"
                        />
                        <Button
                            label="再読み込み"
                            icon="pi pi-refresh"
                            size="small"
                            severity="secondary"
                            @click="castMaster.fetchHistory()"
                            :loading="castMaster.loading.value"
                        />
                    </div>

                    <div v-if="castMaster.loading.value" class="loading-container">
                        <ProgressSpinner />
                    </div>

                    <div v-else-if="filteredMasters.length === 0" class="empty-state">
                        <i class="pi pi-database"></i>
                        <p>データがありません</p>
                    </div>

                    <table v-else class="master-table">
                        <thead>
                            <tr>
                                <th>キャスト名</th>
                                <th>タイプ</th>
                                <th>アカウント</th>
                                <th>作品名</th>
                                <th>M/S</th>
                                <th>撮影日</th>
                                <th>金額</th>
                                <th>決定日</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="m in filteredMasters" :key="m.id">
                                <td class="cast-name">{{ m.castName }}</td>
                                <td>
                                    <Tag
                                        :value="m.castType"
                                        :severity="m.castType === '外部' ? 'warning' : 'info'"
                                        class="type-tag"
                                    />
                                </td>
                                <td>{{ m.accountName }}</td>
                                <td>{{ m.projectName }}</td>
                                <td>{{ m.mainSub === 'メイン' ? 'M' : m.mainSub === 'サブ' ? 'S' : '-' }}</td>
                                <td class="date-col">{{ formatDate(m.shootDate) }}</td>
                                <td>
                                    <template v-if="editingMasterId === m.id">
                                        <InputNumber v-model="editMasterCost" class="cost-input" prefix="¥" />
                                    </template>
                                    <template v-else>
                                        {{ m.cost ? `¥${m.cost.toLocaleString()}` : '-' }}
                                    </template>
                                </td>
                                <td class="date-col">{{ formatDate(m.decidedAt) }}</td>
                                <td>
                                    <div class="action-buttons">
                                        <template v-if="editingMasterId === m.id">
                                            <Button icon="pi pi-check" size="small" severity="success" @click="saveEditMaster" />
                                            <Button icon="pi pi-times" size="small" severity="secondary" @click="cancelEditMaster" />
                                        </template>
                                        <template v-else>
                                            <Button icon="pi pi-pencil" size="small" severity="secondary" outlined @click="startEditMaster(m)" />
                                        </template>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </TabPanel>

            <!-- Tab 3: Shooting Date Edit -->
            <TabPanel value="2">
                <template #header>
                    <div class="tab-header">
                        <i class="pi pi-calendar-plus"></i>
                        <span>撮影日編集</span>
                    </div>
                </template>

                <div class="tab-content">
                    <div class="date-search">
                        <InputText
                            v-model="dateSearchProject"
                            placeholder="作品名を入力して検索"
                            class="search-input"
                            @keyup.enter="searchByProject"
                        />
                        <Button
                            label="検索"
                            icon="pi pi-search"
                            @click="searchByProject"
                            :loading="dateSearchLoading"
                        />
                    </div>

                    <div v-if="dateSearchLoading" class="loading-container">
                        <ProgressSpinner />
                    </div>

                    <div v-else-if="dateSearchResults.length === 0 && dateSearchProject" class="empty-state">
                        <i class="pi pi-search"></i>
                        <p>該当する作品が見つかりません</p>
                    </div>

                    <template v-else-if="dateSearchResults.length > 0">
                        <div class="bulk-date-bar">
                            <span>一括変更:</span>
                            <DatePicker
                                :modelValue="null"
                                @update:modelValue="setAllNewDate($event as Date)"
                                dateFormat="yy/mm/dd"
                                placeholder="全キャストの新撮影日"
                                class="bulk-date-picker"
                            />
                            <Button
                                label="一括適用"
                                icon="pi pi-check-circle"
                                size="small"
                                severity="success"
                                @click="bulkUpdateDate"
                            />
                        </div>

                        <table class="master-table">
                            <thead>
                                <tr>
                                    <th>DB</th>
                                    <th>キャスト名</th>
                                    <th>作品名</th>
                                    <th>現在の撮影日</th>
                                    <th>新しい撮影日</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="item in dateSearchResults" :key="`${item.collection}_${item.id}`">
                                    <td>
                                        <Tag
                                            :value="item.collection === 'castings' ? 'キャスティング' : '撮影連絡'"
                                            :severity="item.collection === 'castings' ? 'info' : 'warning'"
                                            class="type-tag"
                                        />
                                    </td>
                                    <td class="cast-name">{{ item.castName }}</td>
                                    <td>{{ item.projectName }}</td>
                                    <td class="date-col">{{ formatDate(item.shootDate) }}</td>
                                    <td>
                                        <DatePicker
                                            v-model="item.newDate"
                                            dateFormat="yy/mm/dd"
                                            placeholder="新しい日付"
                                            class="date-input"
                                        />
                                    </td>
                                    <td>
                                        <Button
                                            icon="pi pi-check"
                                            size="small"
                                            severity="success"
                                            :disabled="!item.newDate"
                                            @click="updateShootDate(item)"
                                        />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </template>
                </div>
            </TabPanel>
        </TabView>
    </div>
</template>

<style scoped>
.management-view {
    padding: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
}

.page-header {
    margin-bottom: 1.5rem;
}

.page-header h1 {
    font-size: 1.75rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0;
}

.page-header h1 i { color: var(--primary-color); }

.tab-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.tab-content {
    padding: 1rem 0;
}

.loading-container {
    display: flex; align-items: center; justify-content: center;
    padding: 3rem; gap: 1rem;
}

.empty-state {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 4rem; color: var(--text-color-secondary);
}
.empty-state i { font-size: 3rem; opacity: 0.3; margin-bottom: 1rem; }

/* ======== Email Templates ======== */
.template-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.template-card {
    border: 1px solid var(--surface-border);
    border-radius: 8px;
    padding: 1rem;
}

.template-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
}

.editing-label {
    font-size: 0.8rem;
    color: var(--yellow-500);
    font-weight: 600;
}

.template-preview {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.preview-field {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
}

.preview-field label {
    font-weight: 600;
    font-size: 0.8rem;
    color: var(--text-color-secondary);
    min-width: 80px;
    flex-shrink: 0;
}

.preview-body {
    font-size: 0.85rem;
    color: var(--text-color-secondary);
    white-space: pre-line;
}

.template-edit {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.edit-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.edit-field label {
    font-weight: 600;
    font-size: 0.8rem;
    color: var(--text-color-secondary);
}

.edit-actions {
    display: flex;
    gap: 0.5rem;
}

.variable-hint {
    padding: 0.5rem;
    background: var(--surface-50);
    border-radius: 4px;
}

.variable-hint code {
    background: var(--surface-200);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.75rem;
}

/* ======== Cast Master & Date Edit Tables ======== */
.filter-bar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
}

.filter-input {
    flex: 1;
    max-width: 400px;
}

.master-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
}

.master-table th {
    padding: 0.5rem 0.75rem;
    text-align: left;
    font-weight: 600;
    color: var(--text-color-secondary);
    border-bottom: 2px solid var(--surface-border);
    white-space: nowrap;
    font-size: 0.8rem;
}

.master-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--surface-border);
    vertical-align: middle;
}

.master-table tr:hover { background: var(--surface-hover); }

.cast-name { font-weight: 600; }
.date-col { white-space: nowrap; }
.type-tag { font-size: 0.7rem; }

.cost-input { width: 120px; }

.action-buttons {
    display: flex;
    gap: 0.25rem;
}

/* ======== Date Search ======== */
.date-search {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
}

.search-input {
    flex: 1;
    max-width: 400px;
}

.bulk-date-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: var(--surface-50);
    border-radius: 8px;
}

.bulk-date-bar span {
    font-weight: 600;
    font-size: 0.875rem;
}

.bulk-date-picker { width: 200px; }
.date-input { width: 160px; }
</style>
