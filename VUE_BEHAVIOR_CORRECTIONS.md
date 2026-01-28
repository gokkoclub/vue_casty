# Vue実装 修正指示書（Behavior Corrections）

## 目的
現在進行中のVue実装に対して、既存システム（`index.html` / `main.py`）の細かい挙動を完全再現するための修正指示書です。

---

## 🔧 修正項目一覧

### 1. カレンダーの詳細挙動

#### 1.1 日付選択の仕様
**現行の挙動:**
```javascript
// index.html: 2224-2243行目
// - 過去の日付はグレーアウト(cursor-not-allowed)で選択不可
// - 今日はtext-red-600で赤表示
// - 選択中の日付はbg-blue-500で青背景
// - クリックでトグル選択（複数選択可能）
```

**修正指示 (Vue実装):**
```vue
<!-- CalendarView.vue -->
<template>
  <div class="calendar-grid">
    <div 
      v-for="day in calendarDays" 
      :key="day.date"
      :class="getDayClasses(day)"
      @click="!day.isPast && toggleDate(day.date)"
    >
      {{ day.day }}
    </div>
  </div>
</template>

<script setup>
const getDayClasses = (day) => {
  const classes = ['p-2', 'rounded-md'];
  
  if (day.isPast) {
    // 過去日: グレーアウト、選択不可
    classes.push('text-gray-400', 'cursor-not-allowed');
  } else {
    classes.push('cursor-pointer', 'hover:bg-blue-200', 'calendar-day');
    
    if (day.isSelected) {
      // 選択中: 青背景+白文字
      classes.push('bg-blue-500', 'text-white');
    } else if (day.isToday) {
      // 今日: 赤文字+太字
      classes.push('text-red-600', 'font-semibold');
    }
  }
  
  return classes.join(' ');
};

// 日付のトグル選択
const toggleDate = (dateStr) => {
  const index = selectedDates.value.indexOf(dateStr);
  if (index > -1) {
    selectedDates.value.splice(index, 1);
  } else {
    selectedDates.value.push(dateStr);
  }
};
</script>
```

#### 1.2 過去日の判定ロジック
```typescript
// utils/dateUtils.ts
export const toEpochDay = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 86400000);
};

export const isPastDate = (ymd: string): boolean => {
  const today = new Date();
  const todayEpoch = toEpochDay(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  );
  return toEpochDay(ymd) < todayEpoch;
};
```

---

### 2. 撮影リスト選択/解除の挙動

#### 2.1 撮影選択のトグル動作
**現行の挙動:**
```javascript
// index.html: 2460-2469行目
btn.addEventListener('click', () => {
  if (isSelected) {
    // 既に選択中の場合: 選択解除
    selectedShooting = null;
  } else {
    // 未選択の場合: 選択
    selectedShooting = item;
  }
  renderShootingList(); // 再描画
  updateCartFromShooting(); // カート情報を更新
});
```

**修正指示 (Vue実装):**
```vue
<!-- ShootingList.vue -->
<script setup>
import { ref, computed, watch } from 'vue';
import { useOrderStore } from '@/stores/orderStore';

const orderStore = useOrderStore();
const selectedShooting = ref(null);

const selectShooting = (shooting) => {
  if (selectedShooting.value?.id === shooting.id) {
    // 同じものをクリック: 選択解除
    selectedShooting.value = null;
    orderStore.clearShootingContext();
  } else {
    // 新規選択
    selectedShooting.value = shooting;
    orderStore.setShootingContext(shooting);
  }
};

// 日付が変更されたら選択をリセット
watch(() => orderStore.selectedDates, () => {
  selectedShooting.value = null;
  orderStore.clearShootingContext();
});
</script>

<template>
  <div v-for="shooting in matchedShootings" :key="shooting.id">
    <div 
      :class="[
        'p-3 border rounded-md cursor-pointer transition flex flex-col gap-1',
        selectedShooting?.id === shooting.id
          ? 'bg-blue-100 border-blue-500 ring-1 ring-blue-500'
          : 'bg-white hover:bg-gray-50 border-gray-200'
      ]"
      @click="selectShooting(shooting)"
    >
      <div class="font-bold text-sm">{{ shooting.title }}</div>
      <div class="text-xs text-gray-500 flex justify-between">
        <span>{{ shooting.date }}</span>
        <span>{{ shooting.team }}</span>
      </div>
    </div>
  </div>
</template>
```

#### 2.2 日付選択が0件の場合の挙動
```javascript
// index.html: 2412-2417行目
if (selectedDates.length === 0) {
  container.innerHTML = `<p>日付を選択すると、候補の撮影が表示されます。</p>`;
  selectedShooting = null;
  updateCartFromShooting();
  return;
}
```

