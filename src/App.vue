<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterView, RouterLink, useRouter, useRoute } from 'vue-router'
import Menubar from 'primevue/menubar'
import Button from 'primevue/button'
import Badge from 'primevue/badge'
import Toast from 'primevue/toast'
import BackendProgress from '@/components/common/BackendProgress.vue'
import { useCartStore } from '@/stores/cartStore'
import { useAuth } from '@/composables/useAuth'

const router = useRouter()
const route = useRoute()
const cart = useCartStore()
const { isAuthenticated, isAdmin, isActor, userName, signIn, signOut, init } = useAuth()

onMounted(() => {
  init()
})

// いま見ている製品。ref では持たず、パスから決める。
// そうするとリロードでズレず、共有されたURLがそのまま正しい製品で開く
const product = computed<'casty' | 'kouban'>(() =>
  route.path.startsWith('/kouban') ? 'kouban' : 'casty'
)

// 香盤は管理者だけ。アクターや一般には切り替えごと見せない
const canSeeKouban = computed(() => isAdmin.value)

const koubanMenuItems = [
  {
    label: '撮影一覧',
    icon: 'pi pi-calendar',
    command: () => router.push('/kouban')
  }
]

const castyMenuItems = computed(() => {
  // アクターはキャスティング状況のみ（外部案件の作品名・時間変更用の制限ロール）
  const items = isActor.value
    ? [
        {
          label: 'キャスティング状況',
          icon: 'pi pi-chart-bar',
          command: () => router.push('/casting-status')
        }
      ]
    : [
        {
          label: 'キャストを探す',
          icon: 'pi pi-search',
          command: () => router.push('/casting')
        },
        {
          label: 'キャスティング状況',
          icon: 'pi pi-chart-bar',
          command: () => router.push('/casting-status')
        }
      ]

  // 管理者のみ表示するメニュー項目
  if (isAdmin.value) {
    items.push(
      {
        label: '撮影連絡DB',
        icon: 'pi pi-phone',
        command: () => router.push('/shooting-contact')
      },
      {
        label: '管理画面',
        icon: 'pi pi-cog',
        command: () => router.push('/management')
      }
    )
  }

  // ヘルプは全員が閲覧可能
  items.push({
    label: 'ヘルプ',
    icon: 'pi pi-question-circle',
    command: () => router.push('/help')
  })

  return items
})

const menuItems = computed(() =>
  product.value === 'kouban' ? koubanMenuItems : castyMenuItems.value
)
</script>

<template>
  <div class="app-container">
    <Toast />
    <BackendProgress />
    
    <header class="app-header">
      <Menubar :model="menuItems">
        <template #start>
          <div class="brand">
            <RouterLink :to="product === 'kouban' ? '/kouban' : '/'" class="logo">
              <img src="@/assets/casty-logo.png" alt="Casty Ⅱ" class="logo-img" />
            </RouterLink>

            <!-- 製品の切り替え。管理者にだけ出す -->
            <div v-if="canSeeKouban" class="switch" role="tablist" aria-label="製品の切り替え">
              <button
                role="tab" :aria-selected="product === 'casty'"
                :class="{ on: product === 'casty' }"
                @click="router.push('/casting-status')"
              >
                <i class="pi pi-users" aria-hidden="true"></i> Casty
              </button>
              <button
                role="tab" :aria-selected="product === 'kouban'"
                :class="{ on: product === 'kouban' }"
                @click="router.push('/kouban')"
              >
                <i class="pi pi-calendar" aria-hidden="true"></i> 香盤
              </button>
            </div>
          </div>
        </template>
        
        <template #end>
          <div class="header-actions">
            <Button 
              icon="pi pi-shopping-cart"
              severity="secondary"
              text
              rounded
              @click="router.push('/casting')"
            >
              <Badge v-if="cart.count > 0" :value="cart.count" severity="danger" />
            </Button>
            
            <template v-if="isAuthenticated">
              <span class="user-name">{{ userName }}</span>
              <Button 
                label="サインアウト"
                severity="secondary"
                size="small"
                @click="signOut"
              />
            </template>
            <template v-else>
              <Button 
                label="サインイン"
                icon="pi pi-sign-in"
                size="small"
                @click="signIn"
              />
            </template>
          </div>
        </template>
      </Menubar>
    </header>
    
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
  background: var(--p-surface-ground);
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-right: 1rem;
}

.logo {
  text-decoration: none;
  display: flex;
  align-items: center;
}

/* 製品の切り替え。Casty と 香盤 は別の仕事なので、メニューではなくここで分ける */
.switch {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: var(--p-surface-200);
}

.switch button {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.34rem 0.7rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--p-text-muted-color);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.switch button i {
  font-size: 0.78rem;
}

.switch button:hover {
  color: var(--p-text-color);
}

.switch button.on {
  background: var(--p-content-background);
  color: var(--p-primary-color);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.switch button:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

@media (max-width: 640px) {
  .switch button span,
  .logo-img {
    max-width: 100%;
  }
  .brand {
    gap: 0.5rem;
  }
}

.logo-img {
  height: 60px;
  width: auto;
  object-fit: contain;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.user-name {
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
}

.app-main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 1rem;
}
</style>
