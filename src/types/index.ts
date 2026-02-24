import { Timestamp } from 'firebase/firestore'

export interface Cast {
    id: string
    name: string
    furigana?: string  // ふりがな for 50音順 sorting
    gender: '男性' | '女性' | ''
    dateOfBirth?: Timestamp
    agency: string
    imageUrl: string
    email: string
    notes: string
    castType: '内部' | '外部'
    slackMentionId: string
    appearanceCount: number
    snsX?: string
    snsInstagram?: string
    snsTikTok?: string
    createdAt: Timestamp
    updatedAt: Timestamp
}

export interface Casting {
    id: string
    castId: string
    castName: string
    castType: '内部' | '外部'
    accountName: string
    projectName: string
    projectId: string
    roleName: string
    startDate: Timestamp
    endDate: Timestamp
    startTime?: string // Format: "HH:mm" (e.g., "10:00")
    endTime?: string   // Format: "HH:mm" (e.g., "18:00")
    rank: number
    status: CastingStatus
    note: string
    mainSub: 'メイン' | 'サブ' | 'その他'
    cost: number
    slackThreadTs: string
    slackPermalink: string
    calendarEventId: string
    dbSentStatus: '済' | ''
    mode?: 'shooting' | 'external' | 'internal'
    shootingDates?: string[]  // 中長編用: キャスト参加日 ['2026-02-14', '2026-02-15']
    createdBy: string
    updatedBy: string
    createdAt: Timestamp
    updatedAt: Timestamp
}

export type CastingStatus =
    | '仮押さえ' | '仮キャスティング' | '打診中'
    | 'オーダー待ち' | 'オーダー待ち（仮キャスティング）'
    | 'OK' | '決定' | '条件つきOK' | 'NG' | 'キャンセル'

export interface ShootingContact {
    id: string
    castingId: string
    castName: string
    castType: '内部' | '外部'
    projectName: string
    accountName: string
    roleName: string
    notionId?: string
    shootDate: Timestamp
    inTime?: string
    outTime?: string
    location?: string
    address?: string
    fee?: number
    cost?: string
    makingUrl?: string
    postDate?: Timestamp
    mainSub: 'メイン' | 'サブ' | 'その他'
    status: ShootingContactStatus
    email?: string
    orderDocumentId?: string
    poUuid?: string
    slackThreadTs?: string
    createdAt: Timestamp
    updatedAt: Timestamp
}

export type ShootingContactStatus =
    | '香盤連絡待ち'
    | '発注書送信待ち'
    | 'メイキング共有待ち'
    | '投稿日連絡待ち'
    | '完了'


// Old CartItem kept for compatibility during transition if needed, or repurposed
export interface CartItem {
    tempId: string // Frontend unique ID for DnD
    castId: string
    cast: Cast
    roleName: string
    rank: number // 1-based rank
    note: string
    mainSub: 'メイン' | 'サブ' | 'その他'
    projectName?: string // Snapshot of project name at order time
}

// New Structures
export interface CartCast {
    id: string
    cast: Cast
}

export interface CartRole {
    id: string
    name: string
    type: 'メイン' | 'サブ' | 'その他'
    note: string
    castIds: string[]
}

export interface CartProject {
    id: string
    title: string
    roles: CartRole[]
}

export interface CartMeta {
    accountName: string
    projectName: string
    notionUrl: string
    dateRanges: string[]
}

export interface Shooting {
    id: string
    title: string
    shootDate: Timestamp
    team: string
    director: string
    floorDirector: string
    notionUrl: string
    notionPageId?: string
    // 追加スタッフ
    cd?: string
    fd?: string
    producer?: string
    chiefProducer?: string
    six?: string
    camera?: string
    costume?: string
    hairMakeup?: string
    allStaff?: string[]  // 全スタッフ名一覧（稼働判定用）
}

export interface OrderContext {
    mode: 'shooting' | 'external' | 'internal' | null
    shootingData?: Shooting | null
    dateRanges: string[]
}

/**
 * キャスティングマスターDB
 * ステータスが「決定」になったキャスティングの履歴を保存
 * 内部・外部両方のキャストが対象
 */
export interface CastMaster {
    id: string
    castingId: string       // 元のcastingsドキュメントへの参照
    castId: string
    castName: string
    castType: '内部' | '外部'
    accountName: string
    projectName: string
    roleName: string
    mainSub: 'メイン' | 'サブ' | 'その他'
    shootDate: Timestamp
    endDate?: Timestamp
    cost: number
    decidedAt: Timestamp    // 決定日時
    decidedBy: string       // 決定したユーザー
    createdAt: Timestamp
}
