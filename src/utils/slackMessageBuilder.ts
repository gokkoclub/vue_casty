import type { CastingStatus } from '@/types'

/**
 * Slack通知メッセージ生成ユーティリティ
 * フロントエンドでメッセージを構築し、バックエンドに送信
 */

export interface OrderNotificationPayload {
    accountName: string
    projectName: string
    projectId?: string
    dateRanges: string[]
    items: Array<{
        castName: string
        roleName: string
        rank: number
        note?: string
        mainSub: 'メイン' | 'サブ' | 'その他'
        isInternal: boolean
    }>
    orderType: 'pattern_a' | 'pattern_b' | 'test' | 'external' | 'internal'
    ordererName?: string
    ordererEmail?: string
}

export interface StatusUpdatePayload {
    castingId: string
    castName: string
    projectName: string
    newStatus: CastingStatus
    previousStatus?: CastingStatus
    slackThreadTs?: string
    extraMessage?: string
    isInternal?: boolean
}

export interface SpecialOrderPayload {
    orderType: 'external' | 'internal'
    title: string
    dates: string[]
    startTime: string
    endTime: string
    casts: Array<{
        castId: string
        castName: string
        isInternal: boolean
    }>
    ordererName: string
    ordererEmail: string
}

/**
 * オーダー通知メッセージを生成
 */
export function buildOrderNotificationMessage(payload: OrderNotificationPayload): string {
    const lines: string[] = []

    // ヘッダー
    lines.push('📋 *新規オーダー*')
    lines.push('')

    // 案件情報
    lines.push(`*アカウント:* ${payload.accountName}`)
    lines.push(`*案件名:* ${payload.projectName}`)
    lines.push(`*日程:* ${payload.dateRanges.join(', ')}`)

    if (payload.ordererName) {
        lines.push(`*発注者:* ${payload.ordererName}`)
    }

    lines.push('')
    lines.push('*キャスト一覧:*')

    // キャスト一覧
    payload.items.forEach((item, index) => {
        const internalBadge = item.isInternal ? ' 🏠' : ''
        const mainSubLabel = item.mainSub === 'メイン' ? '【メイン】' : item.mainSub === 'サブ' ? '【サブ】' : ''
        lines.push(`${index + 1}. ${item.castName}${internalBadge} - ${item.roleName} ${mainSubLabel} (第${item.rank}候補)`)
        if (item.note) {
            lines.push(`   📝 ${item.note}`)
        }
    })

    return lines.join('\n')
}

/**
 * ステータス更新メッセージを生成
 */
export function buildStatusUpdateMessage(payload: StatusUpdatePayload): string {
    const lines: string[] = []

    const statusEmoji = getStatusEmoji(payload.newStatus)

    lines.push(`${statusEmoji} *ステータス更新*`)
    lines.push('')
    lines.push(`*キャスト:* ${payload.castName}`)
    lines.push(`*案件:* ${payload.projectName}`)
    lines.push(`*新ステータス:* ${payload.newStatus}`)

    if (payload.previousStatus) {
        lines.push(`(${payload.previousStatus} → ${payload.newStatus})`)
    }

    if (payload.extraMessage) {
        lines.push('')
        lines.push(`📝 ${payload.extraMessage}`)
    }

    return lines.join('\n')
}

/**
 * 特別オーダー（外部案件/社内イベント）メッセージを生成
 */
export function buildSpecialOrderMessage(payload: SpecialOrderPayload): string {
    const lines: string[] = []

    const typeLabel = payload.orderType === 'external' ? '🌐 外部案件' : '🏠 社内イベント'

    lines.push(`${typeLabel}`)
    lines.push('')
    lines.push(`*タイトル:* ${payload.title}`)
    lines.push(`*日程:* ${payload.dates.join(', ')}`)
    lines.push(`*時間:* ${payload.startTime} - ${payload.endTime}`)
    lines.push(`*発注者:* ${payload.ordererName}`)
    lines.push('')
    lines.push('*キャスト:*')

    payload.casts.forEach((cast, index) => {
        const badge = cast.isInternal ? ' 🏠' : ''
        lines.push(`${index + 1}. ${cast.castName}${badge}`)
    })

    return lines.join('\n')
}

/**
 * ステータスに応じた絵文字を取得
 */
function getStatusEmoji(status: CastingStatus): string {
    const emojiMap: Record<CastingStatus, string> = {
        '仮押さえ': '🟡',
        '仮キャスティング': '🔵',
        '打診中': '⚪',
        'オーダー待ち': '🟠',
        'オーダー待ち（仮キャスティング）': '🟠',
        'OK': '🟢',
        '条件つきOK': '🟡',
        '決定': '✅',
        'NG': '🔴',
        'キャンセル': '❌'
    }
    return emojiMap[status] || '📋'
}

/**
 * チャンネル振り分け
 */
export function getSlackChannel(orderType: string): string {
    // 実際のチャンネルIDは環境変数またはバックエンドで解決
    switch (orderType) {
        case 'pattern_a':
            return 'SLACK_CHANNEL_TYPE_A'
        case 'pattern_b':
            return 'SLACK_CHANNEL_TYPE_B'
        case 'external':
            return 'SLACK_CHANNEL_EXTERNAL'
        case 'test':
            return 'SLACK_CHANNEL_TEST'
        default:
            return 'SLACK_DEFAULT_CHANNEL'
    }
}
