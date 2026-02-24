import type { Casting } from '@/types'

/**
 * キャストの予約情報
 */
export interface CastBooking {
    status: '仮押さえ' | '仮キャスティング' | 'オーダー待ち' | '決定' | 'NG'
    team: string  // accountName
    displayLabel: string  // "Team A: 仮"
    severity: 'warning' | 'danger' | 'secondary' | 'info'
    projectName?: string
}

/**
 * 選択日付内のキャストの予約情報を取得
 * 
 * @param castId - キャストID
 * @param activeCastings - アクティブなキャスティングリスト
 * @param selectedDates - 選択された日付（YYYY-MM-DD形式）
 * @returns 予約情報の配列
 */
export function getCastBookings(
    castId: string,
    activeCastings: Casting[],
    selectedDates: string[]
): CastBooking[] {
    if (selectedDates.length === 0) return []

    // ローカルタイムゾーンで日付を YYYY-MM-DD にフォーマット
    const toLocalDateStr = (d: Date): string => {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${y}-${m}-${day}`
    }

    const bookings: CastBooking[] = []
    const seen = new Set<string>()

    // Filter castings for this cast within selected dates
    const relevantCastings = activeCastings.filter(c => {
        if (c.castId !== castId) return false

        // 表示対象のステータス（打診中・オーダー待ちも仮キャスティングとして表示）
        if (!['仮押さえ', '仮キャスティング', '打診中', 'オーダー待ち', '決定', 'NG'].includes(c.status)) return false

        const castStart = toLocalDateStr(c.startDate.toDate())
        const castEnd = c.endDate ? toLocalDateStr(c.endDate.toDate()) : castStart
        // 選択日のいずれかがキャスティングの日付範囲内にあるか
        return selectedDates.some(d => d >= castStart && d <= castEnd)
    })

    // Group by team and status to avoid duplicates
    relevantCastings.forEach(casting => {
        // accountName が空の場合、projectName または mode に基づいたラベルを使用
        const teamLabel = casting.accountName
            || casting.projectName
            || (casting.mode === 'internal' ? '社内イベント' : casting.mode === 'external' ? '外部案件' : '不明')

        const key = `${teamLabel}-${casting.status}`
        if (seen.has(key)) return
        seen.add(key)

        let displayLabel = ''
        let severity: 'warning' | 'danger' | 'secondary' | 'info' = 'secondary'

        if (casting.status === '仮押さえ') {
            displayLabel = `${teamLabel}: 仮`
            severity = 'warning'
        } else if (casting.status === '仮キャスティング' || casting.status === '打診中' || casting.status === 'オーダー待ち') {
            displayLabel = `${teamLabel}: 仮キャスティング`
            severity = 'info'
        } else if (casting.status === '決定') {
            displayLabel = `${teamLabel}: 決定`
            severity = 'danger'
        } else if (casting.status === 'NG') {
            displayLabel = `${teamLabel}: NG`
            severity = 'secondary'
        }

        bookings.push({
            status: casting.status as '仮押さえ' | '仮キャスティング' | 'オーダー待ち' | '決定' | 'NG',
            team: teamLabel,
            displayLabel,
            severity,
            projectName: casting.projectName
        })
    })

    return bookings
}

/**
 * キャストが予約不可かどうかを判定
 * NGステータスが存在する場合のみtrue
 * 
 * @param castId - キャストID
 * @param activeCastings - アクティブなキャスティングリスト
 * @param selectedDates - 選択された日付（YYYY-MM-DD形式）
 * @returns NGがある場合true、それ以外false
 */
export function isBookingBlocked(
    castId: string,
    activeCastings: Casting[],
    selectedDates: string[]
): boolean {
    if (selectedDates.length === 0) return false

    const toLocalDateStr = (d: Date): string => {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${y}-${m}-${day}`
    }

    return activeCastings.some(c => {
        if (c.castId !== castId || c.status !== 'NG') return false

        const castStart = toLocalDateStr(c.startDate.toDate())
        const castEnd = c.endDate ? toLocalDateStr(c.endDate.toDate()) : castStart
        return selectedDates.some(d => d >= castStart && d <= castEnd)
    })
}

/**
 * キャストの総予約数を取得
 * 
 * @param castId - キャストID
 * @param activeCastings - アクティブなキャスティングリスト
 * @param selectedDates - 選択された日付（YYYY-MM-DD形式）
 * @returns 予約数
 */
export function getBookingCount(
    castId: string,
    activeCastings: Casting[],
    selectedDates: string[]
): number {
    if (selectedDates.length === 0) return 0

    const toLocalDateStr = (d: Date): string => {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${y}-${m}-${day}`
    }

    return activeCastings.filter(c => {
        if (c.castId !== castId) return false
        if (!['仮押さえ', '仮キャスティング', '打診中', 'オーダー待ち', '決定'].includes(c.status)) return false

        const castStart = toLocalDateStr(c.startDate.toDate())
        const castEnd = c.endDate ? toLocalDateStr(c.endDate.toDate()) : castStart
        return selectedDates.some(d => d >= castStart && d <= castEnd)
    }).length
}
