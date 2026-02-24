import { ref } from 'vue'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { useToast } from 'primevue/usetoast'

/**
 * PDF生成用のデータ型
 * OrderPdfModal の編集フォームから渡される
 */
export interface OrderDocumentData {
    date: string        // 発行日
    castName: string    // 宛名
    project: string     // 案件名
    role: string        // 役名
    shootDate: string   // 撮影日
    cost: string        // 金額（半角数字 or ¥付き文字列）
    note: string        // 備考
    uuid: string        // 発注書番号
}

/**
 * PDF生成composable
 * ORDER_DOCUMENT_SPEC.md Section 5-8 準拠
 */
export function usePdfGenerator() {
    const loading = ref(false)
    const toast = useToast()

    /**
     * 金額フォーマット（Section 6 準拠）
     */
    function formatCost(raw: string): string {
        if (!raw) return '未定'
        const numCost = Number(raw.replace(/[^0-9]/g, ''))
        if (numCost > 0 && !raw.includes('¥')) {
            return `¥${numCost.toLocaleString()}`
        }
        return raw
    }

    /**
     * 発注書PDFを生成（Section 5 レイアウト準拠）
     */
    async function generateOrderDocument(data: OrderDocumentData): Promise<void> {
        loading.value = true

        try {
            const costStr = formatCost(data.cost)

            const html = `
                <div id="pdf-container" style="
                    width: 595px;
                    min-height: 842px;
                    padding: 45px 40px 30px;
                    font-family: 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
                    font-size: 11px;
                    line-height: 1.7;
                    color: #1a1a1a;
                    background: white;
                    box-sizing: border-box;
                ">
                    <!-- タイトル -->
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h1 style="font-size: 20px; font-weight: 700; letter-spacing: 6px; margin: 0;">
                            GOKKO倶楽部出演発注書
                        </h1>
                    </div>

                    <!-- 日付 + 発注書番号 -->
                    <div style="text-align: right; margin-bottom: 5px; font-size: 11px;">
                        ${data.date}
                    </div>
                    <div style="text-align: right; margin-bottom: 20px; font-size: 9px; color: #888;">
                        No. ${data.uuid}
                    </div>

                    <!-- 宛名 -->
                    <div style="margin-bottom: 20px; font-size: 15px; font-weight: 600; border-bottom: 2px solid #333; padding-bottom: 6px;">
                        ${data.castName} 様
                    </div>

                    <!-- 挨拶文 -->
                    <div style="margin-bottom: 18px; font-size: 10.5px; line-height: 1.8;">
                        ご快諾いただきましたドラマ出演の件につきまして、下記の通り発注申し上げます。<br>
                        内容をご確認いただき、ご不明な点がございましたら担当までご連絡ください。
                    </div>

                    <!-- 発注元情報 -->
                    <div style="margin-bottom: 18px; font-size: 10px; line-height: 1.8;">
                        <div style="font-weight: 600; margin-bottom: 4px;">【発注元】</div>
                        〒135-0091<br>
                        東京都港区台場2-3-1トレードピアお台場12F<br>
                        株式会社GOKKO<br>
                        担当：GOKKO倶楽部キャスティング担当
                    </div>

                    <!-- お取引条件 -->
                    <div style="margin-bottom: 18px; font-size: 10px; line-height: 1.8;">
                        <div style="font-weight: 600; margin-bottom: 4px;">【お取引条件】</div>
                        支払条件：月末締め翌月末払い<br>
                        支払方法：ご指定の銀行口座へお振込み<br>
                        秘密保持：本件に関わる脚本内容、撮影情報、共演者情報等は、公式解禁まで第三者への漏洩（SNS含む）を禁止
                    </div>

                    <!-- 「以上」 -->
                    <div style="text-align: right; margin-bottom: 20px; font-size: 10.5px;">以上</div>

                    <!-- 「記」 -->
                    <div style="text-align: center; margin-bottom: 15px; font-size: 14px; font-weight: 600;">記</div>

                    <!-- 明細テーブル -->
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px;">
                        <tr>
                            <td style="padding: 8px 12px; border: 1px solid #999; background: #f0f0f0; font-weight: 600; width: 100px; text-align: center;">案件名</td>
                            <td style="padding: 8px 12px; border: 1px solid #999;">${data.project}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 12px; border: 1px solid #999; background: #f0f0f0; font-weight: 600; text-align: center;">役名</td>
                            <td style="padding: 8px 12px; border: 1px solid #999;">${data.role || '－'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 12px; border: 1px solid #999; background: #f0f0f0; font-weight: 600; text-align: center;">撮影日</td>
                            <td style="padding: 8px 12px; border: 1px solid #999;">${data.shootDate || '未定'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 12px; border: 1px solid #999; background: #f0f0f0; font-weight: 600; text-align: center;">出演料</td>
                            <td style="padding: 8px 12px; border: 1px solid #999; font-weight: 600;">${costStr}（税別）</td>
                        </tr>
                    </table>

                    ${data.note ? `
                    <div style="margin-bottom: 15px; font-size: 10px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">【備考】</div>
                        <div style="white-space: pre-wrap;">${data.note}</div>
                    </div>
                    ` : ''}
                </div>
            `

            // 一時的なDOM要素を画面外に作成
            const container = document.createElement('div')
            container.style.cssText = 'position: fixed; left: -9999px; top: 0; z-index: -1;'
            container.innerHTML = html
            document.body.appendChild(container)

            const pdfElement = container.querySelector('#pdf-container') as HTMLElement

            // html2canvas でキャプチャ (scale:2 for高精細)
            const canvas = await html2canvas(pdfElement, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                width: 595,
                windowWidth: 595
            })

            // jsPDF で A4 PDF 作成
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            })

            const pageWidth = pdf.internal.pageSize.getWidth()
            const pageHeight = pdf.internal.pageSize.getHeight()
            const imgWidth = pageWidth
            const imgHeight = (canvas.height * imgWidth) / canvas.width

            pdf.addImage(
                canvas.toDataURL('image/png'),
                'PNG',
                0, 0,
                imgWidth,
                Math.min(imgHeight, pageHeight)
            )

            // ファイル名: {撮影日}_{案件名}_{キャスト名}様_発注書.pdf (Section 8)
            const shootDateClean = data.shootDate.replace(/[\/\-\.年月日]/g, '')
            const fileName = `${shootDateClean || 'undated'}_${data.project}_${data.castName}様_発注書.pdf`
            pdf.save(fileName)

            // DOM要素クリーンアップ
            document.body.removeChild(container)

            toast.add({
                severity: 'success',
                summary: 'PDF生成完了',
                detail: `${fileName} をダウンロードしました`,
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
    async function generateBulkOrderDocuments(dataList: OrderDocumentData[]): Promise<void> {
        for (const data of dataList) {
            await generateOrderDocument(data)
        }
    }

    return {
        loading,
        generateOrderDocument,
        generateBulkOrderDocuments
    }
}
