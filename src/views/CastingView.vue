<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'
import ProgressSpinner from 'primevue/progressspinner'
import Button from 'primevue/button'
import Popover from 'primevue/popover'
import Tag from 'primevue/tag'
import Checkbox from 'primevue/checkbox'
import MultiSelect from 'primevue/multiselect'
import CastCard from '@/components/cast/CastCard.vue'
import CastDetailDialog from '@/components/cast/CastDetailDialog.vue'
import DateSelector from '@/components/calendar/DateSelector.vue'
import CartSidebar from '@/components/cart/CartSidebar.vue'
import ShootingList from '@/components/shooting/ShootingList.vue'
import OrderTypeDialog from '@/components/casting/OrderTypeDialog.vue'
import ProgressModal from '@/components/common/ProgressModal.vue'
import NewCastModal from '@/components/cast/NewCastModal.vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase'
import { useCasts } from '@/composables/useCasts'
import { useOrderStore } from '@/stores/orderStore'
import { useAvailability } from '@/composables/useAvailability'
import { useShootings } from '@/composables/useShootings'
import { useOrders } from '@/composables/useOrders'
import { getCastBookings, isBookingBlocked } from '@/utils/castStatusUtils'
import type { Cast, Shooting } from '@/types'
import { useToast } from 'primevue/usetoast'
import { useAuth } from '@/composables/useAuth'

const toast = useToast()
const { isAdmin } = useAuth()
const { casts, loading, fetchAll, isFirebaseConfigured } = useCasts()
const { shootings, loading: shootingsLoading, fetchShootingsByDates } = useShootings()
const { activeCastings, fetchAvailability } = useAvailability()

// タイムゾーン安全なローカル日付フォーマッター（toISOString はUTC変換で日付がずれる）
const toLocalDateStr = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const store = useOrderStore()

// フィルター
const searchQuery = ref('')
const selectedType = ref<'all' | '内部' | '外部'>('all')
const typeOptions = [
  { label: '全て', value: 'all' },
  { label: '内部', value: '内部' },
  { label: '外部', value: '外部' }
]

// Gender filter
const genderMale = ref(false)
const genderFemale = ref(false)

// Agency filter (multiselect)
const selectedAgencies = ref<string[]>([])
const agencyOptions = computed(() => {
  const agencies = new Set(casts.value.map(c => c.agency || 'フリー'))
  return Array.from(agencies).sort().map(a => ({ label: a, value: a }))
})

// Availability filter
const showAvailableOnly = ref(false)

// Sort options
const sortOption = ref<'none' | 'appearance' | 'kana'>('none')
const sortOptions = [
  { label: '最新', value: 'none' },
  { label: '出演回数', value: 'appearance' },
  { label: '50音順', value: 'kana' }
]




// Progress Modal State
const showProgress = ref(false)
const progressValue = ref(0)
const progressMessage = ref('')

// Date Select
const selectedDates = ref<Date[]>([])
const selectedShooting = ref<Shooting | null>(null)
const _skipShootingWatch = ref(false) // Guard: prevent watcher from resetting mode during order type switch

// UI State
const showOrderTypeDialog = ref(false)
const selectedCast = ref<Cast | null>(null)
const showDetailDialog = ref(false)
const showNewCastModal = ref(false)
const syncingShootings = ref(false)

// Date update handler
const handleDatesUpdate = (dates: Date[]) => {
  selectedDates.value = dates
}

// Workflow Logic

