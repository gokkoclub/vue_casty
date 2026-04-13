<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import { useToast } from 'primevue/usetoast'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase'
import type { Casting, CastingStatus } from '@/types'
import { useAuth } from '@/composables/useAuth'
import { addAttendeeToCalendarEvent } from '@/composables/useGoogleCalendar'

const props = defineProps<{
  castings: Casting[]
  projectName: string
  updaters?: string[]
  isExternalTab?: boolean
  bulkSelectMode?: boolean
  isSelected?: (id: string) => boolean
}>()

const emit = defineEmits<{
  'update-status': [castingId: string, newStatus: CastingStatus]
  'open-modal': [castingId: string]
  'delete': [castingId: string]
  'save-cost': [castingId: string, cost: number]
  'save-time': [castingId: string, startTime: string, endTime: string]
  'save-project-name': [castingIds: string[], newProjectName: string]
  'save-role-name': [castingId: string, newRoleName: string]
  'additional-order': [casting: Casting]
  'open-summary': [castings: Casting[]]
  'open-email': [casting: Casting]
  'toggle-select': [castingId: string]
}>()

// Time editing state
const editingTimeId = ref<string | null>(null)
const editingTime = reactive({ startTime: '', endTime: '' })

const startTimeEdit = (casting: Casting) => {
  editingTimeId.value = casting.id
  editingTime.startTime = casting.startTime || ''
  editingTime.endTime = casting.endTime || ''
}

const cancelTimeEdit = () => {
  editingTimeId.value = null
}

const saveTimeEdit = (castingId: string) => {
  emit('save-time', castingId, editingTime.startTime, editingTime.endTime)
  editingTimeId.value = null
}

// Project name editing state
const editingProjectName = ref(false)
const editProjectNameValue = ref('')

const startProjectNameEdit = () => {
  editProjectNameValue.value = props.projectName
  editingProjectName.value = true
}

const cancelProjectNameEdit = () => {
  editingProjectName.value = false
}

const saveProjectNameEdit = () => {
  const newName = editProjectNameValue.value.trim()
  if (newName && newName !== props.projectName) {
    const castingIds = props.castings.map(c => c.id)
    emit('save-project-name', castingIds, newName)
  }
  editingProjectName.value = false
}

// Role name editing state
const editingRoleId = ref<string | null>(null)
const editRoleNameValue = ref('')

const startRoleEdit = (casting: Casting) => {
  editingRoleId.value = casting.id
  editRoleNameValue.value = casting.roleName || ''
}

const cancelRoleEdit = () => {
  editingRoleId.value = null
}

const saveRoleEdit = (castingId: string) => {
  const newName = editRoleNameValue.value.trim()
  emit('save-role-name', castingId, newName)
  editingRoleId.value = null
}

const { isAdmin } = useAuth()

// カレンダー再生成
const toast = useToast()
const regeneratingCalendarId = ref<string | null>(null)

// スレッドts修復
const repairingThreadId = ref<string | null>(null)
const showThreadRepairDialog = ref(false)
const repairTargetCasting = ref<Casting | null>(null)
const repairManualUrl = ref('')

const openThreadRepair = (casting: Casting) => {
  repairTargetCasting.value = casting
  repairManualUrl.value = ''
  showThreadRepairDialog.value = true
}

const callRepair = async (manualUrl?: string) => {
  if (!functions || !repairTargetCasting.value) return
  const target = repairTargetCasting.value
  showThreadRepairDialog.value = false
  repairingThreadId.value = target.id
  try {
    const fn = httpsCallable(functions, 'repairCastingThread')
    const payload: { castingId: string; manualUrl?: string } = { castingId: target.id }
    if (manualUrl) payload.manualUrl = manualUrl
    const res = await fn(payload)
    const d = res?.data as { success?: boolean; mode?: string; slackThreadTs?: string; message?: string } | undefined
    if (d?.success) {
      const modeLabel = d.mode === 'manual' ? '手動URL' : d.mode === 'sibling' ? '兄弟キャスティングから借用' : 'Slack履歴から復旧'
      toast.add({ severity: 'success', summary: 'スレッド修復', detail: `${modeLabel} (ts: ${d.slackThreadTs})`, life: 4500 })
    } else {
      toast.add({ severity: 'warn', summary: '修復スキップ', detail: d?.message || '不明', life: 4000 })
    }
  } catch (e: unknown) {
    console.error('repairCastingThread failed:', e)
    const msg = e instanceof Error ? e.message : String(e)
    toast.add({ severity: 'error', summary: 'エラー', detail: msg, life: 5000 })
  } finally {
    repairingThreadId.value = null
  }
}

