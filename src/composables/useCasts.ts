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

        return onSnapshot(q, (snapshot) => {
            casts.value = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Cast))
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

        return onSnapshot(q, (snapshot) => {
            casts.value = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Cast))
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
