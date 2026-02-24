/**
 * Global loading state composable
 * バックエンド処理中のプログレス表示に使用
 * 
 * Usage:
 *   const { startLoading, stopLoading } = useLoading()
 *   startLoading('時間を更新中...')
 *   await someAsyncWork()
 *   stopLoading()
 * 
 *   // Or use the wrapper:
 *   await withLoading('保存中...', async () => { ... })
 */
import { ref, readonly } from 'vue'

const isLoading = ref(false)
const loadingMessage = ref('')
const loadingCount = ref(0) // supports nested loading calls

export function useLoading() {
    const startLoading = (message = '処理中...') => {
        loadingCount.value++
        isLoading.value = true
        loadingMessage.value = message
    }

    const stopLoading = () => {
        loadingCount.value = Math.max(0, loadingCount.value - 1)
        if (loadingCount.value === 0) {
            isLoading.value = false
            loadingMessage.value = ''
        }
    }

    /**
     * Wraps an async function with loading state
     */
    const withLoading = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
        startLoading(message)
        try {
            return await fn()
        } finally {
            stopLoading()
        }
    }

    return {
        isLoading: readonly(isLoading),
        loadingMessage: readonly(loadingMessage),
        startLoading,
        stopLoading,
        withLoading
    }
}
