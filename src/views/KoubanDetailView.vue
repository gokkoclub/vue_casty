<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import ProgressSpinner from 'primevue/progressspinner'
import { useToast } from 'primevue/usetoast'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import KoubanEditor from '@/components/kouban/KoubanEditor.vue'
import { useAuth } from '@/composables/useAuth'
import Dialog from 'primevue/dialog'
import { useKouban, renderKouban, saveKouban, publishKouban, clonePayload,
         type KoubanRosterRow, type PublishResult } from '@/composables/useKouban'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const { userName } = useAuth()
const { shoot, roster, versions, loading, error, fetchOne } = useKouban()

const html = ref('')
const rendering = ref(false)

// 編集中の中身。保存するまで Firestore には書かない
const draft = ref<Record<string, any> | null>(null)
const dirty = ref(false)
const saving = ref(false)

/** 編集のたびに、その場で香盤を描き直す。出来上がりを見ながら直せる */
async function preview(p: Record<string, any>) {
  draft.value = p
  dirty.value = true
  try {
    html.value = await renderKouban(p)
  } catch (e) {
    console.error('[kouban] 下書きの描画に失敗', e)
  }
}

async function save(note = '') {
  if (!shoot.value || !draft.value) return
  saving.value = true
  try {
    await saveKouban(shoot.value.id, draft.value, userName.value || 'unknown', note)
    dirty.value = false
    await load()
    toast.add({ severity: 'success', summary: '保存しました', detail: '版を1つ残しました', life: 3000 })
  } catch (e) {
    console.error('[kouban] 保存に失敗', e)
    toast.add({
      severity: 'error', summary: '保存できませんでした',
      detail: e instanceof Error ? e.message : 'もう一度お試しください', life: 6000
    })
  } finally {
    saving.value = false
  }
}

// ── Casty へ送る。まず試算を見せて、それから送る
const plan = ref<PublishResult | null>(null)
const planOpen = ref(false)
const sending = ref(false)

async function preflight() {
  if (!shoot.value) return
  sending.value = true
  try {
    plan.value = await publishKouban(shoot.value.id, true)
    planOpen.value = true
  } catch (e) {
    console.error('[kouban] 試算に失敗', e)
    toast.add({
      severity: 'error', summary: '試算できませんでした',
      detail: e instanceof Error ? e.message : '', life: 6000
    })
  } finally {
    sending.value = false
  }
}

async function send() {
  if (!shoot.value) return
  sending.value = true
  try {
    const r = await publishKouban(shoot.value.id, false)
    planOpen.value = false
    await load()
    toast.add({
      severity: 'success', summary: 'Casty に送りました',
      detail: `${r.matched}人ぶんを反映しました`, life: 4000
    })
  } catch (e) {
    console.error('[kouban] 送信に失敗', e)
    toast.add({
      severity: 'error', summary: '送れませんでした',
      detail: e instanceof Error ? e.message : '', life: 6000
    })
  } finally {
    sending.value = false
  }
}

/** 決定香盤にする。ここから Casty に流れるので、押す前に確かめる */
function decide() {
  const p = draft.value ?? shoot.value?.payload
  if (!p) return
  confirm.require({
    header: '決定香盤にしますか',
    message: '関係者に共有できる状態になります。あとから仮に戻すこともできます。',
    acceptLabel: '決定にする',
    rejectLabel: 'やめる',
    accept: async () => {
      const next = clonePayload(p) as Record<string, any>
      next.head = { ...(next.head ?? {}), fixed: true }
      draft.value = next
      html.value = await renderKouban(next)
      await save('決定香盤にした')
    }
  })
}

async function load() {
  await fetchOne(String(route.params.shootId))
  draft.value = null
  dirty.value = false
  if (!shoot.value) return
  rendering.value = true
  try {
    html.value = await renderKouban(shoot.value.payload)
  } catch (e) {
    console.error('[kouban] 描画に失敗', e)
    html.value = ''
    toast.add({
      severity: 'error',
      summary: '香盤を表示できません',
      detail: 'テンプレートが読めませんでした',
      life: 4000
    })
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

async function copyShare() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    toast.add({ severity: 'success', summary: '共有リンクをコピーしました', life: 2000 })
  } catch {
    toast.add({
      severity: 'warn',
      summary: 'コピーできませんでした',
      detail: shareUrl.value,
      life: 6000
    })
  }
}

const MATCH: Record<string, { label: string; severity: string }> = {
  auto: { label: '照合ずみ', severity: 'success' },
  manual: { label: '手で結んだ', severity: 'success' },
  pending: { label: '未照合', severity: 'secondary' },
  unmatched: { label: '当たらない', severity: 'warn' },
  ambiguous: { label: '要選択', severity: 'warn' }
}
const matchOf = (r: KoubanRosterRow) => MATCH[r.matchStatus] ?? { label: r.matchStatus, severity: 'secondary' }
</script>

