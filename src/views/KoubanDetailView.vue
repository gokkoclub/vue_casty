<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import ProgressSpinner from 'primevue/progressspinner'
import { useToast } from 'primevue/usetoast'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import KoubanEditor from '@/components/kouban/KoubanEditor.vue'
import { useAuth } from '@/composables/useAuth'
import { useKouban, renderKouban, saveKouban, type KoubanRosterRow } from '@/composables/useKouban'

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
      const next = structuredClone(p) as Record<string, any>
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

      <TabView>
        <TabPanel value="0">
          <template #header>
            <div class="tab-header"><i class="pi pi-table"></i><span>香盤</span></div>
          </template>
          <div v-if="rendering" class="center">
            <ProgressSpinner style="width: 36px; height: 36px" />
          </div>
          <!-- CLI が出す PDF と同じテンプレートで描く。だから見た目がズレない -->
          <iframe v-else :srcdoc="html" title="香盤" class="frame"></iframe>
        </TabPanel>

        <TabPanel value="1">
          <template #header>
            <div class="tab-header"><i class="pi pi-pencil"></i><span>編集</span></div>
          </template>
          <KoubanEditor :payload="draft ?? shoot.payload" @update="preview" />
        </TabPanel>

        <TabPanel value="2">
          <template #header>
            <div class="tab-header">
              <i class="pi pi-users"></i><span>配役</span>
              <Tag :value="String(roster.length)" severity="secondary" />
            </div>
          </template>
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
          <template #header>
            <div class="tab-header">
              <i class="pi pi-history"></i><span>履歴</span>
              <Tag :value="String(versions.length)" severity="secondary" />
            </div>
          </template>
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
      </TabView>
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
