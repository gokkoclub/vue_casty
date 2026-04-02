<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterView, RouterLink, useRouter } from 'vue-router'
import Menubar from 'primevue/menubar'
import Button from 'primevue/button'
import Badge from 'primevue/badge'
import Toast from 'primevue/toast'
import BackendProgress from '@/components/common/BackendProgress.vue'
import { useCartStore } from '@/stores/cartStore'
import { useAuth } from '@/composables/useAuth'

const router = useRouter()
const cart = useCartStore()
const { isAuthenticated, isAdmin, userName, signIn, signOut, init } = useAuth()

onMounted(() => {
  init()
})

const menuItems = computed(() => {
  const items = [
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
</script>

<template>
  <div class="app-container">
    <Toast />
    <BackendProgress />
    
    <header class="app-header">
      <Menubar :model="menuItems">
        <template #start>
          <RouterLink to="/" class="logo">
            <img src="@/assets/casty-logo.png" alt="Casty Ⅱ" class="logo-img" />
          </RouterLink>
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

.logo {
  text-decoration: none;
  margin-right: 1rem;
  display: flex;
  align-items: center;
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