watch(selectedDates, async (dates) => {
  // Update store dates formatting
  const formatted = dates.map(d => {
    console.log('[DEBUG DATE] Raw Date object:', d, 'toString:', d.toString(), 'getDate:', d.getDate(), 'getMonth:', d.getMonth(), 'getFullYear:', d.getFullYear(), 'toISOString:', d.toISOString())
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const result = `${year}/${month}/${day}`
    console.log('[DEBUG DATE] Formatted:', result)
    return result
  }).sort()
  
  console.log('[DEBUG DATE] All formatted dates:', formatted)
  
  if (store.context) {
    store.context.dateRanges = formatted
  }

  // 日付がクリアされた場合、撮影選択もクリア
  if (dates.length === 0) {
    selectedShooting.value = null
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
  // Guard: skip if mode was explicitly set by handleOrderTypeSelect
  if (_skipShootingWatch.value) {
    _skipShootingWatch.value = false
    return
  }
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
      title: '',
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
        title: '',
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
  
  // 撮影モードからの切り替え時、撮影選択をクリア（watcherでmode resetされないようにガード）
  _skipShootingWatch.value = true
  selectedShooting.value = null
  
  store.setContext({
    mode: mode,
    shootingData: null,
    dateRanges: store.context.dateRanges
  })
  showOrderTypeDialog.value = false
  toast.add({ severity: 'info', summary: '新規オーダー作成', detail: '案件情報を入力してください', life: 2000 })
}

// Cast Selection
const filteredCasts = computed(() => {
  let result = casts.value.filter(cast => {
    // Text search: name, agency, notes, furigana
    const searchLower = searchQuery.value.toLowerCase()
    const matchesSearch = !searchQuery.value || 
      cast.name.toLowerCase().includes(searchLower) ||
      cast.agency?.toLowerCase().includes(searchLower) ||
      cast.notes?.toLowerCase().includes(searchLower) ||
      (cast as any).furigana?.toLowerCase().includes(searchLower)
    
    // Type filter
    const matchesType = selectedType.value === 'all' || cast.castType === selectedType.value
    
    // Gender filter
    const matchesGender = 
      (!genderMale.value && !genderFemale.value) ||
      (genderMale.value && cast.gender === '男性') ||
      (genderFemale.value && cast.gender === '女性')
    
    // Agency filter
    const matchesAgency = 
      selectedAgencies.value.length === 0 ||
      selectedAgencies.value.includes(cast.agency || 'フリー')
    
    // Availability filter (check if not already booked)
    const matchesAvailability = !showAvailableOnly.value || 
      !isBookingBlocked(
        cast.id, 
        activeCastings.value, 
        selectedDates.value.map((d: Date) => toLocalDateStr(d))
      )
    
    return matchesSearch && matchesType && matchesGender && matchesAgency && matchesAvailability
  })
  
  // Sorting
  if (sortOption.value === 'appearance') {
    result = [...result].sort((a, b) => (b.appearanceCount || 0) - (a.appearanceCount || 0))
  } else if (sortOption.value === 'kana') {
    result = [...result].sort((a, b) => {
      const aKana = (a as any).furigana || a.name
      const bKana = (b as any).furigana || b.name
      return aKana.localeCompare(bKana, 'ja')
    })
  }
  
  return result
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

const handleNewCastSaved = (cast: Cast) => {
  // 新規外部キャストをカートに自動追加
  store.addItem(cast)
  toast.add({ severity: 'success', summary: 'カートに追加', detail: `${cast.name} をカートに追加しました`, life: 3000 })
}

// Order submission with progress
const { submitOrder, checkExistingProject } = useOrders()

// 保留中の送信パラメータ
const pendingOrderParams = ref<{ pdfFile?: File | null, intimacy?: string, competition?: { type: string; period: string } } | null>(null)
const additionalOrderPopover = ref()
const existingThreads = ref<Array<{ threadTs: string; dates: string[] }>>([])
const selectedThreadTs = ref('')
const popoverAnchor = ref()
const manualThreadUrl = ref('')

// SlackスレッドURLからts(1234567890.123456)を抽出
// 例: https://gokko5club.slack.com/archives/C02S1NFRH55/p1776051658223859
//     → 1776051658.223859
const parsedManualTs = computed(() => {
  const url = manualThreadUrl.value.trim()
  if (!url) return ''
  const m = url.match(/\/p(\d{10})(\d{6})/)
  if (!m) return ''
  return `${m[1]}.${m[2]}`
})

const handleSubmitOrder = async (pdfFile?: File | null, intimacy?: string, competition?: { type: string; period: string }) => {
  // 既存オーダーがあるかチェック
  const threads = await checkExistingProject()

  if (threads.length > 0) {
    // 既存オーダーあり → ユーザーに選択させるポップアップ表示
    existingThreads.value = threads
    selectedThreadTs.value = threads[0]?.threadTs || ''
    pendingOrderParams.value = { pdfFile, intimacy, competition }
    // Popover をアンカー要素から表示
    nextTick(() => {
      additionalOrderPopover.value?.show({ currentTarget: popoverAnchor.value })
    })
    return
  }

  // 既存なし → 通常送信
  await executeSubmit(pdfFile, intimacy, competition, false)
}

const handleAdditionalOrderChoice = async (forceNew: boolean) => {
  additionalOrderPopover.value?.hide()
  if (!pendingOrderParams.value) return
  const { pdfFile, intimacy, competition } = pendingOrderParams.value
  pendingOrderParams.value = null
  if (forceNew) {
    await executeSubmit(pdfFile, intimacy, competition, true)
  } else {
    // 手動入力URLが有効ならそれを優先、それ以外は選択スレッド
    const targetTs = parsedManualTs.value || selectedThreadTs.value
    await executeSubmit(pdfFile, intimacy, competition, false, targetTs)
  }
  manualThreadUrl.value = ''
}

const executeSubmit = async (pdfFile?: File | null, intimacy?: string, competition?: { type: string; period: string }, forceNewThread?: boolean, replyToThreadTs?: string) => {
  const success = await submitOrder(pdfFile ?? undefined, intimacy, competition, forceNewThread, replyToThreadTs)
  
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


// 撮影日手動同期（Cloud Function: syncScheduleFromSam）
const handleSyncShootings = async () => {
  syncingShootings.value = true
  toast.add({ severity: 'info', summary: '同期中...', detail: 'gokko-sam から撮影データを取得しています', life: 3000 })
  try {
    const syncFn = httpsCallable(functions!, 'syncScheduleFromSam')
    const result = await syncFn({})
    const data = result.data as { success?: boolean; synced?: number; added?: number; updated?: number; errors?: number; dateChanges?: number }
    if (data.success) {
      const parts = []
      if (data.added) parts.push(`追加 ${data.added}件`)
      if (data.updated) parts.push(`更新 ${data.updated}件`)
      if (data.dateChanges) parts.push(`日付変更 ${data.dateChanges}件`)
      if (parts.length === 0) parts.push('変更なし')
      toast.add({ severity: 'success', summary: '同期完了', detail: parts.join(' / '), life: 5000 })
      // Firestoreのshootingsを再取得
      if (selectedDates.value.length > 0) {
        await fetchShootingsByDates(selectedDates.value)
      }
    } else {
      toast.add({ severity: 'error', summary: '同期失敗', detail: `エラー: ${data.errors || 0}件`, life: 5000 })
    }
  } catch (e: any) {
    toast.add({ severity: 'error', summary: '同期エラー', detail: e.message, life: 5000 })
  } finally {
    syncingShootings.value = false
  }
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
                :allowPastDates="isAdmin"
                @update:dates="handleDatesUpdate" 
              />
            </template>
          </Card>

          <!-- 2. 案件選択 -->
          <Card class="shooting-card" :class="{ 'disabled-card': selectedDates.length === 0 }">
            <template #title>
              <div class="step-title" style="justify-content: space-between; width: 100%;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <span class="step-num">2</span>
                  <span>案件を選択</span>
                </div>
                <Button
                  icon="pi pi-refresh"
                  label="更新"
                  severity="info"
                  outlined
                  size="small"
                  :loading="syncingShootings"
                  @click.stop="handleSyncShootings"
                />
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
              </div>
            </template>
            <template #content>
              <template v-if="selectedDates.length > 0">
                <!-- Search & Filter Controls -->
                <div class="filters-container mb-3">
                  <!-- Search Row -->
                  <div class="filter-row">
                    <InputText 
                      v-model="searchQuery" 
                      placeholder="キャスト名・事務所名・ふりがなで検索"
                      class="search-input"
                    />
                    <SelectButton 
                      v-model="selectedType" 
                      :options="typeOptions"
                      optionLabel="label"
                      optionValue="value"
                    />
                  </div>
                  
                  <!-- Gender & Agency Row -->
                  <div class="filter-row">
                    <div class="filter-group">
                      <Checkbox v-model="genderMale" inputId="genderMale" binary />
                      <label for="genderMale">男性</label>
                    </div>
                    <div class="filter-group">
                      <Checkbox v-model="genderFemale" inputId="genderFemale" binary />
                      <label for="genderFemale">女性</label>
                    </div>
                    <MultiSelect
                      v-model="selectedAgencies"
                      :options="agencyOptions"
                      optionLabel="label"
                      optionValue="value"
                      placeholder="事務所で絞り込み"
                      :maxSelectedLabels="2"
                      selectedItemsLabel="{0}件の事務所を選択中"
                      filter
                      filterPlaceholder="事務所名を検索..."
                      class="agency-select"
                      :showToggleAll="true"
                    />
                  </div>
                  
                  <!-- Availability & Sort Row -->
                  <div class="filter-row">
                    <div class="filter-group">
                      <Checkbox v-model="showAvailableOnly" inputId="availableOnly" binary />
                      <label for="availableOnly">未仮キャスのみ</label>
                    </div>
                    <SelectButton 
                      v-model="sortOption" 
                      :options="sortOptions"
                      optionLabel="label"
                      optionValue="value"
                    />
                  </div>
                </div>

                <!-- ローディング -->
                <div v-if="loading" class="loading-container">
                  <ProgressSpinner />
                  <p>キャストを読み込み中...</p>
                </div>

                <!-- キャストグリッド -->
                <div v-else-if="filteredCasts.length > 0" 
                     class="cast-view grid-5col">
                  <!-- 新規外部キャスト追加カード（先頭） -->
                  <div class="new-cast-card" @click="showNewCastModal = true">
                    <div class="new-cast-card-icon">＋</div>
                    <div class="new-cast-card-text">
                      <strong>新規外部キャストを追加</strong>
                      <small>DBに存在しない外部キャストを登録</small>
                    </div>
                  </div>

                  <CastCard 
                    v-for="cast in filteredCasts" 
                    :key="cast.id"
                    :cast="cast"
                    :bookings="getCastBookings(cast.id, activeCastings, selectedDates.map((d: Date) => toLocalDateStr(d)))"
                    :isBlocked="isBookingBlocked(cast.id, activeCastings, selectedDates.map((d: Date) => toLocalDateStr(d)))"
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
      :activeCastings="activeCastings"
    />

    <OrderTypeDialog 
      v-model:visible="showOrderTypeDialog"
      @select="handleOrderTypeSelect"
    />

    <CartSidebar 
      @submit="handleSubmitOrder"
    />

    <!-- Progress Modal -->
    <ProgressModal 
      v-model:visible="showProgress"
      :progress="progressValue"
      :message="progressMessage"
    />

    <!-- 追加オーダー確認ポップオーバー (アンカー) -->
    <span ref="popoverAnchor" style="position: fixed; top: 50%; left: 50%; pointer-events: none;"></span>

    <Popover ref="additionalOrderPopover">
      <div style="display: flex; flex-direction: column; gap: 1rem; max-width: 420px; padding: 0.25rem;">
        <h4 style="margin: 0; font-size: 1rem; font-weight: 700;">オーダー送信方法</h4>

        <p style="margin: 0; font-size: 0.9rem; line-height: 1.6; color: var(--p-text-color);">
          この作品には既にオーダーが送信されています。<br>
          追加オーダーとして既存スレッドに返信しますか？<br>
          それとも新規スレッドを作成しますか？
        </p>

        <div style="padding: 0.6rem 0.75rem; background: var(--p-message-warn-background); color: var(--p-message-warn-color); border-radius: 6px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.5rem;">
          <i class="pi pi-info-circle" style="flex-shrink: 0;"></i>
          <span>リスケなどで以前とは別日の撮影オーダーの場合は「新規スレッド」を選択してください</span>
        </div>

        <!-- スレッド選択（複数ある場合） -->
        <div v-if="existingThreads.length > 1" style="display: flex; flex-direction: column; gap: 0.5rem;">
          <label style="font-weight: 600; font-size: 0.85rem; color: var(--p-text-muted-color);">追加先のスレッドを選択:</label>
          <div v-for="thread in existingThreads" :key="thread.threadTs"
            style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border-radius: 6px; cursor: pointer; transition: background 0.15s;"
            :style="{
              background: selectedThreadTs === thread.threadTs && !manualThreadUrl ? 'var(--p-highlight-background)' : 'var(--p-content-hover-background)',
              border: selectedThreadTs === thread.threadTs && !manualThreadUrl ? '2px solid var(--p-primary-color)' : '2px solid transparent'
            }"
            @click="selectedThreadTs = thread.threadTs; manualThreadUrl = ''"
          >
            <i class="pi pi-comments" style="color: var(--p-primary-color);"></i>
            <span style="font-size: 0.9rem;">撮影日: {{ thread.dates.join(', ') }}</span>
          </div>
        </div>

        <!-- 手動URL指定（DBに見つからないスレッドへ手動で送る用） -->
        <div style="display: flex; flex-direction: column; gap: 0.35rem;">
          <label style="font-weight: 600; font-size: 0.8rem; color: var(--p-text-muted-color);">
            または Slack スレッドURLを直接指定:
          </label>
          <input
            v-model="manualThreadUrl"
            type="text"
            placeholder="https://gokko5club.slack.com/archives/C.../p1234567890123456"
            style="padding: 0.45rem 0.6rem; border: 1px solid var(--p-content-border-color); border-radius: 6px; font-size: 0.82rem; background: var(--p-content-background); color: var(--p-text-color);"
          />
          <div v-if="manualThreadUrl && !parsedManualTs" style="font-size: 0.75rem; color: var(--p-message-error-color);">
            URLからスレッドtsを抽出できません（…/p1234567890123456 形式が必要です）
          </div>
          <div v-else-if="parsedManualTs" style="font-size: 0.75rem; color: var(--p-primary-color);">
            ✓ このURLを優先して送信します（ts: {{ parsedManualTs }}）
          </div>
        </div>

        <div style="display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 0.5rem;">
          <Button
            label="新規スレッド"
            icon="pi pi-plus"
            severity="secondary"
            outlined
            @click="handleAdditionalOrderChoice(true)"
          />
          <Button
            label="追加オーダー"
            icon="pi pi-reply"
            :disabled="!!manualThreadUrl && !parsedManualTs"
            @click="handleAdditionalOrderChoice(false)"
          />
        </div>
      </div>
    </Popover>

    <!-- 新規外部キャストモーダル -->
    <NewCastModal
      v-model:visible="showNewCastModal"
      @saved="handleNewCastSaved"
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
  grid-template-columns: 280px minmax(0, 1fr);
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
.date-card {
  overflow: hidden;
}
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
  background: var(--p-content-hover-background);
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
  background: var(--p-content-hover-background);
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

/* Filter styles */
.filters-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--p-content-hover-background);
  border-radius: 8px;
  border: 1px solid var(--p-content-border-color);
}

.filter-row {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.filter-group label {
  cursor: pointer;
  user-select: none;
}

.search-input {
  flex: 1;
  min-width: 200px;
}

.agency-select {
  min-width: 180px;
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

/* Grid Mode: 3 columns (comfort) */
.cast-view.grid-3col {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

/* Grid Mode: 5 columns (dense) */
.cast-view.grid-5col {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
}

.cast-view.grid-5col :deep(.cast-card) {
  font-size: 0.9rem;
}

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
  
  .cast-view.grid-3col,
  .cast-view.grid-5col {
    grid-template-columns: repeat(2, 1fr);
  }
}
/* 新規外部キャスト追加カード */
.new-cast-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.5rem 1rem;
  border: 2px dashed var(--p-primary-300, #93c5fd);
  border-radius: 12px;
  background: var(--p-primary-50, #eff6ff);
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 140px;
  text-align: center;
}

.new-cast-card:hover {
  border-color: var(--p-primary-500, #3b82f6);
  background: var(--p-primary-100, #dbeafe);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
}

.new-cast-card-icon {
  font-size: 2rem;
  color: var(--p-primary-500, #6366f1);
  font-weight: 300;
  line-height: 1;
}

.new-cast-card-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.new-cast-card-text strong {
  font-size: 0.85rem;
  color: var(--p-primary-700, #4338ca);
}

.new-cast-card-text small {
  font-size: 0.75rem;
  color: var(--p-primary-500, #6366f1);
}
</style>
