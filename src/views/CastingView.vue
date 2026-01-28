<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'
import ProgressSpinner from 'primevue/progressspinner'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import CastCard from '@/components/cast/CastCard.vue'
import CastDetailDialog from '@/components/cast/CastDetailDialog.vue'
import DateSelector from '@/components/calendar/DateSelector.vue'
import CartSidebar from '@/components/cart/CartSidebar.vue'
import ShootingList from '@/components/shooting/ShootingList.vue'
import OrderTypeDialog from '@/components/casting/OrderTypeDialog.vue'
import { useCasts } from '@/composables/useCasts'
import { useOrderStore } from '@/stores/orderStore'
import { useAvailability } from '@/composables/useAvailability'
import { useShootings } from '@/composables/useShootings'
import { useOrders } from '@/composables/useOrders'
import { getCastBookings, isBookingBlocked } from '@/utils/castStatusUtils'
import type { Cast, Shooting } from '@/types'
import { useToast } from 'primevue/usetoast'

const toast = useToast()
const { casts, loading, fetchAll, isFirebaseConfigured } = useCasts()
const { shootings, loading: shootingsLoading, fetchShootingsByDates } = useShootings()
const { activeCastings, fetchAvailability } = useAvailability()
const store = useOrderStore()

// フィルター
const searchQuery = ref('')
const selectedType = ref<'all' | '内部' | '外部'>('all')
const typeOptions = [
  { label: '全て', value: 'all' },
  { label: '内部', value: '内部' },
  { label: '外部', value: '外部' }
]

// View Mode
const viewMode = ref<'grid' | 'list'>('grid')

// Date Select
const selectedDates = ref<Date[]>([])
const selectedShooting = ref<Shooting | null>(null)

// UI State
const showOrderTypeDialog = ref(false)
const selectedCast = ref<Cast | null>(null)
const showDetailDialog = ref(false)

// Date update handler
const handleDatesUpdate = (dates: Date[]) => {
  selectedDates.value = dates
}

// Workflow Logic

