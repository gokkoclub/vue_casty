<script setup lang="ts">
import { ref, onMounted } from 'vue'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import Button from 'primevue/button'
import Badge from 'primevue/badge'
import ProgressSpinner from 'primevue/progressspinner'
import { useShootingContact } from '@/composables/useShootingContact'
import ShootingContactCard from '@/components/contact/ShootingContactCard.vue'
import type { ShootingContactStatus } from '@/types'

const { 
    loading, 
    contactsByStatus, 
    statusCounts,
    fetchAll 
} = useShootingContact()

// Tab configuration
const tabs: { label: string; status: ShootingContactStatus; icon: string }[] = [
    { label: '香盤連絡待ち', status: '香盤連絡待ち', icon: 'pi-clock' },
    { label: '発注書送信待ち', status: '発注書送信待ち', icon: 'pi-file' },
    { label: 'メイキング共有待ち', status: 'メイキング共有待ち', icon: 'pi-video' },
    { label: '投稿日連絡待ち', status: '投稿日連絡待ち', icon: 'pi-calendar' },
    { label: '完了', status: '完了', icon: 'pi-check-circle' }
]

const activeTab = ref(0)

// Fetch on mount
onMounted(() => {
    fetchAll()
})

// Get badge severity for tab
const getBadgeSeverity = (status: ShootingContactStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' => {
    switch (status) {
        case '香盤連絡待ち': return 'danger'
        case '発注書送信待ち': return 'warning'
        case 'メイキング共有待ち': return 'info'
        case '投稿日連絡待ち': return 'secondary'
        case '完了': return 'success'
        default: return 'secondary'
    }
}
</script>

<template>
    <div class="shooting-contact-view">
        <div class="header">
            <h1>
                <i class="pi pi-phone"></i>
                撮影連絡DB
            </h1>
            <Button
                label="再読み込み"
                icon="pi pi-refresh"
                @click="fetchAll"
                :loading="loading"
            />
        </div>

        <div class="description">
            <p>外部キャストの決定後フローを管理します。</p>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="loading-container">
            <ProgressSpinner />
            <p>データを読み込み中...</p>
        </div>

        <!-- Tabs -->
        <TabView v-else v-model:activeIndex="activeTab">
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
                    <!-- Empty State -->
                    <div 
                        v-if="!contactsByStatus[tab.status] || contactsByStatus[tab.status].length === 0" 
                        class="empty-state"
                    >
                        <i :class="['pi', tab.icon]"></i>
                        <p>{{ tab.label }}のデータはありません</p>
                    </div>

                    <!-- Contact Cards -->
                    <div v-else class="contact-list">
                        <ShootingContactCard
                            v-for="contact in contactsByStatus[tab.status]"
                            :key="contact.id"
                            :contact="contact"
                            @updated="fetchAll"
                        />
                    </div>
                </div>
            </TabPanel>
        </TabView>
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

.header h1 i {
    color: var(--primary-color);
}

.description {
    margin-bottom: 2rem;
    color: var(--text-color-secondary);
}

.description p {
    margin: 0;
}

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

.tab-header i {
    font-size: 1rem;
}

.tab-content {
    padding: 1rem 0;
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

.contact-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}
</style>
