import { ref, computed } from 'vue'
import {
    collection, query, where, orderBy, getDocs,
    addDoc, updateDoc, doc, Timestamp
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/services/firebase'
import type { ShootingContact, ShootingContactStatus, Casting } from '@/types'
import { useToast } from 'primevue/usetoast'

export interface DateGroup {
    dateStr: string
    projects: ProjectGroup[]
}

export interface ProjectGroup {
    projectName: string
    accountName: string
    notionId?: string
    contacts: ShootingContact[]
}

/**
 * 撮影連絡DB管理composable
 * 外部キャストの決定後フロー管理
 */
export function useShootingContact() {
    const contacts = ref<ShootingContact[]>([])
    const loading = ref(false)
    const syncing = ref(false)
    const toast = useToast()

    /**
     * 全データを取得
     */
    async function fetchAll() {
        if (!db) {
            console.error('Firestore not initialized')
            return
        }
        loading.value = true
        try {
            const q = query(
                collection(db, 'shootingContacts'),
                orderBy('shootDate', 'desc')
            )
            const snapshot = await getDocs(q)
            const results: ShootingContact[] = []
            snapshot.forEach((docSnap) => {
                results.push({ id: docSnap.id, ...docSnap.data() } as ShootingContact)
            })
            contacts.value = results
        } catch (error) {
            console.error('Error fetching shooting contacts:', error)
            toast.add({ severity: 'error', summary: 'エラー', detail: '撮影連絡データの取得に失敗しました', life: 3000 })
        } finally {
            loading.value = false
        }
    }

    /**
     * ステータス別フィルタ
     */
    const contactsByStatus = computed(() => {
        const grouped: Record<ShootingContactStatus, ShootingContact[]> = {
            '香盤連絡待ち': [],
            '発注書送信待ち': [],
            'メイキング共有待ち': [],
            '投稿日連絡待ち': [],
            '完了': []
        }
        contacts.value.forEach(contact => {
            if (grouped[contact.status]) {
                grouped[contact.status].push(contact)
            }
        })
        return grouped
    })

    /**
     * ステータス別カウント
     */
    const statusCounts = computed(() => {
        const counts: Record<ShootingContactStatus, number> = {
            '香盤連絡待ち': 0, '発注書送信待ち': 0,
            'メイキング共有待ち': 0, '投稿日連絡待ち': 0, '完了': 0
        }
        contacts.value.forEach(c => { if (counts[c.status] !== undefined) counts[c.status]++ })
        return counts
    })

    /**
     * 日付→作品 グルーピング (date view)
     */
    function getDateGrouped(status: ShootingContactStatus): DateGroup[] {
        const filtered = contacts.value.filter(c => c.status === status)
        const dateMap = new Map<string, Map<string, ShootingContact[]>>()

        for (const c of filtered) {
            let dateStr = ''
            // 投稿日タブのみ postDate を使用
            if (status === '投稿日連絡待ち' && c.postDate?.toDate) {
                dateStr = c.postDate.toDate().toISOString().split('T')[0] || ''
            } else if (c.shootDate?.toDate) {
                dateStr = c.shootDate.toDate().toISOString().split('T')[0] || ''
            } else {
                dateStr = '日付未定'
            }

            if (!dateMap.has(dateStr)) dateMap.set(dateStr, new Map())
            const projMap = dateMap.get(dateStr)!
            const key = `${c.accountName}__${c.projectName}`
            if (!projMap.has(key)) projMap.set(key, [])
            projMap.get(key)!.push(c)
        }

        // Sort by date descending
        const sortedDates = [...dateMap.keys()].sort((a, b) => b.localeCompare(a))

        return sortedDates.map(dateStr => ({
            dateStr,
            projects: [...dateMap.get(dateStr)!.entries()].map(([key, contacts]) => {
                const [accountName, projectName] = key.split('__')
                return {
                    projectName: projectName || '',
                    accountName: accountName || '',
                    notionId: contacts[0]?.notionId,
                    contacts
                }
            })
        }))
    }

    /**
     * 作品→日付 グルーピング (project view)
     */
    function getProjectGrouped(status: ShootingContactStatus): { projectName: string; accountName: string; notionId?: string; contacts: ShootingContact[] }[] {
        const filtered = contacts.value.filter(c => c.status === status)
        const projMap = new Map<string, ShootingContact[]>()

        for (const c of filtered) {
            const key = `${c.accountName}__${c.projectName}`
            if (!projMap.has(key)) projMap.set(key, [])
            projMap.get(key)!.push(c)
        }

        return [...projMap.entries()].map(([key, contacts]) => {
            const [accountName, projectName] = key.split('__')
            // Sort contacts by date within project
            contacts.sort((a, b) => {
                const da = a.shootDate?.toDate?.()?.getTime() || 0
                const db2 = b.shootDate?.toDate?.()?.getTime() || 0
                return db2 - da
            })
            return {
                projectName: projectName || '',
                accountName: accountName || '',
                notionId: contacts[0]?.notionId,
                contacts
            }
        })
    }

    /**
     * キャスティングから撮影連絡DBに追加
     */
    async function addFromCasting(casting: Casting): Promise<boolean> {
        if (!db) return false
        if (casting.castType !== '外部') return false

        try {
            const existingQuery = query(
                collection(db, 'shootingContacts'),
                where('castingId', '==', casting.id)
            )
            const existing = await getDocs(existingQuery)
            if (!existing.empty) return false

            const now = Timestamp.now()
            await addDoc(collection(db, 'shootingContacts'), {
                castingId: casting.id,
                castName: casting.castName,
                castType: casting.castType,
                projectName: casting.projectName,
                accountName: casting.accountName,
                roleName: casting.roleName,
                notionId: (casting as unknown as Record<string, unknown>).notionPageId as string || '',
                shootDate: casting.startDate,
                mainSub: casting.mainSub || 'その他',
                status: '香盤連絡待ち' as ShootingContactStatus,
                slackThreadTs: casting.slackThreadTs,
                createdAt: now,
                updatedAt: now
            })

            toast.add({ severity: 'success', summary: '撮影連絡DB', detail: `${casting.castName} を追加しました`, life: 2000 })
            return true
        } catch (error) {
            console.error('Error adding to shooting contact:', error)
            toast.add({ severity: 'error', summary: 'エラー', detail: '撮影連絡DBへの追加に失敗しました', life: 3000 })
            return false
        }
    }

    /**
     * 撮影連絡データを更新
     */
    async function updateContact(contactId: string, data: Partial<ShootingContact>): Promise<boolean> {
        if (!db) return false
        try {
            const contactRef = doc(db, 'shootingContacts', contactId)
            await updateDoc(contactRef, { ...data, updatedAt: Timestamp.now() })

            // ローカル更新
            const contact = contacts.value.find(c => c.id === contactId)
            if (contact) Object.assign(contact, data)

            toast.add({ severity: 'success', summary: '更新完了', detail: '撮影連絡情報を更新しました', life: 2000 })
            return true
        } catch (error) {
            console.error('Error updating shooting contact:', error)
            toast.add({ severity: 'error', summary: 'エラー', detail: '更新に失敗しました', life: 3000 })
            return false
        }
    }

    /**
     * ステータスを次に進める
     */
    async function advanceStatus(contactId: string): Promise<boolean> {
        const contact = contacts.value.find(c => c.id === contactId)
        if (!contact) return false

        const statusOrder: ShootingContactStatus[] = [
            '香盤連絡待ち', '発注書送信待ち', 'メイキング共有待ち', '投稿日連絡待ち', '完了'
        ]
        const idx = statusOrder.indexOf(contact.status)
        if (idx === -1 || idx >= statusOrder.length - 1) return false

        const nextStatus = statusOrder[idx + 1]!
        const success = await updateContact(contactId, { status: nextStatus })
        if (success) {
            // ローカルでもステータス反映
            contact.status = nextStatus
        }
        return success
    }

    /**
     * 香盤DB同期: shootingDetails → IN/OUT/場所
     * castName（様付き対応）で直接マッチング
     */
    async function syncSchedule(): Promise<number> {
        if (!db) return 0
        syncing.value = true
        try {
            // 1. 香盤連絡待ちのcontactsを取得
            const targetContacts = contacts.value.filter(c => c.status === '香盤連絡待ち')
            if (targetContacts.length === 0) {
                toast.add({ severity: 'info', summary: '同期完了', detail: '香盤連絡待ちのデータがありません', life: 3000 })
                syncing.value = false
                return 0
            }

            // 2. shootingDetails コレクションから全件取得
            const detailsSnap = await getDocs(collection(db, 'shootingDetails'))
            if (detailsSnap.empty) {
                toast.add({ severity: 'info', summary: '同期完了', detail: '香盤DBにデータがありません', life: 3000 })
                syncing.value = false
                return 0
            }

            // 3. castName正規化 + マップ構築
            const normalizeName = (name: string) => name.replace(/[様さんサン]+$/u, '').trim()

            const detailsMap = new Map<string, { inTime: string; outTime: string; location: string; address: string }>()
            detailsSnap.forEach(docSnap => {
                const d = docSnap.data()
                if (d.castName) {
                    detailsMap.set(normalizeName(d.castName), {
                        inTime: d.inTime || '',
                        outTime: d.outTime || '',
                        location: d.location || '',
                        address: d.address || ''
                    })
                }
            })

            console.log('[SYNC] shootingDetails count:', detailsSnap.size, 'unique castNames:', detailsMap.size)

            // 4. マッチング + 更新
            let totalUpdated = 0
            for (const contact of targetContacts) {
                const normalizedName = normalizeName(contact.castName)
                const detail = detailsMap.get(normalizedName)
                if (!detail) {
                    console.log(`[SYNC] No match for: ${contact.castName} (normalized: ${normalizedName})`)
                    continue
                }

                // 未入力の項目のみ更新
                const updateData: Partial<ShootingContact> = {}
                let hasUpdate = false

                if (detail.inTime && !contact.inTime) { updateData.inTime = detail.inTime; hasUpdate = true }
                if (detail.outTime && !contact.outTime) { updateData.outTime = detail.outTime; hasUpdate = true }
                if (detail.location && !contact.location) { updateData.location = detail.location; hasUpdate = true }
                if (detail.address && !contact.address) { updateData.address = detail.address; hasUpdate = true }

                if (hasUpdate) {
                    const contactRef = doc(db, 'shootingContacts', contact.id)
                    await updateDoc(contactRef, { ...updateData, updatedAt: Timestamp.now() })
                    Object.assign(contact, updateData)
                    totalUpdated++
                    console.log(`[SYNC] Updated ${contact.castName}: `, updateData)
                }
            }

            if (totalUpdated > 0) {
                await fetchAll()
                toast.add({ severity: 'success', summary: '同期完了', detail: `${totalUpdated}件更新しました`, life: 3000 })
            } else {
                toast.add({ severity: 'info', summary: '同期完了', detail: '更新対象はありませんでした', life: 3000 })
            }
            return totalUpdated
        } catch (error) {
            console.error('Schedule sync error:', error)
            toast.add({ severity: 'error', summary: 'エラー', detail: '香盤同期に失敗しました', life: 3000 })
            return 0
        } finally {
            syncing.value = false
        }
    }

    /**
     * メイキングURL同期: offshotDrive → makingUrl
     */
    async function syncMaking(): Promise<number> {
        if (!functions) return 0
        syncing.value = true
        try {
            const syncFn = httpsCallable(functions, 'syncDriveLinksToContacts')
            // Mode 3: sync ALL
            const result = await syncFn({})
            const data = result.data as { updated?: number }
            const updated = data.updated || 0

            if (updated > 0) {
                await fetchAll()
                toast.add({ severity: 'success', summary: '同期完了', detail: `${updated}件更新しました`, life: 3000 })
            } else {
                toast.add({ severity: 'info', summary: '同期完了', detail: '更新対象はありませんでした', life: 3000 })
            }
            return updated
        } catch (error) {
            console.error('Making sync error:', error)
            toast.add({ severity: 'error', summary: 'エラー', detail: 'メイキング同期に失敗しました', life: 3000 })
            return 0
        } finally {
            syncing.value = false
        }
    }

    return {
        contacts,
        loading,
        syncing,
        contactsByStatus,
        statusCounts,
        fetchAll,
        getDateGrouped,
        getProjectGrouped,
        addFromCasting,
        updateContact,
        advanceStatus,
        syncSchedule,
        syncMaking
    }
}