<template>
  <div class="kouban-detail">
    <ConfirmDialog />
    <div v-if="loading" class="center">
      <ProgressSpinner style="width: 44px; height: 44px" />
    </div>

    <template v-else-if="error">
      <Button label="香盤の一覧へ" icon="pi pi-arrow-left" text @click="router.push('/kouban')" />
      <Message severity="warn" :closable="false">{{ error }}</Message>
    </template>

    <template v-else-if="shoot">
      <div class="page-header">
        <div class="head-left">
          <Button
            icon="pi pi-arrow-left" label="一覧" text size="small"
            @click="router.push('/kouban')"
          />
          <div>
            <div class="crumb">
              {{ shoot.date }}<template v-if="shoot.wday">（{{ shoot.wday }}）</template>
              ／ {{ shoot.account }}
              <template v-if="shoot.studio">／ {{ shoot.studio }}</template>
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
            v-if="dirty" label="保存" icon="pi pi-check" size="small" :loading="saving"
            @click="save()"
          />
          <Button
            v-if="shoot.status !== '決'" label="決定香盤にする" icon="pi pi-flag-fill"
            size="small" severity="success" outlined :disabled="saving" @click="decide"
          />
          <Button
            v-if="shoot.status === '決'" label="Casty に送る" icon="pi pi-send"
            size="small" severity="success" :loading="sending" :disabled="dirty"
            @click="preflight"
          />
          <Button
            v-if="shareUrl" label="共有リンク" icon="pi pi-link" size="small" outlined
            @click="copyShare"
          />
          <Button
            v-if="shoot.notionUrl" label="Notion" icon="pi pi-external-link" size="small" text
            @click="openNotion"
          />
        </div>
      </div>

      <Message v-if="dirty" severity="info" :closable="false" class="attention">
        直したところがまだ保存されていません。「保存」を押すと版が1つ残ります。
      </Message>

      <Message v-if="needsAttention.length" severity="warn" :closable="false" class="attention">
        Casty のキャスティングと結びついていない配役が {{ needsAttention.length }} 件あります。
        「配役」で確かめてください。
      </Message>

      <Tabs value="0">
        <TabList>
          <Tab value="0">
            <div class="tab-header"><i class="pi pi-table"></i><span>香盤</span></div>
          </Tab>
          <Tab value="1">
            <div class="tab-header"><i class="pi pi-pencil"></i><span>編集</span></div>
          </Tab>
          <Tab value="2">
            <div class="tab-header">
              <i class="pi pi-users"></i><span>配役</span>
              <Tag :value="String(roster.length)" severity="secondary" />
            </div>
          </Tab>
          <Tab value="3">
            <div class="tab-header">
              <i class="pi pi-history"></i><span>履歴</span>
              <Tag :value="String(versions.length)" severity="secondary" />
            </div>
          </Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="0">
          <div v-if="rendering" class="center">
            <ProgressSpinner style="width: 36px; height: 36px" />
          </div>
          <!-- CLI が出す PDF と同じテンプレートで描く。だから見た目がズレない -->
          <iframe v-else :srcdoc="html" title="香盤" class="frame"></iframe>
          </TabPanel>

          <TabPanel value="1">
          <KoubanEditor :payload="draft ?? shoot.payload" @update="preview" />
          </TabPanel>

          <TabPanel value="2">
          <DataTable :value="roster" size="small" stripedRows>
            <Column field="roleName" header="役">
              <template #body="{ data }"><strong>{{ data.roleName }}</strong></template>
            </Column>
            <Column field="castName" header="キャスト" />
            <Column header="入り">
              <template #body="{ data }"><span class="num">{{ data.callTime || '-' }}</span></template>
            </Column>
            <Column header="出">
              <template #body="{ data }"><span class="num">{{ data.outTime || '-' }}</span></template>
            </Column>
            <Column header="メイク">
              <template #body="{ data }">{{ data.makeup === 'studio' ? 'スタジオ' : '自前' }}</template>
            </Column>
            <Column header="シーン">
              <template #body="{ data }">
                <span class="num">{{ data.scenes?.length ?? 0 }}本</span>
              </template>
            </Column>
            <Column header="Casty">
              <template #body="{ data }">
                <Tag :value="matchOf(data).label" :severity="matchOf(data).severity" />
              </template>
            </Column>
          </DataTable>
          <p class="note">
            「当たらない」「要選択」は、名前が違うか、1日2作品で同じ役名が2つあるときに出ます。
            <strong>勝手に選ばず、人に確かめる</strong>ようにしています。
          </p>
          </TabPanel>

          <TabPanel value="3">
          <div class="versions">
            <Card v-for="v in versions" :key="v.id" class="version">
              <template #content>
                <div class="v-top">
                  <strong class="num">{{ v.id }}</strong>
                  <Tag :value="v.source === 'cli' ? 'CLI' : 'アプリ'" severity="secondary" />
                  <Tag
                    :value="v.status === '決' ? '決定' : '仮'"
                    :severity="v.status === '決' ? 'success' : 'warn'"
                  />
                  <span class="who">{{ v.createdBy }}</span>
                </div>
                <p v-if="v.note" class="v-note">{{ v.note }}</p>
                <div v-if="v.changes?.length" class="v-changes">
                  <span class="v-count">{{ v.changes.length }}か所</span>
                  <code v-for="c in v.changes.slice(0, 5)" :key="c.path">{{ c.path }}</code>
                  <span v-if="v.changes.length > 5">ほか</span>
                </div>
                <p v-else class="v-changes muted">変更なし</p>
              </template>
            </Card>
          </div>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <!-- Casty へ送る前の試算。何人に当たって、何が食い違うかを見せてから送る -->
      <Dialog v-model:visible="planOpen" modal header="Casty に送る" :style="{ width: '38rem' }">
        <template v-if="plan">
          <div class="plan-counts">
            <div class="cnt ok">
              <b>{{ plan.matched }}</b><span>人に反映</span>
            </div>
            <div class="cnt" :class="{ warn: plan.unmatched > 0 }">
              <b>{{ plan.unmatched }}</b><span>当たらない</span>
            </div>
            <div class="cnt" :class="{ warn: plan.ambiguous > 0 }">
              <b>{{ plan.ambiguous }}</b><span>要選択</span>
            </div>
            <div class="cnt" :class="{ warn: plan.conflicts > 0 }">
              <b>{{ plan.conflicts }}</b><span>食い違い</span>
            </div>
          </div>

          <p class="plan-note">
            Casty のキャスティング {{ plan.castings }}件のうち、生きている
            {{ plan.live }}件だけが対象です。NG・キャンセルには触れません。
            <strong>入り時間は空のときだけ入れます。</strong>手で入れた値は残ります。
          </p>

          <div v-if="plan.conflictRows?.length" class="plan-block">
            <h4>時刻が食い違っています（上書きしません）</h4>
            <div v-for="c in plan.conflictRows" :key="c.castName" class="plan-row">
              <span>{{ c.castName }}</span>
              <span class="num">香盤 {{ c.kouban }} ／ Casty {{ c.casty }}</span>
            </div>
          </div>

          <div v-if="plan.unmatchedRows?.length" class="plan-block">
            <h4>当たらなかった配役</h4>
            <div v-for="u in plan.unmatchedRows" :key="u.roleName" class="plan-row">
              <span>{{ u.roleName }}　{{ u.castName }}</span>
            </div>
          </div>
        </template>

        <template #footer>
          <Button label="やめる" text @click="planOpen = false" />
          <Button label="送る" icon="pi pi-send" severity="success"
                  :loading="sending" @click="send" />
        </template>
      </Dialog>
    </template>
  </div>