**修正指示:**
```vue
<div v-if="selectedDates.length === 0" class="text-gray-500 text-sm">
  日付を選択すると、候補の撮影が表示されます。
</div>
<div v-else-if="matchedShootings.length === 0" class="text-gray-500 text-sm">
  選択された日付の撮影予定はありません。
</div>
```

---

### 3. カート内の詳細挙動

#### 3.1 カートプロジェクトの初期化タイミング
**現行の挙動:**
```javascript
// index.html: 5097-5103行目
function initCartProjects() {
  if (cartProjects.length === 0) {
    for (let i = 0; i < 2; i++) {
      window.addCartProject(); // デフォルトで2作品分を初期化
    }
  }
}
```

**修正指示:**
```typescript
// stores/cartStore.ts
export const useCartStore = defineStore('cart', {
  state: () => ({
    projects: [] as CartProject[]
  }),
  
  actions: {
    initializeProjects() {
      if (this.projects.length === 0) {
        // デフォルトで2作品分
        for (let i = 0; i < 2; i++) {
          this.addProject();
        }
      }
    },
    
    addProject() {
      const newProj = {
        id: crypto.randomUUID(),
        title: '',
        roles: []
      };
      // デフォルトで3役分
      for (let i = 0; i < 3; i++) {
        newProj.roles.push({
          id: crypto.randomUUID(),
          name: '',
          type: 'その他',
          note: '',
          castIds: []
        });
      }
      this.projects.push(newProj);
    }
  }
});
```

#### 3.2 撮影選択時のカート自動更新
**現行の挙動:**
```javascript
// index.html: 2475-2490行目
function updateCartFromShooting() {
  if (selectedShooting) {
    cartMeta.account = selectedShooting.team;
    cartMeta.notionUrl = selectedShooting.pageId ? `https://www.notion.so/${selectedShooting.pageId.replace(/-/g, '')}` : '';
    cartMeta.projectNames[0] = selectedShooting.title;

    // カートプロジェクトがまだ空なら初期化
    if (cartProjects.length === 0) {
      window.addCartProject();
      cartProjects[0].title = selectedShooting.title;
    } else if (cartProjects.length === 1 && !cartProjects[0].title) {
      cartProjects[0].title = selectedShooting.title;
    }
  }
}
```

**修正指示:**
```typescript
// stores/orderStore.ts
export const useOrderStore = defineStore('order', {
  actions: {
    setShootingContext(shooting: Shooting) {
      this.context = {
        mode: 'shooting',
        accountName: shooting.team,
        projectId: shooting.pageId,
        projectName: shooting.title,
        director: shooting.cd,
        floorDirector: shooting.fd
      };
      
      // カートストアを更新
      const cartStore = useCartStore();
      if (cartStore.projects.length === 0) {
        cartStore.initializeProjects();
      }
      
      // 最初のプロジェクトのタイトルが空なら自動入力
      if (cartStore.projects.length > 0 && !cartStore.projects[0].title) {
        cartStore.projects[0].title = shooting.title;
      }
    },
    
    clearShootingContext() {
      this.context = null;
    }
  }
});
```

#### 3.3 作品削除の制限
**現行の挙動:**
```javascript
// index.html: 5104-5113行目
window.removeCartProject = function (pid) {
  // 作品数が1つ以下の場合は削除させない
  if (cartProjects.length <= 1) {
    showMessage('作品はこれ以上削除できません。', 'error');
    return;
  }
  cartProjects = cartProjects.filter(p => p.id !== pid);
  renderCartModal();
};
```

**修正指示:**
```vue
<!-- CartProjectList.vue -->
<template>
  <div v-for="project in projects" :key="project.id">
    <!-- 作品数が2以上の場合のみ削除ボタンを有効化 -->
    <Button 
      icon="pi pi-trash"
      :disabled="projects.length <= 1"
      @click="removeProject(project.id)"
      :title="projects.length <= 1 ? 'これ以上削除できません' : '作品を削除'"
    />
  </div>
</template>

<script setup>
const removeProject = (id: string) => {
  if (cartStore.projects.length <= 1) {
    toast.add({ 
      severity: 'error', 
      summary: 'エラー', 
      detail: '作品はこれ以上削除できません。' 
    });
    return;
  }
  cartStore.removeProject(id);
};
</script>
```

---

### 4. ドラッグ&ドロップの詳細挙動

#### 4.1 プールからのクローンドラッグ
**現行の挙動:**
```javascript
// index.html: 5154-5192行目
// プールからドラッグしても、プールからキャストは消えない
// ドロップゾーンに追加されるだけ（参照追加）
```

**修正指示:**
```vue
<!-- CartCastPool.vue -->
<draggable
  :list="poolList"
  :group="{ name: 'casts', pull: 'clone', put: false }"
  :sort="false"
  item-key="id"
  class="flex-grow overflow-y-auto p-2"
>
  <!-- pull: 'clone' でプールからは消えない -->
  <!-- put: false でプールへのドロップは不可 -->
