import { defineStore } from 'pinia'
import type { Cast, OrderContext, CartCast, CartProject } from '@/types'
import { ref, computed } from 'vue'

export const useOrderStore = defineStore('order', () => {
    // State
    const pool = ref<Record<string, CartCast>>({})
    const projects = ref<CartProject[]>([])

    const context = ref<OrderContext>({
        mode: null,
        shootingData: null,
        dateRanges: []
    })

    // Manual metadata for non-shooting modes (used as default for new projects)
    const manualMeta = ref({
        projectName: '',
        accountName: '',
        startTime: '',
        endTime: ''
    })

    const cartVisible = ref(false)

    // Getters
    const count = computed(() => Object.keys(pool.value).length)

    const isShootingMode = computed(() => context.value.mode === 'shooting')

    const displayProjectName = computed(() => {
        if (context.value.mode === 'shooting' && context.value.shootingData) {
            return context.value.shootingData.title
        }
        return manualMeta.value.projectName
    })

    const displayAccountName = computed(() => {
        if (context.value.mode === 'shooting' && context.value.shootingData) {
            return context.value.shootingData.team || context.value.shootingData.director
        }
        return manualMeta.value.accountName
    })

    // Actions
    function setContext(newContext: Partial<OrderContext>) {
        context.value = { ...context.value, ...newContext }

        // Initialize projects based on mode
        if (newContext.mode === 'shooting' && newContext.shootingData) {
            initializeForShooting(newContext.shootingData.title)
        } else if (newContext.mode === 'external' || newContext.mode === 'internal') {
            initializeForManual()
        }
    }

    function initializeForShooting(title: string) {
        // Reset projects if empty, or update existing? For now reset to 1 default project
        if (projects.value.length === 0) {
            projects.value = [{
                id: crypto.randomUUID(),
                title: title,
                roles: []
            }]
        }
    }

    function initializeForManual() {
        if (projects.value.length === 0) {
            projects.value = [{
                id: crypto.randomUUID(),
                title: '',
                roles: [{
                    id: crypto.randomUUID(),
                    name: '役名なし',
                    type: 'その他',
                    note: '',
                    castIds: []
                }]
            }]
        }
    }

    function addToPool(cast: Cast) {
        if (!pool.value[cast.id]) {
            pool.value[cast.id] = { id: cast.id, cast }
        }
    }

    function removeFromPool(castId: string) {
        // Remove from pool
        delete pool.value[castId]

        // Remove from all roles
        projects.value.forEach(project => {
            project.roles.forEach(role => {
                const index = role.castIds.indexOf(castId)
                if (index !== -1) {
                    role.castIds.splice(index, 1)
                }
            })
        })
    }

    function createProject(options?: { title?: string; roles?: any[] }) {
        const newProject = {
            id: crypto.randomUUID(),
            title: options?.title || displayProjectName.value,
            roles: options?.roles || []
        }
        projects.value.push(newProject)
        return newProject
    }

    function addProject(title: string = '') {
        projects.value.push({
            id: crypto.randomUUID(),
            title: title || displayProjectName.value,
            roles: []
        })
    }

    function addRole(projectId: string) {
        const project = projects.value.find(p => p.id === projectId)
        if (project) {
            project.roles.push({
                id: crypto.randomUUID(),
                name: '',
                type: 'その他',
                note: '',
                castIds: []
            })
        }
    }

    function removeRole(projectId: string, roleId: string) {
        const project = projects.value.find(p => p.id === projectId)
        if (project) {
            project.roles = project.roles.filter(r => r.id !== roleId)
        }
    }

    function removeProject(projectId: string) {
        projects.value = projects.value.filter(p => p.id !== projectId)
    }

    function removeCastFromRole(roleId: string, castId: string) {
        projects.value.forEach(p => {
            const role = p.roles.find(r => r.id === roleId)
            if (role) {
                role.castIds = role.castIds.filter(id => id !== castId)
            }
        })
    }

    // Clean up empty roles and projects before submission
    function cleanupEmpty() {
        projects.value.forEach(p => {
            // Remove empty roles
            p.roles = p.roles.filter(r => r.castIds.length > 0)
        })
        // Remove projects with no roles
        projects.value = projects.value.filter(p => p.roles.length > 0)
    }

    // Compatibility: addItem for CastCard compatibility
    // CastCard calls addItem(cast). This should add to pool.
    function addItem(cast: Cast) {
        addToPool(cast)
    }

    function removeItem(castId: string) {
        removeFromPool(castId)
    }

    function clear() {
        pool.value = {}
        projects.value = []
        // Re-init empty state
        if (isShootingMode.value && context.value.shootingData) {
            initializeForShooting(context.value.shootingData.title)
        } else {
            initializeForManual()
        }
    }

    // Helper for submission: Flatten structure
    function getFlattenedOrders() {
        const orders: any[] = []
        projects.value.forEach(p => {
            p.roles.forEach(r => {
                r.castIds.forEach((castId, index) => {
                    if (pool.value[castId]) {
                        orders.push({
                            castId,
                            cast: pool.value[castId].cast,
                            rank: index + 1,
                            roleName: r.name,
                            projectName: p.title || manualMeta.value.projectName,
                            mainSub: r.type,
                            note: r.note
                        })
                    }
                })
            })
        })
        return orders
    }

    return {
        // State
        context,
        manualMeta,
        pool,
        projects,
        cartVisible,

        // Computed
        isShootingMode,
        count,
        displayAccountName,
        displayProjectName,

        // Actions
        setContext,
        addToPool,
        removeFromPool,
        createProject,
        addProject, // Assuming createProject maps to addProject
        removeProject, // Assuming deleteProject maps to removeProject
        addRole, // Assuming createRole maps to addRole
        removeRole, // Assuming deleteRole maps to removeRole
        // addCastToRole is not defined, keeping existing removeCastFromRole
        removeCastFromRole,
        clear,
        // updateNote is not defined
        addItem, // Keeping existing actions
        removeItem,
        cleanupEmpty,
        getFlattenedOrders
    }
})
