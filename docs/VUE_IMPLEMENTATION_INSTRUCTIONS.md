# Vue版 実装指示書

> **作成日**: 2026-02-04  
> **対象プロジェクト**: `/Users/mk0012/Desktop/workspace/vue_casty/`

---

## 📋 実装順序

以下の順序で実装を進めてください。各フェーズは依存関係を考慮して設計されています。

---

# Phase 1: 一括選択機能

## 対象ファイル
- `src/views/CastingStatusView.vue` (修正)
- `src/components/status/BulkActionBar.vue` (新規作成)
- `src/components/status/CastingRowCheckbox.vue` (新規作成)
- `src/composables/useBulkSelection.ts` (新規作成)

---

### 1.1 useBulkSelection.ts (新規)

**パス:** `src/composables/useBulkSelection.ts`

```typescript
import { ref, computed } from 'vue'
import type { CastingStatus } from '@/types'

export function useBulkSelection() {
  // State
  const bulkSelectMode = ref(false)
  const selectedIds = ref<Set<string>>(new Set())
  
  // Computed
  const selectedCount = computed(() => selectedIds.value.size)
  const hasSelection = computed(() => selectedIds.value.size > 0)
  
  // Actions
  const toggleMode = () => {
    bulkSelectMode.value = !bulkSelectMode.value
    if (!bulkSelectMode.value) {
      selectedIds.value.clear()
    }
  }
  
  const toggleSelect = (id: string) => {
    if (selectedIds.value.has(id)) {
      selectedIds.value.delete(id)
    } else {
      selectedIds.value.add(id)
    }
    // Trigger reactivity
    selectedIds.value = new Set(selectedIds.value)
  }
  
  const selectAll = (ids: string[]) => {
    ids.forEach(id => selectedIds.value.add(id))
    selectedIds.value = new Set(selectedIds.value)
  }
  
  const clearSelection = () => {
    selectedIds.value.clear()
    selectedIds.value = new Set(selectedIds.value)
  }
  
  const isSelected = (id: string) => selectedIds.value.has(id)
  
  return {
    bulkSelectMode,
    selectedIds,
    selectedCount,
    hasSelection,
    toggleMode,
    toggleSelect,
    selectAll,
    clearSelection,
    isSelected
  }
}
```

---

### 1.2 BulkActionBar.vue (新規)

**パス:** `src/components/status/BulkActionBar.vue`

```vue
<script setup lang="ts">
import { defineProps, defineEmits } from 'vue'
import Button from 'primevue/button'

const props = defineProps<{
  selectedCount: number
}>()

const emit = defineEmits<{
  (e: 'delete'): void
  (e: 'updateStatus'): void
  (e: 'selectAll'): void
  (e: 'clearSelection'): void
}>()
</script>

<template>
  <div class="bulk-action-bar">
    <span class="selection-count">
      <i class="pi pi-check-square"></i>
      {{ selectedCount }}件選択中
    </span>
    
    <div class="actions">
      <Button 
        label="一括削除" 
        icon="pi pi-trash" 
        severity="danger"
        :disabled="selectedCount === 0"
        @click="emit('delete')"
      />
      <Button 
        label="一括ステータス更新" 
        icon="pi pi-pencil" 
        severity="info"
        :disabled="selectedCount === 0"
        @click="emit('updateStatus')"
      />
      <Button 
        label="全選択" 
        icon="pi pi-check-circle" 
        text
        @click="emit('selectAll')"
      />
      <Button 
        label="選択解除" 
        icon="pi pi-times-circle" 
        text
        @click="emit('clearSelection')"
      />
    </div>
  </div>
</template>

<style scoped>
.bulk-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: var(--blue-50);
  border: 1px solid var(--blue-200);
  border-radius: 8px;
  margin-bottom: 1rem;
}

.selection-count {
  font-weight: 600;
  color: var(--blue-800);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
}
</style>
```

---

### 1.3 CastingStatusView.vue の修正

**修正箇所:**

