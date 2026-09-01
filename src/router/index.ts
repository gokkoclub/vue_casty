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
        },
        // ── 香盤。Casty とは別の製品としてヘッダーで切り替える ──
        {
            path: '/kouban',
            name: 'kouban',
            component: () => import('@/views/KoubanView.vue'),
            meta: { requiresAdmin: true, product: 'kouban' }
        },
        {
            path: '/kouban/:shootId',
            name: 'kouban-detail',
            component: () => import('@/views/KoubanDetailView.vue'),
            meta: { requiresAdmin: true, product: 'kouban' }
        }
    ]
})

// ナビゲーションガード：管理者専用ページ + アクター制限
router.beforeEach(async (to) => {
    const { loading, isAdmin, isActor, isAdminChecked } = useAuth()

    const needsRoleCheck = to.meta.requiresAdmin || to.name === 'casting'
    if (!needsRoleCheck) return true

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

    // アクターはオーダー作成ページに入れない（外部案件の作品名・時間変更のみのロール）
    if (to.name === 'casting' && isActor.value) {
        return { name: 'casting-status' }
    }

    if (to.meta.requiresAdmin && !isAdmin.value) {
        return isActor.value ? { name: 'casting-status' } : { name: 'casting' }
    }

    return true
})

export default router
