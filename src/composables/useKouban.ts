import { ref } from 'vue'
import {
    collection, doc, getDoc, getDocs, query, orderBy, limit as fsLimit
} from 'firebase/firestore'
import { db } from '@/services/firebase'

/**
 * 香盤（撮影スケジュール表）の読み出し。
 *
 * 撮影の鍵は Notion の撮影ページID。これは castings.projectId と同じ値なので、
 * 香盤と キャスティングは この1本で繋がる。
 *
 * 香盤の本体は shoots/{shootId}.payload に JSON 1個で入っている。
 * 行に割っていないのは、CLI が出す PDF と画面を同じテンプレートで描くため。
 */

export interface KoubanRosterRow {
    id: string
    workId: string
    roleName: string
    roleShort: string
    castName: string
    callTime: string
    outTime: string
    makeup: 'studio' | 'self'
    scenes: string[]
    castyCastingId: string | null
    castId: string | null
    matchStatus: 'pending' | 'auto' | 'manual' | 'unmatched' | 'ambiguous'
}

export interface KoubanShoot {
    id: string
    shootId: string
    projectDocId: string
    date: string
    wday: string
    account: string
    team: string
    title: string
    status: '仮' | '決'
    studio: string
    addr: string
    upTime: string
    wrapTime: string
    notionUrl: string
    shareToken: string
    currentVersionId: string
    workIds: string[]
    payload: Record<string, unknown>
    updatedBy?: string
    updatedAt?: { toDate(): Date }
}

export interface KoubanVersion {
    id: string
    createdBy: string
    source: 'cli' | 'app'
    status: string
    note: string
    changes: { path: string; from: unknown; to: unknown }[]
    createdAt?: { toDate(): Date }
}

export function useKouban() {
    const shoots = ref<KoubanShoot[]>([])
    const shoot = ref<KoubanShoot | null>(null)
    const roster = ref<KoubanRosterRow[]>([])
    const versions = ref<KoubanVersion[]>([])
    const loading = ref(false)
    const error = ref<string | null>(null)

    /** 一覧。新しい撮影が上 */
    async function fetchAll() {
        if (!db) return
        loading.value = true
        error.value = null
        try {
            const snap = await getDocs(query(collection(db, 'shoots'), orderBy('date', 'desc')))
            shoots.value = snap.docs.map(d => ({ id: d.id, ...d.data() } as KoubanShoot))
        } catch (e) {
            console.error('[kouban] 一覧の取得に失敗', e)
            error.value = '香盤の一覧を読めませんでした'
        } finally {
            loading.value = false
        }
    }

    /** 1件。香盤の本体・配役・版をまとめて */
    async function fetchOne(shootId: string) {
        if (!db) return
        loading.value = true
        error.value = null
        shoot.value = null
        roster.value = []
        versions.value = []
        try {
            const ref = doc(db, 'shoots', shootId)
            const snap = await getDoc(ref)
            if (!snap.exists()) {
                error.value = 'この撮影の香盤はまだありません'
                return
            }
            shoot.value = { id: snap.id, ...snap.data() } as KoubanShoot

            const [r, v] = await Promise.all([
                getDocs(collection(ref, 'roster')),
                getDocs(query(collection(ref, 'versions'), orderBy('createdAt', 'desc'), fsLimit(20))),
            ])
            roster.value = r.docs
                .map(d => ({ id: d.id, ...d.data() } as KoubanRosterRow))
                .sort((a, b) => (a.callTime || '').localeCompare(b.callTime || ''))
            versions.value = v.docs.map(d => ({ id: d.id, ...d.data() } as KoubanVersion))
        } catch (e) {
            console.error('[kouban] 取得に失敗', e)
            error.value = '香盤を読めませんでした'
        } finally {
            loading.value = false
        }
    }

    return { shoots, shoot, roster, versions, loading, error, fetchAll, fetchOne }
}

/**
 * 香盤HTMLを組み立てる。CLI の tools/build_kouban.py と同じことをする。
 *
 * テンプレートは Hosting に1本だけ置く。CLI・アプリ・PDF が同じものを読むので、
 * どこで見ても同じ香盤になる。
 */
export async function renderKouban(payload: Record<string, unknown>): Promise<string> {
    const res = await fetch('/kouban-template.html')
    if (!res.ok) throw new Error('香盤のテンプレートが読めませんでした')
    const tpl = await res.text()
    const title = `${(payload as any)?.head?.title ?? ''} 香盤`.trim()
    // </script> が中に出ると script が途中で閉じるので割っておく（build_kouban.py と同じ）
    const blob = JSON.stringify(payload).replace(/<\//g, '<\\/')
    return tpl.replace('__SHOOT_JSON__', blob).replace('__TITLE__', title)
}
