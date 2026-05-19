<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useToast } from 'primevue/usetoast'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase'
import type { Casting } from '@/types'

const props = defineProps<{
  visible: boolean
  castings: Casting[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'done'): void
}>()

const toast = useToast()
const threadUrl = ref('')
const submitting = ref(false)

const visibleLocal = computed({
  get: () => props.visible,
  set: v => emit('update:visible', v)
})

// Slack の permalink フォーマット例:
//   https://gokko.slack.com/archives/C02S1NFRH55/p1779001608723769?thread_ts=1779001608.723769&cid=C02S1NFRH55
// `p` の後ろは "10桁 + 6桁" の連結なので "." を入れ直す
const parsed = computed(() => {
  const url = threadUrl.value.trim()
  if (!url) return null
  const m = url.match(/\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/)
  if (!m) return null
  return { channel: m[1], ts: `${m[2]}.${m[3]}` }
})

watch(() => props.visible, v => {
  if (v) {
    threadUrl.value = ''
    submitting.value = false
  }
})

async function handleSubmit() {
  if (!parsed.value) {
    toast.add({ severity: 'warn', summary: 'スレッド URL が不正', detail: 'Slack の Permalink を貼り付けてください', life: 4000 })
    return
  }
  if (!functions) {
    toast.add({ severity: 'error', summary: 'Functions 未初期化', life: 3000 })
    return
  }
  submitting.value = true
  try {
    const fn = httpsCallable(functions, 'reassignCastingThread')
    const res = await fn({
      castingIds: props.castings.map(c => c.id),
      slackThreadUrl: threadUrl.value.trim(),
      slackThreadTs: parsed.value.ts,
      slackChannel: parsed.value.channel,
    })
    const data = res.data as { updated?: number; shootingsUpdated?: number; error?: string }
    if (data.error) throw new Error(data.error)
    toast.add({
      severity: 'success',
      summary: '差し替え完了',
      detail: `castings ${data.updated || 0} 件 / shootings ${data.shootingsUpdated || 0} 件 を更新`,
      life: 4000
    })
    emit('done')
    visibleLocal.value = false
  } catch (e: any) {
    console.error('reassign thread failed:', e)
    toast.add({ severity: 'error', summary: 'エラー', detail: e?.message || 'スレッド差し替えに失敗しました', life: 5000 })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog v-model:visible="visibleLocal" modal header="スレッド差し替え" :style="{ width: '520px' }">
    <div class="trm-body">
      <p class="trm-help">
        選択した {{ castings.length }} 件のキャスティングを、別の Slack スレッドに紐付け直します。
      </p>
      <ul class="trm-list">
        <li v-for="c in castings.slice(0, 8)" :key="c.id">
          {{ c.castName }} / {{ c.projectName || '—' }}
        </li>
        <li v-if="castings.length > 8" class="trm-more">… 他 {{ castings.length - 8 }} 件</li>
      </ul>
      <label class="trm-label">差し替え先のスレッド URL（Slack の Permalink）</label>
      <InputText v-model="threadUrl" placeholder="https://gokko.slack.com/archives/C…/p…" class="trm-input" />
      <p v-if="threadUrl && !parsed" class="trm-error">URL の形式が認識できませんでした。Slack でメッセージを右クリック→「リンクをコピー」した URL を貼ってください。</p>
      <p v-if="parsed" class="trm-parsed">
        channel: <code>{{ parsed.channel }}</code> / ts: <code>{{ parsed.ts }}</code>
      </p>
    </div>
    <template #footer>
      <Button label="キャンセル" text @click="visibleLocal = false" :disabled="submitting" />
      <Button
        label="差し替え実行"
        icon="pi pi-link"
        :disabled="!parsed || submitting"
        :loading="submitting"
        @click="handleSubmit"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.trm-body { display: flex; flex-direction: column; gap: 0.75rem; }
.trm-help { margin: 0; color: var(--text-color-secondary); font-size: 0.9rem; }
.trm-list {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.85rem;
  color: var(--text-color);
  max-height: 140px;
  overflow-y: auto;
}
.trm-more { color: var(--text-color-secondary); list-style: none; padding-left: 0; }
.trm-label { font-weight: 600; font-size: 0.9rem; }
.trm-input { width: 100%; }
.trm-error { color: var(--red-600); font-size: 0.85rem; margin: 0; }
.trm-parsed { color: var(--green-700); font-size: 0.85rem; margin: 0; }
.trm-parsed code { background: var(--surface-100); padding: 1px 4px; border-radius: 4px; }
</style>
