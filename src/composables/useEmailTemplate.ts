import type { ShootingContact, ShootingContactStatus, Casting } from '@/types'
import { useEmailSettings } from '@/composables/useEmailSettings'

export type EmailTemplateType =
    | '打診メール'
    | '香盤連絡'
    | '発注書'
    | 'オフショット_案件'
    | 'オフショット_非案件'
    | '投稿日連絡'

/**
 * メールテンプレート生成composable
 * Firestoreのカスタムテンプレートを優先使用し、変数置換を実行
 */
export function useEmailTemplate() {

    const { getTemplate, fetchTemplates } = useEmailSettings()

    // 初回ロード
    fetchTemplates()

    const getDefaultTemplate = (status: ShootingContactStatus | string): EmailTemplateType => {
        switch (status) {
            case '香盤連絡待ち':
            case '決定':
            case 'OK':
                return '香盤連絡'
            case '発注書送信待ち':
                return '発注書'
            case 'メイキング共有待ち':
                return 'オフショット_案件'
            case '投稿日連絡待ち':
                return '投稿日連絡'
            case 'オーダー待ち':
            case '打診中':
            case '仮キャスティング':
            case '条件つきOK':
                return '打診メール'
            default:
                return '香盤連絡'
        }
    }

    const allTemplates: EmailTemplateType[] = [
        '打診メール', '香盤連絡', '発注書',
        'オフショット_案件', 'オフショット_非案件', '投稿日連絡'
    ]

    /**
     * 日付フォーマットヘルパー
     */
    const formatShootDate = (contact: ShootingContact): string => {
        if (contact.shootDate?.toDate) {
            const d = contact.shootDate.toDate()
            const weekdays = ['日', '月', '火', '水', '木', '金', '土']
            return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`
        }
        return String(contact.shootDate || '未定')
    }

    const formatCost = (contact: ShootingContact): string => {
        if (contact.cost) return contact.cost
        if (contact.fee) return contact.fee.toLocaleString()
        return '18,000'
    }

    const buildNotionUrl = (notionId?: string): string => {
        if (!notionId) return '（Notion URL）'
        const cleanId = notionId.replace(/-/g, '')
        return `https://www.notion.so/${cleanId}`
    }

    /**
     * テンプレート変数置換
     */
    function replaceVariables(text: string, contact: ShootingContact): string {
        const date = formatShootDate(contact)
        const cost = formatCost(contact)
        const time = [contact.inTime, contact.outTime].filter(Boolean).join('〜') || '時間未定'
        const notionUrl = buildNotionUrl(contact.notionId)

        return text
            .replace(/\{\{撮影日\}\}/g, date)
            .replace(/\{\{キャスト名\}\}/g, contact.castName || '')
            .replace(/\{\{作品名\}\}/g, contact.projectName || '')
            .replace(/\{\{作品名1\}\}/g, contact.projectName || '')
            .replace(/\{\{作品名2\}\}/g, '（作品名）')
            .replace(/\{\{作品名3\}\}/g, '（作品名）')
            .replace(/\{\{役名\}\}/g, contact.roleName || '未定')
            .replace(/\{\{配役1\}\}/g, contact.roleName || '（役名）')
            .replace(/\{\{配役2\}\}/g, '（役名）')
            .replace(/\{\{配役3\}\}/g, '（役名）')
            .replace(/\{\{金額\}\}/g, cost)
            .replace(/\{\{時間\}\}/g, time)
            .replace(/\{\{集合場所\}\}/g, contact.location || '（集合場所）')
            .replace(/\{\{住所\}\}/g, contact.address || '（住所）')
            .replace(/\{\{マップ\}\}/g, '（マップURL）')
            .replace(/\{\{衣装内容\}\}/g, '（衣装詳細）')
            .replace(/\{\{notion\}\}/g, notionUrl)
            .replace(/\{\{連絡先\}\}/g, '090-xxxx-xxxx (担当者)')
            .replace(/\{\{アカウント\}\}/g, contact.accountName || '（アカウント名）')
            .replace(/\{\{GドライブURL\}\}/g, contact.makingUrl || '(Google Drive URL)')
            .replace(/\{\{投稿日\}\}/g, contact.postDate?.toDate ? contact.postDate.toDate().toLocaleDateString('ja-JP') : '（投稿日未定）')
    }

    /**
     * テンプレートからメール生成（Firestore優先）
     */
    const generateMail = (contact: ShootingContact, template: EmailTemplateType) => {
        const tpl = getTemplate(template)
        return {
            subject: replaceVariables(tpl.subject, contact),
            body: replaceVariables(tpl.body, contact)
        }
    }

    // Backward compat
    const generateKoubanMail = (contact: ShootingContact) => generateMail(contact, '香盤連絡')
    const generateOrderMail = (contact: ShootingContact) => generateMail(contact, '発注書')

    const generateInquiryMail = (casting: Casting, dates: string[]) => {
        const subject = `【出演可否確認】${casting.projectName} ${casting.castName}様`
        const datesStr = dates.join('、')
        const body = `${casting.castName}様

お世話になっております。
下記案件への出演可否をご確認させていただきたくご連絡いたしました。

■ 案件名: ${casting.projectName}
■ 撮影日: ${datesStr}
■ 役名: ${casting.roleName || '未定'}

ご都合いかがでしょうか。
お忙しいところ恐れ入りますが、ご返信いただけますと幸いです。

よろしくお願いいたします。`
        return { subject, body }
    }

    const copyToClipboard = async (text: string) => {
        await navigator.clipboard.writeText(text)
    }

    const openMailto = (to: string, subject: string, body: string) => {
        const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
        window.open(mailto)
    }

    return {
        generateMail,
        generateKoubanMail,
        generateOrderMail,
        generateInquiryMail,
        getDefaultTemplate,
        allTemplates,
        copyToClipboard,
        openMailto
    }
}
