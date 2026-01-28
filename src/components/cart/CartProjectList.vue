<script setup lang="ts">
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Card from 'primevue/card'
import CartRoleItem from '@/components/cart/CartRoleItem.vue'
import { useOrderStore } from '@/stores/orderStore'

const store = useOrderStore()

const handleAddRole = (projectId: string) => {
  store.addRole(projectId)
}

const handleRemoveRole = (projectId: string, roleId: string) => {
  store.removeRole(projectId, roleId)
}

const handleRemoveProject = (projectId: string) => {
  store.removeProject(projectId)
}

const handleAddProject = () => {
  store.addProject()
}
</script>

<template>
  <div class="project-list">
    <Card 
      v-for="project in store.projects" 
      :key="project.id"
      class="project-card mb-3"
    >
      <template #title>
        <div class="project-header">
          <span class="label">作品:</span>
          <InputText 
            v-model="project.title" 
            placeholder="作品名・イベント名" 
            class="project-title-input"
          />
          <Button 
            icon="pi pi-trash" 
            text 
            rounded
            severity="danger" 
            size="small"
            @click="handleRemoveProject(project.id)"
          />
        </div>
      </template>
      
      <template #content>
        <div class="roles-container">
          <CartRoleItem 
            v-for="role in project.roles"
            :key="role.id"
            :role="role"
            :projectId="project.id"
            @delete="handleRemoveRole(project.id, role.id)"
          />
          
          <Button 
            label="+ 役を追加" 
            icon="pi pi-plus" 
            text 
            size="small"
            class="w-full mt-2"
            @click="handleAddRole(project.id)"
          />
        </div>
      </template>
    </Card>

    <Button 
      label="プロジェクトを追加" 
      icon="pi pi-folder-plus" 
      severity="secondary" 
      outlined 
      class="w-full mb-8"
      @click="handleAddProject"
    />
  </div>
</template>

<style scoped>
.project-list {
  padding: 0.5rem;
  overflow-y: auto;
  height: 100%;
}

.project-card :deep(.p-card-title) {
  padding: 0;
  margin-bottom: 0.5rem;
}

.project-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.project-header .label {
  font-weight: bold;
  font-size: 1rem;
  white-space: nowrap;
}

.project-title-input {
  flex: 1;
}

.roles-container {
  padding-top: 0.25rem;
}
</style>
