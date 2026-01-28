import { ref } from 'vue'
import { db } from '@/services/firebase'
import { collection, query, where, getDocs, Timestamp, orderBy } from 'firebase/firestore'
import type { Shooting } from '@/types'

export function useShootings() {
    const loading = ref(false)
    const shootings = ref<Shooting[]>([])

    /**
     * Fetch shootings within a date range
     * @param dates Array of dates selected in the calendar
     */
    const fetchShootingsByDates = async (dates: Date[]) => {
        loading.value = true
        shootings.value = []

        if (dates.length === 0) {
            loading.value = false
            return
        }

        try {
            if (!db) {
                console.warn('Firestore is not initialized')
                return
            }

            // Sort dates to find range
            const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime())
            const firstDate = sortedDates[0]
            const lastDate = sortedDates[sortedDates.length - 1]

            if (!firstDate || !lastDate) return

            // Create range covering the entire start day to end day in local time
            // Note: Firestore Timestamps are UTC.
            // Using setHours on a local Date object and converting to Timestamp relies on client timezone.

            const startDate = new Date(firstDate)
            startDate.setHours(0, 0, 0, 0)

            const endDate = new Date(lastDate)
            endDate.setHours(23, 59, 59, 999)

            console.log('Fetching shootings between', startDate.toLocaleString(), 'and', endDate.toLocaleString())

            // Query Firestore
            // Note: If dummy data was created with a specific timezone that differs greatly, it might be missed at the edges.
            // But for "Today", it should be fine.
            const q = query(
                collection(db, 'shootings'),
                where('shootDate', '>=', Timestamp.fromDate(startDate)),
                where('shootDate', '<=', Timestamp.fromDate(endDate)),
                orderBy('shootDate', 'asc')
            )

            const snapshot = await getDocs(q)
            shootings.value = snapshot.docs.map(doc => {
                const data = doc.data()
                return {
                    id: doc.id,
                    title: data.title,
                    shootDate: data.shootDate instanceof Timestamp ? data.shootDate : Timestamp.fromDate(new Date()), // fallback
                    team: data.team,
                    director: data.director,
                    floorDirector: data.floorDirector,
                    notionUrl: data.notionUrl || ''
                } as Shooting
            })

            console.log(`Found ${shootings.value.length} shootings`)

        } catch (e) {
            console.error('Error fetching shootings:', e)
        } finally {
            loading.value = false
        }
    }

    return {
        loading,
        shootings,
        fetchShootingsByDates
    }
}
