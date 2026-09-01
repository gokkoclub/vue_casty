<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import { useToast } from 'primevue/usetoast'
import { useKouban, renderKouban } from '@/composables/useKouban'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { shoot, roster, versions, loading, error, fetchOne } = useKouban()

const html = ref('')
const rendering = ref(false)
const tab = ref<'kouban' | 'cast' | 'history'>('kouban')

async function load() {
  await fetchOne(String(route.params.shootId))
  if (!shoot.value) return
  rendering.value = true
  try {
    html.value = await renderKouban(shoot.value.payload)
  } catch (e) {
    console.error('[kouban] 描画に失敗', e)
    toast.add({ severity: 'error', summary: '表示できません', detail: '香盤のテンプレートが読めませんでした', life: 4000 })
  } finally {
    rendering.value = false
  }
}
onMounted(load)
watch(() => route.params.shootId, load)

const shareUrl = computed(() =>
  shoot.value?.shareToken ? `${location.origin}/k/${shoot.value.shareToken}` : ''
)

/** 照合できていない配役。黙って落とさず、ここに出す */
const needsAttention = computed(() =>
  roster.value.filter(r => r.matchStatus === 'unmatched' || r.matchStatus === 'ambiguous')
)

function openNotion() {
  if (shoot.value?.notionUrl) window.open(shoot.value.notionUrl, '_blank', 'noopener')
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ severity: 'success', summary: `${what}をコピーしました`, life: 2000 })
  } catch {
    toast.add({ severity: 'warn', summary: 'コピーできませんでした', detail: text, life: 6000 })
  }
}

const statusLabel: Record<string, string> = {
  auto: '照合ずみ', manual: '手で結んだ', pending: '未照合',
  unmatched: '当たらない', ambiguous: '要選択',
}
</script>

<template>
  <div class="detail">
    <div v-if="loading" class="center"><ProgressSpinner style="width:44px;height:44px" /></div>

    <template v-else-if="error">
      <Button label="香盤の一覧へ" icon="pi pi-arrow-left" text @click="router.push('/kouban')" />
      <Message severity="warn" :closable="false">{{ error }}</Message>
    </template>

    <template v-else-if="shoot">
      <header class="head">
        <div class="head-left">
          <Button label="一覧" icon="pi pi-arrow-left" text size="small" @click="router.push('/kouban')" />
          <div>
            <div class="crumb">
              {{ shoot.date }}<span v-if="shoot.wday">（{{ shoot.wday }}）</span>
              ／ {{ shoot.account }}
              <span v-if="shoot.studio">／ {{ shoot.studio }}</span>
            </div>
            <h1>
              {{ shoot.title }}
              <Tag
                :value="shoot.status === '決' ? '決定香盤' : '仮香盤'"
                :severity="shoot.status === '決' ? 'success' : 'warn'"
              />
            </h1>
          </div>
        </div>
        <div class="actions">
          <Button
            v-if="shareUrl" label="共有リンク" icon="pi pi-link" size="small" outlined
            @click="copy(shareUrl, '共有リンク')"
          />
          <Button
            v-if="shoot.notionUrl" label="Notion" icon="pi pi-external-link" size="small" text
            @click="openNotion"
          />
        </div>
      </header>

      <Message v-if="needsAttention.length" severity="warn" :closable="false" class="attention">
        Casty のキャスティングと結びついていない配役が {{ needsAttention.length }} 件あります。
        「配役」タブで確かめてください。
      </Message>

      <nav class="tabs">
        <button :class="{ on: tab === 'kouban' }" @click="tab = 'kouban'">香盤</button>
        <button :class="{ on: tab === 'cast' }" @click="tab = 'cast'">配役 {{ roster.length }}</button>
        <button :class="{ on: tab === 'history' }" @click="tab = 'history'">履歴 {{ versions.length }}</button>
      </nav>

      <!-- 香盤そのもの。CLI・PDF・共有リンクと同じテンプレートで描く -->
      <section v-show="tab === 'kouban'" class="pane">
        <div v-if="rendering" class="center"><ProgressSpinner style="width:36px;height:36px" /></div>
        <iframe v-else :srcdoc="html" title="香盤" class="frame"></iframe>
      </section>

      <section v-show="tab === 'cast'" class="pane">
        <table class="tbl">
          <thead>
            <tr>
              <th>役</th><th>キャスト</th><th>入り</th><th>出</th>
              <th>メイク</th><th>シーン</th><th>Casty</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in roster" :key="r.id">
              <td class="k">{{ r.roleName }}</td>
              <td>{{ r.castName }}</td>
              <td class="n">{{ r.callTime || '-' }}</td>
              <td class="n">{{ r.outTime || '-' }}</td>
              <td>{{ r.makeup === 'studio' ? 'スタジオ' : '自前' }}</td>
              <td class="n">{{ r.scenes?.length ?? 0 }}本</td>
              <td>
                <Tag
                  :value="statusLabel[r.matchStatus] || r.matchStatus"
                  :severity="r.matchStatus === 'auto' || r.matchStatus === 'manual' ? 'success'
                    : r.matchStatus === 'pending' ? 'secondary' : 'warn'"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p class="note">
          「当たらない」「要選択」は、名前が違うか、1日2作品で同じ役名が2つあるときに出ます。
          <strong>勝手に選ばず、人に確かめる</strong>ようにしています。
        </p>
      </section>

      <section v-show="tab === 'history'" class="pane">
        <ol class="versions">
          <li v-for="v in versions" :key="v.id">
            <div class="v-top">
              <b>{{ v.id }}</b>
              <Tag :value="v.source === 'cli' ? 'CLI' : 'アプリ'" severity="secondary" />
              <Tag :value="v.status === '決' ? '決定' : '仮'"
                   :severity="v.status === '決' ? 'success' : 'warn'" />
              <span class="who">{{ v.createdBy }}</span>
            </div>
            <div v-if="v.note" class="v-note">{{ v.note }}</div>
            <div v-if="v.changes?.length" class="v-changes">
              {{ v.changes.length }}か所
              <span v-for="c in v.changes.slice(0, 4)" :key="c.path" class="chg">{{ c.path }}</span>
              <span v-if="v.changes.length > 4">ほか</span>
            </div>
            <div v-else class="v-changes muted">変更なし</div>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail { max-width: 1180px; margin: 0 auto; }