// 手動URLからts抽出（プレビュー用）
const parsedRepairTs = computed(() => {
  const url = repairManualUrl.value.trim()
  if (!url) return ''
  const m = url.match(/\/p(\d{10})(\d{6})/)
  if (!m) return ''
  return `${m[1]}.${m[2]}`
})
const handleRegenerateCalendar = async (castingId: string) => {
  if (!functions) {
    toast.add({ severity: 'error', summary: 'エラー', detail: 'Firebase Functions 未初期化', life: 3000 })
    return
  }
  regeneratingCalendarId.value = castingId
  try {
    // OAuthトークンを事前取得（attendees追加に必要）— 通常オーダー時と同じ仕組み
    const { getAccessToken } = useAuth()
    let accessToken: string | null = null
    try {
      accessToken = await getAccessToken()
    } catch (authErr) {
      console.warn('[CALENDAR] OAuth token failed, attendees will be skipped:', authErr)
    }

    const fn = httpsCallable(functions, 'regenerateCalendarEvent')
    const res = await fn({ castingId })
    const data = res?.data as { success?: boolean; eventId?: string; castEmail?: string; message?: string } | undefined

    if (data?.success && data.eventId) {
      // attendees 追加（通常オーダー時と同じ共通関数を再利用）
      if (accessToken && data.castEmail) {
        await addAttendeeToCalendarEvent(data.eventId, data.castEmail, accessToken)
      }
      toast.add({ severity: 'success', summary: 'カレンダー作成', detail: `eventId: ${data.eventId}${accessToken ? '（招待送信済み）' : ''}`, life: 4000 })
    } else {
      toast.add({ severity: 'warn', summary: '作成スキップ', detail: data?.message || '不明', life: 4000 })
    }
  } catch (e: unknown) {
    console.error('regenerateCalendarEvent failed:', e)
    const msg = e instanceof Error ? e.message : String(e)
    toast.add({ severity: 'error', summary: 'エラー', detail: msg, life: 5000 })
  } finally {
    regeneratingCalendarId.value = null
  }
}

// ダークモード検知
const isDark = ref(
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
)
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    isDark.value = e.matches
  })
}

// Status styling per spec（ライト・ダーク両対応）
const getStatusStyle = (status: CastingStatus) => {
  if (isDark.value) {
    const dark: Record<string, { bg: string; color: string }> = {
      '仮キャスティング':               { bg: '#374151', color: '#E5E7EB' },
      '仮押さえ':                       { bg: '#78350F', color: '#FDE68A' },
      '打診中':                         { bg: '#1E3A5F', color: '#93C5FD' },
      'オーダー待ち':                   { bg: '#3B0764', color: '#D8B4FE' },
      'オーダー待ち（仮キャスティング）': { bg: '#3B0764', color: '#D8B4FE' },
      'OK':                             { bg: '#064E3B', color: '#6EE7B7' },
      '決定':                           { bg: '#15803D', color: '#FFFFFF' },
      '条件つきOK':                     { bg: '#7C2D12', color: '#FDBA74' },
      'NG':                             { bg: '#991B1B', color: '#FCA5A5' },
      'キャンセル':                     { bg: '#4B5563', color: '#D1D5DB' },
    }
    return dark[status] || { bg: '#374151', color: '#E5E7EB' }
  }
  const light: Record<string, { bg: string; color: string }> = {
    '仮キャスティング':               { bg: '#F3F4F6', color: '#374151' },
    '仮押さえ':                       { bg: '#FEF3C7', color: '#92400E' },
    '打診中':                         { bg: '#DBEAFE', color: '#1E40AF' },
    'オーダー待ち':                   { bg: '#EDE9FE', color: '#6B21A8' },
    'オーダー待ち（仮キャスティング）': { bg: '#EDE9FE', color: '#6B21A8' },
    'OK':                             { bg: '#D1FAE5', color: '#065F46' },
    '決定':                           { bg: '#22C55E', color: '#FFFFFF' },
    '条件つきOK':                     { bg: '#FED7AA', color: '#C2410C' },
    'NG':                             { bg: '#EF4444', color: '#FFFFFF' },
    'キャンセル':                     { bg: '#9CA3AF', color: '#FFFFFF' },
  }
  return light[status] || { bg: '#F3F4F6', color: '#374151' }
}

