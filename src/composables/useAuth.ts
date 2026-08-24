import { ref, computed } from 'vue'
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
const isActorValue = ref(false)

// スーパー管理者（NG / キャンセルからの巻き戻し等、通常 admin でも不可な操作を許可）
const SUPER_ADMIN_EMAILS = ['kunihito.miura@gokkoclub.jp']
const googleAccessToken = ref<string | null>(
    sessionStorage.getItem('googleAccessToken')
)

/**
 * ロールをFirestoreでチェック（admin コレクション）
 * - role フィールドなし or 'admin' → 管理者
 * - role: 'actor' → アクター（外部案件の作品名・時間変更のみ可能な制限ロール）
 * 複合インデックス不要のため、emailのみでクエリしactiveはクライアント側でチェック
 */
async function checkUserRole(email: string): Promise<{ isAdmin: boolean; isActor: boolean }> {
    if (!db) {
        console.warn('[Auth] Firestore not initialized, cannot check admin status')
        return { isAdmin: false, isActor: false }
    }

    const normalizedEmail = email.toLowerCase().trim()

    try {
        const adminQuery = query(
            collection(db, 'admin'),
            where('email', '==', normalizedEmail)
        )
        const snapshot = await getDocs(adminQuery)
        if (snapshot.empty) return { isAdmin: false, isActor: false }
        // activeフラグ・roleはクライアント側でチェック
        const activeDocs = snapshot.docs.filter(doc => doc.data().active === true)
        const isAdmin = activeDocs.some(doc => !doc.data().role || doc.data().role === 'admin')
        const isActor = !isAdmin && activeDocs.some(doc => doc.data().role === 'actor')
        return { isAdmin, isActor }
    } catch (error) {
        console.error('[Auth] Admin check failed:', error)
        return { isAdmin: false, isActor: false }
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

    // アクター判定（外部案件の作品名・時間変更のみ可能な制限ロール）
    const isActor = computed(() => isActorValue.value)

    // スーパー管理者判定（email が SUPER_ADMIN_EMAILS に含まれる場合のみ true）
    // NG / キャンセルからの復帰など、通常 admin でも不可な操作を許可する
    const isSuperAdmin = computed(() => {
        const email = user.value?.email?.toLowerCase().trim()
        if (!email) return false
        return SUPER_ADMIN_EMAILS.includes(email)
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

            if (!newUser) {
                // ログアウト時はリセット
                storeToken(null)
                isAdminValue.value = false
                isActorValue.value = false
                isAdminChecked.value = false
                loading.value = false
                return
            }

            // ロールチェック（管理者 / アクター）
            if (newUser.email) {
                isAdminChecked.value = false
                const role = await checkUserRole(newUser.email)
                isAdminValue.value = role.isAdmin
                isActorValue.value = role.isActor
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
        isActor,
        isSuperAdmin,
        isAdminChecked,
        googleAccessToken,
        getAccessToken,
        signIn,
        signOut,
        init,
        isFirebaseConfigured
    }
}
