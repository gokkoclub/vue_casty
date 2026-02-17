import { ref, computed } from 'vue'
import { collection, query, orderBy, getDocs, doc, updateDoc, Timestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/services/firebase'
import type { Casting, CastingStatus } from '@/types'
import { useToast } from 'primevue/usetoast'
import { useAuth } from '@/composables/useAuth'
import { useSlack } from '@/composables/useSlack'
import { useShootingContact } from '@/composables/useShootingContact'
import { useCastMaster } from '@/composables/useCastMaster'
import { useGoogleCalendar } from '@/composables/useGoogleCalendar'

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
    const { addToCastMaster } = useCastMaster()
    const { handleStatusChange: handleCalendarStatusChange } = useGoogleCalendar()

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

            // 4. Handle calendar events for internal casts
            // 内部キャストのカレンダーイベント更新
            if (casting.castType === '内部' && casting.calendarEventId) {
                handleCalendarStatusChange(
                    casting.calendarEventId,
                    casting.castName,
                    casting.projectName,
                    newStatus
                ).catch(err => {
                    console.warn('Calendar event update failed:', err)
                })
            }

            // 5. Handle 決定 status - add to castMaster and shootingContacts
            if (newStatus === '決定') {
                // 5a. キャスティングマスターDBに追加（内部・外部両方）
                addToCastMaster(casting).catch(err => {
                    console.warn('Failed to add to castMaster:', err)
                })

                // 5b. 外部キャストのみ撮影連絡DBに自動追加
                if (casting.castType === '外部') {
                    addFromCasting(casting).catch(err => {
                        console.warn('Failed to add to shooting contact DB:', err)
                    })
                }
            }

            // 6. Notion sync — notifyStatusUpdate CF内で自動実行されるため不要

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
     * Update casting time (delegates to updateCastingDetails for CF integration)
     * カレンダー更新 + Slack通知も同時実行
     */
    async function updateCastingTime(castingId: string, startTime: string, endTime: string): Promise<boolean> {
        return updateCastingDetails(castingId, { startTime, endTime })
    }

    /**
     * Update casting details (date/time) and notify via Cloud Function
     * 特別オーダー（外部案件/社内イベント）の日程・時間変更用
     */
    async function updateCastingDetails(
        castingId: string,
        changes: {
            startDate?: string
            endDate?: string
            startTime?: string
            endTime?: string
        }
    ): Promise<boolean> {
        if (!db) return false

        const casting = castings.value.find(c => c.id === castingId)
        if (!casting) return false

        try {
            // Cloud Functionに委譲（Firestore更新 + Slack通知 + Calendar更新）
            if (functions) {
                const notifyUpdate = httpsCallable(functions, 'notifyOrderUpdated')
                await notifyUpdate({ castingId, changes })
            } else {
                // Cloud Functions未設定時: Firestoreのみ更新
                const castingRef = doc(db, 'castings', castingId)
                const updateData: Record<string, unknown> = {
                    updatedAt: Timestamp.now(),
                    updatedBy: userEmail.value || 'unknown'
                }
                if (changes.startDate) updateData.startDate = Timestamp.fromDate(new Date(changes.startDate))
                if (changes.endDate) updateData.endDate = Timestamp.fromDate(new Date(changes.endDate))
                if (changes.startTime) updateData.startTime = changes.startTime
                if (changes.endTime) updateData.endTime = changes.endTime
                await updateDoc(castingRef, updateData)
            }

            // ローカルステート更新
            if (changes.startDate) casting.startDate = Timestamp.fromDate(new Date(changes.startDate))
            if (changes.endDate) casting.endDate = Timestamp.fromDate(new Date(changes.endDate))
            if (changes.startTime) casting.startTime = changes.startTime
            if (changes.endTime) casting.endTime = changes.endTime
            casting.updatedAt = Timestamp.now()

            toast.add({
                severity: 'success',
                summary: '保存完了',
                detail: 'オーダー内容を更新しました',
                life: 2000
            })

            return true
        } catch (error) {
            console.error('Error updating casting details:', error)
            toast.add({
                severity: 'error',
                summary: 'エラー',
                detail: 'オーダー内容の更新に失敗しました',
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

    // Tab type
    type TabType = 'all' | 'shooting' | 'event' | 'feature'

    // Helpers for tab classification
    const isMultiDay = (c: Casting): boolean => {
        if (!c.startDate || !c.endDate) return false
        return c.startDate.toDate().toDateString() !== c.endDate.toDate().toDateString()
    }

    const isSpecialAccount = (c: Casting): boolean => {
        // modeフィールドがあればそれを優先、なければaccountNameで判定
        if (c.mode === 'external' || c.mode === 'internal') return true
        return SPECIAL_ACCOUNTS.includes(c.accountName)
    }

    // チーム名（accountName）に「長編」や「POPCORN」が含まれていれば中長編扱い
    const isFeatureProject = (c: Casting): boolean => {
        const name = (c.accountName || '').toUpperCase()
        return name.includes('長編') || name.includes('POPCORN')
    }

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

    // Project-based grouping for 作品ビュー / 中長編
    interface FeatureCastingGroup {
        projectName: string
        accountName: string
        dateRange: string // e.g., '2/14〜2/18'
        startDate: string
        endDate: string
        allDates: string[] // 全撮影日リスト
        castings: Casting[]
    }

    // Project-based grouping for 作品ビュー (single-day castings)
    interface ProjectViewGroup {
        projectName: string
        accountName: string
        dates: string[] // all dates this project appears on
        castingsByDate: Map<string, Casting[]> // date -> castings
        totalCastings: number
        hasOrderWait: boolean
    }

    /**
     * Check if a casting matches the given tab
     */
    function matchesTab(casting: Casting, tab: TabType): boolean {
        switch (tab) {
            case 'all':
                return true
            case 'shooting':
                return !isSpecialAccount(casting) && !isMultiDay(casting) && !isFeatureProject(casting)
            case 'event':
                return isSpecialAccount(casting)
            case 'feature':
                return !isSpecialAccount(casting) && (isMultiDay(casting) || isFeatureProject(casting))
            default:
                return true
        }
    }

    /**
     * Get castings grouped by hierarchy with filters
     */
    function getHierarchicalCastings(options: {
        month: Date
        tab: TabType
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

            // Tab filtering
            if (!matchesTab(casting, tab)) return

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

    /**
     * Get castings grouped by project for 中長編タブ and 作品ビュー
     */
    function getFeatureGroupedCastings(options: {
        month: Date
        showPast: boolean
        orderWaitOnly: boolean
    }): FeatureCastingGroup[] {
        const { month, showPast, orderWaitOnly } = options
        const ORDER_WAIT_STATUSES = ['オーダー待ち', 'オーダー待ち（仮キャスティング）']

        const monthStart = new Date(month.getFullYear(), month.getMonth(), 1)
        const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0)
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        // Group by project
        const projectMap = new Map<string, {
            accountName: string
            castings: Casting[]
            minStart: Date
            maxEnd: Date
        }>()

        castings.value.forEach(casting => {
            if (!casting.startDate || !casting.endDate) return
            if (!isMultiDay(casting)) return
            if (isSpecialAccount(casting)) return

            const startDate = casting.startDate.toDate()
            const endDate = casting.endDate.toDate()

            // Check month overlap
            if (endDate < monthStart || startDate > monthEnd) return

            // Check past filter
            if (!showPast && endDate < today) return

            const key = `${casting.accountName}__${casting.projectName}`
            if (!projectMap.has(key)) {
                projectMap.set(key, {
                    accountName: casting.accountName,
                    castings: [],
                    minStart: startDate,
                    maxEnd: endDate
                })
            }

            const group = projectMap.get(key)!
            group.castings.push(casting)
            if (startDate < group.minStart) group.minStart = startDate
            if (endDate > group.maxEnd) group.maxEnd = endDate
        })

        const result: FeatureCastingGroup[] = []

        for (const [key, group] of projectMap) {
            let filteredCastings = group.castings
            if (orderWaitOnly) {
                filteredCastings = group.castings.filter(c =>
                    ORDER_WAIT_STATUSES.includes(c.status)
                )
            }
            if (filteredCastings.length === 0) continue

            // Generate all dates in range
            const allDates: string[] = []
            const d = new Date(group.minStart)
            while (d <= group.maxEnd) {
                allDates.push(d.toISOString().split('T')[0]!)
                d.setDate(d.getDate() + 1)
            }

            // Format date range
            const formatShort = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}`
            const dateRange = `${formatShort(group.minStart)}〜${formatShort(group.maxEnd)}`

            const projectName = key.split('__')[1] || ''

            // Sort by rank then cast name
            filteredCastings.sort((a, b) => (a.rank || 0) - (b.rank || 0) || a.castName.localeCompare(b.castName))

            result.push({
                projectName,
                accountName: group.accountName,
                dateRange,
                startDate: group.minStart.toISOString().split('T')[0]!,
                endDate: group.maxEnd.toISOString().split('T')[0]!,
                allDates,
                castings: filteredCastings
            })
        }

        // Sort by start date
        result.sort((a, b) => a.startDate.localeCompare(b.startDate))

        return result
    }

    /**
     * Get castings grouped by project for 作品ビュー (non-feature, single-day castings)
     */
    function getProjectGroupedCastings(options: {
        month: Date
        tab: TabType
        showPast: boolean
        orderWaitOnly: boolean
    }): ProjectViewGroup[] {
        const { month, tab, showPast, orderWaitOnly } = options
        const ORDER_WAIT_STATUSES = ['オーダー待ち', 'オーダー待ち（仮キャスティング）']

        const monthStart = new Date(month.getFullYear(), month.getMonth(), 1)
        const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0)
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        // Group by account__project key
        const projectMap = new Map<string, {
            accountName: string
            castingsByDate: Map<string, Casting[]>
        }>()

        castings.value.forEach(casting => {
            if (!casting.startDate || !casting.endDate) return
            if (!matchesTab(casting, tab)) return

            const startDate = casting.startDate.toDate()
            startDate.setHours(0, 0, 0, 0)

            // Month check
            if (startDate < monthStart || startDate > monthEnd) return

            // Past filter
            if (!showPast && startDate < today) return

            const dateKey = startDate.toISOString().split('T')[0]!
            const projectKey = `${casting.accountName}__${casting.projectName}`

            if (!projectMap.has(projectKey)) {
                projectMap.set(projectKey, {
                    accountName: casting.accountName,
                    castingsByDate: new Map()
                })
            }

            const group = projectMap.get(projectKey)!
            if (!group.castingsByDate.has(dateKey)) {
                group.castingsByDate.set(dateKey, [])
            }
            group.castingsByDate.get(dateKey)!.push(casting)
        })

        const result: ProjectViewGroup[] = []

        for (const [key, group] of projectMap) {
            const projectName = key.split('__')[1] || ''
            let totalCastings = 0
            let hasOrderWait = false

            // Apply orderWaitOnly filter per date
            const filteredByDate = new Map<string, Casting[]>()
            for (const [dateKey, dateCastings] of group.castingsByDate) {
                let fc = dateCastings
                if (orderWaitOnly) {
                    fc = dateCastings.filter(c => ORDER_WAIT_STATUSES.includes(c.status))
                }
                if (fc.length === 0) continue
                if (fc.some(c => ORDER_WAIT_STATUSES.includes(c.status))) {
                    hasOrderWait = true
                }
                fc.sort((a, b) => (a.rank || 0) - (b.rank || 0))
                filteredByDate.set(dateKey, fc)
                totalCastings += fc.length
            }

            if (filteredByDate.size === 0) continue

            const dates = Array.from(filteredByDate.keys()).sort()

            result.push({
                projectName,
                accountName: group.accountName,
                dates,
                castingsByDate: filteredByDate,
                totalCastings,
                hasOrderWait
            })
        }

        // Sort by earliest date, then project name
        result.sort((a, b) => {
            const dateA = a.dates[0] || ''
            const dateB = b.dates[0] || ''
            return dateA.localeCompare(dateB) || a.projectName.localeCompare(b.projectName)
        })

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
        updateCastingTime,
        updateCastingDetails,
        deleteCasting,
        getCastingById,
        getHierarchicalCastings,
        getFeatureGroupedCastings,
        getProjectGroupedCastings
    }
}