const isRowDimmed = (status: string) => ['NG', 'キャンセル'].includes(status)

const editingCosts = new Map<string, number>()

const handleCostChange = (castingId: string, value: number | null) => {
  editingCosts.set(castingId, value || 0)
}

const saveCost = (castingId: string) => {
  const cost = editingCosts.get(castingId) || 0
  emit('save-cost', castingId, cost)
}

const formatCost = (cost: number) => {
  if (!cost) return ''
  return '¥' + cost.toLocaleString()
}

const openSlack = (url: string) => {
  window.open(url, '_blank')
}

const handleSummaryClick = () => {
  emit('open-summary', props.castings)
}

// 内部/外部ソート
type SortMode = 'default' | 'internal-first' | 'external-first'
const sortMode = ref<SortMode>('default')

const sortedCastings = computed(() => {
  const list = [...props.castings]
  if (sortMode.value === 'internal-first') {
    list.sort((a, b) => {
      if (a.castType === '内部' && b.castType !== '内部') return -1
      if (a.castType !== '内部' && b.castType === '内部') return 1
      return (a.rank || 0) - (b.rank || 0)
    })
  } else if (sortMode.value === 'external-first') {
    list.sort((a, b) => {
      if (a.castType === '外部' && b.castType !== '外部') return -1
      if (a.castType !== '外部' && b.castType === '外部') return 1
      return (a.rank || 0) - (b.rank || 0)
    })
  }
  return list
})

const cycleSortMode = () => {
  const modes: SortMode[] = ['default', 'internal-first', 'external-first']
  const idx = modes.indexOf(sortMode.value)
  sortMode.value = modes[(idx + 1) % modes.length]!
}

const sortLabel = computed(() => {
  switch (sortMode.value) {
    case 'internal-first': return '内部優先'
    case 'external-first': return '外部優先'
    default: return '候補順'
  }
})
</script>

