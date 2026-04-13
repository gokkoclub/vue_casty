import { ref } from 'vue'

/**
 * Googleカレンダー連携composable
 * Cloud Functions経由でカレンダーイベントを管理
 * 
 * 注意: カレンダー操作はCloud Functions内で自動的に行われます。
 * - submitOrder時 → notifyOrderCreated が自動でカレンダー作成
 * - updateStatus時 → notifyStatusUpdate が自動でカレンダー更新/削除
 * - delete時 → deleteCastingCleanup が自動でカレンダー削除
 * 
 * このcomposableは後方互換性のために残していますが、
 * 直接のカレンダー操作は不要です。
 */

export interface CalendarEventData {
    castName: string
    projectName: string
    roleName: string
    startDate: Date
    endDate?: Date
    startTime?: string
    endTime?: string
    isProvisional: boolean
}

export function useGoogleCalendar() {
    const loading = ref(false)

    /**
     * カレンダーイベントを作成
     * Cloud Functions (notifyOrderCreated) 内で自動実行
     */
    async function createEvent(data: CalendarEventData): Promise<string | null> {
        // Cloud Functions側で自動作成されるため、ここでは何もしない
        console.log('Calendar event will be created via Cloud Functions:', data)
        return null
    }

    /**
     * カレンダーイベントのタイトルを更新
     * Cloud Functions (notifyStatusUpdate) 内で自動実行
     */
    async function updateEventTitle(
        eventId: string,
        castName: string,
        projectName: string,
        isProvisional: boolean
    ): Promise<boolean> {
        console.log('Calendar event will be updated via Cloud Functions:', {
            eventId, castName, projectName, isProvisional
        })
        return true
    }

    /**
     * カレンダーイベントを削除
     * Cloud Functions (deleteCastingCleanup) 内で自動実行
     */
    async function deleteEvent(eventId: string): Promise<boolean> {
        console.log('Calendar event will be deleted via Cloud Functions:', eventId)
        return true
    }

    /**
     * ステータス変更に応じたカレンダー処理
     * Cloud Functions (notifyStatusUpdate) 内で自動実行
     */
    async function handleStatusChange(
        eventId: string | undefined,
        castName: string,
        projectName: string,
        newStatus: string
    ): Promise<void> {
        if (!eventId) return
        console.log('Calendar status change will be handled via Cloud Functions:', {
            eventId, castName, projectName, newStatus
        })
    }

    /**
     * Cloud Functionsが利用可能かチェック
     */
    function isGapiAvailable(): boolean {
        // Cloud Functionsが設定されていればtrue
        // （実際のカレンダー操作はCloud Functions側で行うため）
        return true
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

/**
 * 既存のカレンダーイベントにキャストをattendeeとして追加
 * (サービスアカウント経由ではattendees追加にDomain-Wide Delegationが必要なため、
 *  ユーザーOAuthトークンを使って Calendar API を直接呼ぶ)
 *
 * @param eventId Google Calendar event id
 * @param castEmail 追加するキャストのメール
 * @param accessToken ユーザーのOAuthアクセストークン
 * @param calendarId 対象カレンダーID（省略時は VITE_CALENDAR_ID_INTERNAL）
 * @returns true if added or already exists, false on error
 */
export async function addAttendeeToCalendarEvent(
    eventId: string,
    castEmail: string,
    accessToken: string,
    calendarId?: string
): Promise<boolean> {
    const calId = calendarId || import.meta.env.VITE_CALENDAR_ID_INTERNAL
    if (!calId || !eventId || !castEmail || !accessToken) {
        console.warn('[CALENDAR] addAttendeeToCalendarEvent: missing params', { calId: !!calId, eventId: !!eventId, castEmail: !!castEmail, accessToken: !!accessToken })
        return false
    }

    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`

    try {
        // 既存attendeesを取得（重複追加防止）
        const getResp = await fetch(baseUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        })
        let existingAttendees: Array<{ email: string }> = []
        if (getResp.ok) {
            const eventData = await getResp.json() as { attendees?: Array<{ email: string }> }
            existingAttendees = eventData.attendees || []
        } else {
            console.warn(`[CALENDAR] event GET failed (${getResp.status}) — proceeding with empty attendees`)
        }

        if (existingAttendees.some(a => a.email === castEmail)) {
            console.log(`[CALENDAR] Attendee already present: ${castEmail}`)
            return true
        }

        const resp = await fetch(`${baseUrl}?sendUpdates=all`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                attendees: [...existingAttendees, { email: castEmail }],
            }),
        })
        if (resp.ok) {
            console.log(`[CALENDAR] Attendee added: ${castEmail} → event ${eventId}`)
            return true
        }
        console.warn(`[CALENDAR] Attendee add failed: ${resp.status}`)
        return false
    } catch (e) {
        console.warn('[CALENDAR] addAttendeeToCalendarEvent error:', e)
        return false
    }
}
