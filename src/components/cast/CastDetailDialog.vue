<script setup lang="ts">
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import type { Cast } from '@/types'
import { useOrderStore } from '@/stores/orderStore'
import { convertDriveUrlToImage, getPlaceholderImage } from '@/utils/imageUrl'

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

const handleAddToCart = () => {
  if (props.cast && !isInCart.value) {
    store.addItem(props.cast) // This calls addToPool internally
    // Close dialog after adding
    emit('update:visible', false)
  }
}

const openSns = (url: string) => {
  if (url) {
    // Add https:// if missing
    const fullUrl = url.startsWith('http') ? url : `https://${url}`
    window.open(fullUrl, '_blank')
  }
}
</script>

<template>
  <Dialog 
    :visible="visible" 
    @update:visible="emit('update:visible', $event)"
    :header="cast?.name || 'キャスト詳細'"
    modal
    :style="{ width: '600px', maxWidth: '95vw' }"
    :dismissableMask="true"
  >
    <div v-if="cast" class="cast-detail">
      <!-- ヘッダー部分 -->
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
          <p class="agency">{{ cast.agency || '事務所未登録' }}</p>
          <div class="tags">
            <Tag 
              :value="cast.castType" 
              :severity="cast.castType === '内部' ? 'info' : 'secondary'" 
            />
            <Tag 
              :value="cast.gender || '未設定'" 
              severity="contrast"
            />
            <Tag 
              v-if="cast.appearanceCount > 0"
              :value="`出演回数: ${cast.appearanceCount}回`" 
              severity="success"
            />
          </div>
        </div>
      </div>

      <!-- 詳細情報 -->
      <div class="detail-content">
        <!-- 連絡先 -->
        <div v-if="cast.email" class="info-row">
          <i class="pi pi-envelope"></i>
          <a :href="`mailto:${cast.email}`">{{ cast.email }}</a>
        </div>

        <!-- Slack -->
        <div v-if="cast.slackMentionId" class="info-row">
          <i class="pi pi-slack"></i>
          <span>Slack: @{{ cast.slackMentionId }}</span>
        </div>

        <!-- SNSリンク -->
        <div class="sns-links" v-if="cast.snsX || cast.snsInstagram || cast.snsTikTok">
          <Button 
            v-if="cast.snsX"
            icon="pi pi-twitter"
            label="X"
            severity="secondary"
            outlined
            size="small"
            @click="openSns(cast.snsX!)"
          />
          <Button 
            v-if="cast.snsInstagram"
            icon="pi pi-instagram"
            label="Instagram"
            severity="secondary"
            outlined
            size="small"
            @click="openSns(cast.snsInstagram!)"
          />
          <Button 
            v-if="cast.snsTikTok"
            icon="pi pi-video"
            label="TikTok"
            severity="secondary"
            outlined
            size="small"
            @click="openSns(cast.snsTikTok!)"
          />
        </div>

        <!-- メモ -->
        <div v-if="cast.notes" class="notes-section">
          <h4>メモ</h4>
          <p class="notes">{{ cast.notes }}</p>
        </div>
      </div>
    </div>

    <template #footer>
      <Button 
        label="閉じる" 
        severity="secondary"
        @click="emit('update:visible', false)" 
      />
      <Button 
        :label="isInCart ? 'カートに追加済み' : 'カートに追加'"
        :icon="isInCart ? 'pi pi-check' : 'pi pi-plus'"
        :disabled="isInCart"
        @click="handleAddToCart"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.cast-detail {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.detail-header {
  display: flex;
  gap: 1.5rem;
}

.image-container {
  flex-shrink: 0;
}

.cast-image {
  width: 150px;
  height: 200px;
  object-fit: cover;
  border-radius: 8px;
  background: var(--p-surface-200);
}

.basic-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.cast-name {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
  color: var(--p-text-color);
}

.agency {
  color: var(--p-text-muted-color);
  margin: 0;
}

.tags {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--p-text-color);
}

.info-row i {
  color: var(--p-text-muted-color);
  width: 20px;
}

.info-row a {
  color: var(--p-primary-color);
  text-decoration: none;
}

.info-row a:hover {
  text-decoration: underline;
}

.sns-links {
  display: flex;
  gap: 0.5rem;
}

.notes-section h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.notes {
  margin: 0;
  padding: 0.75rem;
  background: var(--p-surface-100);
  border-radius: 6px;
  font-size: 0.875rem;
  white-space: pre-wrap;
}

@media (max-width: 480px) {
  .detail-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  
  .tags {
    justify-content: center;
  }
}
</style>
