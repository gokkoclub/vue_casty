<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import Checkbox from 'primevue/checkbox'
import { useCastings } from '@/composables/useCastings'
import { useBulkSelection } from '@/composables/useBulkSelection'
import { useLoading } from '@/composables/useLoading'
import CastingStatusList from '@/components/casting/CastingStatusList.vue'
import StatusChangeModal from '@/components/status/StatusChangeModal.vue'
import BulkActionBar from '@/components/status/BulkActionBar.vue'
import BulkStatusModal from '@/components/status/BulkStatusModal.vue'
import SummaryModal from '@/components/common/SummaryModal.vue'
import type { Casting, CastingStatus } from '@/types'

const { 
  loading, 
  fetchCastings, 
  updateCastingStatus, 
  updateCastingCost,
  updateCastingTime,
  getCastingById, 
  deleteCasting,
  getHierarchicalCastings,
  getFeatureGroupedCastings,
  getProjectGroupedCastings
} = useCastings()

const {
  bulkSelectMode,
  selectedCount,
  toggleMode: toggleBulkMode,
  toggleSelect,
  selectAll,
  clearSelection,
  isSelected,
  getSelectedIds
} = useBulkSelection()

const currentMonth = ref(new Date())
const activeTab = ref(0)
type TabType = 'all' | 'shooting' | 'event' | 'feature'
const TAB_MAP: TabType[] = ['all', 'shooting', 'event', 'feature']
const currentTab = computed<TabType>(() => TAB_MAP[activeTab.value] || 'all')

const showPast = ref(false)
const orderWaitOnly = ref(false)
const viewMode = ref<'date' | 'project'>('date')

const showStatusModal = ref(false)
const selectedCasting = ref<Casting | null>(null)
const showBulkStatusModal = ref(false)
const showSummaryModal = ref(false)
const summaryCastings = ref<Casting[]>([])
const summaryProjectName = ref('')

const hierarchicalData = computed(() => {
  if (currentTab.value === 'feature') return [] // Feature tab uses different grouping
  return getHierarchicalCastings({
    month: currentMonth.value,
    tab: currentTab.value,
    showPast: showPast.value,
    orderWaitOnly: orderWaitOnly.value
  })
})

const featureData = computed(() => {
  if (currentTab.value !== 'feature') return []
  return getFeatureGroupedCastings({
    month: currentMonth.value,
    showPast: showPast.value,
    orderWaitOnly: orderWaitOnly.value
  })
})

const projectData = computed(() => {
  if (viewMode.value !== 'project' || currentTab.value === 'feature') return []
  return getProjectGroupedCastings({
    month: currentMonth.value,
    tab: currentTab.value,
    showPast: showPast.value,
    orderWaitOnly: orderWaitOnly.value
  })
})

onMounted(() => {
  fetchCastings()
})

const prevMonth = () => {
  const d = new Date(currentMonth.value)
  d.setMonth(d.getMonth() - 1)
  currentMonth.value = d
}

const nextMonth = () => {
  const d = new Date(currentMonth.value)
  d.setMonth(d.getMonth() + 1)
  currentMonth.value = d
}

const formattedMonth = computed(() => {
  const y = currentMonth.value.getFullYear()
  const m = currentMonth.value.getMonth() + 1
  return `${y}年${m}月`
})

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekday = weekdays[date.getDay()]
  return `${month}/${day}（${weekday}）`
}

const isWeekend = (dateStr: string) => {
  const d = new Date(dateStr).getDay()
  return d === 0 || d === 6
}