1. **import追加:**
```typescript
import { useBulkSelection } from '@/composables/useBulkSelection'
import BulkActionBar from '@/components/status/BulkActionBar.vue'
```

2. **composable使用:**
```typescript
const {
  bulkSelectMode,
  selectedCount,
  hasSelection,
  toggleMode,
  toggleSelect,
  selectAll,
  clearSelection,
  isSelected
} = useBulkSelection()
```

3. **ヘッダーにトグルボタン追加:**
```vue
<Button 
  :label="bulkSelectMode ? '一括選択中' : '一括選択'"
  :icon="bulkSelectMode ? 'pi pi-check-square' : 'pi pi-square'"
  :severity="bulkSelectMode ? 'info' : 'secondary'"
  text
  @click="toggleMode"
/>
```

4. **BulkActionBar追加:**
```vue
<BulkActionBar 
  v-if="bulkSelectMode"
  :selected-count="selectedCount"
  @delete="handleBulkDelete"
  @update-status="handleBulkUpdateStatus"
  @select-all="handleSelectAll"
  @clear-selection="clearSelection"
/>
```

5. **一括処理関数追加:**
```typescript
const handleBulkDelete = async () => {
  if (!confirm(`${selectedCount.value}件を削除しますか？`)) return
  
  showProgress('一括削除中...', 0)
  const ids = Array.from(selectedIds.value)
  
  for (let i = 0; i < ids.length; i++) {
    await deleteCasting(ids[i])
    updateProgress(`${i + 1}/${ids.length}件処理中...`, ((i + 1) / ids.length) * 100)
  }
  
  hideProgress()
  clearSelection()
  toggleMode()
  await fetchCastings()
}

const handleBulkUpdateStatus = () => {
  // ステータス選択モーダルを開く
  showBulkStatusModal.value = true
}

const executeBulkStatusUpdate = async (newStatus: CastingStatus) => {
  showProgress('一括ステータス更新中...', 0)
  const ids = Array.from(selectedIds.value)
  
  for (let i = 0; i < ids.length; i++) {
    await updateCastingStatus(ids[i], newStatus)
    updateProgress(`${i + 1}/${ids.length}件処理中...`, ((i + 1) / ids.length) * 100)
  }
  
  hideProgress()
  clearSelection()
  toggleMode()
  await fetchCastings()
}
```

---

# Phase 2: メールモーダル

## 対象ファイル
- `src/components/common/EmailModal.vue` (新規作成)
- `src/composables/useEmailTemplate.ts` (新規作成)

---

### 2.1 useEmailTemplate.ts (新規)

**パス:** `src/composables/useEmailTemplate.ts`

```typescript
import type { ShootingContact } from '@/types'

export function useEmailTemplate() {
  
  const generateKoubanMail = (contact: ShootingContact) => {
    const subject = `【香盤連絡】${contact.projectName} ${contact.castName}様`
    
    const body = `
${contact.castName}様

お世話になっております。
撮影の香盤をご連絡いたします。

■ 撮影日: ${contact.shootingDate}
■ 集合時間: ${contact.inTime || '未定'}
■ 終了予定: ${contact.outTime || '未定'}
■ 撮影場所: ${contact.location || '未定'}
■ 住所: ${contact.address || ''}

ご確認のほど、よろしくお願いいたします。
`
    return { subject, body }
  }
  
  const generateOrderMail = (contact: ShootingContact) => {
    const subject = `【発注書送付】${contact.projectName} ${contact.castName}様`
    
    const body = `
${contact.agency || contact.castName}様

お世話になっております。
発注書を添付にてお送りいたします。

■ 案件名: ${contact.projectName}
■ 撮影日: ${contact.shootingDate}
■ 出演者: ${contact.castName}様
■ 金額: ${contact.cost ? `¥${contact.cost.toLocaleString()}（税別）` : '別途ご連絡'}

ご確認いただき、問題なければご署名・捺印の上
ご返送くださいますようお願いいたします。
`
    return { subject, body }
  }
  
  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
  }
  
  const openMailto = (to: string, subject: string, body: string) => {
    const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.open(mailto)
  }
  
  return {
    generateKoubanMail,
    generateOrderMail,
    copyToClipboard,
    openMailto
  }
}
```

