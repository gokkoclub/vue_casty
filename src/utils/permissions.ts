import type { CastingStatus } from '@/types'

/**
 * 権限チェック用ユーティリティ
 * 管理者と一般ユーザーの操作権限を管理
 */

// ステータスの遷移可能先を定義
const STATUS_TRANSITIONS: Record<CastingStatus, CastingStatus[]> = {
    '仮押さえ': ['打診中', 'オーダー待ち', 'OK', '決定', 'NG', 'キャンセル'],
    '仮キャスティング': ['打診中', 'オーダー待ち', 'OK', '決定', 'NG', 'キャンセル'],
    '打診中': ['オーダー待ち', 'OK', 'NG'],
    'オーダー待ち': ['OK', '決定', 'NG'],
    'OK': ['決定', 'NG'],
    '決定': ['キャンセル'],
    'NG': [],
    'キャンセル': []
}

// 一般ユーザーが変更可能なステータス（限定的）
const USER_ALLOWED_TRANSITIONS: Record<CastingStatus, CastingStatus[]> = {
    '仮押さえ': ['打診中', 'オーダー待ち'],
    '仮キャスティング': ['打診中', 'オーダー待ち'],
    '打診中': ['オーダー待ち'],
    'オーダー待ち': [],
    'OK': [],
    '決定': [],
    'NG': [],
    'キャンセル': []
}

export const Permissions = {
    /**
     * 現在のステータスから遷移可能なステータス一覧を取得
     * @param currentStatus 現在のステータス
     * @param isAdmin 管理者かどうか
     * @returns 遷移可能なステータス配列
     */
    getAvailableStatusTransitions(currentStatus: CastingStatus, isAdmin: boolean): CastingStatus[] {
        if (isAdmin) {
            return STATUS_TRANSITIONS[currentStatus] || []
        }
        return USER_ALLOWED_TRANSITIONS[currentStatus] || []
    },

    /**
     * ステータス変更が可能かどうかをチェック
     * @param currentStatus 現在のステータス  
     * @param newStatus 新しいステータス
     * @param isAdmin 管理者かどうか
     */
    canChangeStatus(currentStatus: CastingStatus, newStatus: CastingStatus, isAdmin: boolean): boolean {
        const allowed = this.getAvailableStatusTransitions(currentStatus, isAdmin)
        return allowed.includes(newStatus)
    },

    /**
     * 削除権限をチェック
     * @param isAdmin 管理者かどうか
     */
    canDelete(isAdmin: boolean): boolean {
        return isAdmin
    },

    /**
     * 追加オーダー権限をチェック
     * @param isAdmin 管理者かどうか
     */
    canAddOrder(isAdmin: boolean): boolean {
        return isAdmin
    },

    /**
     * 特別オーダー（外部案件/社内イベント）の編集権限
     * @param isAdmin 管理者かどうか
     */
    canEditSpecialOrder(isAdmin: boolean): boolean {
        return isAdmin
    },

    /**
     * 撮影連絡DBの編集権限
     */
    canEditShootingContact(): boolean {
        return true // 全員編集可能（業務フローのため）
    },

    /**
     * 金額情報の閲覧権限
     * @param isAdmin 管理者かどうか
     */
    canViewCost(isAdmin: boolean): boolean {
        return isAdmin
    }
}

/**
 * ステータスの表示色を取得
 */
export function getStatusColor(status: CastingStatus): string {
    const colors: Record<CastingStatus, string> = {
        '仮押さえ': 'warning',
        '仮キャスティング': 'info',
        '打診中': 'secondary',
        'オーダー待ち': 'warning',
        'OK': 'success',
        '決定': 'success',
        'NG': 'danger',
        'キャンセル': 'danger'
    }
    return colors[status] || 'secondary'
}

/**
 * ステータスのアイコンを取得
 */
export function getStatusIcon(status: CastingStatus): string {
    const icons: Record<CastingStatus, string> = {
        '仮押さえ': 'pi-clock',
        '仮キャスティング': 'pi-user-plus',
        '打診中': 'pi-comments',
        'オーダー待ち': 'pi-inbox',
        'OK': 'pi-check',
        '決定': 'pi-check-circle',
        'NG': 'pi-times',
        'キャンセル': 'pi-ban'
    }
    return icons[status] || 'pi-circle'
}