const formatDateShort = (dateStr: string) => {
  const date = new Date(dateStr)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

// Check if a cast is scheduled on a specific date
// Uses shootingDates if available, otherwise assumes all dates in range
const isCastOnDate = (casting: Casting, dateStr: string): boolean => {
  if (casting.shootingDates && casting.shootingDates.length > 0) {
    return casting.shootingDates.includes(dateStr)
  }
  // Fallback: if no shootingDates, assume all dates in range
  if (!casting.startDate || !casting.endDate) return false
  const target = new Date(dateStr)
  const start = casting.startDate.toDate()
  const end = casting.endDate.toDate()
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return target >= start && target <= end
}

const openStatusModal = (castingId: string) => {
  selectedCasting.value = getCastingById(castingId) || null
  showStatusModal.value = true
}

const { withLoading } = useLoading()

const handleModalStatusUpdate = async (castingId: string, newStatus: CastingStatus, extraMessage?: string) => {
  await withLoading('ステータスを更新中...', async () => {
    await updateCastingStatus(castingId, newStatus, extraMessage)
  })
  showStatusModal.value = false
}

const handleQuickStatusUpdate = async (castingId: string, newStatus: string) => {
  await withLoading('ステータスを更新中...', async () => {
    await updateCastingStatus(castingId, newStatus as CastingStatus)
  })
}

const handleSaveCost = async (castingId: string, cost: number) => {
  await withLoading('金額を保存中...', async () => {
    await updateCastingCost(castingId, cost)
  })
}

const handleSaveTime = async (castingId: string, startTime: string, endTime: string) => {
  await withLoading('時間を更新中...', async () => {
    await updateCastingTime(castingId, startTime, endTime)
  })
}

const handleDelete = async (castingId: string) => {
  if (confirm('本当にこのキャスティングを削除しますか？')) {
    await withLoading('削除中...', async () => {
      await deleteCasting(castingId)
    })
  }
}

const handleAdditionalOrder = (casting: Casting) => {
  console.log('Additional order for:', casting)
}

const handleOpenSummary = (castings: Casting[]) => {
  summaryCastings.value = castings
  summaryProjectName.value = castings[0]?.projectName || ''
  showSummaryModal.value = true
}

const handleOpenEmail = (casting: Casting) => {
  console.log('Open email for:', casting)
}

const getAllCastingIds = (): string[] => {
  const ids: string[] = []
  hierarchicalData.value.forEach(dateGroup => {
    dateGroup.accounts.forEach(accountGroup => {
      accountGroup.projects.forEach(projectGroup => {
        projectGroup.castings.forEach(casting => {
          ids.push(casting.id)
        })
      })
    })
  })
  return ids
}

const handleSelectAll = () => {
  selectAll(getAllCastingIds())
}

const handleBulkDelete = async () => {
  const count = selectedCount.value
  if (!confirm(`${count}件のキャスティングを削除しますか？`)) return
  await withLoading('一括削除中...', async () => {
    const ids = getSelectedIds()
    for (const id of ids) {
      await deleteCasting(id)
    }
    clearSelection()
    toggleBulkMode()
    await fetchCastings()
  })
}

const handleBulkUpdateStatus = () => {
  showBulkStatusModal.value = true
}

const executeBulkStatusUpdate = async (newStatus: CastingStatus) => {
  await withLoading('一括ステータス更新中...', async () => {
    const ids = getSelectedIds()
    for (const id of ids) {
      await updateCastingStatus(id, newStatus)
    }
    showBulkStatusModal.value = false
    clearSelection()
    toggleBulkMode()
    await fetchCastings()
  })
}

const reload = () => {
  fetchCastings()
}

// Expanded date groups
const expandedDates = ref<Set<string>>(new Set())

const toggleDate = (dateStr: string) => {
  if (expandedDates.value.has(dateStr)) {
    expandedDates.value.delete(dateStr)
  } else {
    expandedDates.value.add(dateStr)
  }
  // Force reactivity
  expandedDates.value = new Set(expandedDates.value)
}

const isDateExpanded = (dateStr: string) => {
  return expandedDates.value.has(dateStr)
}

// Auto-expand first date on data load
const initExpansion = () => {
  if (hierarchicalData.value.length > 0) {
    expandedDates.value = new Set(hierarchicalData.value.map(g => g.date))
  }
}

// Watch for data changes
import { watch } from 'vue'
watch(hierarchicalData, () => {
  if (expandedDates.value.size === 0 && hierarchicalData.value.length > 0) {
    initExpansion()
  }
}, { immediate: true })

// Count castings per date
const countCastings = (dateGroup: any) => {
  let count = 0
  dateGroup.accounts.forEach((a: any) => {
    a.projects.forEach((p: any) => {
      count += p.castings.length
    })
  })
  return count
}
</script>

<template>
  <div class="status-view">
    <!-- Header -->
    <div class="sv-header">
      <div class="sv-header-left">
        <h1>キャスティング状況</h1>
      </div>
      <div class="sv-header-right">
        <Button 
          :label="bulkSelectMode ? '選択中' : '一括選択'"
          :icon="bulkSelectMode ? 'pi pi-check-square' : 'pi pi-th-large'"
          :severity="bulkSelectMode ? 'info' : 'secondary'"
          text
          size="small"
          @click="toggleBulkMode"
        />
        <Button 
          icon="pi pi-refresh"
          severity="secondary"
          text
          size="small"
          @click="reload"
          :loading="loading"
          v-tooltip.bottom="'再読み込み'"
        />
      </div>
    </div>

    <!-- Bulk Action Bar -->
    <BulkActionBar 
      v-if="bulkSelectMode"
      :selected-count="selectedCount"
      @delete="handleBulkDelete"
      @update-status="handleBulkUpdateStatus"
      @select-all="handleSelectAll"
      @clear-selection="clearSelection"
    />

    <!-- Controls Bar -->
    <div class="sv-controls">
      <TabView v-model:activeIndex="activeTab" class="sv-tabs">
        <TabPanel value="0">
          <template #header>
            <span class="sv-tab">📋 全体</span>
          </template>
        </TabPanel>
        <TabPanel value="1">
          <template #header>
            <span class="sv-tab">🎬 撮影</span>
          </template>
        </TabPanel>
        <TabPanel value="2">
          <template #header>
            <span class="sv-tab">🏢 社内イベント・外部案件</span>
          </template>
        </TabPanel>
        <TabPanel value="3">
          <template #header>
            <span class="sv-tab">🏞️ 中長編</span>
          </template>
        </TabPanel>
      </TabView>

      <div class="sv-controls-right">
        <div class="month-nav">
          <button class="nav-btn" @click="prevMonth">
            <i class="pi pi-chevron-left"></i>
          </button>
          <span class="month-label">{{ formattedMonth }}</span>
          <button class="nav-btn" @click="nextMonth">
            <i class="pi pi-chevron-right"></i>
          </button>
        </div>

        <div class="sv-filters">
          <div v-if="currentTab !== 'feature'" class="sv-view-toggle">
            <button 
              class="sv-toggle-btn" 
              :class="{ active: viewMode === 'date' }"
              @click="viewMode = 'date'"
            >
              <i class="pi pi-calendar"></i> 日付
            </button>
            <button 
              class="sv-toggle-btn" 
              :class="{ active: viewMode === 'project' }"
              @click="viewMode = 'project'"
            >
              <i class="pi pi-folder"></i> 作品
            </button>
          </div>
          <label class="filter-check">
            <Checkbox v-model="orderWaitOnly" inputId="ow" binary />
            <span>オーダー待ち</span>
          </label>
          <label class="filter-check">
            <Checkbox v-model="showPast" inputId="sp" binary />
            <span>過去表示</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="sv-loading">
      <ProgressSpinner style="width: 40px; height: 40px" />
      <p>読み込み中...</p>
    </div>

    <!-- Timeline Content (日付ビュー: all/shooting/event tabs) -->
    <div v-else-if="currentTab !== 'feature' && viewMode === 'date' && hierarchicalData.length > 0" class="sv-timeline">
      <div 
        v-for="dateGroup in hierarchicalData" 
        :key="dateGroup.date"
        class="sv-date-group"
      >
        <!-- Date Header -->
        <div 
          class="sv-date-header"
          :class="{ 
            'weekend': isWeekend(dateGroup.date),
            'has-order-wait': dateGroup.hasOrderWait,
            'expanded': isDateExpanded(dateGroup.date)
          }"
          @click="toggleDate(dateGroup.date)"
        >
          <div class="sv-date-left">
            <i 
              class="pi" 
              :class="isDateExpanded(dateGroup.date) ? 'pi-chevron-down' : 'pi-chevron-right'"
            ></i>
            <span class="sv-date-text">{{ formatDate(dateGroup.date) }}</span>
            <span class="sv-date-count">{{ countCastings(dateGroup) }}件</span>
          </div>
          <div class="sv-date-right">
            <span v-if="dateGroup.hasOrderWait" class="sv-owait-badge">
              <i class="pi pi-exclamation-circle"></i> オーダー待ち
            </span>
          </div>
        </div>

        <!-- Date Content -->
        <div v-if="isDateExpanded(dateGroup.date)" class="sv-date-content">
          <div 
            v-for="accountGroup in dateGroup.accounts" 
            :key="accountGroup.accountName"
            class="sv-account"
          >
            <div class="sv-account-header">
              <span class="sv-account-name">{{ accountGroup.accountName }}</span>
            </div>

            <div 
              v-for="projectGroup in accountGroup.projects"
              :key="projectGroup.projectName"
              class="sv-project"
            >
              <CastingStatusList
                :castings="projectGroup.castings"
                :projectName="projectGroup.projectName"
                :updaters="projectGroup.updaters"
                :isExternalTab="currentTab === 'event'"
                :bulkSelectMode="bulkSelectMode"
                :isSelected="isSelected"
                @update-status="handleQuickStatusUpdate"
                @open-modal="openStatusModal"
                @delete="handleDelete"
                @save-cost="handleSaveCost"
                @save-time="handleSaveTime"
                @additional-order="handleAdditionalOrder"
                @open-summary="handleOpenSummary"
                @open-email="handleOpenEmail"
                @toggle-select="toggleSelect"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Project View (作品ビュー: all/shooting/event tabs) -->
    <div v-else-if="currentTab !== 'feature' && viewMode === 'project' && projectData.length > 0" class="sv-timeline">
      <div 
        v-for="pGroup in projectData" 
        :key="pGroup.projectName + pGroup.accountName"
        class="sv-date-group"
      >
        <!-- Project Header -->
        <div 
          class="sv-date-header project-view-header"
          :class="{ 'has-order-wait': pGroup.hasOrderWait, 'expanded': isDateExpanded(pGroup.projectName) }"
          @click="toggleDate(pGroup.projectName)"
        >
          <div class="sv-date-left">
            <i 
              class="pi" 
              :class="isDateExpanded(pGroup.projectName) ? 'pi-chevron-down' : 'pi-chevron-right'"
            ></i>
            <span class="sv-project-icon">📁</span>
            <span class="sv-date-text">{{ pGroup.projectName }}</span>
            <span class="sv-account-badge">{{ pGroup.accountName }}</span>
            <span class="sv-date-count">{{ pGroup.totalCastings }}件</span>
          </div>
          <div class="sv-date-right">
            <span v-if="pGroup.hasOrderWait" class="sv-owait-badge">
              <i class="pi pi-exclamation-circle"></i> オーダー待ち
            </span>
            <span class="sv-project-dates-label">{{ pGroup.dates.length }}日</span>
          </div>
        </div>

        <!-- Project Content: grouped by date -->
        <div v-if="isDateExpanded(pGroup.projectName)" class="sv-date-content">
          <div 
            v-for="dateStr in pGroup.dates" 
            :key="dateStr"
            class="sv-project-date-section"
          >
            <div class="sv-project-date-label" :class="{ 'weekend': isWeekend(dateStr) }">
              {{ formatDate(dateStr) }}
            </div>
            <CastingStatusList
              :castings="Array.from(pGroup.castingsByDate.get(dateStr) || [])"
              :projectName="pGroup.projectName"
              :updaters="[]"
              :isExternalTab="currentTab === 'event'"
              :bulkSelectMode="bulkSelectMode"
              :isSelected="isSelected"
              @update-status="handleQuickStatusUpdate"
              @open-modal="openStatusModal"
              @delete="handleDelete"
              @save-cost="handleSaveCost"
              @save-time="handleSaveTime"
              @additional-order="handleAdditionalOrder"
              @open-summary="handleOpenSummary"
              @open-email="handleOpenEmail"
              @toggle-select="toggleSelect"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Feature Film Content (中長編タブ) -->
    <div v-else-if="currentTab === 'feature' && featureData.length > 0" class="sv-timeline">
      <div 
        v-for="featureGroup in featureData" 
        :key="featureGroup.projectName + featureGroup.startDate"
        class="sv-date-group"
      >
        <!-- Project Header -->
        <div 
          class="sv-date-header feature-header expanded"
          @click="toggleDate(featureGroup.projectName)"
        >
          <div class="sv-date-left">
            <i 
              class="pi" 
              :class="isDateExpanded(featureGroup.projectName) ? 'pi-chevron-down' : 'pi-chevron-right'"
            ></i>
            <span class="sv-date-text">🏞️ {{ featureGroup.projectName }}</span>
            <span class="sv-feature-dates">{{ featureGroup.dateRange }}</span>
            <span class="sv-date-count">{{ featureGroup.castings.length }}件</span>
          </div>
          <div class="sv-date-right">
            <span class="sv-account-badge">{{ featureGroup.accountName }}</span>
          </div>
        </div>

        <!-- Feature Cast List -->
        <div v-if="isDateExpanded(featureGroup.projectName)" class="sv-date-content">
          <div class="sv-feature-schedule">
            <!-- Date headers -->
            <div class="sv-feature-date-row">
              <div class="sv-feature-cast-cell sv-feature-label">キャスト</div>
              <div class="sv-feature-cast-cell sv-feature-label">ステータス</div>
              <div 
                v-for="dateStr in featureGroup.allDates" 
                :key="dateStr" 
                class="sv-feature-date-cell"
                :class="{ 'weekend': isWeekend(dateStr) }"
              >
                {{ formatDateShort(dateStr) }}
              </div>
            </div>

            <!-- Cast rows -->
            <div 
              v-for="casting in featureGroup.castings" 
              :key="casting.id" 
              class="sv-feature-cast-row"
              @click="openStatusModal(casting.id)"
            >
              <div class="sv-feature-cast-cell sv-feature-cast-name">
                {{ casting.castName }}
              </div>
              <div class="sv-feature-cast-cell">
                <span 
                  class="sv-status-badge" 
                  :class="'status-' + casting.status"
                >
                  {{ casting.status }}
                </span>
              </div>
              <div 
                v-for="dateStr in featureGroup.allDates" 
                :key="dateStr" 
                class="sv-feature-date-cell"
              >
                <span v-if="isCastOnDate(casting, dateStr)" class="sv-date-check">✅</span>
                <span v-else class="sv-date-dash">—</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="sv-empty">
      <i class="pi pi-inbox"></i>
      <h3>キャスティング情報がありません</h3>
      <p>オーダーを送信すると、ここに表示されます。</p>
    </div>

    <!-- Modals -->
    <StatusChangeModal
      v-model:visible="showStatusModal"
      :casting="selectedCasting"
      @confirm="handleModalStatusUpdate"
    />

    <SummaryModal
      v-model:visible="showSummaryModal"
      :castings="summaryCastings"
      :projectName="summaryProjectName"
    />

    <BulkStatusModal
      v-model:visible="showBulkStatusModal"
      :selectedCount="selectedCount"
      @confirm="executeBulkStatusUpdate"
    />
  </div>