<template>
  <div class="csl">
    <!-- Project Header -->
    <div class="csl-project-hdr">
      <div class="csl-project-left">
        <template v-if="editingProjectName">
          <InputText
            v-model="editProjectNameValue"
            class="csl-project-name-input"
            @keyup.enter="saveProjectNameEdit"
            @keyup.escape="cancelProjectNameEdit"
          />
          <Button icon="pi pi-check" text size="small" severity="success" @click="saveProjectNameEdit" />
          <Button icon="pi pi-times" text size="small" severity="secondary" @click="cancelProjectNameEdit" />
        </template>
        <template v-else>
          <span class="csl-project-name" @click="startProjectNameEdit" title="クリックして作品名を編集">
            {{ projectName }}
            <i class="pi pi-pencil csl-edit-icon"></i>
          </span>
        </template>
        <span class="csl-cast-count">{{ castings.length }}人</span>
      </div>
      <div class="csl-project-actions">
        <span v-if="updaters && updaters.length" class="csl-updater">
          {{ updaters.join(', ') }}
        </span>
        <Button
          :label="sortLabel"
          icon="pi pi-sort-alt"
          text
          size="small"
          severity="secondary"
          @click="cycleSortMode"
          v-tooltip.bottom="'内部/外部で並び替え'"
        />
        <Button
          v-if="isAdmin"
          label="まとめ"
          icon="pi pi-list"
          text
          size="small"
          @click="handleSummaryClick"
        />
      </div>
    </div>

    <!-- Cast Rows -->
    <div class="csl-rows">
      <div
        v-for="casting in sortedCastings"
        :key="casting.id"
        class="csl-row"
        :class="{ 'dimmed': isRowDimmed(casting.status) }"
        @click="emit('open-modal', casting.id)"
      >
        <!-- Bulk Select -->
        <div v-if="bulkSelectMode" class="csl-cell csl-check" @click.stop="emit('toggle-select', casting.id)">
          <i :class="isSelected?.(casting.id) ? 'pi pi-check-square' : 'pi pi-stop'" class="check-icon"></i>
        </div>

        <!-- Cast Name & Type -->
        <div class="csl-cell csl-cast">
          <i v-if="casting.mode === 'external'" class="pi pi-briefcase csl-mode-icon" style="color: #E74C3C;" title="外部案件"></i>
          <i v-else-if="casting.mode === 'internal'" class="pi pi-building csl-mode-icon" style="color: #F59E0B;" title="社内イベント"></i>
          <i v-else class="pi pi-video csl-mode-icon" style="color: #3B82F6;" title="撮影"></i>
          <span class="csl-cast-name">{{ casting.castName }}</span>
          <span class="csl-cast-type" :class="casting.castType === '内部' ? 'internal' : 'external'">
            {{ casting.castType }}
          </span>
          <span v-if="casting.competitionType" class="csl-comp-badge">競合</span>
        </div>

        <!-- Status -->
        <div class="csl-cell csl-status" @click.stop="isAdmin && emit('open-modal', casting.id)">
          <span 
            class="csl-status-badge"
            :style="{ background: getStatusStyle(casting.status).bg, color: getStatusStyle(casting.status).color }"
          >
            {{ casting.status }}
          </span>
        </div>

        <!-- Role & Rank -->
        <div class="csl-cell csl-role" @click.stop>
          <template v-if="editingRoleId === casting.id">
            <InputText
              v-model="editRoleNameValue"
              class="csl-role-input"
              @keyup.enter="saveRoleEdit(casting.id)"
              @keyup.escape="cancelRoleEdit"
            />
            <button class="csl-save-btn" @click="saveRoleEdit(casting.id)" title="保存">
              <i class="pi pi-check"></i>
            </button>
            <button class="csl-act-btn" @click="cancelRoleEdit" title="キャンセル">
              <i class="pi pi-times"></i>
            </button>
          </template>
          <template v-else>
            <span class="csl-role-name clickable" @click="startRoleEdit(casting)" title="クリックして役名を編集">
              {{ casting.roleName || '-' }}
              <i class="pi pi-pencil csl-role-edit-icon"></i>
            </span>
            <span v-if="casting.mainSub === 'メイン'" class="csl-main-badge">メイン</span>
          </template>
        </div>

        <!-- Time (for external/internal events) -->
        <div v-if="isExternalTab || casting.mode === 'external' || casting.mode === 'internal'" class="csl-cell csl-time" @click.stop>
          <template v-if="editingTimeId === casting.id">
            <input
              v-model="editingTime.startTime"
              type="time"
              class="csl-time-input"
            />
            <span class="csl-time-sep">~</span>
            <input
              v-model="editingTime.endTime"
              type="time"
              class="csl-time-input"
            />
            <button class="csl-save-btn" @click="saveTimeEdit(casting.id)" title="保存">
              <i class="pi pi-check"></i>
            </button>
            <button class="csl-act-btn" @click="cancelTimeEdit" title="キャンセル">
              <i class="pi pi-times"></i>
            </button>
          </template>
          <template v-else>
            <span v-if="casting.startTime || casting.endTime" class="csl-time-display">
              <i class="pi pi-clock csl-time-icon"></i>
              {{ casting.startTime || '??' }}〜{{ casting.endTime || '??' }}
            </span>
            <span v-else class="csl-time-empty">時間未設定</span>
            <button v-if="isAdmin" class="csl-act-btn csl-time-edit" @click="startTimeEdit(casting)" title="時間を編集">
              <i class="pi pi-pencil"></i>
            </button>
          </template>
        </div>

        <!-- Cost -->
        <div class="csl-cell csl-cost" @click.stop>
          <template v-if="!isRowDimmed(casting.status)">
            <InputNumber 
              :modelValue="casting.cost"
              @update:modelValue="(v) => handleCostChange(casting.id, v)"
              mode="currency"
              currency="JPY"
              locale="ja-JP"
              :maxFractionDigits="0"
              class="csl-cost-input"
              inputClass="csl-cost-inner"
            />
            <button class="csl-save-btn" @click="saveCost(casting.id)" title="保存">
              <i class="pi pi-check"></i>
            </button>
          </template>
          <span v-else class="csl-cost-text">{{ formatCost(casting.cost) }}</span>
        </div>

        <!-- Actions -->
        <div class="csl-cell csl-actions" @click.stop>
          <button v-if="casting.slackPermalink" class="csl-act-btn" @click="openSlack(casting.slackPermalink)" title="Slack">
            <i class="pi pi-comments"></i>
          </button>
          <button
            v-if="!casting.slackThreadTs && !['NG', 'キャンセル', '削除済み'].includes(casting.status)"
            class="csl-act-btn warn"
            :disabled="repairingThreadId === casting.id"
            @click="openThreadRepair(casting)"
            :title="repairingThreadId === casting.id ? '修復中...' : 'スレッド ts を修復'"
          >
            <i :class="repairingThreadId === casting.id ? 'pi pi-spin pi-spinner' : 'pi pi-link'"></i>
          </button>
          <button
            v-if="casting.castType === '内部' && !casting.calendarEventId && !['NG', 'キャンセル', '削除済み'].includes(casting.status)"
            class="csl-act-btn"
            :disabled="regeneratingCalendarId === casting.id"
            @click="handleRegenerateCalendar(casting.id)"
            :title="regeneratingCalendarId === casting.id ? 'カレンダー作成中...' : 'カレンダーを生成'"
          >
            <i :class="regeneratingCalendarId === casting.id ? 'pi pi-spin pi-spinner' : 'pi pi-calendar-plus'"></i>
          </button>
          <button class="csl-act-btn" @click="emit('additional-order', casting)" title="追加オーダー">
            <i class="pi pi-plus"></i>
          </button>
          <button v-if="isExternalTab" class="csl-act-btn" @click="emit('open-email', casting)" title="メール">
            <i class="pi pi-envelope"></i>
          </button>
          <button v-if="isAdmin" class="csl-act-btn danger" @click="emit('delete', casting.id)" title="削除">
            <i class="pi pi-trash"></i>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- スレッドts修復ダイアログ -->
  <Dialog
    v-model:visible="showThreadRepairDialog"
    modal
    :style="{ width: '500px' }"
    header="スレッド ts を修復"
    :closable="true"
  >
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <p style="margin: 0; font-size: 0.85rem; line-height: 1.5; color: var(--p-text-color);">
        対象: <strong>{{ repairTargetCasting?.castName }}</strong>（{{ repairTargetCasting?.projectName }}）<br>
        現在 slackThreadTs が空のため、ステータス変更通知が飛ばない状態です。
      </p>

      <div style="padding: 0.75rem; background: var(--p-content-hover-background); border-radius: 6px; font-size: 0.8rem;">
        <strong>方法 1: 自動復旧</strong><br>
        同 projectId の他キャスティングまたは Slack 履歴から ts を探して書き戻します。
      </div>

      <div style="padding: 0.75rem; background: var(--p-content-hover-background); border-radius: 6px; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.8rem;">
        <strong>方法 2: Slack URL を手動指定</strong>
        <input
          v-model="repairManualUrl"
          type="text"
          placeholder="https://gokko5club.slack.com/archives/C.../p1234567890123456"
          style="padding: 0.5rem; border: 1px solid var(--p-content-border-color); border-radius: 4px; font-size: 0.8rem; background: var(--p-content-background); color: var(--p-text-color);"
        />
        <span v-if="repairManualUrl && !parsedRepairTs" style="color: var(--p-message-error-color); font-size: 0.75rem;">
          URL の形式が不正です
        </span>
        <span v-else-if="parsedRepairTs" style="color: var(--p-primary-color); font-size: 0.75rem;">
          ✓ ts: {{ parsedRepairTs }}
        </span>
      </div>
    </div>

    <template #footer>
      <Button label="キャンセル" severity="secondary" text @click="showThreadRepairDialog = false" />
      <Button
        label="自動復旧で実行"
        icon="pi pi-search"
        severity="info"
        @click="callRepair()"
      />
      <Button
        label="URLで実行"
        icon="pi pi-link"
        :disabled="!parsedRepairTs"
        @click="callRepair(repairManualUrl)"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.csl {
  margin-bottom: 0.75rem;
}

