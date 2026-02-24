import { ref, computed, watch } from 'vue'
import {
    signInWithPopup,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    GoogleAuthProvider as GAuthProvider,
    type User
} from 'firebase/auth'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { auth, db, googleProvider, isFirebaseConfigured } from '@/services/firebase'

const user = ref<User | null>(null)
const loading = ref(true)
const isAdminChecked = ref(false)
const isAdminValue = ref(false)
const googleAccessToken = ref<string | null>(
    sessionStorage.getItem('googleAccessToken')
)

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

/**
 * トークンをsessionStorageに保存（ページリロード後も保持）
 */
function storeToken(token: string | null) {
    googleAccessToken.value = token
    if (token) {
        sessionStorage.setItem('googleAccessToken', token)
    } else {
        sessionStorage.removeItem('googleAccessToken')
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
            const result = await signInWithPopup(auth, googleProvider)
            const credential = GAuthProvider.credentialFromResult(result)
            storeToken(credential?.accessToken || null)
        } catch (error) {
            console.error('Sign in failed:', error)
            throw error
        }
    }

    /**
     * Google OAuth アクセストークンを取得
     * 毎回 signInWithPopup で新鮮なトークンを取得（1時間で期限切れのため）
     * カレンダーAPI等でOAuthトークンが必要な場合に使用
     */
    const getAccessToken = async (): Promise<string | null> => {
        if (!auth || !user.value) return null
        try {
            console.log('[AUTH] Getting fresh access token via popup...')
            const result = await signInWithPopup(auth, googleProvider)
            const credential = GAuthProvider.credentialFromResult(result)
            storeToken(credential?.accessToken || null)
            return googleAccessToken.value
        } catch (error) {
            console.error('Failed to get access token:', error)
            return null
        }
    }

    const signOut = async () => {
        if (!auth) return
        storeToken(null)
        await firebaseSignOut(auth)
    }

    const init = () => {
        if (!auth) {
            loading.value = false
            return
        }
        onAuthStateChanged(auth, async (newUser) => {
            user.value = newUser

            // ログアウト時はトークンクリア
            if (!newUser) {
                storeToken(null)
            }

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
        googleAccessToken,
        getAccessToken,
        signIn,
        signOut,
        init,
        isFirebaseConfigured
    }
}
