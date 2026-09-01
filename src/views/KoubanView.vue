<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Tag from 'primevue/tag'
import InputText from 'primevue/inputtext'
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

const wdayOf = (s: { date: string; wday?: string }) => s.wday || ''
</script>

<template>
  <div class="kouban-list">
    <header class="head">
      <div>
        <h1>香盤</h1>
        <p class="sub">
          CLI で組んだ香盤が撮影ごとに並びます。
          <code>/香盤作成</code> に脚本PDFとNotionのURLを渡すと、ここに増えます。
        </p>
      </div>
      <InputText v-model="keyword" placeholder="作品名・アカウント・日付で絞る" class="search" />
    </header>

    <div v-if="loading" class="center"><ProgressSpinner style="width:44px;height:44px" /></div>

    <Message v-else-if="error" severity="error" :closable="false">{{ error }}</Message>

    <div v-else-if="!shoots.length" class="empty">
      <p class="empty-title">まだ香盤がありません</p>
      <p>
        Claude Code でこのリポジトリを開いて <code>/香盤作成</code> と打ち、<br />
        脚本PDF と Notion の撮影ページURL を渡してください。
      </p>
    </div>

    <div v-else class="grid">
      <button
        v-for="s in filtered"
        :key="s.id"
        class="card"
        @click="router.push(`/kouban/${s.id}`)"
      >
        <div class="card-top">
          <span class="date">{{ s.date }}<small v-if="wdayOf(s)">（{{ wdayOf(s) }}）</small></span>
          <Tag
            :value="s.status === '決' ? '決定香盤' : '仮香盤'"
            :severity="s.status === '決' ? 'success' : 'warn'"
          />
        </div>
        <div class="title">{{ s.title || '（作品名なし）' }}</div>
        <div class="meta">
          <span>{{ s.account }}</span>
          <span v-if="s.team && s.team !== s.account">／ {{ s.team }}</span>
          <span v-if="s.studio">／ {{ s.studio }}</span>
        </div>
        <div class="foot">
          <span v-if="s.upTime">{{ s.upTime }} アップ</span>
          <span v-if="s.updatedBy" class="by">{{ s.updatedBy }}</span>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.kouban-list { max-width: 1100px; margin: 0 auto; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 .25rem; }
.sub { margin: 0; color: var(--p-text-muted-color); font-size: .85rem; line-height: 1.7; }
.sub code { background: var(--p-surface-100); padding: .1em .4em; border-radius: 3px; font-size: .95em; }
.search { min-width: 260px; }
.center { display: flex; justify-content: center; padding: 3rem 0; }
.empty { text-align: center; padding: 3.5rem 1rem; color: var(--p-text-muted-color); line-height: 1.9; }
.empty-title { font-size: 1.05rem; font-weight: 700; color: var(--p-text-color); margin-bottom: .5rem; }
.empty code { background: var(--p-surface-100); padding: .1em .4em; border-radius: 3px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: .9rem; }
.card {
  display: flex; flex-direction: column; gap: .45rem; text-align: left; cursor: pointer;
  background: var(--p-content-background); border: 1px solid var(--p-content-border-color);
  border-radius: 10px; padding: 1rem 1.1rem; font: inherit; color: inherit;
  transition: border-color .15s, transform .15s;
}
.card:hover { border-color: var(--p-primary-color); transform: translateY(-1px); }
.card:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
.card-top { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
.date { font-size: .8rem; color: var(--p-text-muted-color); font-variant-numeric: tabular-nums; }
.date small { font-size: .95em; }
.title { font-size: 1.05rem; font-weight: 700; line-height: 1.4; }
.meta { font-size: .78rem; color: var(--p-text-muted-color); display: flex; flex-wrap: wrap; gap: .3rem; }
.foot {
  display: flex; justify-content: space-between; gap: .5rem; margin-top: .2rem;
  padding-top: .5rem; border-top: 1px solid var(--p-content-border-color);
  font-size: .72rem; color: var(--p-text-muted-color);
}
.by { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55%; }
</style>
