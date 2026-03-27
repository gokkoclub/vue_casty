<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import Button from 'primevue/button'
import Badge from 'primevue/badge'
import Dialog from 'primevue/dialog'
import ProgressSpinner from 'primevue/progressspinner'
import { useShootingContact } from '@/composables/useShootingContact'
import ShootingContactTable from '@/components/contact/ShootingContactTable.vue'
import OrderPdfModal from '@/components/common/OrderPdfModal.vue'
import MailModalContent from '@/components/contact/MailModalContent.vue'
import type { ShootingContact, ShootingContactStatus } from '@/types'

const {
    loading, syncing,
    contactsByStatus, statusCounts,
    fetchAll, getDateGrouped, getProjectGrouped,
    updateContact, advanceStatus, revertStatus,
    deleteContacts,
    syncSchedule, syncMaking
} = useShootingContact()

type TabDef = { label: string; status: ShootingContactStatus; icon: string; syncLabel?: string }

const tabs: TabDef[] = [
    { label: '香盤連絡待ち', status: '香盤連絡待ち', icon: 'pi-clock', syncLabel: '🔄 香盤DB同期' },
    { label: '発注書送信待ち', status: '発注書送信待ち', icon: 'pi-file' },
    { label: 'メイキング共有待ち', status: 'メイキング共有待ち', icon: 'pi-video', syncLabel: '🎬 メイキング同期' },
    { label: '投稿日連絡待ち', status: '投稿日連絡待ち', icon: 'pi-calendar' },
    { label: '完了', status: '完了', icon: 'pi-check-circle' }
]

const activeTab = ref(0)
const viewMode = ref<'date' | 'project'>('date')
const expandedDates = ref<Set<string>>(new Set())

const currentStatus = computed<ShootingContactStatus>(() => tabs[activeTab.value]?.status || '香盤連絡待ち')

// Date-grouped data for current tab
const dateGroups = computed(() => getDateGrouped(currentStatus.value))
const projectGroups = computed(() => getProjectGrouped(currentStatus.value))

onMounted(() => { fetchAll() })

function getBadgeSeverity(status: ShootingContactStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    switch (status) {
        case '香盤連絡待ち': return 'danger'
        case '発注書送信待ち': return 'warning'
        case 'メイキング共有待ち': return 'info'
        case '投稿日連絡待ち': return 'secondary'
        case '完了': return 'success'
        default: return 'secondary'
    }
}

function toggleDate(dateStr: string) {
    if (expandedDates.value.has(dateStr)) {
        expandedDates.value.delete(dateStr)
    } else {
        expandedDates.value.add(dateStr)
    }
}

function isDateExpanded(dateStr: string): boolean {
    return expandedDates.value.has(dateStr)
}

function formatDateHeader(dateStr: string): string {
    if (dateStr === '日付未定') return '📅 日付未定'
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return `📅 ${dateStr}`
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    return `📅 ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`
}

function countContacts(dateGroup: { projects: { contacts: ShootingContact[] }[] }): number {
    return dateGroup.projects.reduce((sum, p) => sum + p.contacts.length, 0)
}

// Auto-expand first date group
watch(dateGroups, (groups) => {
    if (expandedDates.value.size === 0 && groups.length > 0) {
        expandedDates.value.add(groups[0]!.dateStr)
    }
}, { immediate: true })

// Tab change resets expansion
watch(activeTab, () => { expandedDates.value.clear() })

// -- Save handler
async function handleSave(id: string, data: Partial<ShootingContact>) {
    await updateContact(id, data)
}

// -- Advance status handler
async function handleAdvance(id: string) {
    await advanceStatus(id)
}

// -- Revert status handler
async function handleRevert(id: string) {
    await revertStatus(id)
}

// -- Sync handler
async function handleSync() {
    const status = currentStatus.value
    if (status === '香盤連絡待ち') {
        await syncSchedule()
    } else if (status === 'メイキング共有待ち') {
        await syncMaking()
    }
}

// -- Mail modal
const showMailModal = ref(false)
const selectedContact = ref<ShootingContact | null>(null)

function openMail(contact: ShootingContact) {
    selectedContact.value = contact
    showMailModal.value = true
}

// -- PDF modal
const showPdfModal = ref(false)
const selectedPdfContact = ref<ShootingContact | null>(null)

function openPdf(contact: ShootingContact) {
    selectedPdfContact.value = contact
    showPdfModal.value = true
}

