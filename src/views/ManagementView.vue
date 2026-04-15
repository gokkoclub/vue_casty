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
import { useAdmins } from '@/composables/useAdmins'
import { useStaffMentions } from '@/composables/useStaffMentions'
import type { StaffMention } from '@/composables/useStaffMentions'
import type { CastMaster, Casting } from '@/types'
import { collection, query, getDocs, updateDoc, doc, Timestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/services/firebase'
import { useToast } from 'primevue/usetoast'

const toast = useToast()
const activeTab = ref(0)

// ========= Tab 1: Email Templates =========
const emailSettings = useEmailSettings()
const editingTemplateId = ref<string | null>(null)
const editSubject = ref('')
const editBody = ref('')

// ========= Tab 4: Admin Management =========
const admins = useAdmins()
const newAdminEmail = ref('')
const newAdminName = ref('')
const addingAdmin = ref(false)

async function handleAddAdmin() {
    if (!newAdminEmail.value.trim() || !newAdminName.value.trim()) {
        toast.add({ severity: 'warn', summary: '入力エラー', detail: 'メールアドレスと名前を入力してください', life: 3000 })
        return
    }
    addingAdmin.value = true
    const success = await admins.addAdmin(newAdminEmail.value, newAdminName.value)
    if (success) {
        newAdminEmail.value = ''
        newAdminName.value = ''
    }
    addingAdmin.value = false
}

async function handleToggleAdmin(admin: { id: string; active: boolean }) {
    if (admin.active) {
        await admins.deactivateAdmin(admin.id)
    } else {
        await admins.activateAdmin(admin.id)
    }
}

async function handleRemoveAdmin(adminId: string) {
    if (!confirm('この管理者を削除しますか？')) return
    await admins.removeAdmin(adminId)
}

// ========= Tab 5: Staff Mentions =========
const staffMentions = useStaffMentions()
const staffSearch = ref('')
const showInactiveStaff = ref(false)
const editingStaffId = ref<string | null>(null)
const newStaffForm = ref({ name: '', slackMentionId: '', role: '', email: '', aliases: '', note: '' })
const staffFormOpen = ref(false)
const savingStaff = ref(false)

const filteredStaffMentions = computed(() => {
    const q = staffSearch.value.trim().toLowerCase()
    return staffMentions.mentions.value.filter(s => {
        if (!showInactiveStaff.value && s.active === false) return false
        if (!q) return true
        if (s.name?.toLowerCase().includes(q)) return true
        if (s.slackMentionId?.toLowerCase().includes(q)) return true
        if (s.role?.toLowerCase().includes(q)) return true
        if (s.email?.toLowerCase().includes(q)) return true
        if (s.aliases?.some(a => a.toLowerCase().includes(q))) return true
        return false
    })
})

function openNewStaffForm() {
    editingStaffId.value = null
    newStaffForm.value = { name: '', slackMentionId: '', role: '', email: '', aliases: '', note: '' }
    staffFormOpen.value = true
}

function openEditStaff(s: StaffMention) {
    editingStaffId.value = s.id
    newStaffForm.value = {
        name: s.name || '',
        slackMentionId: s.slackMentionId || '',
        role: s.role || '',
        email: s.email || '',
        aliases: (s.aliases || []).filter(a => a !== s.name).join('\n'),
        note: s.note || '',
    }
    staffFormOpen.value = true
}

function closeStaffForm() {
    staffFormOpen.value = false
    editingStaffId.value = null
}

async function saveStaff() {
    const form = newStaffForm.value
    if (!form.name.trim() || !form.slackMentionId.trim()) {
        toast.add({ severity: 'warn', summary: '入力エラー', detail: '本名とSlackユーザーIDは必須です', life: 3000 })
        return
    }
    savingStaff.value = true
    const ok = await staffMentions.upsert({
        name: form.name,
        slackMentionId: form.slackMentionId,
        role: form.role,
        email: form.email,
        aliases: form.aliases.split(/[\n,、]/).map(s => s.trim()).filter(s => s.length > 0),
        note: form.note,
    })
    savingStaff.value = false
    if (ok) closeStaffForm()
}

async function handleToggleStaffActive(s: StaffMention) {
    await staffMentions.setActive(s.id, !s.active)
}

async function handleRemoveStaff(s: StaffMention) {
    if (!confirm(`${s.name} を削除しますか？（ソフト無効化で十分な場合はキャンセル）`)) return
    await staffMentions.remove(s.id)
}

onMounted(() => {
    emailSettings.fetchTemplates()
    castMaster.fetchHistory()
    admins.fetchAdmins()
    staffMentions.fetchAll()
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

// Cast master grouping view
const masterViewMode = ref<'flat' | 'project' | 'date'>('flat')

interface MasterGroup {
    key: string
    label: string
    items: CastMaster[]
}

const groupedMasters = computed<MasterGroup[]>(() => {
    const list = filteredMasters.value
    if (masterViewMode.value === 'flat') return []
    
    const map = new Map<string, CastMaster[]>()
    
    for (const m of list) {
        let key: string
        if (masterViewMode.value === 'project') {
            key = `${m.accountName}__${m.projectName}`
        } else {
            // date
            if (m.shootDate?.toDate) {
                const d = m.shootDate.toDate()
                const y = d.getFullYear()
                const mo = String(d.getMonth() + 1).padStart(2, '0')
                const day = String(d.getDate()).padStart(2, '0')
                key = `${y}-${mo}-${day}`
            } else {
                key = '日付未定'
            }
        }
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(m)
    }
    
    const groups: MasterGroup[] = []
    for (const [key, items] of map) {
        const labelParts = key.split('__')
        const label = masterViewMode.value === 'project'
            ? `${labelParts[0]} / ${labelParts[1] || ''}` 
            : (key === '日付未定' ? '📅 日付未定' : `📅 ${formatDate(items[0]?.shootDate)}`)
        groups.push({ key, label, items })
    }
    
    if (masterViewMode.value === 'date') {
        groups.sort((a, b) => b.key.localeCompare(a.key))
    } else {
        groups.sort((a, b) => a.label.localeCompare(b.label))
    }
    return groups
})

const expandedMasterGroups = ref<Set<string>>(new Set())

function toggleMasterGroup(key: string) {
    if (expandedMasterGroups.value.has(key)) {
        expandedMasterGroups.value.delete(key)
    } else {
        expandedMasterGroups.value.add(key)
    }
    expandedMasterGroups.value = new Set(expandedMasterGroups.value)
}

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

    const keyword = dateSearchProject.value.trim().toLowerCase()

    try {
        // 全件取得してフロントで部分一致フィルタ（Firestoreは部分一致非対応のため）
        // Search castings
        const castingsSnap = await getDocs(
            query(collection(db, 'castings'))
        )
        castingsSnap.forEach(docSnap => {
            const d = docSnap.data() as Casting
            // 削除済みはスキップ
            if (d.status === '削除済み') return
            // 部分一致: 作品名、キャスト名、アカウント名で検索
            const match = (d.projectName || '').toLowerCase().includes(keyword) ||
                          (d.castName || '').toLowerCase().includes(keyword) ||
                          (d.accountName || '').toLowerCase().includes(keyword)
            if (match) {
                dateSearchResults.value.push({
                    id: docSnap.id,
                    collection: 'castings',
                    castName: d.castName,
                    projectName: d.projectName,
                    shootDate: d.startDate
                })
            }
        })

        // Search shootingContacts
        const contactsSnap = await getDocs(
            query(collection(db, 'shootingContacts'))
        )
        contactsSnap.forEach(docSnap => {
            const d = docSnap.data()
            const match = (d.projectName || '').toLowerCase().includes(keyword) ||
                          (d.castName || '').toLowerCase().includes(keyword) ||
                          (d.accountName || '').toLowerCase().includes(keyword)
            if (match) {
                dateSearchResults.value.push({
                    id: docSnap.id,
                    collection: 'shootingContacts',
                    castName: d.castName || '',
                    projectName: d.projectName || '',
                    shootDate: d.shootDate
                })
            }
        })

        if (dateSearchResults.value.length === 0) {
            toast.add({ severity: 'info', summary: '検索結果', detail: '該当するデータが見つかりませんでした', life: 3000 })
        }
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
        // タイムゾーン安全な日付文字列を生成（正午に設定）
        const d = item.newDate
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const dateStr = `${y}/${m}/${day}`

        const newDate = new Date(y, d.getMonth(), d.getDate(), 12, 0, 0) // 正午に設定
        const newTs = Timestamp.fromDate(newDate)
        const colName = item.collection

        if (colName === 'castings') {
            // Cloud Function経由で更新 → Googleカレンダー + Slack通知も自動連動
            if (functions) {
                const notifyUpdate = httpsCallable(functions, 'notifyOrderUpdated')
                await notifyUpdate({
                    castingId: item.id,
                    changes: { startDate: dateStr, endDate: dateStr }
                })
            } else {
                // fallback: Firestoreのみ更新
                await updateDoc(doc(db, colName, item.id), { startDate: newTs, endDate: newTs })
            }
        } else {
            await updateDoc(doc(db, colName, item.id), { shootDate: newTs })
        }
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
                        <div class="view-toggle">
                            <Button
                                label="一覧"
                                :severity="masterViewMode === 'flat' ? 'primary' : 'secondary'"
                                text size="small"
                                @click="masterViewMode = 'flat'"
                            />
                            <Button
                                label="作品別"
                                :severity="masterViewMode === 'project' ? 'primary' : 'secondary'"
                                text size="small"
                                @click="masterViewMode = 'project'"
                            />
                            <Button
                                label="日付別"
                                :severity="masterViewMode === 'date' ? 'primary' : 'secondary'"
                                text size="small"
                                @click="masterViewMode = 'date'"
                            />
                        </div>
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

                    <!-- Flat view -->
                    <table v-else-if="masterViewMode === 'flat'" class="master-table">
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
                                <td>{{ m.mainSub === 'メイン' ? 'M' : '-' }}</td>
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

                    <!-- Grouped view (作品別 / 日付別) -->
                    <div v-else class="master-groups">
                        <div v-for="group in groupedMasters" :key="group.key" class="master-group">
                            <div class="master-group-header" @click="toggleMasterGroup(group.key)">
                                <i :class="['pi', expandedMasterGroups.has(group.key) ? 'pi-chevron-down' : 'pi-chevron-right']"></i>
                                <span class="master-group-label">{{ group.label }}</span>
                                <Badge :value="group.items.length" severity="secondary" />
                            </div>
                            <table v-if="expandedMasterGroups.has(group.key)" class="master-table grouped-table">
                                <thead>
                                    <tr>
                                        <th>キャスト名</th>
                                        <th>タイプ</th>
                                        <th v-if="masterViewMode === 'date'">作品名</th>
                                        <th v-if="masterViewMode === 'project'">撮影日</th>
                                        <th>M/S</th>
                                        <th>金額</th>
                                        <th>決定日</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="m in group.items" :key="m.id">
                                        <td class="cast-name">{{ m.castName }}</td>
                                        <td><Tag :value="m.castType" :severity="m.castType === '外部' ? 'warning' : 'info'" class="type-tag" /></td>
                                        <td v-if="masterViewMode === 'date'">{{ m.projectName }}</td>
                                        <td v-if="masterViewMode === 'project'" class="date-col">{{ formatDate(m.shootDate) }}</td>
                                        <td>{{ m.mainSub === 'メイン' ? 'M' : '-' }}</td>
                                        <td>{{ m.cost ? `¥${m.cost.toLocaleString()}` : '-' }}</td>
                                        <td class="date-col">{{ formatDate(m.decidedAt) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
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

            <!-- Tab 4: Admin Management -->
            <TabPanel value="3">
                <template #header>
                    <div class="tab-header">
                        <i class="pi pi-shield"></i>
                        <span>管理者設定</span>
                        <Badge :value="admins.admins.value.length" severity="secondary" />
                    </div>
                </template>

                <div class="tab-content">
                    <!-- Add Admin Form -->
                    <div class="admin-add-form">
                        <h3 class="admin-section-title">
                            <i class="pi pi-user-plus"></i>
                            管理者を追加
                        </h3>
                        <div class="admin-form-row">
                            <InputText
                                v-model="newAdminEmail"
                                placeholder="メールアドレス"
                                class="admin-input"
                                type="email"
                            />
                            <InputText
                                v-model="newAdminName"
                                placeholder="表示名"
                                class="admin-input-name"
                            />
                            <Button
                                label="追加"
                                icon="pi pi-plus"
                                :loading="addingAdmin"
                                @click="handleAddAdmin"
                            />
                        </div>
                    </div>

                    <!-- Admin List -->
                    <div class="admin-list-section">
                        <h3 class="admin-section-title">
                            <i class="pi pi-users"></i>
                            管理者一覧
                        </h3>

                        <div v-if="admins.loading.value" class="loading-container">
                            <ProgressSpinner />
                        </div>

                        <div v-else-if="admins.admins.value.length === 0" class="empty-state">
                            <i class="pi pi-shield"></i>
                            <p>管理者が登録されていません</p>
                        </div>

                        <table v-else class="master-table admin-table">
                            <thead>
                                <tr>
                                    <th>名前</th>
                                    <th>メールアドレス</th>
                                    <th>ステータス</th>
                                    <th>登録日</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="admin in admins.admins.value" :key="admin.id"
                                    :class="{ 'admin-inactive': !admin.active }">
                                    <td class="cast-name">{{ admin.name }}</td>
                                    <td class="admin-email">{{ admin.email }}</td>
                                    <td>
                                        <Tag
                                            :value="admin.active ? '有効' : '無効'"
                                            :severity="admin.active ? 'success' : 'secondary'"
                                        />
                                    </td>
                                    <td class="date-col">
                                        {{ admin.createdAt?.toDate
                                            ? admin.createdAt.toDate().toLocaleDateString('ja-JP')
                                            : '-' }}
                                    </td>
                                    <td>
                                        <div class="action-buttons">
                                            <Button
                                                :icon="admin.active ? 'pi pi-ban' : 'pi pi-check-circle'"
                                                :severity="admin.active ? 'warning' : 'success'"
                                                size="small"
                                                outlined
                                                v-tooltip.top="admin.active ? '無効化' : '有効化'"
                                                @click="handleToggleAdmin(admin)"
                                            />
                                            <Button
                                                icon="pi pi-trash"
                                                severity="danger"
                                                size="small"
                                                outlined
                                                v-tooltip.top="'削除'"
                                                @click="handleRemoveAdmin(admin.id)"
                                            />
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </TabPanel>

            <!-- Tab 5: Staff Mentions (スタッフメンション管理) -->
            <TabPanel value="4">
                <template #header>
                    <div class="tab-header">
                        <i class="pi pi-at"></i>
                        <span>スタッフメンション</span>
                        <Badge :value="staffMentions.mentions.value.length" severity="secondary" />
                    </div>
                </template>

                <div class="tab-content">
                    <!-- 説明 -->
                    <div class="staff-help">
                        <i class="pi pi-info-circle"></i>
                        <span>
                            オーダー送信時の cc 欄で使われる <b>監督 / FD / P / 衣装</b> などの Slack メンション辞書。
                            casts・admin にいないスタッフはここに登録してください。
                            本名とSlackユーザーID（<code>U...</code>）必須。別名を登録すると表記ゆれに強くなります。
                        </span>
                    </div>

                    <!-- 上部アクション -->
                    <div class="staff-toolbar">
                        <InputText
                            v-model="staffSearch"
                            placeholder="名前 / Slack ID / 役職で検索"
                            class="staff-search"
                        />
                        <label class="staff-inactive-toggle">
                            <input type="checkbox" v-model="showInactiveStaff" />
                            <span>無効化も表示</span>
                        </label>
                        <Button
                            label="追加"
                            icon="pi pi-plus"
                            @click="openNewStaffForm"
                        />
                    </div>

                    <!-- フォーム -->
                    <div v-if="staffFormOpen" class="staff-form">
                        <h3 class="admin-section-title">
                            <i :class="editingStaffId ? 'pi pi-pencil' : 'pi pi-user-plus'"></i>
                            {{ editingStaffId ? '編集' : '追加' }}
                        </h3>
                        <div class="staff-form-grid">
                            <div class="staff-form-field">
                                <label>本名 <span class="required">*</span></label>
                                <InputText v-model="newStaffForm.name" placeholder="例: 北垣拓也" />
                            </div>
                            <div class="staff-form-field">
                                <label>Slack ユーザー ID <span class="required">*</span></label>
                                <InputText v-model="newStaffForm.slackMentionId" placeholder="例: U02E6HGK4BH" />
                            </div>
                            <div class="staff-form-field">
                                <label>役職（任意）</label>
                                <InputText v-model="newStaffForm.role" placeholder="CD / FD / P / 衣装 など" />
                            </div>
                            <div class="staff-form-field">
                                <label>メール（任意）</label>
                                <InputText v-model="newStaffForm.email" placeholder="example@gokkoclub.jp" />
                            </div>
                            <div class="staff-form-field staff-form-full">
                                <label>別名（1行1つ。カンマ/読点区切りでも可）</label>
                                <Textarea
                                    v-model="newStaffForm.aliases"
                                    rows="3"
                                    placeholder="例:&#10;takuya.kitagaki(北垣 拓也)&#10;北垣 拓也"
                                />
                            </div>
                            <div class="staff-form-field staff-form-full">
                                <label>メモ（任意）</label>
                                <InputText v-model="newStaffForm.note" placeholder="" />
                            </div>
                        </div>
                        <div class="staff-form-actions">
                            <Button label="キャンセル" severity="secondary" outlined @click="closeStaffForm" />
                            <Button label="保存" icon="pi pi-check" :loading="savingStaff" @click="saveStaff" />
                        </div>
                    </div>

                    <!-- 一覧 -->
                    <div v-if="staffMentions.loading.value" class="loading-container">
                        <ProgressSpinner />
                    </div>
                    <div v-else-if="filteredStaffMentions.length === 0" class="empty-state">
                        <i class="pi pi-at"></i>
                        <p>{{ staffMentions.mentions.value.length === 0 ? 'まだ登録されていません' : '該当するスタッフがいません' }}</p>
                    </div>

                    <table v-else class="master-table admin-table">
                        <thead>
                            <tr>
                                <th>本名</th>
                                <th>役職</th>
                                <th>Slack ID</th>
                                <th>別名</th>
                                <th>ステータス</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="s in filteredStaffMentions"
                                :key="s.id"
                                :class="{ 'admin-inactive': s.active === false }"
                            >
                                <td class="cast-name">{{ s.name }}</td>
                                <td>{{ s.role || '-' }}</td>
                                <td class="admin-email"><code>{{ s.slackMentionId }}</code></td>
                                <td class="staff-aliases">
                                    <span v-for="a in (s.aliases || []).filter(a => a !== s.name)" :key="a" class="alias-chip">{{ a }}</span>
                                    <span v-if="(s.aliases || []).filter(a => a !== s.name).length === 0" class="text-secondary">-</span>
                                </td>
                                <td>
                                    <Tag
                                        :value="s.active === false ? '無効' : '有効'"
                                        :severity="s.active === false ? 'secondary' : 'success'"
                                    />
                                </td>
                                <td>
                                    <div class="action-buttons">
                                        <Button
                                            icon="pi pi-pencil"
                                            size="small"
                                            outlined
                                            v-tooltip.top="'編集'"
                                            @click="openEditStaff(s)"
                                        />
                                        <Button
                                            :icon="s.active === false ? 'pi pi-check-circle' : 'pi pi-ban'"
                                            :severity="s.active === false ? 'success' : 'warning'"
                                            size="small"
                                            outlined
                                            v-tooltip.top="s.active === false ? '有効化' : '無効化'"
                                            @click="handleToggleStaffActive(s)"
                                        />
                                        <Button
                                            icon="pi pi-trash"
                                            severity="danger"
                                            size="small"
                                            outlined
                                            v-tooltip.top="'削除'"
                                            @click="handleRemoveStaff(s)"
                                        />
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
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
    background: var(--p-content-hover-background);
    border-radius: 4px;
}

.variable-hint code {
    background: var(--p-content-border-color);
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
    background: var(--p-content-hover-background);
    border-radius: 8px;
}

.bulk-date-bar span {
    font-weight: 600;
    font-size: 0.875rem;
}

.bulk-date-picker { width: 200px; }
.date-input { width: 160px; }

/* ======== Admin Management ======== */
.admin-add-form {
    background: var(--p-content-hover-background);
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
}

.admin-list-section {
    margin-top: 0.5rem;
}

.admin-section-title {
    font-size: 1rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem 0;
    color: var(--p-text-color);
}

.admin-form-row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
}

.admin-input {
    flex: 2;
    min-width: 200px;
}

.admin-input-name {
    flex: 1;
    min-width: 140px;
}

.admin-email {
    font-family: monospace;
    font-size: 0.875rem;
}

.admin-table .admin-inactive td {
    opacity: 0.5;
}

/* ======== Master Group View ======== */
.view-toggle {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
}

.master-groups {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.master-group {
    border: 1px solid var(--surface-border);
    border-radius: 8px;
    overflow: hidden;
}

.master-group-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--p-content-hover-background);
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
}

.master-group-header:hover {
    background: var(--p-content-hover-background);
}

.master-group-header i {
    font-size: 0.8rem;
    color: var(--text-color-secondary);
    width: 1rem;
}

.master-group-label {
    font-weight: 600;
    font-size: 0.9rem;
}

.grouped-table {
    border-top: 1px solid var(--surface-border);
}

/* ======== Staff Mentions Tab ======== */
.staff-help {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    margin-bottom: 1rem;
    background: var(--p-content-hover-background);
    border-left: 3px solid var(--primary-color);
    border-radius: 6px;
    font-size: 0.85rem;
    line-height: 1.6;
}
.staff-help i { font-size: 1.1rem; color: var(--primary-color); margin-top: 2px; }
.staff-help code {
    background: var(--surface-100);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.85em;
}

.staff-toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
}
.staff-search { flex: 1; min-width: 220px; }
.staff-inactive-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--text-color-secondary);
    cursor: pointer;
}

.staff-form {
    border: 1px solid var(--surface-border);
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    background: var(--surface-50, var(--p-content-hover-background));
}
.staff-form-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem 1rem;
    margin-top: 0.5rem;
}
.staff-form-field { display: flex; flex-direction: column; gap: 0.25rem; }
.staff-form-field label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-color-secondary);
}
.staff-form-field .required { color: var(--red-500); margin-left: 2px; }
.staff-form-full { grid-column: 1 / -1; }
.staff-form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
}

.staff-aliases {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    max-width: 400px;
}
.alias-chip {
    font-size: 0.75rem;
    padding: 0.1rem 0.5rem;
    background: var(--surface-100);
    border-radius: 12px;
    color: var(--text-color-secondary);
}
.text-secondary { color: var(--text-color-secondary); }

@media (max-width: 720px) {
    .staff-form-grid { grid-template-columns: 1fr; }
}
</style>
