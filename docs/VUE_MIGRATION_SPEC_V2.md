# Vue移行仕様書 v2.0

> **最終更新**: 2026-01-26
> **現行システム**: index.html (6,679行) + main.py (1,501行)

---

## 📋 目次

1. [システム概要](#1-システム概要)
2. [現行機能一覧](#2-現行機能一覧)
3. [技術スタック](#3-技術スタック)
4. [フロントエンド設計](#4-フロントエンド設計)
5. [バックエンド設計](#5-バックエンド設計)
6. [データモデル](#6-データモデル)
7. [移行フェーズ](#7-移行フェーズ)

---

## 1. システム概要

### 1.1 目的
キャスティング管理システムの Vue.js への移行

### 1.2 現行構成
| レイヤー | 現行技術 | 移行先 |
|---------|----------|--------|
| フロントエンド | Jinja2 + Vanilla JS | Vue 3 + TypeScript |
| バックエンド | FastAPI (Python) | FastAPI (維持) |
| データベース | Google Sheets | Google Sheets (維持) |
| 通知 | Slack API | Slack API (維持) |
| カレンダー | Google Calendar API | Google Calendar API (維持) |
| 認証 | Google OAuth 2.0 | Google OAuth 2.0 (維持) |

---

## 2. 現行機能一覧

### 2.1 メイン画面 (3ページ構成)

#### キャスティング画面 (`casting-view`)
| 機能 | 関数名 | 行番号 | 説明 |
|------|--------|--------|------|
| キャスト一覧表示 | `displayAvailableCasts()` | 1032-1179 | カードUI、フィルター付き |
| 日付選択カレンダー | `renderCalendar()` | 2509-2560 | 月表示、複数日選択可 |
| 撮影リスト表示 | `renderShootingList()` | 2721-2788 | Notionから取得した撮影予定 |
| カートへ追加 | `addToCart()` | 2872-2902 | キャストをカートに追加 |
| カートモーダル | `renderNewCartModal()` | 5351-5421 | ドラッグ&ドロップUI |
| オーダー送信 | `processNewOrder()` | 4973-5333 | Slack通知+シート保存 |
| フィルター | `renderFilters()` | 2612-2692 | 性別、事務所 |
| 事務所フィルター | `renderAgencyFilter()` | 2693-2703 | 複数選択可 |

#### キャスティング状況画面 (`status-view`)
| 機能 | 関数名 | 行番号 | 説明 |
|------|--------|--------|------|
| 状況一覧表示 | `renderCastingStatusView()` | 1219-1543 | 月別、キャスト別グリッド |
| ステータス変更 | `changeCastingStatus()` | 1584-1838 | 複雑なビジネスロジック |
| クイック編集 | `openStatusQuickModal()` | 2316-2446 | ステータス+金額変更 |
| 通常編集モーダル | `openEditModal()` | 1839-1932 | 詳細編集 |
| 追加オーダー | `startAdditionalOrder()` | 1935-2004 | 既存スレッドへの追加 |
| 削除 | `deleteCastingOrder()` | 2261-2314 | Slack通知+シート削除 |
| カレンダー同期 | `updateCalendarEventOnStatusChange()` | 2111-2192 | NG時は削除、編集時は更新 |

#### 撮影連絡管理画面 (`shoot-contact-view`)
| 機能 | 関数名 | 行番号 | 説明 |
|------|--------|--------|------|
| 一覧表示 | `loadShootingContactPage()` | 3487-3628 | タブ切り替え付き |
| テーブル表示 | `renderProjectTable()` | 3638-3796 | 日付・案件別アコーディオン |
| 行保存 | `saveShootingRow()` | 3829-3879 | 時間・場所・金額編集 |
| メール作成 | `openShootMailModal()` | 4269-4558 | テンプレート生成 |
| 発注書PDF | `generatePDFFromData()` | 4137-4249 | jsPDF使用 |
| ステータス更新 | `updateShootingContactStatus()` | 4620-4637 | タブ間の移動 |

### 2.2 特別オーダー機能

| 機能 | 関数名 | 行番号 | 説明 |
|------|--------|--------|------|
| 外部オーダー作成 | `openSpecialOrderModal('external')` | 6094-6117 | 香盤表添付可 |
| 社内イベント作成 | `openSpecialOrderModal('internal')` | 6094-6117 | カレンダー連携 |
| 編集 | `openEditSpecialOrderModal()` | 6260-6318 | 時間・キャスト変更 |
| 保存 | `saveEditSpecialOrder()` | 6329-6489 | Slack+カレンダー更新 |
| 削除 | `confirmDeleteSpecialOrder()` | 6491-6520 | 全関連データ削除 |

### 2.3 バックエンドAPI (main.py)

| エンドポイント | メソッド | 説明 |
|----------------|----------|------|
| `/api/notify/order_created` | POST | オーダー作成Slack通知 |
| `/api/notify/special_order` | POST | 特別オーダーSlack通知 |
| `/api/notify/status_update` | POST | ステータス変更Slack通知 |
| `/api/slack/search_thread` | POST | Slackスレッド検索 |
| `/api/shooting_contact/list` | GET | 撮影連絡DB一覧取得 |
| `/api/shooting_contact/add` | POST | 撮影連絡DB追加 |
| `/api/shooting_contact/batch_update` | POST | 撮影連絡DB一括更新 |
| `/api/auth/login` | POST | Google OAuth認証 |
| `/api/auth/refresh` | GET | トークンリフレッシュ |

---

## 3. 技術スタック

### 3.1 フロントエンド
```
Vue 3.4+ (Composition API)
├── TypeScript 5.x
├── Vite 5.x
├── Pinia 2.x (状態管理)
├── Vue Router 4.x
├── PrimeVue 4.x (UIコンポーネント)
└── VueUse (ユーティリティ)
```

### 3.2 バックエンド（維持）
```
FastAPI (Python 3.11+)
├── Slack SDK (slack_sdk)
├── gspread-asyncio (Google Sheets)
├── google-auth (OAuth)
└── Uvicorn (ASGIサーバー)
```

---

## 4. フロントエンド設計

### 4.1 ディレクトリ構成
```
frontend/
├── src/
│   ├── components/
│   │   ├── cast/
│   │   │   ├── CastCard.vue
│   │   │   ├── CastDetailModal.vue
│   │   │   └── CastFilter.vue
│   │   ├── casting/
│   │   │   ├── CastingStatusView.vue
│   │   │   ├── CastingStatusRow.vue
│   │   │   ├── StatusChangeDialog.vue
│   │   │   └── QuickEditModal.vue
│   │   ├── cart/
│   │   │   ├── CartModal.vue
│   │   │   ├── CartProject.vue
│   │   │   ├── CartRole.vue
│   │   │   └── DraggableCast.vue
│   │   ├── shooting/
│   │   │   ├── ShootingContactPage.vue
│   │   │   ├── ShootingContactTable.vue
│   │   │   ├── ShootMailModal.vue
│   │   │   └── OrderDocModal.vue
│   │   └── common/
│   │       ├── AppHeader.vue
│   │       ├── Calendar.vue
│   │       ├── ProgressBar.vue
│   │       └── Toast.vue
│   ├── composables/
│   │   ├── useAuth.ts
│   │   ├── useCasts.ts
│   │   ├── useCastings.ts
│   │   ├── useCart.ts
│   │   ├── useShootingContact.ts
│   │   ├── useSlack.ts
│   │   └── useCalendar.ts
│   ├── stores/
│   │   ├── authStore.ts
│   │   ├── castStore.ts
│   │   ├── castingStore.ts
│   │   ├── cartStore.ts
│   │   └── shootingStore.ts
│   ├── services/
│   │   ├── api.ts
│   │   ├── sheets.ts
│   │   └── calendar.ts
│   ├── types/
│   │   └── index.ts
│   ├── router/
│   │   └── index.ts
│   ├── App.vue
│   └── main.ts
├── public/
├── index.html
└── vite.config.ts
```

### 4.2 主要コンポーネント

#### CastingStatusView.vue
現行の`renderCastingStatusView()`に相当

```vue
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useCastingStore } from '@/stores/castingStore'
import { useCastStore } from '@/stores/castStore'
import CastingStatusRow from './CastingStatusRow.vue'
import StatusChangeDialog from './StatusChangeDialog.vue'

const castingStore = useCastingStore()
const castStore = useCastStore()

const currentMonth = ref(new Date())
const currentTab = ref<'casting' | 'special'>('casting')
const showPast = ref(false)
const showOrderWaitOnly = ref(false)

const groupedCastings = computed(() => {
  return castingStore.getGroupedBycast(
    currentMonth.value,
    currentTab.value,
    showPast.value,
    showOrderWaitOnly.value
  )
})

onMounted(() => {
  castingStore.loadByMonth(currentMonth.value)
})
</script>

<template>
  <div class="casting-status-view">
    <!-- Header with month navigation -->
    <div class="flex justify-between items-center mb-4">
      <Button icon="pi pi-chevron-left" @click="prevMonth" />
      <h2>{{ formatMonth(currentMonth) }}</h2>
      <Button icon="pi pi-chevron-right" @click="nextMonth" />
    </div>
    
    <!-- Tab selection -->
    <TabView v-model:activeIndex="tabIndex">
      <TabPanel header="キャスティング状況" />
      <TabPanel header="外部/社内イベント" />
    </TabView>
    
    <!-- Status table -->
    <DataTable :value="groupedCastings" scrollable scrollHeight="70vh">
      <Column field="castName" header="キャスト" frozen />
      <Column v-for="date in monthDates" :key="date" :header="formatDate(date)">
        <template #body="{ data }">
          <CastingStatusCell 
            :castings="data.castings.filter(c => c.startDate === date)"
            @click="openQuickEdit"
          />
        </template>
      </Column>
    </DataTable>
    
    <StatusChangeDialog v-model:visible="dialogVisible" :casting="selectedCasting" />
  </div>
</template>
```

### 4.3 Store設計

#### castingStore.ts
```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Casting, CastingStatus } from '@/types'

export const useCastingStore = defineStore('casting', () => {
  const castings = ref<Casting[]>([])
  const loading = ref(false)

  // Actions
  async function loadByMonth(month: Date) {
    loading.value = true
    const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1)
    const endOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0)
    
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'キャスティングリスト!A2:X'
    })
    
    castings.value = parseSheetData(response.result.values || [])
      .filter(c => isInRange(c.startDate, startOfMonth, endOfMonth))
    
    loading.value = false
  }

  async function updateStatus(
    castingId: string, 
    newStatus: CastingStatus,
    options?: { cost?: number; extraMessage?: string }
  ) {
    // 1. Find row in sheet
    // 2. Update sheet
    // 3. Call Slack API
    // 4. Update calendar if needed
    // 5. Add to shooting contact DB if OK/決定
  }

  // Getters
  const getGroupedBycast = computed(() => (month: Date, tab: string, showPast: boolean, orderWaitOnly: boolean) => {
    const groups = new Map<string, Casting[]>()
    // ... grouping logic
    return groups
  })

  return { castings, loading, loadByMonth, updateStatus, getGroupedBycast }
})
```

---

## 5. バックエンド設計

### 5.1 維持するエンドポイント
現行のmain.pyのエンドポイントはほぼそのまま維持。フロントエンドからのInterface変更なし。

### 5.2 追加検討エンドポイント
```python
# Optional: シート操作をバックエンド経由にする場合
@app.get("/api/castings")
async def list_castings(month: str):
    """月別キャスティング一覧"""
    
@app.post("/api/castings/{id}/status")
async def update_casting_status(id: str, payload: StatusUpdatePayload):
    """ステータス更新（Slack通知込み）"""
```

---

## 6. データモデル

### 6.1 TypeScript型定義

```typescript
// types/index.ts

export interface Cast {
  castId: string
  name: string
  gender: '男性' | '女性' | ''
  age?: number
  agency: string
  imageUrl: string
  driveImageUrl?: string
  email: string
  notes: string
  castType: '内部' | '外部'
  slackMentionId?: string
  appearanceCount: number
  isInternal: boolean
}

export interface Casting {
  castingId: string
  accountName: string
  projectName: string
  projectId: string
  roleName: string
  castId: string
  castName: string
  startDate: string // YYYY-MM-DD
  endDate: string
  rank: number
  status: CastingStatus
  note: string
  mainSub: 'メイン' | 'サブ' | 'その他'
  cost: number
  slackThreadTs: string
  slackPermalink: string
  calendarEventId: string
  dbSentStatus: '済' | ''
  isInternal: boolean
  castType: '内部' | '外部'
  email: string
  structureData?: OrderStructure[]
}

export type CastingStatus = 
  | '仮キャスティング' | '打診中' | 'オーダー待ち'
  | 'OK' | '決定' | 'NG' | 'キャンセル' | '条件つきOK'

export interface ShootingContact {
  castingId: string
  account: string
  project: string
  role: string
  castId: string
  castName: string
  date: string
  inTime: string
  outTime: string
  location: string
  address: string
  cost: number
  makingUrl: string
  postDate: string
  mainSub: string
  status: ShootingContactStatus
  castType: '内部' | '外部'
  poUuid?: string
}

export type ShootingContactStatus = 
  | '香盤連絡待ち' | 'メイキング共有待ち' | '投稿日連絡待ち' | '完了'

export interface CartItem {
  castId: string
  cast: Cast
  projectId: string
  projectName: string
  roleName: string
  roleType: 'メイン' | 'サブ' | 'その他'
  note: string
  rank: number
}

export interface OrderStructure {
  castId: string
  castName: string
  type: 'メイン' | 'サブ' | 'その他'
  note: string
}
```

---

## 7. 移行フェーズ

### Phase 1: 基盤構築（1-2週間）
- [ ] Viteプロジェクト初期化
- [ ] PrimeVue設定
- [ ] ルーター設定
- [ ] 認証フロー（Google OAuth）
- [ ] Google Sheets API連携
- [ ] 基本レイアウト（AppHeader, Navigation）

### Phase 2: キャスティング画面（2-3週間）
- [ ] CastCard.vue
- [ ] CastFilter.vue
- [ ] Calendar.vue
- [ ] ShootingList.vue
- [ ] CartModal.vue（ドラッグ&ドロップ）
- [ ] processNewOrder移植

### Phase 3: キャスティング状況画面（2-3週間）
- [ ] CastingStatusView.vue
- [ ] StatusChangeDialog.vue
- [ ] QuickEditModal.vue
- [ ] changeCastingStatus移植
- [ ] カレンダー連携

### Phase 4: 撮影連絡管理画面（2週間）
- [ ] ShootingContactPage.vue
- [ ] ShootingContactTable.vue
- [ ] ShootMailModal.vue
- [ ] OrderDocModal.vue（PDF生成）

### Phase 5: 特別オーダー機能（1週間）
- [ ] SpecialOrderModal.vue
- [ ] EditSpecialOrderModal.vue

### Phase 6: テスト・移行（2週間）
- [ ] E2Eテスト作成
- [ ] 本番データ移行
- [ ] パフォーマンス最適化
- [ ] ドキュメント作成

---

## 8. 注意点・リスク

### 8.1 移行時の注意
1. **Google Sheets APIの維持**: フロントエンドから直接呼び出す現行方式を維持
2. **Slack通知の維持**: バックエンド経由のまま
3. **カレンダー連携**: フロントエンドからGoogle Calendar API直接呼び出し
4. **認証フロー**: Google OAuth 2.0の複雑なフローを正確に再現

### 8.2 複雑なロジック
1. `changeCastingStatus()` - 1584-1838行の複雑なビジネスロジック
2. `processNewOrder()` - 4973-5333行のオーダー処理
3. `saveEditSpecialOrder()` - 6329-6489行の特別オーダー編集

### 8.3 依存関係
- Tailwind CSS（現行使用）→ PrimeVue + カスタムCSS
- jsPDF（PDF生成）→ そのまま使用
- Sortable.js（ドラッグ&ドロップ）→ VueDraggable

---

## 付録A: Slackスレッド検索フォールバック

最近追加された機能。slackThreadTsが見つからない場合の3段階フォールバック：

```javascript
// 1. メモリ（castingData）を検索
const existingRecord = castingData.find(c =>
  c.projectId === searchProjectId && c.slackThreadTs
);

// 2. シート（キャスティングリスト）を検索
const sheetRes = await gapi.client.sheets.spreadsheets.values.get({...})

// 3. Slack APIで検索（NotionリンクでSlackメッセージを探す）
const searchRes = await fetch('/api/slack/search_thread', {...})
```

この機能はVue版でも`useSlack` composableとして実装必要。
