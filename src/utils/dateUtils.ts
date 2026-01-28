/**
 * 日付関連ユーティリティ（再利用可能）
 */

/**
 * Dateオブジェクトを YYYY-MM-DD 形式の文字列に変換
 */
export function formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

/**
 * Dateオブジェクトを YYYY/MM/DD 形式の文字列に変換
 */
export function formatDateSlash(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}/${month}/${day}`
}

/**
 * Dateオブジェクトを M/D(曜日) 形式の文字列に変換
 */
export function formatDateJapanese(date: Date): string {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    const month = date.getMonth() + 1
    const day = date.getDate()
    const weekday = weekdays[date.getDay()]
    return `${month}/${day}(${weekday})`
}

/**
 * 翌日の日付を取得
 */
export function nextDay(date: Date): Date {
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    return next
}

/**
 * 日付範囲を生成（start から end まで）
 */
export function getDateRange(start: Date, end: Date): Date[] {
    const dates: Date[] = []
    const current = new Date(start)

    while (current <= end) {
        dates.push(new Date(current))
        current.setDate(current.getDate() + 1)
    }

    return dates
}

/**
 * 2つの日付が同じ日かどうかをチェック
 */
export function isSameDay(date1: Date, date2: Date): boolean {
    return (
        date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate()
    )
}

/**
 * 文字列から Date オブジェクトに変換
 * @param dateStr YYYY-MM-DD or YYYY/MM/DD 形式
 */
export function parseDate(dateStr: string): Date {
    const normalized = dateStr.replace(/\//g, '-')
    return new Date(normalized)
}

/**
 * Firestore Timestamp から Date オブジェクトに変換
 */
export function timestampToDate(timestamp: { toDate: () => Date } | Date): Date {
    if (timestamp instanceof Date) return timestamp
    return timestamp.toDate()
}

/**
 * 月の開始日を取得
 */
export function getMonthStart(year: number, month: number): Date {
    return new Date(year, month - 1, 1)
}

/**
 * 月の終了日を取得
 */
export function getMonthEnd(year: number, month: number): Date {
    return new Date(year, month, 0)
}

/**
 * 年月を YYYY年MM月 形式で表示
 */
export function formatYearMonth(year: number, month: number): string {
    return `${year}年${month}月`
}
