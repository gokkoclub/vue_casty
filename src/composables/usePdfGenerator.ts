import { ref } from 'vue'
import { jsPDF } from 'jspdf'
import type { ShootingContact } from '@/types'
import { useToast } from 'primevue/usetoast'

/**
 * PDF生成composable
 * 発注書やその他ドキュメントのPDF生成
 */
export function usePdfGenerator() {
    const loading = ref(false)
    const toast = useToast()

    /**
     * 発注書PDFを生成
     */
    function generateOrderDocument(contact: ShootingContact): void {
        loading.value = true

        try {
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            })

            // フォントサイズ設定
            const titleSize = 20
            const headerSize = 14
            const bodySize = 12
            const smallSize = 10

            // ページ幅
            const pageWidth = doc.internal.pageSize.getWidth()
            const margin = 20
            let y = margin

            // タイトル
            doc.setFontSize(titleSize)
            doc.text('発 注 書', pageWidth / 2, y, { align: 'center' })
            y += 15

            // 日付
            const today = new Date()
            const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`
            doc.setFontSize(smallSize)
            doc.text(dateStr, pageWidth - margin, y, { align: 'right' })
            y += 15

            // 宛先
            doc.setFontSize(headerSize)
            doc.text(`${contact.castName} 様`, margin, y)
            y += 10

            // 区切り線
            doc.line(margin, y, pageWidth - margin, y)
            y += 10

            // 撮影情報
            doc.setFontSize(bodySize)

            const infoItems = [
                ['案件名', contact.projectName],
                ['チーム・アカウント', contact.accountName],
                ['撮影日', contact.shootDate ? formatDate(contact.shootDate.toDate()) : '未定'],
                ['役割', contact.roleName || ''],
                ['メイン/サブ', contact.mainSub || ''],
            ]

            infoItems.forEach(([label, value]) => {
                doc.setFont('helvetica', 'bold')
                doc.text(`${label}:`, margin, y)
                doc.setFont('helvetica', 'normal')
                doc.text(value || '－', margin + 50, y)
                y += 8
            })

            y += 5

            // 時間・場所情報
            if (contact.inTime || contact.outTime || contact.location) {
                doc.line(margin, y, pageWidth - margin, y)
                y += 10

                doc.setFontSize(headerSize)
                doc.text('撮影詳細', margin, y)
                y += 8

                doc.setFontSize(bodySize)

                if (contact.inTime) {
                    doc.text(`IN時間: ${contact.inTime}`, margin, y)
                    y += 8
                }
                if (contact.outTime) {
                    doc.text(`OUT時間: ${contact.outTime}`, margin, y)
                    y += 8
                }
                if (contact.location) {
                    doc.text(`撮影場所: ${contact.location}`, margin, y)
                    y += 8
                }
                if (contact.address) {
                    doc.text(`住所: ${contact.address}`, margin, y)
                    y += 8
                }
            }

            y += 5

            // 金額情報
            if (contact.fee) {
                doc.line(margin, y, pageWidth - margin, y)
                y += 10

                doc.setFontSize(headerSize)
                doc.text('金額', margin, y)
                y += 8

                doc.setFontSize(bodySize)
                doc.text(`ご請求金額: ¥${contact.fee.toLocaleString()}（税込）`, margin, y)
                y += 15
            }

            // フッター
            doc.line(margin, y, pageWidth - margin, y)
            y += 10

            doc.setFontSize(smallSize)
            doc.text('本発注書の内容にご同意いただける場合は、', margin, y)
            y += 6
            doc.text('ご返信をお願いいたします。', margin, y)
            y += 15

            doc.text('発行者: 株式会社○○○', margin, y)
            y += 6
            doc.text(`担当: ${contact.accountName || 'システム'}`, margin, y)

            // PDFをダウンロード
            const fileName = `発注書_${contact.castName}_${formatDateCompact(contact.shootDate?.toDate() || new Date())}.pdf`
            doc.save(fileName)

            toast.add({
                severity: 'success',
                summary: 'PDF生成完了',
                detail: `${fileName} を生成しました`,
                life: 3000
            })

        } catch (error) {
            console.error('Error generating PDF:', error)
            toast.add({
                severity: 'error',
                summary: 'PDF生成エラー',
                detail: 'PDFの生成に失敗しました',
                life: 3000
            })
        } finally {
            loading.value = false
        }
    }

    /**
     * 複数の発注書を一括生成
     */
    function generateBulkOrderDocuments(contacts: ShootingContact[]): void {
        contacts.forEach(contact => {
            generateOrderDocument(contact)
        })
    }

    /**
     * 日付フォーマット (YYYY年MM月DD日)
     */
    function formatDate(date: Date): string {
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
    }

    /**
     * 日付フォーマット (YYYYMMDD)
     */
    function formatDateCompact(date: Date): string {
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}${m}${d}`
    }

    return {
        loading,
        generateOrderDocument,
        generateBulkOrderDocuments
    }
}
