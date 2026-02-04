import type { ShootingContact, Casting } from '@/types'

/**
 * メールテンプレート生成composable
 * 香盤連絡メールと発注書送付メールのテンプレートを生成
 */
export function useEmailTemplate() {

    /**
     * 香盤連絡メールを生成
     */
    const generateKoubanMail = (contact: ShootingContact) => {
        const subject = `【香盤連絡】${contact.projectName} ${contact.castName}様`

        const shootDate = contact.shootDate?.toDate
            ? contact.shootDate.toDate().toLocaleDateString('ja-JP')
            : contact.shootDate || '未定'

        const body = `${contact.castName}様

お世話になっております。
撮影の香盤をご連絡いたします。

■ 撮影日: ${shootDate}
■ 集合時間: ${contact.inTime || '未定'}
■ 終了予定: ${contact.outTime || '未定'}
■ 撮影場所: ${contact.location || '未定'}
■ 住所: ${contact.address || ''}

ご確認のほど、よろしくお願いいたします。`

        return { subject, body }
    }

    /**
     * 発注書送付メールを生成
     */
    const generateOrderMail = (contact: ShootingContact) => {
        const subject = `【発注書送付】${contact.projectName} ${contact.castName}様`

        const shootDate = contact.shootDate?.toDate
            ? contact.shootDate.toDate().toLocaleDateString('ja-JP')
            : contact.shootDate || '未定'

        const body = `${contact.castName}様

お世話になっております。
発注書を添付にてお送りいたします。

■ 案件名: ${contact.projectName}
■ 撮影日: ${shootDate}
■ 出演者: ${contact.castName}様
■ 金額: ${contact.fee ? `¥${contact.fee.toLocaleString()}（税別）` : '別途ご連絡'}

ご確認いただき、問題なければご署名・捺印の上
ご返送くださいますようお願いいたします。`

        return { subject, body }
    }

    /**
     * キャスティングからの問い合わせメール生成
     */
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

    /**
     * クリップボードにコピー
     */
    const copyToClipboard = async (text: string) => {
        await navigator.clipboard.writeText(text)
    }

    /**
     * mailto URLを開く
     */
    const openMailto = (to: string, subject: string, body: string) => {
        const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
        window.open(mailto)
    }

    return {
        generateKoubanMail,
        generateOrderMail,
        generateInquiryMail,
        copyToClipboard,
        openMailto
    }
}
