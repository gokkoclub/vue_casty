import { ref } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/services/firebase'
import { useToast } from 'primevue/usetoast'
import {
    buildOrderNotificationMessage,
    buildStatusUpdateMessage,
    buildSpecialOrderMessage,
    type OrderNotificationPayload,
    type StatusUpdatePayload,
    type SpecialOrderPayload
} from '@/utils/slackMessageBuilder'

/**
 * Slack通知composable
 * Cloud Functions または 既存のFastAPIバックエンドと連携
 */
export function useSlack() {
    const loading = ref(false)
    const toast = useToast()

    // バックエンドのベースURL（開発/本番で切り替え）
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

    /**
     * オーダー作成通知を送信
     */
    async function notifyOrderCreated(
        payload: OrderNotificationPayload,
        pdfFile?: File
    ): Promise<{ ok: boolean; ts?: string; permalink?: string }> {
        loading.value = true

        try {
            // Cloud Functionsを使用する場合
            if (functions) {
                const notifyFn = httpsCallable(functions, 'notifyOrderCreated')
                const result = await notifyFn({
                    ...payload,
                    message: buildOrderNotificationMessage(payload)
                })
                return result.data as { ok: boolean; ts?: string; permalink?: string }
            }

            // FastAPIバックエンドを使用する場合
            if (API_BASE_URL) {
                const formData = new FormData()
                formData.append('payload_str', JSON.stringify({
                    ...payload,
                    orders: payload.items.map(item => ({
                        castName: item.castName,
                        roleName: item.roleName,
                        rank: item.rank,
                        note: item.note || '',
                        projectName: payload.projectName,
                        isInternal: item.isInternal
                    }))
                }))

                if (pdfFile) {
                    formData.append('files', pdfFile)
                }

                const response = await fetch(`${API_BASE_URL}/api/notify/order_created`, {
                    method: 'POST',
                    body: formData
                })

                if (!response.ok) {
                    throw new Error('Failed to send notification')
                }

                return await response.json()
            }

            // バックエンドなしの場合（開発用）
            console.log('Slack notification (dev mode):', buildOrderNotificationMessage(payload))
            return { ok: true, ts: 'dev-mode-ts', permalink: '' }

        } catch (error) {
            console.error('Error sending order notification:', error)
            toast.add({
                severity: 'error',
                summary: 'Slack通知エラー',
                detail: 'オーダー通知の送信に失敗しました',
                life: 3000
            })
            return { ok: false }
        } finally {
            loading.value = false
        }
    }

    /**
     * ステータス更新通知を送信
     */
    async function notifyStatusUpdate(
        payload: StatusUpdatePayload
    ): Promise<{ ok: boolean }> {
        loading.value = true

        try {
            // Cloud Functions
            if (functions) {
                const notifyFn = httpsCallable(functions, 'notifyStatusUpdate')
                await notifyFn({
                    ...payload,
                    message: buildStatusUpdateMessage(payload)
                })
                return { ok: true }
            }

            // FastAPI
            if (API_BASE_URL) {
                const response = await fetch(`${API_BASE_URL}/api/notify/status_update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })

                if (!response.ok) {
                    throw new Error('Failed to send status update')
                }

                return { ok: true }
            }

            // 開発用
            console.log('Slack status update (dev mode):', buildStatusUpdateMessage(payload))
            return { ok: true }

        } catch (error) {
            console.error('Error sending status update:', error)
            toast.add({
                severity: 'warn',
                summary: 'Slack通知',
                detail: 'ステータス通知の送信に失敗しました（ローカル更新は完了）',
                life: 3000
            })
            return { ok: false }
        } finally {
            loading.value = false
        }
    }

    /**
     * 特別オーダー通知を送信
     */
    async function notifySpecialOrder(
        payload: SpecialOrderPayload
    ): Promise<{ ok: boolean; ts?: string; permalink?: string }> {
        loading.value = true

        try {
            // Cloud Functions
            if (functions) {
                const notifyFn = httpsCallable(functions, 'notifySpecialOrder')
                const result = await notifyFn({
                    ...payload,
                    message: buildSpecialOrderMessage(payload)
                })
                return result.data as { ok: boolean; ts?: string; permalink?: string }
            }

            // FastAPI
            if (API_BASE_URL) {
                const response = await fetch(`${API_BASE_URL}/api/notify/special_order`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })

                if (!response.ok) {
                    throw new Error('Failed to send special order notification')
                }

                return await response.json()
            }

            // 開発用
            console.log('Slack special order (dev mode):', buildSpecialOrderMessage(payload))
            return { ok: true, ts: 'dev-mode-ts', permalink: '' }

        } catch (error) {
            console.error('Error sending special order notification:', error)
            toast.add({
                severity: 'error',
                summary: 'Slack通知エラー',
                detail: '特別オーダー通知の送信に失敗しました',
                life: 3000
            })
            return { ok: false }
        } finally {
            loading.value = false
        }
    }

    return {
        loading,
        notifyOrderCreated,
        notifyStatusUpdate,
        notifySpecialOrder
    }
}
