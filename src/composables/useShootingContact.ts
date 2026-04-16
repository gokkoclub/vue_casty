import { ref, computed } from 'vue'
import {
    collection, query, where, getDocs,
    updateDoc, doc, Timestamp
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
 * 撮影連絡DB管理composable（統合版）
 *
 * 旧: shootingContacts コレクションを CRUD
 * 新: castings コレクション（contactStatus != null）を読み書き
 *
 * ShootingContact 型への変換アダプタを含むので、
 * ShootingContactView 側のコード変更は最小限で済む。
 */

// タイムゾーン安全なローカル日付キー (YYYY-MM-DD)
function toLocalDateKey(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

/**
 * Casting ドキュメントを ShootingContact 型に変換するアダプタ
 * ShootingContactView が期待するインターフェースに合わせる
 */
function castingToContact(id: string, data: Record<string, unknown>): ShootingContact {
    return {
        id,
        castingId: id,  // 統合後は自分自身
        castName: (data.castName as string) || '',
        castType: (data.castType as '内部' | '外部') || '外部',
        projectName: (data.projectName as string) || '',
        accountName: (data.accountName as string) || '',
        roleName: (data.roleName as string) || '',
        notionId: (data.projectId as string) || '',
        shootDate: data.startDate as Timestamp,
        inTime: (data.inTime as string) || undefined,
        outTime: (data.outTime as string) || undefined,
        location: (data.location as string) || undefined,
        address: (data.address as string) || undefined,
        fee: (data.fee as number) ?? (data.cost as number) ?? undefined,
        cost: data.fee ? String(data.fee) : data.cost ? String(data.cost) : undefined,
        makingUrl: (data.makingUrl as string) || undefined,
        postDate: (data.postDate as Timestamp) || undefined,
        mainSub: (data.mainSub as 'メイン' | 'サブ' | 'その他') || 'その他',
        status: (data.contactStatus as ShootingContactStatus) || '香盤連絡待ち',
        email: (data.contactEmail as string) || undefined,
        orderDocumentId: (data.orderDocumentId as string) || undefined,
        poUuid: (data.poUuid as string) || undefined,
        slackThreadTs: (data.slackThreadTs as string) || undefined,
        createdAt: data.createdAt as Timestamp,
        updatedAt: data.updatedAt as Timestamp,
    }
}

export function useShootingContact() {
    const contacts = ref<ShootingContact[]>([])
    const loading = ref(false)
    const syncing = ref(false)
    const toast = useToast()

    /**
     * castings コレクションから contactStatus が設定されたものを取得
     */
    async function fetchAll() {
        if (!db) {
            console.error('Firestore not initialized')
            return
        }
        loading.value = true
        try {
            const q = query(
                collection(db, 'castings'),
                where('contactStatus', '!=', null)
            )
            const snapshot = await getDocs(q)
            const results: ShootingContact[] = []
            snapshot.forEach((docSnap) => {
                const data = docSnap.data()
                // deleted / キャンセル / NG は除外
                if (data.deleted === true) return
                if (data.status === 'キャンセル' || data.status === 'NG' || data.status === '削除済み') return
                results.push(castingToContact(docSnap.id, data))
            })
            // shootDate 降順
            results.sort((a, b) => {
                const at = a.shootDate?.toMillis?.() || 0
                const bt = b.shootDate?.toMillis?.() || 0
                return bt - at
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
    function getDateGrouped(status: ShootingContactStatus, searchQuery?: string): DateGroup[] {
        let filtered = contacts.value.filter(c => c.status === status)

        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            filtered = filtered.filter(c =>
                c.castName?.toLowerCase().includes(q) ||
                c.projectName?.toLowerCase().includes(q) ||
                c.accountName?.toLowerCase().includes(q) ||
                c.roleName?.toLowerCase().includes(q) ||
                c.location?.toLowerCase().includes(q)
            )
        }
        const dateMap = new Map<string, Map<string, ShootingContact[]>>()

        for (const c of filtered) {
            let dateStr = ''
            if (status === '投稿日連絡待ち' && c.postDate?.toDate) {
                dateStr = toLocalDateKey(c.postDate.toDate())
            } else if (c.shootDate?.toDate) {
                dateStr = toLocalDateKey(c.shootDate.toDate())
            } else {
                dateStr = '日付未定'
            }

            if (!dateMap.has(dateStr)) dateMap.set(dateStr, new Map())
            const projMap = dateMap.get(dateStr)!
            const key = `${c.accountName}__${c.projectName}`
            if (!projMap.has(key)) projMap.set(key, [])
            projMap.get(key)!.push(c)
        }

        const sortedDates = [...dateMap.keys()].sort((a, b) => a.localeCompare(b))

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
    function getProjectGrouped(status: ShootingContactStatus, searchQuery?: string): { projectName: string; accountName: string; notionId?: string; contacts: ShootingContact[] }[] {
        let filtered = contacts.value.filter(c => c.status === status)

        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            filtered = filtered.filter(c =>
                c.castName?.toLowerCase().includes(q) ||
                c.projectName?.toLowerCase().includes(q) ||
                c.accountName?.toLowerCase().includes(q) ||
                c.roleName?.toLowerCase().includes(q) ||
                c.location?.toLowerCase().includes(q)
            )
        }
        const projMap = new Map<string, ShootingContact[]>()

        for (const c of filtered) {
            const key = `${c.accountName}__${c.projectName}`
            if (!projMap.has(key)) projMap.set(key, [])
            projMap.get(key)!.push(c)
        }

        return [...projMap.entries()].map(([key, contacts]) => {
            const [accountName, projectName] = key.split('__')
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
     * キャスティングを撮影連絡対象にする（= contactStatus を設定）
     * 統合版: castings ドキュメントに contactStatus フィールドを追加するだけ
     */
    async function addFromCasting(casting: Casting): Promise<boolean> {
        if (!db) return false
        if (casting.castType !== '外部') return false

        try {
            // 既に contactStatus が設定されている場合はスキップ
            if ((casting as Record<string, unknown>).contactStatus) return false

            const castingRef = doc(db, 'castings', casting.id)
            await updateDoc(castingRef, {
                contactStatus: '香盤連絡待ち' as ShootingContactStatus,
                updatedAt: Timestamp.now()
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
     * 統合版: castings ドキュメントを直接更新
     */
    async function updateContact(contactId: string, data: Partial<ShootingContact>): Promise<boolean> {
        if (!db) return false
        try {
            const castingRef = doc(db, 'castings', contactId)

            // ShootingContact フィールド → castings フィールドのマッピング
            const updateData: Record<string, unknown> = { updatedAt: Timestamp.now() }
            if (data.status !== undefined) updateData.contactStatus = data.status
            if (data.inTime !== undefined) { updateData.inTime = data.inTime; updateData.startTime = data.inTime }
            if (data.outTime !== undefined) { updateData.outTime = data.outTime; updateData.endTime = data.outTime }
            if (data.location !== undefined) updateData.location = data.location
            if (data.address !== undefined) updateData.address = data.address
            if (data.fee !== undefined) { updateData.fee = data.fee; updateData.cost = data.fee }
            if (data.cost !== undefined) {
                const numCost = parseInt(String(data.cost).replace(/,/g, ''), 10) || 0
                updateData.fee = numCost
                updateData.cost = numCost
            }
            if (data.makingUrl !== undefined) updateData.makingUrl = data.makingUrl
            if (data.postDate !== undefined) updateData.postDate = data.postDate
            if (data.email !== undefined) updateData.contactEmail = data.email
            if (data.orderDocumentId !== undefined) updateData.orderDocumentId = data.orderDocumentId
            if (data.poUuid !== undefined) updateData.poUuid = data.poUuid

            await updateDoc(castingRef, updateData)

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
            contact.status = nextStatus
        }
        return success
    }

    /**
     * ステータスを前に戻す
     */
    async function revertStatus(contactId: string): Promise<boolean> {
        const contact = contacts.value.find(c => c.id === contactId)
        if (!contact) return false

        const statusOrder: ShootingContactStatus[] = [
            '香盤連絡待ち', '発注書送信待ち', 'メイキング共有待ち', '投稿日連絡待ち', '完了'
        ]
        const idx = statusOrder.indexOf(contact.status)
        if (idx <= 0) return false

        const prevStatus = statusOrder[idx - 1]!
        const success = await updateContact(contactId, { status: prevStatus })
        if (success) {
            contact.status = prevStatus
        }
        return success
    }

    /**
     * 香盤DB同期: shootingDetails → castings の inTime/outTime/location
     * castName（様付き対応）で直接マッチング
     */
    async function syncSchedule(): Promise<number> {
        if (!db) return 0
        syncing.value = true
        try {
            const targetContacts = contacts.value.filter(c => c.status === '香盤連絡待ち')
            if (targetContacts.length === 0) {
                toast.add({ severity: 'info', summary: '同期完了', detail: '香盤連絡待ちのデータがありません', life: 3000 })
                syncing.value = false
                return 0
            }

            const detailsSnap = await getDocs(collection(db, 'shootingDetails'))
            if (detailsSnap.empty) {
                toast.add({ severity: 'info', summary: '同期完了', detail: '香盤DBにデータがありません', life: 3000 })
                syncing.value = false
                return 0
            }

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

            let totalUpdated = 0
            for (const contact of targetContacts) {
                const normalizedName = normalizeName(contact.castName)
                const detail = detailsMap.get(normalizedName)
                if (!detail) continue

                const updateData: Partial<ShootingContact> = {}
                let hasUpdate = false

                if (detail.inTime && !contact.inTime) { updateData.inTime = detail.inTime; hasUpdate = true }
                if (detail.outTime && !contact.outTime) { updateData.outTime = detail.outTime; hasUpdate = true }
                if (detail.location && !contact.location) { updateData.location = detail.location; hasUpdate = true }
                if (detail.address && !contact.address) { updateData.address = detail.address; hasUpdate = true }

                if (hasUpdate) {
                    // castings ドキュメントを直接更新
                    const castingRef = doc(db, 'castings', contact.id)
                    await updateDoc(castingRef, {
                        ...(updateData.inTime ? { inTime: updateData.inTime, startTime: updateData.inTime } : {}),
                        ...(updateData.outTime ? { outTime: updateData.outTime, endTime: updateData.outTime } : {}),
                        ...(updateData.location ? { location: updateData.location } : {}),
                        ...(updateData.address ? { address: updateData.address } : {}),
                        updatedAt: Timestamp.now()
                    })
                    Object.assign(contact, updateData)
                    totalUpdated++
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
     * メイキングURL同期
     */
    async function syncMaking(): Promise<number> {
        if (!functions) return 0
        syncing.value = true
        try {
            const syncFn = httpsCallable(functions, 'syncDriveLinksToContacts')
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

    /**
     * 撮影連絡対象から外す（= contactStatus を null に）
     * ドキュメント自体は castings に残る
     */
    async function deleteContacts(ids: string[]): Promise<boolean> {
        try {
            for (const id of ids) {
                await updateDoc(doc(db!, 'castings', id), {
                    contactStatus: null,
                    updatedAt: Timestamp.now()
                })
            }
            contacts.value = contacts.value.filter(c => !ids.includes(c.id))
            toast.add({
                severity: 'success',
                summary: '削除完了',
                detail: `${ids.length}件のデータを撮影連絡DBから除外しました`,
                life: 3000
            })
            return true
        } catch (error) {
            console.error('Error deleting contacts:', error)
            toast.add({
                severity: 'error',
                summary: '削除エラー',
                detail: 'データの削除に失敗しました',
                life: 3000
            })
            return false
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
        revertStatus,
        deleteContacts,
        syncSchedule,
        syncMaking
    }
}
