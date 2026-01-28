# カートUI & ドラッグ&ドロップ実装仕様書

## 1. 目的
現行システム（`index.html`）の「キャストプール方式」を完全に再現し、Vue.js でモダンに実装するための仕様書です。
**左側のプールから、右側の「作品・役」エリアへドラッグ&ドロップで配役を行う** UI を実現します。

---

## 2. 画面レイアウト概要

画面は左右の 2 カラム構成とします。

| エリア | 役割 | コンポーネント |
|---|---|---|
| **左カラム (Source)** | **キャストプール**<br>選択した全キャストが一覧表示される待機場所。<br>ここから右側へドラッグして配役を行う。 | `CartCastPool.vue` |
| **右カラム (Target)** | **構成・配役エリア**<br>作品 → 役 → キャスト の階層構造を作成する場所。<br>ドロップされたキャストの順序がそのまま優先順位（ランク）になる。 | `CartProjectList.vue` |

---

## 3. データ構造 (Store 設計)

Pinia ストアで「プール」と「構成（Projects）」を管理します。

### 3.1 `cartStore.ts`

```typescript
export interface CartCast {
  id: string;
  cast: Cast;
  // プール内でのメタデータがあれば追加
}

export interface CartRole {
  id: string;        // UUID
  name: string;      // 役名
  type: 'メイン' | 'サブ' | 'その他';
  note: string;
  castIds: string[]; // 配役されたキャストIDの配列（順序がランク）
}

export interface CartProject {
  id: string;        // UUID
  title: string;     // 作品名
  roles: CartRole[]; // 役リスト
}

export const useCartStore = defineStore('cart', {
  state: () => ({
    pool: {} as Record<string, CartCast>, // ID -> Cast
    projects: [] as CartProject[]
  }),
  
  actions: {
    // プールへの追加
    addToPool(cast: Cast) {
      if (!this.pool[cast.id]) {
        this.pool[cast.id] = { id: cast.id, cast };
      }
    },
    
    // プロジェクト操作
    addProject() { ... },
    addRole(projectId: string) { ... },
    
    // ドラッグ&ドロップ処理 (vuedraggableが配列を更新するため、補助的なアクションのみ)
    removeCastFromRole(projectId: string, roleId: string, castId: string) {
      // 指定されたRoleのcastIdsからcastIdを除去
    }
  }
});
```

---

## 4. コンポーネント実装詳細

### 4.1 全体構成: `CartModal.vue`

```vue
<template>
  <div class="flex h-full">
    <!-- 左カラム: プール -->
    <div class="w-1/4 border-r bg-gray-50 flex flex-col">
      <div class="p-3 font-bold border-b">キャストプール</div>
      <CartCastPool />
    </div>

    <!-- 右カラム: 構成エリア -->
    <div class="w-3/4 bg-white flex flex-col">
      <CartProjectList />
      <!-- プロジェクト追加ボタン等 -->
    </div>
  </div>
</template>
```

### 4.2 ソース（左）: `CartCastPool.vue`

プール内のアイテムは `draggable="true"` 属性を持ち、ドラッグ開始時に `dataTransfer` に ID をセットするか、`vuedraggable` の `kone` モード（複製モード）を使用します。

**推奨: `vuedraggable` の Clone モード**
プールからドラッグしてもプールからは消えず、ドロップ先にコピーされる挙動にします（または移動でも可。現行は「プールに残りつつ配役」ではなく「プールは全量」なので、移動ではなく参照追加のイメージ）。

```vue
<script setup>
import draggable from 'vuedraggable';
import { useCartStore } from '@/stores/cartStore';

const store = useCartStore();
const poolList = computed(() => Object.values(store.pool));
</script>

<template>
  <draggable
    :list="poolList"
    :group="{ name: 'casts', pull: 'clone', put: false }"
    :sort="false"
    item-key="id"
    class="flex-grow overflow-y-auto p-2"
  >
    <template #item="{ element }">
      <div class="p-2 border rounded mb-2 bg-white shadow-sm cursor-move hover:bg-blue-50">
        <div class="font-bold text-sm">{{ element.cast.name }}</div>
      </div>
    </template>
  </draggable>
</template>
```

### 4.3 ターゲット（右）: `CartRoleItem.vue`

各「役」の中にドロップゾーンを設置します。

```vue
<script setup>
import draggable from 'vuedraggable';
// ...
const props = defineProps(['role']);
// role.castIds はIDの配列なので、表示用にCastオブジェクトをMapするComputedが必要
const assignedCasts = computed({
  get: () => props.role.castIds.map(id => store.pool[id]),
  set: (newCasts) => {
    // ドロップされた結果（オブジェクト配列）からID配列に戻して更新
    props.role.castIds = newCasts.map(c => c.id);
  }
});
</script>

<template>
  <div class="border rounded p-3 mb-3">
    <!-- 役情報の入力 -->
    <div class="flex gap-2 mb-2">
      <InputText v-model="role.name" placeholder="役名" />
      <SelectButton v-model="role.type" :options="['メイン', 'その他']" />
    </div>

    <!-- キャストドロップゾーン -->
    <div class="bg-gray-50 p-2 rounded border border-dashed border-gray-300 min-h-[60px]">
      <draggable
        v-model="assignedCasts"
        group="casts"
        item-key="id"
        class="flex flex-wrap gap-2"
      >
        <template #item="{ element, index }">
          <div class="bg-white border rounded px-2 py-1 flex items-center gap-2 shadow-sm">
            <!-- ランク表示: 左から順に第1候補, 第2候補... -->
            <span class="text-xs font-bold text-blue-600">{{ index + 1 }}</span>
            <span class="text-sm">{{ element.cast.name }}</span>
            <button @click="remove(element.id)" class="text-gray-400 hover:text-red-500">×</button>
          </div>
        </template>
      </draggable>
      <div v-if="assignedCasts.length === 0" class="text-gray-400 text-xs text-center">
        ここへキャストをドラッグ
      </div>
    </div>
  </div>
</template>
```

---

## 5. 撮影案件選択時 vs 外部案件

初期化時の `cartStore.projects` の状態を変えることで対応します。

### パターンA: 撮影案件モード
- **初期状態**: `projects` 配列に1つプロジェクトを作成し、`title` に撮影データの情報（チーム名など）をプリセットする。
- **UI**: 作品名は編集可能だが、初期値が入っている状態。

### パターンB: 外部/社内イベントモード
- **初期状態**: `projects` は空、または空のプロジェクトを1つ作成（タイトル空）。
- **UI**: ユーザーが作品名、役名を手動入力する。

---

## 6. オーダー送信データ生成

送信時に、`projects` 配列を走査してフラットなオーダーデータ（`castings` コレクション用）に変換します。

```typescript
// 変換ロジック
const orders = [];
for (const project of store.projects) {
  for (const role of project.roles) {
    role.castIds.forEach((castId, index) => {
      orders.push({
        castId: castId,
        rank: index + 1, // 配列のインデックス+1 がそのままランク（優先順位）になる
        roleName: role.name,
        projectName: project.title,
        mainSub: role.type,
        note: role.note,
        // ...
      });
    });
  }
}
```

この設計により、**「作品 → 役 → (左から)第1, 第2候補」** という階層構造と直感的な並び替え操作を実現します。

