<script setup lang="ts">
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import type { CartItem, OrderContext } from '@/types'
import { useOrderStore } from '@/stores/orderStore'
import { convertDriveUrlToImage, getPlaceholderImage } from '@/utils/imageUrl'

const props = defineProps<{
  item: CartItem
  index: number
  mode: OrderContext['mode']
}>()

const store = useOrderStore()

const mainSubOptions = [
  { label: 'メイン', value: 'メイン' },
  { label: 'サブ', value: 'サブ' },
  { label: 'その他', value: 'その他' }
]

const getImageUrl = (imageUrl: string) => {
  if (!imageUrl) return getPlaceholderImage()
  return convertDriveUrlToImage(imageUrl)
}

const handleRemove = () => {
  store.removeItem(props.item.tempId)
}
</script>

<template>
  <div class="cart-row">
    <!-- ハンドル -->
    <div class="drag-handle">
      <i class="pi pi-bars"></i>
    </div>

    <!-- ランク -->
    <div class="rank-col">
      <Tag :value="`第${index + 1}候補`" severity="info" rounded class="rank-tag"></Tag>
    </div>

    <!-- キャスト情報 -->
    <div class="cast-info">
      <img 
        :src="getImageUrl(item.cast.imageUrl)"
        :alt="item.cast.name"
        class="cast-thumb"
        @error="($event.target as HTMLImageElement).src = getPlaceholderImage()"
      />
      <div class="info-text">
        <div class="cast-name">{{ item.cast.name }}</div>
        <div class="agency-name">{{ item.cast.agency }}</div>
      </div>
    </div>

    <!-- 入力フォームエリア (Shooting Mode) -->
    <div v-if="mode === 'shooting'" class="input-area">
      <div class="row-inputs">
        <InputText 
          v-model="item.roleName" 
          placeholder="役名" 
          class="role-input" 
          size="small"
        />
        <Select
          v-model="item.mainSub"
          :options="mainSubOptions"
          optionLabel="label"
          optionValue="value"
          class="type-select"
          size="small"
        />
      </div>
      <InputText 
        v-model="item.note" 
        placeholder="備考" 
        class="note-input" 
        size="small"
      />
    </div>

    <!-- 入力フォームエリア (External/Internal Mode) -->
    <!-- Simplified: No specific inputs per cast required usually, but maybe note? -->
    <div v-else class="input-area text-sm text-gray-500 flex items-center">
       <span class="ml-2">ー</span>
    </div>

    <!-- 削除ボタン -->
    <Button 
      icon="pi pi-trash" 
      text 
      severity="danger" 
      class="delete-btn"
      @click="handleRemove" 
    />
  </div>
</template>

<style scoped>
.cart-row {
  display: flex;
  align-items: flex-start; /* Align top for inputs */
  padding: 0.75rem;
  border-bottom: 1px solid var(--p-surface-200);
  background: var(--p-surface-0);
  gap: 0.75rem;
}

.cart-row:last-child {
  border-bottom: none;
}

.drag-handle {
  cursor: grab;
  color: var(--p-text-muted-color);
  padding-top: 0.5rem;
}
.drag-handle:active {
  cursor: grabbing;
}

.rank-col {
  padding-top: 0.25rem;
  width: 70px;
  flex-shrink: 0;
}
.rank-tag {
  font-size: 0.75rem;
}

.cast-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 60px;
  flex-shrink: 0;
  gap: 0.25rem;
}

.cast-thumb {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  object-fit: cover;
}

.info-text {
  text-align: center;
}
.cast-name {
  font-weight: 700;
  font-size: 0.8rem;
  line-height: 1.2;
}
.agency-name {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  display: none; /* Hide agency to save space if needed, or keep small */
}

.input-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.row-inputs {
  display: flex;
  gap: 0.5rem;
}

.role-input {
  flex: 1;
  min-width: 0;
}

.type-select {
  width: 90px;
}

.note-input {
  width: 100%;
}

.delete-btn {
  padding-top: 0.5rem;
}
</style>