</template>

<style scoped>
.status-view {
  padding: 1.5rem 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

/* ===== Header ===== */
.sv-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.sv-header h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: var(--p-text-color);
}

.sv-header-right {
  display: flex;
  gap: 0.25rem;
}

/* ===== Controls ===== */
.sv-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--p-surface-200);
}

.sv-tabs {
  flex-shrink: 0;
}

.sv-tabs :deep(.p-tabview-panels) {
  display: none;
}

.sv-tabs :deep(.p-tabview-nav) {
  border: none;
  background: transparent;
}

.sv-tab {
  font-size: 0.875rem;
  font-weight: 500;
}

.sv-controls-right {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.month-nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.nav-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  color: var(--p-text-color);
  transition: background 0.15s;
}

.nav-btn:hover {
  background: var(--p-surface-100);
}

.month-label {
  font-size: 0.95rem;
  font-weight: 600;
  min-width: 100px;
  text-align: center;
}

.sv-filters {
  display: flex;
  gap: 1rem;
}

.filter-check {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  color: var(--p-text-muted-color);
}

/* ===== Loading ===== */
.sv-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4rem;
  gap: 1rem;
  color: var(--p-text-muted-color);
}

/* ===== Timeline ===== */
.sv-timeline {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sv-date-group {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--p-surface-200);
  background: white;
}