// -- Selection / Bulk Delete
const selectedIds = ref<string[]>([])
const showDeleteConfirm = ref(false)

function handleSelectionChange(ids: string[]) {
    selectedIds.value = ids
}

async function handleBulkDelete() {
    if (selectedIds.value.length === 0) return
    await deleteContacts(selectedIds.value)
    selectedIds.value = []
    showDeleteConfirm.value = false
}
</script>

<template>
    <div class="shooting-contact-view">
        <div class="header">
            <h1>
                <i class="pi pi-phone"></i>
                撮影連絡DB
            </h1>
            <div class="header-actions">
                <div class="view-toggle">
                    <Button
                        :icon="viewMode === 'date' ? 'pi pi-calendar' : 'pi pi-folder'"
                        :label="viewMode === 'date' ? '日付表示' : '作品表示'"
                        size="small"
                        severity="secondary"
                        outlined
                        @click="viewMode = viewMode === 'date' ? 'project' : 'date'"
                    />
                </div>
                <Button
                    label="再読み込み"
                    icon="pi pi-refresh"
                    size="small"
                    @click="fetchAll"
                    :loading="loading"
                />
            </div>
        </div>

        <div class="description">
            <p>外部キャストの決定後フローを管理します。</p>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="loading-container">
            <ProgressSpinner />
            <p>データを読み込み中...</p>
        </div>

        <!-- Selection Action Bar -->
        <div v-if="selectedIds.length > 0" class="selection-bar">
            <span>✅ {{ selectedIds.length }}件選択中</span>
            <Button
                label="削除"
                icon="pi pi-trash"
                size="small"
                severity="danger"
                @click="showDeleteConfirm = true"
            />
            <Button
                label="選択解除"
                icon="pi pi-times"
                size="small"
                severity="secondary"
                outlined
                @click="selectedIds = []"
            />
        </div>

        <!-- Tabs -->
        <TabView v-else-if="!loading" v-model:activeIndex="activeTab">
            <TabPanel
                v-for="(tab, index) in tabs"
                :key="tab.status"
                :value="index"
            >
                <template #header>
                    <div class="tab-header">
                        <i :class="['pi', tab.icon]"></i>
                        <span>{{ tab.label }}</span>
                        <Badge
                            v-if="statusCounts[tab.status] > 0"
                            :value="statusCounts[tab.status]"
                            :severity="getBadgeSeverity(tab.status)"
                        />
                    </div>
                </template>

                <div class="tab-content">
                    <!-- Sync button -->
                    <div v-if="tab.syncLabel" class="sync-bar">
                        <Button
                            :label="tab.syncLabel"
                            icon="pi pi-sync"
                            size="small"
                            severity="secondary"
                            outlined
                            :loading="syncing"
                            @click="handleSync"
                        />
                    </div>

                    <!-- Empty -->
                    <div
                        v-if="!contactsByStatus[tab.status] || contactsByStatus[tab.status].length === 0"
                        class="empty-state"
                    >
                        <i :class="['pi', tab.icon]"></i>
                        <p>{{ tab.label }}のデータはありません</p>
                    </div>

                    <!-- Date View -->
                    <template v-else-if="viewMode === 'date'">
                        <div class="date-groups">
                            <div
                                v-for="dg in dateGroups"
                                :key="dg.dateStr"
                                class="date-group"
                            >
                                <div
                                    class="date-header"
                                    @click="toggleDate(dg.dateStr)"
                                >
                                    <i :class="['pi', isDateExpanded(dg.dateStr) ? 'pi-chevron-down' : 'pi-chevron-right']"></i>
                                    <span class="date-label">{{ formatDateHeader(dg.dateStr) }}</span>
                                    <Badge :value="countContacts(dg)" severity="secondary" />
                                </div>

                                <div v-if="isDateExpanded(dg.dateStr)" class="date-content">
                                    <div
                                        v-for="pg in dg.projects"
                                        :key="`${pg.accountName}_${pg.projectName}`"
                                        class="project-section"
                                    >
                                        <div class="project-header">
                                            <span class="account-name">🏢 {{ pg.accountName }}</span>
                                            <span class="separator">/</span>
                                            <span class="project-name-label">🎬 {{ pg.projectName }}</span>
                                            <Badge :value="pg.contacts.length" severity="info" class="count-badge" />
                                        </div>
                                        <ShootingContactTable
                                            :contacts="pg.contacts"
                                            :status="tab.status"
                                            @save="handleSave"
                                            @advance-status="handleAdvance"
                                            @revert-status="handleRevert"
                                            @open-mail="openMail"
                                            @open-pdf="openPdf"
                                            @selection-change="handleSelectionChange"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </template>

                    <!-- Project View -->
                    <template v-else>
                        <div class="project-groups">
                            <div
                                v-for="pg in projectGroups"
                                :key="`${pg.accountName}_${pg.projectName}`"
                                class="project-section"
                            >
                                <div class="project-header">
                                    <span class="account-name">🏢 {{ pg.accountName }}</span>
                                    <span class="separator">/</span>
                                    <span class="project-name-label">🎬 {{ pg.projectName }}</span>
                                    <Badge :value="pg.contacts.length" severity="info" class="count-badge" />
                                </div>
                                <ShootingContactTable
                                    :contacts="pg.contacts"
                                    :status="tab.status"
                                    @save="handleSave"
                                    @advance-status="handleAdvance"
                                    @revert-status="handleRevert"
                                    @open-mail="openMail"
                                    @open-pdf="openPdf"
                                    @selection-change="handleSelectionChange"
                                />
                            </div>
                        </div>
                    </template>
                </div>
            </TabPanel>
        </TabView>

        <!-- Mail Modal (inline simple version) -->
        <Teleport to="body">
            <div v-if="showMailModal && selectedContact" class="mail-modal-overlay" @click.self="showMailModal = false">
                <MailModalContent
                    :contact="selectedContact"
                    :status="currentStatus"
                    @close="showMailModal = false"
                    @advance="(id: string) => { advanceStatus(id); showMailModal = false }"
                />
            </div>
        </Teleport>

        <!-- PDF Modal -->
        <OrderPdfModal
            :visible="showPdfModal"
            :contact="selectedPdfContact"
            @update:visible="showPdfModal = $event"
        />

        <!-- Delete Confirmation Dialog -->
        <Dialog
            :visible="showDeleteConfirm"
            @update:visible="showDeleteConfirm = $event"
            modal
            header="削除の確認"
            :style="{ width: '400px' }"
        >
            <p style="margin: 0; text-align: center; font-size: 1rem;">
                <strong>{{ selectedIds.length }}件</strong>のデータを削除します。<br>
                この操作は元に戻せません。
            </p>
            <template #footer>
                <Button label="キャンセル" severity="secondary" outlined @click="showDeleteConfirm = false" />
                <Button label="削除する" severity="danger" icon="pi pi-trash" @click="handleBulkDelete" />
            </template>
        </Dialog>
    </div>
