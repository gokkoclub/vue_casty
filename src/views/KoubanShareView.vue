<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { collection, query, where, limit, getDocs } from 'firebase/firestore'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Card from 'primevue/card'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import { db } from '@/services/firebase'
import { useAuth } from '@/composables/useAuth'
import { renderKouban, type KoubanShoot } from '@/composables/useKouban'

/**
 * 共有リンクで見る香盤。撮影ごとに1本のトークンで開く。
 *
 * 読み取り専用。配役の一覧も版の履歴も出さない。香盤そのものだけ。
 * ログインは要る（Casty に入るのと同じ）。GOKKO のアカウントであれば
 * 管理者でなくても見られる。
 */

const route = useRoute()
const { isAuthenticated, loading: authLoading, signIn, init } = useAuth()

const shoot = ref<KoubanShoot | null>(null)
const html = ref('')
const loading = ref(true)
const notFound = ref(false)

async function load() {
  if (!db || !isAuthenticated.value) return
  loading.value = true
  notFound.value = false
  try {
    const snap = await getDocs(query(
      collection(db, 'shoots'),
      where('shareToken', '==', String(route.params.token)),
      limit(1)
    ))
    if (snap.empty) {
      notFound.value = true
      return
    }
    const d = snap.docs[0]!
    shoot.value = { id: d.id, ...d.data() } as KoubanShoot
    html.value = await renderKouban(shoot.value.payload)
  } catch (e) {
    console.error('[kouban] 共有リンクの読み込みに失敗', e)
    notFound.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  init()
  if (isAuthenticated.value) load()
  else loading.value = false
})
watch(isAuthenticated, v => { if (v) load() })
watch(() => route.params.token, load)
</script>

<template>
  <div class="share">
    <div v-if="authLoading || loading" class="center">
      <ProgressSpinner style="width: 44px; height: 44px" />
    </div>

    <!-- ログインしていない。Casty に入るのと同じ扱い -->
    <Card v-else-if="!isAuthenticated" class="gate">
      <template #content>
        <div class="gate-body">
          <i class="pi pi-lock gate-icon"></i>
          <h1>香盤を見るにはサインインが必要です</h1>
          <p>GOKKO の Google アカウントでサインインしてください。</p>
          <Button label="Google でサインイン" icon="pi pi-sign-in" @click="signIn" />
        </div>
      </template>
    </Card>

    <Message v-else-if="notFound" severity="warn" :closable="false">
      この共有リンクは見つかりませんでした。リンクが作り直された可能性があります。
      撮影の担当者に新しいリンクをもらってください。
    </Message>

    <template v-else-if="shoot">
      <div class="page-header">
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
        <span class="readonly"><i class="pi pi-eye"></i> 閲覧のみ</span>
      </div>

      <iframe :srcdoc="html" title="香盤" class="frame"></iframe>
    </template>
  </div>
</template>

<style scoped>
.share {
  max-width: 1200px;
  margin: 0 auto;
}

.center {
  display: flex;
  justify-content: center;
  padding: 4rem 0;
}

.gate {
  max-width: 460px;
  margin: 3rem auto;
}

.gate-body {
  text-align: center;
  padding: 1.5rem 1rem;
}

.gate-icon {
  font-size: 2rem;
  opacity: 0.35;
}

.gate-body h1 {
  font-size: 1.15rem;
  font-weight: 700;
  margin: 1rem 0 0.5rem;
}

.gate-body p {
  font-size: 0.88rem;
  color: var(--p-text-muted-color);
  margin: 0 0 1.5rem;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.crumb {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  font-variant-numeric: tabular-nums;
}

.page-header h1 {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 0.2rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.readonly {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  padding-top: 0.5rem;
}

.frame {
  width: 100%;
  height: 80vh;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: #fff;
}
</style>
