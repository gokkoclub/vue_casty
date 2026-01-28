<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import Accordion from 'primevue/accordion'
import AccordionPanel from 'primevue/accordionpanel'
import AccordionHeader from 'primevue/accordionheader'
import AccordionContent from 'primevue/accordioncontent'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import Checkbox from 'primevue/checkbox'
import { useCastings } from '@/composables/useCastings'
import CastingStatusTable from '@/components/casting/CastingStatusTable.vue'
import StatusChangeModal from '@/components/status/StatusChangeModal.vue'
import type { Casting, CastingStatus } from '@/types'

const { 
  loading, 
  fetchCastings, 
  updateCastingStatus, 
  updateCastingCost,
  getCastingById, 
  deleteCasting,
  getHierarchicalCastings 
} = useCastings()

// Current month state
const currentMonth = ref(new Date())

// Tab state: 'normal' or 'special'
const activeTab = ref(0)
const currentTab = computed<'normal' | 'special'>(() => activeTab.value === 0 ? 'normal' : 'special')

// Filter state
const showPast = ref(false)
const orderWaitOnly = ref(false)

// Modal state
const showStatusModal = ref(false)
const selectedCasting = ref<Casting | null>(null)

// Computed hierarchical data
const hierarchicalData = computed(() => {
  return getHierarchicalCastings({
    month: currentMonth.value,
    tab: currentTab.value,
    showPast: showPast.value,
    orderWaitOnly: orderWaitOnly.value
  })
})

// Fetch on mount
onMounted(() => {
  fetchCastings()
})

// Month navigation
const prevMonth = () => {
  const newDate = new Date(currentMonth.value)
  newDate.setMonth(newDate.getMonth() - 1)
  currentMonth.value = newDate
}

const nextMonth = () => {
  const newDate = new Date(currentMonth.value)
  newDate.setMonth(newDate.getMonth() + 1)
  currentMonth.value = newDate
}

// Format month for display
const formattedMonth = computed(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth() + 1
  return `${year}年${month}月`
})

// Format date with weekday
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekday = weekdays[date.getDay()]
  return `${month}/${day}(${weekday})`
}

// Get date header class based on hasOrderWait
const getDateHeaderClass = (hasOrderWait: boolean) => {
  return hasOrderWait ? 'order-wait-header' : ''
}

// Open status change modal
const openStatusModal = (castingId: string) => {
  selectedCasting.value = getCastingById(castingId) || null
  showStatusModal.value = true
}

// Handle status update from modal
const handleModalStatusUpdate = async (castingId: string, newStatus: CastingStatus, extraMessage?: string) => {
  await updateCastingStatus(castingId, newStatus, extraMessage)
  showStatusModal.value = false
}

// Handle inline status update
const handleQuickStatusUpdate = async (castingId: string, newStatus: string) => {
  await updateCastingStatus(castingId, newStatus as CastingStatus)
}

// Handle cost save
const handleSaveCost = async (castingId: string, cost: number) => {
  await updateCastingCost(castingId, cost)
}

// Handle delete
const handleDelete = async (castingId: string) => {
  if (confirm('本当にこのキャスティングを削除しますか？')) {
    await deleteCasting(castingId)
  }
}

// Reload data
const reload = () => {
  fetchCastings()
}
</script>

