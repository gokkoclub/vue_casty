<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import type { Cast } from '@/types'
import type { CastBooking } from '@/utils/castStatusUtils'
import { useOrderStore } from '@/stores/orderStore'
import { convertDriveUrlToImage, getPlaceholderImage } from '@/utils/imageUrl'

const props = defineProps<{
  cast: Cast
  bookings?: CastBooking[] | null
  isBlocked?: boolean
}>()

const emit = defineEmits<{
  click: [cast: Cast]
  add: [cast: Cast]
}>()

const store = useOrderStore()

// Debug logging
onMounted(() => {
  if (props.bookings && props.bookings.length > 0) {
    console.log(`[CastCard] ${props.cast.name} has ${props.bookings.length} bookings:`, props.bookings)
  }
})

const imageUrl = computed(() => {
  if (!props.cast.imageUrl) return getPlaceholderImage()
  return convertDriveUrlToImage(props.cast.imageUrl)
})

const isInCart = computed(() => 
  !!store.pool[props.cast.id]
)

const isDisabled = computed(() => {
  return props.isBlocked || isInCart.value
})

const handleAddToCart = () => {
  if (!isDisabled.value) {
    emit('add', props.cast)
  }
}

const handleImageError = (event: Event) => {
  const target = event.target as HTMLImageElement
  target.src = getPlaceholderImage()
}
</script>

<template>
  <Card 
    class="cast-card" 
    @click="emit('click', cast)"
  >
    <template #header>
      <div class="header-wrapper">
        <img 
          :src="imageUrl" 
          :alt="cast.name"
          class="cast-image"
          @error="handleImageError"
          loading="lazy"
        />
        <!-- Booking badges overlaid on image -->
        <div v-if="bookings && bookings.length > 0" class="booking-badges">
          <Tag
            v-for="(booking, index) in bookings"
            :key="index"
            :value="booking.displayLabel"
            :severity="booking.severity"
            class="booking-tag"
          />
        </div>
      </div>
    </template>
    <template #title>
      <div class="card-title">{{ cast.name }}</div>
    </template>
    <template #subtitle>
      {{ cast.agency || '事務所未登録' }}
    </template>
    <template #footer>
      <Button 
        :label="isInCart ? '選択済み' : '仮キャスティング'"
        :icon="isInCart ? 'pi pi-check' : 'pi pi-plus'"
        :disabled="isDisabled"
        :severity="isInCart ? 'success' : 'primary'"
        @click.stop="handleAddToCart"
        size="small"
        class="w-full"
      />
    </template>
  </Card>
</template>

<style scoped>
.cast-card {
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  height: 380px;
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.cast-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
}

.booking-badges {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}

.header-wrapper {
  position: relative;
  overflow: visible;
}

.booking-tag {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.3rem 0.6rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(4px);
  border-radius: 6px;
}

.cast-image {
  width: 100%;
  height: 200px;
  object-fit: cover;
}

.card-title {
  font-weight: 600;
  font-size: 1rem;
}

:deep(.p-card-body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 0.75rem;
}

:deep(.p-card-title) {
  margin-bottom: 0.25rem;
}

:deep(.p-card-subtitle) {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
  margin-bottom: 0.5rem;
}

:deep(.p-card-footer) {
  padding: 0.75rem;
  padding-top: 0;
}
</style>
