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

            // Store selected dates as YYYY-MM-DD strings for easy comparison
            selectedDates.value = dates.map(d => d.toISOString().split('T')[0]).filter((s): s is string => !!s)

            const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
            const startDate = new Date(sorted[0]!)
            startDate.setHours(0, 0, 0, 0)

            const endDate = new Date(sorted[sorted.length - 1]!)
            endDate.setHours(23, 59, 59, 999)

            const q = query(
                collection(db, 'castings'),
                where('startDate', '>=', Timestamp.fromDate(startDate)),
                where('startDate', '<=', Timestamp.fromDate(endDate))
            )

            const snapshot = await getDocs(q)
            activeCastings.value = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Casting))

            console.log(`Fetched ${activeCastings.value.length} active castings for availability check`)

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

        // Check all selected dates
        let hasProvisional = false
        let hasConfirmed = false

        for (const dateStr of selectedDates.value) {
            const castingsForDate = activeCastings.value.filter(c => {
                const castingDate = c.startDate.toDate().toISOString().split('T')[0]
                return c.castId === castId && castingDate === dateStr
            })

            // Check statuses for this date
            for (const casting of castingsForDate) {
                if (casting.status === '決定') {
                    hasConfirmed = true
                } else if (casting.status === '仮押さえ') {
                    hasProvisional = true
                }
            }
        }

        // Prioritize: 決定 > 仮押さえ > 空き
        if (hasConfirmed) {
            return { available: false, label: '決定済み', severity: 'danger' }
        }
        if (hasProvisional) {
            return { available: false, label: '仮押さえ中', severity: 'warning' }
        }

        return { available: true, label: '空き', severity: 'success' }
    }

    const isAvailable = (castId: string): boolean => {
        // Only blocked if NG exists
        if (selectedDates.value.length === 0) return true

        const hasNG = activeCastings.value.some(c => {
            if (c.castId !== castId || c.status !== 'NG') return false

            const castingDate = c.startDate.toDate().toISOString().split('T')[0] ?? ''
            return castingDate !== '' && selectedDates.value.includes(castingDate)
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
