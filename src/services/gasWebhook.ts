/**
 * GAS Webhook Service
 * GAS (Google Apps Script) のWebhookエンドポイントと通信するサービス
 */

// GAS WebhookのベースURL
const GAS_WEBHOOK_URL = import.meta.env.VITE_GAS_WEBHOOK_URL || ''

export interface GASWebhookResponse<T = unknown> {
    success: boolean
    error?: string
    results?: T
}

export interface SubmitOrderPayload {
    castings: Array<{
        castName: string
        castId: string
        castType: '内部' | '外部'
        projectName: string
        projectId?: string
        roleName?: string
        rank?: string
        startDate: string
        endDate?: string
        note?: string
        structureData?: unknown
    }>
    shooting?: {
        title: string
        date: string
        team?: string
    }
    hasIntimacy?: boolean
    userId?: string
}

export interface UpdateStatusPayload {
    castingId: string
    newStatus: string
    cost?: number
    extraMessage?: string
    userId?: string
}

export interface DeleteCastingPayload {
    castingId: string
    userId?: string
}

export interface AddOrderPayload {
    castingId: string
    items: Array<{
        type: string
        description?: string
    }>
    userId?: string
}

/**
 * GAS Webhookを呼び出す共通関数
 */
async function callGASWebhook<T>(action: string, data: object): Promise<GASWebhookResponse<T>> {
    if (!GAS_WEBHOOK_URL) {
        console.warn('GAS Webhook URL is not configured')
        return { success: false, error: 'GAS Webhook URL is not configured' }
    }

    try {
        const response = await fetch(GAS_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action,
                ...data
            })
        })

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
        }

        const result = await response.json()
        return result as GASWebhookResponse<T>
    } catch (error) {
        console.error('GAS Webhook error:', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    }
}

/**
 * オーダー送信
 * - Firestoreに保存
 * - Slack通知
 * - カレンダーイベント作成
 * - Notion更新
 */
export async function submitOrder(payload: SubmitOrderPayload): Promise<GASWebhookResponse> {
    return callGASWebhook('submitOrder', payload)
}

/**
 * ステータス更新
 * - Firestoreを更新
 * - Slackスレッドに返信
 * - カレンダータイトル更新
 * - Notion更新（決定時）
 */
export async function updateStatus(payload: UpdateStatusPayload): Promise<GASWebhookResponse> {
    return callGASWebhook('updateStatus', payload)
}

/**
 * キャスティング削除
 * - Firestoreを更新
 * - カレンダーイベント削除
 * - Slack通知
 */
export async function deleteCasting(payload: DeleteCastingPayload): Promise<GASWebhookResponse> {
    return callGASWebhook('deleteCasting', payload)
}

/**
 * 追加オーダー
 * - Slackスレッドに追加オーダーを投稿
 */
export async function addOrder(payload: AddOrderPayload): Promise<GASWebhookResponse> {
    return callGASWebhook('addOrder', payload)
}

/**
 * ヘルスチェック
 */
export async function checkHealth(): Promise<boolean> {
    if (!GAS_WEBHOOK_URL) return false

    try {
        const response = await fetch(GAS_WEBHOOK_URL, { method: 'GET' })
        const data = await response.json()
        return data.status === 'ok'
    } catch {
        return false
    }
}