/* Date Header */
.sv-date-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background 0.15s;
  background: var(--p-surface-50);
  user-select: none;
}

.sv-date-header:hover {
  background: var(--p-surface-100);
}

.sv-date-header.weekend {
  background: #FEF2F2;
}

.sv-date-header.weekend:hover {
  background: #FEE2E2;
}

.sv-date-header.has-order-wait {
  background: #FFFBEB;
}

.sv-date-header.has-order-wait:hover {
  background: #FEF3C7;
}

.sv-date-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.sv-date-left .pi {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  transition: transform 0.2s;
}

.sv-date-text {
  font-size: 1rem;
  font-weight: 700;
  color: var(--p-text-color);
}

.sv-date-count {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  background: var(--p-surface-200);
  padding: 0.1rem 0.5rem;
  border-radius: 10px;
}

.sv-owait-badge {
  font-size: 0.7rem;
  color: #D97706;
  background: #FEF3C7;
  padding: 0.2rem 0.6rem;
  border-radius: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

/* Date Content */
.sv-date-content {
  padding: 0.5rem 0;
}

.sv-account {
  padding: 0 1rem;
}

.sv-account-header {
  padding: 0.5rem 0.5rem;
  margin-bottom: 0.25rem;
}

.sv-account-name {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--p-primary-600);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sv-project {
  margin-bottom: 0.5rem;
}

/* ===== Empty ===== */
.sv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5rem 2rem;
  text-align: center;
  color: var(--p-text-muted-color);
}

