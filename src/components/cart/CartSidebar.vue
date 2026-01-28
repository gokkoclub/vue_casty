<script setup lang="ts">
import { computed, ref } from 'vue'
import Drawer from 'primevue/drawer'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import Badge from 'primevue/badge'
import InputText from 'primevue/inputtext'
import CartCastPool from './CartCastPool.vue'
import CartProjectList from './CartProjectList.vue'
import SimpleCastList from './SimpleCastList.vue'
import { useOrderStore } from '@/stores/orderStore'

const store = useOrderStore()

const modeLabel = computed(() => {
  if (store.context.mode === 'shooting') return '撮影オーダー'
  if (store.context.mode === 'external') return '外部案件'
  if (store.context.mode === 'internal') return '社内イベント'
  return 'オーダー'
})

// PDF upload handling
const uploadedPdf = ref<File | null>(null)

const handlePdfUpload = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files && target.files[0]) {
    uploadedPdf.value = target.files[0]
  }
}

// Emit events to parent
const emit = defineEmits<{
  submit: [pdfFile?: File | null]
}>()

const handleSubmit = () => {
  emit('submit', uploadedPdf.value)
}
</script>

<template>
  <Drawer
    v-model:visible="store.cartVisible"
    position="right"
    :style="{ width: '900px' }"
    header=""
    class="cart-drawer"
  >
    <template #header>
      <div class="cart-title">
        <h2>{{ modeLabel }}</h2>
      </div>
    </template>

    <div class="cart-layout">
        <!-- Header Info Area -->
        <div class="cart-header mb-2 px-2">
             <div class="date-tags mb-2">
                <span class="text-sm font-bold mr-2">選択日程:</span>
                <Badge 
                    v-for="date in store.context.dateRanges" 
                    :key="date" 
                    :value="date" 
                    severity="contrast"
                    class="mr-1"
                />
            </div>
            
            <!-- Metadata Fields (mode-dependent) -->
            <div v-if="!store.isShootingMode" class="metadata-inputs mt-3">
                <!-- External Event Mode -->
                <div v-if="store.context.mode === 'external'" class="flex flex-col gap-2">
                    <div>
                        <label class="block text-xs font-bold mb-1">案件タイトル *</label>
                        <InputText 
                            v-model="store.manualMeta.projectName"
                            placeholder="例: PR動画撮影"
                            class="w-full"
                            size="small"
                        />
                    </div>
                    <div class="flex gap-2">
                        <div class="flex-1">
                            <label class="block text-xs font-bold mb-1">開始時間</label>
                            <InputText 
                                v-model="store.manualMeta.startTime"
                                placeholder="例: 10:00"
                                class="w-full"
                                size="small"
                            />
                        </div>
                        <div class="flex-1">
                            <label class="block text-xs font-bold mb-1">終了時間</label>
                            <InputText 
                                v-model="store.manualMeta.endTime"
                                placeholder="例: 18:00"
                                class="w-full"
                                size="small"
                            />
                        </div>
                    </div>
                </div>
                
                <!-- Internal Event Mode -->
                <div v-if="store.context.mode === 'internal'" class="flex flex-col gap-2">
                    <div>
                        <label class="block text-xs font-bold mb-1">イベントタイトル *</label>
                        <InputText 
                            v-model="store.manualMeta.projectName"
                            placeholder="例: 社内研修会"
                            class="w-full"
                            size="small"
                        />
                    </div>
                    <div class="flex gap-2">
                        <div class="flex-1">
                            <label class="block text-xs font-bold mb-1">開始時間</label>
                            <InputText 
                                v-model="store.manualMeta.startTime"
                                placeholder="例: 14:00"
                                class="w-full"
                                size="small"
                            />
                        </div>
                        <div class="flex-1">
                            <label class="block text-xs font-bold mb-1">終了時間</label>
                            <InputText 
                                v-model="store.manualMeta.endTime"
                                placeholder="例: 17:00"
                                class="w-full"
                                size="small"
                            />
                        </div>
                    </div>
                </div>
            </div>
            

            <Divider class="my-2" />
        </div>

        <!-- Body: Conditional rendering based on mode -->
        <div class="cart-body">
            <!-- Shooting mode: Full cart with pool + projects -->
            <template v-if="store.isShootingMode">
                <div class="col-left">
                    <CartCastPool />
                </div>
                <div class="col-right">
                    <CartProjectList />
                </div>
            </template>

            <!-- External/Internal mode: Simple cast list -->
            <template v-else>
                <SimpleCastList />
            </template>
        </div>

        <!-- Footer -->
        <div class="cart-footer">
            <div class="summary mb-3">
                <strong>選択中: </strong>{{ store.count }}件のキャスト
            </div>
            
            <!-- PDF Upload (shooting mode only) -->
            <div v-if="store.isShootingMode" class="mb-3">
                <label class="block text-sm font-bold mb-2">脚本PDF（任意）</label>
                <input 
                    type="file" 
                    accept=".pdf"
                    @change="handlePdfUpload"
                    class="w-full text-sm"
                />
                <p v-if="uploadedPdf" class="text-xs mt-1 text-green-600">
                    ✓ {{ uploadedPdf.name }}
                </p>
            </div>
            
            <Button 
                label="オーダー送信" 
                @click="handleSubmit"
                icon="pi pi-check"
                :disabled="store.count === 0"
                severity="success"
                class="w-full"
            />
        </div>
    </div>
  </Drawer>
</template>

<style scoped>
.cart-drawer :deep(.p-drawer-header) {
  padding: 1rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.cart-title h2 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.cart-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.cart-header {
  flex-shrink: 0;
}

.cart-body {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 1rem;
  padding: 0 1rem;
  min-height: 0;
}

.cart-body:has(> .simple-cast-list) {
  grid-template-columns: 1fr;
}

.col-left, .col-right {
  min-height: 0;
  overflow-y: auto;
}

.cart-footer {
  flex-shrink: 0;
  padding: 1rem;
  border-top: 1px solid var(--surface-border);
}

.metadata-inputs {
  background: var(--surface-50);
  padding: 0.75rem;
  border-radius: 6px;
}

.date-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.summary {
  font-size: 1.1rem;
  text-align: center;
}
</style>