</draggable>
```

#### 4.2 役へのドロップと重複チェック
**現行の挙動:**
```javascript
// index.html: 5184-5189行目
const role = findRole(pid, rid);
if (role && !role.castIds.includes(castId)) {
  role.castIds.push(castId); // 既に配役済みなら追加しない
  renderCartModal();
}
```

**修正指示:**
```vue
<!-- CartRoleDropZone.vue -->
<script setup>
const handleDrop = (event) => {
  const newCasts = event.added?.element;
  if (newCasts && props.role.castIds.includes(newCasts.id)) {
    // 重複チェック: 既に配役されているキャストは追加しない
    const index = props.role.castIds.indexOf(newCasts.id);
    props.role.castIds.splice(index, 1);
  }
};
</script>

<draggable
  v-model="assignedCasts"
  group="casts"
  item-key="id"
  @change="handleDrop"
>
</draggable>
```

---

### 5. Cloud Functions / Firestore連携

#### 5.1 オーダー送信前のバリデーション
**現行の挙動:**
```javascript
// index.html: 2493-2500行目
async function submitNewOrder() {
  // 1. 認証チェック
  const isAuth = await ensureAuth();
  if (!isAuth) {
    alert("ログアウト状態のため送信できません。");
    return;
  }
  // 2. カート内容のバリデーション
  // ...
}
```

**修正指示:**
```typescript
// composables/useOrders.ts
export function useOrders() {
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  
  const submitOrder = async () => {
    // 1. 認証チェック
    if (!isAuthenticated.value) {
      toast.add({
        severity: 'error',
        summary: 'エラー',
        detail: 'ログアウト状態のため送信できません。再ログインしてください。'
      });
      return;
    }
    
    // 2. カート内容のバリデーション
    const validation = validateCart();
    if (!validation.valid) {
      toast.add({
        severity: 'error',
        summary: 'エラー',
        detail: validation.message
      });
      return;
    }
    
    // 3. Firestore書き込み + Cloud Function呼び出し
    await createOrderInFirestore();
  };
  
  return { submitOrder };
}
```

#### 5.2 Firestore書き込み処理の分離
**DB操作は全てcomposableまたはCloud Functionsで実行:**

```typescript
// composables/useCastings.ts
export function useCastings() {
  const createOrder = async (orderData: OrderPayload) => {
    const batch = writeBatch(db);
    const now = Timestamp.now();
    const castingIds: string[] = [];
    
    // 1. Firestoreに書き込み (複数ドキュメント)
    for (const item of orderData.items) {
      for (const dateRange of orderData.dateRanges) {
        const castingRef = doc(collection(db, 'castings'));
        castingIds.push(castingRef.id);
        
        batch.set(castingRef, {
          // データ構造は型定義通り
          accountName: orderData.accountName,
          projectName: item.projectName,
          projectId: orderData.projectId,
          // ...
          createdAt: now,
          updatedAt: now
        });
      }
    }
    
    await batch.commit();
    
    // 2. Cloud Function呼び出し (Slack通知)
    const notifyOrder = httpsCallable(functions, 'notifyOrderCreated');
    const result = await notifyOrder(orderData);
    
    // 3. slackThreadTsを更新
    const updateBatch = writeBatch(db);
    for (const id of castingIds) {
      updateBatch.update(doc(db, 'castings', id), {
        slackThreadTs: result.data.ts,
        slackPermalink: result.data.permalink
      });
    }
    await updateBatch.commit();
    
    return { success: true, castingIds };
  };
  
  return { createOrder };
}
```

---

## 📋 チェックリスト（実装者向け）

### カレンダー
- [ ] 過去日がグレーアウトされ、選択不可になっている
- [ ] 今日の日付が赤文字で表示されている
- [ ] 選択中の日付が青背景+白文字になっている
- [ ] 日付をクリックするとトグル選択できる（選択中をクリックすると解除）

### 撮影リスト
- [ ] 日付未選択時に「日付を選択すると...」メッセージが表示される
- [ ] 選択中の撮影をクリックすると選択解除できる
- [ ] 撮影選択時にカートの最初のプロジェクト名が自動入力される
- [ ] 日付を変更すると撮影選択がリセットされる

### カート
- [ ] 初期表示時に2作品、各3役が自動作成される
- [ ] 作品が1つのときは削除ボタンが無効化される
- [ ] プールからドラッグしてもプールからキャストが消えない
- [ ] 同じキャストを同じ役に2回ドロップしても重複しない
- [ ] 役内のキャスト順序が左から第1候補、第2候補となる

### データ連携
- [ ] 全てのDB操作がcomposableで実行されている（Vueコンポーネントに直接書かれていない）
- [ ] Firestore書き込み後にCloud Functionが呼ばれている
- [ ] エラー時に適切なToast通知が表示される
