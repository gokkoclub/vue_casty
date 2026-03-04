import { ref } from 'vue'
import {
    collection, query, where, orderBy,
    onSnapshot, addDoc, updateDoc, doc,
    Timestamp, getDocs
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from '@/services/firebase'
import type { Cast } from '@/types'

export function useCasts() {
    const casts = ref<Cast[]>([])
    const loading = ref(false)

    /**
     * castings コレクションから出演回数を計算
     * カウント条件: status が OK or 決定、作品(projectName)単位でユニークカウント
     */
    const computeAppearanceCounts = async (): Promise<Map<string, number>> => {
        if (!db) return new Map()
        try {
            const castingsSnap = await getDocs(
                query(
                    collection(db, 'castings'),
                    where('status', 'in', ['OK', '決定'])
                )
            )
            // castId → Set<projectName> で作品単位カウント
            const projectMap = new Map<string, Set<string>>()
            castingsSnap.forEach(d => {
                const data = d.data()
                const castId = data.castId as string
                const projectName = data.projectName as string
                if (!castId) return
                if (!projectMap.has(castId)) projectMap.set(castId, new Set())
                if (projectName) projectMap.get(castId)!.add(projectName)
            })
            // Set.size → number
            const countMap = new Map<string, number>()
            projectMap.forEach((projects, castId) => {
                countMap.set(castId, projects.size)
            })
            return countMap
        } catch (e) {
            console.error('Error computing appearance counts:', e)
            return new Map()
        }
    }

    /**
     * castsデータに出演回数をマージ
     */
    const applyCounts = (countMap: Map<string, number>) => {
        if (countMap.size === 0) return
        casts.value = casts.value.map(c => ({
            ...c,
            appearanceCount: countMap.get(c.id) || c.appearanceCount || 0
        }))
    }

    const fetchAll = () => {
        if (!db) {
            console.warn('Firestore is not configured')
            return () => { }
        }
        loading.value = true
        const q = query(
            collection(db, 'casts'),
            orderBy('name', 'asc')
        )

        return onSnapshot(q, async (snapshot) => {
            casts.value = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Cast))

            // 出演回数を castings から計算してマージ
            const countMap = await computeAppearanceCounts()
            applyCounts(countMap)

            loading.value = false
        })
    }

    const fetchByType = (castType: '内部' | '外部') => {
        if (!db) return () => { }
        loading.value = true
        const q = query(
            collection(db, 'casts'),
            where('castType', '==', castType),
            orderBy('name', 'asc')
        )

        return onSnapshot(q, async (snapshot) => {
            casts.value = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Cast))

            // 出演回数を castings から計算してマージ
            const countMap = await computeAppearanceCounts()
            applyCounts(countMap)

            loading.value = false
        })
    }

    const addCast = async (data: Omit<Cast, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | undefined> => {
        if (!db) return undefined
        const now = Timestamp.now()
        const docRef = await addDoc(collection(db, 'casts'), {
            ...data,
            createdAt: now,
            updatedAt: now
        })
        return docRef.id
    }

    const updateCast = async (id: string, data: Partial<Cast>) => {
        if (!db) return
        await updateDoc(doc(db, 'casts', id), {
            ...data,
            updatedAt: Timestamp.now()
        })
    }

    const getCastById = async (id: string): Promise<Cast | null> => {
        if (!db) return null
        const q = query(
            collection(db, 'casts'),
            where('__name__', '==', id)
        )
        const snapshot = await getDocs(q)
        if (snapshot.empty) return null
        const docSnap = snapshot.docs[0]
        if (!docSnap) return null
        return { id: docSnap.id, ...docSnap.data() } as Cast
    }

    return { casts, loading, fetchAll, fetchByType, addCast, updateCast, getCastById, isFirebaseConfigured }
}