watch(selectedDates, async (dates) => {
  // Update store dates formatting
  const formatted = dates.map(d => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}/${month}/${day}`
  }).sort()
  
  if (store.context) {
    store.context.dateRanges = formatted
  }

  // Fetch shooting candidates and availability
  if (dates.length > 0) {
    await Promise.all([
      fetchShootingsByDates(dates),
      fetchAvailability(dates)
    ])
  }
})

const handleShootingSelect = (shooting: Shooting) => {
  // Toggle logic: if already selected, deselect
  if (selectedShooting.value?.id === shooting.id) {
    selectedShooting.value = null // Deselect
    toast.add({ severity: 'info', summary: '選択解除', detail: shooting.title, life: 1500 })
  } else {
    selectedShooting.value = shooting // Select new shooting
    toast.add({ severity: 'success', summary: '撮影案件を選択', detail: shooting.title, life: 2000 })
  }
}

// Watch for shooting selection changes
watch(selectedShooting, (newShooting, oldShooting) => {
  if (!newShooting && oldShooting) {
    // Shooting deselected - clear shooting mode but keep dates
    store.setContext({
      mode: null,
      shootingData: null,
      dateRanges: store.context.dateRanges
    })
    // Clear projects when deselecting shooting
    store.projects = []
  } else if (newShooting && oldShooting && newShooting.id !== oldShooting.id) {
    // Different shooting selected - update with new data
    store.setContext({
      mode: 'shooting',
      shootingData: newShooting,
      dateRanges: store.context.dateRanges
    })
    // Reset projects for new shooting
    store.projects = []
    store.createProject({
      title: newShooting.title,
      roles: []
    })
  } else if (newShooting && !oldShooting) {
    // New shooting selected from null
    store.setContext({
      mode: 'shooting',
      shootingData: newShooting,
      dateRanges: store.context.dateRanges
    })
    // Initialize projects for shooting mode
    if (store.projects.length === 0) {
      store.createProject({
        title: newShooting.title,
        roles: []
      })
    }
  }
})

const handleCreateNewOrder = () => {
  showOrderTypeDialog.value = true
}

const handleOrderTypeSelect = (mode: 'external' | 'internal' | 'cancel') => {
  if (mode === 'cancel') {
    return
  }
  
  store.setContext({
    mode: mode,
    dateRanges: store.context.dateRanges
  })
  showOrderTypeDialog.value = false
  toast.add({ severity: 'info', summary: '新規オーダー作成', detail: '案件情報を入力してください', life: 2000 })
}

// Cast Selection
const filteredCasts = computed(() => {
  return casts.value.filter(cast => {
    const matchesSearch = !searchQuery.value || 
      cast.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      cast.agency?.toLowerCase().includes(searchQuery.value.toLowerCase())
    const matchesType = selectedType.value === 'all' || cast.castType === selectedType.value
    return matchesSearch && matchesType
  })
})

const handleCastClick = (cast: Cast) => {
  selectedCast.value = cast
  showDetailDialog.value = true
}

const handleAddToCart = (cast: Cast) => {
  if (selectedDates.value.length === 0) {
    toast.add({ severity: 'warn', summary: '手順エラー', detail: '先にカレンダーで日程と案件を選択してください', life: 3000 })
    return
  }
  
  store.addItem(cast)
  // No longer auto-opening cart
  toast.add({ severity: 'success', summary: 'カートに追加', detail: cast.name, life: 2000 })
}

// Order submission with progress
const { submitOrder } = useOrders()

const handleSubmitOrder = async (pdfFile?: File | null) => {
  const success = await submitOrder(pdfFile ?? undefined)
  
  if (success) {
    // Use nextTick to avoid recursive updates
    await nextTick()
    store.cartVisible = false
    // Don't clear selectedDates here - let user manually deselect if needed
  }
}

// Cart opening logic: check if shooting selected, else show dialog
const handleOpenCart = () => {
  if (selectedDates.value.length === 0) {
    // No dates selected
    toast.add({ severity: 'warn', summary: '手順エラー', detail: '先にカレンダーで日程を選択してください', life: 3000 })
    return
  }

  // Check if mode is set
  if (!store.context.mode) {
    // No mode selected, show order type selection dialog
    showOrderTypeDialog.value = true
    return
  }
  
  // Mode is set, open cart
  store.cartVisible = true
}


// Lifecycle
let unsubscribe: (() => void) | null = null

onMounted(() => {
  if (isFirebaseConfigured) {
    unsubscribe = fetchAll()
  }
})

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
  }
})
</script>

<template>
  <div class="casting-view">
    <div class="page-header">
      <div class="header-left">
        <h1>キャストを探す</h1>
        <p class="subtitle" v-if="isFirebaseConfigured">
          {{ filteredCasts.length }} 件のキャストが見つかりました
        </p>
      </div>
      <div class="header-right">
        <Button 
          :label="`カート (${store.count})`"
          icon="pi pi-shopping-cart"
          :badge="store.count > 0 ? String(store.count) : undefined"
          :severity="selectedDates.length > 0 ? 'primary' : 'secondary'"
          @click="handleOpenCart"
        />
      </div>
    </div>

    <!-- Firebase未設定の警告 -->
    <Card v-if="!isFirebaseConfigured" class="warning-card">
      <template #content>
        <div class="warning-content">
          <i class="pi pi-exclamation-triangle"></i>
          <p>Firebaseが設定されていません。.env.localファイルを確認してください。</p>
        </div>
      </template>
    </Card>

    <template v-else>
      <div class="grid-layout">
        <!-- Sidebar Column (Date & Shooting) -->
        <div class="sidebar-column">
          <!-- 1. 日付選択 -->
          <Card class="mb-3 date-card">
            <template #title>
              <div class="step-title">
                <span class="step-num">1</span>
                <span>日付を選択</span>
              </div>
            </template>
            <template #content>
              <DateSelector 
                :dates="selectedDates"
                @update:dates="handleDatesUpdate" 
              />
            </template>
          </Card>

          <!-- 2. 案件選択 -->
          <Card class="shooting-card" :class="{ 'disabled-card': selectedDates.length === 0 }">
            <template #title>
              <div class="step-title">
                <span class="step-num">2</span>
                <span>案件を選択</span>
              </div>
            </template>
            <template #content>
              <div v-if="selectedDates.length === 0" class="placeholder-text">
                <i class="pi pi-calendar mb-2"></i>
                <p>撮影日を選択してください</p>
              </div>
              <ShootingList 
                v-else 
                :shootings="shootings" 
                :loading="shootingsLoading"
                :selectedId="store.context.shootingData?.id"
                @select="handleShootingSelect"
                @create-new="handleCreateNewOrder"
              />

              <!-- 選択中のコンテキスト表示 -->
              <div v-if="store.context.mode" class="current-context mt-3">
                <Tag 
                  icon="pi pi-check" 
                  severity="success" 
                  value="選択中"
                />
                <div class="context-info">
                  <span class="font-bold">{{ store.displayProjectName || '新規案件' }}</span>
                  <span class="text-sm text-gray-500">{{ store.displayAccountName }}</span>
                </div>
              </div>
            </template>
          </Card>
        </div>
        
        <!-- Main Column (Cast List) -->
        <div class="main-column">
          <Card class="cast-container-card" :class="{ 'disabled-card': selectedDates.length === 0 }">
            <template #title>
              <div class="step-title flex justify-between items-center">
                <div class="flex items-center gap-2">
                  <span class="step-num">3</span>
                  <span>キャストを選択</span>
                </div>
                
                <div class="view-toggle">
                  <Button 
                    icon="pi pi-th-large" 
                    text 
                    :severity="viewMode === 'grid' ? 'primary' : 'secondary'"
                    @click="viewMode = 'grid'"
                  />
                  <Button 
                    icon="pi pi-list" 
                    text
                    :severity="viewMode === 'list' ? 'primary' : 'secondary'"
                    @click="viewMode = 'list'"
                  />
                </div>
              </div>
            </template>
            <template #content>
              <template v-if="selectedDates.length > 0">
                <!-- Search & Filter Controls -->
                <div class="filters mb-3">
                  <InputText 
                    v-model="searchQuery" 
                    placeholder="キャスト名・事務所名で検索"
                    class="w-full mb-2"
                  />
                  <SelectButton 
                    v-model="selectedType" 
                    :options="typeOptions"
                    optionLabel="label"
                    optionValue="value"
                  />
                </div>

                <!-- ローディング -->
                <div v-if="loading" class="loading-container">
                  <ProgressSpinner />
                  <p>キャストを読み込み中...</p>
                </div>

                <!-- キャストグリッド/リスト -->
                <div v-else-if="filteredCasts.length > 0" 
                     :class="['cast-view', viewMode === 'grid' ? 'grid-mode' : 'list-mode']">
                  <CastCard 
                    v-for="cast in filteredCasts" 
                    :key="cast.id"
                    :cast="cast"
                    :bookings="getCastBookings(cast.id, activeCastings, selectedDates.map((d: Date) => d.toISOString().split('T')[0]).filter((s): s is string => !!s))"
                    :isBlocked="isBookingBlocked(cast.id, activeCastings, selectedDates.map((d: Date) => d.toISOString().split('T')[0]).filter((s): s is string => !!s))"
                    @click="handleCastClick"
                    @add="handleAddToCart"
                  />
                </div>

                <!-- 空の状態 -->
                <div v-else class="empty-state">
                  <i class="pi pi-users"></i>
                  <p>条件に一致するキャストが見つかりませんでした</p>
                </div>
              </template>
              
              <div v-else class="placeholder-text large">
                <i class="pi pi-calendar mb-3"></i>
                <p>先に日付を選択してください</p>
              </div>
            </template>
          </Card>
        </div>
      </div>
    </template>

    <!-- ダイアログ類 -->
    <CastDetailDialog 
      v-model:visible="showDetailDialog"
      :cast="selectedCast"
    />

    <OrderTypeDialog 
      v-model:visible="showOrderTypeDialog"
      @select="handleOrderTypeSelect"
    />

    <CartSidebar 
      @submit="handleSubmitOrder"
    />
  </div>
</template>

<style scoped>
.casting-view {
  padding: 1rem;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}

.header-left h1 {
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--p-text-color);
  margin: 0 0 0.25rem 0;
}

.subtitle {
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
  margin: 0;
}

/* New Grid Layout */
.grid-layout {
  display: grid;
  grid-template-columns: 280px 1fr; /* Narrower calendar column */
  gap: 1.5rem;
  align-items: start;
}

.sidebar-column {
  display: flex;
  flex-direction: column;
}

.mb-3 {
  margin-bottom: 1rem;
}

/* Date Selector Override: Make calendar more compact */
.date-card :deep(.p-datepicker-inline) {
  border: none;
  box-shadow: none;
  margin: 0 auto;
  max-width: 100%;
  padding: 0.25rem;
}
/* Reduce calendar cell size */
.date-card :deep(.p-datepicker td > span) {
  width: 1.75rem;
  height: 1.75rem;
  font-size: 0.85rem;
}
.date-card :deep(.p-datepicker-header) {
  padding: 0.25rem;
}

.step-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.1rem;
}

.step-num {
  background: var(--p-primary-color);
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  font-weight: bold;
}

.disabled-card {
  opacity: 0.6;
  pointer-events: none;
  background: var(--p-surface-100);
}

.placeholder-text {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--p-text-muted-color);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.placeholder-text.large {
  padding: 5rem 1rem;
  font-size: 1.2rem;
}

.current-context {
  background: var(--p-surface-50);
  border: 1px solid var(--p-green-200);
  border-radius: 6px;
  padding: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.context-info {
  display: flex;
  flex-direction: column;
}

.filters {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.search-box {
  flex: 1;
}

/* Grid Mode: Force 4 columns */
.cast-view.grid-mode {
  display: grid;
  grid-template-columns: repeat(4, 1fr); /* Exact 4 columns */
  gap: 1rem;
}

/* List Mode: Smart List Design */
.cast-view.list-mode {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.cast-view.list-mode :deep(.cast-card) {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 1rem 1.5rem;
  gap: 1.5rem;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  border: 1px solid var(--p-surface-200);
  background: #fff;
  transition: transform 0.2s, box-shadow 0.2s;
  max-width: 100%;
}
.cast-view.list-mode :deep(.cast-card:hover) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}
/* Re-style internal elements for list mode */
.cast-view.list-mode :deep(.p-card-header) {
  width: 60px;
  height: 60px;
  flex-shrink: 0;
  margin: 0;
}
.cast-view.list-mode :deep(.cast-image) {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  object-fit: cover;
}
.cast-view.list-mode :deep(.p-card-body) {
  padding: 0;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cast-view.list-mode :deep(.p-card-content) {
  padding: 0;
}
.cast-view.list-mode :deep(.p-card-title) {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
}
.cast-view.list-mode :deep(.p-card-subtitle) {
  margin: 0;
  font-size: 0.9rem;
  color: var(--p-text-muted-color);
}
.cast-view.list-mode :deep(.tags) {
  display: none; /* Hide tags in smart list, or show minimal? Keep clean */
}
.cast-view.list-mode :deep(.p-card-footer) {
  padding: 0;
  margin: 0;
}
/* Override Card structure via deep selector hack might be brittle. 
   Better approach: Pass 'displayMode' prop to CastCard or use specific CSS classes.
   Let's assume CastCard uses standard PrimeVue slots which render specific DOM.
   We need to target those.
*/

.loading-container, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: var(--p-text-muted-color);
}

@media (max-width: 1024px) {
  .grid-layout {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  
  .cast-view.grid-mode {
    grid-template-columns: repeat(2, 1fr); /* 2 cols on smaller screens */
  }
}
</style>