---

### 2.2 EmailModal.vue (新規)

**パス:** `src/components/common/EmailModal.vue`

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import { useEmailTemplate } from '@/composables/useEmailTemplate'
import { useToast } from 'primevue/usetoast'
import type { ShootingContact } from '@/types'

const props = defineProps<{
  visible: boolean
  contact: ShootingContact | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const toast = useToast()
const { generateKoubanMail, generateOrderMail, copyToClipboard, openMailto } = useEmailTemplate()

const activeTab = ref(0)
const koubanMail = computed(() => props.contact ? generateKoubanMail(props.contact) : null)
const orderMail = computed(() => props.contact ? generateOrderMail(props.contact) : null)

const handleCopy = async (subject: string, body: string) => {
  await copyToClipboard(`${subject}\n\n${body}`)
  toast.add({ 
    severity: 'success', 
    summary: 'コピー完了', 
    detail: 'クリップボードにコピーしました', 
    life: 3000 
  })
}

const handleMailto = (subject: string, body: string) => {
  if (!props.contact?.email) {
    toast.add({ 
      severity: 'warn', 
      summary: '警告', 
      detail: 'メールアドレスが設定されていません', 
      life: 3000 
    })
    return
  }
  openMailto(props.contact.email, subject, body)
}
</script>

<template>
  <Dialog 
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    header="メール作成"
    :style="{ width: '600px' }"
  >
    <TabView v-model:activeIndex="activeTab">
      <TabPanel header="香盤連絡">
        <div v-if="koubanMail" class="mail-preview">
          <div class="field">
            <label>件名</label>
            <div class="subject">{{ koubanMail.subject }}</div>
          </div>
          <div class="field">
            <label>本文</label>
            <Textarea 
              :modelValue="koubanMail.body" 
              readonly 
              rows="12" 
              class="w-full"
            />
          </div>
          <div class="actions">
            <Button 
              label="クリップボードにコピー" 
              icon="pi pi-copy"
              @click="handleCopy(koubanMail.subject, koubanMail.body)"
            />
            <Button 
              label="メーラーで開く" 
              icon="pi pi-envelope"
              severity="secondary"
              @click="handleMailto(koubanMail.subject, koubanMail.body)"
            />
          </div>
        </div>
      </TabPanel>
      
      <TabPanel header="発注書送付">
        <div v-if="orderMail" class="mail-preview">
          <div class="field">
            <label>件名</label>
            <div class="subject">{{ orderMail.subject }}</div>
          </div>
          <div class="field">
            <label>本文</label>
            <Textarea 
              :modelValue="orderMail.body" 
              readonly 
              rows="12" 
              class="w-full"
            />
          </div>
          <div class="actions">
            <Button 
              label="クリップボードにコピー" 
              icon="pi pi-copy"
              @click="handleCopy(orderMail.subject, orderMail.body)"
            />
            <Button 
              label="メーラーで開く" 
              icon="pi pi-envelope"
              severity="secondary"
              @click="handleMailto(orderMail.subject, orderMail.body)"
            />
          </div>
        </div>
      </TabPanel>
    </TabView>
  </Dialog>
</template>

<style scoped>
.mail-preview {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}

.subject {
  padding: 0.5rem;
  background: var(--surface-100);
  border-radius: 4px;
  font-weight: 500;
}

.actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1rem;
}
</style>
```

---

# Phase 3: PDF発注書生成

## 対象ファイル
- `src/components/common/OrderPdfModal.vue` (新規作成)
- `src/composables/usePdfGenerator.ts` (新規作成)

## 依存パッケージ
```bash
npm install jspdf
```

---

### 3.1 usePdfGenerator.ts (新規)

**パス:** `src/composables/usePdfGenerator.ts`

```typescript
import { jsPDF } from 'jspdf'
import type { ShootingContact } from '@/types'