</template>

<style scoped>
.kouban-detail {
  max-width: 1200px;
  margin: 0 auto;
}

.center {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.head-left {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}

.crumb {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  font-variant-numeric: tabular-nums;
}

/* Casty の見出し規約に合わせる（ManagementView / StatusView と同じ） */
.page-header h1 {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 0.2rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.actions {
  display: flex;
  gap: 0.5rem;
}

.attention {
  margin-bottom: 1rem;
}

/* ManagementView のタブ見出しと同じ形 */
.tab-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.frame {
  width: 100%;
  height: 76vh;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: #fff;
}

.num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.note {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  margin: 1rem 0 0;
  line-height: 1.8;
}

.plan-counts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.6rem;
  margin-bottom: 1rem;
}

.cnt {
  text-align: center;
  padding: 0.7rem 0.3rem;
  border-radius: 8px;
  background: var(--p-surface-100);
}

.cnt b {
  display: block;
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
}

.cnt span {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
}

.cnt.ok b { color: var(--p-primary-color); }
.cnt.warn b { color: var(--p-orange-500, #f59e0b); }

.plan-note {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  line-height: 1.8;
  margin: 0 0 1rem;
}

.plan-block h4 {
  font-size: 0.82rem;
  font-weight: 700;
  margin: 0 0 0.4rem;
}

.plan-block {
  margin-top: 1rem;
  padding-top: 0.8rem;
  border-top: 1px solid var(--p-content-border-color);
}

.plan-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.8rem;
  padding: 0.25rem 0;
}

.versions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.version {
  transition: box-shadow 0.2s;
}

.version:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.v-top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: 0.85rem;
}

.who {
  color: var(--p-text-muted-color);
  font-size: 0.78rem;
}

.v-note {
  font-size: 0.86rem;
  margin: 0.5rem 0 0;
}

.v-changes {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  margin: 0.5rem 0 0;
}

.v-changes.muted {
  opacity: 0.7;
}

.v-count {
  font-weight: 700;
}

.v-changes code {
  background: var(--p-surface-100);
  border-radius: 4px;
  padding: 0.1em 0.4em;
  font-size: 0.95em;
}
</style>
