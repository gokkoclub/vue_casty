import { ref } from 'vue'
import { db } from '@/services/firebase'
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore'
import type { Casting } from '@/types'

export interface CastStatus {
    available: boolean
    label: string
    severity: 'success' | 'warning' | 'danger'
}

export function useAvailability() {
    const loading = ref(false)
    const activeCastings = ref<Casting[]>([])
    const selectedDates = ref<string[]>([]) // Store selected dates as YYYY-MM-DD strings

    const fetchAvailability = async (dates: Date[]) => {
        if (dates.length === 0) {
            activeCastings.value = []
            selectedDates.value = []
            return
        }

        loading.value = true
        try {
            if (!db) return

            // ローカルタイムゾーンで日付を YYYY-MM-DD にフォーマット
            const toLocalDateStr = (d: Date): string => {
                const y = d.getFullYear()
                const m = String(d.getMonth() + 1).padStart(2, '0')
                const day = String(d.getDate()).padStart(2, '0')
                return `${y}-${m}-${day}`
            }
            selectedDates.value = dates.map(d => toLocalDateStr(d))

            const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
            const startDate = new Date(sorted[0]!)
            startDate.setHours(0, 0, 0, 0)

            const endDate = new Date(sorted[sorted.length - 1]!)
            endDate.setHours(23, 59, 59, 999)

            // startDateが選択範囲内のキャスティングを取得
            const q1 = query(
                collection(db, 'castings'),
                where('startDate', '>=', Timestamp.fromDate(startDate)),
                where('startDate', '<=', Timestamp.fromDate(endDate))
            )

            // endDateが選択範囲内にあるキャスティングも取得（複数日跨ぎ対応）
            const q2 = query(
                collection(db, 'castings'),
                where('endDate', '>=', Timestamp.fromDate(startDate)),
                where('endDate', '<=', Timestamp.fromDate(endDate))
            )

            const [snapshot1, snapshot2] = await Promise.all([getDocs(q1), getDocs(q2)])

            // マージして重複排除
            const castingsMap = new Map<string, Casting>()
            for (const docSnap of snapshot1.docs) {
                castingsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() } as Casting)
            }
            for (const docSnap of snapshot2.docs) {
                if (!castingsMap.has(docSnap.id)) {
                    castingsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() } as Casting)
                }
            }
            activeCastings.value = Array.from(castingsMap.values())

            console.log(`Fetched ${activeCastings.value.length} active castings for availability check`)
            console.log('selectedDates:', JSON.stringify(selectedDates.value))
            console.log('query range (UTC):', startDate.toISOString(), '→', endDate.toISOString())
            activeCastings.value.forEach(c => {
                console.log(`  casting ${c.id}: castId=${c.castId} castName=${c.castName} status=${c.status} startDate=${c.startDate?.toDate()?.toISOString()} endDate=${c.endDate?.toDate()?.toISOString() || 'N/A'}`)
            })

        } catch (e) {
            console.error('Error fetching availability:', e)
        } finally {
            loading.value = false
        }
    }

    /**
     * Get cast status for selected dates
     * If multiple dates selected, show booking status if ANY date has a reservation
     */
    const getCastStatus = (castId: string): CastStatus => {
        if (selectedDates.value.length === 0) {
            return { available: true, label: '空き', severity: 'success' }
        }

        const toLocalDateStr = (d: Date): string => {
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            return `${y}-${m}-${day}`
        }

        // Check all selected dates
        let hasProvisional = false
        let hasConfirmed = false
        let hasTempCasting = false

        for (const dateStr of selectedDates.value) {
            const castingsForDate = activeCastings.value.filter(c => {
                const castStart = toLocalDateStr(c.startDate.toDate())
                const castEnd = c.endDate ? toLocalDateStr(c.endDate.toDate()) : castStart
                // 選択日がキャスティングの日付範囲内にあるか
                return c.castId === castId && dateStr >= castStart && dateStr <= castEnd
            })

            // Check statuses for this date
            for (const casting of castingsForDate) {
                if (casting.status === '決定') {
                    hasConfirmed = true
                } else if (casting.status === '仮押さえ') {
                    hasProvisional = true
                } else if (casting.status === '仮キャスティング' || casting.status === '打診中') {
                    hasTempCasting = true
                }
            }
        }

        // Prioritize: 決定 > 仮押さえ > 仮キャスティング > 空き
        if (hasConfirmed) {
            return { available: false, label: '決定済み', severity: 'danger' }
        }
        if (hasProvisional) {
            return { available: false, label: '仮押さえ中', severity: 'warning' }
        }
        if (hasTempCasting) {
            return { available: false, label: '仮キャスティング', severity: 'warning' }
        }

        return { available: true, label: '空き', severity: 'success' }
    }

    const isAvailable = (castId: string): boolean => {
        // Only blocked if NG exists
        if (selectedDates.value.length === 0) return true

        const toLocalDateStr = (d: Date): string => {
            const y = d.getFullYear()
            const m = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            return `${y}-${m}-${day}`
        }

        const hasNG = activeCastings.value.some(c => {
            if (c.castId !== castId || c.status !== 'NG') return false

            const castStart = toLocalDateStr(c.startDate.toDate())
            const castEnd = c.endDate ? toLocalDateStr(c.endDate.toDate()) : castStart
            return selectedDates.value.some(d => d >= castStart && d <= castEnd)
        })

        return !hasNG
    }



    return {
        loading,
        activeCastings,
        fetchAvailability,
        getCastStatus,
        isAvailable
    }
}
