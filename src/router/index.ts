import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/',
            name: 'home',
            component: () => import('@/views/HomeView.vue')
        },
        {
            path: '/casting',
            name: 'casting',
            component: () => import('@/views/CastingView.vue')
        },
        {
            path: '/casting-status',
            name: 'casting-status',
            component: () => import('@/views/CastingStatusView.vue')
        },
        {
            path: '/status',
            name: 'status',
            component: () => import('@/views/StatusView.vue'),
            meta: { requiresAdmin: true }
        },
        {
            path: '/management',
            name: 'management',
            component: () => import('@/views/ManagementView.vue'),
            meta: { requiresAdmin: true }
        },
        {
            path: '/shooting-contact',
            name: 'shooting-contact',
            component: () => import('@/views/ShootingContactView.vue'),
            meta: { requiresAdmin: true }
        },
        {
            path: '/setup-test',
            name: 'setup-test',
            component: () => import('@/views/SetupTestView.vue')
        },
        {
            path: '/help',
            name: 'help',
            component: () => import('@/views/HelpView.vue')
        }
    ]
})

// ナビゲーションガード：管理者専用ページのアクセス制限
router.beforeEach(async (to) => {
    if (!to.meta.requiresAdmin) return true

    const { loading, isAdmin, isAdminChecked } = useAuth()

    // 認証状態が確定するまで待機（最大3秒）
    if (loading.value || !isAdminChecked.value) {
        await new Promise<void>((resolve) => {
            const maxWait = setTimeout(resolve, 3000)
            const interval = setInterval(() => {
                if (!loading.value && isAdminChecked.value) {
                    clearInterval(interval)
                    clearTimeout(maxWait)
                    resolve()
                }
            }, 50)
        })
    }

    if (!isAdmin.value) {
        return { name: 'casting' }
    }

    return true
})

export default router
