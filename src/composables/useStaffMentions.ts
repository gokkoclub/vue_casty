import { ref } from 'vue'
import {
    collection, query, getDocs,
    setDoc, updateDoc, deleteDoc, doc,
    Timestamp
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import { useToast } from 'primevue/usetoast'

/**
 * staffMentions コレクション管理 composable
 *
 * キャスト（casts）でも ログインユーザー（admin）でもないスタッフの
 * Slack メンション ID を登録するための専用DB。
 *   - 監督 / FD / プロデューサー / 衣装 / メイク / 制作 など
 *   - オーダー送信時の cc 欄構築で CF 側 lookupSlackIdByName から参照される
 *   - aliases[] に表記ゆれ（スラッシュ区切り／英字名／愛称など）を複数登録できる
 */
export interface StaffMention {
    id: string                  // = slackMentionId（冪等 upsert のため）
    name: string                // 本名 / 代表表記
    slackMentionId: string      // Slack ユーザーID（"U02E6HGK4BH"）
    email?: string
    aliases: string[]           // 別名配列（fullname/displayname 等）
    role?: string               // 任意ラベル（CD/FD/P/衣装/メイク 等）
    active: boolean             // soft delete フラグ
    note?: string
    source?: string             // "csv-import" | "manual"
    createdAt: Timestamp
    updatedAt: Timestamp
}

export interface StaffMentionInput {
    name: string
    slackMentionId: string
    email?: string
    aliases?: string[]
    role?: string
    note?: string
    active?: boolean
}

export function useStaffMentions() {
    const mentions = ref<StaffMention[]>([])
    const loading = ref(false)
    const toast = useToast()

    async function fetchAll() {
        if (!db) return
        loading.value = true
        try {
            const q = query(collection(db, 'staffMentions'))
            const snap = await getDocs(q)
            mentions.value = snap.docs
                .map(d => ({ id: d.id, ...d.data() } as StaffMention))
                .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'))
        } catch (e) {
            console.error('Error fetching staffMentions:', e)
            toast.add({ severity: 'error', summary: 'エラー', detail: 'スタッフメンション一覧の取得に失敗しました', life: 3000 })
        } finally {
            loading.value = false
        }
    }

    /**
     * 追加 / 上書き（slackMentionId をドキュメントIDにするので冪等）
     */
    async function upsert(input: StaffMentionInput): Promise<boolean> {
        if (!db) return false
        const slackId = input.slackMentionId.trim()
        const name = input.name.trim()
        if (!slackId || !name) {
            toast.add({ severity: 'warn', summary: '入力不足', detail: '本名とSlackユーザーIDは必須です', life: 3000 })
            return false
        }
        try {
            const now = Timestamp.now()
            const aliases = (input.aliases || [])
                .map(a => a.trim())
                .filter(a => a.length > 0)
            // 本名を必ず aliases に含める（検索時のフォールバック用）
            if (!aliases.includes(name)) aliases.unshift(name)

            const ref = doc(db, 'staffMentions', slackId)
            await setDoc(ref, {
                name,
                slackMentionId: slackId,
                email: (input.email || '').toLowerCase().trim(),
                aliases,
                role: input.role || '',
                active: input.active !== false,
                note: input.note || '',
                source: 'manual',
                createdAt: now,   // 新規時のみ実質有効（merge: true で既存は保持される）
                updatedAt: now,
            }, { merge: true })

            toast.add({ severity: 'success', summary: '保存', detail: `${name} を保存しました`, life: 2000 })
            await fetchAll()
            return true
        } catch (e) {
            console.error('Error upserting staffMention:', e)
            toast.add({ severity: 'error', summary: 'エラー', detail: '保存に失敗しました', life: 3000 })
            return false
        }
    }

    async function setActive(id: string, active: boolean): Promise<boolean> {
        if (!db) return false
        try {
            await updateDoc(doc(db, 'staffMentions', id), {
                active,
                updatedAt: Timestamp.now(),
            })
            const item = mentions.value.find(m => m.id === id)
            if (item) item.active = active
            toast.add({ severity: 'success', summary: active ? '有効化' : '無効化', detail: 'スタッフメンションを更新しました', life: 2000 })
            return true
        } catch (e) {
            console.error('Error toggling active:', e)
            toast.add({ severity: 'error', summary: 'エラー', detail: '更新に失敗しました', life: 3000 })
            return false
        }
    }

    async function remove(id: string): Promise<boolean> {
        if (!db) return false
        try {
            await deleteDoc(doc(db, 'staffMentions', id))
            mentions.value = mentions.value.filter(m => m.id !== id)
            toast.add({ severity: 'success', summary: '削除', detail: 'スタッフメンションを削除しました', life: 2000 })
            return true
        } catch (e) {
            console.error('Error deleting staffMention:', e)
            toast.add({ severity: 'error', summary: 'エラー', detail: '削除に失敗しました', life: 3000 })
            return false
        }
    }

    return {
        mentions,
        loading,
        fetchAll,
        upsert,
        setActive,
        remove,
    }
}
