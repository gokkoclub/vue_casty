import { ref, computed, watch } from 'vue'
import {
    signInWithPopup,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    type User
} from 'firebase/auth'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { auth, db, googleProvider, isFirebaseConfigured } from '@/services/firebase'

const user = ref<User | null>(null)
const loading = ref(true)
const isAdminChecked = ref(false)
const isAdminValue = ref(false)

/**
 * 管理者かどうかをFirestoreでチェック
 */
async function checkIsAdmin(email: string): Promise<boolean> {
    if (!db) return false

    try {
        const adminQuery = query(
            collection(db, 'admins'),
            where('email', '==', email),
            where('active', '==', true)
        )
        const snapshot = await getDocs(adminQuery)
        return !snapshot.empty
    } catch (error) {
        console.error('Admin check failed:', error)
        return false
    }
}

export function useAuth() {
    const isAuthenticated = computed(() => !!user.value)
    const userEmail = computed(() => user.value?.email ?? '')
    const userName = computed(() => user.value?.displayName ?? '')
    const userPhotoURL = computed(() => user.value?.photoURL ?? '')

    // 管理者判定（Firestoreから取得）
    const isAdmin = computed(() => isAdminValue.value)

    // ユーザーが変わったら管理者チェック
    watch(user, async (newUser) => {
        if (newUser?.email) {
            isAdminChecked.value = false
            isAdminValue.value = await checkIsAdmin(newUser.email)
            isAdminChecked.value = true
        } else {
            isAdminValue.value = false
            isAdminChecked.value = false
        }
    })

    const signIn = async () => {
        if (!auth) {
            console.warn('Firebase Auth is not configured')
            return
        }
        try {
            await signInWithPopup(auth, googleProvider)
        } catch (error) {
            console.error('Sign in failed:', error)
            throw error
        }
    }

    const signOut = async () => {
        if (!auth) return
        await firebaseSignOut(auth)
    }

    const init = () => {
        if (!auth) {
            loading.value = false
            return
        }
        onAuthStateChanged(auth, async (newUser) => {
            user.value = newUser

            // 管理者チェック
            if (newUser?.email) {
                isAdminValue.value = await checkIsAdmin(newUser.email)
                isAdminChecked.value = true
            }

            loading.value = false
        })
    }

    return {
        user,
        loading,
        isAuthenticated,
        userEmail,
        userName,
        userPhotoURL,
        isAdmin,
        isAdminChecked,
        signIn,
        signOut,
        init,
        isFirebaseConfigured
    }
}
