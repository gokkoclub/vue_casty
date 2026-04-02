import { ref } from 'vue'
import {
    collection, query, where, orderBy,
    onSnapshot, updateDoc, doc, setDoc,
    Timestamp, getDocs
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
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
        if (!db) {
            console.error('[addCast] Firestore DB not initialized')
            return undefined
        }
        const now = Timestamp.now()

        // Firestore の既存 cast_ IDから最大番号を取得
        const castsSnap = await getDocs(collection(db, 'casts'))
        let maxNum = 0
        castsSnap.forEach(d => {
            const id = d.id
            if (id.startsWith('cast_')) {
                const num = parseInt(id.replace('cast_', ''), 10)
                if (!isNaN(num) && num > maxNum) maxNum = num
            }
        })

        // 次の連番ID (5桁パディング)
        const nextNum = maxNum + 1
        const castId = `cast_${String(nextNum).padStart(5, '0')}`
        console.log(`[addCast] Generated ID: ${castId}, writing to Firestore...`)

        // Firestore に保存
        await setDoc(doc(db, 'casts', castId), {
            ...data,
            createdAt: now,
            updatedAt: now
        })
        console.log(`[addCast] Firestore write completed for ${castId}`)

        // 書き込み確認
        try {
            const { getDoc } = await import('firebase/firestore')
            const verifyDoc = await getDoc(doc(db, 'casts', castId))
            if (verifyDoc.exists()) {
                console.log(`[addCast] ✅ Verified: ${castId} exists in Firestore`)
            } else {
                console.error(`[addCast] ❌ Verification FAILED: ${castId} NOT found after write!`)
            }
        } catch (verifyErr) {
            console.warn('[addCast] Verification read failed:', verifyErr)
        }

        // Notion にも非同期で追加（失敗してもFirestore保存は維持）
        try {
            const functions = getFunctions(undefined, 'asia-northeast1')
            const createNotionCastFn = httpsCallable(functions, 'createNotionCast')
            await createNotionCastFn({
                castId,
                name: data.name,
                gender: data.gender || '',
                agency: data.agency || '',
                email: data.email || '',
            })
            console.log(`[addCast] Notion sync completed for ${castId}`)
        } catch (e) {
            console.warn('Notion sync failed (cast still saved to Firestore):', e)
        }

        return castId
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