export function usePdfGenerator() {
  
  const getSeasonalGreeting = () => {
    const month = new Date().getMonth() + 1
    const greetings: Record<number, string> = {
      1: '新春の候、貴社ますますご清栄のこととお慶び申し上げます。',
      2: '立春の候、貴社ますますご発展のこととお慶び申し上げます。',
      3: '早春の候、貴社ますますご清栄のこととお慶び申し上げます。',
      4: '陽春の候、貴社ますますご発展のこととお慶び申し上げます。',
      5: '新緑の候、貴社ますますご清栄のこととお慶び申し上げます。',
      6: '初夏の候、貴社ますますご発展のこととお慶び申し上げます。',
      7: '盛夏の候、貴社ますますご清栄のこととお慶び申し上げます。',
      8: '残暑の候、貴社ますますご発展のこととお慶び申し上げます。',
      9: '初秋の候、貴社ますますご清栄のこととお慶び申し上げます。',
      10: '秋涼の候、貴社ますますご発展のこととお慶び申し上げます。',
      11: '晩秋の候、貴社ますますご清栄のこととお慶び申し上げます。',
      12: '師走の候、貴社ますますご発展のこととお慶び申し上げます。'
    }
    return greetings[month] || greetings[1]
  }
  
  const generateOrderPdf = async (contact: ShootingContact) => {
    const doc = new jsPDF()
    
    // ※ 日本語フォントを使用する場合は別途フォントファイルの埋め込みが必要
    // doc.addFont('NotoSansJP-Regular.ttf', 'NotoSansJP', 'normal')
    // doc.setFont('NotoSansJP')
    
    const today = new Date().toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
    
    // ヘッダー
    doc.setFontSize(20)
    doc.text('発 注 書', 105, 30, { align: 'center' })
    
    // 日付
    doc.setFontSize(10)
    doc.text(today, 180, 20, { align: 'right' })
    
    // 宛先
    doc.setFontSize(12)
    doc.text(`${contact.agency || contact.castName} 御中`, 20, 50)
    
    // 挨拶文
    doc.setFontSize(10)
    doc.text(getSeasonalGreeting(), 20, 65)
    doc.text('下記の通りご発注申し上げます。', 20, 75)
    
    // 内容
    const startY = 90
    const lineHeight = 10
    
    doc.setFontSize(11)
    doc.text(`案件名: ${contact.projectName}`, 20, startY)
    doc.text(`撮影日: ${contact.shootingDate}`, 20, startY + lineHeight)
    doc.text(`出演者: ${contact.castName}`, 20, startY + lineHeight * 2)
    doc.text(`金額: ¥${(contact.cost || 0).toLocaleString()}（税別）`, 20, startY + lineHeight * 3)
    
    // 備考
    if (contact.note) {
      doc.text(`備考: ${contact.note}`, 20, startY + lineHeight * 5)
    }
    
    return doc
  }
  
  const downloadPdf = (doc: jsPDF, filename: string) => {
    doc.save(filename)
  }
  
  const previewPdf = (doc: jsPDF) => {
    const pdfBlob = doc.output('blob')
    const url = URL.createObjectURL(pdfBlob)
    window.open(url, '_blank')
  }
  
  return {
    generateOrderPdf,
    downloadPdf,
    previewPdf,
    getSeasonalGreeting
  }
}
```

---

### 3.2 OrderPdfModal.vue (新規)

**パス:** `src/components/common/OrderPdfModal.vue`

```vue
<script setup lang="ts">
import { ref } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { usePdfGenerator } from '@/composables/usePdfGenerator'
import type { ShootingContact } from '@/types'

