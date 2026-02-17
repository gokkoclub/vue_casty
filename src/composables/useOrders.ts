import { ref } from 'vue'
import {
    collection, doc, writeBatch,
    Timestamp
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/services/firebase'
import { useOrderStore } from '@/stores/orderStore'
import { useAuth } from '@/composables/useAuth'
import { useLoading } from '@/composables/useLoading'
import { useToast } from 'primevue/usetoast'

export interface OrderItem {
    castId: string
    castName: string
    castType: '内部' | '外部'
    roleName: string
    rank: number
    note: string
    mainSub: 'メイン' | 'サブ' | 'その他'
    projectName: string
    slackMentionId?: string
}

export interface OrderPayload {
    mode: 'shooting' | 'external' | 'internal'
    accountName: string
    projectName: string
    projectId?: string  // Notion Page ID (for shooting mode)
    dateRanges: string[]
    items: OrderItem[]
    pdfFile?: File
    shootingData?: {
        title: string
        team: string
        director?: string
        floorDirector?: string
    }
}

/**
 * 開発環境用: フロントエンドから直接Slack通知を送信
 * ⚠️ 本番環境では絶対に使用しないこと（Bot Tokenが露出します）
 */
async function sendSlackNotificationDirect(payload: OrderPayload): Promise<{ ts: string; permalink: string } | null> {
    const slackToken = import.meta.env.VITE_SLACK_BOT_TOKEN
    const slackChannel = import.meta.env.VITE_SLACK_DEFAULT_CHANNEL

    if (!slackToken || !slackChannel) {
        console.warn('Slack credentials not found in .env.local')
        return null
    }

    try {
        // Build message text (simplified version)
        const hasInternal = payload.items.some(i => i.castType === '内部')

        let text = 'キャスティングオーダーがありました。\n'
        if (hasInternal) {
            text += '*内部キャストはスタンプで反応ください*\n'
        }
        text += '\n`撮影日`\n'
        payload.dateRanges.forEach(d => text += `・${d}\n`)
        text += '\n`アカウント`\n'
        text += payload.accountName + '\n'
        text += '\n`作品名`\n'
        const projects = [...new Set(payload.items.map(i => i.projectName))]
        text += projects.join('/') + '\n'
        text += '\n`役名`\n'

        // Group by project and role
        const grouped: Record<string, Record<string, OrderItem[]>> = {}
        payload.items.forEach(item => {
            if (!grouped[item.projectName]) grouped[item.projectName] = {}
            const projectGroup = grouped[item.projectName]!
            if (!projectGroup[item.roleName]) projectGroup[item.roleName] = []
            projectGroup[item.roleName]!.push(item)
        })

        for (const [projectName, roles] of Object.entries(grouped)) {
            text += `【${projectName}】\n`
            for (const [roleName, casts] of Object.entries(roles)) {
                text += `  ${roleName}\n`
                casts.sort((a, b) => a.rank - b.rank)
                casts.forEach(c => {
                    const mention = c.slackMentionId ? `<@${c.slackMentionId}>` : c.castName
                    text += `    第${c.rank}候補：${mention}\n`
                })
            }
        }

        if (payload.projectId) {
            text += '\n`Notionリンク`\n'
            text += `https://www.notion.so/${payload.projectId.replace(/-/g, '')}\n`
        }

        text += '\n--------------------------------------------------'

        // Call Slack API directly
        const response = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${slackToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                channel: slackChannel,
                text: text,
                mrkdwn: true
            })
        })

        const result = await response.json()
        if (!result.ok) {
            throw new Error(result.error || 'Slack API error')
        }

        // Get permalink
        const permalinkResponse = await fetch('https://slack.com/api/chat.getPermalink', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${slackToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                channel: slackChannel,
                message_ts: result.ts
            })
        })

        const permalinkResult = await permalinkResponse.json()

        return {
            ts: result.ts,
            permalink: permalinkResult.permalink || ''
        }
    } catch (error) {
        console.error('Direct Slack notification failed:', error)
        return null
    }
}