</template>



<style scoped>
.shooting-contact-view {
    padding: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}

.header h1 {
    font-size: 1.75rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0;
}

.header h1 i { color: var(--primary-color); }

.header-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
}

.description {
    margin-bottom: 1.5rem;
    color: var(--text-color-secondary);
}
.description p { margin: 0; }

.loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    gap: 1rem;
}

.tab-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.tab-content {
    padding: 1rem 0;
}

.sync-bar {
    margin-bottom: 1rem;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    text-align: center;
    color: var(--text-color-secondary);
}
.empty-state i {
    font-size: 3rem;
    opacity: 0.3;
    margin-bottom: 1rem;
}

/* Date/Project grouping */
.date-group {
    margin-bottom: 0.5rem;
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    overflow: hidden;
}

.date-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: var(--p-content-hover-background);
    cursor: pointer;
    user-select: none;
    transition: background 0.2s;
}
.date-header:hover { background: var(--p-content-hover-background); }

.date-label {
    font-weight: 600;
    font-size: 1rem;
}

.date-content {
    padding: 0.5rem;
}

.project-section {
    margin-bottom: 1rem;
}

.project-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--surface-ground);
    border-radius: 6px;
    margin-bottom: 0.5rem;
}

.account-name {
    font-weight: 500;
    font-size: 0.9rem;
}

.separator {
    color: var(--text-color-secondary);
}

.project-name-label {
    font-weight: 600;
    font-size: 0.9rem;
}

.count-badge {
    margin-left: auto;
}

.project-groups .project-section {
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
}

.selection-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1.25rem;
    background: rgba(59, 130, 246, 0.08);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 8px;
    margin-bottom: 1rem;
    font-weight: 600;
    font-size: 0.9rem;
    position: sticky;
    top: 0;
    z-index: 10;
}
</style>

<!-- Non-scoped: Teleport先のモーダルに適用するため scoped 外に配置 -->
<style>
.mail-modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
}
</style>