const props = defineProps<{
  visible: boolean
  contact: ShootingContact | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const { generateOrderPdf, downloadPdf, previewPdf } = usePdfGenerator()

const loading = ref(false)

const handlePreview = async () => {
  if (!props.contact) return
  loading.value = true
  try {
    const doc = await generateOrderPdf(props.contact)
    previewPdf(doc)
  } finally {
    loading.value = false
  }
}

const handleDownload = async () => {
  if (!props.contact) return
  loading.value = true
  try {
    const doc = await generateOrderPdf(props.contact)
    const filename = `発注書_${props.contact.projectName}_${props.contact.castName}.pdf`
    downloadPdf(doc, filename)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Dialog 
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    header="発注書生成"
    :style="{ width: '500px' }"
  >
    <div v-if="contact" class="pdf-form">
      <div class="field">
        <label>発注先</label>
        <InputText :modelValue="contact.agency || contact.castName" disabled class="w-full" />
      </div>
      
      <div class="field">
        <label>案件名</label>
        <InputText :modelValue="contact.projectName" disabled class="w-full" />
      </div>
      
      <div class="field">
        <label>出演者</label>
        <InputText :modelValue="contact.castName" disabled class="w-full" />
      </div>
      
      <div class="field">
        <label>撮影日</label>
        <InputText :modelValue="contact.shootingDate" disabled class="w-full" />
      </div>
      
      <div class="field">
        <label>金額（税別）</label>
        <InputNumber :modelValue="contact.cost" disabled class="w-full" prefix="¥" />
      </div>
      
      <div class="field">
        <label>備考</label>
        <Textarea :modelValue="contact.note" disabled rows="3" class="w-full" />
      </div>
    </div>
    
    <template #footer>
      <Button 
        label="プレビュー" 
        icon="pi pi-eye" 
        severity="secondary"
        :loading="loading"
        @click="handlePreview"
      />
      <Button 
        label="PDFダウンロード" 
        icon="pi pi-download"
        :loading="loading"
        @click="handleDownload"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.pdf-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}
</style>
```

---

# Phase 4: まとめモーダル

## 対象ファイル
- `src/components/common/SummaryModal.vue` (新規作成)

---

### 4.1 SummaryModal.vue (新規)

**パス:** `src/components/common/SummaryModal.vue`

```vue
<script setup lang="ts">
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import type { Casting } from '@/types'

const props = defineProps<{
  visible: boolean
  castings: Casting[]
  projectName: string
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const totalCost = computed(() => {
  return props.castings.reduce((sum, c) => sum + (c.cost || 0), 0)
})

const statusSeverity = (status: string) => {
  const map: Record<string, string> = {
    '決定': 'success',
    'OK': 'success',
    '条件つきOK': 'warning',
    '打診中': 'info',
    'オーダー待ち': 'secondary',
    'NG': 'danger',
    'キャンセル': 'danger'
  }
  return map[status] || 'secondary'
}
</script>

<template>
  <Dialog 
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    :header="`まとめ: ${projectName}`"
    :style="{ width: '800px' }"
  >
    <DataTable :value="castings" stripedRows>
      <Column field="castName" header="キャスト" />
      <Column field="roleName" header="役名" />
      <Column field="mainSub" header="区分" />
      <Column field="status" header="ステータス">
        <template #body="{ data }">
          <Tag :value="data.status" :severity="statusSeverity(data.status)" />
        </template>
      </Column>
      <Column field="cost" header="金額">
        <template #body="{ data }">
          {{ data.cost ? `¥${data.cost.toLocaleString()}` : '-' }}
        </template>
      </Column>
    </DataTable>
    
    <div class="summary-footer">
      <div class="total">
        <span class="label">合計金額（税別）:</span>
        <span class="value">¥{{ totalCost.toLocaleString() }}</span>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.summary-footer {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--surface-200);
  display: flex;
  justify-content: flex-end;
}

.total {
  display: flex;
  gap: 0.5rem;
  font-size: 1.125rem;
}

.total .label {
  color: var(--text-color-secondary);
}

.total .value {
  font-weight: 700;
  color: var(--primary-color);
}
</style>
```

---

# Phase 5: ShootingContactCard 編集機能強化

## 対象ファイル
- `src/components/contact/ShootingContactCard.vue` (修正)

---

### 5.1 ShootingContactCard.vue の修正

**追加するフィールド:**
- IN時間 (`inTime`)
- OUT時間 (`outTime`)
- 場所 (`location`)
- 住所 (`address`)
- 金額 (`cost`)
- 保存ボタン

**追加するアクションボタン:**
- メール送信ボタン → EmailModal を開く
- 発注書生成ボタン → OrderPdfModal を開く
- ステータス変更ボタン

```vue
<!-- 編集フィールド例 -->
<div class="edit-fields">
  <div class="field-row">
    <label>IN</label>
    <InputText v-model="editData.inTime" placeholder="10:00" />
  </div>
  <div class="field-row">
    <label>OUT</label>
    <InputText v-model="editData.outTime" placeholder="18:00" />
  </div>
  <div class="field-row">
    <label>場所</label>
    <InputText v-model="editData.location" placeholder="撮影スタジオ" />
  </div>
  <div class="field-row">
    <label>住所</label>
    <InputText v-model="editData.address" placeholder="東京都..." />
  </div>
  <div class="field-row">
    <label>金額</label>
    <InputNumber v-model="editData.cost" prefix="¥" />
  </div>
</div>

<div class="actions">
  <Button label="保存" icon="pi pi-save" @click="handleSave" />
  <Button label="メール" icon="pi pi-envelope" severity="secondary" @click="openEmailModal" />
  <Button label="発注書" icon="pi pi-file-pdf" severity="secondary" @click="openPdfModal" />
</div>
```

---

# Phase 6: Googleカレンダー連携（Cloud Functions）

## 対象ファイル
- `functions/src/calendar.ts` (新規作成)
- `functions/src/index.ts` (修正)

---

### 6.1 calendar.ts (Firebase Functions)

```typescript
import * as functions from 'firebase-functions'
import { google } from 'googleapis'

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID
const SERVICE_ACCOUNT_KEY = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}')

const auth = new google.auth.GoogleAuth({
  credentials: SERVICE_ACCOUNT_KEY,
  scopes: ['https://www.googleapis.com/auth/calendar']
})

const calendar = google.calendar({ version: 'v3', auth })

export const createCalendarEvent = functions.https.onCall(async (data) => {
  const { castName, projectName, startDate, endDate } = data
  
  const event = {
    summary: `【仮押さえ】${castName} - ${projectName}`,
    start: { date: startDate },
    end: { date: endDate },
  }
  
  const result = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: event
  })
  
  return { eventId: result.data.id }
})