export function useOrders() {
    const orderStore = useOrderStore()
    const toast = useToast()
    const loading = ref(false)
    // Note: Calendar events are now created automatically by Cloud Functions

    /**
     * カートの内容をOrderPayloadに変換
     */
    const prepareOrderPayload = (): OrderPayload | null => {
        const { context, projects, pool } = orderStore

        // Validation
        if (context.dateRanges.length === 0) {
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '日程が選択されていません'
            })
            return null
        }

        // Mode-specific validation
        if (context.mode === 'shooting' && !context.shootingData) {
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '撮影案件が選択されていません'
            })
            return null
        }

        if ((context.mode === 'external' || context.mode === 'internal') && !orderStore.manualMeta.projectName) {
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '案件名/イベント名を入力してください'
            })
            return null
        }

        // Build items from flattened structure
        const items: OrderItem[] = []

        // For external/internal events, use pool directly (no projects/roles)
        if (context.mode === 'external' || context.mode === 'internal') {
            Object.values(pool).forEach(cartCast => {
                items.push({
                    castId: cartCast.cast.id,
                    castName: cartCast.cast.name,
                    castType: cartCast.cast.castType,
                    roleName: context.mode === 'external' ? '外部案件' : '社内イベント',
                    rank: 1,
                    note: '',
                    mainSub: 'その他',
                    projectName: orderStore.manualMeta.projectName || (context.mode === 'external' ? '外部案件' : '社内イベント'),
                    slackMentionId: cartCast.cast.slackMentionId
                })
            })
        } else {
            // For shooting mode, use projects/roles structure
            projects.forEach(project => {
                project.roles.forEach(role => {
                    role.castIds.forEach((castId, index) => {
                        const cartCast = pool[castId]
                        if (!cartCast) return

                        items.push({
                            castId,
                            castName: cartCast.cast.name,
                            castType: cartCast.cast.castType,
                            roleName: role.name || '役名なし',
                            rank: index + 1, // 1-based rank
                            note: role.note || '',
                            mainSub: role.type,
                            projectName: project.title || orderStore.displayProjectName,
                            slackMentionId: cartCast.cast.slackMentionId
                        })
                    })
                })
            })
        }

        if (items.length === 0) {
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: 'キャストが選択されていません'
            })
            return null
        }

        // Build payload
        const payload: OrderPayload = {
            mode: context.mode as 'shooting' | 'external' | 'internal',
            accountName: orderStore.displayAccountName,
            projectName: orderStore.displayProjectName,
            dateRanges: context.dateRanges,
            items
        }

        if (context.mode === 'shooting' && context.shootingData) {
            payload.projectId = context.shootingData.notionPageId
            payload.shootingData = {
                title: context.shootingData.title,
                team: context.shootingData.team,
                director: context.shootingData.director,
                floorDirector: context.shootingData.floorDirector
            }
        }

        return payload
    }

    /**
     * オーダーをFirestoreに保存
     */
    const submitOrder = async (pdfFile?: File | null): Promise<boolean> => {
        if (!db) {
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: 'Firebaseが初期化されていません'
            })
            return false
        }

        const { userName } = useAuth()

        loading.value = true
        const { startLoading, stopLoading } = useLoading()
        startLoading('オーダーを送信中...')

        try {
            const payload = prepareOrderPayload()
            if (!payload) {
                loading.value = false
                stopLoading()
                return false
            }

            if (pdfFile) {
                payload.pdfFile = pdfFile
            }

            // Firestore batch write
            const batch = writeBatch(db)
            const now = Timestamp.now()
            const castingIds: string[] = []

            // Create casting documents
            for (const item of payload.items) {
                for (const dateRange of payload.dateRanges) {
                    const [startDateStr, endDateStr] = dateRange.includes('~')
                        ? dateRange.split('~').map(s => s.trim())
                        : [dateRange, dateRange]

                    // タイムゾーン安全な日付パース（正午に設定してUTC変換時の-1日を防止）
                    const parseLocalDate = (str: string): Date => {
                        const parts = str.split('/')
                        const d = new Date(
                            parseInt(parts[0]!),
                            parseInt(parts[1]!) - 1,
                            parseInt(parts[2]!),
                            12, 0, 0 // 正午に設定 → UTC変換しても同日
                        )
                        console.log('[DEBUG parseLocalDate]', str, '→', d.toString(), 'getDate:', d.getDate())
                        return d
                    }

                    console.log('[DEBUG SUBMIT] mode:', payload.mode, 'dateRange:', dateRange, 'startDateStr:', startDateStr, 'endDateStr:', endDateStr)
                    console.log('[DEBUG SUBMIT] roleName:', item.roleName, 'castType:', item.castType, 'projectName:', item.projectName)

                    const castingRef = doc(collection(db, 'castings'))
                    castingIds.push(castingRef.id)

                    const castingData: any = {
                        castId: item.castId,
                        castName: item.castName,
                        castType: item.castType,
                        accountName: payload.accountName,
                        projectName: item.projectName,
                        projectId: payload.projectId || '',
                        roleName: item.roleName,
                        rank: item.rank,
                        mode: payload.mode || 'shooting',
                        // ステータス初期値: 外部/社内は ORDER_INTEGRATION_GUIDE 準拠
                        status: (() => {
                            if (payload.mode === 'external' || payload.mode === 'internal') {
                                return item.castType === '外部' ? '決定' : '仮キャスティング'
                            }
                            return '仮押さえ'
                        })(),
                        note: item.note,
                        mainSub: item.mainSub,
                        cost: 0,
                        slackThreadTs: '',
                        slackPermalink: '',
                        calendarEventId: '',
                        dbSentStatus: '',
                        startDate: Timestamp.fromDate(parseLocalDate(startDateStr || dateRange)),
                        endDate: Timestamp.fromDate(parseLocalDate(endDateStr || startDateStr || dateRange)),
                        createdAt: now,
                        updatedAt: now,
                        createdBy: 'current-user',
                        updatedBy: 'current-user'
                    }

                    // For multi-day orders (中長編), auto-generate shootingDates
                    if (startDateStr && endDateStr && startDateStr !== endDateStr) {
                        const dates: string[] = []
                        const current = new Date(startDateStr)
                        const end = new Date(endDateStr)
                        while (current <= end) {
                            dates.push(current.toISOString().split('T')[0]!)
                            current.setDate(current.getDate() + 1)
                        }
                        castingData.shootingDates = dates
                    }

                    // Add time fields for external/internal events
                    if (payload.mode === 'external' || payload.mode === 'internal') {
                        if (orderStore.manualMeta.startTime) {
                            castingData.startTime = orderStore.manualMeta.startTime
                        }
                        if (orderStore.manualMeta.endTime) {
                            castingData.endTime = orderStore.manualMeta.endTime
                        }
                    }

                    batch.set(castingRef, castingData)
                }
            }


            await batch.commit()

            // Cloud Functions経由でSlack通知 + カレンダー作成
            // Cloud Functionsが自動でFirestoreにslackThreadTs/calendarEventIdを書き戻す
            let slackResult: { ts: string; permalink: string } | null = null

            if (functions) {
                try {
                    const notifyOrder = httpsCallable(functions, 'notifyOrderCreated')
                    console.log('[DEBUG CF CALL] mode:', payload.mode)

                    // PDF file → base64
                    let pdfBase64: string | undefined
                    let pdfFileName: string | undefined
                    if (pdfFile) {
                        const arrayBuffer = await pdfFile.arrayBuffer()
                        const bytes = new Uint8Array(arrayBuffer)
                        let binary = ''
                        for (let i = 0; i < bytes.length; i++) {
                            binary += String.fromCharCode(bytes[i]!)
                        }
                        pdfBase64 = btoa(binary)
                        pdfFileName = pdfFile.name
                    }

                    const result = await notifyOrder({
                        accountName: payload.accountName,
                        projectName: payload.projectName,
                        projectId: payload.projectId,
                        mode: payload.mode,
                        dateRanges: payload.dateRanges,
                        shootingData: payload.shootingData || undefined,
                        startTime: orderStore.manualMeta.startTime || undefined,
                        endTime: orderStore.manualMeta.endTime || undefined,
                        ccMention: userName.value || undefined,
                        hasInternal: payload.items.some(i => i.castType === '内部'),
                        pdfBase64,
                        pdfFileName,
                        items: payload.items.map(i => ({
                            castId: i.castId,
                            castName: i.castName,
                            castType: i.castType,
                            roleName: i.roleName,
                            rank: i.rank,
                            mainSub: i.mainSub,
                            projectName: i.projectName,
                            slackMentionId: i.slackMentionId
                        })),
                        castingIds
                    })

                    if (result.data && typeof result.data === 'object' && 'ts' in result.data) {
                        slackResult = result.data as { ts: string; permalink: string }
                        console.log('[CF SUCCESS] Cloud Function returned:', JSON.stringify(result.data))
                    } else {
                        console.warn('[CF WARNING] Cloud Function returned unexpected data:', result.data)
                    }
                } catch (cloudFnError) {
                    console.error('[CF FAILED] Cloud Function call failed:', cloudFnError)
                    console.warn('[CF FALLBACK] Falling back to direct Slack API (calendar will NOT be created)')
                    // Fallback: 開発用直接Slack API
                    slackResult = await sendSlackNotificationDirect(payload)

                    // Fallback時はフロント側でFirestore更新
                    if (slackResult && db) {
                        const updateBatch = writeBatch(db)
                        for (const id of castingIds) {
                            updateBatch.update(doc(db, 'castings', id), {
                                slackThreadTs: slackResult.ts,
                                slackPermalink: slackResult.permalink
                            })
                        }
                        await updateBatch.commit()
                    }
                }
            } else {
                // Cloud Functions未設定: 開発用直接Slack API
                console.info('Cloud Functions not available, using direct Slack API')
                slackResult = await sendSlackNotificationDirect(payload)
            }

            toast.add({
                severity: 'success',
                summary: 'オーダー送信完了',
                detail: `${payload.items.length}件のキャスティングを登録しました`,
                life: 5000
            })

            // Clear cart
            orderStore.clear()

            loading.value = false
            stopLoading()
            return true

        } catch (error) {
            console.error('Order submission error:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: 'オーダーの送信中にエラーが発生しました',
                life: 5000
            })

            loading.value = false
            stopLoading()
            return false
        }
    }

    return {
        loading,
        submitOrder
    }
}
