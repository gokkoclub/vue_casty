import { useToast } from 'primevue/usetoast'

/**
 * エラー種別
 */
export const ErrorType = {
    NETWORK: 'network',
    AUTH: 'auth',
    PERMISSION: 'permission',
    VALIDATION: 'validation',
    NOT_FOUND: 'not_found',
    UNKNOWN: 'unknown'
} as const

export type ErrorTypeValue = typeof ErrorType[keyof typeof ErrorType]

/**
 * アプリエラーインターフェース
 */
export interface AppError {
    type: ErrorTypeValue
    message: string
    originalError?: unknown
    context?: Record<string, unknown>
}

/**
 * Firestoreエラーコードからエラータイプを判定
 */
function getErrorTypeFromCode(code: string): ErrorTypeValue {
    switch (code) {
        case 'permission-denied':
            return ErrorType.PERMISSION
        case 'unauthenticated':
            return ErrorType.AUTH
        case 'not-found':
            return ErrorType.NOT_FOUND
        case 'unavailable':
        case 'cancelled':
            return ErrorType.NETWORK
        case 'invalid-argument':
            return ErrorType.VALIDATION
        default:
            return ErrorType.UNKNOWN
    }
}

/**
 * エラーをパースしてAppErrorに変換
 */
export function parseError(error: unknown, context?: Record<string, unknown>): AppError {
    // Firestoreエラー
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const firebaseError = error as { code: string; message: string }
        return {
            type: getErrorTypeFromCode(firebaseError.code),
            message: firebaseError.message,
            originalError: error,
            context
        }
    }

    // 通常のエラー
    if (error instanceof Error) {
        return {
            type: ErrorType.UNKNOWN,
            message: error.message,
            originalError: error,
            context
        }
    }

    // 文字列エラー
    if (typeof error === 'string') {
        return {
            type: ErrorType.UNKNOWN,
            message: error,
            context
        }
    }

    // 不明なエラー
    return {
        type: ErrorType.UNKNOWN,
        message: '予期せぬエラーが発生しました',
        originalError: error,
        context
    }
}

/**
 * エラータイプに応じたユーザー向けメッセージを取得
 */
export function getUserMessage(error: AppError): string {
    switch (error.type) {
        case ErrorType.NETWORK:
            return 'ネットワーク接続に問題があります。インターネット接続を確認してください。'
        case ErrorType.AUTH:
            return 'ログインが必要です。再度ログインしてください。'
        case ErrorType.PERMISSION:
            return 'この操作を実行する権限がありません。'
        case ErrorType.NOT_FOUND:
            return 'データが見つかりませんでした。'
        case ErrorType.VALIDATION:
            return '入力内容に誤りがあります。'
        default:
            return error.message || 'エラーが発生しました。'
    }
}

/**
 * エラーハンドリングcomposable
 */
export function useErrorHandler() {
    const toast = useToast()

    /**
     * エラーを処理してトーストで表示
     */
    function handleError(error: unknown, context?: string): AppError {
        const appError = parseError(error, context ? { context } : undefined)

        console.error(`[${appError.type}] ${context || 'Error'}:`, appError.originalError)

        const severity = appError.type === ErrorType.PERMISSION || appError.type === ErrorType.AUTH
            ? 'warn'
            : 'error'

        toast.add({
            severity,
            summary: getErrorTypeLabel(appError.type),
            detail: getUserMessage(appError),
            life: 4000
        })

        return appError
    }

    /**
     * 非同期関数をラップしてエラーハンドリング
     */
    async function withErrorHandling<T>(
        fn: () => Promise<T>,
        context?: string
    ): Promise<T | null> {
        try {
            return await fn()
        } catch (error) {
            handleError(error, context)
            return null
        }
    }

    return {
        handleError,
        withErrorHandling,
        parseError,
        getUserMessage
    }
}

/**
 * エラータイプのラベルを取得
 */
function getErrorTypeLabel(type: ErrorTypeValue): string {
    switch (type) {
        case ErrorType.NETWORK:
            return 'ネットワークエラー'
        case ErrorType.AUTH:
            return '認証エラー'
        case ErrorType.PERMISSION:
            return '権限エラー'
        case ErrorType.NOT_FOUND:
            return 'データエラー'
        case ErrorType.VALIDATION:
            return '入力エラー'
        default:
            return 'エラー'
    }
}