export const updateCalendarEvent = functions.https.onCall(async (data) => {
  const { eventId, newTitle } = data
  
  await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    requestBody: { summary: newTitle }
  })
  
  return { success: true }
})

export const deleteCalendarEvent = functions.https.onCall(async (data) => {
  const { eventId } = data
  
  await calendar.events.delete({
    calendarId: CALENDAR_ID,
    eventId
  })
  
  return { success: true }
})
```

---

## ✅ 実装チェックリスト

### Phase 1: 一括選択機能
- [ ] `useBulkSelection.ts` 作成
- [ ] `BulkActionBar.vue` 作成
- [ ] `CastingStatusView.vue` に統合
- [ ] 一括削除機能テスト
- [ ] 一括ステータス更新機能テスト

### Phase 2: メールモーダル
- [ ] `useEmailTemplate.ts` 作成
- [ ] `EmailModal.vue` 作成
- [ ] `ShootingContactCard.vue` から呼び出し
- [ ] クリップボードコピーテスト
- [ ] mailto リンクテスト

### Phase 3: PDF発注書
- [ ] jsPDF インストール
- [ ] `usePdfGenerator.ts` 作成
- [ ] `OrderPdfModal.vue` 作成
- [ ] PDF生成テスト

### Phase 4: まとめモーダル
- [ ] `SummaryModal.vue` 作成
- [ ] `CastingStatusView.vue` から呼び出し

### Phase 5: ShootingContactCard強化
- [ ] 編集フィールド追加
- [ ] 保存機能実装
- [ ] モーダル連携

### Phase 6: Googleカレンダー連携
- [ ] Firebase Functions 作成
- [ ] 環境変数設定
- [ ] キャスティング作成/更新時の連携

---

> **この指示書に従って、順番に実装を進めてください。**
