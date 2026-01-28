import { ref, computed } from 'vue'
import { collection, query, orderBy, getDocs, doc, updateDoc, Timestamp } from 'firebase/firestore'
import { db } from '@/services/firebase'
import type { Casting, CastingStatus } from '@/types'
import { useToast } from 'primevue/usetoast'
import { useAuth } from '@/composables/useAuth'
import { useSlack } from '@/composables/useSlack'
import { useShootingContact } from '@/composables/useShootingContact'
import { useNotion } from '@/composables/useNotion'

export interface CastingFilters {
    status?: CastingStatus[]
    dateRange?: { start: Date; end: Date }
    searchQuery?: string
    teamName?: string
}

export function useCastings() {
    const castings = ref<Casting[]>([])
    const loading = ref(false)
    const toast = useToast()
    const { userEmail } = useAuth()
    const { notifyStatusUpdate } = useSlack()
    const { addFromCasting } = useShootingContact()
    const { syncToNotion } = useNotion()

    /**
     * Fetch castings from Firestore with optional filters
     */
    async function fetchCastings(filters?: CastingFilters) {
        if (!db) {
            console.error('Firestore not initialized')
            return
        }

        loading.value = true

        try {
            const q = query(collection(db, 'castings'), orderBy('startDate', 'desc'))

            const snapshot = await getDocs(q)
            let results: Casting[] = []

            snapshot.forEach((docSnap) => {
                const data = docSnap.data()
                results.push({
                    id: docSnap.id,
                    ...data
                } as Casting)
            })

            // Apply in-memory filters
            if (filters) {
                // Filter by status
                if (filters.status && filters.status.length > 0) {
                    results = results.filter(c => filters.status!.includes(c.status))
                }

                // Filter by date range
                if (filters.dateRange) {
                    const startTimestamp = Timestamp.fromDate(filters.dateRange.start)
                    const endTimestamp = Timestamp.fromDate(filters.dateRange.end)

                    results = results.filter(c => {
                        return c.startDate >= startTimestamp && c.startDate <= endTimestamp
                    })
                }

                // Filter by search query (cast name or project name)
                if (filters.searchQuery) {
                    const searchQuery = filters.searchQuery.toLowerCase()
                    results = results.filter(c =>
                        c.castName.toLowerCase().includes(searchQuery) ||
                        c.projectName.toLowerCase().includes(searchQuery)
                    )
                }

                // Filter by team name
                if (filters.teamName) {
                    const team = filters.teamName.toLowerCase()
                    results = results.filter(c =>
                        c.accountName.toLowerCase().includes(team)
                    )
                }
            }

            // Hide deleted castings
            results = results.filter(c => c.status !== '削除済み' as CastingStatus)

            castings.value = results
        } catch (error) {
            console.error('Error fetching castings:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: 'キャスティング情報の取得に失敗しました',
                life: 3000
            })
        } finally {
            loading.value = false
        }
    }

    /**
     * Update casting status with Slack notification
     */
    async function updateCastingStatus(
        castingId: string,
        newStatus: CastingStatus,
        extraMessage?: string
    ) {
        if (!db) {
            console.error('Firestore not initialized')
            return false
        }

        const casting = castings.value.find(c => c.id === castingId)
        if (!casting) {
            console.error('Casting not found:', castingId)
            return false
        }

        const previousStatus = casting.status

        try {
            // 1. Update Firestore
            const castingRef = doc(db, 'castings', castingId)
            await updateDoc(castingRef, {
                status: newStatus,
                updatedAt: Timestamp.now(),
                updatedBy: userEmail.value || 'unknown'
            })

            // 2. Update local state
            casting.status = newStatus
            casting.updatedAt = Timestamp.now()

            // 3. Send Slack notification (background, don't block)
            if (casting.slackThreadTs) {
                notifyStatusUpdate({
                    castingId,
                    castName: casting.castName,
                    projectName: casting.projectName,
                    newStatus,
                    previousStatus,
                    slackThreadTs: casting.slackThreadTs,
                    extraMessage,
                    isInternal: casting.castType === '内部'
                }).catch(err => {
                    console.warn('Slack notification failed:', err)
                })
            }

            // 4. TODO: Handle calendar events for internal casts
            // - OK/決定: Remove [仮] prefix from calendar event
            // - NG/キャンセル: Delete calendar event

            // 5. Handle shooting contact DB for external casts
            // 決定ステータス + 外部キャストの場合、撮影連絡DBに自動追加
            if (newStatus === '決定' && casting.castType === '外部') {
                addFromCasting(casting).catch(err => {
                    console.warn('Failed to add to shooting contact DB:', err)
                })
            }

            // 6. Notion sync for OK/決定
            // ステータスがOKまたは決定の場合、Notionに同期
            if (newStatus === 'OK' || newStatus === '決定') {
                syncToNotion({
                    projectId: casting.projectId || '',
                    castName: casting.castName,
                    status: newStatus,
                    mainSub: casting.mainSub || '',
                    roleName: casting.roleName,
                    accountName: casting.accountName
                }).catch(err => {
                    console.warn('Failed to sync to Notion:', err)
                })
            }

            toast.add({
                severity: 'success',
                summary: 'ステータス更新',
                detail: `ステータスを「${newStatus}」に変更しました`,
                life: 2000
            })

            return true
        } catch (error) {
            console.error('Error updating casting status:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: 'ステータスの更新に失敗しました',
                life: 3000
            })
            return false
        }
    }

    /**
     * Delete casting (soft delete - set status to 削除済み)
     */
    async function deleteCasting(castingId: string): Promise<boolean> {
        if (!db) return false

        const casting = castings.value.find(c => c.id === castingId)
        if (!casting) return false

        try {
            const castingRef = doc(db, 'castings', castingId)
            await updateDoc(castingRef, {
                status: '削除済み',
                updatedAt: Timestamp.now(),
                updatedBy: userEmail.value || 'unknown'
            })

            // Remove from local state
            castings.value = castings.value.filter(c => c.id !== castingId)

            // TODO: Delete calendar event if exists
            // TODO: Send Slack notification about deletion

            toast.add({
                severity: 'success',
                summary: '削除完了',
                detail: 'キャスティングを削除しました',
                life: 2000
            })

            return true
        } catch (error) {
            console.error('Error deleting casting:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: 'キャスティングの削除に失敗しました',
                life: 3000
            })
            return false
        }
    }

    /**
     * Get single casting by ID
     */
    function getCastingById(castingId: string): Casting | undefined {
        return castings.value.find(c => c.id === castingId)
    }

    /**
     * Update casting cost
     */
    async function updateCastingCost(castingId: string, cost: number): Promise<boolean> {
        if (!db) return false

        const casting = castings.value.find(c => c.id === castingId)
        if (!casting) return false

        try {
            const castingRef = doc(db, 'castings', castingId)
            await updateDoc(castingRef, {
                cost,
                updatedAt: Timestamp.now(),
                updatedBy: userEmail.value || 'unknown'
            })

            // Update local state
            casting.cost = cost
            casting.updatedAt = Timestamp.now()

            toast.add({
                severity: 'success',
                summary: '保存完了',
                detail: '金額を更新しました',
                life: 2000
            })

            return true
        } catch (error) {
            console.error('Error updating cost:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: '金額の更新に失敗しました',
                life: 3000
            })
            return false
        }
    }

    /**
     * Group castings by date
     */
    const castingsByDate = computed(() => {
        const grouped: Record<string, Casting[]> = {}

        castings.value.forEach(casting => {
            if (!casting.startDate) return

            const date = casting.startDate.toDate()
            const dateKey = date.toISOString().split('T')[0]
            if (!dateKey) return

            if (!grouped[dateKey]) {
                grouped[dateKey] = []
            }
            grouped[dateKey]!.push(casting)
        })

        // Sort each day's castings by rank
        Object.values(grouped).forEach(dayCastings => {
            dayCastings.sort((a, b) => (a.rank || 0) - (b.rank || 0))
        })

        return grouped
    })

    /**
     * Get sorted date keys
     */
    const sortedDates = computed(() => {
        return Object.keys(castingsByDate.value).sort().reverse() // Most recent first
    })

    // Special account names for tab filtering
    const SPECIAL_ACCOUNTS = ['外部案件', '社内イベント']

    /**
     * Hierarchical grouping: Date -> Account -> Project -> Castings
     */
    interface ProjectGroup {
        projectName: string
        castings: Casting[]
        updaters: string[]
    }

    interface AccountGroup {
        accountName: string
        projects: ProjectGroup[]
    }

    interface DateGroup {
        date: string
        accounts: AccountGroup[]
        hasOrderWait: boolean
    }

    /**
     * Get castings grouped by hierarchy with filters
     */
    function getHierarchicalCastings(options: {
        month: Date
        tab: 'normal' | 'special'
        showPast: boolean
        orderWaitOnly: boolean
    }): DateGroup[] {
        const { month, tab, showPast, orderWaitOnly } = options
        const ORDER_WAIT_STATUSES = ['オーダー待ち', 'オーダー待ち（仮キャスティング）']

        // Calculate month range
        const monthStart = new Date(month.getFullYear(), month.getMonth(), 1)
        const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0)
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        // Group by date first
        const dateMap = new Map<string, Map<string, Map<string, Casting[]>>>()

        castings.value.forEach(casting => {
            if (!casting.startDate || !casting.endDate) return

            const startDate = casting.startDate.toDate()
            const endDate = casting.endDate.toDate()

            // Generate all dates in range
            let currentDate = new Date(Math.max(startDate.getTime(), monthStart.getTime()))
            const lastDate = new Date(Math.min(endDate.getTime(), monthEnd.getTime()))

            while (currentDate <= lastDate) {
                const dateKey = currentDate.toISOString().split('T')[0]!

                // Skip past dates if showPast is false
                if (!showPast && currentDate < today) {
                    currentDate.setDate(currentDate.getDate() + 1)
                    continue
                }

                // Tab filtering
                const isSpecialAccount = SPECIAL_ACCOUNTS.includes(casting.accountName)
                if (tab === 'special' && !isSpecialAccount) {
                    currentDate.setDate(currentDate.getDate() + 1)
                    continue
                }
                if (tab === 'normal' && isSpecialAccount) {
                    currentDate.setDate(currentDate.getDate() + 1)
                    continue
                }

                // Initialize maps
                if (!dateMap.has(dateKey)) {
                    dateMap.set(dateKey, new Map())
                }
                const accountMap = dateMap.get(dateKey)!

                if (!accountMap.has(casting.accountName)) {
                    accountMap.set(casting.accountName, new Map())
                }
                const projectMap = accountMap.get(casting.accountName)!

                if (!projectMap.has(casting.projectName)) {
                    projectMap.set(casting.projectName, [])
                }
                projectMap.get(casting.projectName)!.push(casting)

                currentDate.setDate(currentDate.getDate() + 1)
            }
        })

        // Convert to array structure
        const result: DateGroup[] = []
        const sortedDateKeys = Array.from(dateMap.keys()).sort()

        for (const dateKey of sortedDateKeys) {
            const accountMap = dateMap.get(dateKey)!
            const accounts: AccountGroup[] = []
            let hasOrderWait = false

            for (const [accountName, projectMap] of accountMap) {
                const projects: ProjectGroup[] = []

                for (const [projectName, projectCastings] of projectMap) {
                    // Apply orderWaitOnly filter
                    let filteredCastings = projectCastings
                    if (orderWaitOnly) {
                        filteredCastings = projectCastings.filter(c =>
                            ORDER_WAIT_STATUSES.includes(c.status)
                        )
                    }

                    if (filteredCastings.length === 0) continue

                    // Check for order wait status
                    if (filteredCastings.some(c => ORDER_WAIT_STATUSES.includes(c.status))) {
                        hasOrderWait = true
                    }

                    // Get unique updaters
                    const updaters = [...new Set(
                        filteredCastings
                            .map(c => c.updatedBy)
                            .filter((u): u is string => !!u)
                    )]

                    // Sort by rank
                    filteredCastings.sort((a, b) => (a.rank || 0) - (b.rank || 0))

                    projects.push({
                        projectName,
                        castings: filteredCastings,
                        updaters
                    })
                }

                if (projects.length > 0) {
                    accounts.push({
                        accountName,
                        projects: projects.sort((a, b) => a.projectName.localeCompare(b.projectName))
                    })
                }
            }

            if (accounts.length > 0) {
                result.push({
                    date: dateKey,
                    accounts: accounts.sort((a, b) => a.accountName.localeCompare(b.accountName)),
                    hasOrderWait
                })
            }
        }

        return result
    }

    return {
        castings,
        loading,
        castingsByDate,
        sortedDates,
        fetchCastings,
        updateCastingStatus,
        updateCastingCost,
        deleteCasting,
        getCastingById,
        getHierarchicalCastings
    }
}

