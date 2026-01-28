import type { Casting } from '@/types'

/**
 * キャストの予約情報
 */
export interface CastBooking {
    status: '仮押さえ' | '決定' | 'NG'
    team: string  // accountName
    displayLabel: string  // "Team A: 仮"
    severity: 'warning' | 'danger' | 'secondary'
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

    const bookings: CastBooking[] = []
    const seen = new Set<string>()

    // Filter castings for this cast within selected dates
    const relevantCastings = activeCastings.filter(c => {
        if (c.castId !== castId) return false

        // 表示対象のステータスのみ
        if (!['仮押さえ', '決定', 'NG'].includes(c.status)) return false

        const castingDate = c.startDate.toDate().toISOString().split('T')[0] ?? ''
        return castingDate !== '' && selectedDates.includes(castingDate)
    })

    // Group by team and status to avoid duplicates
    relevantCastings.forEach(casting => {
        const key = `${casting.accountName}-${casting.status}`
        if (seen.has(key)) return
        seen.add(key)

        let displayLabel = ''
        let severity: 'warning' | 'danger' | 'secondary' = 'secondary'

        if (casting.status === '仮押さえ') {
            displayLabel = `${casting.accountName}: 仮`
            severity = 'warning'
        } else if (casting.status === '決定') {
            displayLabel = `${casting.accountName}: 決定`
            severity = 'danger'
        } else if (casting.status === 'NG') {
            displayLabel = `${casting.accountName}: NG`
            severity = 'secondary'
        }

        bookings.push({
            status: casting.status as '仮押さえ' | '決定' | 'NG',
            team: casting.accountName,
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

    return activeCastings.some(c => {
        if (c.castId !== castId || c.status !== 'NG') return false

        const castingDate = c.startDate.toDate().toISOString().split('T')[0] ?? ''
        return castingDate !== '' && selectedDates.includes(castingDate)
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

    return activeCastings.filter(c => {
        if (c.castId !== castId) return false
        if (!['仮押さえ', '決定'].includes(c.status)) return false

        const castingDate = c.startDate.toDate().toISOString().split('T')[0] ?? ''
        return castingDate !== '' && selectedDates.includes(castingDate)
    }).length
}
