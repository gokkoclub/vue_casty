<script setup lang="ts">
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Card from 'primevue/card'
import CartRoleItem from '@/components/cart/CartRoleItem.vue'
import { useOrderStore } from '@/stores/orderStore'
import { useAvailability } from '@/composables/useAvailability'
import { computed, watchEffect } from 'vue'

const store = useOrderStore()
const { activeCastings } = useAvailability()

// Extract unique project names from existing castings for the selected dates
const existingProjectNames = computed(() => {
  const names = new Set<string>()
  activeCastings.value.forEach(c => {
    if (c.projectName && c.projectName.trim()) {
      names.add(c.projectName.trim())
    }
  })
  return Array.from(names)
})

// Sync to store for use in getFlattenedOrders fallback
watchEffect(() => {
  store.setExistingProjectNames(existingProjectNames.value)
})

// Get a suggested project name for a given index
const getProjectPlaceholder = (index: number): string => {
  if (existingProjectNames.value.length > 0 && index < existingProjectNames.value.length) {
    return existingProjectNames.value[index]!
  }
  return `${index + 1}作品目のタイトルのみを入力してください`
}


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
      v-for="(project, index) in store.projects" 
      :key="project.id"
      class="project-card mb-3"
    >
      <template #title>
        <div class="project-header">
          <span class="label">作品:</span>
          <div class="project-title-wrapper">
            <InputText 
              v-model="project.title" 
              :placeholder="getProjectPlaceholder(index)" 
              class="project-title-input"
              :class="{ 'has-suggestion': !project.title && existingProjectNames.length > index }"
            />
            <span 
              v-if="!project.title && existingProjectNames.length > index" 
              class="project-suggestion-hint"
            >
              ※ 既存オーダーから自動入力されます
            </span>
          </div>
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

.project-title-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.project-title-input {
  width: 100%;
}

.project-title-input.has-suggestion :deep(input)::placeholder {
  color: var(--p-primary-color);
  opacity: 0.6;
  font-weight: 500;
}

.project-suggestion-hint {
  font-size: 0.7rem;
  color: var(--p-primary-color);
  opacity: 0.7;
}

.roles-container {
  padding-top: 0.25rem;
}
</style>