/* Project Header */
.csl-project-hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-content-hover-background);
}

.csl-project-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.csl-project-name {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--p-text-color);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.csl-project-name:hover {
  color: var(--p-primary-color);
}
.csl-edit-icon {
  font-size: 0.65rem;
  opacity: 0;
  transition: opacity 0.2s;
}
.csl-project-name:hover .csl-edit-icon {
  opacity: 0.6;
}
.csl-project-name-input {
  width: 200px;
  font-size: 0.85rem;
}

.csl-cast-count {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  background: var(--p-content-hover-background);
  padding: 0.1rem 0.4rem;
  border-radius: 8px;
}

.csl-project-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.csl-updater {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

/* Rows */
.csl-rows {
  display: flex;
  flex-direction: column;
}

.csl-row {
  display: flex;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-content-border-color);
  cursor: pointer;
  transition: background 0.1s;
  gap: 0.75rem;
}

.csl-row:hover {
  background: var(--p-content-hover-background);
}

.csl-row:last-child {
  border-bottom: none;
}

.csl-row.dimmed {
  opacity: 0.4;
}

/* Cells */
.csl-cell {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.csl-check {
  width: 28px;
  cursor: pointer;
}

.check-icon {
  font-size: 1.1rem;
  color: var(--p-primary-color);
}

/* Cast name */
.csl-cast {
  min-width: 140px;
  gap: 0.4rem;
}

.csl-mode-icon {
  font-size: 0.75rem;
  flex-shrink: 0;
}

.csl-cast-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--p-text-color);
  white-space: nowrap;
}

