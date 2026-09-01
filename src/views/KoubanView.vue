<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import ProgressSpinner from 'primevue/progressspinner'
import Message from 'primevue/message'
import { useKouban } from '@/composables/useKouban'

const router = useRouter()
const { shoots, loading, error, fetchAll } = useKouban()
const keyword = ref('')

onMounted(fetchAll)

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return shoots.value
  return shoots.value.filter(s =>
    [s.title, s.account, s.team, s.date].some(v => (v || '').toLowerCase().includes(k))
  )
})
</script>

<template>
  <div class="kouban-list">
    <div class="page-header">
      <div>
        <h1><i class="pi pi-calendar"></i>香盤</h1>
        <p class="page-sub">
          CLI で組んだ香盤が撮影ごとに並びます。<code>/香盤作成</code> に脚本PDFとNotionのURLを渡すと増えます。
        </p>
      </div>
      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText v-model="keyword" placeholder="作品名・アカウント・日付" />
      </IconField>
    </div>

    <div v-if="loading" class="center">
      <ProgressSpinner style="width: 44px; height: 44px" />
    </div>

    <Message v-else-if="error" severity="error" :closable="false">{{ error }}</Message>

    <Card v-else-if="!shoots.length" class="empty-card">
      <template #content>
        <div class="empty">
          <i class="pi pi-calendar-plus empty-icon"></i>
          <p class="empty-title">まだ香盤がありません</p>
          <p class="empty-body">
            Claude Code で香盤のリポジトリを開いて <code>/香盤作成</code> と打ち、<br />
            脚本PDF と Notion の撮影ページURL を渡してください。
          </p>
        </div>
      </template>
    </Card>

    <div v-else class="grid">
      <Card
        v-for="s in filtered"
        :key="s.id"
        class="shoot-card"
        role="link"
        tabindex="0"
        @click="router.push(`/kouban/${s.id}`)"
        @keydown.enter="router.push(`/kouban/${s.id}`)"
        @keydown.space.prevent="router.push(`/kouban/${s.id}`)"
      >
        <template #content>
          <div class="card-top">
            <span class="date">
              {{ s.date }}<template v-if="s.wday">（{{ s.wday }}）</template>
            </span>
            <Tag
              :value="s.status === '決' ? '決定香盤' : '仮香盤'"
              :severity="s.status === '決' ? 'success' : 'warn'"
            />
          </div>

          <h3 class="shoot-title">{{ s.title || '（作品名なし）' }}</h3>

          <div class="meta">
            <span><i class="pi pi-users"></i> {{ s.account }}</span>
            <span v-if="s.team && s.team !== s.account">{{ s.team }}</span>
            <span v-if="s.studio"><i class="pi pi-map-marker"></i> {{ s.studio }}</span>
          </div>

          <div class="card-foot">
            <span v-if="s.upTime"><i class="pi pi-clock"></i> {{ s.upTime }} アップ</span>
            <span v-if="s.updatedBy" class="by">{{ s.updatedBy }}</span>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.kouban-list {
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}

/* Casty の見出し規約に合わせる（ManagementView / StatusView と同じ） */
.page-header h1 {
  font-size: 1.75rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 0 0.4rem;
}

.page-header h1 i {
  color: var(--p-primary-color);
}

.page-sub {
  margin: 0;
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
  line-height: 1.7;
}

.page-sub code,
.empty-body code {
  background: var(--p-surface-100);
  border-radius: 4px;
  padding: 0.1em 0.4em;
  font-size: 0.95em;
}

.center {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}

.empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--p-text-muted-color);
}

.empty-icon {
  font-size: 2rem;
  opacity: 0.4;
}

.empty-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--p-text-color);
  margin: 0.9rem 0 0.4rem;
}

.empty-body {
  margin: 0;
  line-height: 1.9;
  font-size: 0.88rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 1rem;
}

/* Casty のカードと同じ作法。border を足さず、影で持ち上げる */
.shoot-card {
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.shoot-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.shoot-card:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.date {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  font-variant-numeric: tabular-nums;
}

.shoot-title {
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.45;
  margin: 0.6rem 0 0.5rem;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.9rem;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
}

.meta i,
.card-foot i {
  font-size: 0.72rem;
  margin-right: 0.2rem;
}

.card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.9rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--p-content-border-color);
  font-size: 0.74rem;
  color: var(--p-text-muted-color);
}

.by {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
}
</style>