.sv-empty i {
  font-size: 3rem;
  opacity: 0.3;
  margin-bottom: 1rem;
}

.sv-empty h3 {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
}

.sv-empty p {
  margin: 0;
}
/* ===== View Toggle ===== */
.sv-view-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
  overflow: hidden;
}

.sv-toggle-btn {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.7rem;
  font-size: 0.8rem;
  border: none;
  background: var(--p-surface-0);
  color: var(--p-text-muted-color);
  cursor: pointer;
  transition: all 0.15s;
}

.sv-toggle-btn.active {
  background: var(--p-primary-500, #6366f1);
  color: white;
}

.sv-toggle-btn:hover:not(.active) {
  background: var(--p-surface-100);
}

/* ===== Project View ===== */
.project-view-header {
  background: linear-gradient(135deg, var(--p-surface-50), var(--p-surface-0)) !important;
  border-left: 3px solid var(--p-orange-400, #fb923c);
}

.sv-project-icon {
  font-size: 1rem;
  margin-right: 0.25rem;
}

.sv-project-dates-label {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  background: var(--p-surface-100);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
}

.sv-project-date-section {
  margin-bottom: 0.5rem;
}

.sv-project-date-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  padding: 0.35rem 0.75rem;
  background: var(--p-surface-50);
  border-left: 2px solid var(--p-surface-300);
  margin-bottom: 0.25rem;
}

.sv-project-date-label.weekend {
  color: var(--p-red-500);
  border-left-color: var(--p-red-300);
}


@media (max-width: 768px) {
  .sv-controls {
    flex-direction: column;
    align-items: flex-start;
  }

  .sv-controls-right {
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
  }

  .sv-filters {
    flex-wrap: wrap;
  }
}

/* ===== Feature Film (中長編) ===== */
.feature-header {
  background: linear-gradient(135deg, var(--p-surface-50), var(--p-primary-50, #e8f0fe)) !important;
  border-left: 3px solid var(--p-primary-400, #6366f1);
}

.sv-feature-dates {
  font-size: 0.8rem;
  color: var(--p-primary-600, #4f46e5);
  background: var(--p-primary-50, #eef2ff);
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  margin-left: 0.5rem;
  font-weight: 500;
}

.sv-account-badge {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  background: var(--p-surface-100);
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
}

.sv-feature-schedule {
  overflow-x: auto;
  padding: 0.5rem 0;
}

.sv-feature-date-row,
.sv-feature-cast-row {
  display: flex;
  align-items: center;
  min-height: 36px;
  gap: 0;
}

.sv-feature-date-row {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  border-bottom: 2px solid var(--p-surface-200);
  position: sticky;
  top: 0;
  background: var(--p-surface-0);
  z-index: 1;
}

.sv-feature-cast-row {
  border-bottom: 1px solid var(--p-surface-100);
  cursor: pointer;
  transition: background 0.15s;
}

.sv-feature-cast-row:hover {
  background: var(--p-surface-50);
}

.sv-feature-cast-row:nth-child(even) {
  background: var(--p-surface-0);
}

.sv-feature-cast-cell {
  min-width: 120px;
  max-width: 120px;
  padding: 0.4rem 0.75rem;
  flex-shrink: 0;
}

.sv-feature-label {
  font-weight: 600;
}

.sv-feature-cast-name {
  font-weight: 500;
  color: var(--p-text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sv-feature-date-cell {
  min-width: 48px;
  max-width: 48px;
  text-align: center;
  padding: 0.4rem 0.25rem;
  flex-shrink: 0;
  font-size: 0.75rem;
}

.sv-feature-date-cell.weekend {
  background: var(--p-red-50, #fef2f2);
  color: var(--p-red-500);
}

.sv-date-check {
  font-size: 0.85rem;
}

.sv-date-dash {
  color: var(--p-surface-300);
  font-size: 0.85rem;
}

.sv-status-badge {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
}

.sv-status-badge.status-仮押さえ {
  background: var(--p-yellow-100, #fef3c7);
  color: var(--p-yellow-700, #a16207);
}

.sv-status-badge.status-OK {
  background: var(--p-green-100, #dcfce7);
  color: var(--p-green-700, #15803d);
}

.sv-status-badge.status-NG {
  background: var(--p-red-100, #fee2e2);
  color: var(--p-red-700, #b91c1c);
}

.sv-status-badge.status-決定 {
  background: var(--p-blue-100, #dbeafe);
  color: var(--p-blue-700, #1d4ed8);
}

.sv-status-badge.status-キャンセル {
  background: var(--p-surface-200);
  color: var(--p-text-muted-color);
}
</style>