.csl-cast-type {
  font-size: 0.6rem;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-weight: 600;
  white-space: nowrap;
}

.csl-cast-type.internal {
  background: var(--p-blue-100);
  color: var(--p-blue-700);
}

.csl-cast-type.external {
  background: var(--p-content-border-color);
  color: var(--p-text-muted-color);
}

/* Status */
.csl-status {
  min-width: 100px;
}

.csl-status-badge {
  display: inline-block;
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  white-space: nowrap;
}

.csl-status-badge:hover {
  opacity: 0.8;
}

/* Role */
.csl-role {
  flex: 1;
  min-width: 80px;
  gap: 0.4rem;
}

.csl-role-name {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.csl-main-badge {
  font-size: 0.6rem;
  background: var(--p-green-100);
  color: var(--p-green-800);
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-weight: 600;
}

.csl-role-name.clickable {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.csl-role-name.clickable:hover {
  color: var(--p-primary-color);
}
.csl-role-edit-icon {
  font-size: 0.6rem;
  opacity: 0;
  transition: opacity 0.2s;
}
.csl-role-name.clickable:hover .csl-role-edit-icon {
  opacity: 0.6;
}
.csl-role-input {
  width: 120px;
  font-size: 0.8rem;
}

/* Time */
.csl-time {
  min-width: 140px;
  gap: 0.3rem;
}

.csl-time-display {
  font-size: 0.8rem;
  color: var(--p-text-color);
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.csl-time-icon {
  font-size: 0.7rem;
  color: var(--p-primary-color);
}

.csl-time-empty {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  font-style: italic;
}

.csl-time-input {
  width: 80px;
  padding: 0.15rem 0.3rem;
  font-size: 0.75rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 4px;
  outline: none;
}

.csl-time-input:focus {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 1px var(--p-primary-color);
}

.csl-time-sep {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.csl-time-edit {
  font-size: 0.7rem !important;
  padding: 0.15rem !important;
  opacity: 0;
  transition: opacity 0.15s;
}

.csl-row:hover .csl-time-edit {
  opacity: 1;
}

/* Cost */
.csl-cost {
  min-width: 100px;
  gap: 0.25rem;
}

.csl-cost-input {
  width: 60px !important;
  max-width: 60px !important;
  flex-shrink: 1;
  min-width: 0;
}

:deep(.csl-cost-input) {
  width: 60px !important;
  max-width: 60px !important;
}

:deep(.csl-cost-input .p-inputnumber-input),
:deep(.csl-cost-inner) {
  width: 60px !important;
  max-width: 60px !important;
  text-align: right;
  padding: 0.2rem 0.3rem;
  font-size: 0.7rem;
}

.csl-cost-text {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.csl-save-btn {
  background: var(--p-green-100);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  color: var(--p-green-800);
  font-size: 0.75rem;
  flex-shrink: 0;
}

.csl-save-btn:hover {
  background: var(--p-green-200);
}

/* Actions */
.csl-actions {
  gap: 0.15rem;
}

.csl-act-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.3rem;
  border-radius: 4px;
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  transition: all 0.15s;
}

.csl-act-btn:hover {
  background: var(--p-content-hover-background);
  color: var(--p-text-color);
}

.csl-act-btn.danger:hover {
  background: var(--p-red-100);
  color: var(--p-red-600);
}

/* Responsive */
@media (max-width: 768px) {
  .csl-row {
    flex-wrap: wrap;
  }
  
  .csl-role, .csl-cost {
    width: 100%;
    margin-top: 0.25rem;
  }
}

.csl-comp-badge {
  font-size: 0.65rem;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--p-red-100);
  color: var(--p-red-600);
  font-weight: 600;
  white-space: nowrap;
}
</style>
