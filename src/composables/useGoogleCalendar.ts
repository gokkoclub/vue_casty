import { ref } from 'vue'
import { useToast } from 'primevue/usetoast'

/**
 * Googleカレンダー連携composable
 * 内部キャストの仮押さえ/決定時にカレンダーイベントを管理
 */

// Google APIの型定義
declare const gapi: {
    client: {
        calendar: {
            events: {
                insert(params: { calendarId: string; resource: CalendarEventResource }): Promise<{ result: { id: string } }>
                patch(params: { calendarId: string; eventId: string; resource: Partial<CalendarEventResource> }): Promise<void>
                delete(params: { calendarId: string; eventId: string }): Promise<void>
            }
        }
    }
    auth2?: {
        getAuthInstance(): {
            isSignedIn: { get(): boolean }
        }
    }
}

interface CalendarEventResource {
    summary: string
    description?: string
    start: { date: string } | { dateTime: string; timeZone?: string }
    end: { date: string } | { dateTime: string; timeZone?: string }
}

export interface CalendarEventData {
    castName: string
    projectName: string
    roleName: string
    startDate: Date
    endDate?: Date
    startTime?: string  // HH:mm format
    endTime?: string    // HH:mm format
    isProvisional: boolean  // true = 仮押さえ, false = 決定
}

export function useGoogleCalendar() {
    const loading = ref(false)
    const toast = useToast()

    // カレンダーID（環境変数から取得）
    const calendarId = import.meta.env.VITE_CALENDAR_ID_INTERNAL || 'primary'

    /**
     * Google APIが利用可能かチェック
     */
    function isGapiAvailable(): boolean {
        return typeof gapi !== 'undefined' && !!gapi.client?.calendar
    }

    /**
     * 日付をYYYY-MM-DD形式に変換
     */
    function formatDate(date: Date): string {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    /**
     * 翌日の日付を取得
     */
    function getNextDay(date: Date): Date {
        const next = new Date(date)
        next.setDate(next.getDate() + 1)
        return next
    }

    /**
     * カレンダーイベントを作成
     * @returns イベントID（Firestoreに保存用）
     */
    async function createEvent(data: CalendarEventData): Promise<string | null> {
        if (!isGapiAvailable()) {
            console.warn('Google Calendar API not available')
            return null
        }

        loading.value = true

        try {
            // サマリー（タイトル）を生成
            const summary = data.isProvisional
                ? `[仮] ${data.castName} / ${data.projectName}`
                : `${data.castName} / ${data.projectName}`

            // 説明文を生成
            const description = [
                `案件: ${data.projectName}`,
                `役名: ${data.roleName}`,
                data.startTime ? `時間: ${data.startTime} - ${data.endTime || ''}` : ''
            ].filter(Boolean).join('\n')

            // 開始・終了日時を設定
            let start: CalendarEventResource['start']
            let end: CalendarEventResource['end']

            if (data.startTime && data.endTime) {
                // 時間指定あり
                const startDateTime = `${formatDate(data.startDate)}T${data.startTime}:00`
                const endDateTime = `${formatDate(data.endDate || data.startDate)}T${data.endTime}:00`
                start = { dateTime: startDateTime, timeZone: 'Asia/Tokyo' }
                end = { dateTime: endDateTime, timeZone: 'Asia/Tokyo' }
            } else {
                // 終日イベント
                start = { date: formatDate(data.startDate) }
                end = { date: formatDate(getNextDay(data.endDate || data.startDate)) }
            }

            const resource: CalendarEventResource = {
                summary,
                description,
                start,
                end
            }

            const response = await gapi.client.calendar.events.insert({
                calendarId,
                resource
            })

            console.log('Calendar event created:', response.result.id)
            return response.result.id

        } catch (error) {
            console.error('Error creating calendar event:', error)
            toast.add({
                severity: 'warn',
                summary: 'カレンダー',
                detail: 'カレンダーイベントの作成に失敗しました',
                life: 3000
            })
            return null
        } finally {
            loading.value = false
        }
    }

    /**
     * カレンダーイベントのタイトルを更新
     * 仮押さえ→決定時に [仮] プレフィックスを削除
     */
    async function updateEventTitle(
        eventId: string,
        castName: string,
        projectName: string,
        isProvisional: boolean
    ): Promise<boolean> {
        if (!isGapiAvailable() || !eventId) {
            return false
        }

        loading.value = true

        try {
            const summary = isProvisional
                ? `[仮] ${castName} / ${projectName}`
                : `${castName} / ${projectName}`

            await gapi.client.calendar.events.patch({
                calendarId,
                eventId,
                resource: { summary }
            })

            console.log('Calendar event updated:', eventId)
            return true

        } catch (error) {
            console.error('Error updating calendar event:', error)
            return false
        } finally {
            loading.value = false
        }
    }

    /**
     * カレンダーイベントを削除
     * NG/キャンセル時に使用
     */
    async function deleteEvent(eventId: string): Promise<boolean> {
        if (!isGapiAvailable() || !eventId) {
            return false
        }

        loading.value = true

        try {
            await gapi.client.calendar.events.delete({
                calendarId,
                eventId
            })

            console.log('Calendar event deleted:', eventId)
            return true

        } catch (error) {
            console.error('Error deleting calendar event:', error)
            toast.add({
                severity: 'warn',
                summary: 'カレンダー',
                detail: 'カレンダーイベントの削除に失敗しました',
                life: 3000
            })
            return false
        } finally {
            loading.value = false
        }
    }

    /**
     * ステータス変更に応じたカレンダー処理
     */
    async function handleStatusChange(
        eventId: string | undefined,
        castName: string,
        projectName: string,
        newStatus: string
    ): Promise<void> {
        if (!eventId) return

        switch (newStatus) {
            case 'OK':
            case '決定':
                // [仮] プレフィックスを削除
                await updateEventTitle(eventId, castName, projectName, false)
                break

            case 'NG':
            case 'キャンセル':
                // イベント削除
                await deleteEvent(eventId)
                break

            default:
                // その他のステータスでは何もしない
                break
        }
    }

    return {
        loading,
        isGapiAvailable,
        createEvent,
        updateEventTitle,
        deleteEvent,
        handleStatusChange
    }
}