.center { display: flex; justify-content: center; padding: 3rem 0; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: .9rem; }
.head-left { display: flex; gap: .5rem; align-items: flex-start; }
.crumb { font-size: .78rem; color: var(--p-text-muted-color); font-variant-numeric: tabular-nums; }
h1 { font-size: 1.4rem; font-weight: 700; margin: .15rem 0 0; display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
.actions { display: flex; gap: .5rem; }
.attention { margin-bottom: .8rem; }

.tabs { display: flex; gap: .25rem; border-bottom: 1px solid var(--p-content-border-color); margin-bottom: 1rem; }
.tabs button {
  background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer;
  padding: .55rem .9rem; font: inherit; font-size: .88rem; color: var(--p-text-muted-color);
}
.tabs button.on { color: var(--p-primary-color); border-bottom-color: var(--p-primary-color); font-weight: 700; }
.tabs button:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: -2px; }

.frame { width: 100%; height: 78vh; border: 1px solid var(--p-content-border-color); border-radius: 8px; background: #fff; }

.tbl { width: 100%; border-collapse: collapse; font-size: .86rem; }
.tbl th {
  text-align: left; font-size: .7rem; letter-spacing: .06em; color: var(--p-text-muted-color);
  padding: 0 .8rem .5rem 0; border-bottom: 1px solid var(--p-content-border-color); white-space: nowrap;
}
.tbl td { padding: .6rem .8rem .6rem 0; border-bottom: 1px solid var(--p-content-border-color); }
.tbl td.k { font-weight: 700; white-space: nowrap; }
.tbl td.n { font-variant-numeric: tabular-nums; white-space: nowrap; }
.note { font-size: .78rem; color: var(--p-text-muted-color); margin-top: 1rem; line-height: 1.8; }

.versions { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .7rem; }
.versions li { border: 1px solid var(--p-content-border-color); border-radius: 8px; padding: .7rem .9rem; }
.v-top { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; font-size: .82rem; }
.v-top b { font-variant-numeric: tabular-nums; }
.who { color: var(--p-text-muted-color); font-size: .78rem; }
.v-note { font-size: .84rem; margin-top: .35rem; }
.v-changes { font-size: .76rem; color: var(--p-text-muted-color); margin-top: .35rem; display: flex; gap: .4rem; flex-wrap: wrap; }
.v-changes.muted { opacity: .7; }
.chg { background: var(--p-surface-100); border-radius: 3px; padding: .05em .4em; font-family: ui-monospace, monospace; }
</style>
