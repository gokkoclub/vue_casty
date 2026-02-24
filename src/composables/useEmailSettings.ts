import { ref } from 'vue'
import {
    collection, getDocs, doc, setDoc, Timestamp
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import { useToast } from 'primevue/usetoast'

export interface EmailTemplateSetting {
    id: string           // テンプレートキー: '打診メール' | '香盤連絡' etc.
    subject: string      // 件名テンプレート
    body: string         // 本文テンプレート
    updatedAt?: Timestamp
}

/**
 * メールテンプレート設定composable
 * Firestore emailTemplates コレクションでカスタムテンプレートを管理
 */
export function useEmailSettings() {
    const templates = ref<EmailTemplateSetting[]>([])
    const loading = ref(false)
    const toast = useToast()

    // デフォルトテンプレート（EMAIL_GENERATION_SPEC.md準拠の正確な本文）
    const defaults: EmailTemplateSetting[] = [
        {
            id: '打診メール',
            subject: '【ご相談】{{作品名}} / {{役名}}役',
            body: `お世話になっております、直前のご依頼申し訳ございません。
以下作品にて、ご出演いただきたく
{{撮影日}}のスケジュールについてお伺いできますでしょうか。
＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
【撮影概要】
撮影日　：{{撮影日}}
作品名：「{{作品名}}」
役柄　：{{役名}}役

クライアント：なし
競合：なし

投稿先：ごっこ倶楽部tik tokアカウント
https://www.tiktok.com/@gokko5club
投稿先：daikaiアカウント
https://www.tiktok.com/@daikai_55
投稿先：ウミガメごっこアカウント
https://www.tiktok.com/@gokko5club.umigame
投稿先：docomo
https://www.tiktok.com/@docomo.official

※その他ごっこ倶楽部運営の各種SNSなどでも投稿予定。

※作品認知向上のため、
プレスリリースや各種SNSでの告知発信の可能性もございます。

使用期間：無期限

二次使用：予定あり
・ドラマ素材を活用した各種SNSでの広告配信
X、Instagram、YouTube
・今回の施策用のキャンペーンページ(Webサイト)
二次使用期間は3ヶ月

ご出演料：￥{{金額}}〜/day
※出演時間確定次第となりますが上記を想定しております
＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
大変恐れ入りますが、
取り急ぎスケジュールの有無についてご確認いただけますと幸いです。

何卒よろしくお願い申し上げます。`
        },
        {
            id: '香盤連絡',
            subject: '【香盤連絡】{{作品名}}',
            body: `お世話になっております。お待たせして大変申し訳ございません。
{{撮影日}}の香盤が確定しましたのでお伝えいたします。
また今回のご出演料は¥{{金額}}でお願いいたします。
＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
【{{撮影日}}　撮影概要】

▼{{キャスト名}} さま
{{撮影日}}　{{時間}}
作品名：「{{作品名1}}」　{{配役1}}役
　　　　「{{作品名2}}」　{{配役2}}役
　　　　「{{作品名3}}」　{{配役3}}役

集合場所：{{集合場所}}
{{住所}}
{{マップ}}

ご持参いただきたい衣装：
{{衣装内容}}

詳細については以下をご確認くださいませ。
{{notion}}

当日の緊急連絡先
{{連絡先}}
＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
何卒よろしくお願いいたします。`
        },
        {
            id: '発注書',
            subject: '【発注書送付】{{作品名}}',
            body: `この度は作品へのご参加ありがとうございます。
添付PDFにて発注内容をお伝えいたしますので、ご確認いただきご請求ください。
恐れ入りますが、翌月の3営業日以内迄に、ご請求書をお送りくださいませ。
なお、ご出演料のご請求書発行方法について以下ページにおまとめしております。
※同月中のご出演分であれば、他作品出演分の請求書とまとめての送付でも問題ございません。
請求書送付先：cast-invoice@gokkoclub.jp
【締め支払い日及び請求書発行について】
https://brass-soursop-b4a.notion.site/4f37617875b8400d93a444956ab54fa6
引き続き、何卒よろしくお願いいたします。`
        },
        {
            id: 'オフショット_案件',
            subject: '【オフショット共有】{{作品名}}',
            body: `案件撮影
お世話になっております。
先日{{キャスト名}}さまにご参加いただいた撮影の写真の共有でございます。
NGチェックの意味も含め、Googleドライブにて共有させていただきます。
・作品名『{{作品名1}}』　※{{撮影日}}撮影
{{GドライブURL}}
※編集権限を付与しておりますので、NGはご自由に削除いただけます。
※こちらの写真は●:00までにNG対応お願いいたします。
※作品投稿後にご活用いただけます。
よろしくお願いいたします。`
        },
        {
            id: 'オフショット_非案件',
            subject: '【オフショット共有】{{作品名}}',
            body: `お世話になっております。
先日{{キャスト名}}さまにご参加いただいた撮影の写真の共有でございます。
NGチェックの意味も含め、Googleドライブにて共有させていただきます。

・作品名『{{作品名1}}』　※{{撮影日}}撮影
{{GドライブURL}}
※編集権限を付与しておりますので、NGはご自由に削除いただけます。
※こちらの写真は●:00以降自由にご利用ください。
（全体共有いたしますので、それまでにNG対応お願いいたします。）

よろしくお願いいたします。`
        },
        {
            id: '投稿日連絡',
            subject: '【投稿日連絡】{{作品名}}',
            body: `お世話になっております。
先日{{キャスト名}} さまにご参加いただいた作品の投稿スケジュールの共有でございます。

作品名　：『{{作品名1}}』
投稿日　：{{投稿日}}
アカウント：{{アカウント}}

【TikTok閲覧・シェア時の注意点】
作品出演の告知をいただく際、
TikTokのリンク共有はアルゴリズムでマイナスに働いてしまいます。
告知いただく際は、以下いずれかでご対応ください。
① 投稿当日に告知を行う場合
・URLは記載せず、画像とテキストのみで投稿をお願いします。
② 投稿翌日以降に告知を行う場合
・URLは記載せず、画像とテキストのみで投稿をお願いします。
・「動画リンク」ではなく、「アカウントのリンク」を記載する形でご投稿ください。

よろしくお願いいたします。`
        }
    ]

    /**
     * Firestoreからテンプレートを取得（なければデフォルト）
     */
    async function fetchTemplates() {
        if (!db) {
            templates.value = [...defaults]
            return
        }
        loading.value = true
        try {
            const snap = await getDocs(collection(db, 'emailTemplates'))
            if (snap.empty) {
                templates.value = [...defaults]
                return
            }

            // Firestore + デフォルトのマージ
            const firestoreMap = new Map<string, EmailTemplateSetting>()
            snap.forEach(docSnap => {
                const data = docSnap.data()
                firestoreMap.set(docSnap.id, {
                    id: docSnap.id,
                    subject: data.subject || '',
                    body: data.body || '',
                    updatedAt: data.updatedAt
                })
            })

            templates.value = defaults.map(d => firestoreMap.get(d.id) || d)
        } catch (error) {
            console.error('Error fetching email templates:', error)
            templates.value = [...defaults]
        } finally {
            loading.value = false
        }
    }

    /**
     * テンプレートを保存
     */
    async function saveTemplate(template: EmailTemplateSetting): Promise<boolean> {
        if (!db) return false
        try {
            await setDoc(doc(db, 'emailTemplates', template.id), {
                subject: template.subject,
                body: template.body,
                updatedAt: Timestamp.now()
            })
            toast.add({ severity: 'success', summary: '保存完了', detail: `${template.id} テンプレートを保存しました`, life: 2000 })
            return true
        } catch (error) {
            console.error('Error saving email template:', error)
            toast.add({ severity: 'error', summary: 'エラー', detail: '保存に失敗しました', life: 3000 })
            return false
        }
    }

    /**
     * デフォルトにリセット
     */
    function resetToDefault(templateId: string): EmailTemplateSetting | undefined {
        return defaults.find(d => d.id === templateId)
    }

    /**
     * テンプレートIDで取得
     */
    function getTemplate(templateId: string): EmailTemplateSetting {
        return templates.value.find(t => t.id === templateId) || defaults.find(d => d.id === templateId) || defaults[0]!
    }

    return {
        templates,
        loading,
        defaults,
        fetchTemplates,
        saveTemplate,
        resetToDefault,
        getTemplate
    }
}
