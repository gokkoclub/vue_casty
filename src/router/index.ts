import { createRouter, createWebHistory } from 'vue-router'

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
            component: () => import('@/views/StatusView.vue')
        },
        {
            path: '/management',
            name: 'management',
            component: () => import('@/views/ManagementView.vue')
        },
        {
            path: '/shooting-contact',
            name: 'shooting-contact',
            component: () => import('@/views/ShootingContactView.vue')
        },
        {
            path: '/setup-test',
            name: 'setup-test',
            component: () => import('@/views/SetupTestView.vue')
        }
    ]
})

export default router
