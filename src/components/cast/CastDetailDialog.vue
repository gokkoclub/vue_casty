<script setup lang="ts">
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import type { Cast } from '@/types'
import { useOrderStore } from '@/stores/orderStore'
import { convertDriveUrlToImage, getPlaceholderImage } from '@/utils/imageUrl'
import { Timestamp } from 'firebase/firestore'

const props = defineProps<{
  visible: boolean
  cast: Cast | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const store = useOrderStore()

const imageUrl = computed(() => {
  if (!props.cast?.imageUrl) return getPlaceholderImage()
  return convertDriveUrlToImage(props.cast.imageUrl)
})

const isInCart = computed(() => 
  props.cast ? !!store.pool[props.cast.id] : false
)

const age = computed(() => {
  if (!props.cast?.dateOfBirth) return null
  let dob: Date
  if (props.cast.dateOfBirth instanceof Timestamp) {
    dob = props.cast.dateOfBirth.toDate()
  } else if (typeof props.cast.dateOfBirth === 'string' && props.cast.dateOfBirth) {
    dob = new Date(props.cast.dateOfBirth)
  } else {
    return null
  }
  if (isNaN(dob.getTime())) return null
  const today = new Date()
  let a = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) a--
  return a > 0 && a < 120 ? a : null
})

const handleAddToCart = () => {
  if (props.cast && !isInCart.value) {
    store.addItem(props.cast)
    emit('update:visible', false)
  }
}

const openSns = (url: string) => {
  if (url) {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`
    window.open(fullUrl, '_blank')
  }
}
</script>

<template>
  <Dialog 
    :visible="visible" 
    @update:visible="emit('update:visible', $event)"
    modal
    :showHeader="false"
    :style="{ width: '600px', maxWidth: '95vw' }"
    :dismissableMask="true"
    class="cast-popup"
  >
    <div v-if="cast" class="cast-detail">
      <!-- 閉じるボタン -->
      <button class="close-btn" @click="emit('update:visible', false)">
        <i class="pi pi-times"></i>
      </button>

      <!-- ヘッダー: 写真 + 基本情報 -->
      <div class="detail-header">
        <div class="image-container">
          <img 
            :src="imageUrl" 
            :alt="cast.name"
            class="cast-image"
            @error="($event.target as HTMLImageElement).src = getPlaceholderImage()"
          />
        </div>
        <div class="basic-info">
          <h2 class="cast-name">{{ cast.name }}</h2>
          <p class="agency">{{ cast.agency || '' }}</p>

          <!-- SNSアイコン -->
          <div class="sns-icons" v-if="cast.snsX || cast.snsInstagram || cast.snsTikTok">
            <button v-if="cast.snsX" class="sns-icon-btn" @click="openSns(cast.snsX!)">
              <svg viewBox="0 0 24 24" width="20" height="20"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor"/></svg>
            </button>
            <button v-if="cast.snsInstagram" class="sns-icon-btn" @click="openSns(cast.snsInstagram!)">
              <i class="pi pi-instagram" style="font-size: 1.25rem"></i>
            </button>
            <button v-if="cast.snsTikTok" class="sns-icon-btn" @click="openSns(cast.snsTikTok!)">
              <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1 0-5.78 2.92 2.92 0 0 1 .88.13v-3.5a6.37 6.37 0 0 0-6.37 6.37A6.37 6.37 0 0 0 10.37 22a6.37 6.37 0 0 0 6.37-6.37V9.65a8.16 8.16 0 0 0 4.85 1.56V7.76a4.78 4.78 0 0 1-2-1.07z" fill="currentColor"/></svg>
            </button>
          </div>

          <!-- 詳細テーブル -->
          <table class="info-table">
            <tr v-if="age">
              <th>年齢</th>
              <td>{{ age }}歳</td>
            </tr>
            <tr>
              <th>性別</th>
              <td>{{ cast.gender || '-' }}</td>
            </tr>
            <tr>
              <th>連絡先</th>
              <td>{{ cast.email || '-' }}</td>
            </tr>
            <tr>
              <th>備考</th>
              <td>{{ cast.notes || '-' }}</td>
            </tr>
          </table>
        </div>
      </div>

      <!-- 仮キャスティングリストに追加ボタン -->
      <Button 
        :label="isInCart ? '仮キャスティングリストに追加済み' : '仮キャスティングリストに追加'"
        :icon="isInCart ? 'pi pi-check' : undefined"
        :disabled="isInCart"
        :severity="isInCart ? 'secondary' : undefined"
        @click="handleAddToCart"
        class="add-btn"
      />
    </div>
  </Dialog>
</template>

<style scoped>
.cast-popup :deep(.p-dialog-content) {
  padding: 2.5rem 3rem;
}

.cast-detail {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.close-btn {
  position: absolute;
  top: -0.5rem;
  right: -0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.25rem;
  color: var(--p-text-muted-color);
  padding: 0.25rem;
  z-index: 1;
}

.close-btn:hover {
  color: var(--p-text-color);
}

.detail-header {
  display: flex;
  gap: 2rem;
}

.image-container {
  flex-shrink: 0;
  width: 200px;
  height: 200px;
}

.cast-image {
  width: 200px;
  height: 200px;
  object-fit: cover;
  border-radius: 50%;
  background: var(--p-surface-200);
}

.basic-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.cast-name {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: var(--p-text-color);
}

.agency {
  color: var(--p-text-muted-color);
  margin: 0 0 0.25rem 0;
  font-size: 0.9rem;
}

/* SNS Icons */
.sns-icons {
  display: flex;
  gap: 0.75rem;
  margin: 0.25rem 0 0.5rem;
}

.sns-icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  color: var(--p-text-color);
  display: flex;
  align-items: center;
  transition: opacity 0.2s;
}

.sns-icon-btn:hover {
  opacity: 0.6;
}

/* Info Table */
.info-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.25rem;
}

.info-table th,
.info-table td {
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--p-surface-200);
  font-size: 0.875rem;
  text-align: left;
}

.info-table th {
  color: var(--p-text-muted-color);
  font-weight: 600;
  width: 80px;
  white-space: nowrap;
}

.info-table td {
  color: var(--p-text-color);
}

/* Add Button */
.add-btn {
  width: 100%;
  font-size: 1rem;
  padding: 0.875rem;
  border-radius: 8px;
}

@media (max-width: 480px) {
  .detail-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  
  .sns-icons {
    justify-content: center;
  }
  
  .image-container {
    width: 160px;
    height: 160px;
  }
  
  .cast-image {
    width: 160px;
    height: 160px;
  }
}
</style>
