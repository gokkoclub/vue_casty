<script setup lang="ts">
import Button from 'primevue/button'
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="home-view">
    <div class="hero">
      <h1>キャスト管理システム</h1>
      <p class="subtitle">キャスティングをもっとスマートに</p>
      
      <div class="actions">
        <Button 
          label="キャストを探す" 
          icon="pi pi-search"
          @click="router.push('/casting')"
          size="large"
        />
        <Button 
          label="キャスティング状況" 
          icon="pi pi-chart-bar"
          @click="router.push('/status')"
          size="large"
          severity="secondary"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-view {
  min-height: calc(100vh - 120px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero {
  text-align: center;
  padding: 2rem;
}

.hero h1 {
  font-size: 3rem;
  font-weight: 700;
  color: var(--p-primary-color);
  margin-bottom: 0.5rem;
}

.subtitle {
  font-size: 1.25rem;
  color: var(--p-text-muted-color);
  margin-bottom: 2rem;
}

.actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
}
</style>
