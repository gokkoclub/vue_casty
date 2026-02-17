import { ref } from 'vue'
import { db } from '@/services/firebase'
import { collection, getDocs, Timestamp } from 'firebase/firestore'
import type { Shooting } from '@/types'

export function useShootings() {
    const loading = ref(false)
    const shootings = ref<Shooting[]>([])

    /**
     * Fetch shootings within a date range
     * GASから文字列("2026-02-15")で保存されるため、全件取得してフィルタリング
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

            // 検索範囲の日付文字列を作成
            const formatDate = (d: Date) => {
                const y = d.getFullYear()
                const m = String(d.getMonth() + 1).padStart(2, '0')
                const day = String(d.getDate()).padStart(2, '0')
                return `${y}-${m}-${day}`
            }

            const startStr = formatDate(firstDate)
            const endStr = formatDate(lastDate)

            console.log('Fetching shootings between', startStr, 'and', endStr)

            // 全件取得してフィルタリング（shootDateが文字列のため）
            const snapshot = await getDocs(collection(db, 'shootings'))

            shootings.value = snapshot.docs
                .map(doc => {
                    const data = doc.data()
                    // shootDateの型に応じて処理
                    let shootDateStr = ''
                    let shootDateTs: Timestamp

                    if (data.shootDate instanceof Timestamp) {
                        const d = data.shootDate.toDate()
                        shootDateStr = formatDate(d)
                        shootDateTs = data.shootDate
                    } else if (typeof data.shootDate === 'string') {
                        shootDateStr = data.shootDate.substring(0, 10) // "2026-02-15" format
                        shootDateTs = Timestamp.fromDate(new Date(data.shootDate + 'T00:00:00'))
                    } else {
                        return null
                    }

                    // 日付範囲チェック
                    if (shootDateStr < startStr || shootDateStr > endStr) return null

                    return {
                        id: doc.id,
                        title: data.title || '',
                        shootDate: shootDateTs,
                        team: data.team || '',
                        director: data.cd || '',
                        floorDirector: data.fd || '',
                        notionUrl: data.notionUrl || '',
                        notionPageId: data.notionPageId || '',
                        cd: data.cd || '',
                        fd: data.fd || '',
                        producer: data.producer || '',
                        chiefProducer: data.chiefProducer || '',
                        six: data.six || '',
                        camera: data.camera || '',
                        costume: data.costume || '',
                        hairMakeup: data.hairMakeup || '',
                        allStaff: data.allStaff || []
                    } as Shooting
                })
                .filter((s): s is Shooting => s !== null)
                .sort((a, b) => a.shootDate.toMillis() - b.shootDate.toMillis())

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