<template>
  <div class="casting-status-view">
    <div class="header">
      <h1>
        <i class="pi pi-calendar-plus"></i>
        キャスティング状況
      </h1>
      <Button 
        label="再読み込み" 
        icon="pi pi-refresh"
        @click="reload"
        :loading="loading"
      />
    </div>

    <!-- Tabs -->
    <TabView v-model:activeIndex="activeTab" class="status-tabs">
      <TabPanel value="0">
        <template #header>
          <span class="tab-header">
            <i class="pi pi-video"></i>
            通常キャスティング
          </span>
        </template>
      </TabPanel>
      <TabPanel value="1">
        <template #header>
          <span class="tab-header">
            <i class="pi pi-building"></i>
            外部案件・社内イベント
          </span>
        </template>
      </TabPanel>
    </TabView>

    <!-- Controls -->
    <div class="controls">
      <div class="month-nav">
        <Button 
          icon="pi pi-chevron-left" 
          text 
          rounded 
          @click="prevMonth"
        />
        <span class="month-label">{{ formattedMonth }}</span>
        <Button 
          icon="pi pi-chevron-right" 
          text 
          rounded 
          @click="nextMonth"
        />
      </div>

      <div class="filters">
        <div class="filter-item">
          <Checkbox v-model="orderWaitOnly" inputId="orderWaitOnly" binary />
          <label for="orderWaitOnly">オーダー待ちのみ</label>
        </div>
        <div class="filter-item">
          <Checkbox v-model="showPast" inputId="showPast" binary />
          <label for="showPast">過去を表示</label>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <ProgressSpinner />
      <p>キャスティング情報を読み込み中...</p>
    </div>

    <!-- Content -->
    <div v-else-if="hierarchicalData.length > 0" class="casting-timeline">
      <Accordion multiple :activeIndex="[0]">
        <AccordionPanel 
          v-for="dateGroup in hierarchicalData" 
          :key="dateGroup.date"
          :value="dateGroup.date"
        >
          <AccordionHeader :class="getDateHeaderClass(dateGroup.hasOrderWait)">
            <div class="date-header-content">
              <span class="date-text">{{ formatDate(dateGroup.date) }}</span>
              <span v-if="dateGroup.hasOrderWait" class="order-wait-badge">オーダー待ちあり</span>
            </div>
          </AccordionHeader>
          <AccordionContent>
            <div class="date-content">
              <!-- Account Level -->
              <div 
                v-for="accountGroup in dateGroup.accounts" 
                :key="accountGroup.accountName"
                class="account-group"
              >
                <h4 class="account-name">{{ accountGroup.accountName }}</h4>

                <!-- Project Level -->
                <div 
                  v-for="projectGroup in accountGroup.projects"
                  :key="projectGroup.projectName"
                  class="project-group"
                >
                  <CastingStatusTable
                    :castings="projectGroup.castings"
                    :projectName="projectGroup.projectName"
                    :updaters="projectGroup.updaters"
                    @update-status="handleQuickStatusUpdate"
                    @open-modal="openStatusModal"
                    @delete="handleDelete"
                    @save-cost="handleSaveCost"
                  />
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </div>

    <!-- Empty State -->
    <Card v-else class="empty-state">
      <template #content>
        <div class="empty-content">
          <i class="pi pi-inbox"></i>
          <h3>キャスティング情報がありません</h3>
          <p>オーダーを送信すると、ここに表示されます。</p>
        </div>
      </template>
    </Card>

    <!-- Status Change Modal -->
    <StatusChangeModal
      v-model:visible="showStatusModal"
      :casting="selectedCasting"
      @confirm="handleModalStatusUpdate"
    />
  </div>
</template>

<style scoped>
.casting-status-view {
  padding: 1.5rem;
  max-width: 1400px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
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

.status-tabs {
  margin-bottom: 1rem;
}

.tab-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: var(--surface-card);
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.month-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.month-label {
  font-size: 1.125rem;
  font-weight: 600;
  min-width: 120px;
  text-align: center;
}

.filters {
  display: flex;
  gap: 1.5rem;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.filter-item label {
  font-size: 0.875rem;
  cursor: pointer;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  gap: 1rem;
}

.casting-timeline {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.date-header-content {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
}

.date-text {
  font-size: 1.125rem;
  font-weight: 600;
}

.order-wait-badge {
  font-size: 0.75rem;
  background: var(--orange-100);
  color: var(--orange-700);
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-weight: 500;
}

:deep(.order-wait-header) {
  background: var(--orange-50) !important;
}

.date-content {
  padding: 1rem 0;
}

.account-group {
  margin-bottom: 1.5rem;
  padding-left: 1rem;
  border-left: 3px solid var(--primary-200);
}

.account-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--primary-700);
  margin: 0 0 1rem 0;
}

.project-group {
  margin-left: 1rem;
  margin-bottom: 1rem;
}

.empty-state {
  margin-top: 2rem;
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  text-align: center;
}

.empty-content i {
  font-size: 4rem;
  color: var(--text-color-secondary);
  opacity: 0.3;
  margin-bottom: 1rem;
}

.empty-content h3 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
}

.empty-content p {
  color: var(--text-color-secondary);
  margin: 0;
}

@media (max-width: 768px) {
  .controls {
    flex-direction: column;
    gap: 1rem;
  }

  .filters {
    flex-wrap: wrap;
    justify-content: center;
  }
}
</style>
